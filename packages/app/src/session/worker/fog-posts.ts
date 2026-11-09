import { FOG_MODE, type FogMaskAnswer, type FogMode, scanChangedBytes } from '@open-northland/sim';
import { type FogUpdate, fogGroupKey } from './protocol.js';

/** What a served world answers of its fog. */
export interface FogSource {
  readonly fog?: { viewGeneration(player: number): number } | undefined;
  fogMode(): FogMode;
  sharedFogMaskAnswer(players: readonly number[]): FogMaskAnswer | null;
}

interface PostedGroup {
  readonly players: readonly number[];
  /** The {@link FogGroups.stamp} the group last answered under. */
  stamp: string;
  readonly posts: FogPosts;
}

/** A stamp no answer carries, so a new group answers at its first look. */
const UNANSWERED = '';

/**
 * The seat groups whose fog the worker posts, each answered only when its own masks could have moved:
 * another vision group's rebuild leaves a group be, so its masks are neither copied nor compared then.
 * A group stays posted for the session once asked for.
 */
export class FogGroups {
  private readonly groups = new Map<string, PostedGroup>();

  constructor(private readonly source: FogSource) {}

  track(groups: readonly (readonly number[])[]): void {
    for (const players of groups) {
      const key = fogGroupKey(players);
      if (!this.groups.has(key)) this.groups.set(key, { players, stamp: UNANSWERED, posts: new FogPosts() });
    }
  }

  /** The groups whose masks read differently since their last answer, a new group's first included. */
  changes(): FogUpdate[] {
    const updates: FogUpdate[] = [];
    for (const [key, group] of this.groups) {
      const stamp = this.stamp(group.players);
      if (stamp === group.stamp) continue;
      group.stamp = stamp;
      const fog = this.source.sharedFogMaskAnswer(group.players);
      if (group.posts.changed(fog)) updates.push({ group: key, fog });
    }
    return updates;
  }

  private stamp(players: readonly number[]): string {
    const fog = this.source.fog;
    const mode = this.source.fogMode();
    if (fog === undefined || mode === FOG_MODE.OFF) return 'off';
    return `${mode}:${players.map((seat) => fog.viewGeneration(seat)).join(',')}`;
  }
}

/**
 * The viewer's fog as the runtime last received it. A change to the viewer's group can still leave
 * the mask as it was (a downgrade the same rebuild's stamps raise back); posting it would copy the
 * mask across and have every fog reader on the main thread rebuild for nothing.
 */
export class FogPosts {
  /** A copy of the last mask passed on, since a posted mask's buffer is transferred away; undefined
   *  before the first. */
  private last: FogMaskAnswer | null | undefined = undefined;

  /** Whether `answer` reads differently from the last answer passed on, its generation aside; a
   *  changed answer becomes the last. */
  changed(answer: FogMaskAnswer | null): boolean {
    if (this.last !== undefined && sameFog(this.last, answer)) return false;
    this.last = answer === null ? null : { ...answer, mask: answer.mask?.slice() ?? null };
    return true;
  }
}

function sameFog(a: FogMaskAnswer | null, b: FogMaskAnswer | null): boolean {
  if (a === null || b === null) return a === b;
  if (
    a.player !== b.player ||
    a.mode !== b.mode ||
    a.cellsWide !== b.cellsWide ||
    a.cellsHigh !== b.cellsHigh
  ) {
    return false;
  }
  const am = a.mask;
  const bm = b.mask;
  if (am === null || bm === null) return am === bm;
  return sameBytes(am, bm);
}

/** Byte equality of two masks, compared whenever the viewer's group changed. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let same = true;
  scanChangedBytes(a, b, () => {
    same = false;
    return false;
  });
  return same;
}
