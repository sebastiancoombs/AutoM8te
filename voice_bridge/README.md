# AutoM8te Voice Bridge

Sub-500ms voice-controlled drone swarm via Discord voice + OpenAI Realtime API.

## Architecture

```
Discord Voice Channel (user speaks)
  → Opus decode → PCM 24kHz mono
  → OpenAI Realtime API (gpt-realtime)
  → STT + reasoning + function calling + TTS in ONE pass (~300ms)
  → Function calls → HTTP POST to Swarm Manager (localhost:8000)
  → Audio response → PCM → Opus → Discord voice
```

**Target:** "Take off" → hear "Taking off to 10 meters" in ~500ms → drone flies.

## Setup

### Prerequisites
- Node.js 20+
- Discord bot with voice permissions
- OpenAI API key with Realtime API access
- Swarm Manager running on localhost:8000

### Install

```bash
cd voice_bridge
cp .env.example .env
# Edit .env with your tokens
npm install
```

### Discord Bot Permissions

The bot needs these intents enabled in the Discord Developer Portal:
- Server Members Intent
- Message Content Intent
- Voice (connect, speak, use VAD)

Required OAuth2 scopes: `bot`, `applications.commands`
Bot permissions: `Connect`, `Speak`, `Use Voice Activity`, `Send Messages`, `Read Message History`

### Run

```bash
# Start Swarm Manager first
cd .. && python -m swarm_manager.server

# Then start voice bridge
cd voice_bridge && npm start
```

## Usage

### Commands
- `!join` — Join your current voice channel
- `!leave` — Leave voice channel  
- `!say <text>` — Send text command (for testing without mic)
- `!status` — Show connection status

### Voice Commands
Just speak naturally while in the voice channel:

| Say this | What happens |
|----------|-------------|
| "Take off" | drone_1 takes off to 10m |
| "Drone 3 take off to 20 meters" | drone_3 takes off to 20m |
| "V formation" | All drones form V pattern |
| "Land all drones" | Broadcasts land command |
| "What's the status?" | Reads back telemetry |
| "Return home" | drone_1 RTL |

## Drone Tools

The bridge registers these tools with the Realtime API:

| Tool | Endpoint | Description |
|------|----------|-------------|
| `drone_takeoff` | POST /tools/drone_takeoff | Take off to altitude |
| `drone_land` | POST /tools/drone_land | Land at current position |
| `drone_query` | POST /tools/drone_query | Get telemetry |
| `drone_return_home` | POST /tools/drone_return_home | RTL |
| `drone_formation` | POST /tools/drone_formation | Set formation |
| `drone_goto` | POST /tools/drone_goto | Fly to GPS coords |
| `drone_velocity` | POST /tools/drone_velocity | Set velocity vector |
| `drone_broadcast` | POST /tools/drone_broadcast | Command all drones |
| `drone_orbit` | POST /tools/drone_orbit | Orbit a point |
| `drone_search` | POST /tools/drone_search | Search an area |
| `list_drones` | GET /drones | List all drones |

## Configuration

See `.env.example` for all options. Key settings:

- `OPENAI_REALTIME_MODEL` — Default: `gpt-realtime`
- `OPENAI_VOICE` — Voice for TTS. Options: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar
- `DISCORD_LISTEN_USER_ID` — Only listen to one user (optional, listens to all by default)

## Cost

Per OpenAI Realtime API pricing:
- Audio input: ~$0.06/min
- Audio output: ~$0.24/min
- Total: ~$0.30/min of active conversation

## Discord Bot Token

**Option A: Separate bot** (recommended)
Create a new bot in Discord Developer Portal for the voice bridge.

**Option B: Share OpenClaw's bot**
If your OpenClaw instance uses a Discord bot, you MAY be able to share the token.
However, only one connection per bot can be in a voice channel at a time.
A separate bot avoids conflicts.

## File Structure

```
voice_bridge/
├── .env.example          # Configuration template
├── package.json          # Dependencies
├── README.md             # This file
└── src/
    ├── index.js          # Entry point + Discord bot + bridge orchestration
    ├── realtime-client.js # OpenAI Realtime API WebSocket client
    ├── discord-voice.js  # Discord voice channel audio I/O
    ├── audio-pipeline.js # Opus ↔ PCM format conversion
    └── drone-tools.js    # Tool definitions + HTTP execution
```
