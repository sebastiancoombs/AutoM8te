#!/usr/bin/env node
/**
 * Multi-command test: sends several commands sequentially to validate
 * the Realtime API handles different drone tools correctly.
 */

import WebSocket from 'ws';
import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '.env') });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.REALTIME_MODEL || 'gpt-realtime-1.5';
const VOICE = process.env.REALTIME_VOICE || 'coral';
const WS_URL = `wss://api.openai.com/v1/realtime?model=${MODEL}`;

const DRONE_TOOLS = [
  {
    type: 'function', name: 'drone_command',
    description: 'Execute a single-drone command. Actions: takeoff, land, hover, return_home, emergency_stop. Always include params with relevant values (e.g. altitude_m for takeoff).',
    parameters: { type: 'object', properties: {
      drone_id: { type: 'string' }, action: { type: 'string' },
      params: { type: 'object', description: 'e.g. {altitude_m: 10} for takeoff' }
    }, required: ['drone_id', 'action'] },
  },
  {
    type: 'function', name: 'drone_swarm',
    description: 'Fan a command to ALL drones. Actions: takeoff, land, return_home, hover, emergency_stop.',
    parameters: { type: 'object', properties: {
      action: { type: 'string' }, params: { type: 'object' },
      drone_ids: { type: 'array', items: { type: 'string' } }
    }, required: ['action'] },
  },
  {
    type: 'function', name: 'drone_formation',
    description: 'Arrange drones into formation: line, v, circle, grid, square.',
    parameters: { type: 'object', properties: {
      name: { type: 'string' }, spacing_m: { type: 'number' }, alt_m: { type: 'number' }
    } },
  },
  {
    type: 'function', name: 'drone_query',
    description: 'Get telemetry for one or all drones.',
    parameters: { type: 'object', properties: { drone_id: { type: 'string' } } },
  },
];

const SYSTEM_PROMPT = `You are AutoM8te, an AI drone swarm commander. Execute commands immediately. Be concise (1-2 sentences max). Default drone: drone_1. Default takeoff altitude: 10 meters. When the user says "all drones", use drone_swarm. Always include altitude_m in takeoff params.`;

const COMMANDS = [
  { text: 'Take off to 15 meters', expectTool: 'drone_command' },
  { text: 'All drones take off', expectTool: 'drone_swarm' },
  { text: 'V formation 8 meters apart', expectTool: 'drone_formation' },
  { text: 'Status report', expectTool: 'drone_query' },
];

const MOCK_RESULTS = {
  drone_command: { status: 'success', drone_id: 'drone_1', action: 'takeoff', altitude_m: 15 },
  drone_swarm: { status: 'success', action: 'takeoff', drones: ['drone_1','drone_2','drone_3','drone_4','drone_5'] },
  drone_formation: { status: 'success', formation: 'v', spacing_m: 8 },
  drone_query: { drones: [
    { id: 'drone_1', alt_m: 15, battery: 92, mode: 'GUIDED', heading: 0 },
    { id: 'drone_2', alt_m: 10, battery: 88, mode: 'GUIDED', heading: 45 },
  ]},
};

let commandIdx = 0;
let commandSentTime = 0;
let sessionReady = false;

console.log(`\n🧪 Multi-command test (${COMMANDS.length} commands)\n`);

const ws = new WebSocket(WS_URL, { headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` } });
const timeout = setTimeout(() => { console.error('⏰ Timeout'); ws.close(); process.exit(1); }, 60000);

ws.on('open', () => console.log('✅ Connected'));

ws.on('message', (rawData) => {
  const event = JSON.parse(rawData.toString());

  switch (event.type) {
    case 'session.created':
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime', model: MODEL, instructions: SYSTEM_PROMPT,
          output_modalities: ['audio'],
          audio: {
            input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'semantic_vad' } },
            output: { format: { type: 'audio/pcm', rate: 24000 }, voice: VOICE },
          },
          tools: DRONE_TOOLS,
        },
      }));
      break;

    case 'session.updated':
      sessionReady = true;
      sendNextCommand();
      break;

    case 'response.function_call_arguments.done': {
      const latency = Date.now() - commandSentTime;
      const cmd = COMMANDS[commandIdx];
      const match = event.name === cmd.expectTool ? '✅' : '⚠️';
      console.log(`${match} "${cmd.text}" → ${event.name}(${event.arguments}) [${latency}ms]`);

      // Send mock result
      ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: event.call_id, output: JSON.stringify(MOCK_RESULTS[event.name] || { status: 'ok' }) },
      }));
      ws.send(JSON.stringify({ type: 'response.create' }));
      break;
    }

    case 'response.output_audio_transcript.done':
    case 'response.audio_transcript.done':
      if (event.transcript) console.log(`   🗣  "${event.transcript}"`);
      break;

    case 'response.done':
      if (event.response?.output?.some(o => o.type === 'function_call')) break; // function call response, wait for audio
      commandIdx++;
      if (commandIdx < COMMANDS.length) {
        setTimeout(sendNextCommand, 500);
      } else {
        console.log(`\n🎉 All ${COMMANDS.length} commands tested!`);
        clearTimeout(timeout);
        ws.close();
      }
      break;

    case 'error':
      console.error(`❌ Error: ${JSON.stringify(event.error)}`);
      break;
  }
});

function sendNextCommand() {
  const cmd = COMMANDS[commandIdx];
  console.log(`\n📤 [${commandIdx + 1}/${COMMANDS.length}] "${cmd.text}"`);
  commandSentTime = Date.now();
  ws.send(JSON.stringify({
    type: 'conversation.item.create',
    item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: cmd.text }] },
  }));
  ws.send(JSON.stringify({ type: 'response.create' }));
}
