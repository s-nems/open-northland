import { describe, expect, it } from 'vitest';
import {
  applyMapVariantBriefing,
  applyMapVariantEntities,
  applyMapVariantScript,
  applyMapVariantSlots,
  applyMapVariantStrings,
  assertMapVariantFitsMap,
  MAP_VARIANTS,
  MapBriefing,
  MapEscalation,
  MapScript,
  MapVariant,
  mapLobbySlots,
  TerrainEntities,
} from '../../src/index.js';

const OPEN_SEAT = 0;
const VILLAGE_SEAT = 1;
const TRADE_HOUSE = 1;
const OTHER_HOUSE = 2;

const line = (key: string, ...values: string[]) => ({ key, values });

const SCRIPT = MapScript.parse({
  players: [
    { player: OPEN_SEAT, type: 'human', tribeId: 1, colorId: 0 },
    { player: VILLAGE_SEAT, type: 'ai', tribeId: 1, colorId: 1 },
  ],
  multiplayer: {
    slotOptions: [
      { player: OPEN_SEAT, allowed: ['human', 'ai', 'none'] },
      { player: VILLAGE_SEAT, allowed: ['ai'] },
    ],
  },
  tradeAgreements: [
    { missionId: TRADE_HOUSE, giveGood: 1, giveAmount: 1, takeGood: 2, takeAmount: 1 },
    { missionId: OTHER_HOUSE, giveGood: 1, giveAmount: 1, takeGood: 2, takeAmount: 1 },
  ],
  missions: [
    {
      debugName: 'Won',
      active: true,
      goals: [line('goal', 'True')],
      results: [line('result', 'MissionWon', '0')],
    },
    {
      debugName: 'Take over',
      active: true,
      visible: true,
      goals: [line('goal', 'True')],
      results: [line('result', 'ActivateMission', '2')],
    },
    {
      debugName: 'Wave',
      goals: [line('goal', 'TimeGone', '60')],
      results: [line('result', 'ActivateMission', '1')],
    },
    { debugName: 'Later', goals: [line('goal', 'True')], results: [line('result', 'ActivateMission', '0')] },
  ],
});

const VARIANT = MapVariant.parse({
  mapId: 'test',
  kind: 'ragnarok',
  script: {
    slotOptions: [{ player: VILLAGE_SEAT, allowed: ['human', 'ai', 'none'] }],
    neutralizedMissions: ['Take over', 'Wave'],
    appendedResults: [{ mission: 'Won', results: [line('result', 'MissionWon', '1')] }],
    droppedTradeHouses: [TRADE_HOUSE],
  },
});

describe('applyMapVariantScript', () => {
  it('neutralises missions in place, so every mission keeps its ActivateMission index', () => {
    const patched = applyMapVariantScript(SCRIPT, VARIANT);

    expect(patched.missions.map((m) => m.debugName)).toEqual(['Won', 'Take over', 'Wave', 'Later']);
    expect(patched.missions[1]).toEqual({ debugName: 'Take over', goals: [], results: [], other: [] });
    expect(patched.missions[2]).toEqual({ debugName: 'Wave', goals: [], results: [], other: [] });
    expect(patched.missions[3]).toBe(SCRIPT.missions[3]);
  });

  it('appends results, drops the named house trades and opens the replaced seat', () => {
    const patched = applyMapVariantScript(SCRIPT, VARIANT);

    expect(patched.missions[0]?.results).toEqual([
      line('result', 'MissionWon', '0'),
      line('result', 'MissionWon', '1'),
    ]);
    expect(patched.tradeAgreements.map((row) => row.missionId)).toEqual([OTHER_HOUSE]);
    expect(mapLobbySlots(patched).map((slot) => slot.claimable)).toEqual([true, true]);
    expect(mapLobbySlots(SCRIPT).map((slot) => slot.claimable)).toEqual([true, false]);
  });

  it('appends AI tasks after a seat’s authored ones and refuses a seat without rows', () => {
    const defend = {
      kind: 'defend' as const,
      priority: 5,
      condition: 0,
      x: 1,
      y: 1,
      range: 4,
      min: 0,
      max: 0,
    };
    const seat = {
      player: VILLAGE_SEAT,
      allDisabled: false,
      computerDisabled: true,
      disabledComputerModules: [],
    };
    const script = MapScript.parse({ ...SCRIPT, ai: [{ ...seat, tasks: [defend] }] });
    const appended = { ...defend, x: 2 };
    const patched = applyMapVariantScript(script, {
      ...VARIANT,
      script: { ...VARIANT.script, appendedAiTasks: [{ player: VILLAGE_SEAT, tasks: [appended] }] },
    });
    expect(patched.ai[0]?.tasks).toEqual([defend, appended]);
    const stray = { ...VARIANT.script, appendedAiTasks: [{ player: OPEN_SEAT, tasks: [appended] }] };
    expect(() => applyMapVariantScript(script, { ...VARIANT, script: stray })).toThrow(
      /no \[AIData\] rows for seat 0/,
    );
  });

  it('refuses a variant naming a mission the script lacks', () => {
    const stale = { ...VARIANT, script: { ...VARIANT.script, neutralizedMissions: ['Gone'] } };
    expect(() => applyMapVariantScript(SCRIPT, stale)).toThrow(/no single mission named Gone/);
  });

  it('refuses a variant offering a seat or dropping a trade house the script lacks', () => {
    const MISSING = 9;
    const offered = { ...VARIANT.script, slotOptions: [{ player: MISSING, allowed: ['ai' as const] }] };
    expect(() => applyMapVariantScript(SCRIPT, { ...VARIANT, script: offered })).toThrow(/no seat 9/);
    const dropped = { ...VARIANT.script, droppedTradeHouses: [MISSING] };
    expect(() => applyMapVariantScript(SCRIPT, { ...VARIANT, script: dropped })).toThrow(/no trade house 9/);
  });

  it('refuses a variant that leaves a kept mission activating a neutralised one', () => {
    const dangling = {
      ...VARIANT,
      script: { ...VARIANT.script, neutralizedMissions: ['Won'], appendedResults: [] },
    };
    expect(() => applyMapVariantScript(SCRIPT, dangling)).toThrow(/Later still activates neutralised 0/);
  });
});

describe('a start seat', () => {
  const FORTRESS = 6;
  const PLACE_ANY = 2;
  const PLACE_HOUSE = 3;
  const HOUSE = 41;
  /** In cells: an 80 x 80 half-cell grid. */
  const MAP_SIZE = { width: 40, height: 40 };
  const started = MapVariant.parse({
    ...VARIANT,
    startSeats: [{ player: VILLAGE_SEAT, from: OPEN_SEAT, dx: 10, dy: -2 }],
  });

  it('takes the source seat’s settlers shifted, without its object ids, and drops its own', () => {
    const entities = TerrainEntities.parse({
      humans: [
        { tribe: 'viking', role: 'woman', player: OPEN_SEAT, hx: 4, hy: 5, missionId: 3 },
        { tribe: 'viking', role: 'civilist', player: VILLAGE_SEAT, hx: 40, hy: 40 },
        { tribe: 'viking', role: 'collector', player: OPEN_SEAT, hx: 6, hy: 7, producedGood: 'wood' },
        { tribe: 'viking', role: 'soldier', player: FORTRESS, hx: 50, hy: 50 },
      ],
    });
    const humans = applyMapVariantEntities(entities, started, MAP_SIZE).humans;

    expect(humans.map((h) => [h.player, h.role, h.hx, h.hy, h.missionId])).toEqual([
      [OPEN_SEAT, 'woman', 4, 5, 3],
      [OPEN_SEAT, 'collector', 6, 7, undefined],
      [FORTRESS, 'soldier', 50, 50, undefined],
      [VILLAGE_SEAT, 'woman', 14, 3, undefined],
      [VILLAGE_SEAT, 'collector', 16, 5, undefined],
    ]);
    expect(humans.at(-1)?.producedGood).toBe('wood');
    for (const dx of [-5, 75]) {
      const offMap = { ...started, startSeats: [{ player: VILLAGE_SEAT, from: OPEN_SEAT, dx, dy: 0 }] };
      expect(() => applyMapVariantEntities(entities, offMap, MAP_SIZE)).toThrow(/leaves the map/);
    }
  });

  it('takes the source seat’s papers and diplomacy locks in place of its own', () => {
    const script = MapScript.parse({
      ...SCRIPT,
      specialItems: [
        { player: OPEN_SEAT, kind: PLACE_HOUSE, param: HOUSE },
        { player: VILLAGE_SEAT, kind: PLACE_ANY, param: 0 },
        { player: OPEN_SEAT, kind: PLACE_ANY, param: 0 },
      ],
      relationFlags: [
        { kind: 'notChangeable', a: OPEN_SEAT, b: FORTRESS },
        { kind: 'hide', a: FORTRESS, b: OPEN_SEAT },
        { kind: 'notChangeable', a: OPEN_SEAT, b: VILLAGE_SEAT },
        { kind: 'hide', a: VILLAGE_SEAT, b: FORTRESS },
      ],
    });
    const patched = applyMapVariantScript(script, started);

    expect(patched.specialItems).toEqual([
      { player: OPEN_SEAT, kind: PLACE_HOUSE, param: HOUSE },
      { player: OPEN_SEAT, kind: PLACE_ANY, param: 0 },
      { player: VILLAGE_SEAT, kind: PLACE_HOUSE, param: HOUSE },
      { player: VILLAGE_SEAT, kind: PLACE_ANY, param: 0 },
    ]);
    expect(patched.relationFlags).toEqual([
      { kind: 'notChangeable', a: OPEN_SEAT, b: FORTRESS },
      { kind: 'hide', a: FORTRESS, b: OPEN_SEAT },
      { kind: 'notChangeable', a: VILLAGE_SEAT, b: FORTRESS },
      { kind: 'hide', a: FORTRESS, b: VILLAGE_SEAT },
    ]);
  });

  it('copies a lock between two sources onto the seats they start', () => {
    const OTHER_START = 2;
    const twoSources = MapVariant.parse({
      ...VARIANT,
      startSeats: [
        { player: VILLAGE_SEAT, from: OPEN_SEAT, dx: 0, dy: 0 },
        { player: OTHER_START, from: FORTRESS, dx: 0, dy: 0 },
      ],
    });
    const script = MapScript.parse({
      ...SCRIPT,
      relationFlags: [
        { kind: 'notChangeable', a: OPEN_SEAT, b: FORTRESS },
        { kind: 'hide', a: VILLAGE_SEAT, b: OTHER_START },
      ],
    });

    expect(applyMapVariantScript(script, twoSources).relationFlags).toEqual([
      { kind: 'notChangeable', a: OPEN_SEAT, b: FORTRESS },
      { kind: 'notChangeable', a: OPEN_SEAT, b: OTHER_START },
      { kind: 'notChangeable', a: VILLAGE_SEAT, b: FORTRESS },
      { kind: 'notChangeable', a: VILLAGE_SEAT, b: OTHER_START },
    ]);
  });

  it('refuses a seat started twice or from another start seat', () => {
    const row = { player: VILLAGE_SEAT, from: OPEN_SEAT, dx: 0, dy: 0 };
    const twice = { ...started, startSeats: [row, row] };
    expect(() => applyMapVariantScript(SCRIPT, twice)).toThrow(/starts seat 1 twice/);
    const chained = { ...started, startSeats: [row, { player: 2, from: VILLAGE_SEAT, dx: 0, dy: 0 }] };
    expect(() => applyMapVariantScript(SCRIPT, chained)).toThrow(/from start seat 1/);
  });
});

describe('assertMapVariantFitsMap', () => {
  /** In cells: a 20 x 10 half-cell grid. */
  const SIZE = { width: 10, height: 5 };
  const committed = MAP_VARIANTS.find((row) => row.escalation !== undefined)?.escalation;
  if (committed === undefined) throw new Error('no committed escalation to vary');
  const escalation: MapEscalation = committed;
  const target = escalation.attacks.targets[0];
  if (target === undefined) throw new Error('no committed target to vary');
  const onMap = { x: 1, y: 1 };
  const landing = { spawnX: 1, spawnY: 1, ...onMap };
  /** The committed escalation moved onto the small map, with `change` applied. */
  const fitted = (change: (fit: MapEscalation) => MapEscalation) => {
    const fit = {
      ...escalation,
      keep: { ...escalation.keep, ...onMap },
      attacks: { ...escalation.attacks, targets: [{ ...target, ...onMap, landings: [landing] }] },
      heroes: escalation.heroes.map((hero) => ({ ...hero, ...onMap })),
      ...(escalation.porters === undefined ? {} : { porters: { ...escalation.porters, ...onMap } }),
    };
    return { ...VARIANT, escalation: change(fit) };
  };
  const off = { x: 20, y: 0 };

  it('passes a variant whose objects and points all fit', () => {
    const placed = { ...fitted((fit) => fit), landscapeObjects: [{ object: 'cedar 01', hx: 19, hy: 9 }] };
    expect(() => assertMapVariantFitsMap(placed, SIZE)).not.toThrow();
  });

  it('refuses a placed object or an escalation point off the map', () => {
    const placed = { ...fitted((fit) => fit), landscapeObjects: [{ object: 'cedar 01', hx: 0, hy: 10 }] };
    expect(() => assertMapVariantFitsMap(placed, SIZE)).toThrow(/places cedar 01 at \(0, 10\)/);
    const [fitTarget] = fitted((fit) => fit).escalation.attacks.targets;
    if (fitTarget === undefined) throw new Error('no target');
    const offPoints = [
      fitted((fit) => ({ ...fit, keep: { ...fit.keep, ...off } })),
      fitted((fit) => ({ ...fit, attacks: { ...fit.attacks, targets: [{ ...fitTarget, ...off }] } })),
      fitted((fit) => ({
        ...fit,
        attacks: {
          ...fit.attacks,
          targets: [{ ...fitTarget, landings: [{ ...landing, spawnX: off.x, spawnY: off.y }] }],
        },
      })),
      fitted((fit) => ({
        ...fit,
        attacks: { ...fit.attacks, targets: [{ ...fitTarget, landings: [{ ...landing, ...off }] }] },
      })),
      fitted((fit) => ({ ...fit, heroes: fit.heroes.map((hero) => ({ ...hero, ...off })) })),
      fitted((fit) => (fit.porters === undefined ? fit : { ...fit, porters: { ...fit.porters, ...off } })),
    ];
    for (const variant of offPoints) {
      expect(() => assertMapVariantFitsMap(variant, SIZE)).toThrow(/at \(20, 0\) lies off the map/);
    }
  });
});

describe('applyMapVariantSlots', () => {
  it('re-reads only the replaced seats of a map index roster', () => {
    const slots = mapLobbySlots(SCRIPT);
    const patched = applyMapVariantSlots(slots, VARIANT);

    expect(patched[0]).toBe(slots[0]);
    expect(patched[1]).toMatchObject({ claimable: true, aiAllowed: true, noneAllowed: true });
  });
});

describe('applyMapVariantBriefing', () => {
  const OPENING = 0;
  const WON = 1;
  const text = (value: string) => ({ kind: 'text' as const, style: 'body' as const, text: value });
  const BRIEFING = MapBriefing.parse({
    texts: {
      pol: { [OPENING]: [text('start')], [WON]: [text('won')] },
      eng: { [OPENING]: [text('start')] },
      chs: { [OPENING]: [text('start')] },
    },
  });
  const told = MapVariant.parse({
    ...VARIANT,
    briefingPages: {
      [OPENING]: { pol: [text('tryb')], eng: [text('mode')] },
      [WON]: { eng: [text('victory')] },
    },
  });

  it('replaces the written pages in each language, a missing one read in its fallback', () => {
    const patched = applyMapVariantBriefing(BRIEFING, told);

    expect(patched.texts.pol?.[OPENING]).toEqual([text('tryb')]);
    expect(patched.texts.pol?.[WON]).toEqual([text('victory')]);
    expect(patched.texts.eng?.[OPENING]).toEqual([text('mode')]);
    expect(patched.texts.eng?.[WON]).toBeUndefined();
    expect(patched.texts.chs?.[OPENING]).toEqual([text('mode')]);
    expect(applyMapVariantBriefing(BRIEFING, VARIANT)).toBe(BRIEFING);
  });
});

describe('applyMapVariantStrings', () => {
  it('adds each escalation hero’s name under its string id and refuses an id the map uses', () => {
    const committed = MAP_VARIANTS.find((row) => (row.escalation?.heroes.length ?? 0) > 0);
    const hero = committed?.escalation?.heroes[0];
    if (committed === undefined || hero === undefined) throw new Error('no committed hero');
    const id = String(hero.nameStringId);
    const strings = applyMapVariantStrings({ pol: { '1': 'Mapa' } }, committed);
    expect(strings?.pol).toEqual({ '1': 'Mapa', [id]: hero.name.pol });
    expect(strings?.eng?.[id]).toBe(hero.name.eng);
    expect(() => applyMapVariantStrings({ eng: { [id]: 'taken' } }, committed)).toThrow(id);
  });
});

describe('MapEscalation', () => {
  it('refuses a schedule or gear steps out of order, a seat targeted twice, a refill above its max or an unknown notice', () => {
    const variant = MAP_VARIANTS.find((row) => row.escalation !== undefined);
    if (variant?.escalation === undefined) throw new Error('no committed escalation to vary');
    const { attacks, guard, gear, keep } = variant.escalation;
    if (gear === undefined) throw new Error('no committed gear to vary');
    const [target, other] = attacks.targets;
    if (target === undefined || other === undefined) throw new Error('no two committed targets to vary');
    for (const bad of [
      { attacks: { ...attacks, launches: [...attacks.launches].reverse() } },
      { attacks: { ...attacks, targets: [target, target] } },
      { attacks: { ...attacks, targets: [target, { ...other, raider: target.raider }] } },
      { attacks: { ...attacks, targets: [{ ...target, raider: keep.seat }] } },
      { attacks: { ...attacks, targets: [target, { ...other, raider: target.seat }] } },
      { guard: { ...guard, refill: { ...guard.refill, baseMen: guard.refill.maxMen + 1 } } },
      { gear: { ...gear, steps: [...gear.steps].reverse() } },
      { attacks: { ...attacks, noticeKey: 'forteca.atack' } },
    ]) {
      expect(MapEscalation.safeParse({ ...variant.escalation, ...bad }).success).toBe(false);
    }
  });
});

describe('MAP_VARIANTS', () => {
  it('holds at most one variant of each kind per map', () => {
    const keys = MAP_VARIANTS.map((variant) => `${variant.mapId}/${variant.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
