/**
 * Provider factory.
 *
 * Reads `config.provider` and returns the appropriate provider instance.
 * All providers implement the same EventEmitter interface:
 *
 *   Methods:  connect(), sendAudio(pcmBuffer), sendText(text), disconnect()
 *   Events:   audio, audio_done, speech_started, speech_stopped,
 *             user_transcript, assistant_transcript, response_done, error, ready
 *
 * Supported providers:
 *   "openai-realtime"  — Speech-to-speech via OpenAI Realtime API (~500ms)
 *   "elevenlabs"       — Cascaded: ElevenLabs Scribe STT → LLM → ElevenLabs TTS (~1-2s)
 *   "local"            — v2 placeholder (Whisper.cpp + Ollama + Piper, not yet implemented)
 */

import { OpenAIRealtimeProvider } from './providers/openai-realtime.js';
import { ElevenLabsProvider }     from './providers/elevenlabs-provider.js';
import { LocalProvider }          from './providers/local-provider.js';

/**
 * Create a provider from config + tool options.
 *
 * @param {string} apiKey - OpenAI API key (required for openai-realtime and elevenlabs/openai LLM)
 * @param {object} config - Parsed config.json
 * @param {object} toolOpts
 * @param {Array}  toolOpts.tools       - OpenAI Realtime-format tool definitions
 * @param {Function} toolOpts.executeTool - Tool executor fn(name, args) → Promise<string>
 * @returns {EventEmitter} Provider instance
 */
export function createProvider(apiKey, config, toolOpts = {}) {
  const provider = config.provider || 'openai-realtime';

  const sharedOpts = {
    systemPrompt:  config.systemPrompt  || 'You are a voice assistant. Be concise.',
    voice:         config.voice         || 'coral',
    tools:         toolOpts.tools       || [],
    executeTool:   toolOpts.executeTool || null,
  };

  switch (provider) {
    case 'openai-realtime': {
      console.log('[provider] Using openai-realtime (speech-to-speech, ~500ms)');
      return new OpenAIRealtimeProvider(apiKey, {
        ...sharedOpts,
        model:         config.model         || 'gpt-realtime',
        turnDetection: config.turnDetection || 'semantic_vad',
      });
    }

    case 'elevenlabs': {
      console.log('[provider] Using elevenlabs (cascaded STT→LLM→TTS, ~1-2s)');
      return new ElevenLabsProvider({
        ...sharedOpts,
        // voice here is an ElevenLabs voice ID, not an OpenAI voice name
        llmProvider:      config.llmProvider      || 'openai',
        llmModel:         config.llmModel         || 'gpt-4o',
        silenceMs:        config.silenceMs        ?? 800,
        silenceThreshold: config.silenceThreshold ?? 200,
      });
    }

    case 'local': {
      console.log('[provider] Using local (v2 placeholder — not yet implemented)');
      return new LocalProvider({ ...sharedOpts });
    }

    default:
      throw new Error(
        `Unknown provider: "${provider}". ` +
        `Supported: "openai-realtime", "elevenlabs", "local"`
      );
  }
}
