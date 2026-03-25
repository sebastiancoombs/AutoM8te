/**
 * AutoM8te Voice Bridge — Main Entry Point
 *
 * Discord voice channel ↔ OpenAI Realtime API ↔ Swarm Manager
 *
 * Architecture:
 *   User speaks in Discord → Opus decode → PCM 24kHz → Realtime API WebSocket
 *   Realtime API responds with audio + function calls
 *   Function calls → HTTP to Swarm Manager → result back to Realtime API
 *   Response audio → PCM → Opus encode → Discord voice playback
 *
 * Usage:
 *   node src/index.js
 *
 * Commands in Discord text chat:
 *   !join           - Join your current voice channel
 *   !leave          - Leave voice channel
 *   !status         - Show bridge status
 *   !text <message> - Send a text command to the Realtime model
 */

import { Client, GatewayIntentBits, Events } from 'discord.js';
import { config } from './config.js';
import { RealtimeSession } from './realtime-session.js';
import { DiscordVoiceHandler } from './discord-voice.js';

// ── Discord Client Setup ───────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let voiceHandler = null;
let realtimeSession = null;

// ── Startup ────────────────────────────────────────────────

client.once(Events.ClientReady, async (c) => {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  🚁 AutoM8te Voice Bridge');
  console.log('  Discord ↔ OpenAI Realtime ↔ Drone Swarm');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Bot: ${c.user.tag}`);
  console.log(`  Swarm Manager: ${config.swarmManager.url}`);
  console.log(`  Realtime Model: ${config.openai.model}`);
  console.log(`  Voice: ${config.openai.voice}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('Commands: !join, !leave, !status, !text <msg>');
  console.log('');

  // Initialize components
  voiceHandler = new DiscordVoiceHandler(client);
  realtimeSession = new RealtimeSession();
  voiceHandler.setRealtimeSession(realtimeSession);

  // Realtime session event logging
  realtimeSession.on('transcript', (text) => {
    // Could optionally send transcripts to a text channel
  });

  realtimeSession.on('user_transcript', (text) => {
    // Could optionally log user speech to a text channel
  });

  realtimeSession.on('api_error', (error) => {
    console.error('🚨 Realtime API error:', error);
  });

  // Auto-join if configured
  if (config.discord.guildId && config.discord.voiceChannelId) {
    console.log('🔄 Auto-joining configured voice channel...');
    try {
      const guild = client.guilds.cache.get(config.discord.guildId);
      if (guild) {
        await voiceHandler.join(
          config.discord.voiceChannelId,
          config.discord.guildId,
          guild.voiceAdapterCreator,
        );
        voiceHandler.subscribeToAll();
        realtimeSession.connect();
        console.log('✅ Auto-joined and connected!');
      } else {
        console.warn('⚠️  Guild not found for auto-join. Use !join in a text channel.');
      }
    } catch (err) {
      console.error('❌ Auto-join failed:', err.message);
    }
  }
});

// ── Message Handler (text commands) ────────────────────────

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();

  // !join — join the user's current voice channel
  if (content === '!join') {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply('❌ You need to be in a voice channel first!');
    }

    try {
      await voiceHandler.join(
        voiceChannel.id,
        voiceChannel.guild.id,
        voiceChannel.guild.voiceAdapterCreator,
      );
      voiceHandler.subscribeToAll();

      // Connect to Realtime API
      realtimeSession.connect();

      await message.reply(`✅ Joined **${voiceChannel.name}**. Realtime voice control active. 🚁`);
    } catch (err) {
      await message.reply(`❌ Failed to join: ${err.message}`);
    }
  }

  // !leave — leave voice channel
  else if (content === '!leave') {
    voiceHandler.leave();
    realtimeSession.disconnect();
    await message.reply('👋 Left voice channel. Voice bridge disconnected.');
  }

  // !status — show bridge status
  else if (content === '!status') {
    const voiceConnected = voiceHandler?.connection != null;
    const realtimeConnected = realtimeSession?.connected ?? false;

    // Check swarm manager
    let swarmStatus = '❌ Offline';
    try {
      const resp = await fetch(`${config.swarmManager.url}/drones`);
      if (resp.ok) {
        const data = await resp.json();
        swarmStatus = `✅ Online — ${data.count} drones`;
      }
    } catch {
      swarmStatus = '❌ Unreachable';
    }

    const statusLines = [
      '**AutoM8te Voice Bridge Status**',
      `🎙  Voice: ${voiceConnected ? '✅ Connected' : '❌ Disconnected'}`,
      `🤖 Realtime API: ${realtimeConnected ? '✅ Connected' : '❌ Disconnected'}`,
      `🚁 Swarm Manager: ${swarmStatus}`,
      `🔊 Model: ${config.openai.model} / Voice: ${config.openai.voice}`,
    ];

    await message.reply(statusLines.join('\n'));
  }

  // !text <message> — send text command to Realtime model
  else if (content.startsWith('!text ')) {
    const text = content.slice(6).trim();
    if (!text) return message.reply('Usage: `!text <message>`');
    if (!realtimeSession?.connected) {
      return message.reply('❌ Realtime API not connected. Use `!join` first.');
    }

    realtimeSession.sendText(text);
    await message.reply(`📤 Sent to Realtime model: "${text}"`);
  }
});

// ── Error Handling ─────────────────────────────────────────

client.on('error', (err) => {
  console.error('Discord client error:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  voiceHandler?.leave();
  realtimeSession?.disconnect();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  voiceHandler?.leave();
  realtimeSession?.disconnect();
  client.destroy();
  process.exit(0);
});

// ── Login ──────────────────────────────────────────────────

console.log('🔑 Logging into Discord...');
client.login(config.discord.token);
