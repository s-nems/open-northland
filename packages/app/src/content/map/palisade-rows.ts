import { fullStateBlockAreaCells, type LandscapeBlockArea } from '@open-northland/data';
import type { ContentIr, LandscapeTypeRow } from '../ir/rows.js';

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

export function playerWallRow(
  row: Pick<LandscapeTypeRow, 'id' | 'maxValency' | 'playerIdAllowed' | 'transitions'>,
): PlayerWallRow | undefined {
  if (row.id === undefined || !WALL_FAMILY.has(row.id) || row.playerIdAllowed !== true) return undefined;
  const maxHitpoints = row.maxValency ?? 0;
  const repairPerStrike =
    row.transitions?.find((t) => t[TRANSITION_EVENT] === BUILD_STRIKE_EVENT)?.[TRANSITION_VALENCY_STEP] ?? 0;
  if (maxHitpoints <= 0 || repairPerStrike <= 0) return undefined;
  return { logicId: row.id, maxHitpoints, repairPerStrike };
}

/** A gate graphic's paired state by edit name: `<name>` closed, `<name>_open` open. */
export function gateCounterpartName(logicId: string, editName: string): string | undefined {
  if (logicId === CLOSED_GATE_LOGIC_ID) return `${editName}_open`;
  if (logicId === OPEN_GATE_LOGIC_ID) return editName.replace(/_open$/, '');
  return undefined;
}

/**
 * Project rule: a one-cell post holds one and a half of its row's pools. Measured in this engine: archers
 * all shoot the first wall on their route, so a one-pool post held them well under half as long as a gate.
 */
export const POST_STRENGTH = 1.5;

/**
 * How many times a wall graphic holds its row's valency and repair step: once per cell its closed body
 * blocks, and never less than {@link POST_STRENGTH}. Source basis: every wall and gate row holds one
 * `maximumValency` pool. Project rule: a gate holds one pool per closed cell, since measured in this
 * engine a one-pool gate fell three to four times faster than a post to the larger squad its longer face
 * admits.
 */
export function wallStrengthScale(closedWalk: readonly Readonly<LandscapeBlockArea>[] | undefined): number {
  return Math.max(POST_STRENGTH, fullStateBlockAreaCells(closedWalk).length);
}

/** A wall row's pool and repair step times `scale`; the step rounds up so mending a post never slows. */
export function scaledWallRules(
  rules: { readonly maxHitpoints: number; readonly repairPerStrike: number },
  scale: number,
): { readonly maxHitpoints: number; readonly repairPerStrike: number } {
  return {
    maxHitpoints: Math.round(rules.maxHitpoints * scale),
    repairPerStrike: Math.ceil(rules.repairPerStrike * scale),
  };
}

/** {@link wallStrengthScale} of every player wall graphic by gfx index; an open gate reads its closed
 *  pair. */
export function wallStrengthScales(ir: ContentIr | null): ReadonlyMap<number, number> {
  const walls = playerWallRows(ir);
  const rows = (ir?.landscapeGfx ?? []).filter((g) => walls.has(g.logicType));
  const byName = new Map(rows.flatMap((g) => (g.editName === undefined ? [] : [[g.editName, g] as const])));
  const out = new Map<number, number>();
  for (const g of rows) {
    const logicId = walls.get(g.logicType)?.logicId;
    const pairName =
      logicId === OPEN_GATE_LOGIC_ID && g.editName !== undefined
        ? gateCounterpartName(logicId, g.editName)
        : undefined;
    const closed = (pairName === undefined ? undefined : byName.get(pairName)) ?? g;
    out.set(g.index, wallStrengthScale(closed.walkBlockAreas));
  }
  return out;
}
