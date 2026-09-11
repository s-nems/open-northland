import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { carriedParams } from '../src/view/params.js';

describe('own terrain delivery', () => {
  it('ships the sand material and bindings unchanged', () => {
    for (const name of ['sand.png', 'sand-materials.json']) {
      const source = new URL(`../../../docs/art/terrain/sand/${name}`, import.meta.url);
      const runtime = new URL(`../src/assets/own/terrain/${name}`, import.meta.url);
      expect(readFileSync(runtime).equals(readFileSync(source))).toBe(true);
    }
  });
  it('ships the continuous mountain composition unchanged', () => {
    for (const name of ['mountains.png', 'rock-materials.json']) {
      const source = new URL(`../../../docs/art/terrain/mountains/${name}`, import.meta.url);
      const runtime = new URL(`../src/assets/own/terrain/${name}`, import.meta.url);
      expect(readFileSync(runtime).equals(readFileSync(source))).toBe(true);
    }
  });
  it('ships the selected rock ground pack unchanged', () => {
    for (const name of ['gravel.png']) {
      const source = new URL(`../../../docs/art/terrain/gravel/${name}`, import.meta.url);
      const runtime = new URL(`../src/assets/own/terrain/${name}`, import.meta.url);
      expect(readFileSync(runtime).equals(readFileSync(source))).toBe(true);
    }
  });
  it('ships byte-identical selected exports', () => {
    for (const name of ['grass-base.png', 'map-bindings.json']) {
      const source = new URL(`../../../docs/art/terrain/grass/${name}`, import.meta.url);
      const runtime = new URL(`../src/assets/own/terrain/${name}`, import.meta.url);
      expect(readFileSync(runtime).equals(readFileSync(source))).toBe(true);
    }
  });
  it('keeps own assets when navigating through the menu', () => {
    expect(carriedParams(new URLSearchParams('map=magiczny_las&assets=own')).toString()).toBe('assets=own');
  });
  it('ships the meadow material pack and soil master unchanged', () => {
    for (const name of ['quiet.png', 'dark.png', 'materials.json', 'soil.png']) {
      const directory = name === 'soil.png' ? 'grass' : 'meadow-ground';
      const source = new URL(`../../../docs/art/terrain/${directory}/${name}`, import.meta.url);
      const runtime = new URL(`../src/assets/own/terrain/${name}`, import.meta.url);
      expect(readFileSync(runtime).equals(readFileSync(source))).toBe(true);
    }
  });
});
