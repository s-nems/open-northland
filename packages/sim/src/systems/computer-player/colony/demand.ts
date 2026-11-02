// What a colony's shipping line carries each way. Figures are authored unless they say otherwise.

/** The most units a line ship takes on a leg: a warehouse's full wood and stone (45 each), so a hold larger
 *  than a store still leaves one empty. A smaller hold stops at its room. */
export const LINE_CARGO_MOST = 90;

/** Food units a colony wants per mouth: one meal in store, the home's short line. */
const COLONY_FOOD_PER_MOUTH = 1;

export interface CargoLine {
  readonly goodType: number;
  readonly amount: number;
}

type Units = ReadonlyMap<number, number>;

/** One outward load's reads. */
export interface OutwardRead {
  /** Hold units free for cargo. */
  readonly room: number;
  /** The hold line food travels on, and what the colony stores of it. */
  readonly food: number | null;
  readonly foodHeld: number;
  readonly mouths: number;
  /** What the open sites and the next build still lack, by good. */
  readonly owed: Units;
  /** What the colony's stores hold, by good. */
  readonly held: Units;
  /** What the colony's standing buildings want in store, by good. */
  readonly wanted: Units;
  /** What the colony makes or digs itself: none of it sails out. */
  readonly makes: ReadonlySet<number>;
  /** What home can give of a good and stay at its comfort. */
  readonly spare: (good: number) => number;
}

/** Add `want` of `good` to `lines`, as far as the room and home's spare units go; the room left. */
function take(lines: Map<number, number>, good: number, want: number, room: number, spare: number): number {
  const had = lines.get(good) ?? 0;
  const units = Math.min(want, room, spare - had);
  if (units <= 0) return room;
  lines.set(good, had + units);
  return room - units;
}

function asLines(lines: ReadonlyMap<number, number>): CargoLine[] {
  return [...lines].map(([goodType, amount]) => ({ goodType, amount }));
}

/**
 * The outward load, most urgent first and goods ascending within a step: food to one meal a mouth, then what
 * the building sites and the next builds lack past the stores, then what standing buildings want that the
 * stores lack. Owner ruling: what the colony makes or digs never sails out. Home never goes under its comfort
 * for it.
 */
export function outwardCargo(read: OutwardRead): CargoLine[] {
  const { food, held, spare } = read;
  const lines = new Map<number, number>();
  let room = read.room;
  if (food !== null) {
    const hungry = COLONY_FOOD_PER_MOUTH * read.mouths - read.foodHeld;
    room = take(lines, food, hungry, room, spare(food));
  }
  for (const list of [read.owed, read.wanted]) {
    for (const good of [...list.keys()].sort((a, b) => a - b)) {
      if (read.makes.has(good)) continue;
      const lack = (list.get(good) ?? 0) - (held.get(good) ?? 0) - (lines.get(good) ?? 0);
      room = take(lines, good, lack, room, spare(good));
    }
  }
  return asLines(lines);
}

/** One homeward load's reads. */
export interface HomewardRead {
  readonly room: number;
  /** The goods home wants most, in order. */
  readonly staples: readonly number[];
  /** What the colony's stores hold, and what it keeps of that for its sites and its plan, by good. */
  readonly held: Units;
  readonly kept: Units;
  /** What home lacks of a staple to its comfort and to its glut line. */
  readonly lackToComfort: (good: number) => number;
  readonly lackToGlut: (good: number) => number;
  /** What the colony's workshops made, past what it keeps: home could not make it, so it sails first. */
  readonly crafted: readonly number[];
  /** Other goods that sail home, ascending. */
  readonly finished: readonly number[];
}

/** Share `room` between `wants` level by level, so one good's lack cannot crowd out the rest: each take
 *  adds to `lines` and caps at what is left of its want. */
function shareOut(lines: Map<number, number>, wants: ReadonlyMap<number, number>, room: number): number {
  let left = room;
  let open = [...wants.keys()];
  while (left > 0 && open.length > 0) {
    const share = Math.max(1, Math.floor(left / open.length));
    const next: number[] = [];
    for (const good of open) {
      const had = lines.get(good) ?? 0;
      const units = Math.min(share, (wants.get(good) ?? 0) - had, left);
      if (units <= 0) continue;
      lines.set(good, had + units);
      left -= units;
      if (had + units < (wants.get(good) ?? 0)) next.push(good);
    }
    open = next;
  }
  return left;
}

/**
 * The homeward load: what its workshops made, then staples past what the colony keeps, shared up to home's
 * comfort, then up to its glut, then any finished good the colony holds past that. A staple home has at its glut stays,
 * since a hold unloaded into full stores would only heap at the shore.
 */
export function homewardCargo(read: HomewardRead): CargoLine[] {
  const { held, kept } = read;
  const past = (good: number): number => Math.max(0, (held.get(good) ?? 0) - (kept.get(good) ?? 0));
  const lines = new Map<number, number>();
  const upTo = (lack: (good: number) => number): Map<number, number> =>
    new Map(read.staples.map((good) => [good, Math.min(past(good), lack(good))]));
  let room = read.room;
  for (const good of read.crafted) room = take(lines, good, past(good), room, past(good));
  room = shareOut(lines, upTo(read.lackToComfort), room);
  room = shareOut(lines, upTo(read.lackToGlut), room);
  for (const good of read.finished) room = take(lines, good, past(good), room, past(good));
  return asLines(lines);
}
