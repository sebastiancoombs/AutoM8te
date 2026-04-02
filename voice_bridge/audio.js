/**
 * AutoM8te Voice Bridge — Audio Processing
 * 
 * Handles audio format conversion between Discord and OpenAI Realtime API.
 * 
 * Discord → Opus 48kHz stereo → PCM 48kHz → Resample to 24kHz mono → Base64 → Realtime API
 * Realtime API → PCM 24kHz mono → Resample to 48kHz → Opus encode → Discord
 */

import { Transform } from 'stream';
import prism from 'prism-media';

/**
 * Create an Opus decoder for Discord audio.
 * Discord sends Opus frames at 48kHz stereo.
 */
export function createOpusDecoder() {
  return new prism.opus.Decoder({
    rate: 48000,
    channels: 1, // Request mono output from decoder
    frameSize: 960, // 20ms at 48kHz
  });
}

/**
 * Create an Opus encoder for sending audio back to Discord.
 * Discord expects Opus at 48kHz.
 */
export function createOpusEncoder() {
  return new prism.opus.Encoder({
    rate: 48000,
    channels: 1,
    frameSize: 960, // 20ms at 48kHz
  });
}

/**
 * Downsample PCM from 48kHz to 24kHz (simple 2:1 decimation).
 * Input: 16-bit signed PCM, mono, 48kHz
 * Output: 16-bit signed PCM, mono, 24kHz
 */
export class Downsampler extends Transform {
  constructor() {
    super();
  }

  _transform(chunk, encoding, callback) {
    // Each sample is 2 bytes (16-bit). Take every other sample.
    const inputSamples = chunk.length / 2;
    const outputSamples = Math.floor(inputSamples / 2);
    const output = Buffer.alloc(outputSamples * 2);

    for (let i = 0; i < outputSamples; i++) {
      output.writeInt16LE(chunk.readInt16LE(i * 4), i * 2);
    }

    callback(null, output);
  }
}

/**
 * Upsample PCM from 24kHz to 48kHz (simple sample doubling with interpolation).
 * Input: 16-bit signed PCM, mono, 24kHz
 * Output: 16-bit signed PCM, mono, 48kHz
 */
export class Upsampler extends Transform {
  constructor() {
    super();
    this._lastSample = 0;
  }

  _transform(chunk, encoding, callback) {
    const inputSamples = chunk.length / 2;
    const output = Buffer.alloc(inputSamples * 4); // Double the samples

    for (let i = 0; i < inputSamples; i++) {
      const sample = chunk.readInt16LE(i * 2);
      const prev = i === 0 ? this._lastSample : chunk.readInt16LE((i - 1) * 2);
      
      // Linear interpolation: insert midpoint between previous and current
      const interpolated = Math.round((prev + sample) / 2);
      output.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 4);
      output.writeInt16LE(sample, i * 4 + 2);
    }

    if (inputSamples > 0) {
      this._lastSample = chunk.readInt16LE((inputSamples - 1) * 2);
    }

    callback(null, output);
  }
}

/**
 * Buffer PCM audio into fixed-size frames for Opus encoding.
 * Opus encoder needs exactly 960 samples (20ms at 48kHz) per frame.
 */
export class FrameBuffer extends Transform {
  constructor(frameSize = 960) {
    super();
    this._frameBytes = frameSize * 2; // 16-bit = 2 bytes per sample
    this._buffer = Buffer.alloc(0);
  }

  _transform(chunk, encoding, callback) {
    this._buffer = Buffer.concat([this._buffer, chunk]);

    while (this._buffer.length >= this._frameBytes) {
      const frame = this._buffer.subarray(0, this._frameBytes);
      this._buffer = this._buffer.subarray(this._frameBytes);
      this.push(frame);
    }

    callback();
  }

  _flush(callback) {
    // Pad last frame with silence if needed
    if (this._buffer.length > 0) {
      const padded = Buffer.alloc(this._frameBytes);
      this._buffer.copy(padded);
      this.push(padded);
    }
    callback();
  }
}

/**
 * Convert PCM buffer to base64 string, chunked for Realtime API.
 * Sends base64 chunks on a timer to maintain ~real-time streaming.
 */
export function pcmToBase64(pcmBuffer) {
  return pcmBuffer.toString('base64');
}
