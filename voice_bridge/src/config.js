/**
 * AutoM8te Voice Bridge — Configuration
 * Loads from .env and provides defaults.
 */

import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '..', '.env') });

export const config = {
  discord: {
    token: process.env.DISCORD_BOT_TOKEN,
    guildId: process.env.DISCORD_GUILD_ID || '',
    voiceChannelId: process.env.DISCORD_VOICE_CHANNEL_ID || '',
    allowedUsers: process.env.ALLOWED_USERS
      ? process.env.ALLOWED_USERS.split(',').map(s => s.trim())
      : [],
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.REALTIME_MODEL || 'gpt-realtime',
    voice: process.env.REALTIME_VOICE || 'coral',
    wsUrl: `wss://api.openai.com/v1/realtime?model=${process.env.REALTIME_MODEL || 'gpt-realtime'}`,
  },
  swarmManager: {
    url: process.env.SWARM_MANAGER_URL || 'http://localhost:8000',
  },
  debug: process.env.DEBUG === 'true',
};

// Validation
const missing = [];
if (!config.discord.token) missing.push('DISCORD_BOT_TOKEN');
if (!config.openai.apiKey) missing.push('OPENAI_API_KEY');
if (missing.length) {
  console.error(`❌ Missing required env vars: ${missing.join(', ')}`);
  console.error('   Copy .env.example to .env and fill in the values.');
  process.exit(1);
}
