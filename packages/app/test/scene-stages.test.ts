// @vitest-environment jsdom
import { type LaneCounts, type SoundStatsView, zeroLanes } from '@open-northland/audio';
import type { Camera } from '@open-northland/render';
import type { Command, PlayerCommand, WorldSnapshot } from '@open-northland/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diag } from '../src/diag/index.js';
import type { SceneStage } from '../src/scenes/types.js';
import { cameraCenteredOnTile } from '../src/view/camera/index.js';
import { mountSceneStages } from '../src/view/scene-stages.js';

/**
 * The scene stage bar: a stage button frames its place, a stage's buttons issue the viewer's orders
 * through the HUD path and the other seats' as trusted input, and while a stage is open the bar logs
 * what the sound driver was offered and started.
 */

const VIEWPORT = { width: 800, height: 600 } as const;
const MOVE: PlayerCommand = { kind: 'moveUnitGroup', members: [{ entity: 7 as never, x: 2, y: 2 }] };
const RAID: Command = { kind: 'attackMoveUnitGroup', members: [{ entity: 9 as never, x: 4, y: 4 }] };
const NEAR = 1;
const FAR = 0.35;
const stages: readonly SceneStage[] = [
  {
    id: 'orders',
    focus: { x: 10, y: 12 },
    zoom: NEAR,
    actions: [
      {
        label: 'move',
        values: { size: 1 },
        kind: 'orders',
        orders: () => [
          { by: 'viewer', command: MOVE },
          { by: 'admin', command: RAID },
        ],
      },
      { label: 'zoomFar', kind: 'zoom', zoom: FAR },
    ],
  },
];

let frameCallbacks: FrameRequestCallback[] = [];
let now = 0;
/** Run the bar's next animation frame `ms` after the last. */
function tick(ms: number): void {
  now += ms;
  const callbacks = frameCallbacks;
  frameCallbacks = [];
  for (const cb of callbacks) cb(now);
}

beforeEach(() => {
  frameCallbacks = [];
  now = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frameCallbacks.push(cb));
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('scene stage bar', () => {
  it('frames a stage, issues its orders by seat and zooms on its zoom buttons', () => {
    const jumps: Camera[] = [];
    const issued: PlayerCommand[] = [];
    const admitted: Command[] = [];
    const lifetime = new AbortController();
    mountSceneStages({
      sceneId: 'audio-mix',
      stages,
      host: { snapshot: () => ({ tick: 0, entities: [], events: [] }) as WorldSnapshot },
      cameraCtl: { jumpTo: (camera) => jumps.push(camera) },
      viewport: () => VIEWPORT,
      issue: (command) => issued.push(command),
      submitAdmin: (command) => admitted.push(command),
      soundStats: () => null,
      signal: lifetime.signal,
    });
    const buttons = (row: number) => [
      ...document.querySelectorAll<HTMLButtonElement>(`[data-scene-stages] > div:nth-child(${row}) > button`),
    ];
    buttons(1)[0]?.click();
    expect(jumps.at(-1)).toEqual(cameraCenteredOnTile(10, 12, NEAR, VIEWPORT.width, VIEWPORT.height));
    expect(buttons(2).map((b) => b.textContent)).toEqual(['Ruch 1', 'Daleko']);
    buttons(2)[0]?.click();
    expect(issued).toEqual([MOVE]);
    expect(admitted).toEqual([RAID]);
    buttons(2)[1]?.click();
    expect(jumps.at(-1)?.scale).toBe(FAR);
    lifetime.abort();
    expect(document.querySelector('[data-scene-stages]')).toBeNull();
  });

  it('logs each second what the driver was offered and started per lane', () => {
    const offered = zeroLanes();
    const started = zeroLanes();
    const stats: { frames: number; stolen: number; offered: LaneCounts; started: LaneCounts } = {
      frames: 0,
      stolen: 0,
      offered,
      started,
    };
    const info = vi.spyOn(diag, 'info').mockImplementation(() => undefined);
    mountSceneStages({
      sceneId: 'audio-mix',
      stages,
      host: { snapshot: () => ({ tick: 0, entities: [], events: [] }) as WorldSnapshot },
      cameraCtl: { jumpTo: () => undefined },
      viewport: () => VIEWPORT,
      issue: () => undefined,
      submitAdmin: () => undefined,
      soundStats: (): SoundStatsView => stats,
      signal: new AbortController().signal,
    });
    document.querySelector<HTMLButtonElement>('[data-scene-stages] button')?.click();
    tick(0); // primes the counts
    stats.frames += 2;
    offered.sfx += 30;
    started.sfx += 12;
    stats.stolen += 3;
    tick(500);
    offered.sfx += 10;
    started.sfx += 2;
    tick(600);
    expect(info).toHaveBeenCalledWith('audio', 'stage orders', {
      frames: 2,
      lanes: { sfx: '14 of 40 started, 26 dropped' },
      stolen: 3,
      busiestFrame: { offered: 30, started: 12 },
    });
  });
});
