import { describe, expect, it } from 'vitest';
import { decimateByTwo } from '../src/stages/music/resample.js';

const RATE = 44100;

function sine(freq: number, frames: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / RATE);
  return out;
}

function rms(x: Float32Array, skipEdges: number): number {
  let sum = 0;
  let n = 0;
  for (let i = skipEdges; i < x.length - skipEdges; i++) {
    const v = x[i] ?? 0;
    sum += v * v;
    n++;
  }
  return Math.sqrt(sum / n);
}

describe('decimateByTwo', () => {
  it('halves the length and keeps the passband level', () => {
    const out = decimateByTwo(sine(3000, RATE));
    expect(out.length).toBe(RATE / 2);
    const db = 20 * Math.log10(rms(out, 100) / Math.SQRT1_2);
    expect(Math.abs(db)).toBeLessThan(1);
  });

  it('rejects content above the new Nyquist', () => {
    const out = decimateByTwo(sine(15000, RATE));
    const db = 20 * Math.log10(rms(out, 100) / Math.SQRT1_2);
    expect(db).toBeLessThan(-40);
  });
});
