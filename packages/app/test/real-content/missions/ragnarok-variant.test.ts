import { readFileSync } from 'node:fs';
import {
  applyMapVariantStrings,
  findMapVariant,
  type MapEscalation,
  type MapVariant,
  mapLobbySlots,
  TerrainMapFile,
} from '@open-northland/data';
import {
  components,
  type Entity,
  hexDistanceBetween,
  nodeOfPosition,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import { buildMapWorld } from '../../../src/entries/map/world.js';
import { mapSessionWorld, variantMap, variantMapScript } from '../../../src/game/map/variant.js';
import { GATHERERS } from '../../../src/game/sandbox/ids/index.js';
import { mapScriptWorld, resolveMissionScript } from '../../../src/game/world/mission-script.js';
import { hasRealIr, loadContentUnderTest, rawIrUnderTest } from '../helpers.js';
import { realMapPath, realMapScript, realMapSessionWorld } from '../real-map-world.js';

const MAP_ID = 'specjalna_forteca';
const AUTHORED_PLAYER_SEATS = [0, 1, 2, 3];
const VILLAGE_SEATS = [4, 5];
/** The fortress's refill pulse, the villages' take-over missions, then the raider waves: the 60-minute
 *  start and a generate and restart pair for each of the six raider seats, by authored index. */
const REFILL_MISSIONS = [3, 4];
const TAKE_OVER_MISSIONS = [9, 10];
const FIRST_WAVE_MISSION = 11;
const WAVE_MISSIONS = 13;
/** Owner ruling: Lord Usurper stands a fifth taller than his men. */
const LORD_SCALE_PCT = 120;
const DROPPED_MISSIONS = [
  ...REFILL_MISSIONS,
  ...TAKE_OVER_MISSIONS,
  ...Array.from({ length: WAVE_MISSIONS }, (_, i) => FIRST_WAVE_MISSION + i),
];

function scripts() {
  const authored = realMapScript(MAP_ID);
  if (authored === null) throw new Error(`no decoded script for ${MAP_ID}`);
  return { authored, ragnarok: variantMapScript(authored, mapSessionWorld(MAP_ID, 'ragnarok')) };
}

describe.runIf(hasRealIr())('Ragnarök on specjalna_forteca', () => {
  it('opens the two villages as player seats', () => {
    const { authored, ragnarok } = scripts();
    const claimable = (script: typeof authored) =>
      mapLobbySlots(script)
        .filter((slot) => slot.claimable)
        .map((slot) => slot.player);

    expect(claimable(authored)).toEqual(AUTHORED_PLAYER_SEATS);
    expect(claimable(ragnarok)).toEqual([...AUTHORED_PLAYER_SEATS, ...VILLAGE_SEATS]);
  });

  it('neutralises the refill pulse, take-over missions and raider waves without renumbering the script', () => {
    const { authored, ragnarok } = scripts();

    expect(ragnarok.missions.map((m) => m.debugName)).toEqual(authored.missions.map((m) => m.debugName));
    const emptied = ragnarok.missions.flatMap((m, i) =>
      m.goals.length === 0 && m.results.length === 0 ? [i] : [],
    );
    expect(emptied).toEqual(DROPPED_MISSIONS);
    // Seat 4's headquarters held every trade agreement the map authors.
    expect(authored.tradeAgreements.length).toBeGreaterThan(0);
    expect(ragnarok.tradeAgreements).toEqual([]);
  });

  it('resolves the patched script with no name the authored one did not leave unresolved', () => {
    const { authored, ragnarok } = scripts();
    const ir = rawIrUnderTest() as ContentIr;
    const before = resolveMissionScript(authored.missions, ir);
    const after = resolveMissionScript(ragnarok.missions, ir);

    expect(after.unknownOpcodes).toBe(before.unknownOpcodes);
    expect(after.tokenMismatches).toBe(before.tokenMismatches);
    expect(after.unresolvedNames).toEqual(before.unresolvedNames);
  });

  it('multiplies only goods a map deposit spawns as', () => {
    const variant = findMapVariant(MAP_ID, 'ragnarok');
    const gathered = new Set(GATHERERS.map((g) => g.id));
    expect(Object.keys(variant?.depositYield ?? {}).filter((good) => !gathered.has(good))).toEqual([]);
  });
});

describe.runIf(hasRealIr())('a Ragnarök world on specjalna_forteca', () => {
  const SEARCH = 'map=specjalna_forteca&player=4&missions=off&seed=7';
  const PLAIN_SEAT = 4;
  const PLAIN_HEADQUARTERS = { x: 250, y: 112 };
  /** How far from the plain's headquarters its placed clay and trees stand at the most, in map points:
   *  the north cedars stand across the lake. */
  const PLAIN_REACH = 65;
  /** How near a placed object no building of the seat's may stand, in map points: its houses' bodies. */
  const BUILDING_CLEARANCE = 6;

  /** The map as authored and as Ragnarök starts it. */
  const worlds = () =>
    Promise.all([realMapSessionWorld(`?${SEARCH}`), realMapSessionWorld(`?${SEARCH}&variant=ragnarok`)]);

  function nodeOf(sim: Simulation, e: Entity) {
    const at = sim.world.get(e, components.Position);
    return nodeOfPosition(at.x, at.y);
  }

  /** The stock of the good's nodes the map itself places, by their placement join. */
  function placedStock(sim: Simulation, goodType: number): number {
    let total = 0;
    for (const e of sim.world.query(components.Resource, components.LandscapeResource)) {
      const resource = sim.world.get(e, components.Resource);
      if (resource.goodType === goodType) total += resource.remaining;
    }
    return total;
  }

  function goodType(sim: Simulation, id: string): number {
    const good = sim.content.goods.find((g) => g.id === id);
    if (good === undefined) throw new Error(`no good ${id}`);
    return good.typeId;
  }

  it('starts every map-placed node of a boosted good, trees, stone and clay included, at the variant factor', async () => {
    const yields = findMapVariant(MAP_ID, 'ragnarok')?.depositYield ?? {};
    const [authored, ragnarok] = await worlds();
    expect(Object.keys(yields)).toEqual(expect.arrayContaining(['gold', 'wood', 'stone', 'mud']));

    for (const [good, factor] of Object.entries(yields)) {
      const type = goodType(authored, good);
      expect(placedStock(authored, type), good).toBeGreaterThan(0);
      expect(placedStock(ragnarok, type), good).toBe(placedStock(authored, type) * factor);
    }
  });

  it('gives the plain clay and a grove near its headquarters, on free ground its people reach', async () => {
    const placed = findMapVariant(MAP_ID, 'ragnarok')?.landscapeObjects ?? [];
    const [authored, ragnarok] = await worlds();
    const terrain = ragnarok.terrain;
    if (terrain === undefined) throw new Error('no terrain');
    const mud = goodType(ragnarok, 'mud');
    const wood = goodType(ragnarok, 'wood');
    const at = (sim: Simulation, hx: number, hy: number) =>
      [...sim.world.query(components.Resource, components.Position)].filter((e) => {
        const node = nodeOf(sim, e);
        return node.hx === hx && node.hy === hy;
      });
    const home = [...ragnarok.world.query(components.Person, components.Owner)].find(
      (e) => ragnarok.world.get(e, components.Owner).player === PLAIN_SEAT,
    );
    if (home === undefined) throw new Error('the plain has no people');
    const homeNode = nodeOf(ragnarok, home);
    const land = terrain.componentOf(terrain.nodeAt(homeNode.hx, homeNode.hy));
    const buildings = [...ragnarok.world.query(components.Building, components.Position)].map((e) =>
      nodeOf(ragnarok, e),
    );

    const kinds = new Map<number, number>();
    for (const { object, hx, hy } of placed) {
      const label = `${object} at ${hx},${hy}`;
      expect(
        hexDistanceBetween(hx, hy, PLAIN_HEADQUARTERS.x, PLAIN_HEADQUARTERS.y),
        label,
      ).toBeLessThanOrEqual(PLAIN_REACH);
      // Open land the map left empty, off every house, with a walkable neighbour on the plain's land.
      expect(at(authored, hx, hy), label).toEqual([]);
      const node = terrain.nodeAt(hx, hy);
      expect(terrain.isWalkable(node) && terrain.isBuildable(node), label).toBe(true);
      for (const b of buildings)
        expect(hexDistanceBetween(hx, hy, b.hx, b.hy), label).toBeGreaterThanOrEqual(BUILDING_CLEARANCE);
      expect(terrain.componentOf(terrain.nodeAt(hx + 1, hy)), label).toBe(land);
      const [node0, ...more] = at(ragnarok, hx, hy);
      expect(more, label).toEqual([]);
      const kind = node0 === undefined ? -1 : ragnarok.world.get(node0, components.Resource).goodType;
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    expect([...kinds.keys()].sort()).toEqual([mud, wood].sort());
  });
});

describe.runIf(hasRealIr())('every player seat of a Ragnarök world', () => {
  const PLAYER_SEATS = [...AUTHORED_PLAYER_SEATS, ...VILLAGE_SEATS];
  const FORTRESS_SIDE = [6, 7, 8, 9, 10, 11, 12];
  /** Idle seats keep their soldiers, which a computer seat would demobilize at the first turn. */
  const SEARCH = `?map=${MAP_ID}&player=0&idle=1,2,3,4,5&seed=7&variant=ragnarok`;
  /** The most map points any of seat 0's people stands from its headquarters. */
  const START_REACH = 20;
  /** How near its headquarters no one stands, in map points: the house's body. */
  const HOUSE_CLEARANCE = 6;

  function headquartersOf(sim: Simulation, seat: number): Entity {
    const house = [...sim.world.query(components.Building, components.Owner)].find(
      (e) => sim.world.get(e, components.Owner).player === seat,
    );
    if (house === undefined) throw new Error(`seat ${seat} has no house`);
    return house;
  }

  function peopleOf(sim: Simulation, seat: number): Entity[] {
    return [...sim.world.query(components.Person, components.Owner)].filter(
      (e) => sim.world.get(e, components.Owner).player === seat,
    );
  }

  /** What a seat starts with, in names and counts only: its people with their trades and gear, its
   *  house's stock, its papers, its diplomacy locks with the fortress side and its discoveries. */
  function startOf(sim: Simulation, seat: number) {
    const w = sim.world;
    const job = new Map(sim.content.jobs.map((j) => [j.typeId, j.id]));
    const good = new Map(sim.content.goods.map((g) => [g.typeId, g.id]));
    const people = peopleOf(sim, seat)
      .map((e) => {
        const eq = w.tryGet(e, components.Equipment);
        const gear = eq === undefined ? [] : [eq.weapon, eq.armor, eq.tool, ...eq.misc];
        const carried = w.tryGet(e, components.Carrying);
        return [
          job.get(w.get(e, components.Settler).jobType ?? -1),
          w.has(e, components.Female) ? 'female' : 'male',
          ...gear.flatMap((slot) => (slot === null ? [] : [good.get(slot.goodType)])),
          ...(carried === undefined ? [] : [`${good.get(carried.goodType)} x${carried.amount}`]),
        ].join(' ');
      })
      .sort();
    const house = headquartersOf(sim, seat);
    const stock = [...(w.tryGet(house, components.Stockpile)?.amounts ?? [])]
      .map(([type, amount]) => `${good.get(type)} ${amount}`)
      .sort();
    const papers = components
      .playerPaperSlots(w, seat)
      .flatMap((paper) => (paper === null ? [] : [`${paper.kind} ${paper.param}`]))
      .sort();
    const discoveries = w.lowestEntityWith(components.TechnologyDiscoveries);
    const discovered =
      discoveries === null
        ? []
        : w
            .get(discoveries, components.TechnologyDiscoveries)
            .rows.filter((row) => row.player === seat)
            .map((row) => `${row.kind} ${row.typeId}`)
            .sort();
    const locks = FORTRESS_SIDE.filter((other) => components.diplomacyLocked(w, seat, other));
    return {
      house: w.get(house, components.Building).buildingType,
      people,
      stock,
      papers,
      locks,
      discovered,
    };
  }

  it('starts each seat with what seat 0 starts with', async () => {
    const sim = await realMapSessionWorld(SEARCH);
    sim.run(2);
    const seat0 = startOf(sim, 0);
    expect(seat0.people.length).toBeGreaterThan(0);
    expect(seat0.papers.length).toBeGreaterThan(0);
    expect(seat0.locks).toEqual(FORTRESS_SIDE);
    for (const seat of PLAYER_SEATS) expect(startOf(sim, seat), `seat ${seat}`).toEqual(seat0);

    // The gatherers' authored picks, which the counters above do not show.
    const map = variantMap(
      TerrainMapFile.parse(JSON.parse(readFileSync(realMapPath(MAP_ID), 'utf8'))),
      mapSessionWorld(MAP_ID, 'ragnarok'),
    );
    const picks = (seat: number) =>
      (map?.entities?.humans ?? [])
        .filter((h) => h.player === seat)
        .map((h) => `${h.role} ${h.producedGood ?? ''}`)
        .sort();
    for (const seat of PLAYER_SEATS) expect(picks(seat), `seat ${seat}`).toEqual(picks(0));
  });

  it('shows each seat the fortress at the start', () => {
    const reveals = scripts()
      .ragnarok.missions.flatMap((m) => m.results)
      .filter((line) => line.values[0] === 'ExploreArea' && line.values.slice(2).join() === '245,246,40')
      .map((line) => Number(line.values[1]));
    expect([...new Set(reveals)].sort()).toEqual(PLAYER_SEATS);
  });

  it('stands each seat’s people near its headquarters on open ground of its land', async () => {
    const sim = await realMapSessionWorld(SEARCH);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('no terrain');
    const node = (e: Entity) => {
      const at = sim.world.get(e, components.Position);
      return nodeOfPosition(at.x, at.y);
    };
    const resources = new Set(
      [...sim.world.query(components.Resource, components.Position)].map((e) => {
        const at = node(e);
        return `${at.hx},${at.hy}`;
      }),
    );
    for (const seat of PLAYER_SEATS) {
      const people = peopleOf(sim, seat).map(node);
      const home = node(headquartersOf(sim, seat));
      const land = terrain.componentOf(terrain.nodeAt(people[0]?.hx ?? 0, people[0]?.hy ?? 0));
      for (const at of people) {
        const label = `seat ${seat} at ${at.hx},${at.hy}`;
        const n = terrain.nodeAt(at.hx, at.hy);
        expect(terrain.isWalkable(n) && terrain.componentOf(n) === land, label).toBe(true);
        expect(resources.has(`${at.hx},${at.hy}`), label).toBe(false);
        const away = hexDistanceBetween(at.hx, at.hy, home.hx, home.hy);
        expect(away, label).toBeGreaterThanOrEqual(HOUSE_CLEARANCE);
        expect(away, label).toBeLessThanOrEqual(START_REACH);
      }
    }
  });
});

describe.runIf(hasRealIr())('a Ragnarök attack on specjalna_forteca', () => {
  const FORTRESS = 6;
  const HUMAN_SEAT = 0;
  const COMPUTER_SEATS = [1, 2, 3];
  /** Left idle: its people stand, so it is attacked like any played seat. */
  const IDLE_SEAT = 4;
  const ABSENT_SEAT = 5;
  const FORTRESS_SIDE = [FORTRESS, 7, 8, 9, 10, 11, 12];
  /** The first launch moved this early, so the run reaches it in seconds of sim time. */
  const EARLY_LAUNCH_SECONDS = 20;
  const TICKS_PER_SECOND = 12;
  /** Two handler rounds for the raider to list and order its band, then a minute of march. */
  const MARCH_TICKS = 2 * systems.AI_HANDLER_ROUND_TICKS + 60 * TICKS_PER_SECOND;
  /** How far march ground the band covers at the least, in map points. */
  const MARCHED = 20;
  /** The most ships a wave sends against one seat, each from its own landing point. */
  const MAX_SHIPS = 5;
  /** The mean distance of the garrison from the keep: its Defend posts lie within 40 of it. */
  const GARRISON_REACH = 40;

  function ragnarok(): MapEscalation {
    const escalation = findMapVariant(MAP_ID, 'ragnarok')?.escalation;
    if (escalation === undefined) throw new Error('Ragnarök ships no escalation');
    return escalation;
  }

  /** The escalation with its first launch at {@link EARLY_LAUNCH_SECONDS}. */
  function earlyAttack(): MapEscalation {
    const real = ragnarok();
    const [first, ...later] = real.attacks.launches;
    if (first === undefined) throw new Error('no first launch');
    return {
      ...real,
      attacks: { ...real.attacks, launches: [{ ...first, atSeconds: EARLY_LAUNCH_SECONDS }, ...later] },
    };
  }

  async function earlyAttackWorld(
    escalation: MapEscalation = earlyAttack(),
    absentSeats: readonly number[] = [ABSENT_SEAT],
  ): Promise<Simulation> {
    const ir = rawIrUnderTest() as ContentIr;
    const { merge } = await loadContentUnderTest();
    const authoredMap = TerrainMapFile.parse(JSON.parse(readFileSync(realMapPath(MAP_ID), 'utf8')));
    const map = variantMap(authoredMap, mapSessionWorld(MAP_ID, 'ragnarok'));
    const { ragnarok: script } = scripts();
    return buildMapWorld({
      seed: 7,
      map,
      ir,
      content: { content: merge.content },
      machineSeats: [...COMPUTER_SEATS, ...FORTRESS_SIDE],
      absentSeats,
      assistantSeats: [0],
      script: { ...mapScriptWorld(script, ir), escalation },
      fog: null,
      progression: null,
      needs: null,
      alliedVision: null,
      peace: null,
      missions: false,
      berryBushes: false,
    }).sim;
  }

  function owned(sim: Simulation, seat: number): Entity[] {
    return [...sim.world.query(components.Person, components.Owner)].filter(
      (e) => sim.world.get(e, components.Owner).player === seat,
    );
  }

  function meanDistance(sim: Simulation, men: readonly Entity[], to: { x: number; y: number }): number {
    let sum = 0;
    for (const e of men) {
      const at = sim.world.get(e, components.Position);
      const node = nodeOfPosition(at.x, at.y);
      sum += hexDistanceBetween(node.hx, node.hy, to.x, to.y);
    }
    return sum / men.length;
  }

  it('sends each occupied seat’s raider its band from the keep, and leaves the garrison home', async () => {
    const sim = await earlyAttackWorld();
    const escalation = ragnarok();
    const { keep, attacks } = escalation;
    const garrison = owned(sim, FORTRESS);
    const launch = EARLY_LAUNCH_SECONDS * TICKS_PER_SECOND;
    let launched: number[] | null = null;
    while (sim.tick < launch) {
      sim.step();
      for (const ev of sim.events.current())
        if (ev.kind === 'mapEscalationAttackLaunched') launched = [...ev.seats];
    }
    expect(launched).toEqual([0, ...COMPUTER_SEATS, IDLE_SEAT]);
    const firstWave = attacks.launches[0]?.landMen;
    const bands = new Map(attacks.targets.map((target) => [target, owned(sim, target.raider)]));
    for (const [target, band] of bands) {
      expect(band, `raider ${target.raider}`).toHaveLength(
        target.seat === ABSENT_SEAT ? 0 : (firstWave ?? -1),
      );
      if (band.length > 0) expect(meanDistance(sim, band, keep)).toBeLessThan(keep.range);
    }
    expect(sim.mapEscalationView()).toMatchObject({ wave: 1, attackRunning: true });

    sim.run(MARCH_TICKS);
    for (const [target, band] of bands) {
      // An idle seat's own soldiers may already have felled a few.
      const living = band.filter((e) => sim.world.has(e, components.Position));
      if (living.length === 0) continue;
      const from = hexDistanceBetween(keep.x, keep.y, target.x, target.y);
      expect(meanDistance(sim, living, target), `raider ${target.raider}`).toBeLessThan(from - MARCHED);
    }
    // The garrison is the fortress's own still, standing in the fortress; catapult crews stand nowhere.
    const standing = garrison.filter((e) => sim.world.has(e, components.Position));
    for (const e of garrison) expect(sim.world.tryGet(e, components.Owner)?.player).toBe(FORTRESS);
    expect(meanDistance(sim, standing, keep)).toBeLessThan(GARRISON_REACH);
  }, 300_000);

  it('brings every band to its seat’s headquarters within minutes, no man left standing idle', async () => {
    const sim = await earlyAttackWorld();
    const { targets } = ragnarok().attacks;
    /** A band is at its target once every living man stands this near the headquarters, in map points. */
    const ARRIVED = 25;
    const WATCH_SECONDS = 300;
    /** The longest a man may stand on one node with nothing to fight or strike while his seat still has
     *  an aim: a seat razed and emptied leaves its band standing. */
    const IDLE_SECONDS = 10;
    sim.run(EARLY_LAUNCH_SECONDS * TICKS_PER_SECOND + 1 - sim.tick);
    const bands = targets
      .map((target) => ({ target, men: owned(sim, target.raider) }))
      .filter((band) => band.men.length > 0);
    expect(bands.length).toBeGreaterThan(0);
    // An attack-move out of the keep, not a strike across the map: no man walks in the readied fight gait.
    sim.run(TICKS_PER_SECOND);
    for (const { men } of bands)
      for (const e of men) {
        expect(sim.world.get(e, components.PlayerOrder).attackMove).toBeDefined();
        expect(sim.world.has(e, components.Engagement)).toBe(false);
      }
    const nodeOf = (e: Entity) => {
      const at = sim.world.get(e, components.Position);
      return nodeOfPosition(at.x, at.y);
    };
    const busy = (e: Entity) =>
      sim.world.has(e, components.Engagement) ||
      sim.world.has(e, components.AttackOrder) ||
      sim.world.has(e, components.CurrentAtomic);
    const idle = new Map<Entity, { hx: number; hy: number; seconds: number }>();
    let longestIdle = 0;
    const arrived = new Set<number>();
    for (let second = 0; second < WATCH_SECONDS; second++) {
      sim.run(TICKS_PER_SECOND);
      for (const { target, men } of bands) {
        const living = men.filter((e) => sim.world.isAlive(e) && sim.world.has(e, components.Position));
        if (
          living.every((e) => hexDistanceBetween(nodeOf(e).hx, nodeOf(e).hy, target.x, target.y) <= ARRIVED)
        )
          arrived.add(target.seat);
        const aimed = components.mapEscalationProgress(sim.world).focus.some((f) => f.seat === target.seat);
        for (const e of living) {
          const at = nodeOf(e);
          const last = idle.get(e);
          const seconds =
            aimed && !busy(e) && last !== undefined && last.hx === at.hx && last.hy === at.hy
              ? last.seconds + 1
              : 0;
          idle.set(e, { ...at, seconds });
          longestIdle = Math.max(longestIdle, seconds);
        }
      }
    }
    expect([...arrived].sort()).toEqual(bands.map((band) => band.target.seat).sort());
    expect(longestIdle).toBeLessThan(IDLE_SECONDS);
  }, 600_000);

  it('gears the fortress side’s soldiers, existing and new, and raises a lost catapult again', async () => {
    const early = earlyAttack();
    const gear = early.gear;
    const respawn = early.catapults;
    if (gear === undefined || respawn === undefined) throw new Error('Ragnarök ships no gear or catapults');
    /** Every gear step one second apart from the second second on, all passed before the first launch. */
    const FIRST_STEP_SECONDS = 2;
    const CATAPULT_RESPAWN_SECONDS = 30;
    const escalation: MapEscalation = {
      ...early,
      gear: { ...gear, steps: gear.steps.map((step, i) => ({ ...step, atSeconds: FIRST_STEP_SECONDS + i })) },
      catapults: { respawnSeconds: CATAPULT_RESPAWN_SECONDS },
    };
    const sim = await earlyAttackWorld(escalation);
    const goods = new Map(sim.content.goods.map((good) => [good.id, good]));
    const typeOf = (slug: string): number => goods.get(slug)?.typeId ?? -1;
    const heavyArmor = (gear.steps[1]?.grants[0]?.goods ?? []).map(typeOf);
    const amulets = (gear.steps[2]?.grants[0]?.goods ?? []).map(typeOf);
    const healDraught = typeOf('potion_heal_big');
    // The goods carry the effects the combat reads: armor tiers, the amulets' effects and a heal.
    for (const step of gear.steps)
      for (const grant of step.grants)
        for (const slug of grant.goods) expect(goods.get(slug)?.equip, slug).toBeDefined();
    const upgrades = gear.steps.flatMap((step) => step.weaponUpgrades);
    expect(upgrades.length).toBeGreaterThan(0);
    // Each better weapon arms the tribe's next class of the same kind.
    const armed = (slug: string) =>
      sim.content.weapons.find((w) => w.tribeType === escalation.tribe && w.goodType === typeOf(slug));
    for (const { from, to } of upgrades) {
      expect(armed(to)?.mainType, `${from} -> ${to}`).toBe(armed(from)?.mainType);
      expect(armed(to)?.jobType, `${from} -> ${to}`).not.toBe(armed(from)?.jobType);
    }
    const spearJobs = sim.content.jobs
      .filter((job) => job.id.startsWith('soldier_spear'))
      .map((j) => j.typeId);
    expect(escalation.jobMix.some((share) => spearJobs.includes(share.job))).toBe(true);
    expect(goods.get('potion_heal_big')?.equip?.restorePct?.healthMax).toBeGreaterThan(0);
    expect(goods.get('amulet_defense')?.equip?.damageTakenPct).toBeDefined();

    // The porters' hauling carts are the fortress's vehicles too.
    const catapultType = sim.content.vehicles.find((v) => v.id === 'catapult')?.typeId;
    const fortressCatapults = () =>
      [...sim.world.query(components.Vehicle, components.Owner)].filter(
        (e) =>
          sim.world.get(e, components.Owner).player === FORTRESS &&
          sim.world.get(e, components.Vehicle).vehicleType === catapultType,
      );
    const catapults = fortressCatapults();
    expect(catapults.length).toBeGreaterThan(0);

    sim.run((FIRST_STEP_SECONDS + gear.steps.length) * TICKS_PER_SECOND - sim.tick);
    // Lord Usurper keeps what he was placed with, and a tower's archers keep their bows.
    const garrison = owned(sim, FORTRESS).filter(
      (e) =>
        sim.world.has(e, components.Equipment) &&
        !sim.world.has(e, components.ScriptedName) &&
        !sim.world.has(e, components.JobAssignment),
    );
    expect(garrison.length).toBeGreaterThan(gear.steps.length);
    const misc = (e: Entity) =>
      (sim.world.get(e, components.Equipment).misc ?? []).flatMap((slot) =>
        slot === null ? [] : [slot.goodType],
      );
    const worse = new Set(upgrades.map(({ from }) => typeOf(from)));
    for (const e of garrison) {
      const eq = sim.world.get(e, components.Equipment);
      expect(heavyArmor).toContain(eq.armor?.goodType);
      expect(eq.boots?.goodType).toBe(typeOf('shoes'));
      expect(eq.weapon).not.toBeNull();
      expect(worse.has(eq.weapon?.goodType ?? -1)).toBe(false);
      // The trade is the one the worn weapon arms.
      const worn = sim.content.weapons.find(
        (w) =>
          w.tribeType === sim.world.get(e, components.Settler).tribe && w.goodType === eq.weapon?.goodType,
      );
      expect(sim.world.get(e, components.Settler).jobType).toBe(worn?.jobType);
      expect(misc(e).some((good) => amulets.includes(good))).toBe(true);
    }
    expect(garrison.some((e) => misc(e).filter((good) => amulets.includes(good)).length === 2)).toBe(true);
    // The healing draught is a draw, so some soldiers carry one and some do not.
    const drawn = garrison.filter((e) => misc(e).includes(healDraught)).length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(garrison.length);

    const [lost] = catapults;
    if (lost === undefined) throw new Error('no catapult');
    const spot = sim.world.get(lost, components.Vehicle).guard;
    sim.world.mut(lost, components.Health).hitpoints = 0;
    sim.run((EARLY_LAUNCH_SECONDS + 1) * TICKS_PER_SECOND - sim.tick);
    const humanRaider = escalation.attacks.targets.find((target) => target.seat === HUMAN_SEAT)?.raider;
    const band = humanRaider === undefined ? [] : owned(sim, humanRaider);
    expect(band.length).toBeGreaterThan(0);
    for (const e of band)
      expect(heavyArmor).toContain(sim.world.tryGet(e, components.Equipment)?.armor?.goodType);
    expect(fortressCatapults()).toHaveLength(catapults.length - 1);

    // Seen lost within a second; the first refill beat a full wait after that raises it.
    const firstBeat = escalation.guard.refill.everySeconds * TICKS_PER_SECOND;
    sim.run(firstBeat + TICKS_PER_SECOND - sim.tick);
    const back = fortressCatapults().filter((e) => !catapults.includes(e));
    expect(back).toHaveLength(1);
    expect(sim.world.get(back[0] as Entity, components.Vehicle).guard).toEqual(spot);
  }, 300_000);

  it('lands every ship of a full wave at its own landing point, on the land its men walk to the target', async () => {
    const real = ragnarok();
    const landingWave = real.attacks.launches.find((row) => row.ships === MAX_SHIPS);
    if (landingWave === undefined || real.landings === undefined)
      throw new Error('Ragnarök ships no full landing wave');
    // The first full landing wave moved to the first launch, every seat occupied.
    const escalation: MapEscalation = {
      ...real,
      attacks: {
        ...real.attacks,
        launches: [{ ...landingWave, atSeconds: EARLY_LAUNCH_SECONDS }, ...real.attacks.launches.slice(1)],
      },
    };
    const sim = await earlyAttackWorld(escalation, []);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('no terrain');
    /** Time for the farthest ship to sail in, set its men down, and sail back off the map. */
    const VOYAGE_SECONDS = 240;
    /** How near its landing point a ship's men step ashore, in map points. */
    const ASHORE = 8;
    const { targets } = escalation.attacks;
    let landed: readonly number[] = [];
    sim.run(EARLY_LAUNCH_SECONDS * TICKS_PER_SECOND - sim.tick - 1);
    sim.step();
    for (const ev of sim.events.current()) if (ev.kind === 'mapEscalationLanding') landed = ev.seats;
    expect(landed).toEqual(targets.map((target) => target.seat));
    const ships = () =>
      [...sim.world.query(components.Vehicle, components.Owner)].filter((e) =>
        targets.some((target) => target.raider === sim.world.get(e, components.Owner).player),
      );
    const riders = [...sim.world.query(components.Rider)];
    // Each landing point's ship and the men riding it, commander's seat included, by the ship's record.
    const voyages = components.mapEscalationProgress(sim.world).landings.map((record) => {
      const target = targets.find((t) => t.seat === record.seat);
      const point = target?.landings[record.point];
      if (target === undefined || point === undefined) throw new Error(`no landing ${record.point}`);
      const men = riders.filter((e) => sim.world.get(e, components.Rider).vehicle === record.ship);
      return { target, point, men, label: `seat ${target.seat} landing ${record.point}` };
    });
    expect(voyages.map((v) => v.label)).toEqual(
      targets.flatMap((t) => t.landings.map((_, i) => `seat ${t.seat} landing ${i}`)),
    );
    expect(ships()).toHaveLength(voyages.length);
    for (const v of voyages) expect(v.men, v.label).toHaveLength(real.landings.menPerShip);

    // Each band's distance from its landing point on the tick its last man steps ashore.
    const landedAt = new Map<(typeof voyages)[number], number>();
    while (
      sim.tick < (EARLY_LAUNCH_SECONDS + VOYAGE_SECONDS) * TICKS_PER_SECOND &&
      landedAt.size < voyages.length
    ) {
      sim.step();
      for (const v of voyages)
        if (!landedAt.has(v) && v.men.every((e) => sim.world.has(e, components.Position)))
          landedAt.set(v, meanDistance(sim, v.men, v.point));
    }
    for (const v of voyages) {
      expect(landedAt.get(v), v.label).toBeLessThan(ASHORE);
      const shore = terrain.componentOf(terrain.nodeAt(v.point.x, v.point.y));
      expect(shore, v.label).toBe(terrain.componentOf(terrain.nodeAt(v.target.x, v.target.y)));
    }
    while (sim.tick < (EARLY_LAUNCH_SECONDS + 2 * VOYAGE_SECONDS) * TICKS_PER_SECOND && ships().length > 0)
      sim.step();
    expect(ships()).toEqual([]);
  }, 900_000);

  it('turns the computer seats’ soldiers into civilians at the start, the human seat keeping its own', async () => {
    const SETTLE_TICKS = 5 * TICKS_PER_SECOND;
    // The placed army, before the computer player's first decision disarms its own start soldiers.
    const armed = await earlyAttackWorld({ ...ragnarok(), demobilizeComputerSeats: false });
    const demobilized = await earlyAttackWorld({ ...ragnarok(), demobilizeComputerSeats: true });
    demobilized.run(SETTLE_TICKS);
    const soldiers = (sim: Simulation, seat: number) =>
      owned(sim, seat).filter((e) =>
        systems.isSoldierJob(sim.content, sim.world.get(e, components.Settler).jobType),
      ).length;

    expect(soldiers(demobilized, HUMAN_SEAT)).toBeGreaterThan(0);
    expect(soldiers(demobilized, HUMAN_SEAT)).toBe(soldiers(armed, HUMAN_SEAT));
    for (const seat of COMPUTER_SEATS) {
      expect(soldiers(armed, seat), `seat ${seat}`).toBeGreaterThan(0);
      expect(soldiers(demobilized, seat), `seat ${seat}`).toBe(0);
      expect(owned(demobilized, seat), `seat ${seat}`).toHaveLength(owned(armed, seat).length);
    }
  }, 300_000);

  it('keeps the fortress’s builders and porters: a razed palisade goes up again, a pile at a gate is carted in', async () => {
    const escalation = ragnarok();
    const { builders, porters, keep } = escalation;
    if (builders === undefined || porters === undefined) throw new Error('Ragnarök keeps no fortress crew');
    const sim = await earlyAttackWorld(escalation);
    const w = sim.world;
    const jobOf = (slug: string) => sim.content.jobs.find((job) => job.id === slug)?.typeId ?? -1;
    const crew = (slug: string) =>
      owned(sim, FORTRESS).filter((e) => w.get(e, components.Settler).jobType === jobOf(slug));
    const store = [...w.query(components.Building, components.Owner)].find(
      (e) =>
        w.get(e, components.Owner).player === FORTRESS &&
        sim.content.buildings.find((b) => b.typeId === w.get(e, components.Building).buildingType)?.kind ===
          'storage',
    );
    if (store === undefined) throw new Error('the fortress has no store');
    /** The first refill beat makes the crew; the first launch lies half an hour out. */
    const CREWED_SECONDS = escalation.guard.refill.everySeconds + 1;
    /** Beside the north gate, 47 map points from the keep. */
    const GATE_PILE = { x: 252, y: 196 };
    /** The outermost palisade stands 56 map points from the keep. */
    const FORTRESS_REACH = 60;
    const HAUL_SECONDS = 360;

    sim.run(CREWED_SECONDS * TICKS_PER_SECOND - sim.tick);
    expect(crew('builder')).toHaveLength(builders.count);
    const carriers = crew('carrier').filter(
      (e) => w.tryGet(e, components.JobAssignment)?.workplace === store,
    );
    expect(carriers).toHaveLength(porters.count);
    for (const e of carriers) expect(w.has(e, components.HaulingCart)).toBe(true);

    const nodeOf = (e: Entity) => {
      const at = w.get(e, components.Position);
      return nodeOfPosition(at.x, at.y);
    };
    const walls = [...w.query(components.Palisade, components.Owner)].filter(
      (e) => w.get(e, components.Owner).player === FORTRESS,
    );
    const fromKeep = (e: Entity) => hexDistanceBetween(nodeOf(e).hx, nodeOf(e).hy, keep.x, keep.y);
    const [razed] = walls.sort((a, b) => fromKeep(a) - fromKeep(b) || a - b);
    if (razed === undefined) throw new Error('the fortress has no palisade');
    const spot = nodeOf(razed);
    w.mut(razed, components.Health).hitpoints = 0;
    const sword = sim.content.goods.find((good) => good.id === 'sword_long')?.typeId ?? -1;
    const stocked = () => w.get(store, components.Stockpile).amounts.get(sword) ?? 0;
    const before = stocked();
    const pile = systems.createGroundGoods(w, { goodType: sword, amount: 4, ...GATE_PILE });
    const rebuilt = () =>
      [...w.query(components.Palisade, components.Position)].some((e) => {
        const at = nodeOf(e);
        return at.hx === spot.hx && at.hy === spot.hy && !w.has(e, components.UnderConstruction);
      });
    let most = before;
    let reach = 0;
    let raisedAt: number | null = null;
    const end = (CREWED_SECONDS + HAUL_SECONDS) * TICKS_PER_SECOND;
    while (sim.tick < end && (raisedAt === null || w.isAlive(pile) || most === before)) {
      sim.step();
      most = Math.max(most, stocked());
      if (raisedAt === null && sim.tick % TICKS_PER_SECOND === 0 && rebuilt()) raisedAt = sim.tick;
      for (const e of [...crew('builder'), ...carriers])
        if (w.has(e, components.Position)) reach = Math.max(reach, fromKeep(e));
    }
    // Without the crew the seat's four civilians stand at its posts and the site is never built.
    expect(raisedAt).not.toBeNull();
    expect(w.isAlive(pile)).toBe(false);
    expect(most).toBeGreaterThan(before);
    expect(reach).toBeLessThan(FORTRESS_REACH);
  }, 300_000);

  it('mans every fortress tower with its bows on the first beat, and stands Lord Usurper at the keep', async () => {
    const escalation = ragnarok();
    const { towerGarrison, keep } = escalation;
    const [lord] = escalation.heroes;
    if (towerGarrison === undefined || lord === undefined) throw new Error('Ragnarök mans no towers');
    const sim = await earlyAttackWorld(escalation);
    const w = sim.world;
    const towers = [...w.query(components.Building, components.Owner)].filter(
      (e) =>
        w.get(e, components.Owner).player === FORTRESS &&
        sim.content.buildings.find((b) => b.typeId === w.get(e, components.Building).buildingType)?.kind ===
          'tower',
    );
    /** The towers the owner counted in the fortress. */
    const FORTRESS_TOWERS = 16;
    expect(towers).toHaveLength(FORTRESS_TOWERS);

    sim.run((escalation.guard.refill.everySeconds + 1) * TICKS_PER_SECOND - sim.tick);
    // The map AI remembers every tower for rebuilding, each on its own anchor.
    const program = [...w.query(components.MapAiState)].find(
      (e) => w.get(e, components.MapAiState).player === FORTRESS,
    );
    const houses = program === undefined ? [] : w.get(program, components.MapAiState).houses;
    for (const e of towers) {
      const at = nodeOfPosition(w.get(e, components.Position).x, w.get(e, components.Position).y);
      expect(
        houses.some((house) => hexDistanceBetween(house.hx, house.hy, at.hx, at.hy) <= 2),
        `tower ${e}`,
      ).toBe(true);
    }
    for (const tower of towers) {
      const type = sim.content.buildings.find(
        (b) => b.typeId === w.get(tower, components.Building).buildingType,
      );
      const posted = [...w.query(components.JobAssignment, components.Settler)].filter(
        (e) => w.get(e, components.JobAssignment).workplace === tower,
      );
      for (const slot of towerGarrison.slots) {
        const posts = type?.workers.find((row) => row.jobType === slot.job)?.count ?? 0;
        const men = posted.filter((e) => w.get(e, components.Settler).jobType === slot.job);
        expect(men, `tower ${tower} job ${slot.job}`).toHaveLength(Math.min(slot.count, posts));
      }
    }

    const named = [...w.query(components.ScriptedName, components.Owner)].filter(
      (e) => w.get(e, components.ScriptedName).stringId === lord.nameStringId,
    );
    expect(named).toHaveLength(1);
    const hero = named[0] as Entity;
    expect(w.get(hero, components.Owner).player).toBe(FORTRESS);
    const heroMarks = components.MISSION_BEHAVIOUR.GLOWS | components.MISSION_BEHAVIOUR.NEEDS_FROZEN;
    expect(w.get(hero, components.MissionBehaviour).flags & heroMarks).toBe(heroMarks);
    expect(w.get(hero, components.VisualScale).pct).toBe(lord.scalePct);
    expect(lord.scalePct).toBe(LORD_SCALE_PCT);
    // A temple's aura near the keep lifts a man past his pool.
    expect(w.get(hero, components.Health).max).toBe(lord.hitpoints);
    expect(w.get(hero, components.Health).hitpoints).toBeGreaterThanOrEqual(lord.hitpoints);
    const at = w.get(hero, components.Position);
    const node = nodeOfPosition(at.x, at.y);
    expect(hexDistanceBetween(node.hx, node.hy, keep.x, keep.y)).toBeLessThan(keep.range);
    const goods = new Map(sim.content.goods.map((good) => [good.typeId, good.id]));
    const eq = w.get(hero, components.Equipment);
    expect(goods.get(eq.weapon?.goodType ?? -1)).toBe('sword_long');
    expect(goods.get(eq.armor?.goodType ?? -1)).toBe('armor_plate');
    const amulets = eq.misc.flatMap((slot) => (slot === null ? [] : [goods.get(slot.goodType)]));
    expect(amulets.sort()).toEqual(['amulet_crithit', 'amulet_defense', 'amulet_strength']);
    const strings = applyMapVariantStrings(
      { pol: {}, eng: {} },
      findMapVariant(MAP_ID, 'ragnarok') as MapVariant,
    );
    expect(strings?.pol?.[String(lord.nameStringId)]).toBe('Lord Uzurpator');
  }, 300_000);
});
