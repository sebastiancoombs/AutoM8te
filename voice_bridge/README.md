# AutoM8te Voice Bridge

Real-time voice control for the AutoM8te drone swarm via Discord + OpenAI Realtime API.

**Target latency: <500ms from "take off" to hearing "lifting off to 10 meters."**

## Architecture

```
Discord Voice Channel (user speaks)
  → Opus decode → PCM 48kHz stereo → downsample → PCM 24kHz mono
  → OpenAI Realtime API WebSocket (gpt-realtime)
  → Speech-to-speech + function calling in ONE pass (~300ms)
  → When model calls a drone tool:
      → HTTP POST to Swarm Manager (localhost:8000)
      → Result sent back to Realtime API
      → Model speaks the result
  → Response audio → PCM 24kHz mono → upsample → PCM 48kHz stereo
  → Opus encode → Discord voice playback
```

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
- **Server Members Intent** (optional, for user identification)
- **Message Content Intent** (for !commands)
- **Voice** permissions

You can either:
1. Create a **new bot** dedicated to voice control
2. Use the **same bot token as OpenClaw** (both services can share a token if only one connects at a time)

### Option 2: Sharing OpenClaw's Bot Token

If you want the voice bridge to use the same Discord bot as OpenClaw, you'll need to stop OpenClaw's Discord connection while the voice bridge is running, or use a separate bot.

**Recommended: Create a dedicated voice bot** with the name "AutoM8te Voice" for clarity.

## Usage

### Text Commands (in any Discord text channel)

| Command | Description |
|---------|-------------|
| `!join` | Join your current voice channel |
| `!leave` | Leave voice channel |
| `!status` | Show bridge status (voice, Realtime API, swarm) |
| `!text <msg>` | Send a text command to the Realtime model |

### Voice Commands (in voice channel)

Just speak naturally:

- **"Take off"** → drone_1 takes off to 10m
- **"Drone 3, take off to 20 meters"** → drone_3 takes off to 20m
- **"All drones, take off"** → broadcast takeoff
- **"V formation"** → all drones form a V
- **"Land"** → drone_1 lands
- **"Status"** → telemetry readback
- **"Orbit"** → drone_1 orbits
- **"Emergency stop"** → kills motors
- **"Come home"** → return to launch

### Barge-in

Start speaking while the model is responding — it will stop immediately and listen to you. Just like a real copilot.

## Configuration

See `.env.example` for all configuration options.

### Audio Pipeline

```
Discord → Opus → PCM 48kHz/stereo → DownsampleTransform → PCM 24kHz/mono → Realtime API
Realtime API → PCM 24kHz/mono → UpsampleTransform → PCM 48kHz/stereo → Opus → Discord
```

### Costs

| Component | Cost |
|-----------|------|
| OpenAI Realtime (audio input) | ~$0.06/min |
| OpenAI Realtime (audio output) | ~$0.24/min |
| **Total** | **~$0.30/min** |

For a typical 5-minute drone control session: ~$1.50

## Files

```
voice_bridge/
├── package.json
├── .env.example
├── README.md
└── src/
    ├── index.js              # Main entry point + Discord bot
    ├── config.js             # Configuration loader
    ├── realtime-session.js   # OpenAI Realtime API WebSocket client
    ├── discord-voice.js      # Discord voice capture + playback
    ├── drone-tools.js        # Tool definitions + Swarm Manager HTTP executor
    └── system-prompt.js      # Voice commander personality
```
