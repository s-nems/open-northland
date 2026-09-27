import type { SaveGame, Simulation } from '@open-northland/sim';
import { buildMapWorkerWorld, type MapWorkerBoot } from '../../../src/entries/map/world-inputs.js';
import { createSceneSim, restoreSceneSim, SCENES } from '../../../src/scenes/index.js';
import { servedOverLoopback } from '../../../src/session/worker/loopback.js';
import type { WorkerSessionOptions } from '../../../src/session/worker/protocol.js';
import type { HostedBuild } from '../../../src/session/worker/serve.js';

/** A tick that throws, before or after its writes, or blocks the worker, when the sim steps into it. */
export interface InjectedFault {
  readonly tick: number;
  readonly kind: 'throw' | 'throwAfterWrites' | 'block';
  /** How long a `block` holds the worker. */
  readonly blockMs?: number;
}

export type TestWorldBoot =
  | {
      readonly kind: 'scene';
      readonly id: string;
      readonly save?: SaveGame;
      readonly fault?: InjectedFault;
      /** Every step holds the worker this long, as a sim slower than its clock would. */
      readonly stepMs?: number;
      /** Served without the off-clock `run`, as a session another authority clocks. */
      readonly clockOnly?: boolean;
    }
  | { readonly kind: 'map'; readonly boot: MapWorkerBoot };

export const INJECTED_FAULT_MESSAGE = 'injected tick fault';

export function buildTestWorld(boot: TestWorldBoot, options: WorkerSessionOptions): HostedBuild<null> {
  if (boot.kind === 'map') return { ...buildMapWorkerWorld(boot.boot, options), extras: null };
  const scene = SCENES.find((s) => s.id === boot.id);
  if (scene === undefined) throw new Error(`no '${boot.id}' scene in the registry`);
  const sim = boot.save === undefined ? createSceneSim(scene) : restoreSceneSim(scene, boot.save);
  if (boot.fault !== undefined) injectFault(sim, boot.fault);
  if (boot.stepMs !== undefined) slowSteps(sim, boot.stepMs);
  const served = servedOverLoopback({ sim, extras: null }, options);
  return boot.clockOnly === true ? { sim, driver: served.driver, extras: null } : served;
}

function injectFault(sim: Simulation, fault: InjectedFault): void {
  const step = sim.step.bind(sim);
  sim.step = (): void => {
    const faulting = sim.tick + 1 === fault.tick;
    if (faulting && fault.kind === 'throw') throw new Error(INJECTED_FAULT_MESSAGE);
    if (faulting && fault.kind === 'block') holdThread(fault.blockMs ?? 0);
    step();
    if (faulting && fault.kind === 'throwAfterWrites') throw new Error(INJECTED_FAULT_MESSAGE);
  };
}

function slowSteps(sim: Simulation, stepMs: number): void {
  const step = sim.step.bind(sim);
  sim.step = (): void => {
    holdThread(stepMs);
    step();
  };
}

/** Holds the worker's thread, as a runaway tick would. */
function holdThread(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // Busy: a timer would let the thread answer its messages.
  }
}
