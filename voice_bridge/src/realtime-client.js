/**
 * OpenAI Realtime API WebSocket client.
 * Handles session management, audio streaming, and function calling.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

export class RealtimeClient extends EventEmitter {
  /**
   * @param {string} apiKey - OpenAI API key
   * @param {object} opts
   * @param {string} opts.model - Realtime model ID
   * @param {string} opts.voice - TTS voice
   * @param {string} opts.systemPrompt - System prompt / instructions
   * @param {string} opts.turnDetection - VAD mode (e.g. 'semantic_vad')
   * @param {Array}  opts.tools - OpenAI Realtime tool definitions
   * @param {Function} opts.executeTool - Tool executor function
   */
  constructor(apiKey, opts = {}) {
    super();
    this.apiKey = apiKey;
    this.model = opts.model || 'gpt-realtime';
    this.voice = opts.voice || 'coral';
    this.systemPrompt = opts.systemPrompt || 'You are a voice assistant. Be concise.';
    this.turnDetection = opts.turnDetection || 'semantic_vad';
    this.tools = opts.tools || [];
    this.executeTool = opts.executeTool || null;
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
    this._send({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: this.model,
        instructions: this.systemPrompt,
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            turn_detection: { type: this.turnDetection },
          },
          output: {
            format: { type: 'audio/pcm' },
            voice: this.voice,
          },
        },
        tools: this.tools,
        tool_choice: this.tools.length > 0 ? 'auto' : 'none',
      },
    });

    console.log(`[REALTIME] Session configured: voice=${this.voice}, ${this.tools.length} tools`);
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
      case 'response.audio.delta': {
        const audioBuffer = Buffer.from(event.delta, 'base64');
        this.emit('audio', audioBuffer);
        break;
      }

      case 'response.audio.done':
        this.emit('audio_done');
        break;

      // ── Function calling ──
      case 'response.output_item.done':
        if (event.item?.type === 'function_call') {
          const { name, call_id, arguments: argsStr } = event.item;
          console.log(`[REALTIME] Function call: ${name}(${argsStr})`);

          if (!this.executeTool) {
            console.warn(`[REALTIME] No executeTool set — skipping function call: ${name}`);
            break;
          }

          try {
            const args = JSON.parse(argsStr);
            const result = await this.executeTool(name, args);

            this._send({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: call_id,
                output: result,
              },
            });
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
