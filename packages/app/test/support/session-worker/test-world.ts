import type { SaveGame, Simulation } from '@open-northland/sim';
import { buildMapWorkerWorld, type MapWorkerBoot } from '../../../src/entries/map/world-inputs.js';
import { createSceneSim, restoreSceneSim, SCENES } from '../../../src/scenes/index.js';
import { servedOverLoopback } from '../../../src/session/worker/loopback.js';
import type { WorkerSessionOptions } from '../../../src/session/worker/protocol.js';
import type { HostedBuild } from '../../../src/session/worker/serve.js';

/** A tick that throws, or blocks the worker, when the sim steps into it. */
export interface InjectedFault {
  readonly tick: number;
  readonly kind: 'throw' | 'block';
  /** How long a `block` holds the worker. */
  readonly blockMs?: number;
}

export type TestWorldBoot =
  | {
      readonly kind: 'scene';
      readonly id: string;
      readonly save?: SaveGame;
      readonly fault?: InjectedFault;
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
  const served = servedOverLoopback({ sim, extras: null }, options);
  return boot.clockOnly === true ? { sim, driver: served.driver, extras: null } : served;
}

function injectFault(sim: Simulation, fault: InjectedFault): void {
  const step = sim.step.bind(sim);
  sim.step = (): void => {
    if (sim.tick + 1 === fault.tick) {
      if (fault.kind === 'throw') throw new Error(INJECTED_FAULT_MESSAGE);
      const until = performance.now() + (fault.blockMs ?? 0);
      while (performance.now() < until) {
        // Holds the worker's thread, as a runaway tick would.
      }
    }
    step();
  };
}
