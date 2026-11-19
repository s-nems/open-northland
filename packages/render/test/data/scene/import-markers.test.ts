import { components, packSnapshotDelta, SnapshotMirror } from '@open-northland/sim';
import { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { ONE } from '../../../src/data/projection/index.js';
import { type ImportMarkerExemption, importMarkersOf } from '../../../src/data/scene/import-markers.js';
import type { AtlasFrame } from '../../../src/data/sprites/index.js';
import { ImportMarkerLayer } from '../../../src/gpu/overlays/import-marker-layer.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import { drawnGeometry, entity, snapshotOf } from '../../support/fixtures.js';

const IMPORTED = components.MISSION_BEHAVIOUR.IMPORTED;
const DOES_NOT_WORK = components.MISSION_BEHAVIOUR.DOES_NOT_WORK;

const VIKING = 1;
const BYZANTINE = 3;
const DRUID_JOB = 20;
const HERO_JOB = 47;
/** Exempts one tribe's hero job, so a test sees the exemption read both the tribe and the job. */
const EXEMPT: ImportMarkerExemption = (tribe, job) => tribe === BYZANTINE && job === HERO_JOB;

const person = (id: number, jobType: number, flags: number, tribe = VIKING) =>
  entity(id, id, 1, { Settler: { tribe, jobType }, MissionBehaviour: { flags } });

describe('importMarkersOf', () => {
  it('marks a person with the import bit unless the exemption names his tribe and job', () => {
    const snap = snapshotOf([
      person(1, DRUID_JOB, IMPORTED | DOES_NOT_WORK),
      person(2, HERO_JOB, IMPORTED, BYZANTINE),
      person(3, HERO_JOB, IMPORTED),
      person(4, DRUID_JOB, DOES_NOT_WORK),
    ]);
    expect(importMarkersOf(snap, EXEMPT)).toEqual([
      { id: 1, x: 1 * ONE, y: 1 * ONE },
      { id: 3, x: 3 * ONE, y: 1 * ONE },
    ]);
  });

  it('drops the marker once a script clears the bit', () => {
    const mirror = new SnapshotMirror();
    const druid = person(1, DRUID_JOB, IMPORTED);
    mirror.apply(
      packSnapshotDelta({
        tick: 1,
        sequence: 0,
        rebuild: true,
        touched: [{ id: 1, components: druid.components, removed: [] }],
        removed: [],
        events: [],
      }),
    );
    expect(importMarkersOf(mirror.snapshot(), EXEMPT).map((m) => m.id)).toEqual([1]);
    mirror.apply(
      packSnapshotDelta({
        tick: 2,
        sequence: 1,
        rebuild: false,
        touched: [{ id: 1, components: { MissionBehaviour: { flags: 0 } }, removed: [] }],
        removed: [],
        events: [],
      }),
    );
    expect(importMarkersOf(mirror.snapshot(), EXEMPT)).toEqual([]);
  });
});

describe('ImportMarkerLayer', () => {
  const FRAME: AtlasFrame = { x: 0, y: 0, width: 64, height: 32, offsetX: 0, offsetY: 0 };
  const gfx = {
    source: new TextureSource({ width: 64, height: 32 }),
    frame: FRAME,
    exempt: EXEMPT,
    textures: new TextureCache(),
  };

  it('hangs the icon only over a marked person the pool drew this frame', () => {
    const layer = new ImportMarkerLayer();
    layer.setGfx(gfx);
    const snapshot = snapshotOf([person(1, DRUID_JOB, IMPORTED), person(2, DRUID_JOB, IMPORTED)]);
    const drawn = drawnGeometry({
      boundsOf: (ref) => (ref === 1 ? { minX: 0, minY: 0, maxX: 10, maxY: 30 } : undefined),
    });
    const markers = importMarkersOf(snapshot, EXEMPT);
    layer.draw({ markers, drawn });
    expect(layer.container.children).toHaveLength(1);
    layer.draw({ markers, drawn: drawnGeometry() });
    expect(layer.container.children).toHaveLength(0);
    layer.destroy();
  });
});
