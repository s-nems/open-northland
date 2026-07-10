import { type WorldSnapshot, fx, nodeOfPosition, positionOfNode } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import { type BuildingDoorInfo, computeDoorBadges } from '../src/view/door-badges.js';

/**
 * computeDoorBadges — the pure snapshot→door-badge projection the render layer draws. It reads the sim's
 * {@link JobAssignment} binding, so a badge appears for every worker bound to a building (auto-assigned
 * or player-assigned), split by worker role (craftsman / carrier / gatherer via `roleOf`), anchored on
 * the building's door node.
 */

const CARRIER = 26; // a carrier job id
const CRAFTSMAN = 1008; // a rebased craftsman job id
const GATHERER = 20; // a gatherer job id (the sandbox gatherer band)

/** The test's role classifier — the same three-way split the sandbox `workerRoleOf` makes. */
const roleOf = (jobType: number): 'gatherer' | 'carrier' | 'craftsman' =>
  jobType === CARRIER ? 'carrier' : jobType === GATHERER ? 'gatherer' : 'craftsman';

interface Ent {
  readonly id: number;
  readonly components: Record<string, unknown>;
}

function snapshotOf(entities: Ent[]): WorldSnapshot {
  return { tick: 0, entities, events: [] } as unknown as WorldSnapshot;
}

/** A building entity at tile (x,y) of type `typeId`. */
function building(id: number, typeId: number, x: number, y: number): Ent {
  return {
    id,
    components: { Building: { buildingType: typeId }, Position: { x: fx.fromInt(x), y: fx.fromInt(y) } },
  };
}

/** A settler bound (or not) to a workplace, of a given job. */
function settler(id: number, jobType: number, workplace: number | null): Ent {
  return {
    id,
    components: {
      Settler: { jobType },
      ...(workplace !== null ? { JobAssignment: { workplace } } : {}),
    },
  };
}

describe('computeDoorBadges', () => {
  it('tallies bound workers per building, split by role (craftsman/carrier/gatherer), at the door node', () => {
    const types = new Map<number, BuildingDoorInfo>([[7, { footprint: { door: { dx: 0, dy: 2 } } }]]);
    const snap = snapshotOf([
      building(1, 7, 4, 4),
      settler(2, CRAFTSMAN, 1),
      settler(3, CRAFTSMAN, 1),
      settler(4, CARRIER, 1),
      settler(5, GATHERER, 1),
    ]);

    const badges = computeDoorBadges(snap, types, roleOf);

    expect(badges).toHaveLength(1);
    const badge = badges[0];
    expect(badge?.id).toBe(1);
    expect(badge?.craftsmen).toBe(2);
    expect(badge?.carriers).toBe(1);
    expect(badge?.gatherers).toBe(1);
    // Anchored on the door node = the building's anchor node plus the type's door offset.
    const anchor = nodeOfPosition(fx.fromInt(4), fx.fromInt(4));
    const doorPos = positionOfNode(anchor.hx + 0, anchor.hy + 2);
    expect(badge?.x).toBe(doorPos.x);
    expect(badge?.y).toBe(doorPos.y);
  });

  it('emits no badge for an unstaffed building, and ignores an unbound settler', () => {
    const snap = snapshotOf([
      building(1, 7, 4, 4), // no workers bound here
      settler(2, CRAFTSMAN, null), // unemployed / unbound — no badge
    ]);

    expect(computeDoorBadges(snap, new Map(), roleOf)).toEqual([]);
  });

  it('falls back to the anchor node when the building type declares no door', () => {
    const snap = snapshotOf([building(1, 7, 4, 4), settler(2, CRAFTSMAN, 1)]);

    const badge = computeDoorBadges(snap, new Map(), roleOf)[0]; // type 7 absent → no door offset
    const anchor = nodeOfPosition(fx.fromInt(4), fx.fromInt(4));
    const anchorPos = positionOfNode(anchor.hx, anchor.hy);
    expect(badge?.x).toBe(anchorPos.x);
    expect(badge?.y).toBe(anchorPos.y);
  });
});
