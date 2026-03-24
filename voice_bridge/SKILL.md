---
name: openclaw-discord-realtime
description: Sub-500ms voice control via Discord voice + OpenAI Realtime API with custom function calling tools
version: 1.0.0
metadata:
  openclaw:
    emoji: "🎙️"
    requires:
      bins:
        - node
      env:
        - OPENAI_API_KEY
        - DISCORD_BOT_TOKEN
---

# openclaw-discord-realtime

Sub-500ms voice control for **anything** via Discord voice channels and OpenAI Realtime API.

Speak into Discord → AI understands + calls your tools → speaks the result back. All in one WebSocket round-trip.

## Quick Start

```bash
# Install
npm install -g openclaw-discord-realtime

# Copy and fill in your secrets
cp .env.example .env

# Run with default config (generic assistant, no tools)
openclaw-discord-realtime

# Run with custom tools
openclaw-discord-realtime --config examples/autom8te/config.json --tools examples/autom8te/tools.json
```

## Configuration

Two files control behaviour:

### config.json

```json
{
  "systemPrompt": "You are a voice assistant. Be concise.",
  "voice": "coral",
  "model": "gpt-realtime",
  "turnDetection": "semantic_vad"
}
```

### tools.json

```json
{
  "tools": [
    {
      "name": "my_tool",
      "description": "What this tool does",
      "endpoint": { "method": "POST", "url": "http://localhost:8000/my_tool" },
      "parameters": {
        "type": "object",
        "properties": {
          "arg1": { "type": "string", "description": "First argument" }
        },
        "required": ["arg1"]
      },
      "defaults": { "arg1": "default_value" }
    }
  ]
}
```

Each tool maps to an HTTP endpoint. The AI calls it, you get the result spoken back.

## Examples

See the `examples/` directory:

- `examples/autom8te/` — Drone swarm control via AutoM8te
- `examples/home-assistant/` — Smart home (lights, thermostat, locks)

## Discord Commands

| Command | Description |
|---------|-------------|
| `!join` | Join your current voice channel |
| `!leave` | Leave voice channel |
| `!say <text>` | Send text to the AI (testing) |
| `!status` | Show connection status |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | ✅ | Discord bot token |
| `OPENAI_API_KEY` | ✅ | OpenAI API key |
| `DISCORD_GUILD_ID` | Optional | Guild to auto-join |
| `DISCORD_VOICE_CHANNEL_ID` | Optional | Voice channel to auto-join |
| `DISCORD_LISTEN_USER_ID` | Optional | Only listen to this user |
| `OPENAI_REALTIME_MODEL` | Optional | Override model from config |
| `OPENAI_VOICE` | Optional | Override voice from config |
