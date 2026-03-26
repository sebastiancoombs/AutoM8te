/**
 * AutoM8te Voice Bridge — OpenAI Realtime API Session
 *
 * Manages the WebSocket connection to the Realtime API (GA endpoint).
 * Handles session configuration, audio streaming, and function calling.
 *
 * GA API event format confirmed from:
 * - https://developers.openai.com/api/reference/resources/realtime/server-events
 * - https://platform.openai.com/docs/guides/realtime-conversations
 *
 * Audio events: response.output_audio.delta / response.output_audio.done
 * Transcript events: response.output_audio_transcript.delta / .done
 * Function call events: response.function_call_arguments.delta / .done
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { config } from './config.js';
import { DRONE_TOOLS, executeTool } from './drone-tools.js';
import { SYSTEM_PROMPT } from './system-prompt.js';

export class RealtimeSession extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.connected = false;
    this.sessionId = null;
    this._reconnectTimer = null;
    this._pendingFunctionCalls = new Map();
    this._toolCallsInFlight = 0;
  }

  /**
   * Connect to the OpenAI Realtime API via WebSocket.
   */
  connect() {
    if (this.ws) {
      this.disconnect();
    }

    console.log('🔌 Connecting to OpenAI Realtime API...');
    console.log(`   Model: ${config.openai.model}`);
    console.log(`   Voice: ${config.openai.voice}`);

    this.ws = new WebSocket(config.openai.wsUrl, {
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
      },
    });

    this.ws.on('open', () => {
      console.log('✅ Connected to OpenAI Realtime API');
      this.connected = true;
      this._configureSession();
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      this._handleMessage(data);
    });

    this.ws.on('close', (code, reason) => {
      console.log(`🔌 Realtime API disconnected: ${code} ${reason}`);
      this.connected = false;
      this.emit('disconnected', code, reason);
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('❌ Realtime API WebSocket error:', err.message);
      this.emit('error', err);
    });
  }

  /**
   * Configure the Realtime session with tools, voice, and instructions.
   * Uses the GA API format (session.type='realtime', audio.input/output objects).
   */
  _configureSession() {
    this._send({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: config.openai.model,
        instructions: SYSTEM_PROMPT,
        // Both audio and text output — text gives us transcripts for logging
        output_modalities: ['audio', 'text'],
        audio: {
          input: {
            format: {
              type: 'audio/pcm',
              rate: 24000,
            },
            // Enable input transcription so we can see what the user said
            transcription: {
              model: 'gpt-4o-mini-transcribe',
            },
            turn_detection: {
              type: 'semantic_vad',
              // Don't require silence — semantic VAD knows when user is done
            },
          },
          output: {
            format: {
              type: 'audio/pcm',
            },
            voice: config.openai.voice,
          },
        },
        tools: DRONE_TOOLS,
      },
    });
    console.log(`🛠  Session configured: ${DRONE_TOOLS.length} tools registered (${DRONE_TOOLS.map(t => t.name).join(', ')})`);
  }

  /**
   * Send raw PCM audio data to the Realtime API.
   * Audio must be PCM 16-bit LE, mono, 24kHz.
   * @param {Buffer} pcmBuffer - Raw PCM audio buffer
   */
  sendAudio(pcmBuffer) {
    if (!this.connected) return;
    this._send({
      type: 'input_audio_buffer.append',
      audio: pcmBuffer.toString('base64'),
    });
  }

  /**
   * Send a text message (for testing or hybrid interaction via !text).
   * @param {string} text
   */
  sendText(text) {
    if (!this.connected) return;
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

  /**
   * Handle incoming WebSocket messages from the Realtime API.
   * Handles both GA event names (response.output_audio.*) and
   * possible alternate names (response.audio.*) for robustness.
   */
  _handleMessage(rawData) {
    let event;
    try {
      event = JSON.parse(rawData.toString());
    } catch {
      console.error('❌ Failed to parse Realtime event');
      return;
    }

    if (config.debug) {
      const audioTypes = ['response.output_audio.delta', 'response.audio.delta'];
      const summary = audioTypes.includes(event.type)
        ? `${event.type} (${event.delta?.length || 0} chars b64)`
        : event.type;
      console.log(`📨 ${summary}`);
    }

    switch (event.type) {
      // ── Session lifecycle ─────────────────────────────────
      case 'session.created':
        this.sessionId = event.session?.id;
        console.log(`📋 Session created: ${this.sessionId}`);
        break;

      case 'session.updated':
        console.log('📋 Session configuration updated');
        break;

      // ── Audio output (GA: response.output_audio.*) ────────
      case 'response.output_audio.delta':
      case 'response.audio.delta': // alternate event name (some API versions)
        if (event.delta) {
          const audioBuffer = Buffer.from(event.delta, 'base64');
          this.emit('audio', audioBuffer);
        }
        break;

      case 'response.output_audio.done':
      case 'response.audio.done':
        this.emit('audio_done');
        break;

      // ── Transcript of model speech ────────────────────────
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        if (event.delta) {
          this.emit('transcript_delta', event.delta);
        }
        break;

      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        if (event.transcript) {
          this.emit('transcript', event.transcript);
          console.log(`🗣  AutoM8te: ${event.transcript}`);
        }
        break;

      // ── Text output (for text-mode responses) ─────────────
      case 'response.output_text.delta':
        if (event.delta) {
          this.emit('text_delta', event.delta);
        }
        break;

      case 'response.output_text.done':
        if (event.text) {
          this.emit('text_done', event.text);
        }
        break;

      // ── Input transcript (what user said) ─────────────────
      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript) {
          console.log(`🎤 User: ${event.transcript}`);
          this.emit('user_transcript', event.transcript);
        }
        break;

      case 'conversation.item.input_audio_transcription.delta':
        // Partial input transcription
        break;

      // ── Function calling ──────────────────────────────────
      case 'response.function_call_arguments.delta':
        if (!this._pendingFunctionCalls.has(event.call_id)) {
          this._pendingFunctionCalls.set(event.call_id, {
            name: event.name || '',
            args: '',
            itemId: event.item_id,
          });
        }
        const pending = this._pendingFunctionCalls.get(event.call_id);
        if (event.name) pending.name = event.name;
        pending.args += event.delta || '';
        break;

      case 'response.function_call_arguments.done':
        this._handleFunctionCall(event);
        break;

      // ── Speech detection ──────────────────────────────────
      case 'input_audio_buffer.speech_started':
        this.emit('speech_started');
        break;

      case 'input_audio_buffer.speech_stopped':
        this.emit('speech_stopped');
        break;

      case 'input_audio_buffer.committed':
        if (config.debug) console.log('🎤 Audio buffer committed');
        break;

      // ── Conversation items ────────────────────────────────
      case 'conversation.item.created':
      case 'conversation.item.added':
      case 'conversation.item.done':
        // Lifecycle events, no action needed
        break;

      // ── Response lifecycle ────────────────────────────────
      case 'response.created':
        if (config.debug) console.log('📤 Response generation started');
        break;

      case 'response.output_item.added':
      case 'response.output_item.created':
      case 'response.output_item.done':
      case 'response.content_part.added':
      case 'response.content_part.done':
        // Intermediate lifecycle events
        break;

      case 'response.done':
        if (config.debug) console.log('📤 Response complete');
        if (event.response?.status === 'failed') {
          console.error('❌ Response failed:', JSON.stringify(event.response.status_details || {}));
        }
        break;

      // ── Errors ────────────────────────────────────────────
      case 'error':
        console.error('❌ Realtime API error:', JSON.stringify(event.error));
        this.emit('api_error', event.error);
        break;

      // ── Rate limits ───────────────────────────────────────
      case 'rate_limits.updated':
        if (config.debug) {
          console.log('⚡ Rate limits:', JSON.stringify(event.rate_limits));
        }
        break;

      default:
        if (config.debug) {
          console.log(`📨 Unhandled event: ${event.type}`);
        }
    }
  }

  /**
   * Handle a completed function call from the Realtime API.
   * Executes the tool and sends the result back.
   */
  async _handleFunctionCall(event) {
    const callId = event.call_id;
    const name = event.name;
    const argsStr = event.arguments || '';

    this._pendingFunctionCalls.delete(callId);

    let args = {};
    try {
      args = argsStr ? JSON.parse(argsStr) : {};
    } catch (e) {
      console.error(`❌ Failed to parse function args for ${name}:`, argsStr);
      args = {};
    }

    console.log(`🔧 Function call: ${name}(${JSON.stringify(args)})`);
    const startMs = Date.now();

    this._toolCallsInFlight++;

    try {
      const result = await executeTool(name, args);
      const elapsed = Date.now() - startMs;
      console.log(`   ↳ Result in ${elapsed}ms: ${result.substring(0, 200)}`);

      // Send the result back to the Realtime API
      this._send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: result,
        },
      });

      // Trigger the model to respond with the result
      this._send({ type: 'response.create' });
    } catch (err) {
      console.error(`❌ Tool execution error: ${name}`, err);
      this._send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: err.message }),
        },
      });
      this._send({ type: 'response.create' });
    } finally {
      this._toolCallsInFlight--;
    }
  }

  /**
   * Send a JSON event over the WebSocket.
   */
  _send(event) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(event));
  }

  /**
   * Schedule a reconnection attempt.
   */
  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    console.log('🔄 Reconnecting in 5 seconds...');
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  /**
   * Disconnect from the Realtime API.
   */
  disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}
