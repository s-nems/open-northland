import { VERTEX_PALETTE_ENTRIES } from '@open-northland/data';
import type { LightGrade } from '@open-northland/render/data';
import type { LandscapeEditView } from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import type { SessionHost } from '../src/session/index.js';
import { mountScriptTints, splitScriptTints } from '../src/view/runtime/script-tints.js';

const NEUTRAL = 0;
const DARK = 5;
const TORCH = 9;
const WARM = 11;
const palette: readonly number[] = Array.from({ length: VERTEX_PALETTE_ENTRIES }, (_, index) => {
  if (index === DARK) return 0x404040;
  if (index === TORCH) return 0xc08040;
  if (index === WARM) return 0xac9373;
  return 0x808080;
});

const loadVertexPalette = vi.fn(async () => palette);
vi.mock('../src/content/vertex-palette.js', () => ({ loadVertexPalette: () => loadVertexPalette() }));

/** Seven dark nodes (70%, a whole-map tint), one never tinted, two under a torch. */
const tints = Uint8Array.from([DARK, DARK, DARK, DARK, DARK, DARK, DARK, NEUTRAL, TORCH, TORCH]);

const rgbAt = (colors: Float32Array, node: number): number[] =>
  Array.from(colors.slice(node * 3, node * 3 + 3));

describe('splitScriptTints', () => {
  it('grades the scene with the dominant tint as written and keeps the torches relative to it', () => {
    const { scene, colors } = splitScriptTints(tints, palette);
    expect(scene).toEqual([0.5, 0.5, 0.5]);
    for (const node of [0, 6, 7]) expect(rgbAt(colors, node)).toEqual([1, 1, 1]);
    expect(rgbAt(colors, 8)).toEqual([3, 2, 1]); // (1.5, 1, 0.5) asked, over a 0.5 scene
  });

  it('treats a tint under the whole-map share, or a neutral one, as no scene tint', () => {
    const half = Uint8Array.from([DARK, DARK, DARK, DARK, DARK, NEUTRAL, NEUTRAL, NEUTRAL, TORCH, TORCH]);
    const split = splitScriptTints(half, palette);
    expect(split.scene).toBeNull();
    expect(rgbAt(split.colors, 0)).toEqual([0.5, 0.5, 0.5]);
    expect(rgbAt(split.colors, 9)).toEqual([1.5, 1, 0.5]);
    const reset = new Uint8Array(10).fill(NEUTRAL);
    reset.set([TORCH, TORCH, TORCH], 7);
    expect(splitScriptTints(reset, palette).scene).toBeNull();
  });

  it('passes a brightening tint through above 1 and reuses a fitting buffer', () => {
    const warm = new Uint8Array(10).fill(WARM);
    warm[9] = TORCH;
    const out = new Float32Array(30);
    const split = splitScriptTints(warm, palette, out);
    const rounded = (values: number[]) => values.map((c) => Number(c.toFixed(3)));
    expect(rounded([...(split.scene ?? [])])).toEqual([1.344, 1.148, 0.898]);
    expect(rgbAt(split.colors, 0)).toEqual([1, 1, 1]);
    // A torch under it shows its own colour: its palette over the scene's (1, 1, 0.898) multiply.
    expect(rounded(rgbAt(split.colors, 9))).toEqual([1.5, 1, 0.557]);
    expect(split.colors).toBe(out);
  });

  it('holds a pinned index as the whole-map tint', () => {
    const split = splitScriptTints(tints, palette, undefined, WARM);
    expect(split.scene?.[0]).toBeGreaterThan(1);
    // 0x40 grey over the scene's (1, 1, 0.898) multiply.
    expect(rgbAt(split.colors, 0).map((c) => Number(c.toFixed(3)))).toEqual([0.5, 0.5, 0.557]);
  });
});

function tintingHost(answers: LandscapeEditView[]): Pick<SessionHost, 'missions' | 'landscapeEdits'> {
  return {
    missions: {
      missions: [
        { results: [{ opcode: 'SetVertexColor', point: { hx: 0, hy: 0 }, range: 900, amount: DARK }] },
      ],
    } as unknown as SessionHost['missions'],
    landscapeEdits: () => {
      const next = answers.shift();
      return next === undefined ? new Promise(() => undefined) : Promise.resolve(next);
    },
  };
}

const edits = (values: Uint8Array): LandscapeEditView => ({
  revision: 1,
  removed: [],
  added: [],
  tints: values,
});
const landed = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function surface() {
  return {
    lights: [] as (LightGrade | null)[],
    snaps: [] as boolean[],
    colors: [] as Float32Array[],
    setSceneLight(target: LightGrade | null, snap = false) {
      this.lights.push(target === null ? null : [...target]);
      this.snaps.push(snap);
    },
    applyTerrainVertexColors(colors: Float32Array) {
      this.colors.push(colors.slice());
    },
  };
}

describe('mountScriptTints', () => {
  it('follows the script: the loaded state snaps, a step fades, and only the latest answer lands', async () => {
    const drawn = surface();
    const scriptTints = await mountScriptTints(
      tintingHost([edits(tints), edits(new Uint8Array(10)), edits(new Uint8Array(10).fill(WARM))]),
      drawn,
    );
    await landed();
    expect(drawn.lights).toEqual([[0.5, 0.5, 0.5]]);
    scriptTints.onEvents([{ kind: 'missionVertexColor' }, { kind: 'missionVertexColor' }]);
    scriptTints.onEvents([{ kind: 'missionVertexColor' }]);
    await landed();
    // One sync per batch of events, and of the two in flight only the later one lands.
    expect(drawn.lights).toHaveLength(2);
    expect(drawn.lights[1]?.[0]).toBeGreaterThan(1);
    expect(drawn.snaps).toEqual([true, false]);
    expect(drawn.colors).toHaveLength(2);
    scriptTints.dispose();
  });

  it('snaps the loaded state even when a first-tick write stales the first answer', async () => {
    const drawn = surface();
    const host = tintingHost([edits(new Uint8Array(10)), edits(tints)]);
    // The first answer is still in flight when the script's first write arrives.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const answers = host.landscapeEdits;
    host.landscapeEdits = () => {
      const answer = answers();
      return held.then(() => answer);
    };
    const scriptTints = await mountScriptTints(host, drawn);
    scriptTints.onEvents([{ kind: 'missionVertexColor' }]);
    release();
    await landed();
    expect(drawn.snaps).toEqual([true]);
    expect(drawn.lights).toEqual([[0.5, 0.5, 0.5]]);
    scriptTints.dispose();
  });

  it('grades a map its author tinted even when its script never writes a tint', async () => {
    const drawn = surface();
    const landscapeEdits = vi.fn(() => Promise.resolve(edits(tints)));
    const scriptTints = await mountScriptTints({ missions: undefined, landscapeEdits }, drawn);
    await landed();
    expect(drawn.lights).toEqual([[0.5, 0.5, 0.5]]);
    expect(drawn.snaps).toEqual([true]);
    scriptTints.dispose();
  });

  it('fetches no palette for a map that neither its author nor its script tints', async () => {
    loadVertexPalette.mockClear();
    const drawn = surface();
    const landscapeEdits = vi.fn(() => Promise.resolve(edits(new Uint8Array(10))));
    const scriptTints = await mountScriptTints({ missions: undefined, landscapeEdits }, drawn);
    await landed();
    scriptTints.onEvents([{ kind: 'missionVertexColor' }]);
    await landed();
    expect(landscapeEdits).toHaveBeenCalledTimes(1);
    expect(loadVertexPalette).not.toHaveBeenCalled();
    expect(drawn.lights).toEqual([]);
  });
});
