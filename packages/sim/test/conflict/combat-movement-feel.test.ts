import { beforeEach, describe, expect, it } from 'vitest';
import {
  CurrentAtomic,
  Engagement,
  Health,
  Owner,
  PathFollow,
  PlayerOrder,
  Position,
  Settler,
  Stance,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation, type TerrainMap, cellAnchorNode, fx, halfCellMapFromCells } from '../../src/index.js';
import { nodeOfPosition, positionOfNode } from '../../src/nav/halfcell.js';
import { moveUnit } from '../../src/systems/conflict/orders.js';
import type { SystemContext } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { testContent } from '../fixtures/content.js';
import { clearComponentStores } from '../fixtures/stores.js';

/**
 * The combat MOVEMENT-FEEL contracts (the reported large-battle artifacts, each pinned here):
 *
 *  1. **Chase route continuity** — a chaser re-aims its LIVE route at the repath cadence (the
 *     moveUnit redirect pattern: goal swap + routing splice) instead of dropping it; clearing the
 *     nav state reset the gait to zero every 8 ticks, so a charging unit lurched cell-by-cell
 *     (accelerate → brake → stall) while a player-ordered walk glided — the chase stutter.
 *  2. **Swing from a standstill** — node positions truncate, so a walker reads as in-band
 *     mid-stride; swinging there froze the walker off any node centre (the wind-up glide/teleport).
 *     A swing may only start once the walker has finished its braked last leg onto a node centre.
 *  3. **The arrived hold does not suppress a fighter's combat drive** — a unit holding at an
 *     ordered spot on ATTACK/DEFEND engages an enemy per its stance instead of standing through
 *     the timed hold while being beaten to death; passive stances (IGNORE/FLEE) still hold blindly,
 *     and the ordered WALK itself stays authoritative (no mid-route auto-engage).
 *  4. **A move order relocates a DEFEND post** — the anchor follows the ordered spot, so the guard
 *     defends where it was sent instead of marching back to the tile the stance was set on.
 *
 * All are OUR design (no oracle) — source basis "Combat chase / repath cadence" and "Player
 * move-order dwell"; the fixture's `test_axe` (viking tribe 1, job 1) has band [1, 2].
 */

const GRASS = 0;
const VIKING = 1;
const WOODCUTTER = 1;
const P0 = 0;
const P1 = 1;

beforeEach(clearComponentStores);

function grassMap(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
}

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

/** An owned combatant (Settler + Health + Owner + an explicit stance) at cell (x, y). */
function fighterAt(
  sim: Simulation,
  x: number,
  y: number,
  owner: number,
  mode: number = MILITARY_MODE.ATTACK,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(e, Health, { hitpoints: 1_000_000, max: 1_000_000 });
  sim.world.add(e, Owner, { player: owner });
  sim.world.add(e, Stance, { mode, anchorCell: null });
  return e;
}

/** Step until the chaser's first attack swing, recording route-gap ticks (engaged, but neither a
 *  live path nor a swing) after its route first appeared. Returns -1 as swingTick if none landed. */
function runChase(sim: Simulation, chaser: Entity, maxTicks: number): { swingTick: number; gaps: number } {
  let firstFollow = -1;
  let gaps = 0;
  for (let t = 0; t < maxTicks; t++) {
    sim.step();
    if (sim.world.tryGet(chaser, CurrentAtomic)?.effect.kind === 'attack') return { swingTick: t, gaps };
    const hasPath = sim.world.has(chaser, PathFollow);
    if (firstFollow < 0) {
      if (hasPath) firstFollow = t;
    } else if (!hasPath) {
      gaps++;
    }
  }
  return { swingTick: -1, gaps };
}

describe('chase route continuity — a repath re-aims the live route, never stops the walker', () => {
  it('a long chase keeps its PathFollow through every repath (no per-cadence stop-start lurch)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const a = fighterAt(sim, 0, 0, P0);
    fighterAt(sim, 7, 0, P1, MILITARY_MODE.IGNORE); // 14 nodes away (inside sight 16); IGNORE — it stands

    const { swingTick, gaps } = runChase(sim, a, 200);

    expect(swingTick).toBeGreaterThan(0); // the chase closed into a swing
    // ~9 repaths happen over this walk; the old clearChase dropped the route on each (one gap tick
    // per cadence). The re-aim keeps the route live — only the arrival handoff may briefly show none.
    expect(gaps).toBeLessThanOrEqual(2);
  });
});

describe('swing from a standstill — no wind-up mid-stride, off a node centre', () => {
  it('a WESTWARD chaser swings EXACTLY on a node centre (truncation reads the band early)', () => {
    // Node coords TRUNCATE, so a walker moving −x reads as standing on its next node one step after
    // LEAVING the previous centre — nearly half a column early. A westward chaser therefore enters
    // the weapon band MID-STRIDE; without the standstill gate the first swing started there, frozen
    // off any centre (the reported wind-up glide/teleport). Eastward legs flip exactly ON the centre,
    // which is why an east-walking chaser can't reproduce it.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const a = fighterAt(sim, 7, 0, P0); // charges WEST
    fighterAt(sim, 0, 0, P1, MILITARY_MODE.IGNORE); // stands

    const { swingTick } = runChase(sim, a, 200);
    expect(swingTick).toBeGreaterThan(0);

    // Fixed-point EXACT equality with the node centre it stands on.
    const p = sim.world.get(a, Position);
    const n = nodeOfPosition(p.x, p.y);
    const centre = positionOfNode(n.hx, n.hy);
    expect(p.x).toBe(centre.x);
    expect(p.y).toBe(centre.y);
    expect(sim.world.has(a, PathFollow)).toBe(false); // swinging while walking is the artifact
  });
});

describe('the arrived hold vs the combat drive', () => {
  /** Order `e` to cell (x, y) and step until the hold has begun (arrived), then `extra` more ticks. */
  function orderAndArrive(sim: Simulation, e: Entity, x: number, y: number, extra: number): void {
    const spot = cellAnchorNode(x, y);
    sim.enqueue({ kind: 'moveUnit', entity: e, x: spot.hx, y: spot.hy });
    let arrived = false;
    for (let t = 0; t < 300 && !arrived; t++) {
      sim.step();
      arrived = sim.world.tryGet(e, PlayerOrder)?.expiresAt != null || !sim.world.has(e, PlayerOrder);
    }
    expect(arrived).toBe(true);
    for (let t = 0; t < extra; t++) sim.step();
  }

  it('an ATTACK fighter holding at the ordered spot engages a nearby enemy instead of waiting out the timer', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const a = fighterAt(sim, 0, 0, P0);
    const enemy = fighterAt(sim, 8, 0, P1, MILITARY_MODE.IGNORE);
    const hp0 = sim.world.get(enemy, Health).hitpoints;

    orderAndArrive(sim, a, 7, 0, 60); // ordered one cell short of the enemy — in band after arrival

    // Well before the 300-tick soldier hold expires, the fighter has taken the fight up (and the
    // engagement/swing state ended the order through playerOrderSystem's own rules).
    expect(sim.world.get(enemy, Health).hitpoints).toBeLessThan(hp0);
    expect(sim.world.has(a, PlayerOrder)).toBe(false);
  });

  it('a PASSIVE (IGNORE) unit keeps holding the spot blindly — no auto-engage from the hold', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const a = fighterAt(sim, 0, 0, P0, MILITARY_MODE.IGNORE);
    const enemy = fighterAt(sim, 8, 0, P1, MILITARY_MODE.IGNORE);
    const hp0 = sim.world.get(enemy, Health).hitpoints;

    orderAndArrive(sim, a, 7, 0, 60);

    expect(sim.world.get(enemy, Health).hitpoints).toBe(hp0); // it never swung
    expect(sim.world.has(a, Engagement)).toBe(false);
    expect(sim.world.has(a, PlayerOrder)).toBe(true); // still holding (60 < the 300-tick soldier hold)
  });

  it('a DEFEND guard holding at the ordered spot fights an enemy inside its (relocated) radius', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const a = fighterAt(sim, 0, 0, P0, MILITARY_MODE.DEFEND);
    const enemy = fighterAt(sim, 8, 0, P1, MILITARY_MODE.IGNORE);
    const hp0 = sim.world.get(enemy, Health).hitpoints;

    orderAndArrive(sim, a, 7, 0, 60); // enemy is 2 nodes from the ordered spot — inside the defend radius

    expect(sim.world.get(enemy, Health).hitpoints).toBeLessThan(hp0);
  });
});

describe('a move order relocates a DEFEND post', () => {
  it('re-anchors the stance on the ordered goal, and the guard STAYS there (no march back)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const a = fighterAt(sim, 2, 0, P0, MILITARY_MODE.DEFEND);
    const oldAnchor = sim.terrain?.nodeAtClamped(cellAnchorNode(2, 0).hx, cellAnchorNode(2, 0).hy);
    const stance = sim.world.get(a, Stance);
    stance.anchorCell = oldAnchor ?? null; // guarding its spawn spot

    const spot = cellAnchorNode(9, 0);
    moveUnit(sim.world, ctxOf(sim), { kind: 'moveUnit', entity: a, x: spot.hx, y: spot.hy });
    const goal = sim.terrain?.nodeAtClamped(spot.hx, spot.hy);
    expect(sim.world.get(a, Stance).anchorCell).toBe(goal); // the post moved with the order

    // Walk it out well past the arrival AND the hold: the guard keeps the NEW post. Without the
    // re-anchor the arrived-hold combat pass marched it straight back to the old anchor.
    for (let t = 0; t < 400; t++) sim.step();
    const p = sim.world.get(a, Position);
    expect(fx.toInt(p.x)).toBe(9);
  });
});
