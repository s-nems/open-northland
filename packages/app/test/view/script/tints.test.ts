import { VERTEX_PALETTE_ENTRIES } from '@open-northland/data';
import { type LightGrade, shownGrade } from '@open-northland/render/data';
import { type LandscapeEditView, TICKS_PER_SECOND } from '@open-northland/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vertexPalette from '../../../src/content/vertex-palette.js';
import type { SessionHost } from '../../../src/session/index.js';
import { cellColorsToCorners, mountScriptTints, splitScriptTints } from '../../../src/view/script/tints.js';

/** 40 minutes past daybreak: the cycle's long night. */
const NIGHT_TICK = 2400 * TICKS_PER_SECOND;
const NEUTRAL = 0;
const DARK = 5;
const TORCH = 9;
const WARM = 11;
const DIM = 13;
/** The cycle's night in the game's own chain. */
const CYCLE_NIGHT = 58;
const palette: readonly number[] = Array.from({ length: VERTEX_PALETTE_ENTRIES }, (_, index) => {
  if (index === DARK) return 0x404040;
  if (index === TORCH) return 0xc08040;
  if (index === WARM) return 0xac9373;
  if (index === DIM || index === CYCLE_NIGHT) return 0x606060;
  return 0x808080;
});

const loadVertexPalette = vi.fn(async () => [...palette]);
beforeEach(() => {
  vi.spyOn(vertexPalette, 'loadVertexPalette').mockImplementation(loadVertexPalette);
});
afterEach(() => vi.restoreAllMocks());

/** Seven dark cells (70%, a whole-map tint), one never tinted, two under a torch. */
const tints = Uint8Array.from([DARK, DARK, DARK, DARK, DARK, DARK, DARK, NEUTRAL, TORCH, TORCH]);

const rgbAt = (colors: Float32Array, node: number): number[] =>
  Array.from(colors.slice(node * 3, node * 3 + 3));

describe('splitScriptTints', () => {
  it('grades the scene with the dominant tint as written and softens a torch glow under its darkness', () => {
    const { scene, colors } = splitScriptTints(tints, palette);
    expect(scene).toEqual([0.5, 0.5, 0.5]);
    for (const node of [0, 6, 7]) expect(rgbAt(colors, node)).toEqual([1, 1, 1]);
    // (1.5, 1, 0.5) asked: a fifth of its excess over 1, not divided by the scene.
    expect(rgbAt(colors, 8).map((c) => Number(c.toFixed(3)))).toEqual([1.1, 1, 0.9]);
  });

  it('divides a dimming local tint by the scene as the scene light shows it', () => {
    const dimmed = Uint8Array.from([DARK, DARK, DARK, DARK, DARK, DARK, DARK, NEUTRAL, DIM, DIM]);
    const { colors } = splitScriptTints(dimmed, palette);
    const shown = shownGrade([0.5, 0.5, 0.5], [1, 1, 1]);
    // 0x606060 asked: its 0.75 over the shown night's multiply, so the product is what the script asked.
    expect(rgbAt(colors, 8).map((c) => Number(c.toFixed(3)))).toEqual(
      shown.map((c) => Number((0.75 / c).toFixed(3))),
    );
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
    const split = splitScriptTints(tints, palette, undefined, () => WARM);
    expect(split.scene?.[0]).toBeGreaterThan(1);
    // 0x40 grey over the scene's (1, 1, 0.898) multiply.
    expect(rgbAt(split.colors, 0).map((c) => Number(c.toFixed(3)))).toEqual([0.5, 0.5, 0.557]);
  });

  it('darkens with a cycle of its own: local tints undivided on a neutral dominant', () => {
    const NEUTRAL_TWIN = 53;
    const cells = Uint8Array.from([...new Array<number>(9).fill(NEUTRAL_TWIN), DIM]);
    const split = splitScriptTints(cells, palette, undefined, undefined, [0.5, 0.5, 0.5]);
    expect(split.scene).toEqual([0.5, 0.5, 0.5]);
    expect(rgbAt(split.colors, 9)).toEqual([0.75, 0.75, 0.75]);
  });

  it("lets a map's tint darken the cycle and never brighten it", () => {
    const cycle: LightGrade = [0.5, 0.5, 0.5];
    const dark = splitScriptTints(new Uint8Array(10).fill(DARK), palette, undefined, undefined, cycle);
    expect(dark.scene).toEqual([0.25, 0.25, 0.25]);
    expect(rgbAt(dark.colors, 0)).toEqual([1, 1, 1]);
    const sun = splitScriptTints(new Uint8Array(10).fill(TORCH), palette, undefined, undefined, cycle);
    expect(sun.scene).toEqual([0.5, 0.5, 0.25]);
  });

  it('holds daylight over the dominant index, the ground included', () => {
    const split = splitScriptTints(tints, palette, undefined, () => NEUTRAL);
    expect(split.scene).toBeNull();
    expect(rgbAt(split.colors, 0)).toEqual([1, 1, 1]);
  });
});

describe('cellColorsToCorners', () => {
  // A 2x3 cell map whose cells carry 1..6 in red. Nodes are 4x6.
  const cells = Float32Array.from(Array.from({ length: 6 }, (_, cell) => [cell + 1, 1, 1]).flat());
  const red = (colors: Float32Array, hx: number, hy: number) => colors[(hy * 4 + hx) * 3];

  it("puts each cell's colour on its corner node, odd cell rows half a cell east, and others neutral", () => {
    const colors = cellColorsToCorners(cells, 2);
    expect(colors).toHaveLength(4 * 6 * 3);
    expect([red(colors, 0, 0), red(colors, 2, 0)]).toEqual([1, 2]);
    expect([red(colors, 1, 2), red(colors, 3, 2)]).toEqual([3, 4]);
    expect([red(colors, 0, 4), red(colors, 2, 4)]).toEqual([5, 6]);
    for (const [hx, hy] of [
      [1, 0],
      [0, 1],
      [2, 2],
      [3, 3],
    ] as const)
      expect(red(colors, hx, hy)).toBe(1);
  });

  it('reuses a fitting buffer', () => {
    const out = new Float32Array(4 * 6 * 3).fill(9);
    expect(cellColorsToCorners(cells, 2, out)).toBe(out);
    expect(out[(1 * 4 + 0) * 3]).toBe(1);
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

/** The tints as one row of cells. */
const edits = (values: Uint8Array): LandscapeEditView => ({
  revision: 1,
  removed: [],
  added: [],
  tints: values,
  tintColumns: values.length,
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

  describe('day and night', () => {
    const WHOLE_MAP = 900;
    const cycling = (tintState: Uint8Array) =>
      ({
        ...tintingHost([edits(tintState), edits(tintState), edits(tintState)]),
        missions: {
          missions: [
            {
              results: [
                { opcode: 'SetVertexColor', range: WHOLE_MAP, amount: DARK },
                { opcode: 'SetVertexColor', range: WHOLE_MAP, amount: WARM },
              ],
            },
          ],
        },
      }) as unknown as Parameters<typeof mountScriptTints>[0];

    it('holds a scripted cycle at daylight when the rule turns it off', async () => {
      const drawn = surface();
      const scriptTints = await mountScriptTints(cycling(tints), drawn, { dayNight: 'off' });
      await landed();
      expect(drawn.lights).toEqual([null]);
      scriptTints.dispose();
    });

    it("follows the player's setting live, over the map's own rule", async () => {
      const drawn = surface();
      const scriptTints = await mountScriptTints(cycling(tints), drawn, { dayNightShown: false });
      await landed();
      expect(drawn.lights).toEqual([null]);
      scriptTints.setDayNightShown(true);
      await landed();
      expect(drawn.lights[1]).toEqual([0.5, 0.5, 0.5]);
      scriptTints.dispose();
    });

    it("keeps a single dark write: a cave's mood is no cycle", async () => {
      const drawn = surface();
      const cave = tintingHost([edits(tints)]);
      const scriptTints = await mountScriptTints(cave, drawn, { dayNight: 'off' });
      await landed();
      expect(drawn.lights).toEqual([[0.5, 0.5, 0.5]]);
      scriptTints.dispose();
    });

    it("steps the game's own cycle on a map without one, and only on a step's change", async () => {
      const drawn = surface();
      const clear = new Uint8Array(10);
      const host = { missions: undefined, landscapeEdits: () => Promise.resolve(edits(clear)) };
      const scriptTints = await mountScriptTints(host, drawn, { dayNight: 'on' });
      await landed();
      expect(drawn.lights).toEqual([null]);
      scriptTints.frame(1);
      await landed();
      expect(drawn.lights).toHaveLength(1);
      scriptTints.frame(NIGHT_TICK);
      await landed();
      expect(drawn.lights).toHaveLength(2);
      expect(drawn.lights[1]).not.toBeNull();
      scriptTints.dispose();
    });

    it("darkens the game's cycle with a map's own whole-map tint", async () => {
      const drawn = surface();
      const host = { missions: undefined, landscapeEdits: () => Promise.resolve(edits(tints)) };
      const scriptTints = await mountScriptTints(host, drawn, { dayNight: 'on', tick: NIGHT_TICK });
      await landed();
      expect(drawn.lights).toEqual([[0.375, 0.375, 0.375]]);
      scriptTints.dispose();
    });

    it('holds a pinned tint over the rule and the cycle', async () => {
      const drawn = surface();
      const scriptTints = await mountScriptTints(cycling(tints), drawn, {
        pinnedIndex: DIM,
        dayNight: 'off',
      });
      await landed();
      expect(drawn.lights).toEqual([[0.75, 0.75, 0.75]]);
      scriptTints.dispose();
      const own = surface();
      const clear = { missions: undefined, landscapeEdits: () => Promise.resolve(edits(new Uint8Array(10))) };
      const pinned = await mountScriptTints(clear, own, {
        pinnedIndex: DIM,
        dayNight: 'on',
        tick: NIGHT_TICK,
      });
      await landed();
      expect(own.lights).toEqual([[0.75, 0.75, 0.75]]);
      pinned.dispose();
    });

    const raining = (opcodes: readonly number[]) =>
      ({
        ...tintingHost([edits(tints), edits(tints), edits(tints)]),
        missions: {
          missions: [
            {
              results: [
                { opcode: 'SetWeather' },
                ...opcodes.map((amount) => ({ opcode: 'SetVertexColor', range: WHOLE_MAP, amount })),
              ],
            },
          ],
        },
      }) as unknown as Parameters<typeof mountScriptTints>[0];

    it("clears a script's weather tint with the weather, live", async () => {
      const drawn = surface();
      const scriptTints = await mountScriptTints(raining([NEUTRAL, DARK]), drawn, { weatherShown: false });
      await landed();
      expect(drawn.lights).toEqual([null]);
      scriptTints.setWeatherShown(true);
      await landed();
      expect(drawn.lights[1]).toEqual([0.5, 0.5, 0.5]);
      scriptTints.dispose();
    });

    it("keeps a colour written once when the weather is off: that is the map's look", async () => {
      const drawn = surface();
      const scriptTints = await mountScriptTints(raining([DARK]), drawn, { weatherShown: false });
      await landed();
      expect(drawn.lights).toEqual([[0.5, 0.5, 0.5]]);
      scriptTints.dispose();
    });
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
