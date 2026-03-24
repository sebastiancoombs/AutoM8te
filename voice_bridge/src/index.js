/**
 * OpenClaw Discord Realtime Voice Bridge
 *
 * Bridges Discord voice ↔ a configurable voice AI provider for sub-second
 * voice control of any HTTP-accessible service via function calling tools.
 *
 * Supported providers (set in config.json):
 *   "openai-realtime" — Speech-to-speech via OpenAI Realtime API (~500ms)
 *   "elevenlabs"      — ElevenLabs Scribe STT → LLM → ElevenLabs TTS (~1-2s)
 *   "local"           — v2 placeholder (Whisper.cpp + Ollama + Piper)
 *
 * Usage:
 *   node src/index.js [--config path/to/config.json] [--tools path/to/tools.json]
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { DiscordVoice } from './discord-voice.js';
import { createProvider } from './provider.js';
import { loadTools } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Parse CLI flags ──

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

const configPath = getArg('--config') || resolve(ROOT, 'config.json');
const toolsPath  = getArg('--tools')  || resolve(ROOT, 'tools.json');

// ── Load config ──

function loadConfig(path) {
  const absPath = resolve(path);
  if (!existsSync(absPath)) {
    console.warn(`[CONFIG] No config file found at ${absPath}, using defaults.`);
    return {};
  }
  const raw = readFileSync(absPath, 'utf8');
  const config = JSON.parse(raw);
  console.log(`[CONFIG] Loaded from ${absPath}`);
  return config;
}

const appConfig = loadConfig(configPath);

// ── Load tools ──

let realtimeTools = [];
let executeToolFn = null;

if (existsSync(resolve(toolsPath))) {
  const loaded = loadTools(toolsPath);
  realtimeTools = loaded.tools;
  executeToolFn = loaded.executeTool;
} else {
  console.warn(`[TOOLS] No tools file found at ${toolsPath}. Running without function calling.`);
}

// ── Validate environment ──

const DISCORD_TOKEN    = process.env.DISCORD_BOT_TOKEN;
const OPENAI_KEY       = process.env.OPENAI_API_KEY;
const GUILD_ID         = process.env.DISCORD_GUILD_ID;
const VOICE_CHANNEL_ID = process.env.DISCORD_VOICE_CHANNEL_ID;
const LISTEN_USER_ID   = process.env.DISCORD_LISTEN_USER_ID;

if (!DISCORD_TOKEN) {
  console.error('❌ DISCORD_BOT_TOKEN not set. See .env.example');
  process.exit(1);
}
if (!OPENAI_KEY) {
  console.error('❌ OPENAI_API_KEY not set. See .env.example');
  process.exit(1);
}

// ── Merge env overrides into config ──
// CLI env vars take precedence over config.json values.

const mergedConfig = {
  provider:      'openai-realtime',  // default
  ...appConfig,
  model:  process.env.OPENAI_REALTIME_MODEL || appConfig.model || 'gpt-realtime',
  voice:  process.env.OPENAI_VOICE          || appConfig.voice || 'coral',
};

// ── Discord client ──

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const discordVoice = new DiscordVoice();
let provider = null;
let isStreamingResponse = false;

// ── Discord ready ──

discord.once(Events.ClientReady, async (client) => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);
  console.log(`[BOT] Provider: ${mergedConfig.provider} | Voice: ${mergedConfig.voice} | Tools: ${realtimeTools.length}`);

  if (VOICE_CHANNEL_ID && GUILD_ID) {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
      const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
      if (channel?.isVoiceBased()) {
        await startVoiceBridge(channel);
      } else {
        console.error(`❌ Voice channel ${VOICE_CHANNEL_ID} not found in guild ${GUILD_ID}`);
      }
    }
  } else {
    console.log('[BOT] No auto-join configured. Use !join in a text channel while in a voice channel.');
  }
});

// ── Text commands ──

discord.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (message.content === '!join') {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      await message.reply('Join a voice channel first.');
      return;
    }
    await startVoiceBridge(voiceChannel);
    await message.reply(`🎙️ Joined **${voiceChannel.name}**. Voice control active.`);
  }

  if (message.content === '!leave') {
    discordVoice.leave();
    provider?.disconnect();
    provider = null;
    await message.reply('👋 Left voice channel.');
  }

  if (message.content.startsWith('!say ')) {
    const text = message.content.slice(5);
    if (provider) {
      provider.sendText(text);
      await message.reply(`📝 Sent: "${text}"`);
    } else {
      await message.reply('Not connected. Use !join first.');
    }
  }

  if (message.content === '!status') {
    const providerStatus = provider?._connected ? '✅' : '❌';
    const voiceStatus    = discordVoice.connection ? '✅' : '❌';
    await message.reply(
      `**OpenClaw Discord Realtime Voice Bridge**\n` +
      `Discord voice: ${voiceStatus}\n` +
      `Provider: ${mergedConfig.provider} ${providerStatus}\n` +
      `Voice: ${mergedConfig.voice}\n` +
      `Tools: ${realtimeTools.length} loaded\n` +
      `Config: ${configPath}\n` +
      `Tools config: ${toolsPath}`
    );
  }
});

// ── Core: Voice Bridge ──

async function startVoiceBridge(channel) {
  console.log('[BRIDGE] Starting voice bridge...');

  await discordVoice.join(channel);

  provider = createProvider(OPENAI_KEY, mergedConfig, {
    tools: realtimeTools,
    executeTool: executeToolFn,
  });

  // Discord → Provider
  discordVoice.on('audio', (pcmChunk) => {
    provider.sendAudio(pcmChunk);
  });

  // Barge-in: stop current playback when user starts speaking
  provider.on('speech_started', () => {
    if (isStreamingResponse) {
      discordVoice.endPlayback();
      isStreamingResponse = false;
    }
  });

  // Provider → Discord
  provider.on('audio', (pcmChunk) => {
    if (!isStreamingResponse) {
      discordVoice.startPlayback();
      isStreamingResponse = true;
    }
    discordVoice.appendAudio(pcmChunk);
  });

  provider.on('audio_done', () => {
    discordVoice.endPlayback();
    isStreamingResponse = false;
  });

  provider.on('user_transcript', (text) => {
    console.log(`🎤 User: ${text}`);
  });

  provider.on('assistant_transcript', (text) => {
    console.log(`🤖 Assistant: ${text}`);
  });

  provider.on('error', (err) => {
    console.error('[BRIDGE] Provider error:', err.message);
  });

  provider.connect();

  provider.once('ready', () => {
    if (LISTEN_USER_ID) {
      discordVoice.listenTo(LISTEN_USER_ID);
    } else {
      discordVoice.listenToAll();
    }
    console.log(`[BRIDGE] ✅ Voice bridge active (provider: ${mergedConfig.provider}).`);
  });
}

// ── Graceful shutdown ──

process.on('SIGINT', () => {
  console.log('\n[BRIDGE] Shutting down...');
  discordVoice.leave();
  provider?.disconnect();
  discord.destroy();
  process.exit(0);
});

// ── Start ──

console.log('🎙️ OpenClaw Discord Realtime Voice Bridge starting...');
console.log(`   Config:   ${configPath}`);
console.log(`   Tools:    ${toolsPath}`);
console.log(`   Provider: ${mergedConfig.provider}`);
discord.login(DISCORD_TOKEN);
