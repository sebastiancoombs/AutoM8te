/**
 * OpenAI Realtime API WebSocket client.
 * Handles session management, audio streaming, and function calling.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { DRONE_TOOLS, executeTool } from './drone-tools.js';

const SYSTEM_PROMPT = `You are AutoM8te, an AI drone swarm commander. You control drones via voice in real-time.

Rules:
- Execute drone commands IMMEDIATELY when asked. Don't ask for confirmation.
- Be concise. Max 1-2 sentences per response.
- Default drone is drone_1 unless specified.
- Default takeoff altitude is 10 meters unless specified.
- When user says "all drones", use drone_broadcast or iterate all.
- For formations, use drone_formation with the specified type.
- Speak like a military copilot: crisp, confident, brief.
- When asked for status, call drone_query or list_drones and read back key telemetry.
- If you don't know which drone, assume drone_1.

Available drones: drone_1 through drone_5 (SITL simulation)
Drone home location: Canberra, Australia (-35.3632, 149.1652)

Examples:
- "Take off" → call drone_takeoff(drone_1, 10)
- "V formation" → call drone_formation("v", 10, 10)
- "Land all drones" → call drone_broadcast("land")
- "Status" → call list_drones() and read back`;

export class RealtimeClient extends EventEmitter {
  constructor(apiKey, opts = {}) {
    super();
    this.apiKey = apiKey;
    this.model = opts.model || 'gpt-realtime';
    this.voice = opts.voice || 'coral';
    this.ws = null;
    this._connected = false;
  }

  connect() {
    const url = `wss://api.openai.com/v1/realtime?model=${this.model}`;
    console.log(`[REALTIME] Connecting to ${url}`);

    this.ws = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    this.ws.on('open', () => {
      console.log('[REALTIME] WebSocket connected');
      this._connected = true;
      this._configureSession();
    });

    this.ws.on('message', (data) => {
      const event = JSON.parse(data.toString());
      this._handleEvent(event);
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[REALTIME] WebSocket closed: ${code} ${reason}`);
      this._connected = false;
      this.emit('disconnected');
    });

    this.ws.on('error', (err) => {
      console.error('[REALTIME] WebSocket error:', err.message);
      this.emit('error', err);
    });
  }

  _configureSession() {
    // Configure session with tools, voice, VAD
    this._send({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: this.model,
        instructions: SYSTEM_PROMPT,
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            turn_detection: { type: 'semantic_vad' },
          },
          output: {
            format: { type: 'audio/pcm' },
            voice: this.voice,
          },
        },
        tools: DRONE_TOOLS,
        tool_choice: 'auto',
      },
    });

    console.log(`[REALTIME] Session configured: voice=${this.voice}, ${DRONE_TOOLS.length} tools`);
    this.emit('ready');
  }

  /**
   * Send audio chunk to Realtime API.
   * @param {Buffer} pcmData - PCM 16-bit mono 24kHz audio
   */
  sendAudio(pcmData) {
    if (!this._connected) return;
    this._send({
      type: 'input_audio_buffer.append',
      audio: pcmData.toString('base64'),
    });
  }

  /**
   * Send a text message (for testing without voice).
   */
  sendText(text) {
    if (!this._connected) return;
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

  _send(event) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  async _handleEvent(event) {
    switch (event.type) {
      case 'session.created':
        console.log('[REALTIME] Session created:', event.session?.id);
        break;

      case 'session.updated':
        console.log('[REALTIME] Session updated');
        break;

      case 'input_audio_buffer.speech_started':
        console.log('[REALTIME] Speech detected');
        this.emit('speech_started');
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('[REALTIME] Speech ended');
        this.emit('speech_stopped');
        break;

      // ── Audio output (stream to Discord) ──
      case 'response.audio.delta':
        // Base64 PCM audio chunk from the model
        const audioBuffer = Buffer.from(event.delta, 'base64');
        this.emit('audio', audioBuffer);
        break;

      case 'response.audio.done':
        this.emit('audio_done');
        break;

      // ── Function calling ──
      case 'response.output_item.done':
        if (event.item?.type === 'function_call') {
          const { name, call_id, arguments: argsStr } = event.item;
          console.log(`[REALTIME] Function call: ${name}(${argsStr})`);

          try {
            const args = JSON.parse(argsStr);
            const result = await executeTool(name, args);

            // Send function result back
            this._send({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: call_id,
                output: result,
              },
            });

            // Trigger response generation with the tool result
            this._send({ type: 'response.create' });
          } catch (err) {
            console.error(`[REALTIME] Function call error:`, err);
            this._send({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: call_id,
                output: JSON.stringify({ error: err.message }),
              },
            });
            this._send({ type: 'response.create' });
          }
        }
        break;

      // ── Transcription ──
      case 'conversation.item.input_audio_transcription.completed':
        console.log(`[REALTIME] User said: "${event.transcript}"`);
        this.emit('user_transcript', event.transcript);
        break;

      case 'response.output_audio_transcript.delta':
        // Partial assistant transcript
        break;

      case 'response.output_audio_transcript.done':
        console.log(`[REALTIME] Assistant said: "${event.transcript}"`);
        this.emit('assistant_transcript', event.transcript);
        break;

      case 'response.done':
        this.emit('response_done', event.response);
        break;

      case 'error':
        console.error('[REALTIME] API Error:', event.error);
        this.emit('error', new Error(event.error?.message || 'Unknown error'));
        break;

      case 'rate_limits.updated':
        // Track rate limits if needed
        break;

      default:
        // Uncomment for debugging:
        // console.log(`[REALTIME] ${event.type}`);
        break;
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
