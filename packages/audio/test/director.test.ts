import type { GfxPattern, SoundBank, TerrainPattern } from '@open-northland/data';
import type { Camera } from '@open-northland/render/data';
import { ONE, tileToScreen } from '@open-northland/render/data';
import type { Entity, SimEvent, WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  type AudioTerrain,
  buildSoundIndex,
  CHAT_VOICE_GAIN,
  defaultBindings,
  directAudio,
  JINGLE_GAIN,
  type SoundBindings,
} from '../src/index.js';

/**
 * The pure director: sim events + snapshot + camera → the sounds that should be audible. Jingles fire
 * non-spatially; action SFX are viewport-culled + positioned; unbound events are ignored; on-screen
 * terrain drives ambient loops. All headless — no AudioContext.
 */
const bank: SoundBank = {
  staticGroups: [
    { name: 'Hammer Wood', sfx: [{ file: 'static/hammer01.wav', params: [80] }] },
    { name: 'Woodcutter Axe', sfx: [{ file: 'static/axe01.wav', params: [80] }] },
    // Combat impact groups (the weapon-specific melee hits + the bow shot/arrow-hit).
    { name: 'Weapon Sword Short Hit', sfx: [{ file: 'static/swordhit01.wav', params: [80] }] },
    { name: 'Weapon Spear Hit', sfx: [{ file: 'static/spearhit01.wav', params: [80] }] },
    { name: 'Weapon Bow Long', sfx: [{ file: 'static/bow01.wav', params: [80] }] },
    { name: 'Weapon Bow Hit', sfx: [{ file: 'static/arrowhit01.wav', params: [80] }] },
    // The chat voice pair — resolved by logicSoundType id (the talk clip's authored voice cue).
    { name: 'SocialTalk Male', logicSoundType: 61, sfx: [{ file: 'voice/male_social.wav', params: [80] }] },
    {
      name: 'SocialTalk Female',
      logicSoundType: 62,
      sfx: [{ file: 'voice/female_social.wav', params: [80] }],
    },
  ],
  ambient: [
    {
      name: 'Meadow Green',
      patternGroups: ['meadow green'],
      landscapeGroups: [],
      sfx: [{ file: 'ambient/meadow1.wav', params: [0, 0, 0] }],
    },
  ],
  jingles: [
    { name: '', musicType: 26, sfx: [{ file: 'jingles/jingles_housebuilt.wav', params: [] }] },
    { name: '', musicType: 23, sfx: [{ file: 'jingles/jingles_birth.wav', params: [] }] },
    { name: '', musicType: 25, sfx: [{ file: 'jingles/jingles_death.wav', params: [] }] },
  ],
};
const gfxPatterns = [{ id: 5, editGroups: ['meadow green'] }] as unknown as GfxPattern[];
const terrainPatterns = [{ typeId: 1, patternId: 5 }] as unknown as TerrainPattern[];

const CHOP_ATOMIC = 9;
const BUILD_ATOMIC = 39;
const index = buildSoundIndex(bank, gfxPatterns, terrainPatterns);
const bindings = defaultBindings({ chopAtomicId: CHOP_ATOMIC, buildAtomicId: BUILD_ATOMIC });

const CANVAS_W = 800;
const CANVAS_H = 600;
const entity = (id: number): Entity => id as Entity;
// Centre the camera on tile (5,5) — computed through the live projection so the fixture stays
// valid whatever the calibrated pitch/model is (a hand-baked offset broke on every recalibration).
const centre = tileToScreen(5, 5);
const camera: Camera = {
  offsetX: CANVAS_W / 2 - centre.x,
  offsetY: CANVAS_H / 2 - centre.y,
  scale: 1,
};

/** A snapshot with a settler (id 3) and a building (id 7), both at tile (5,5). */
function snapshotAt(events: readonly SimEvent[] = []): WorldSnapshot {
  const at = { x: 5 * ONE, y: 5 * ONE };
  return {
    tick: 1,
    entities: [
      { id: 3, components: { Position: at, Settler: {} } },
      { id: 7, components: { Position: at, Building: { buildingType: 2 } } },
    ],
    events,
  };
}

function direct(
  events: readonly SimEvent[],
  opts: {
    terrain?: AudioTerrain;
    localPlayer?: number;
    bindings?: SoundBindings;
    visibleTile?: (col: number, row: number) => boolean;
  } = {},
) {
  return directAudio({
    events,
    snapshot: snapshotAt(events),
    camera,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
    index,
    bindings: opts.bindings ?? bindings,
    ...(opts.terrain !== undefined ? { terrain: opts.terrain } : {}),
    ...(opts.localPlayer !== undefined ? { localPlayer: opts.localPlayer } : {}),
    ...(opts.visibleTile !== undefined ? { visibleTile: opts.visibleTile } : {}),
  });
}

describe('directAudio one-shots', () => {
  it('fires a positioned action SFX for an on-screen building placement', () => {
    // `at` is a half-cell node: cell (5,5) anchors at node (11,10) — the same screen point as tile (5,5).
    const frame = direct([{ kind: 'buildingPlaced', entity: entity(7), at: { hx: 11, hy: 10 } }]);
    expect(frame.oneShots).toHaveLength(1);
    const shot = frame.oneShots[0];
    expect(shot?.files).toEqual(['static/hammer01.wav']);
    expect(shot?.gain).toBeGreaterThan(0);
    expect(shot?.pan).toBeCloseTo(0, 5); // centred emitter
    expect(shot?.key).toBe('buildingPlaced:11,10');
  });

  it('fires a non-spatial jingle for a building finishing', () => {
    const frame = direct([{ kind: 'buildingFinished', entity: entity(7) }]);
    expect(frame.oneShots).toHaveLength(1);
    expect(frame.oneShots[0]?.files).toEqual(['jingles/jingles_housebuilt.wav']);
    expect(frame.oneShots[0]?.gain).toBeCloseTo(JINGLE_GAIN, 5);
    expect(frame.oneShots[0]?.pan).toBe(0);
    expect(frame.oneShots[0]?.key).toBe('buildingFinished:7');
  });

  it('positions a chop SFX at the working settler via the atomic binding', () => {
    const frame = direct([{ kind: 'atomicCompleted', entity: entity(3), atomicId: CHOP_ATOMIC }]);
    expect(frame.oneShots).toHaveLength(1);
    expect(frame.oneShots[0]?.files).toEqual(['static/axe01.wav']);
    expect(frame.oneShots[0]?.key).toBe('atomicCompleted:3');
  });

  it('knocks the hammer on the MID-swing atomicSound cue, not at completion', () => {
    // The builder's hammer sounds on `atomicSound` (its PLAY_SOUND_FX frame), located at the builder.
    const struck = direct([{ kind: 'atomicSound', entity: entity(3), atomicId: BUILD_ATOMIC }]);
    expect(struck.oneShots).toHaveLength(1);
    expect(struck.oneShots[0]?.files).toEqual(['static/hammer01.wav']);
    expect(struck.oneShots[0]?.key).toBe('atomicSound:3');
    // The swing's completion event carries no hammer (it moved to the strike cue) — no double knock.
    const done = direct([{ kind: 'atomicCompleted', entity: entity(3), atomicId: BUILD_ATOMIC }]);
    expect(done.oneShots).toHaveLength(0);
  });

  it('stays silent for an off-screen emitter', () => {
    const frame = direct([{ kind: 'buildingPlaced', entity: entity(7), at: { hx: 200, hy: 200 } }]);
    expect(frame.oneShots).toHaveLength(0);
  });

  it('ignores events with no binding and bindings with no bank group', () => {
    const frame = direct([
      { kind: 'buildingUpgraded', entity: entity(7), level: 2 }, // no binding
      { kind: 'goodProduced', building: entity(7), goodType: 2, amount: 1 }, // bound to a group absent from the fixture bank
      { kind: 'atomicCompleted', entity: entity(3), atomicId: 999 }, // no atomic binding
    ]);
    expect(frame.oneShots).toHaveLength(0);
  });
});

describe('directAudio combat SFX', () => {
  // Half-cell node (11,10) projects to the centred tile (5,5), so the emitter is on-screen and centred.
  const at = { hx: 11, hy: 10 };

  it('fires the weapon-specific melee impact for a combatHit', () => {
    const sword = direct([
      { kind: 'combatHit', attacker: entity(3), target: entity(4), weaponMainType: 3, at },
    ]);
    expect(sword.oneShots[0]?.files).toEqual(['static/swordhit01.wav']);
    expect(sword.oneShots[0]?.key).toBe('combatHit:11,10');
    const spear = direct([
      { kind: 'combatHit', attacker: entity(3), target: entity(4), weaponMainType: 2, at },
    ]);
    expect(spear.oneShots[0]?.files).toEqual(['static/spearhit01.wav']);
  });

  it('falls back to the generic melee thunk when the weapon class has no entry / is absent', () => {
    // An axe (5) has no dedicated group → the byEvent.combatHit sword-hit fallback; likewise no weaponMainType.
    const axe = direct([
      { kind: 'combatHit', attacker: entity(3), target: entity(4), weaponMainType: 5, at },
    ]);
    expect(axe.oneShots[0]?.files).toEqual(['static/swordhit01.wav']);
    const bare = direct([{ kind: 'combatHit', attacker: entity(3), target: entity(4), at }]);
    expect(bare.oneShots[0]?.files).toEqual(['static/swordhit01.wav']);
  });

  it('fires the bow twang on launch and the arrow thunk on hit', () => {
    const loose = direct([
      {
        kind: 'projectileLaunched',
        projectile: entity(9),
        shooter: entity(3),
        target: entity(4),
        munitionType: 1,
        at,
      },
    ]);
    expect(loose.oneShots[0]?.files).toEqual(['static/bow01.wav']);
    const hit = direct([
      {
        kind: 'projectileHit',
        projectile: entity(9),
        shooter: entity(3),
        target: entity(4),
        munitionType: 1,
        at,
      },
    ]);
    expect(hit.oneShots[0]?.files).toEqual(['static/arrowhit01.wav']);
  });
});

describe('directAudio spatial location is derived, not enumerated', () => {
  // The regression this guards: location used to be a hand-kept list of event kinds, and `resourceMined`
  // was missing from it — so binding it a sound would have located it by an `ev.entity` it does not carry
  // (it carries `node`), and it would have been silently silent. Nothing about it is in that list now; the
  // node comes off the event itself, so a newly-bound positioned kind works with no consumer edit.
  it('spatialises a positioned kind that no consumer enumerates', () => {
    const withMined: SoundBindings = {
      ...bindings,
      byEvent: { ...bindings.byEvent, resourceMined: { kind: 'spatial', group: 'Woodcutter Axe' } },
    };
    const frame = direct([{ kind: 'resourceMined', node: entity(3), goodType: 1, at: { hx: 11, hy: 10 } }], {
      bindings: withMined,
    });
    expect(frame.oneShots).toHaveLength(1);
    expect(frame.oneShots[0]?.files).toEqual(['static/axe01.wav']);
    expect(frame.oneShots[0]?.key).toBe('resourceMined:11,10');
  });
});

describe('directAudio death stinger owner filter', () => {
  const LOCAL = 0;
  const ENEMY = 1;

  it('rings the death jingle only for the local player’s own unit', () => {
    const mine = direct([{ kind: 'settlerDied', entity: entity(3), cause: 'damage', player: LOCAL }], {
      localPlayer: LOCAL,
    });
    expect(mine.oneShots).toHaveLength(1);
    expect(mine.oneShots[0]?.files).toEqual(['jingles/jingles_death.wav']);
  });

  it('stays silent for an enemy or wild-animal (null-owned) death', () => {
    const enemy = direct([{ kind: 'settlerDied', entity: entity(4), cause: 'damage', player: ENEMY }], {
      localPlayer: LOCAL,
    });
    expect(enemy.oneShots).toHaveLength(0);
    const beast = direct([{ kind: 'settlerDied', entity: entity(5), cause: 'damage', player: null }], {
      localPlayer: LOCAL,
    });
    expect(beast.oneShots).toHaveLength(0);
  });

  it('stays silent when no local player is configured', () => {
    const noLocal = direct([{ kind: 'settlerDied', entity: entity(3), cause: 'damage', player: LOCAL }]);
    expect(noLocal.oneShots).toHaveLength(0);
  });

  // The jingle keys by death node, not by the reaped entity (see eventKey) — so a pile-up at one node
  // debounces to a single stinger. Without an `at` it falls back to the entity key.
  it('keys the death jingle by node when the reaped unit had a position', () => {
    const located = direct(
      [{ kind: 'settlerDied', entity: entity(3), cause: 'damage', player: LOCAL, at: { hx: 11, hy: 10 } }],
      { localPlayer: LOCAL },
    );
    expect(located.oneShots[0]?.key).toBe('settlerDied:11,10');

    const unlocated = direct([{ kind: 'settlerDied', entity: entity(3), cause: 'damage', player: LOCAL }], {
      localPlayer: LOCAL,
    });
    expect(unlocated.oneShots[0]?.key).toBe('settlerDied:3');
  });
});

describe('directAudio ambient', () => {
  const meadow: AudioTerrain = { width: 10, height: 10, typeIds: new Array(100).fill(1) };

  it('activates the terrain ambient bed under the viewport with a positive gain', () => {
    const frame = direct([], { terrain: meadow });
    expect(frame.ambient).toHaveLength(1);
    expect(frame.ambient[0]?.name).toBe('Meadow Green');
    expect(frame.ambient[0]?.file).toBe('ambient/meadow1.wav');
    expect(frame.ambient[0]?.gain).toBeGreaterThan(0);
  });

  it('produces no ambient without a terrain grid', () => {
    expect(direct([]).ambient).toHaveLength(0);
  });

  it('produces no ambient when the visible terrain has no bound bed', () => {
    const bare: AudioTerrain = { width: 10, height: 10, typeIds: new Array(100).fill(42) };
    expect(direct([], { terrain: bare }).ambient).toHaveLength(0);
  });

  it('produces no ambient when the camera frames only empty space off the map', () => {
    // Pan the map far off the right edge so the viewport no longer overlaps the grid's projected box.
    const offMap = directAudio({
      events: [],
      snapshot: snapshotAt(),
      camera: { offsetX: 100_000, offsetY: 0, scale: 1 },
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      index,
      bindings,
      terrain: meadow,
    });
    expect(offMap.ambient).toHaveLength(0);
  });
});

describe('chatVoice one-shots', () => {
  it('plays the voice group named by the cue soundType, positioned at the talker', () => {
    const frame = direct([{ kind: 'chatVoice', entity: entity(3), soundType: 61 }]);
    expect(frame.oneShots).toHaveLength(1);
    const shot = frame.oneShots[0];
    expect(shot?.files).toEqual(['voice/male_social.wav']);
    expect(shot?.gain).toBeGreaterThan(0);
    expect(shot?.gain).toBeLessThan(CHAT_VOICE_GAIN + 1e-9); // base voice gain × spatial attenuation
    expect(shot?.pan).toBeCloseTo(0, 5); // centred talker
    expect(shot?.key).toBe('chatVoice:3');
  });

  it('resolves the female clip cue to the female group', () => {
    const frame = direct([{ kind: 'chatVoice', entity: entity(3), soundType: 62 }]);
    expect(frame.oneShots[0]?.files).toEqual(['voice/female_social.wav']);
  });

  it('stays silent for an unknown soundType and for an off-screen talker', () => {
    expect(direct([{ kind: 'chatVoice', entity: entity(3), soundType: 999 }]).oneShots).toHaveLength(0);
    const farSnap: WorldSnapshot = {
      tick: 1,
      entities: [{ id: 3, components: { Position: { x: 100 * ONE, y: 100 * ONE }, Settler: {} } }],
      events: [],
    };
    const frame = directAudio({
      events: [{ kind: 'chatVoice', entity: entity(3), soundType: 61 }],
      snapshot: farSnap,
      camera,
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      index,
      bindings,
    });
    expect(frame.oneShots).toHaveLength(0);
  });

  it('keeps a fogged talker silent while leaving action SFX fog-agnostic', () => {
    const events: readonly SimEvent[] = [
      { kind: 'chatVoice', entity: entity(3), soundType: 61 },
      { kind: 'buildingPlaced', entity: entity(7), at: { hx: 11, hy: 10 } },
    ];
    const frame = direct(events, { visibleTile: () => false });
    expect(frame.oneShots.map((s) => s.key)).toEqual(['buildingPlaced:11,10']);
  });
});
