import type { MissionGoal } from '../../../game/mission-brief.js';

/** How a goal changed since the goal page last showed it. */
export type GoalMark = 'new' | 'done';

/** The states the next list is compared with, and the unread marks, carried across a remount. */
export interface GoalMarksState {
  readonly states: readonly (readonly [string, MissionGoal['state']])[] | null;
  readonly marks: readonly (readonly [string, GoalMark])[];
}

/**
 * Watches the goal list for changes the player has not read yet: a goal that turns open (revealed or
 * activated) is new, one that turns done is done. The first list is the baseline, so the goals a world
 * starts or loads with carry no mark. A goal the script hides again loses its mark.
 */
export class GoalMarks {
  private states: Map<string, MissionGoal['state']> | null = null;
  private seen: readonly MissionGoal[] | null = null;
  private readonly marks = new Map<string, GoalMark>();
  private changes = 0;

  /** Moves with every mark that appears or goes. */
  get version(): number {
    return this.changes;
  }

  /** Fold in the current list; true when a mark appeared or went. The same array twice costs nothing. */
  observe(goals: readonly MissionGoal[]): boolean {
    if (goals === this.seen) return false;
    this.seen = goals;
    const before = this.states;
    this.states = new Map(goals.map((g) => [g.key, g.state]));
    if (before === null) return false;
    let changed = false;
    for (const key of this.marks.keys()) {
      if (!this.states.has(key)) changed = this.marks.delete(key) || changed;
    }
    for (const goal of goals) {
      const was = before.get(goal.key);
      if (goal.state === was) continue;
      if (goal.state === 'open') changed = this.mark(goal.key, 'new') || changed;
      else if (goal.state === 'done') changed = this.mark(goal.key, 'done') || changed;
      else changed = this.marks.delete(goal.key) || changed;
    }
    if (changed) this.changes++;
    return changed;
  }

  markOf(key: string): GoalMark | null {
    return this.marks.get(key) ?? null;
  }

  get unread(): boolean {
    return this.marks.size > 0;
  }

  /** Every mark, for the book to show while it stays open. */
  snapshot(): ReadonlyMap<string, GoalMark> {
    return new Map(this.marks);
  }

  state(): GoalMarksState {
    return { states: this.states === null ? null : [...this.states], marks: [...this.marks] };
  }

  /** Continue from a remounted book's marks: the next list is compared with its last one. */
  restore(state: GoalMarksState): void {
    this.states = state.states === null ? null : new Map(state.states);
    this.seen = null;
    this.marks.clear();
    for (const [key, mark] of state.marks) this.marks.set(key, mark);
    this.changes++;
  }

  /** The goal page showed them: every change counts as read. */
  read(): boolean {
    if (this.marks.size === 0) return false;
    this.marks.clear();
    this.changes++;
    return true;
  }

  private mark(key: string, mark: GoalMark): boolean {
    if (this.marks.get(key) === mark) return false;
    this.marks.set(key, mark);
    return true;
  }
}

/** The book's two lists: what is to do (open, then the visible but inactive in muted ink) and what is
 *  done. */
export function goalLists(goals: readonly MissionGoal[]): {
  readonly current: readonly MissionGoal[];
  readonly done: readonly MissionGoal[];
} {
  return {
    current: [...goals.filter((g) => g.state === 'open'), ...goals.filter((g) => g.state === 'idle')],
    done: goals.filter((g) => g.state === 'done'),
  };
}

export function openGoalCount(goals: readonly MissionGoal[]): number {
  let count = 0;
  for (const g of goals) if (g.state === 'open') count++;
  return count;
}

export interface SlipRow {
  readonly goal: MissionGoal;
  readonly mark: GoalMark | null;
}

/**
 * What the goal slip lists: the goals just done, then the open goals with the new ones first, at most
 * `openRows` of them, and how many open goals it left for the book.
 */
export function slipRows(
  goals: readonly MissionGoal[],
  marks: Pick<GoalMarks, 'markOf'>,
  openRows: number,
): { readonly rows: readonly SlipRow[]; readonly more: number } {
  const done: SlipRow[] = [];
  const fresh: SlipRow[] = [];
  const open: SlipRow[] = [];
  for (const goal of goals) {
    const mark = marks.markOf(goal.key);
    if (goal.state === 'done' && mark === 'done') done.push({ goal, mark });
    else if (goal.state === 'open') (mark === 'new' ? fresh : open).push({ goal, mark });
  }
  const listed = [...fresh, ...open];
  return { rows: [...done, ...listed.slice(0, openRows)], more: Math.max(0, listed.length - openRows) };
}
