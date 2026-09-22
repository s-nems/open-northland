import type { MapAiSeat, MapAiTask } from '@open-northland/data';
import {
  type AiDefaultPosition,
  AiProgram,
  aiModuleRuns,
  aiProgramEntity,
  Building,
  isPlayerDead,
  Position,
  setAiExternalFlag,
} from '../../components/index.js';
import { aiCommand } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { handlerTurn, scriptedSeatOnTurn } from '../ai-player/cadence.js';
import { takeCensus, towerPostOrders } from '../ai-player/military/index.js';
import { ownedBuildings, ownedSettlers } from '../ai-player/seat-roster.js';
import type { System, SystemContext } from '../context.js';
import { CONDITION_ALWAYS, conditionsBySlot, freshConditionRecord, recheckConditions } from './conditions.js';
import { assignSoldiers, clearInvalidTasks, updateSoldierList, workOrders } from './soldiers.js';
import { activeGroups, freshTaskRecord, recheckTasks } from './tasks.js';

/**
 * The scripted handler's program (`docs/formats/MISSIONS.md`, AI data): on a computer seat's handler
 * turn, judge its condition slots, re-judge its tasks when a slot changed, run the one-shots, keep its
 * soldier list, hand the men to the Defend and Attack groups on every second turn and order them on
 * every turn. The rows come from the map (`ctx.aiScript`); the state is the seat's `AiProgram`.
 *
 * Approximation: the program runs only for a seat whose strategic military module is off, since
 * this build's campaign and the program would otherwise order the same men against each other; the
 * original runs both handlers side by side. Approximation: a seat the match marked dead skips its
 * turn, as the strategic AI does, because the authority gate refuses its orders anyway; the original's
 * handler keeps working for a dead seat (it tests only the handler's enabled flag), which matters for the seats a script hands a town after the first
 * death check (`docs/tickets/features/match-participants-from-in-use-seats.md`).
 */
export const aiProgramSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const seat = scriptedSeatOnTurn(world, ctx.tick);
  if (seat === null || aiModuleRuns(world, seat, 'military') || isPlayerDead(world, seat)) return;
  const script = ctx.aiScript?.find((row) => row.player === seat);
  const turn = handlerTurn(ctx.tick);
  const carrier = aiProgramEntity(world, seat) ?? startProgram(world, ctx, terrain, seat, script);
  const program = world.mut(carrier, AiProgram);
  const defs = taskDefs(script, program.defaultDefend);
  const bySlot = conditionsBySlot(script?.conditions ?? []);
  const first = program.conditions.length === 0 && bySlot.length > 0;
  if (first) program.conditions = bySlot.map((def) => (def === null ? null : freshConditionRecord()));
  const changed = recheckConditions(world, ctx, seat, bySlot, program.conditions, turn);
  if (changed || turn === 0 || program.tasks.length !== defs.length) {
    while (program.tasks.length < defs.length) program.tasks.push(freshTaskRecord());
    recheckTasks(world, ctx, seat, defs, program.tasks, program.conditions);
    // A recheck rebuilds the Attack bands in their attacking state.
    program.groups = [];
  }
  const groups = activeGroups(defs, program.tasks);
  // The towers' claim on the free archers, judged as the seat's defence will judge it.
  const owned = ownedBuildings(world, seat);
  const wanted = towerPostOrders(world, ctx, terrain, owned, takeCensus(world, ctx, seat).ready).claimed;
  updateSoldierList(world, ctx, seat, program.soldiers, wanted);
  clearInvalidTasks(defs, groups, program.soldiers);
  const commands =
    turn % 2 === 0
      ? assignSoldiers(world, ctx, defs, groups, program.soldiers, program.groups, program.defaultPosition)
      : [];
  commands.push(
    ...workOrders(
      world,
      ctx,
      terrain,
      seat,
      defs,
      groups,
      program.soldiers,
      program.groups,
      program.defaultPosition,
    ),
  );
  for (const command of commands) ctx.commands.enqueue(aiCommand(seat, command));
};

/** The map's border band in map points, where the handler refuses a default position: the outermost
 *  two macro cells (the original's one-point parity nudge is left out). The original refuses a Defend, Attack or CreateCreatures point there too, which this build
 *  leaves out: no authored task of the corpus sits in the band. */
const BORDER_POINTS = 4;

function isBorderPoint(terrain: TerrainGraph, hx: number, hy: number): boolean {
  return (
    hx < BORDER_POINTS ||
    hy < BORDER_POINTS ||
    hx >= terrain.width - BORDER_POINTS ||
    hy >= terrain.height - BORDER_POINTS
  );
}

/** The range the handler gives a default position of its own making. */
const CENTRE_DEFAULT_RANGE = 15;
/** The Defend task a seat that authored none gets at its centre. */
const CENTRE_DEFEND_PRIORITY = 10;
const CENTRE_DEFEND_RANGE = 40;

/**
 * The seat's first turn: the authored default position, or one at the seat's centre when the map
 * authored none or put it in the border band, and a Defend of the centre when the script authored no
 * task at all, both only when the centre is not on the map's border. The external flags a script
 * declares raised start raised. Approximation: the original also refuses an authored position on
 * water (continent type 0), which this build does not judge.
 */
function startProgram(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  seat: number,
  script: MapAiSeat | undefined,
): Entity {
  const centre = seatCentre(world, ctx, seat);
  const usable = centre !== null && !isBorderPoint(terrain, centre.hx, centre.hy);
  const authored = script?.defaultPosition;
  const defaultPosition: AiDefaultPosition | null =
    authored !== undefined && !isBorderPoint(terrain, authored.x, authored.y)
      ? { hx: authored.x, hy: authored.y, range: authored.range }
      : usable
        ? { ...centre, range: CENTRE_DEFAULT_RANGE }
        : null;
  const defaultDefend = (script?.tasks.length ?? 0) === 0 && usable ? centre : null;
  for (const def of script?.conditions ?? []) {
    if (def.kind === 'onExternal' && def.raised) setAiExternalFlag(world, seat, def.slot, true);
  }
  const e = world.create();
  world.add(e, AiProgram, {
    player: seat,
    defaultPosition,
    defaultDefend,
    conditions: [],
    tasks: [],
    soldiers: [],
    groups: [],
  });
  return e;
}

/** The script's tasks, plus the handler's own Defend of the centre after them. */
function taskDefs(
  script: MapAiSeat | undefined,
  defaultDefend: { hx: number; hy: number } | null,
): MapAiTask[] {
  const defs: MapAiTask[] = [...(script?.tasks ?? [])];
  if (defaultDefend !== null) {
    defs.push({
      kind: 'defend',
      priority: CENTRE_DEFEND_PRIORITY,
      condition: CONDITION_ALWAYS,
      x: defaultDefend.hx,
      y: defaultDefend.hy,
      range: CENTRE_DEFEND_RANGE,
      min: 0,
      max: 0,
    });
  }
  return defs;
}

/**
 * Where the seat lives: its first storage building (the headquarters or a stock, in entity order),
 * else the mean of everything it owns; null for a seat that owns nothing. Approximation: the original
 * walks from that mean to the nearest ground of the same continent, which this build leaves to the
 * walk orders' own clamping.
 */
function seatCentre(world: World, ctx: SystemContext, seat: number): { hx: number; hy: number } | null {
  const index = contentIndex(ctx.content);
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const e of ownedBuildings(world, seat)) {
    const at = world.tryGet(e, Position);
    if (at === undefined) continue;
    const node = nodeOfPosition(at.x, at.y);
    if (index.buildings.get(world.get(e, Building).buildingType)?.kind === 'storage') return node;
    sumX += node.hx;
    sumY += node.hy;
    count++;
  }
  for (const e of ownedSettlers(world, seat)) {
    const at = world.tryGet(e, Position);
    if (at === undefined) continue;
    const node = nodeOfPosition(at.x, at.y);
    sumX += node.hx;
    sumY += node.hy;
    count++;
  }
  if (count === 0) return null;
  return { hx: Math.trunc(sumX / count), hy: Math.trunc(sumY / count) };
}
