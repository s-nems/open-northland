import type { ContentIr, LandscapeTypeRow } from './ir/rows.js';

/** The `landscapetypes.ini` slugs of the wall family: a post and a gate in either state. */
export const WALL_LOGIC_ID = 'wall';
export const CLOSED_GATE_LOGIC_ID = 'wall_gate_closed';
export const OPEN_GATE_LOGIC_ID = 'wall_gate_open';
const WALL_FAMILY: ReadonlySet<string> = new Set([WALL_LOGIC_ID, CLOSED_GATE_LOGIC_ID, OPEN_GATE_LOGIC_ID]);

/**
 * `transition` tuple fields: the event it answers and the valency it adds. Readable basis: every wall row
 * lists `transition 9 <type> 2 <step> 0`, one step per builder strike, and `transition 10 <type> 2 -1 0`,
 * one lost point per hundred of a blow's building damage.
 */
const TRANSITION_EVENT = 0;
const TRANSITION_VALENCY_STEP = 3;
const BUILD_STRIKE_EVENT = 9;

/** A wall-family logic row a player may own, hit and mend. */
export interface PlayerWallRow {
  readonly logicId: string;
  readonly maxHitpoints: number;
  readonly repairPerStrike: number;
}

/**
 * Wall-family rows by logic type, keeping only those flagged `playeridallowed` with a positive valency and
 * build-strike step. Every wall join reads walls through this one map, so a row either becomes a live wall
 * everywhere or stays scenery everywhere.
 */
export function playerWallRows(ir: ContentIr | null): ReadonlyMap<number, PlayerWallRow> {
  const out = new Map<number, PlayerWallRow>();
  for (const row of ir?.landscape ?? []) {
    const wall = playerWallRow(row);
    if (wall !== undefined && row.typeId !== undefined) out.set(row.typeId, wall);
  }
  return out;
}

function playerWallRow(row: LandscapeTypeRow): PlayerWallRow | undefined {
  if (row.id === undefined || !WALL_FAMILY.has(row.id) || row.playerIdAllowed !== true) return undefined;
  const maxHitpoints = row.maxValency ?? 0;
  const repairPerStrike =
    row.transitions?.find((t) => t[TRANSITION_EVENT] === BUILD_STRIKE_EVENT)?.[TRANSITION_VALENCY_STEP] ?? 0;
  if (maxHitpoints <= 0 || repairPerStrike <= 0) return undefined;
  return { logicId: row.id, maxHitpoints, repairPerStrike };
}
