#!/usr/bin/env node
/**
 * AutoM8te Voice Bridge
 * 
 * Connects Discord voice chat to OpenAI's Realtime API with drone control tools.
 * 
 * Architecture:
 *   Discord Voice Channel
 *     → User speaks (Opus 48kHz)
 *     → Decode to PCM, downsample to 24kHz
 *     → Stream to OpenAI Realtime API WebSocket
 *     → Realtime API processes speech + generates response
 *     → If function call: execute via intent layer HTTP API
 *     → Response audio (PCM 24kHz) → upsample to 48kHz → Opus → Discord
 *     → User hears response in ~500ms
 * 
 * Usage:
 *   DISCORD_BOT_TOKEN=xxx OPENAI_API_KEY=xxx node index.js
 *   
 *   Optional env vars:
 *     DISCORD_GUILD_ID        - Target guild (auto-discovers if not set)
 *     DISCORD_VOICE_CHANNEL_ID - Target channel (auto-discovers if not set)
 *     DISCORD_ALLOWED_USERS   - Comma-separated user IDs to listen to
 *     OPENAI_REALTIME_MODEL   - Model name (default: gpt-4o-realtime-preview)
 *     OPENAI_VOICE            - Voice (default: ash)
 *     AUTOM8TE_URL            - Intent layer URL (default: http://localhost:8080)
 *     DEBUG                   - Enable verbose logging
 */

import { config, validateConfig } from './config.js';
import { DiscordVoiceClient } from './discord.js';
import { RealtimeClient } from './realtime.js';

// --- Startup ---
console.log('╔══════════════════════════════════════════════╗');
console.log('║   AutoM8te Voice Bridge v1.0                ║');
console.log('║   Discord Voice → OpenAI Realtime → Drones  ║');
console.log('╚══════════════════════════════════════════════╝');
console.log();

validateConfig();

const discord = new DiscordVoiceClient();
const realtime = new RealtimeClient();

// Collect audio response chunks for playback
let audioResponseBuffer = [];

// --- Wire Discord audio → Realtime API ---
discord.on('audio_data', (base64Audio) => {
  realtime.sendAudio(base64Audio);
});

// --- Wire Realtime API audio → Discord ---
realtime.on('audio_delta', (pcmChunk) => {
  // Stream audio chunks directly for low latency
  discord.playAudio(pcmChunk);
});

realtime.on('audio_done', () => {
  // Audio response complete
});

// --- Logging ---
realtime.on('speech_started', () => {
  console.log('[Bridge] 🎤 User speaking...');
});

realtime.on('speech_stopped', () => {
  console.log('[Bridge] 🎤 User stopped speaking');
});

realtime.on('user_transcript', (text) => {
  console.log(`[Bridge] 👤 User: "${text}"`);
});

realtime.on('response_transcript', (text) => {
  console.log(`[Bridge] 🚁 AutoM8te: "${text}"`);
});

realtime.on('error', (error) => {
  console.error('[Bridge] ❌ Realtime error:', error);
});

realtime.on('disconnected', async ({ code, reason }) => {
  console.log(`[Bridge] Realtime disconnected (${code}). Reconnecting in 3s...`);
  await sleep(3000);
  try {
    await realtime.connect();
    console.log('[Bridge] Reconnected to Realtime API');
  } catch (err) {
    console.error('[Bridge] Reconnection failed:', err.message);
  }
});

discord.on('disconnected', () => {
  console.log('[Bridge] Discord voice disconnected');
});

// --- Text command mode (for testing without voice) ---
if (process.argv.includes('--text')) {
  console.log('[Bridge] Text mode enabled. Type commands:');
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  await realtime.connect();
  
  rl.on('line', (line) => {
    if (line.trim()) {
      console.log(`[Bridge] Sending: "${line}"`);
      realtime.sendText(line.trim());
    }
  });
  
  rl.on('close', () => {
    realtime.disconnect();
    process.exit(0);
  });
} else {
  // --- Full voice mode ---
  try {
    // Connect to OpenAI Realtime first
    console.log('[Bridge] Connecting to OpenAI Realtime API...');
    await realtime.connect();

    // Then connect to Discord
    console.log('[Bridge] Connecting to Discord...');
    await discord.connect();

    console.log();
    console.log('[Bridge] ✅ Voice bridge is LIVE!');
    console.log('[Bridge] Speak in the Discord voice channel to control drones.');
    console.log('[Bridge] Say "take off" to start!');
    console.log();
  } catch (err) {
    console.error('[Bridge] Fatal startup error:', err.message);
    process.exit(1);
  }
}

// --- Graceful shutdown ---
process.on('SIGINT', () => {
  console.log('\n[Bridge] Shutting down...');
  realtime.disconnect();
  discord.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  realtime.disconnect();
  discord.disconnect();
  process.exit(0);
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
