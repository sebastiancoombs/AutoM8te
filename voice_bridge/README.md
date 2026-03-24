# OpenClaw Discord Realtime Voice Bridge

> **Sub-500ms voice control for anything via Discord + OpenAI Realtime API**

Speak into a Discord voice channel → OpenAI processes speech, reasons, calls your tools, and speaks the result back — all in a single WebSocket round-trip. No STT → LLM → TTS pipeline. One hop.

Built as an [OpenClaw](https://openclaw.ai) skill. Available on [ClawHub](https://clawhub.com) as a premium skill.

---

## How It Works

```
You speak in Discord voice
    ↓
Opus decode → PCM 24kHz mono
    ↓
OpenAI Realtime API (WebSocket)
    → Speech recognition
    → Reasoning + function calling
    → Text-to-speech
    ↓
HTTP calls to YOUR endpoints (via tools.json)
    ↓
Response audio → PCM → Opus → Discord voice
```

Target latency: **~300–500ms** from end of speech to start of AI response.

---

## Install

```bash
# Via npm
npm install -g openclaw-discord-realtime

# Or clone
git clone https://github.com/your-org/openclaw-discord-realtime
cd openclaw-discord-realtime
npm install
```

### Via ClawHub (OpenClaw users)

```bash
clawhub install openclaw-discord-realtime
```

> **Note:** This is a premium skill on ClawHub. It requires an active OpenClaw subscription and consumes OpenAI Realtime API credits (approximately $0.06/min of audio).

---

## Quick Start

```bash
# 1. Set up environment
cp .env.example .env
# Edit .env with your DISCORD_BOT_TOKEN and OPENAI_API_KEY

# 2. Run with the generic assistant (no tools)
openclaw-discord-realtime

# 3. Or run with custom tools
openclaw-discord-realtime --config config.json --tools tools.json

# 4. In Discord, go to a voice channel and type:
#   !join
```

---

## Configuration

Two JSON files control the bridge's behaviour. Point to them with CLI flags:

```bash
openclaw-discord-realtime --config path/to/config.json --tools path/to/tools.json
```

### config.json

Controls the AI's personality and audio settings:

```json
{
  "systemPrompt": "You are a voice assistant. Execute commands immediately. Be concise.",
  "voice": "coral",
  "model": "gpt-realtime",
  "turnDetection": "semantic_vad"
}
```

| Field | Description |
|-------|-------------|
| `systemPrompt` | Instructions for the AI |
| `voice` | OpenAI TTS voice (`alloy`, `coral`, `echo`, `fable`, `onyx`, `nova`, `shimmer`) |
| `model` | OpenAI Realtime model |
| `turnDetection` | VAD mode (`semantic_vad` recommended) |

### tools.json

Defines the functions the AI can call:

```json
{
  "tools": [
    {
      "name": "my_action",
      "description": "What this action does — the AI reads this to decide when to call it",
      "endpoint": {
        "method": "POST",
        "url": "http://localhost:8000/my_action"
      },
      "parameters": {
        "type": "object",
        "properties": {
          "item": { "type": "string", "description": "The item to act on" }
        },
        "required": ["item"]
      },
      "defaults": { "item": "default" }
    }
  ]
}
```

Each tool maps to any HTTP endpoint — your own service, Home Assistant, a local FastAPI server, anything.

---

## Examples

### AutoM8te — Drone Swarm Control

Control an ArduPilot drone swarm via voice:

```bash
openclaw-discord-realtime \
  --config examples/autom8te/config.json \
  --tools examples/autom8te/tools.json
```

System prompt: Military copilot persona, crisp and direct.

Tools: `drone_takeoff`, `drone_land`, `drone_goto`, `drone_formation`, `drone_broadcast`, `drone_orbit`, `drone_search`, `drone_velocity`, `drone_return_home`, `drone_query`, `list_drones`

> "Take drone 1 to 50 meters" → `drone_takeoff(drone_1, 50)` → "Drone 1 climbing to 50 meters."

> "V formation, 10 meters spacing" → `drone_formation(v, 10)` → "All drones moving to V formation."

### Home Assistant — Smart Home

Control lights, thermostat, and doors:

```bash
openclaw-discord-realtime \
  --config examples/home-assistant/config.json \
  --tools examples/home-assistant/tools.json
```

Tools: `turn_light_on`, `turn_light_off`, `set_thermostat`, `get_thermostat`, `lock_door`

> "Turn off the living room lights" → `turn_light_off(living_room)` → "Living room lights off."

> "Set temperature to 21 degrees" → `set_thermostat(21)` → "Thermostat set to 21°C."

---

## Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application → Bot → Enable **Message Content Intent** and **Server Members Intent** and **Voice States**
3. Generate a bot token → add to `.env`
4. Invite the bot with scopes: `bot` + permissions: `Connect`, `Speak`, `Use Voice Activity`, `Read Messages`, `Send Messages`

---

## Discord Commands

| Command | Description |
|---------|-------------|
| `!join` | Bot joins your current voice channel |
| `!leave` | Bot leaves voice channel |
| `!say <text>` | Send text to AI (useful for testing without speaking) |
| `!status` | Show connection status, model, voice, tools count |

---

## Environment Variables

```bash
# Required
DISCORD_BOT_TOKEN=your_discord_bot_token
OPENAI_API_KEY=your_openai_api_key

# Optional: auto-join on startup
DISCORD_GUILD_ID=your_guild_id
DISCORD_VOICE_CHANNEL_ID=voice_channel_id

# Optional: listen only to one user
DISCORD_LISTEN_USER_ID=discord_user_id

# Optional: override config.json values
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_VOICE=coral
```

---

## Pricing Note

This skill uses the **OpenAI Realtime API**, which is billed by audio duration:
- Input audio: ~$0.06/min
- Output audio: ~$0.24/min

Typical voice command: ~2–5 seconds in, ~1–3 seconds out = **~$0.01–0.03 per interaction**.

The skill itself is available as a **premium ClawHub skill** — a one-time purchase that includes lifetime updates and examples.

---

## Architecture Notes

- **Single WebSocket** to OpenAI — no separate STT or TTS APIs
- **Semantic VAD** for natural turn detection (no push-to-talk)
- **Barge-in support** — speaking interrupts the AI's current response
- **Streaming audio** — response starts playing before the AI finishes generating
- Tools are **pure HTTP** — works with any backend that has a REST API

---

## License

MIT
