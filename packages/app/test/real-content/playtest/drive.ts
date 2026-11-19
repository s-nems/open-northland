import {
  adminCommand,
  type Command,
  components,
  type Entity,
  exportSaveGame,
  type HalfCellNode,
  nodeHxOfPosition,
  nodeHyOfPosition,
  ONE,
  type PlayerCommand,
  parseSaveGame,
  playerCommand,
  type SimEvent,
  type Simulation,
  serializeSaveGame,
  TICKS_PER_SECOND,
} from '@open-northland/sim';
import { mapIdParam } from '../../../src/game/match/session-url.js';
import { realMapSessionWorld, restoreRealMapWorld } from '../real-map-world.js';

/**
 * Drives a real map's mission script without a browser: the world the `?map=` entry builds, stepped
 * tick by tick, with the player's own seat commands for what a playthrough plays and the replayable
 * admin commands for what it forces (a teleport instead of a long walk, a spawned army instead of a
 * trained one). Every forced step is logged, so a probe's report says what the player did not do.
 */

export const SECOND = TICKS_PER_SECOND;

export interface PlaytestLog {
  readonly notes: string[];
  /** Steps a player would do by play, done by the probe instead. */
  readonly forced: string[];
  /** Every event the stepped ticks emitted, in order. */
  readonly events: SimEvent[];
}

export function createLog(): PlaytestLog {
  return { notes: [], forced: [], events: [] };
}

export function note(log: PlaytestLog, line: string): void {
  log.notes.push(line);
}

export function force(log: PlaytestLog, line: string): void {
  log.forced.push(line);
  log.notes.push(`FORCED ${line}`);
}

export interface BootedMap {
  readonly sim: Simulation;
  readonly mapId: string;
  /** The `?map=` search the world was built from; a save of this world relaunches it. */
  readonly entry: string;
}

/** Repeatable default: a search without a seed would draw one, and a failing probe could not be replayed. */
const DEFAULT_SEED = 7;

/** The world the `?map=` entry boots from `search`, scripts on, seeded. */
export async function bootMap(search: string): Promise<BootedMap> {
  const params = new URLSearchParams(search);
  if (!params.has('missions')) params.set('missions', 'on');
  if (!params.has('seed')) params.set('seed', String(DEFAULT_SEED));
  const mapId = mapIdParam(params);
  if (mapId === null) throw new Error(`the search names no map: ${search}`);
  const entry = `?${params}`;
  return { sim: await realMapSessionWorld(entry), mapId, entry };
}

/** Steps `ticks` ticks, collecting events; stops early when `stop` accepts one of them. */
export function run(
  sim: Simulation,
  log: PlaytestLog,
  ticks: number,
  stop?: (event: SimEvent) => boolean,
): boolean {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    const events = sim.events.current();
    log.events.push(...events);
    if (stop !== undefined && events.some(stop)) return true;
  }
  return false;
}

export function fired(sim: Simulation, index: number): boolean {
  return (sim.missionStatus()[index]?.fireCount ?? 0) > 0;
}

/** Steps until mission `index` has fired or the budget runs out. */
export function runUntilFired(
  sim: Simulation,
  log: PlaytestLog,
  index: number,
  budgetTicks: number,
): boolean {
  for (let i = 0; i < budgetTicks && !fired(sim, index); i++) run(sim, log, 1);
  return fired(sim, index);
}

/** Like {@link runUntilFired}, but throws with the mission table when the mission does not fire. */
export function expectFired(
  sim: Simulation,
  log: PlaytestLog,
  index: number,
  seconds: number,
  label = '',
): void {
  const ok = runUntilFired(sim, log, index, seconds * SECOND);
  note(log, `${ok ? 'FIRED' : 'NOT FIRED'} mission ${index} ${label} t=${sim.tick}`.trimEnd());
  if (!ok)
    throw new Error(
      `mission ${index} ${label} did not fire within ${seconds}s (t=${sim.tick})\n${missionTable(sim)}`,
    );
}

/** The script's live state in one line per mission that is active, visible or has fired. */
export function missionTable(sim: Simulation): string {
  return sim
    .missionStatus()
    .filter((row) => row.active || row.visible || row.fireCount > 0)
    .map(
      (row) =>
        `  ${String(row.index).padStart(3)} ${row.active ? 'active ' : '       '}${row.visible ? 'visible ' : '        '}` +
        `${row.done ? 'done ' : '     '}fired x${row.fireCount}${row.lastFiredTick === undefined ? '' : ` @${row.lastFiredTick}`}`,
    )
    .join('\n');
}

const PROBLEM_KINDS: ReadonlySet<SimEvent['kind']> = new Set(['missionUnsupported', 'missionResultFailed']);

/** Script lines this build could not run or that could not act on the world. */
export function problems(log: PlaytestLog): SimEvent[] {
  return log.events.filter((event) => PROBLEM_KINDS.has(event.kind));
}

/** Briefing pages the script opened, in order. */
export function pagesOpened(log: PlaytestLog): number[] {
  return log.events.flatMap((event) => (event.kind === 'missionCutscene' ? [event.page] : []));
}

export function eventsOfKind<K extends SimEvent['kind']>(
  log: PlaytestLog,
  kind: K,
): Extract<SimEvent, { kind: K }>[] {
  return log.events.filter((event): event is Extract<SimEvent, { kind: K }> => event.kind === kind);
}

// ---- world reads ---------------------------------------------------------------------------------

export function jobType(sim: Simulation, slug: string): number {
  const row = sim.content.jobs.find((job) => job.id === slug);
  if (row === undefined) throw new Error(`no job ${slug}`);
  return row.typeId;
}

export function goodType(sim: Simulation, slug: string): number {
  const row = sim.content.goods.find((good) => good.id === slug);
  if (row === undefined) throw new Error(`no good ${slug}`);
  return row.typeId;
}

export function buildingType(sim: Simulation, slug: string): number {
  const row = sim.content.buildings.find((building) => building.id === slug);
  if (row === undefined) throw new Error(`no building ${slug}`);
  return row.typeId;
}

/** The human carrying script id `id`; throws when the script has not spawned or has removed it. */
export function humanOf(sim: Simulation, id: number): Entity {
  const entity = sim.missionHuman(id);
  if (entity === null) throw new Error(`no human with mission id ${id} on the map`);
  return entity;
}

export function nodeOf(sim: Simulation, entity: Entity): HalfCellNode {
  const position = sim.world.tryGet(entity, components.Position);
  if (position === undefined) throw new Error(`entity ${entity} has no position`);
  return { hx: nodeHxOfPosition(position.x, position.y), hy: nodeHyOfPosition(position.x, position.y) };
}

/** Every entity stamped with script id `id`: humans, animals, houses or vehicles. */
export function withMissionId(sim: Simulation, id: number): Entity[] {
  return [...sim.world.query(components.MissionObjectId)].filter(
    (entity) => sim.world.get(entity, components.MissionObjectId).id === id,
  );
}

/** Living people of `player`, optionally of one job. */
export function personsOf(sim: Simulation, player: number, jobSlug?: string): Entity[] {
  const job = jobSlug === undefined ? undefined : jobType(sim, jobSlug);
  return [...sim.world.query(components.Person, components.Settler)].filter((entity) => {
    if (components.ownerOf(sim.world, entity) !== player) return false;
    return job === undefined || sim.world.get(entity, components.Settler).jobType === job;
  });
}

/** Finished buildings of `player`, optionally of one type. */
export function buildingsOf(sim: Simulation, player: number, buildingSlug?: string): Entity[] {
  const type = buildingSlug === undefined ? undefined : buildingType(sim, buildingSlug);
  return [...sim.world.query(components.Building)].filter((entity) => {
    const building = sim.world.get(entity, components.Building);
    if (building.built < ONE || components.ownerOf(sim.world, entity) !== player) return false;
    return type === undefined || building.buildingType === type;
  });
}

/** The nearest walkable node to `(hx, hy)`, searched in growing square rings. */
export function walkableNear(sim: Simulation, hx: number, hy: number, maxRing = 16): HalfCellNode {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('the world has no terrain');
  for (let ring = 0; ring <= maxRing; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = hx + dx;
        const y = hy + dy;
        if (terrain.inBounds(x, y) && terrain.isWalkable(terrain.nodeAt(x, y))) return { hx: x, hy: y };
      }
    }
  }
  throw new Error(`nothing walkable within ${maxRing} of ${hx},${hy}`);
}

// ---- played orders ---------------------------------------------------------------------------------

/** A seat command, as the player's click would send it. */
export function order(sim: Simulation, player: number, command: PlayerCommand): void {
  sim.enqueue(playerCommand(player, command));
}

/** The site search steps two half-cell nodes, one cell, at a time. */
const SITE_STRIDE = 2;
const SITE_SEARCH_RINGS = 60;

/** A construction site ordered through the seat command on the first node near `at` the seat may build on. */
export function placeSiteNear(
  sim: Simulation,
  log: PlaytestLog,
  player: number,
  tribe: number,
  slug: string,
  at: HalfCellNode,
): void {
  const type = buildingType(sim, slug);
  const probe = sim.placementProbe(type, { player, tribe });
  if (probe === null) throw new Error('the world has no terrain');
  for (let ring = 0; ring < SITE_SEARCH_RINGS; ring += SITE_STRIDE)
    for (let dy = -ring; dy <= ring; dy += SITE_STRIDE)
      for (let dx = -ring; dx <= ring; dx += SITE_STRIDE) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        if (!probe.canPlace(at.hx + dx, at.hy + dy)) continue;
        order(sim, player, {
          kind: 'placeBuilding',
          buildingType: type,
          x: at.hx + dx,
          y: at.hy + dy,
          tribe,
        });
        run(sim, log, 1);
        return;
      }
  throw new Error(`no site for ${slug} near ${at.hx},${at.hy}`);
}

/** Orders every listed settler to walk to the node. */
export function walkTo(
  sim: Simulation,
  player: number,
  entities: readonly Entity[],
  hx: number,
  hy: number,
): void {
  for (const entity of entities) order(sim, player, { kind: 'moveUnit', entity, x: hx, y: hy });
}

// ---- forced steps ----------------------------------------------------------------------------------

/** An admin command, the seam the browser's `playtest.prepare` uses too. */
export function admin(sim: Simulation, command: Command): void {
  sim.enqueue(adminCommand(command));
}

/** Puts the entities on the nearest walkable node of the point; a walk's stand-in. */
export function teleport(
  sim: Simulation,
  log: PlaytestLog,
  entities: readonly Entity[],
  hx: number,
  hy: number,
): HalfCellNode {
  const node = walkableNear(sim, hx, hy);
  force(
    log,
    `teleport ${entities.length} entities (${entities.join(',')}) to ${node.hx},${node.hy} t=${sim.tick}`,
  );
  for (const target of entities) admin(sim, { kind: 'debugTeleport', target, x: node.hx, y: node.hy });
  return node;
}

/** Teleports every human carrying one of the script ids. */
export function teleportHumans(
  sim: Simulation,
  log: PlaytestLog,
  ids: readonly number[],
  hx: number,
  hy: number,
): HalfCellNode {
  const humans = ids.flatMap((id) =>
    withMissionId(sim, id).filter((entity) => sim.world.has(entity, components.Person)),
  );
  if (humans.length === 0) throw new Error(`no humans with mission ids ${ids.join(',')}`);
  return teleport(sim, log, humans, hx, hy);
}

export interface SpawnRequest {
  readonly player: number;
  readonly jobSlug: string;
  readonly count: number;
  readonly hx: number;
  readonly hy: number;
  /** The people's civilization; the player's first settler's when omitted. */
  readonly tribe?: number;
  readonly hitpoints?: number;
  readonly weaponTypeId?: number;
}

/** Spawns settlers for a player; a training, recruitment or growth stand-in. */
export function spawn(sim: Simulation, log: PlaytestLog, request: SpawnRequest): void {
  const tribe = request.tribe ?? tribeOf(sim, request.player);
  const node = walkableNear(sim, request.hx, request.hy);
  force(
    log,
    `spawn ${request.count} ${request.jobSlug} for player ${request.player} at ${node.hx},${node.hy} t=${sim.tick}`,
  );
  const spec = {
    kind: 'spawnSettler' as const,
    jobType: jobType(sim, request.jobSlug),
    x: node.hx,
    y: node.hy,
    tribe,
    owner: request.player,
    ...(request.hitpoints === undefined ? {} : { hitpoints: request.hitpoints }),
    ...(request.weaponTypeId === undefined ? {} : { weaponTypeId: request.weaponTypeId }),
  };
  for (let i = 0; i < request.count; i++) admin(sim, spec);
}

function tribeOf(sim: Simulation, player: number): number {
  const first = personsOf(sim, player)[0];
  if (first === undefined) throw new Error(`player ${player} has no settler to name a tribe; pass one`);
  return sim.world.get(first, components.Settler).tribe;
}

/** Kills the entities as a battle would; `why` names the fight it stands in for. */
export function kill(sim: Simulation, log: PlaytestLog, entities: readonly Entity[], why: string): void {
  force(log, `kill ${entities.length} entities (${why}) t=${sim.tick}`);
  for (const target of entities) admin(sim, { kind: 'debugKill', target });
}

/** Tears the owner's buildings down through the owner's own demolish command; a siege stand-in. */
export function raze(
  sim: Simulation,
  log: PlaytestLog,
  owner: number,
  buildings: readonly Entity[],
  why: string,
): void {
  force(log, `raze ${buildings.length} buildings of player ${owner} (${why}) t=${sim.tick}`);
  for (const building of buildings) order(sim, owner, { kind: 'demolish', building });
}

export interface PlaceOptions {
  /** Place through the trusted command past the player's technology and script gates, finished at once. */
  readonly ignoreGate?: boolean;
}

/**
 * Places a building on the first site near the point the seat's placement rule accepts, then completes
 * its construction as builders would. A site the rule accepts only without the player's building gate
 * is refused with that reason unless `ignoreGate` asks for the trusted placement. Returns the building.
 */
export function placeFinished(
  sim: Simulation,
  log: PlaytestLog,
  player: number,
  buildingSlug: string,
  hx: number,
  hy: number,
  options: PlaceOptions = {},
): Entity {
  const type = buildingType(sim, buildingSlug);
  const tribe = tribeOf(sim, player);
  const gated = sim.placementProbe(type, { player, tribe, gated: options.ignoreGate !== true });
  if (gated === null) throw new Error('the world has no terrain');
  const site = siteNear(sim, (x, y) => gated.canPlace(x, y), hx, hy);
  if (site === undefined) {
    const open = sim.placementProbe(type, { player, tribe, gated: false });
    const why =
      open !== null && siteNear(sim, (x, y) => open.canPlace(x, y), hx, hy) !== undefined
        ? `player ${player} may not build ${buildingSlug} yet (technology or script gate); pass ignoreGate to force it`
        : `no site near ${hx},${hy} accepts ${buildingSlug}`;
    throw new Error(why);
  }
  const owned = (): Set<Entity> =>
    new Set(
      [...sim.world.query(components.Building)].filter(
        (entity) =>
          components.ownerOf(sim.world, entity) === player &&
          sim.world.get(entity, components.Building).buildingType === type,
      ),
    );
  const before = owned();
  if (options.ignoreGate === true) {
    admin(sim, {
      kind: 'placeBuilding',
      buildingType: type,
      x: site.hx,
      y: site.hy,
      tribe,
      owner: player,
      ignoreTechnology: true,
      underConstruction: false,
    });
  } else {
    order(sim, player, { kind: 'placeBuilding', buildingType: type, x: site.hx, y: site.hy, tribe });
  }
  run(sim, log, 1);
  const added = [...owned()].find((entity) => !before.has(entity));
  if (added === undefined)
    throw new Error(`placing ${buildingSlug} at ${site.hx},${site.hy} for player ${player} was refused`);
  if (options.ignoreGate !== true) {
    admin(sim, { kind: 'debugCompleteConstruction', target: added });
    run(sim, log, 1);
  }
  force(
    log,
    `place ${buildingSlug} at ${site.hx},${site.hy} for player ${player}${options.ignoreGate === true ? ' past its gate' : ''}, finished t=${sim.tick}`,
  );
  return added;
}

/** The first node in growing square rings around the point, on the half-cell parity of the point, that `accepts`. */
function siteNear(
  sim: Simulation,
  accepts: (x: number, y: number) => boolean,
  hx: number,
  hy: number,
): HalfCellNode | undefined {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('the world has no terrain');
  for (let ring = 0; ring < 60; ring += 2) {
    for (let dy = -ring; dy <= ring; dy += 2) {
      for (let dx = -ring; dx <= ring; dx += 2) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = hx + dx;
        const y = hy + dy;
        if (terrain.inBounds(x, y) && accepts(x, y)) return { hx: x, hy: y };
      }
    }
  }
  return undefined;
}

/** Fills one good's slot of a building to capacity, or every slot without `goodSlug`; a porter's stand-in. */
export function fillStock(sim: Simulation, log: PlaytestLog, building: Entity, goodSlug?: string): void {
  force(
    log,
    `fill stock of building ${building}${goodSlug === undefined ? ' (every good)' : ` with ${goodSlug}`} t=${sim.tick}`,
  );
  admin(sim, {
    kind: 'debugFillStockpile',
    target: building,
    ...(goodSlug === undefined ? {} : { goodType: goodType(sim, goodSlug) }),
  });
}

/**
 * Stocks the payer's finished stores with each demanded good, then pays the tribute through the seat
 * command. Throws when no store takes a demand, so the slot stays unpayable.
 */
export function payTribute(sim: Simulation, log: PlaytestLog, payer: number, slot: number): void {
  const open = (): ReturnType<Simulation['openTributes']>[number] | undefined =>
    sim.openTributes(payer).find((tribute) => tribute.slot === slot);
  const tribute = open();
  if (tribute === undefined) throw new Error(`player ${payer} has no open tribute in slot ${slot}`);
  const stores = buildingsOf(sim, payer).filter((entity) => sim.world.has(entity, components.Stockpile));
  for (const demand of tribute.demands) {
    for (const store of stores)
      admin(sim, { kind: 'debugFillStockpile', target: store, goodType: demand.good });
  }
  run(sim, log, 1);
  const stocked = open();
  if (stocked?.payable !== true) {
    throw new Error(
      `tribute ${slot} of player ${payer} still not payable after filling ${stores.length} stores: ${JSON.stringify(stocked)}`,
    );
  }
  force(
    log,
    `stock ${stores.length} stores of player ${payer} with the demands and pay tribute ${slot} t=${sim.tick}`,
  );
  order(sim, payer, { kind: 'payTribute', player: payer, slot });
}

/** Retrains `count` of the player's civilists through the seat command. Returns the settlers. */
export function setJobs(
  sim: Simulation,
  log: PlaytestLog,
  player: number,
  jobSlug: string,
  count: number,
  fromSlug = 'civilist',
): Entity[] {
  const pool = personsOf(sim, player, fromSlug).filter(
    (entity) => !sim.world.has(entity, components.MissionObjectId),
  );
  if (pool.length < count) throw new Error(`only ${pool.length} ${fromSlug} of player ${player} to retrain`);
  const picked = pool.slice(0, count);
  force(log, `setJob ${jobSlug} on ${count} ${fromSlug} of player ${player} t=${sim.tick}`);
  const job = jobType(sim, jobSlug);
  for (const entity of picked) order(sim, player, { kind: 'setJob', entity, jobType: job });
  return picked;
}

// ---- save and restore ------------------------------------------------------------------------------

/**
 * Saves the world, restores the save through the entry's own restore and checks the restored world
 * hashes the same. Returns the restored world, which a probe continues on to cover a reload mid-run.
 */
export async function saveRoundTrip(
  sim: Simulation,
  log: PlaytestLog,
  map: Pick<BootedMap, 'mapId' | 'entry'>,
): Promise<Simulation> {
  const save = parseSaveGame(
    JSON.parse(serializeSaveGame(exportSaveGame(sim, { mapId: map.mapId, entry: map.entry }))),
  );
  const restored = await restoreRealMapWorld(map.mapId, save);
  if (restored.hashState() !== sim.hashState())
    throw new Error(`restored world hashes differently at t=${sim.tick}`);
  if (JSON.stringify(restored.missionStatus()) !== JSON.stringify(sim.missionStatus())) {
    throw new Error(`restored mission status differs at t=${sim.tick}`);
  }
  note(log, `save/restore round trip at t=${sim.tick}: hash and mission status equal`);
  return restored;
}
