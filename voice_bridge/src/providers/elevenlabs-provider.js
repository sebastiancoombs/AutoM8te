/**
 * Provider: elevenlabs
 *
 * Cascaded pipeline: ElevenLabs Scribe STT → configurable LLM → ElevenLabs TTS.
 * Higher quality audio; slightly higher latency (~1–2s vs ~500ms for openai-realtime).
 *
 * Pipeline:
 *   PCM audio in
 *     → silence detection (VAD buffer)
 *     → ElevenLabs Scribe STT  (POST /v1/speech-to-text)
 *     → LLM with tool definitions (OpenAI chat completions or Anthropic Messages)
 *     → execute any tool calls
 *     → ElevenLabs TTS  (POST /v1/text-to-speech/:voice_id/stream)
 *     → PCM audio out
 *
 * Required env vars:
 *   ELEVENLABS_API_KEY   — ElevenLabs API key
 *
 * Optional env vars (depending on llmProvider):
 *   OPENAI_API_KEY       — when llmProvider = "openai"
 *   ANTHROPIC_API_KEY    — when llmProvider = "anthropic"
 *
 * Config fields (in config.json):
 *   provider:        "elevenlabs"
 *   voice:           ElevenLabs voice ID (e.g. "JBFqnCBsd6RMkjVDRZzb")
 *   llmProvider:     "openai" | "anthropic"  (default: "openai")
 *   llmModel:        e.g. "gpt-4o", "claude-opus-4-5" (default: "gpt-4o")
 *   silenceMs:       ms of silence before processing speech (default: 800)
 *   silenceThreshold: RMS level below which audio is considered silence (default: 200)
 *
 * Emits: audio, audio_done, speech_started, speech_stopped,
 *        user_transcript, assistant_transcript, response_done, error, ready
 */

import { EventEmitter } from 'events';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Default ElevenLabs voice: "Rachel" — calm, clear, English
const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';

export class ElevenLabsProvider extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.systemPrompt     - System instructions for the LLM
   * @param {string} opts.voice            - ElevenLabs voice ID
   * @param {string} opts.llmProvider      - "openai" | "anthropic"
   * @param {string} opts.llmModel         - LLM model name
   * @param {number} opts.silenceMs        - Silence duration before processing
   * @param {number} opts.silenceThreshold - RMS threshold for silence detection
   * @param {Array}  opts.tools            - OpenAI-format tool definitions
   * @param {Function} opts.executeTool    - Tool executor fn(name, args) → Promise<string>
   */
  constructor(opts = {}) {
    super();

    this.elevenLabsKey  = process.env.ELEVENLABS_API_KEY;
    this.openaiKey      = process.env.OPENAI_API_KEY;
    this.anthropicKey   = process.env.ANTHROPIC_API_KEY;

    this.systemPrompt    = opts.systemPrompt    || 'You are a voice assistant. Be concise.';
    this.voiceId         = opts.voice           || DEFAULT_VOICE_ID;
    this.llmProvider     = opts.llmProvider     || 'openai';
    this.llmModel        = opts.llmModel        || (this.llmProvider === 'anthropic' ? 'claude-opus-4-5' : 'gpt-4o');
    this.silenceMs       = opts.silenceMs       ?? 800;
    this.silenceThreshold = opts.silenceThreshold ?? 200;
    this.tools           = opts.tools           || [];
    this.executeTool     = opts.executeTool     || null;

    // Internal state
    this._audioChunks    = [];     // PCM buffers accumulated during speech
    this._totalBytes     = 0;
    this._speaking       = false;
    this._silenceTimer   = null;
    this._conversationHistory = []; // Multi-turn LLM context
    this._connected      = true;   // Always "connected" (no persistent WS)
  }

  /** Called by index.js — no persistent connection needed for cascaded pipeline. */
  connect() {
    if (!this.elevenLabsKey) {
      this.emit('error', new Error('ELEVENLABS_API_KEY not set'));
      return;
    }
    if (this.llmProvider === 'openai' && !this.openaiKey) {
      this.emit('error', new Error('OPENAI_API_KEY not set (required for llmProvider: openai)'));
      return;
    }
    if (this.llmProvider === 'anthropic' && !this.anthropicKey) {
      this.emit('error', new Error('ANTHROPIC_API_KEY not set (required for llmProvider: anthropic)'));
      return;
    }

    console.log(`[elevenlabs] Ready — LLM: ${this.llmProvider}/${this.llmModel}, voice: ${this.voiceId}`);
    console.log(`[elevenlabs] VAD: silence>${this.silenceMs}ms, threshold=${this.silenceThreshold}`);
    this.emit('ready');
  }

  /**
   * Receive PCM 16-bit mono 24kHz audio.
   * Accumulates speech and triggers processing after silence.
   */
  sendAudio(pcmData) {
    const rms = _rms(pcmData);
    const isSpeech = rms > this.silenceThreshold;

    if (isSpeech) {
      if (!this._speaking) {
        this._speaking = true;
        this._audioChunks = [];
        this._totalBytes = 0;
        console.log('[elevenlabs] Speech detected');
        this.emit('speech_started');
      }
      // Reset silence timer on each speech chunk
      if (this._silenceTimer) {
        clearTimeout(this._silenceTimer);
        this._silenceTimer = null;
      }
      this._audioChunks.push(pcmData);
      this._totalBytes += pcmData.length;
    } else if (this._speaking) {
      // Still collecting audio during silence gap
      this._audioChunks.push(pcmData);
      this._totalBytes += pcmData.length;

      if (!this._silenceTimer) {
        this._silenceTimer = setTimeout(() => {
          this._silenceTimer = null;
          this._speaking = false;
          console.log('[elevenlabs] Speech ended');
          this.emit('speech_stopped');
          this._processSpeech();
        }, this.silenceMs);
      }
    }
  }

  /** Send a text message directly (bypasses STT). */
  sendText(text) {
    console.log(`[elevenlabs] Text input: "${text}"`);
    this.emit('user_transcript', text);
    this._processText(text).catch((err) => {
      console.error('[elevenlabs] sendText error:', err.message);
      this.emit('error', err);
    });
  }

  /** Process accumulated PCM audio through the full pipeline. */
  async _processSpeech() {
    if (this._totalBytes < 4800) {
      // < 100ms of audio at 24kHz mono 16-bit — discard as noise
      console.log('[elevenlabs] Audio too short, discarding');
      this._audioChunks = [];
      this._totalBytes = 0;
      return;
    }

    const pcmBuffer = Buffer.concat(this._audioChunks);
    this._audioChunks = [];
    this._totalBytes = 0;

    try {
      // ── Step 1: STT via ElevenLabs Scribe ──
      const transcript = await this._transcribe(pcmBuffer);
      if (!transcript || transcript.trim() === '') {
        console.log('[elevenlabs] Empty transcript, skipping');
        return;
      }

      console.log(`[elevenlabs] User said: "${transcript}"`);
      this.emit('user_transcript', transcript);

      await this._processText(transcript);
    } catch (err) {
      console.error('[elevenlabs] Pipeline error:', err.message);
      this.emit('error', err);
    }
  }

  /** Run the LLM → tool calls → TTS leg of the pipeline. */
  async _processText(text) {
    try {
      // ── Step 2: LLM with tool definitions ──
      this._conversationHistory.push({ role: 'user', content: text });

      const { reply, toolCalls } = await this._callLLM(this._conversationHistory);

      // ── Step 3: Execute tool calls ──
      let finalReply = reply;

      if (toolCalls && toolCalls.length > 0 && this.executeTool) {
        const toolResults = [];

        for (const call of toolCalls) {
          console.log(`[elevenlabs] Tool call: ${call.name}(${JSON.stringify(call.args)})`);
          try {
            const result = await this.executeTool(call.name, call.args);
            toolResults.push({ call, result });
          } catch (err) {
            console.error(`[elevenlabs] Tool ${call.name} failed:`, err.message);
            toolResults.push({ call, result: JSON.stringify({ error: err.message }) });
          }
        }

        // Feed results back to LLM for a natural-language summary
        const toolResultMessages = toolResults.map(({ call, result }) => ({
          role: 'tool',
          tool_call_id: call.id,
          content: result,
        }));

        // Append assistant tool_use message and tool results
        this._conversationHistory.push({
          role: 'assistant',
          content: null,
          tool_calls: toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        });
        this._conversationHistory.push(...toolResultMessages);

        // Re-call LLM with tool results for spoken reply
        const { reply: followUp } = await this._callLLM(this._conversationHistory);
        finalReply = followUp;
      }

      if (!finalReply) {
        console.warn('[elevenlabs] LLM returned empty reply');
        return;
      }

      console.log(`[elevenlabs] Assistant reply: "${finalReply}"`);
      this._conversationHistory.push({ role: 'assistant', content: finalReply });
      this.emit('assistant_transcript', finalReply);

      // ── Step 4: TTS via ElevenLabs ──
      await this._speak(finalReply);

      this.emit('response_done');
    } catch (err) {
      console.error('[elevenlabs] _processText error:', err.message);
      this.emit('error', err);
    }
  }

  // ── STT: ElevenLabs Scribe ──────────────────────────────────────────────────

  async _transcribe(pcmBuffer) {
    // Scribe accepts WAV/MP3/etc. We wrap raw PCM in a minimal WAV container.
    const wav = _pcmToWav(pcmBuffer, 24000, 1, 16);

    const formData = new FormData();
    formData.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    formData.append('model_id', 'scribe_v1');

    const res = await fetch(`${ELEVENLABS_BASE}/v1/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': this.elevenLabsKey },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ElevenLabs STT ${res.status}: ${err}`);
    }

    const data = await res.json();
    return data.text || '';
  }

  // ── LLM call (OpenAI or Anthropic) ─────────────────────────────────────────

  async _callLLM(messages) {
    if (this.llmProvider === 'anthropic') {
      return this._callAnthropic(messages);
    }
    return this._callOpenAI(messages);
  }

  async _callOpenAI(messages) {
    const body = {
      model: this.llmModel,
      messages: [
        { role: 'system', content: this.systemPrompt },
        ...messages,
      ],
    };

    if (this.tools.length > 0) {
      // Convert OpenAI Realtime tool format → Chat Completions format
      body.tools = this.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = 'auto';
    }

    const res = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI LLM ${res.status}: ${err}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const message = choice?.message;

    const toolCalls = message?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments || '{}'),
    })) || [];

    return { reply: message?.content || null, toolCalls };
  }

  async _callAnthropic(messages) {
    // Convert OpenAI message history to Anthropic format
    const anthropicMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }],
          };
        }
        if (m.tool_calls) {
          return {
            role: 'assistant',
            content: m.tool_calls.map((tc) => ({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments || '{}'),
            })),
          };
        }
        return { role: m.role, content: m.content };
      });

    const body = {
      model: this.llmModel,
      max_tokens: 1024,
      system: this.systemPrompt,
      messages: anthropicMessages,
    };

    if (this.tools.length > 0) {
      body.tools = this.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': this.anthropicKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic LLM ${res.status}: ${err}`);
    }

    const data = await res.json();
    const content = data.content || [];

    const textBlock = content.find((b) => b.type === 'text');
    const toolBlocks = content.filter((b) => b.type === 'tool_use');

    const toolCalls = toolBlocks.map((b) => ({
      id: b.id,
      name: b.name,
      args: b.input || {},
    }));

    return { reply: textBlock?.text || null, toolCalls };
  }

  // ── TTS: ElevenLabs ─────────────────────────────────────────────────────────

  async _speak(text) {
    const res = await fetch(`${ELEVENLABS_BASE}/v1/text-to-speech/${this.voiceId}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.elevenLabsKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/pcm;rate=24000',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        output_format: 'pcm_24000',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ElevenLabs TTS ${res.status}: ${err}`);
    }

    // Stream the PCM chunks out as audio events
    const reader = res.body.getReader();
    let started = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) {
        if (!started) {
          started = true;
        }
        this.emit('audio', Buffer.from(value));
      }
    }

    this.emit('audio_done');
  }

  disconnect() {
    if (this._silenceTimer) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
    this._speaking = false;
    this._audioChunks = [];
    this._totalBytes = 0;
    console.log('[elevenlabs] Disconnected');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute RMS amplitude of a PCM s16le buffer.
 * Used for silence detection.
 */
function _rms(buffer) {
  if (buffer.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < buffer.length - 1; i += 2) {
    const sample = buffer.readInt16LE(i);
    sum += sample * sample;
  }
  return Math.sqrt(sum / (buffer.length / 2));
}

/**
 * Wrap raw PCM s16le into a minimal WAV container.
 * ElevenLabs Scribe requires a proper audio file format.
 */
function _pcmToWav(pcmBuffer, sampleRate, channels, bitDepth) {
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);             // PCM chunk size
  header.writeUInt16LE(1, 20);              // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}
