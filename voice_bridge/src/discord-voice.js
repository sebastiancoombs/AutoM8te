/**
 * AutoM8te Voice Bridge — Discord Voice Handler
 *
 * Manages joining/leaving Discord voice channels, capturing user audio,
 * and playing back audio from the Realtime API.
 *
 * Audio pipeline:
 *   Discord Opus → prism-media OpusDecoder → PCM 48kHz stereo
 *   → downsample to 24kHz mono → Realtime API
 *
 *   Realtime API PCM 24kHz mono → upsample to 48kHz stereo
 *   → prism-media OpusEncoder → Discord
 */

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  EndBehaviorType,
  StreamType,
} from '@discordjs/voice';
import { Transform, PassThrough, Readable } from 'stream';
import prism from 'prism-media';
import { config } from './config.js';

/**
 * Downsample PCM from 48kHz stereo (Discord) to 24kHz mono (Realtime API).
 * Input: 16-bit LE, 2 channels, 48000 Hz
 * Output: 16-bit LE, 1 channel, 24000 Hz
 *
 * Simple approach: take every 4th sample (48k/2ch → 24k/1ch = take left channel, skip every other frame).
 */
class DownsampleTransform extends Transform {
  constructor() {
    super();
    this._remainder = Buffer.alloc(0);
  }

  _transform(chunk, encoding, callback) {
    // Prepend any leftover bytes
    const data = this._remainder.length
      ? Buffer.concat([this._remainder, chunk])
      : chunk;

    // 4 bytes per stereo sample at 16-bit
    const frameSize = 4; // 2 bytes * 2 channels
    const usable = data.length - (data.length % frameSize);
    this._remainder = data.subarray(usable);

    const outputFrames = Math.floor(usable / (frameSize * 2)); // skip every other frame = /2
    const output = Buffer.alloc(outputFrames * 2); // 2 bytes per mono sample

    for (let i = 0, o = 0; i < usable && o < output.length; i += frameSize * 2, o += 2) {
      // Take the left channel sample from every other frame
      output.writeInt16LE(data.readInt16LE(i), o);
    }

    if (output.length > 0) {
      callback(null, output);
    } else {
      callback();
    }
  }

  _flush(callback) {
    callback();
  }
}

/**
 * Upsample PCM from 24kHz mono (Realtime API) to 48kHz stereo (Discord).
 * Input: 16-bit LE, 1 channel, 24000 Hz
 * Output: 16-bit LE, 2 channels, 48000 Hz
 *
 * Duplicate each sample to stereo, duplicate each frame (24k → 48k).
 */
class UpsampleTransform extends Transform {
  constructor() {
    super();
    this._remainder = Buffer.alloc(0);
  }

  _transform(chunk, encoding, callback) {
    const data = this._remainder.length
      ? Buffer.concat([this._remainder, chunk])
      : chunk;

    const sampleSize = 2; // 16-bit
    const usable = data.length - (data.length % sampleSize);
    this._remainder = data.subarray(usable);

    // Each input sample (2 bytes) becomes 2 frames × 2 channels = 8 bytes
    const output = Buffer.alloc((usable / sampleSize) * 8);

    for (let i = 0, o = 0; i < usable; i += sampleSize, o += 8) {
      const sample = data.readInt16LE(i);
      // Frame 1: L + R
      output.writeInt16LE(sample, o);
      output.writeInt16LE(sample, o + 2);
      // Frame 2: L + R (duplicate for 48kHz)
      output.writeInt16LE(sample, o + 4);
      output.writeInt16LE(sample, o + 6);
    }

    callback(null, output);
  }

  _flush(callback) {
    callback();
  }
}

export class DiscordVoiceHandler {
  constructor(client) {
    this.client = client;
    this.connection = null;
    this.player = createAudioPlayer();
    this.realtimeSession = null;
    this._userSubscriptions = new Map();
    this._audioQueue = []; // Queue of PCM buffers to play
    this._isPlaying = false;
    this._currentPlayStream = null;

    // When audio player becomes idle, play next in queue
    this.player.on(AudioPlayerStatus.Idle, () => {
      this._isPlaying = false;
      this._playNext();
    });

    this.player.on('error', (err) => {
      console.error('🔊 Audio player error:', err.message);
      this._isPlaying = false;
    });
  }

  /**
   * Set the Realtime session to bridge audio to/from.
   * @param {RealtimeSession} session
   */
  setRealtimeSession(session) {
    this.realtimeSession = session;

    // Buffer audio output and play it
    this._outputBuffer = Buffer.alloc(0);
    this._outputTimer = null;

    session.on('audio', (pcmBuffer) => {
      // Accumulate audio chunks, flush to Discord periodically
      this._outputBuffer = Buffer.concat([this._outputBuffer, pcmBuffer]);

      // Flush every 100ms worth of audio (24000 Hz * 2 bytes * 0.1s = 4800 bytes)
      if (this._outputBuffer.length >= 4800) {
        this._flushAudioToDiscord();
      }
    });

    session.on('audio_done', () => {
      // Flush remaining audio
      if (this._outputBuffer.length > 0) {
        this._flushAudioToDiscord();
      }
    });

    session.on('speech_started', () => {
      // User started speaking — cancel current playback for barge-in
      if (this._isPlaying) {
        this.player.stop();
        this._audioQueue = [];
        this._outputBuffer = Buffer.alloc(0);
        this._isPlaying = false;
        if (config.debug) console.log('🔇 Barge-in: stopped playback');
      }
    });
  }

  /**
   * Flush accumulated audio buffer to Discord.
   */
  _flushAudioToDiscord() {
    if (this._outputBuffer.length === 0) return;

    const chunk = this._outputBuffer;
    this._outputBuffer = Buffer.alloc(0);

    // Upsample 24kHz mono → 48kHz stereo for Discord
    const upsampler = new UpsampleTransform();
    const pcm48kStereo = [];

    upsampler.on('data', (d) => pcm48kStereo.push(d));
    upsampler.write(chunk);
    upsampler.end();

    const stereoBuffer = Buffer.concat(pcm48kStereo);
    this._audioQueue.push(stereoBuffer);

    if (!this._isPlaying) {
      this._playNext();
    }
  }

  /**
   * Play the next audio chunk from the queue.
   */
  _playNext() {
    if (this._audioQueue.length === 0) return;
    this._isPlaying = true;

    const pcmBuffer = this._audioQueue.shift();
    const readable = Readable.from([pcmBuffer]);
    const resource = createAudioResource(readable, {
      inputType: StreamType.Raw,
      // Raw PCM: 48kHz, stereo, 16-bit LE
    });

    this.player.play(resource);
  }

  /**
   * Join a Discord voice channel.
   * @param {string} channelId - Voice channel ID
   * @param {string} guildId - Guild ID
   * @param {object} adapterCreator - Guild adapter creator
   * @returns {Promise<void>}
   */
  async join(channelId, guildId, adapterCreator) {
    console.log(`🎙  Joining voice channel ${channelId}...`);

    this.connection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    // Subscribe the audio player to this connection
    this.connection.subscribe(this.player);

    // Wait for the connection to be ready
    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);
      console.log('✅ Joined voice channel');
    } catch (err) {
      console.error('❌ Failed to join voice channel:', err.message);
      this.connection.destroy();
      this.connection = null;
      throw err;
    }

    // Handle disconnection
    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Try to reconnect
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        // Truly disconnected
        console.log('🔌 Disconnected from voice channel');
        this.connection.destroy();
        this.connection = null;
      }
    });
  }

  /**
   * Subscribe to a user's audio stream in the voice channel.
   * @param {string} userId - Discord user ID
   */
  subscribeToUser(userId) {
    if (!this.connection) return;
    if (this._userSubscriptions.has(userId)) return;

    // Check if user is allowed
    if (config.discord.allowedUsers.length > 0 && !config.discord.allowedUsers.includes(userId)) {
      console.log(`🚫 User ${userId} not in allowed list, ignoring`);
      return;
    }

    console.log(`🎤 Subscribing to user ${userId}'s audio`);

    const receiver = this.connection.receiver;

    // Listen for when this user starts speaking
    receiver.speaking.on('start', (speakingUserId) => {
      if (speakingUserId !== userId) return;
      if (this._userSubscriptions.has(userId)) return; // Already subscribed

      const opusStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1000, // End stream after 1s of silence
        },
      });

      // Decode Opus to PCM (48kHz stereo) then downsample to 24kHz mono
      const decoder = new prism.opus.Decoder({
        rate: 48000,
        channels: 2,
        frameSize: 960,
      });
      const downsampler = new DownsampleTransform();

      opusStream
        .pipe(decoder)
        .pipe(downsampler)
        .on('data', (pcm24kMono) => {
          // Send to Realtime API
          if (this.realtimeSession?.connected) {
            this.realtimeSession.sendAudio(pcm24kMono);
          }
        });

      opusStream.on('end', () => {
        if (config.debug) console.log(`🎤 User ${userId} stopped speaking`);
        this._userSubscriptions.delete(userId);
      });

      opusStream.on('error', (err) => {
        console.error(`🎤 Audio stream error for ${userId}:`, err.message);
        this._userSubscriptions.delete(userId);
      });

      this._userSubscriptions.set(userId, opusStream);
    });
  }

  /**
   * Subscribe to ALL users in the voice channel (easier approach).
   * Uses the receiver's speaking event to auto-subscribe.
   */
  subscribeToAll() {
    if (!this.connection) return;

    const receiver = this.connection.receiver;
    console.log('🎤 Listening for all speakers in the voice channel');

    receiver.speaking.on('start', (userId) => {
      if (this._userSubscriptions.has(userId)) return;

      // Check allowed list
      if (config.discord.allowedUsers.length > 0 && !config.discord.allowedUsers.includes(userId)) {
        return;
      }

      if (config.debug) console.log(`🎤 User ${userId} started speaking`);

      const opusStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1500,
        },
      });

      const decoder = new prism.opus.Decoder({
        rate: 48000,
        channels: 2,
        frameSize: 960,
      });
      const downsampler = new DownsampleTransform();

      opusStream
        .pipe(decoder)
        .pipe(downsampler)
        .on('data', (pcm24kMono) => {
          if (this.realtimeSession?.connected) {
            this.realtimeSession.sendAudio(pcm24kMono);
          }
        });

      opusStream.on('end', () => {
        this._userSubscriptions.delete(userId);
      });

      opusStream.on('error', () => {
        this._userSubscriptions.delete(userId);
      });

      this._userSubscriptions.set(userId, opusStream);
    });
  }

  /**
   * Leave the voice channel.
   */
  leave() {
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }
    this._userSubscriptions.clear();
    this._audioQueue = [];
    this._isPlaying = false;
    console.log('👋 Left voice channel');
  }
}
