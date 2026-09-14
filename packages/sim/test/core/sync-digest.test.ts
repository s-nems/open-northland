import { describe, expect, it } from 'vitest';
import { Settler } from '../../src/components/index.js';
import { TOUCHED_LOG_OVERFLOW_LIMIT } from '../../src/ecs/touched-log.js';
import {
  adminCommand,
  FOG_MODE,
  Simulation,
  SYNC_DOMAINS,
  type SyncDigest,
  type SyncDomain,
} from '../../src/index.js';
import { FOG_STATE } from '../../src/systems/vision/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';

/**
 * The sync digest is the per-tick equality check two clients of one session compare. It has to be a
 * pure function of the state a tick reached - never of how often the local client snapshots - and a
 * mismatch has to name the domain that drifted, or the check tells a client only that it is lost.
 */

const SEED = 3;
const VIKING = 1;
const MAP_CELLS = 12;
const IDLE_JOB = 0;
const P0 = 0;

function mapless(): Simulation {
  return new Simulation({ seed: SEED, content: testContent() });
}

function mapped(): Simulation {
  return new Simulation({ seed: SEED, content: testContent(), map: grassCellMap(MAP_CELLS, MAP_CELLS) });
}

function digesting(build: () => Simulation): Simulation {
  const sim = build();
  sim.setSyncDigest(true);
  return sim;
}

function digestOf(sim: Simulation): SyncDigest {
  const digest = sim.syncDigest();
  if (digest === null) throw new Error('the sim sealed no digest');
  return digest;
}

/** The domains whose folds disagree - what a session would report to a diverged client. */
function differingDomains(a: SyncDigest, b: SyncDigest): SyncDomain[] {
  return SYNC_DOMAINS.filter((domain) => a.domains[domain] !== b.domains[domain]);
}

function sequence(sim: Simulation, ticks: number, onTick?: (sim: Simulation) => void): SyncDigest[] {
  const digests: SyncDigest[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    onTick?.(sim);
    digests.push(digestOf(sim));
  }
  return digests;
}

/** A world with one owned settler under REVEAL fog, stepped past its first mask rebuild. */
function watchedWorld(): Simulation {
  const sim = digesting(mapped);
  sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.REVEAL });
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: IDLE_JOB, x: 8, y: 8, tribe: VIKING, owner: P0 });
  sim.step();
  return sim;
}

/** The lattice node of a cell the settler has not seen, so an exploration there writes a mask byte. */
function unseenNode(sim: Simulation): { hx: number; hy: number } {
  const fog = sim.fog;
  const mask = fog?.tryMaskFor(P0);
  if (fog === undefined || mask === undefined) throw new Error('the settler stamped no mask');
  const unseen = mask.indexOf(FOG_STATE.UNEXPLORED);
  expect(unseen).toBeGreaterThanOrEqual(0);
  return { hx: (unseen % fog.cellsWide) * 2, hy: Math.floor(unseen / fog.cellsWide) * 2 };
}

describe('sync digest', () => {
  it('is null while the digest is off, and off changes nothing the hash can see', () => {
    const off = mapless();
    off.run(3);
    expect(off.syncDigest()).toBeNull();

    const on = digesting(mapless);
    on.run(3);
    expect(on.hashState()).toBe(off.hashState());
  });

  it('reports the same sequence for two runs of the same inputs', () => {
    const a = sequence(watchedWorld(), 8);
    const b = sequence(watchedWorld(), 8);
    expect(b).toEqual(a);
  });

  it('does not depend on how often the run snapshots', () => {
    const snapshotting = sequence(watchedWorld(), 8, (sim) => {
      sim.snapshot();
    });
    expect(snapshotting).toEqual(sequence(watchedWorld(), 8));
  });

  it('does not depend on the touched log, even past its overflow', () => {
    // The touched log drops its contents wholesale past this many entities, so a digest folded from it
    // would depend on whether this client happened to snapshot before the overflow.
    const populate = (): Simulation => {
      const sim = digesting(mapless);
      for (let i = 0; i <= TOUCHED_LOG_OVERFLOW_LIMIT; i++) sim.world.create();
      return sim;
    };
    const overflowed = sequence(populate(), 3);
    const drained = sequence(populate(), 3, (sim) => {
      sim.snapshot();
    });
    expect(drained).toEqual(overflowed);
  });

  it('names only the rng domain when the stream position differs', () => {
    const a = digesting(mapless);
    const b = digesting(mapless);
    a.step();
    b.step();
    b.rng.setState(a.rng.getState() + 1);
    a.step();
    b.step();

    expect(differingDomains(digestOf(a), digestOf(b))).toEqual(['rng']);
  });

  it('names only the players domain when one rule differs', () => {
    const a = digesting(mapless);
    const b = digesting(mapless);
    for (const sim of [a, b]) {
      sim.enqueue(adminCommand({ kind: 'setNeedsEnabled', enabled: false }));
      sim.step();
    }
    // A second write to the carrier the first tick created: it mutates one component and allocates
    // nothing, so nothing but its own domain can move.
    b.enqueue(adminCommand({ kind: 'setNeedsEnabled', enabled: true }));
    a.step();
    b.step();

    expect(differingDomains(digestOf(a), digestOf(b))).toEqual(['players']);
  });

  it('names the entities domain and the component s own domain on a first write', () => {
    // A rules command creates its carrier, so the tick allocates an entity and writes one component.
    // Which domain that component lands in is the whole point of declaring one per component.
    const rules = digesting(mapless);
    const fogRules = digesting(mapless);
    const idle = digesting(mapless);
    for (const sim of [rules, fogRules, idle]) sim.step();
    rules.enqueue(adminCommand({ kind: 'setNeedsEnabled', enabled: false }));
    fogRules.enqueue(adminCommand({ kind: 'setFogMode', mode: FOG_MODE.REVEAL }));
    for (const sim of [rules, fogRules, idle]) sim.step();

    expect(differingDomains(digestOf(idle), digestOf(rules))).toEqual(['entities', 'players']);
    expect(differingDomains(digestOf(idle), digestOf(fogRules))).toEqual(['entities', 'fog']);
  });

  it('names the entities domain when an entity leaves the alive set', () => {
    const killed = watchedWorld();
    const alive = watchedWorld();
    const settler = [...killed.world.query(Settler)][0];
    if (settler === undefined) throw new Error('the world stood up no settler');
    killed.enqueue(adminCommand({ kind: 'debugKill', target: settler }));
    // The kill drains the pool; the cleanup pass of the next tick reaps the entity.
    killed.run(2);
    alive.run(2);

    expect(differingDomains(digestOf(alive), digestOf(killed))).toContain('entities');
  });

  it('names only the fog domain when one mask cell differs', () => {
    const a = watchedWorld();
    const b = watchedWorld();
    const mask = b.fog?.tryMaskFor(P0);
    if (mask === undefined) throw new Error('the settler stamped no mask');
    const perturbed = Uint8Array.from(mask);
    const unseen = perturbed.indexOf(FOG_STATE.UNEXPLORED);
    expect(unseen).toBeGreaterThanOrEqual(0);
    perturbed[unseen] = FOG_STATE.EXPLORED;
    b.fog?.restoreMask(P0, perturbed);

    // A tick off the rebuild cadence, so the vision system does not simply re-stamp the difference away.
    a.step();
    b.step();

    expect(differingDomains(digestOf(a), digestOf(b))).toEqual(['fog']);
  });

  it.each([
    ['an area', (sim: Simulation) => sim.fog?.exploreArea(P0, unseenNode(sim), 1)],
    ['the whole grid', (sim: Simulation) => sim.fog?.exploreAll(P0)],
  ])('folds a scripted exploration of %s as the mask bytes it wrote', (_, explore) => {
    const incremental = watchedWorld();
    const rebuilt = watchedWorld();
    explore(incremental);
    explore(rebuilt);
    expect(incremental.hashState()).toBe(rebuilt.hashState());
    // A fold rebuilt from the mask bytes is what a client restored from a snapshot carries; the
    // incrementally maintained one has to agree with it or the two ack different digests.
    rebuilt.fog?.stopFolding();
    rebuilt.fog?.startFolding();
    incremental.step();
    rebuilt.step();

    expect(digestOf(incremental).domains.fog).toBe(digestOf(rebuilt).domains.fog);
  });
});
