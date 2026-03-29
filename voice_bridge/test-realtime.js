#!/usr/bin/env node
/**
 * AutoM8te Voice Bridge — Realtime API Connection Test
 *
 * Tests the OpenAI Realtime API WebSocket connection, session config,
 * text-mode function calling, and audio output — all WITHOUT Discord.
 *
 * Usage: node test-realtime.js
 */

import WebSocket from 'ws';
import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '.env') });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.REALTIME_MODEL || 'gpt-realtime-1.5';
const VOICE = process.env.REALTIME_VOICE || 'coral';

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not set in .env');
  process.exit(1);
}

const WS_URL = `wss://api.openai.com/v1/realtime?model=${MODEL}`;

console.log('');
console.log('═══════════════════════════════════════════════');
console.log('  🧪 AutoM8te Realtime API Connection Test');
console.log('═══════════════════════════════════════════════');
console.log(`  Model: ${MODEL}`);
console.log(`  Voice: ${VOICE}`);
console.log(`  URL: ${WS_URL}`);
console.log('═══════════════════════════════════════════════');
console.log('');

const DRONE_TOOLS = [
  {
    type: 'function',
    name: 'drone_command',
    description: 'Execute a single-drone command. Actions: takeoff, land, hover, return_home, emergency_stop.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID (e.g. drone_1)' },
        action: { type: 'string', description: 'Command: takeoff, land, hover, return_home, emergency_stop' },
        params: { type: 'object', description: 'Action-specific params: {altitude_m, heading_deg}' },
      },
      required: ['drone_id', 'action'],
    },
  },
  {
    type: 'function',
    name: 'drone_query',
    description: 'Get telemetry for a specific drone or all drones.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID. Omit for all drones.' },
      },
    },
  },
];

const SYSTEM_PROMPT = `You are AutoM8te, an AI drone swarm commander. Execute drone commands immediately. Be concise. Max 1-2 sentences. Default drone: drone_1. Default takeoff altitude: 10 meters.`;

// Track test results
const results = { passed: 0, failed: 0, tests: [] };
function pass(name) { results.passed++; results.tests.push(`✅ ${name}`); console.log(`✅ ${name}`); }
function fail(name, err) { results.failed++; results.tests.push(`❌ ${name}: ${err}`); console.error(`❌ ${name}: ${err}`); }

// ── Connect ────────────────────────────────────────────────

console.log('🔌 Connecting...');
const ws = new WebSocket(WS_URL, {
  headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
});

let sessionCreated = false;
let sessionUpdated = false;
let gotFunctionCall = false;
let gotAudioOutput = false;
let gotTranscript = false;
let functionCallData = null;
let transcriptText = '';
let audioBytes = 0;
const startTime = Date.now();

const timeout = setTimeout(() => {
  console.error('⏰ Test timed out after 30s');
  ws.close();
  process.exit(1);
}, 30000);

ws.on('open', () => {
  const connectMs = Date.now() - startTime;
  pass(`WebSocket connected in ${connectMs}ms`);
});

ws.on('error', (err) => {
  fail('WebSocket connection', err.message);
  clearTimeout(timeout);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  console.log(`\n🔌 Connection closed: ${code} ${reason}`);
  clearTimeout(timeout);

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Test Results');
  console.log('═══════════════════════════════════════════════');
  results.tests.forEach(t => console.log(`  ${t}`));
  console.log(`\n  Total: ${results.passed} passed, ${results.failed} failed`);
  console.log('═══════════════════════════════════════════════\n');

  process.exit(results.failed > 0 ? 1 : 0);
});

ws.on('message', async (rawData) => {
  const event = JSON.parse(rawData.toString());

  switch (event.type) {
    case 'session.created':
      sessionCreated = true;
      pass(`Session created: ${event.session?.id}`);
      // Now configure the session
      configureSession();
      break;

    case 'session.updated':
      sessionUpdated = true;
      pass('Session configured with tools and voice');
      // Send a text command to trigger function calling
      setTimeout(() => sendTestCommand(), 500);
      break;

    case 'response.function_call_arguments.done':
      gotFunctionCall = true;
      functionCallData = { name: event.name, args: event.arguments, call_id: event.call_id };
      const latencyMs = Date.now() - commandSentTime;
      pass(`Function call received in ${latencyMs}ms: ${event.name}(${event.arguments})`);

      // Send mock result back
      sendFunctionResult(event.call_id, event.name);
      break;

    case 'response.output_audio.delta':
    case 'response.audio.delta':
      if (event.delta) {
        const buf = Buffer.from(event.delta, 'base64');
        audioBytes += buf.length;
        if (!gotAudioOutput) {
          gotAudioOutput = true;
          const audioLatency = Date.now() - functionResultSentTime;
          pass(`First audio chunk in ${audioLatency}ms after function result (${buf.length} bytes)`);
        }
      }
      break;

    case 'response.output_audio_transcript.done':
    case 'response.audio_transcript.done':
      if (event.transcript) {
        gotTranscript = true;
        transcriptText = event.transcript;
        pass(`Transcript: "${event.transcript}"`);
      }
      break;

    case 'response.done':
      if (gotFunctionCall && (gotAudioOutput || gotTranscript)) {
        const totalMs = Date.now() - commandSentTime;
        pass(`Total round-trip: ${totalMs}ms (${audioBytes} bytes audio)`);

        // Save audio for debugging if any
        if (audioBytes > 0) {
          console.log(`\n📊 Audio output: ${audioBytes} bytes (~${(audioBytes / (24000 * 2)).toFixed(1)}s at 24kHz)`);
        }

        // All done!
        console.log('\n🎉 All tests passed! Voice bridge is ready for Discord integration.');
        ws.close();
      }
      break;

    case 'error':
      fail('API error', JSON.stringify(event.error));
      ws.close();
      break;

    case 'response.function_call_arguments.delta':
    case 'response.output_audio.done':
    case 'response.audio.done':
    case 'response.created':
    case 'response.output_item.added':
    case 'response.output_item.done':
    case 'response.content_part.added':
    case 'response.content_part.done':
    case 'conversation.item.created':
    case 'conversation.item.added':
    case 'conversation.item.done':
    case 'rate_limits.updated':
    case 'response.output_audio_transcript.delta':
    case 'response.audio_transcript.delta':
    case 'input_audio_buffer.speech_started':
    case 'input_audio_buffer.speech_stopped':
    case 'input_audio_buffer.committed':
      // Expected lifecycle events, no action needed
      break;

    default:
      console.log(`  📨 ${event.type}`);
  }
});

// ── Session Configuration ──────────────────────────────────

function configureSession() {
  console.log('🔧 Configuring session...');
  ws.send(JSON.stringify({
    type: 'session.update',
    session: {
      type: 'realtime',
      model: MODEL,
      instructions: SYSTEM_PROMPT,
      output_modalities: ['audio'],
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: 'gpt-4o-mini-transcribe' },
          turn_detection: { type: 'semantic_vad' },
        },
        output: {
          format: { type: 'audio/pcm', rate: 24000 },
          voice: VOICE,
        },
      },
      tools: DRONE_TOOLS,
    },
  }));
}

// ── Send Test Command ──────────────────────────────────────

let commandSentTime = 0;

function sendTestCommand() {
  console.log('\n📤 Sending test command: "Take off drone 1 to 10 meters"');
  commandSentTime = Date.now();

  ws.send(JSON.stringify({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Take off drone 1 to 10 meters' }],
    },
  }));
  ws.send(JSON.stringify({ type: 'response.create' }));
}

// ── Send Function Result ───────────────────────────────────

let functionResultSentTime = 0;

function sendFunctionResult(callId, toolName) {
  console.log('📤 Sending mock tool result...');
  functionResultSentTime = Date.now();

  // Simulate a successful drone command
  const mockResult = {
    drone_command: { status: 'success', drone_id: 'drone_1', action: 'takeoff', altitude_m: 10, message: 'Drone 1 taking off to 10 meters' },
    drone_query: { drone_id: 'drone_1', altitude_m: 10, battery_pct: 95, mode: 'GUIDED', heading_deg: 0 },
  };

  ws.send(JSON.stringify({
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: callId,
      output: JSON.stringify(mockResult[toolName] || { status: 'success' }),
    },
  }));
  ws.send(JSON.stringify({ type: 'response.create' }));
}
