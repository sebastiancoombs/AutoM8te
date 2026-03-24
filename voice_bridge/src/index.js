/**
 * AutoM8te Voice Bridge
 *
 * Bridges Discord voice ↔ OpenAI Realtime API for sub-500ms voice drone control.
 *
 * Architecture:
 *   Discord Voice Channel (user speaks)
 *     → Opus decode → PCM 24kHz mono
 *     → OpenAI Realtime API WebSocket
 *     → Model: STT + reasoning + function calling + TTS in ONE pass
 *     → Function calls → HTTP to Swarm Manager (localhost:8000)
 *     → Audio response → PCM 24kHz mono
 *     → Upsample → Opus encode → Discord voice channel
 *
 * Target latency: ~300-500ms from user speech end to AI response start.
 */

import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { DiscordVoice } from './discord-voice.js';
import { RealtimeClient } from './realtime-client.js';

// ── Validate config ──

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const VOICE_CHANNEL_ID = process.env.DISCORD_VOICE_CHANNEL_ID;
const LISTEN_USER_ID = process.env.DISCORD_LISTEN_USER_ID;

if (!DISCORD_TOKEN) {
  console.error('❌ DISCORD_BOT_TOKEN not set. See .env.example');
  process.exit(1);
}
if (!OPENAI_KEY) {
  console.error('❌ OPENAI_API_KEY not set. See .env.example');
  process.exit(1);
}

// ── Discord client ──

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const voice = new DiscordVoice();
let realtime = null;
let isStreamingResponse = false;

// ── Discord ready ──

discord.once(Events.ClientReady, async (client) => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);

  // Auto-join voice channel if configured
  if (VOICE_CHANNEL_ID && GUILD_ID) {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
      const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
      if (channel?.isVoiceBased()) {
        await startVoiceBridge(channel);
      } else {
        console.error(`❌ Voice channel ${VOICE_CHANNEL_ID} not found in guild`);
      }
    }
  } else {
    console.log('[BOT] No auto-join configured. Use !join in a text channel while in voice.');
  }
});

// ── Text commands ──

discord.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // !join — join the user's voice channel
  if (message.content === '!join') {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      await message.reply('Join a voice channel first.');
      return;
    }
    await startVoiceBridge(voiceChannel);
    await message.reply(`🎙️ Joined **${voiceChannel.name}**. Voice drone control active.`);
  }

  // !leave — leave voice channel
  if (message.content === '!leave') {
    voice.leave();
    realtime?.disconnect();
    realtime = null;
    await message.reply('👋 Left voice channel.');
  }

  // !say <text> — send text to Realtime API (for testing)
  if (message.content.startsWith('!say ')) {
    const text = message.content.slice(5);
    if (realtime) {
      realtime.sendText(text);
      await message.reply(`📝 Sent: "${text}"`);
    } else {
      await message.reply('Not connected. Use !join first.');
    }
  }

  // !status — show connection status
  if (message.content === '!status') {
    const connected = realtime?._connected ? '✅' : '❌';
    const voiceConn = voice.connection ? '✅' : '❌';
    await message.reply(
      `**AutoM8te Voice Bridge**\n` +
      `Discord voice: ${voiceConn}\n` +
      `Realtime API: ${connected}\n` +
      `Model: ${process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime'}\n` +
      `Voice: ${process.env.OPENAI_VOICE || 'coral'}`
    );
  }
});

// ── Core: Voice Bridge ──

async function startVoiceBridge(channel) {
  console.log('[BRIDGE] Starting voice bridge...');

  // 1. Join Discord voice
  await voice.join(channel);

  // 2. Connect to OpenAI Realtime API
  realtime = new RealtimeClient(OPENAI_KEY, {
    model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
    voice: process.env.OPENAI_VOICE || 'coral',
  });

  // 3. Wire audio: Discord → Realtime API
  voice.on('audio', (pcmChunk) => {
    realtime.sendAudio(pcmChunk);
  });

  // 4. Wire audio: Realtime API → Discord
  realtime.on('speech_started', () => {
    // User started speaking — stop any current playback to allow barge-in
    if (isStreamingResponse) {
      voice.endPlayback();
      isStreamingResponse = false;
    }
  });

  realtime.on('audio', (pcmChunk) => {
    if (!isStreamingResponse) {
      // Start a new playback stream for this response
      voice.startPlayback();
      isStreamingResponse = true;
    }
    voice.appendAudio(pcmChunk);
  });

  realtime.on('audio_done', () => {
    voice.endPlayback();
    isStreamingResponse = false;
  });

  // 5. Logging
  realtime.on('user_transcript', (text) => {
    console.log(`🎤 User: ${text}`);
  });

  realtime.on('assistant_transcript', (text) => {
    console.log(`🤖 AutoM8te: ${text}`);
  });

  realtime.on('error', (err) => {
    console.error('[BRIDGE] Realtime error:', err.message);
  });

  // 6. Connect Realtime API
  realtime.connect();

  // 7. Start listening to voice
  realtime.once('ready', () => {
    if (LISTEN_USER_ID) {
      voice.listenTo(LISTEN_USER_ID);
    } else {
      voice.listenToAll();
    }
    console.log('[BRIDGE] ✅ Voice bridge active. Speak to control drones.');
  });
}

// ── Graceful shutdown ──

process.on('SIGINT', () => {
  console.log('\n[BRIDGE] Shutting down...');
  voice.leave();
  realtime?.disconnect();
  discord.destroy();
  process.exit(0);
});

// ── Start ──

console.log('🚁 AutoM8te Voice Bridge starting...');
discord.login(DISCORD_TOKEN);
