# AutoM8te Voice Bridge

Real-time voice control for drone swarms. Speak → drones fly. Sub-500ms latency.

## Architecture

```
Discord Voice Channel (you speak)
  → Opus 48kHz → PCM → downsample to 24kHz mono
  → OpenAI Realtime API (gpt-4o-realtime-preview)
  → Speech-to-speech: STT + reasoning + TTS in ONE pass (~300ms)
  → Function calls → AutoM8te Intent Layer (localhost:8080)
  → Response audio → upsample to 48kHz → Opus → Discord
  → You hear the response
```

## Quick Start

```bash
# Install dependencies
npm install

# Set environment variables
export DISCORD_BOT_TOKEN="your-discord-bot-token"
export OPENAI_API_KEY="your-openai-api-key"

# Optional: specify channel (auto-discovers by default)
export DISCORD_GUILD_ID="your-guild-id"
export DISCORD_VOICE_CHANNEL_ID="your-channel-id"

# Start the bridge
npm start
```

## Text Mode (Testing)

Test without Discord voice — sends text to Realtime API:

```bash
node index.js --text
# Then type: take off
# AutoM8te will respond with audio (logged as text)
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_BOT_TOKEN` | ✅ | - | Discord bot token |
| `OPENAI_API_KEY` | ✅ | - | OpenAI API key with Realtime access |
| `DISCORD_GUILD_ID` | ❌ | auto | Target Discord guild |
| `DISCORD_VOICE_CHANNEL_ID` | ❌ | auto | Target voice channel |
| `DISCORD_ALLOWED_USERS` | ❌ | all | Comma-separated user IDs |
| `OPENAI_REALTIME_MODEL` | ❌ | `gpt-4o-realtime-preview` | Realtime model |
| `OPENAI_VOICE` | ❌ | `ash` | Voice: alloy, ash, ballad, coral, echo, sage, shimmer, verse |
| `AUTOM8TE_URL` | ❌ | `http://localhost:8080` | Intent layer URL |
| `DEBUG` | ❌ | false | Verbose event logging |

## Voice Commands

| Say This | AutoM8te Does |
|----------|---------------|
| "Take off" | All drones take off to 10m |
| "Take off drone 1 to 20 meters" | drone_0 takes off to 20m |
| "Land" | All drones land |
| "V formation" | Arrange in V shape |
| "Circle formation, 10 meter spacing" | Circle with 10m spacing |
| "Move north 50 meters" | All drones move north 50m |
| "Spiral search" | Execute spiral search pattern |
| "Status" | Report all drone telemetry |
| "Emergency stop" | Kill all motors NOW |
| "Return home" | RTL all drones |
| "Assign drone 1 and 2 to alpha team" | Create group |

## Requirements

- Node.js 18+
- Discord bot with Voice permissions
- OpenAI API key with Realtime API access
- AutoM8te intent layer running on localhost:8080
- `@discordjs/opus` native addon (or `opusscript` fallback)
- `sodium-native` for Discord voice encryption

## Discord Bot Setup

1. Create bot at https://discord.com/developers/applications
2. Enable these intents: Server Members, Message Content
3. Bot permissions: Connect, Speak, Use Voice Activity
4. Invite to your server with the OAuth2 URL generator

## Sharing OpenClaw's Bot Token

If you want to use the same Discord bot as OpenClaw (not recommended for production):
- The bot can only be in one voice channel per guild
- OpenClaw handles text, voice bridge handles voice
- Use `DISCORD_BOT_TOKEN` from OpenClaw's config

For production: create a separate Discord bot for voice.

## Cost

~$0.30/min of voice interaction ($0.06 input + $0.24 output per minute).
A typical 30-second command costs ~$0.15.
