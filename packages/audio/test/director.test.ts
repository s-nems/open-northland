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
  HOUSE_CRASH_MIN_BUILT,
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
    { name: 'Open Wooden Chest', sfx: [{ file: 'static/woodenchest.wav', params: [80] }] },
    { name: 'Open Magical Chest', sfx: [{ file: 'static/magicalchest.wav', params: [80] }] },
    { name: 'Woodcutter Axe', logicSoundType: 9, sfx: [{ file: 'static/axe01.wav', params: [80] }] },
    // Combat impact groups, named by id like every cue group: the weapon's `soundtype_Hit` / `_NoHit`
    // tables carry the id onto the hit and miss events.
    {
      name: 'Weapon Sword Short Hit',
      logicSoundType: 82,
      sfx: [{ file: 'static/swordhit01.wav', params: [80] }],
    },
    {
      name: 'Weapon Sword Short Hit House',
      logicSoundType: 84,
      sfx: [{ file: 'static/swordhouse01.wav', params: [80] }],
    },
    { name: 'Weapon Bow Long', logicSoundType: 75, sfx: [{ file: 'static/bow01.wav', params: [80] }] },
    { name: 'Weapon Bow Hit', logicSoundType: 77, sfx: [{ file: 'static/arrowhit01.wav', params: [80] }] },
    {
      name: 'Weapon Bow Hit Dirt',
      logicSoundType: 79,
      sfx: [{ file: 'static/arrowdirt01.wav', params: [80] }],
    },
    {
      name: 'Weapon Bow Hit Water',
      logicSoundType: 78,
      sfx: [{ file: 'static/arrowwater01.wav', params: [80] }],
    },
    { name: 'House Crash', sfx: [{ file: 'static/housecrash01.wav', params: [80] }] },
    // The viking voices `humans/sounds.cif` names below.
    { name: 'Man Get Hit', sfx: [{ file: 'static/hit m 01.wav', params: [80] }] },
    { name: 'Woman Get Hit', sfx: [{ file: 'static/hit f 01.wav', params: [80] }] },
    { name: 'Generic Viking Male', sfx: [{ file: 'generic/m 01.wav', params: [40] }] },
    { name: 'Viking male ok 01', sfx: [{ file: 'humantalk/m1ok01.wav', params: [80] }] },
    { name: 'Viking male ok 02', sfx: [{ file: 'humantalk/m2ok01.wav', params: [80] }] },
    { name: 'Bear Sounds', sfx: [{ file: 'generic/animals_bear01.wav', params: [80] }] },
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
    { name: '', musicType: 30, sfx: [{ file: 'jingles/jingles_openchest.wav', params: [] }] },
    { name: '', musicType: 22, sfx: [{ file: 'jingles/jingles_marriage.wav', params: [] }] },
  ],
  humanVoices: [
    {
      tribe: 1,
      voiceClass: 'male',
      scream: 'Man Get Hit',
      generic: 'Generic Viking Male',
      respondOk: ['Viking male ok 01', 'Viking male ok 02'],
      respondNo: [],
    },
    { tribe: 1, voiceClass: 'female', scream: 'Woman Get Hit', respondOk: [], respondNo: [] },
  ],
  animalCalls: [{ tribe: 8, minCount: 1, probability: 10, group: 'Bear Sounds' }],
};
const gfxPatterns = [{ id: 5, editGroups: ['meadow green'] }] as unknown as GfxPattern[];
const terrainPatterns = [
  { typeId: 1, patternId: 5, logicType: 2 }, // land
  { typeId: 3, patternId: 8, logicType: 1 }, // water
] as unknown as TerrainPattern[];

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

/** A snapshot at tile (5,5): a viking man (id 3) and a building (id 7), both owned by player 0, an
 *  unowned wild bear (id 9), and a viking woman (id 12) of player 1. */
function snapshotAt(events: readonly SimEvent[] = []): WorldSnapshot {
  const at = { x: 5 * ONE, y: 5 * ONE };
  return {
    tick: 1,
    entities: [
      {
        id: 3,
        components: { Position: at, Settler: { tribe: 1 }, Person: { person: true }, Owner: { player: 0 } },
      },
      { id: 7, components: { Position: at, Building: { buildingType: 2 }, Owner: { player: 0 } } },
      { id: 9, components: { Position: at, Settler: { tribe: 8 } } },
      {
        id: 12,
        components: {
          Position: at,
          Settler: { tribe: 1 },
          Person: { person: true },
          Female: { female: true },
          Owner: { player: 1 },
        },
      },
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
  it('does not invent a placement sound before any builder starts hammering', () => {
    const frame = direct([{ kind: 'buildingPlaced', entity: entity(7), at: { hx: 11, hy: 10 } }]);
    expect(frame.oneShots).toEqual([]);
  });

  it('plays the kind-specific chest sound and local-player open-chest jingle together', () => {
    const opened: SimEvent = {
      kind: 'chestOpened',
      chest: entity(12),
      chestKind: 'wooden',
      player: 0,
      at: { hx: 11, hy: 10 },
    };
    const frame = direct([opened], { localPlayer: 0 });
    expect(frame.oneShots.map((shot) => shot.files)).toEqual([
      ['jingles/jingles_openchest.wav'],
      ['static/woodenchest.wav'],
    ]);
    expect(frame.oneShots.map((shot) => shot.key)).toEqual([
      'chestOpened:11,10:jingle',
      'chestOpened:11,10:wooden',
    ]);
    expect(frame.oneShots[0]?.duckMusicMs).toBe(3000);

    expect(direct([opened], { localPlayer: 1 }).oneShots.map((shot) => shot.files)).toEqual([
      ['static/woodenchest.wav'],
    ]);
  });

  it("rings the house-built jingle for the local player's own on-screen building", () => {
    const frame = direct([{ kind: 'buildingFinished', entity: entity(7) }], { localPlayer: 0 });
    expect(frame.oneShots).toHaveLength(1);
    expect(frame.oneShots[0]?.files).toEqual(['jingles/jingles_housebuilt.wav']);
    expect(frame.oneShots[0]?.gain).toBeCloseTo(JINGLE_GAIN, 5);
    expect(frame.oneShots[0]?.pan).toBe(0);
    expect(frame.oneShots[0]?.key).toBe('buildingFinished:7');
    // The house-built hold from the original's per-MusicType duck table.
    expect(frame.oneShots[0]?.duckMusicMs).toBe(3300);
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

  it("positions a map script's sound at its own point, resolved by the same logicSoundType id", () => {
    const frame = direct([{ kind: 'missionSound', soundType: SOUND_AXE, at: { hx: 11, hy: 10 } }]);
    expect(frame.oneShots).toHaveLength(1);
    expect(frame.oneShots[0]?.files).toEqual(['static/axe01.wav']);
    expect(frame.oneShots[0]?.pan).toBeCloseTo(0, 5);
    expect(frame.oneShots[0]?.key).toBe(`missionSound:${SOUND_AXE}:11,10`);
    // Off screen, or an id the bank does not carry: silent.
    expect(
      direct([{ kind: 'missionSound', soundType: SOUND_AXE, at: { hx: 200, hy: 200 } }]).oneShots,
    ).toEqual([]);
    expect(direct([{ kind: 'missionSound', soundType: 999, at: { hx: 11, hy: 10 } }]).oneShots).toEqual([]);
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

  it('crashes a finished or half-built house down at its node, and tears a fresh site down silently', () => {
    const razed = (built: number, upgrading?: boolean): SimEvent => ({
      kind: 'buildingDestroyed',
      entity: entity(7),
      player: 0,
      buildingType: 2,
      tribe: 1,
      built,
      ...(upgrading === true ? { upgrading } : {}),
      at: { hx: 11, hy: 10 },
    });
    expect(direct([razed(ONE)]).oneShots[0]?.files).toEqual(['static/housecrash01.wav']);
    expect(direct([razed(ONE)]).oneShots[0]?.key).toBe('buildingDestroyed:11,10');
    expect(direct([razed(HOUSE_CRASH_MIN_BUILT)]).oneShots).toHaveLength(1);
    expect(direct([razed(HOUSE_CRASH_MIN_BUILT - 1)]).oneShots).toHaveLength(0);
    expect(direct([razed(0)]).oneShots).toHaveLength(0);
    // A house re-opened for an upgrade counts the upgrade's own progress, yet falls as a whole house.
    expect(direct([razed(0, true)]).oneShots).toHaveLength(1);
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

  it('plays the impact the weapon listed for the victim, by id, and the struck man screams', () => {
    const frame = direct([
      { kind: 'combatHit', attacker: entity(12), target: entity(3), weaponMainType: 3, soundType: 82, at },
    ]);
    expect(frame.oneShots.map((s) => s.files)).toEqual([['static/swordhit01.wav'], ['static/hit m 01.wav']]);
    // Both are self-exclusive: a body blow and a scream never stack on a copy still sounding.
    expect(frame.oneShots.map((s) => s.exclusive)).toEqual(['wav', 'wav']);
    expect(frame.oneShots[0]?.key).toBe('combatHit:82:11,10');
    expect(frame.oneShots[1]?.key).toBe('scream:11,10');
  });

  it('screams in the struck woman`s voice, and never for a body without one', () => {
    const woman = direct([{ kind: 'combatHit', attacker: entity(3), target: entity(12), at }]);
    expect(woman.oneShots.map((s) => s.files)).toEqual([['static/hit f 01.wav']]);
    // A bear (no voice row for its tribe) and a stranger (not in the snapshot) scream nothing.
    expect(direct([{ kind: 'combatHit', attacker: entity(3), target: entity(9), at }]).oneShots).toHaveLength(
      0,
    );
    expect(direct([{ kind: 'combatHit', attacker: entity(3), target: entity(4), at }]).oneShots).toHaveLength(
      0,
    );
  });

  it('lands a blow on a house with the house impact alone, layering freely, and no scream', () => {
    const frame = direct([
      { kind: 'combatHit', attacker: entity(3), target: entity(7), soundType: 84, structure: true, at },
    ]);
    expect(frame.oneShots.map((s) => s.files)).toEqual([['static/swordhouse01.wav']]);
    expect(frame.oneShots[0]?.exclusive).toBeUndefined();
  });

  it('stays silent for a blow whose weapon lists no impact for that material', () => {
    const frame = direct([
      { kind: 'combatHit', attacker: entity(3), target: entity(7), structure: true, at },
    ]);
    expect(frame.oneShots).toHaveLength(0);
  });

  it('leaves the bow release to the clip cue, thuds the arrow on hit and in the dirt on a miss', () => {
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
        shooter: entity(12),
        target: entity(3),
        munitionType: 1,
        soundType: 77,
        at,
      },
    ]);
    expect(hit.oneShots.map((s) => s.files)).toEqual([['static/arrowhit01.wav'], ['static/hit m 01.wav']]);
  });

  it('thuds a missed shot by the ground under its landing node, off the landscape grid', () => {
    // A 10x10 grid of land (typeId 1) with a water row (typeId 3) at row 5; node (11,10) lands in cell
    // (5,5), node (11,8) in cell (5,4). The bow's table: 1 water → 78 splash, 2 land → 79 dirt.
    const typeIds = new Array<number>(100).fill(1);
    for (let col = 0; col < 10; col++) typeIds[5 * 10 + col] = 3;
    const terrain = { width: 10, height: 10, typeIds };
    const missSounds = { '1': 78, '2': 79 };
    const shot = (where: { hx: number; hy: number }): SimEvent => ({
      kind: 'projectileMissed',
      projectile: entity(9),
      shooter: entity(3),
      munitionType: 1,
      missSounds,
      at: where,
    });
    const water = direct([shot(at)], { terrain });
    expect(water.oneShots.map((s) => s.files)).toEqual([['static/arrowwater01.wav']]);
    expect(water.oneShots[0]?.exclusive).toBeUndefined(); // ground thuds layer, as the original's flag says
    const land = direct([shot({ hx: 11, hy: 8 })], { terrain });
    expect(land.oneShots.map((s) => s.files)).toEqual([['static/arrowdirt01.wav']]);
    // Between-row nodes settle the original's way: node (10,9), under the even cell row 4, nudges right
    // into cell (5,4) on land; node (10,11), under the odd row 5, halves straight into cell (5,5) on water.
    expect(direct([shot({ hx: 10, hy: 9 })], { terrain }).oneShots[0]?.files).toEqual([
      'static/arrowdirt01.wav',
    ]);
    expect(direct([shot({ hx: 10, hy: 11 })], { terrain }).oneShots[0]?.files).toEqual([
      'static/arrowwater01.wav',
    ]);
    // No grid (a scene's synthetic ground), or a weapon with no table: the shot lands silently.
    expect(direct([shot(at)]).oneShots).toHaveLength(0);
    const mute: SimEvent = {
      kind: 'projectileMissed',
      projectile: entity(9),
      shooter: entity(3),
      munitionType: 1,
      missSounds: {},
      at,
    };
    expect(direct([mute], { terrain }).oneShots).toHaveLength(0);
  });

  it("rings a script's briefing and earthquake as centred full-gain cues", () => {
    const frame = direct([
      { kind: 'missionCutscene', mission: 1, page: 0, replay: false },
      { kind: 'missionEarthquake', seconds: 3 },
    ]);
    expect(frame.oneShots).toEqual([
      { files: ['gui/briefing_popup.wav'], gain: 1, pan: 0, key: 'ui:briefing' },
      { files: ['misc/earthquak.wav'], gain: 1, pan: 0, key: 'ui:earthquake' },
    ]);
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

  it("rings the marriage jingle for the local player's own on-screen wedding only", () => {
    const at = { hx: 11, hy: 10 };
    const wedding = (player: number | null, where = at): SimEvent => ({
      kind: 'settlersMarried',
      a: entity(3),
      b: entity(12),
      player,
      at: where,
    });
    const ours = direct([wedding(LOCAL)], { localPlayer: LOCAL });
    expect(ours.oneShots.map((s) => s.files)).toEqual([['jingles/jingles_marriage.wav']]);
    expect(direct([wedding(1)], { localPlayer: LOCAL }).oneShots).toHaveLength(0);
    expect(direct([wedding(null)], { localPlayer: LOCAL }).oneShots).toHaveLength(0);
    expect(direct([wedding(LOCAL, { hx: 400, hy: 400 })], { localPlayer: LOCAL }).oneShots).toHaveLength(0);
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
    expect(frame.oneShots[0]?.duckMusicMs).toBe(5000);
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
      { kind: 'boatPlaced', entity: entity(7), at: { hx: 11, hy: 10 } },
    ];
    const frame = direct(events, { visibleTile: () => false });
    expect(frame.oneShots.map((s) => s.key)).toEqual(['boatPlaced:11,10']);
  });
});
