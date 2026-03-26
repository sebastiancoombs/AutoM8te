# AutoM8te Voice Bridge

Real-time voice control for the AutoM8te drone swarm via Discord + OpenAI Realtime API.

**Target latency: <500ms from "take off" to hearing "lifting off to 10 meters."**

## Architecture

```
Discord Voice Channel (user speaks)
  → Opus decode → PCM 48kHz stereo → downsample → PCM 24kHz mono
  → OpenAI Realtime API WebSocket (gpt-realtime, GA endpoint)
  → Speech-to-speech + function calling in ONE pass (~300ms)
  → When model calls a drone tool:
      → HTTP to Swarm Manager consolidated /api/* endpoints
      → Result sent back to Realtime API
      → Model speaks the result
  → For complex requests: ask_openclaw → OpenClaw Gateway → Claude Opus
  → Response audio → PCM 24kHz mono → upsample → PCM 48kHz stereo
  → Opus encode → Discord voice playback
```

## Tools (9 total)

| Tool | Swarm Manager Endpoint | Description |
|------|----------------------|-------------|
| `drone_command` | POST /api/command | Single-drone commands (takeoff, land, hover, etc.) |
| `drone_move` | POST /api/move | Move drone: goto, named paths, custom waypoints |
| `drone_query` | POST /api/query | Telemetry for one or all drones |
| `drone_swarm` | POST /api/swarm | Fan commands to all/subset of drones |
| `drone_formation` | POST /api/formation | Formations + animated transitions |
| `drone_search` | POST /api/search | Area search patterns (grid, spiral, expanding) |
| `drone_stop` | POST /api/stop | Stop paths, transitions, or everything |
| `drone_status` | GET /api/status | Full system status |
| `ask_openclaw` | OpenClaw Gateway | Escape hatch to full AI agent (Claude Opus) |

## Prerequisites

- Node.js 20+
- OpenAI API key with Realtime API access
- Discord bot token (with Voice intents)
- AutoM8te Swarm Manager running on localhost:8000
- SITL drones registered

## Setup

```bash
cd voice_bridge
cp .env.example .env
# Edit .env with your API keys

npm install
npm start
```

## Discord Bot Setup

The voice bridge needs a Discord bot with these intents:
- **Message Content Intent** (for !commands)
- **Voice** permissions (connect, speak)

Options:
1. Create a **dedicated voice bot** named "AutoM8te Voice" (recommended)
2. Use the **same bot token as OpenClaw** (only if OpenClaw isn't using voice)

## Usage

### Text Commands

| Command | Description |
|---------|-------------|
| `!join` | Join your current voice channel |
| `!leave` | Leave voice channel |
| `!status` | Show bridge status |
| `!text <msg>` | Send text command to Realtime model |

### Voice Commands

Speak naturally in the voice channel:

- **"Take off"** → drone_1 takes off to 10m
- **"Drone 3, take off to 20 meters"** → drone_3 takes off to 20m
- **"All drones, take off"** → broadcast takeoff
- **"V formation"** → all drones form a V
- **"Land"** → drone_1 lands
- **"Status"** → telemetry readback
- **"Fly a spiral"** → drone_1 flies a spiral path
- **"Transition to circle formation"** → animated formation change
- **"Come home"** → return to launch
- **"Emergency stop"** → kills motors
- **"What's the best search pattern for this area?"** → ask_openclaw for complex reasoning

### Barge-in

Start speaking while the model is responding — it stops immediately and listens.

## Audio Pipeline

```
Discord → Opus → PCM 48kHz/stereo → DownsampleTransform → PCM 24kHz/mono → Realtime API
Realtime API → PCM 24kHz/mono → UpsampleTransform → PCM 48kHz/stereo → Opus → Discord
```

## Costs

| Component | Cost |
|-----------|------|
| OpenAI Realtime (audio input) | ~$0.06/min |
| OpenAI Realtime (audio output) | ~$0.24/min |
| **Total** | **~$0.30/min** |

## Files

```
voice_bridge/
├── package.json
├── .env.example
├── .env
├── tools.json          # Tool reference documentation
├── README.md
└── src/
    ├── index.js              # Discord bot + command handler
    ├── config.js             # Configuration loader
    ├── realtime-session.js   # OpenAI Realtime API WebSocket client (GA format)
    ├── discord-voice.js      # Discord voice capture + playback + resampling
    ├── drone-tools.js        # 9 tools + consolidated API executor + ask_openclaw
    └── system-prompt.js      # Voice commander personality
```
