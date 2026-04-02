/**
 * AutoM8te Voice Bridge — Configuration
 * 
 * All config via environment variables with sensible defaults.
 */

export const config = {
  // Discord
  discord: {
    token: process.env.DISCORD_BOT_TOKEN || '',
    guildId: process.env.DISCORD_GUILD_ID || '',
    channelId: process.env.DISCORD_VOICE_CHANNEL_ID || '',
    // Only listen to these user IDs (empty = listen to all)
    allowedUsers: process.env.DISCORD_ALLOWED_USERS
      ? process.env.DISCORD_ALLOWED_USERS.split(',')
      : [],
  },

  // OpenAI Realtime
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview',
    voice: process.env.OPENAI_VOICE || 'ash',
  },

  // AutoM8te Intent Layer
  intentLayer: {
    url: process.env.AUTOM8TE_URL || 'http://localhost:8080',
  },

  // Audio settings
  audio: {
    // Discord sends Opus at 48kHz stereo
    // OpenAI Realtime expects PCM 16-bit mono at 24kHz
    discordSampleRate: 48000,
    realtimeSampleRate: 24000,
    channels: 1,
  },
};

export function validateConfig() {
  const missing = [];
  if (!config.discord.token) missing.push('DISCORD_BOT_TOKEN');
  if (!config.openai.apiKey) missing.push('OPENAI_API_KEY');
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}
