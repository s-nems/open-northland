import type { GfxPattern, SoundBank, TerrainPattern } from '@open-northland/data';
import type { Camera } from '@open-northland/render/data';
import { ONE, tileToScreen } from '@open-northland/render/data';
import type { Entity, SimEvent, WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  type AudioTerrain,
  buildSoundIndex,
  defaultBindings,
  directAudio,
  JINGLE_GAIN,
  type SoundBindings,
} from '../src/index.js';

/**
 * The pure director: sim events + snapshot + camera → the sounds that should be audible. Action SFX are
 * viewport-culled + positioned; life-event jingles are screen-gated to their event's position (the
 * defence alarm stays map-wide); unbound events are ignored; on-screen terrain drives ambient loops.
 * All headless - no AudioContext.
 */
const bank: SoundBank = {
  staticGroups: [
    { name: 'Hammer Wood', sfx: [{ file: 'static/hammer01.wav', params: [80] }] },
    { name: 'Woodcutter Axe', logicSoundType: 9, sfx: [{ file: 'static/axe01.wav', params: [80] }] },
    // Combat impact groups (the weapon-specific melee hits + the bow shot/arrow-hit).
    { name: 'Weapon Sword Short Hit', sfx: [{ file: 'static/swordhit01.wav', params: [80] }] },
    { name: 'Weapon Spear Hit', sfx: [{ file: 'static/spearhit01.wav', params: [80] }] },
    { name: 'Weapon Bow Long', logicSoundType: 75, sfx: [{ file: 'static/bow01.wav', params: [80] }] },
    { name: 'Weapon Bow Hit', sfx: [{ file: 'static/arrowhit01.wav', params: [80] }] },
    // The chat voice pair - like every cue group, resolved by its logicSoundType id.
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
    { name: '', musicType: 24, sfx: [{ file: 'jingles/jingles_civildefense.wav', params: [] }] },
  ],
};
const gfxPatterns = [{ id: 5, editGroups: ['meadow green'] }] as unknown as GfxPattern[];
const terrainPatterns = [{ typeId: 1, patternId: 5 }] as unknown as TerrainPattern[];

/** `logicSoundType` ids the fixture bank carries: the woodcutter's axe and the male chat voice. */
const SOUND_AXE = 9;
const SOUND_SOCIALTALK_MALE = 61;
const SOUND_SOCIALTALK_FEMALE = 62;
const index = buildSoundIndex(bank, gfxPatterns, terrainPatterns);
const bindings = defaultBindings();

const CANVAS_W = 800;
const CANVAS_H = 600;
const entity = (id: number): Entity => id as Entity;
// Centre the camera on tile (5,5) - computed through the live projection so the fixture stays
// valid whatever the calibrated pitch/model is (a hand-baked offset broke on every recalibration).
const centre = tileToScreen(5, 5);
const camera: Camera = {
  offsetX: CANVAS_W / 2 - centre.x,
  offsetY: CANVAS_H / 2 - centre.y,
  scale: 1,
};

/** A snapshot at tile (5,5): a settler (id 3) and a building (id 7), both owned by player 0, plus an
 *  unowned wild animal (id 9). */
function snapshotAt(events: readonly SimEvent[] = []): WorldSnapshot {
  const at = { x: 5 * ONE, y: 5 * ONE };
  return {
    tick: 1,
    entities: [
      { id: 3, components: { Position: at, Settler: {}, Owner: { player: 0 } } },
      { id: 7, components: { Position: at, Building: { buildingType: 2 }, Owner: { player: 0 } } },
      { id: 9, components: { Position: at, Settler: {} } },
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
    // `at` is a half-cell node: cell (5,5) anchors at node (11,10) - the same screen point as tile (5,5).
    const frame = direct([{ kind: 'buildingPlaced', entity: entity(7), at: { hx: 11, hy: 10 } }]);
    expect(frame.oneShots).toHaveLength(1);
    const shot = frame.oneShots[0];
    expect(shot?.files).toEqual(['static/hammer01.wav']);
    expect(shot?.gain).toBeGreaterThan(0);
    expect(shot?.pan).toBeCloseTo(0, 5); // centred emitter
    expect(shot?.key).toBe('buildingPlaced:11,10');
  });

  it("rings the house-built jingle for the local player's own on-screen building", () => {
    const frame = direct([{ kind: 'buildingFinished', entity: entity(7) }], { localPlayer: 0 });
    expect(frame.oneShots).toHaveLength(1);
    expect(frame.oneShots[0]?.files).toEqual(['jingles/jingles_housebuilt.wav']);
    expect(frame.oneShots[0]?.gain).toBeCloseTo(JINGLE_GAIN, 5);
    expect(frame.oneShots[0]?.pan).toBe(0);
    expect(frame.oneShots[0]?.key).toBe('buildingFinished:7');
  });

  it('positions an authored cue at the working settler, resolved by its logicSoundType', () => {
    const frame = direct([{ kind: 'atomicSound', entity: entity(3), soundType: SOUND_AXE }]);
    expect(frame.oneShots).toHaveLength(1);
    expect(frame.oneShots[0]?.files).toEqual(['static/axe01.wav']);
    expect(frame.oneShots[0]?.key).toBe(`atomicSound:${SOUND_AXE}:3`);
    // The swing's completion carries no sound of its own, so nothing doubles at the end of the swing.
    const done = direct([{ kind: 'atomicCompleted', entity: entity(3), atomicId: 24 }]);
    expect(done.oneShots).toHaveLength(0);
  });

  it("keys a cue by sound as well as emitter, so one clip's two cues never debounce each other", () => {
    const frame = direct([
      { kind: 'atomicSound', entity: entity(3), soundType: SOUND_AXE },
      { kind: 'atomicSound', entity: entity(3), soundType: SOUND_SOCIALTALK_MALE },
    ]);
    expect(frame.oneShots.map((s) => s.key)).toEqual([
      `atomicSound:${SOUND_AXE}:3`,
      `atomicSound:${SOUND_SOCIALTALK_MALE}:3`,
    ]);
  });

  it('stays silent for an off-screen emitter', () => {
    const frame = direct([{ kind: 'buildingPlaced', entity: entity(7), at: { hx: 200, hy: 200 } }]);
    expect(frame.oneShots).toHaveLength(0);
  });

  it('ignores events with no binding and bindings with no bank group', () => {
    const frame = direct([
      { kind: 'buildingUpgraded', entity: entity(7), level: 2 }, // no binding
      { kind: 'goodProduced', building: entity(7), goodType: 2, amount: 1 }, // bound to a group absent from the fixture bank
      { kind: 'atomicSound', entity: entity(3), soundType: 999 }, // no group carries this id
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

  it('leaves the bow release to the clip cue and fires only the arrow thunk on hit', () => {
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
    expect(loose.oneShots).toHaveLength(0);
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
  // was missing from it - so binding it a sound would have located it by an `ev.entity` it does not carry
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

  // The jingle keys by death node, not by the reaped entity (see eventKey) - so a pile-up at one node
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

describe('directAudio screen-gated jingles', () => {
  const LOCAL = 0;
  const ENEMY = 1;

  /** `buildingFinished` for the local player's building (id 7) placed at tile `(col, row)`. */
  function directBuildingFinishedAt(col: number, row: number, localPlayer?: number) {
    const events: readonly SimEvent[] = [{ kind: 'buildingFinished', entity: entity(7) }];
    return directAudio({
      events,
      snapshot: {
        tick: 1,
        entities: [
          {
            id: 7,
            components: {
              Position: { x: col * ONE, y: row * ONE },
              Building: { buildingType: 2 },
              Owner: { player: LOCAL },
            },
          },
        ],
        events,
      },
      camera,
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      index,
      bindings,
      ...(localPlayer !== undefined ? { localPlayer } : {}),
    });
  }

  it('silences the house-built jingle when the building is off screen', () => {
    expect(directBuildingFinishedAt(100, 100, LOCAL).oneShots).toHaveLength(0);
  });

  it('keeps full stinger gain and centre for an on-screen but off-centre building', () => {
    // Tile (8,5) projects right of centre, where a positioned SFX would attenuate and pan - the
    // screen gate decides audibility only, so the jingle keeps its stinger character.
    const frame = directBuildingFinishedAt(8, 5, LOCAL);
    expect(frame.oneShots).toHaveLength(1);
    expect(frame.oneShots[0]?.gain).toBeCloseTo(JINGLE_GAIN, 5);
    expect(frame.oneShots[0]?.pan).toBe(0);
  });

  it("silences the jingle for another player's building and when no local player is set", () => {
    const enemyView = direct([{ kind: 'buildingFinished', entity: entity(7) }], { localPlayer: ENEMY });
    expect(enemyView.oneShots).toHaveLength(0);
    expect(direct([{ kind: 'buildingFinished', entity: entity(7) }]).oneShots).toHaveLength(0);
  });

  it('rings the birth jingle for an own on-screen newborn but not for an unowned animal', () => {
    const born = direct([{ kind: 'settlerBorn', entity: entity(3) }], { localPlayer: LOCAL });
    expect(born.oneShots).toHaveLength(1);
    expect(born.oneShots[0]?.files).toEqual(['jingles/jingles_birth.wav']);
    const wild = direct([{ kind: 'settlerBorn', entity: entity(9) }], { localPlayer: LOCAL });
    expect(wild.oneShots).toHaveLength(0);
  });

  it('silences a death at an off-screen node and an unlocatable reaped death', () => {
    const far = direct(
      [{ kind: 'settlerDied', entity: entity(3), cause: 'damage', player: LOCAL, at: { hx: 200, hy: 200 } }],
      { localPlayer: LOCAL },
    );
    expect(far.oneShots).toHaveLength(0);
    // Entity 99 is absent from the snapshot (the sim reaps before snapshotting) and no `at` came along.
    const gone = direct([{ kind: 'settlerDied', entity: entity(99), cause: 'damage', player: LOCAL }], {
      localPlayer: LOCAL,
    });
    expect(gone.oneShots).toHaveLength(0);
  });

  it('keeps the defence alarm ringing map-wide, off screen included', () => {
    const events: readonly SimEvent[] = [{ kind: 'defenceAlarmRaised', entity: entity(7), player: LOCAL }];
    const frame = directAudio({
      events,
      snapshot: { tick: 1, entities: [], events },
      camera: { offsetX: 100_000, offsetY: 0, scale: 1 },
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      index,
      bindings,
      localPlayer: LOCAL,
    });
    expect(frame.oneShots).toHaveLength(1);
    expect(frame.oneShots[0]?.files).toEqual(['jingles/jingles_civildefense.wav']);
    expect(frame.oneShots[0]?.gain).toBeCloseTo(JINGLE_GAIN, 5);
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

describe('authored cue one-shots', () => {
  it('plays the group named by the cue soundType, positioned at the settler', () => {
    const frame = direct([{ kind: 'atomicSound', entity: entity(3), soundType: SOUND_SOCIALTALK_MALE }]);
    expect(frame.oneShots).toHaveLength(1);
    const shot = frame.oneShots[0];
    expect(shot?.files).toEqual(['voice/male_social.wav']);
    expect(shot?.gain).toBeGreaterThan(0);
    expect(shot?.pan).toBeCloseTo(0, 5); // centred emitter
  });

  it('resolves the female clip cue to the female group', () => {
    const frame = direct([{ kind: 'atomicSound', entity: entity(3), soundType: SOUND_SOCIALTALK_FEMALE }]);
    expect(frame.oneShots[0]?.files).toEqual(['voice/female_social.wav']);
  });

  it('stays silent for an unknown soundType and for an off-screen emitter', () => {
    expect(direct([{ kind: 'atomicSound', entity: entity(3), soundType: 999 }]).oneShots).toHaveLength(0);
    const farSnap: WorldSnapshot = {
      tick: 1,
      entities: [{ id: 3, components: { Position: { x: 100 * ONE, y: 100 * ONE }, Settler: {} } }],
      events: [],
    };
    const frame = directAudio({
      events: [{ kind: 'atomicSound', entity: entity(3), soundType: SOUND_SOCIALTALK_MALE }],
      snapshot: farSnap,
      camera,
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      index,
      bindings,
    });
    expect(frame.oneShots).toHaveLength(0);
  });

  it("keeps a fogged settler silent while leaving the map's own events fog-agnostic", () => {
    const events: readonly SimEvent[] = [
      { kind: 'atomicSound', entity: entity(3), soundType: SOUND_SOCIALTALK_MALE },
      { kind: 'buildingPlaced', entity: entity(7), at: { hx: 11, hy: 10 } },
    ];
    const frame = direct(events, { visibleTile: () => false });
    expect(frame.oneShots.map((s) => s.key)).toEqual(['buildingPlaced:11,10']);
  });
});
