import { describe, expect, it } from 'vitest';
import { Position } from '../../src/components/index.js';
import {
  diffDigestInputs,
  digestInputsFromJson,
  digestInputsToJson,
  type Entity,
  FOG_MODE,
  fx,
  Simulation,
  type SyncDigestInputs,
} from '../../src/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';

/**
 * Two clients' digest inputs at one tick, diffed, name the first entity and component that differ: the
 * step past "the relay says tick N disagrees in the movement domain".
 */

const SEED = 3;
const MAP_CELLS = 12;
const VIKING = 1;
const IDLE_JOB = 0;
const P0 = 0;
/** Ticks stepped before the compared one, past the settler's first vision rebuild. */
const WARMUP_TICKS = 3;
/** The perturbed run's marker x, in whole visual cells. */
const PERTURBED_X = 5;

interface CapturedRun {
  readonly sim: Simulation;
  /** An inert entity holding only a `Position`, written once per tick by the test. */
  readonly marker: Entity;
}

/** A fogged world with one settler and a marker, capturing digest inputs, warmed up. */
function capturedRun(): CapturedRun {
  const sim = new Simulation({ seed: SEED, content: testContent(), map: grassCellMap(MAP_CELLS, MAP_CELLS) });
  sim.setSyncDigest(true, { captureInputs: true });
  sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC });
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: IDLE_JOB, x: 8, y: 8, tribe: VIKING, owner: P0 });
  const marker = sim.world.create();
  sim.world.add(marker, Position, positionOfNode(0, 0));
  sim.run(WARMUP_TICKS);
  return { sim, marker };
}

/**
 * Step one tick, acquiring the marker's `Position` through `World.mut` inside the tick so the digest
 * folds it; `perturb` also changes its value.
 */
function stepWritingMarker({ sim, marker }: CapturedRun, perturb: boolean): SyncDigestInputs {
  let written = false;
  sim.setInstrument((_, run) => {
    run();
    if (written) return;
    written = true;
    const position = sim.world.mut(marker, Position);
    if (perturb) position.x = fx.fromInt(PERTURBED_X);
  });
  sim.step();
  sim.setInstrument(null);
  const inputs = sim.syncDigestInputs();
  if (inputs === null) throw new Error('the sim captured no digest inputs');
  return inputs;
}

describe('diffDigestInputs', () => {
  it('finds nothing between two identical runs', () => {
    const a = stepWritingMarker(capturedRun(), false);
    const b = stepWritingMarker(capturedRun(), false);
    expect(b).toEqual(a);
    expect(diffDigestInputs(a, b)).toBeNull();
  });

  it('names the component, entity and domain of a changed value', () => {
    const a = capturedRun();
    const b = capturedRun();
    const difference = diffDigestInputs(stepWritingMarker(a, false), stepWritingMarker(b, true));
    expect(difference).toEqual({
      kind: 'component',
      domain: 'movement',
      component: Position.name,
      entity: a.marker,
      detail: 'word',
    });
  });

  it('names the rng state before anything else', () => {
    const a = capturedRun();
    const b = capturedRun();
    b.sim.rng.setState(a.sim.rng.getState() + 1);
    const difference = diffDigestInputs(stepWritingMarker(a, false), stepWritingMarker(b, true));
    expect(difference?.kind).toBe('rng');
  });

  it('names a component only one side touched', () => {
    const a = stepWritingMarker(capturedRun(), false);
    const quiet = capturedRun();
    quiet.sim.step();
    const b = quiet.sim.syncDigestInputs();
    if (b === null) throw new Error('the sim captured no digest inputs');
    expect(diffDigestInputs(a, b)).toEqual({
      kind: 'componentSet',
      detail: 'onlyInA',
      component: Position.name,
    });
    expect(diffDigestInputs(b, a)).toEqual({
      kind: 'componentSet',
      detail: 'onlyInB',
      component: Position.name,
    });
  });

  it('refuses to compare different ticks', () => {
    const run = capturedRun();
    const earlier = stepWritingMarker(run, false);
    const later = stepWritingMarker(run, false);
    expect(() => diffDigestInputs(earlier, later)).toThrow(/compares one tick/);
  });

  it('keeps the diff result through a JSON round trip', () => {
    const a = capturedRun();
    const b = capturedRun();
    const left = stepWritingMarker(a, false);
    const right = stepWritingMarker(b, true);
    const roundTrip = (inputs: SyncDigestInputs): SyncDigestInputs =>
      digestInputsFromJson(JSON.parse(JSON.stringify(digestInputsToJson(inputs))));

    expect(roundTrip(left)).toEqual(left);
    expect(diffDigestInputs(roundTrip(left), roundTrip(right))).toEqual(diffDigestInputs(left, right));
    expect(diffDigestInputs(roundTrip(left), roundTrip(left))).toBeNull();
  });
});
