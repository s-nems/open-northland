import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, rowReachLeft, rowReachRight } from '../../nav/halfcell.js';
import { entityPoint } from './targets.js';

interface PointRow {
  readonly hy: number;
  readonly columns: number[];
}

/** A check-local position index: moving humans cannot use the standing-entity region cache. */
export function groupsWithinRange(
  world: World,
  sources: Iterable<Entity>,
  targets: Iterable<Entity>,
  range: number,
): boolean {
  if (range < 0) return false;
  const columnsByRow = new Map<number, Set<number>>();
  for (const e of targets) {
    const at = entityPoint(world, e);
    if (at === undefined) continue;
    let columns = columnsByRow.get(at.hy);
    if (columns === undefined) {
      columns = new Set();
      columnsByRow.set(at.hy, columns);
    }
    columns.add(at.hx);
  }
  const rows: PointRow[] = [...columnsByRow].map(([hy, columns]) => ({
    hy,
    columns: [...columns].sort((a, b) => a - b),
  }));
  rows.sort((a, b) => a.hy - b.hy);
  if (rows.length === 0) return false;
  for (const e of sources) {
    const at = entityPoint(world, e);
    if (at !== undefined && nearRows(rows, at, range)) return true;
  }
  return false;
}

function nearRows(rows: readonly PointRow[], at: HalfCellNode, range: number): boolean {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((rows[mid]?.hy ?? Number.POSITIVE_INFINITY) < at.hy - range) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined || row.hy > at.hy + range) break;
    const left = rowReachLeft(at, row.hy, range);
    const right = rowReachRight(at, row.hy, range);
    if (columnInRange(row.columns, left, right)) return true;
  }
  return false;
}

function columnInRange(columns: readonly number[], left: number, right: number): boolean {
  let lo = 0;
  let hi = columns.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((columns[mid] ?? Number.POSITIVE_INFINITY) < left) lo = mid + 1;
    else hi = mid;
  }
  const column = columns[lo];
  return column !== undefined && column <= right;
}
