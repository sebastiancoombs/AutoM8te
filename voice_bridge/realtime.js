/**
 * AutoM8te Voice Bridge — OpenAI Realtime API Client
 * 
 * Manages the WebSocket connection to OpenAI's Realtime API.
 * Handles session configuration, audio streaming, and function calling.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { config } from './config.js';
import { toolDefinitions, executeTool } from './tools.js';

const SYSTEM_PROMPT = `You are AutoM8te, an AI drone swarm commander. You control drones via voice in real-time.

Rules:
- Execute drone commands IMMEDIATELY when asked. Never ask for confirmation.
- Be concise. Max 1-2 sentences per response.
- Default drone is all drones unless a specific one is mentioned.
- Default takeoff altitude is 10 meters unless specified.
- Drone IDs are drone_0 through drone_4 (5 SITL simulation drones).
- When the user says "drone 1", map it to "drone_0" (zero-indexed). "Drone 2" = "drone_1", etc.
- For formations, just say the formation name and execute. Don't explain what a formation is.
- Speak like a military copilot: crisp, confident, brief.
- After executing a command, confirm what you did in 1 sentence.
- If a command fails, report the error briefly and suggest a fix.

Available commands: takeoff, land, hover, return home, emergency stop, move (direction + distance), formation (shape), search (pattern), status, group assign.
Available formations: line, v, circle, ring, square, grid, column, echelon.
Available search patterns: grid, lawnmower, spiral, expanding_square, sector, parallel.
Movement directions: north, south, east, west, up, down, forward, back, left, right.`;

export class RealtimeClient extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.connected = false;
    this.sessionId = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${config.openai.model}`;
      
      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${config.openai.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      this.ws.on('open', () => {
        console.log('[Realtime] Connected to OpenAI Realtime API');
        this.connected = true;
        this._configureSession();
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString());
          this._handleEvent(event);
        } catch (err) {
          console.error('[Realtime] Failed to parse event:', err.message);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[Realtime] Disconnected: ${code} ${reason}`);
        this.connected = false;
        this.emit('disconnected', { code, reason: reason.toString() });
      });

      this.ws.on('error', (err) => {
        console.error('[Realtime] WebSocket error:', err.message);
        if (!this.connected) reject(err);
      });
    });
  }

  _configureSession() {
    this._send({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: SYSTEM_PROMPT,
        tools: toolDefinitions,
        voice: config.openai.voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
        input_audio_transcription: {
          model: 'whisper-1',
        },
      },
    });
  }

  /**
   * Send PCM16 audio data to the Realtime API.
   * Audio should be 24kHz mono 16-bit PCM, base64-encoded.
   */
  sendAudio(pcm16Base64) {
    if (!this.connected) return;
    this._send({
      type: 'input_audio_buffer.append',
      audio: pcm16Base64,
    });
  }

  /**
   * Commit the audio buffer (used when VAD is disabled).
   */
  commitAudio() {
    this._send({ type: 'input_audio_buffer.commit' });
  }

  /**
   * Send a text message (for testing without audio).
   */
  sendText(text) {
    this._send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    });
    this._send({ type: 'response.create' });
  }

  async _handleEvent(event) {
    switch (event.type) {
      case 'session.created':
        this.sessionId = event.session?.id;
        console.log(`[Realtime] Session created: ${this.sessionId}`);
        break;

      case 'session.updated':
        console.log('[Realtime] Session configured');
        this.emit('ready');
        break;

      case 'error':
        console.error('[Realtime] Error:', JSON.stringify(event.error));
        this.emit('error', event.error);
        break;

      // Speech detection
      case 'input_audio_buffer.speech_started':
        this.emit('speech_started');
        break;

      case 'input_audio_buffer.speech_stopped':
        this.emit('speech_stopped');
        break;

      // Transcription of user input
      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript) {
          console.log(`[Realtime] User said: "${event.transcript}"`);
          this.emit('user_transcript', event.transcript);
        }
        break;

      // Audio output (streamed in chunks)
      case 'response.audio.delta':
        if (event.delta) {
          this.emit('audio_delta', Buffer.from(event.delta, 'base64'));
        }
        break;

      case 'response.audio.done':
        this.emit('audio_done');
        break;

      // Text output
      case 'response.audio_transcript.delta':
        if (event.delta) {
          this.emit('transcript_delta', event.delta);
        }
        break;

      case 'response.audio_transcript.done':
        if (event.transcript) {
          console.log(`[Realtime] AutoM8te: "${event.transcript}"`);
          this.emit('response_transcript', event.transcript);
        }
        break;

      // Function calling
      case 'response.function_call_arguments.done':
        await this._handleFunctionCall(event);
        break;

      case 'response.done':
        this.emit('response_done', event.response);
        break;

      case 'rate_limits.updated':
        // Silently track rate limits
        break;

      default:
        // Log unhandled events at debug level
        if (process.env.DEBUG) {
          console.log(`[Realtime] Event: ${event.type}`);
        }
    }
  }

  async _handleFunctionCall(event) {
    const { name, arguments: argsJson, call_id } = event;
    console.log(`[Realtime] Function call: ${name}(${argsJson})`);

    const startTime = Date.now();
    const result = await executeTool(name, argsJson);
    const elapsed = Date.now() - startTime;
    console.log(`[Realtime] Function result (${elapsed}ms): ${result}`);

    // Send function result back to Realtime API
    this._send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id,
        output: result,
      },
    });

    // Trigger response generation after function result
    this._send({ type: 'response.create' });
  }

  _send(event) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(event));
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
}
