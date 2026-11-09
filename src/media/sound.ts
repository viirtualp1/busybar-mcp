// The Bar plays `.snd`: raw mono signed 16-bit little-endian PCM at 44.1 kHz,
// the output of the firmware's scripts/audio.py.
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readSource } from './source.js';

export type Wave = 'square' | 'sine' | 'triangle' | 'saw';

const run = promisify(execFile);

export const SAMPLE_RATE = 44_100;

export const MAX_SECONDS = 15;

const NOTE_OFFSETS: Record<string, number> = { c: -9, d: -7, e: -5, f: -4, g: -2, a: 0, b: 2 };

/** Decodes PCM (8/16/24/32-bit) and float WAV, mixing down to mono. */
function decodeWav(bytes: Buffer) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file');
  }

  let format = 0;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ') {
      format = bytes.readUInt16LE(body);
      channels = bytes.readUInt16LE(body + 2);
      rate = bytes.readUInt32LE(body + 4);
      bits = bytes.readUInt16LE(body + 14);

      if (format === 0xfffe) {
        format = bytes.readUInt16LE(body + 24);
      }
    }

    if (id === 'data') {
      const bytesPerSample = bits / 8;
      const frames = Math.floor(Math.min(size, bytes.length - body) / (bytesPerSample * channels));
      const samples = new Float32Array(frames);

      for (let frame = 0; frame < frames; frame++) {
        let sum = 0;

        for (let ch = 0; ch < channels; ch++) {
          const at = body + (frame * channels + ch) * bytesPerSample;
          sum += readSample(bytes, at, format, bits);
        }

        samples[frame] = sum / channels;
      }

      return { samples, rate };
    }

    offset = body + size + (size % 2);
  }

  throw new Error('WAV has no data');
}

function readSample(bytes: Buffer, at: number, format: number, bits: number) {
  if (format === 3 && bits === 32) return bytes.readFloatLE(at);
  if (format === 3 && bits === 64) return bytes.readDoubleLE(at);
  if (format !== 1) throw new Error(`Unsupported WAV encoding ${format}`);
  if (bits === 8) return (bytes.readUInt8(at) - 128) / 128;
  if (bits === 16) return bytes.readInt16LE(at) / 32768;
  if (bits === 24) return bytes.readIntLE(at, 3) / 8388608;
  if (bits === 32) return bytes.readInt32LE(at) / 2147483648;
  throw new Error(`Unsupported WAV bit depth ${bits}`);
}

function resample(samples: Float32Array, rate: number) {
  if (rate === SAMPLE_RATE) {
    return samples;
  }

  const out = new Float32Array(Math.floor((samples.length * SAMPLE_RATE) / rate));
  const step = rate / SAMPLE_RATE;

  for (let i = 0; i < out.length; i++) {
    const at = i * step;
    const left = Math.floor(at);
    const right = Math.min(left + 1, samples.length - 1);
    out[i] = samples[left] + (samples[right] - samples[left]) * (at - left);
  }

  return out;
}

/** Peak-normalises to 90%: the Bar's speaker is small, and a quiet file is easy to miss. */
function toSnd(samples: Float32Array) {
  const limit = Math.min(samples.length, SAMPLE_RATE * MAX_SECONDS);
  let peak = 0;

  for (let i = 0; i < limit; i++) {
    peak = Math.max(peak, Math.abs(samples[i]));
  }

  const gain = peak > 0 ? 0.9 / peak : 1;
  const out = Buffer.alloc(limit * 2);

  for (let i = 0; i < limit; i++) {
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * gain)) * 32767), i * 2);
  }

  return out;
}

/** MP3, M4A, AIFF and the rest: ffmpeg if installed, else macOS's own afconvert. */
async function convertWithTools(bytes: Buffer) {
  const dir = mkdtempSync(join(tmpdir(), 'busybar-snd-'));
  const input = join(dir, 'in');
  const output = join(dir, 'out.wav');
  const ffmpeg = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find((path) => existsSync(path));

  writeFileSync(input, bytes);

  try {
    if (ffmpeg) {
      await run(ffmpeg, ['-y', '-i', input, '-ac', '1', '-ar', String(SAMPLE_RATE), '-acodec', 'pcm_s16le', output]);
    } else if (platform() === 'darwin') {
      await run('/usr/bin/afconvert', ['-f', 'WAVE', '-d', `LEI16@${SAMPLE_RATE}`, '-c', '1', input, output]);
    } else {
      throw new Error('Only WAV is supported without ffmpeg');
    }

    return readFileSync(output);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Any audio file → `.snd` bytes. `.snd` passes through untouched. */
export async function audioToSnd(source: string) {
  const bytes = await readSource(source, 20_000_000);

  if (/\.snd$/i.test(source)) {
    return bytes;
  }

  const wav = bytes.toString('ascii', 0, 4) === 'RIFF' ? bytes : await convertWithTools(bytes);
  const { samples, rate } = decodeWav(wav);

  return toSnd(resample(samples, rate));
}

function frequency(note: string) {
  const match = /^([a-g])([#b]?)(-?\d)$/i.exec(note);

  if (!match) {
    throw new Error(`Bad note "${note}"; use names like C5, F#4, Bb3, or R for a rest`);
  }

  const [, letter, accidental, octave] = match;
  const semitones = NOTE_OFFSETS[letter.toLowerCase()] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) + (Number(octave) - 4) * 12;

  return 440 * 2 ** (semitones / 12);
}

function oscillator(wave: Wave, phase: number) {
  const t = phase - Math.floor(phase);

  switch (wave) {
    case 'sine':
      return Math.sin(2 * Math.PI * t);
    case 'triangle':
      return 1 - 4 * Math.abs(t - 0.5);
    case 'saw':
      return 2 * t - 1;
    default:
      return t < 0.5 ? 1 : -1;
  }
}

/**
 * "C5:200 E5:200 G5:400 R:100 C6:600" → `.snd`. Each token is a note (or R for
 * rest) and a length in ms; notes can be chords joined with + ("C4+E4+G4:500").
 */
export function melodyToSnd(melody: string, wave: Wave = 'square') {
  const tokens = melody.trim().split(/[\s,]+/).filter(Boolean);
  const parts: Float32Array[] = [];
  let total = 0;

  for (const token of tokens) {
    const [notes, ms = '250'] = token.split(':');
    const length = Math.round((Number(ms) / 1000) * SAMPLE_RATE);

    if (!Number.isFinite(length) || length <= 0) {
      throw new Error(`Bad length in "${token}"`);
    }

    total += length;

    if (total > SAMPLE_RATE * MAX_SECONDS) {
      throw new Error(`Melody is longer than ${MAX_SECONDS}s`);
    }

    const part = new Float32Array(length);

    if (!/^(r|rest|-)$/i.test(notes)) {
      const freqs = notes.split('+').map(frequency);
      const fade = Math.max(1, Math.min(Math.round(SAMPLE_RATE * 0.008), Math.floor(length / 4)));

      for (let i = 0; i < length; i++) {
        const envelope = Math.min(1, i / fade, (length - i) / fade);
        const value = freqs.reduce((sum, f) => sum + oscillator(wave, (f * i) / SAMPLE_RATE), 0) / freqs.length;
        part[i] = value * envelope * (wave === 'square' || wave === 'saw' ? 0.5 : 0.9);
      }
    }

    parts.push(part);
  }

  if (total === 0) {
    throw new Error('Melody is empty');
  }

  const samples = new Float32Array(total);
  let at = 0;

  for (const part of parts) {
    samples.set(part, at);
    at += part.length;
  }

  return toSnd(samples);
}
