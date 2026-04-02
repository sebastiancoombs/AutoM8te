/**
 * AutoM8te Voice Bridge — Discord Voice Client
 * 
 * Joins a Discord voice channel, captures user audio, and plays back AI audio.
 */

import {
  Client,
  GatewayIntentBits,
} from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  EndBehaviorType,
  StreamType,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { config } from './config.js';
import {
  createOpusDecoder,
  createOpusEncoder,
  Downsampler,
  Upsampler,
  FrameBuffer,
  pcmToBase64,
} from './audio.js';

export class DiscordVoiceClient extends EventEmitter {
  constructor() {
    super();
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    this.connection = null;
    this.player = null;
    this.activeStreams = new Map(); // userId -> pipeline
    this._audioQueue = [];
    this._playing = false;
  }

  async connect() {
    await this.client.login(config.discord.token);
    console.log(`[Discord] Logged in as ${this.client.user.tag}`);

    // Wait for ready
    await new Promise((resolve) => {
      if (this.client.isReady()) return resolve();
      this.client.once('ready', resolve);
    });

    // Find voice channel
    let guildId = config.discord.guildId;
    let channelId = config.discord.channelId;

    if (!channelId) {
      // Auto-discover: find the first voice channel with users in it
      console.log('[Discord] No channel ID specified, scanning guilds...');
      for (const guild of this.client.guilds.cache.values()) {
        for (const channel of guild.channels.cache.values()) {
          if (channel.isVoiceBased() && channel.members.size > 0) {
            guildId = guild.id;
            channelId = channel.id;
            console.log(`[Discord] Found active voice channel: ${channel.name} in ${guild.name}`);
            break;
          }
        }
        if (channelId) break;
      }
    }

    if (!channelId) {
      console.log('[Discord] No active voice channel found. Waiting for someone to join...');
      // Set up listener for voice state changes
      this.client.on('voiceStateUpdate', (oldState, newState) => {
        if (newState.channelId && !this.connection) {
          console.log(`[Discord] User joined ${newState.channel.name}, joining...`);
          this._joinChannel(newState.guild.id, newState.channelId);
        }
      });
      return;
    }

    await this._joinChannel(guildId, channelId);
  }

  async _joinChannel(guildId, channelId) {
    const guild = this.client.guilds.cache.get(guildId);
    const channel = guild.channels.cache.get(channelId);

    this.connection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false, // We need to hear users
      selfMute: false,
    });

    // Wait for connection
    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 10_000);
      console.log(`[Discord] Joined voice channel: ${channel?.name || channelId}`);
    } catch (err) {
      console.error('[Discord] Failed to join voice channel:', err.message);
      throw err;
    }

    // Set up audio player for output
    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });
    this.connection.subscribe(this.player);

    this.player.on('error', (err) => {
      console.error('[Discord] Player error:', err.message);
    });

    // Listen for users speaking
    const receiver = this.connection.receiver;
    receiver.speaking.on('start', (userId) => {
      if (this._isAllowed(userId) && !this.activeStreams.has(userId)) {
        this._startListening(userId);
      }
    });

    // Handle disconnection
    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        // Seems to be reconnecting
      } catch {
        this.connection.destroy();
        this.emit('disconnected');
      }
    });

    this.emit('connected', { guildId, channelId });
  }

  _isAllowed(userId) {
    if (config.discord.allowedUsers.length === 0) return true;
    return config.discord.allowedUsers.includes(userId);
  }

  _startListening(userId) {
    const receiver = this.connection.receiver;

    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1000, // End after 1s of silence
      },
    });

    // Pipeline: Opus -> PCM 48kHz mono -> PCM 24kHz mono -> Base64 -> Realtime API
    const decoder = createOpusDecoder();
    const downsampler = new Downsampler();

    // Buffer to accumulate PCM for chunked sending
    let pcmBuffer = Buffer.alloc(0);
    const CHUNK_SIZE = 4800; // 100ms of 24kHz 16-bit mono = 4800 bytes

    opusStream.pipe(decoder).pipe(downsampler);

    downsampler.on('data', (pcmChunk) => {
      pcmBuffer = Buffer.concat([pcmBuffer, pcmChunk]);

      // Send in chunks to avoid overwhelming the WebSocket
      while (pcmBuffer.length >= CHUNK_SIZE) {
        const chunk = pcmBuffer.subarray(0, CHUNK_SIZE);
        pcmBuffer = pcmBuffer.subarray(CHUNK_SIZE);
        this.emit('audio_data', pcmToBase64(chunk));
      }
    });

    opusStream.on('end', () => {
      // Send remaining audio
      if (pcmBuffer.length > 0) {
        this.emit('audio_data', pcmToBase64(pcmBuffer));
        pcmBuffer = Buffer.alloc(0);
      }
      this.activeStreams.delete(userId);
    });

    opusStream.on('error', (err) => {
      console.error(`[Discord] Opus stream error for ${userId}:`, err.message);
      this.activeStreams.delete(userId);
    });

    this.activeStreams.set(userId, { opusStream, decoder, downsampler });
  }

  /**
   * Play PCM audio (24kHz mono 16-bit) back through Discord.
   * Buffers and queues audio chunks, then plays them sequentially.
   */
  playAudio(pcm24kBuffer) {
    this._audioQueue.push(pcm24kBuffer);
    if (!this._playing) this._drainQueue();
  }

  _drainQueue() {
    if (this._audioQueue.length === 0) {
      this._playing = false;
      return;
    }

    this._playing = true;
    // Combine all queued chunks
    const combined = Buffer.concat(this._audioQueue);
    this._audioQueue = [];

    // Upsample 24kHz → 48kHz, then encode to Opus for Discord
    const upsampler = new Upsampler();
    const frameBuffer = new FrameBuffer(960);
    const encoder = createOpusEncoder();
    const passThrough = new PassThrough();

    // Feed PCM through pipeline
    upsampler.pipe(frameBuffer).pipe(encoder).pipe(passThrough);
    upsampler.end(combined);

    const resource = createAudioResource(passThrough, {
      inputType: StreamType.Opus,
    });

    this.player.play(resource);

    this.player.once(AudioPlayerStatus.Idle, () => {
      this._drainQueue();
    });
  }

  /**
   * Play back a complete audio response (all chunks collected).
   */
  playCompleteAudio(pcm24kBuffer) {
    if (!pcm24kBuffer || pcm24kBuffer.length === 0) return;

    const upsampler = new Upsampler();
    const frameBuffer = new FrameBuffer(960);
    const encoder = createOpusEncoder();
    const passThrough = new PassThrough();

    upsampler.pipe(frameBuffer).pipe(encoder).pipe(passThrough);
    upsampler.end(pcm24kBuffer);

    const resource = createAudioResource(passThrough, {
      inputType: StreamType.Opus,
    });

    this.player.play(resource);
  }

  disconnect() {
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }
    if (this.client) {
      this.client.destroy();
    }
  }
}
