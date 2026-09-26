import type { SaveGame, Simulation } from '@open-northland/sim';
import { buildMapWorkerWorld, type MapWorkerBoot } from '../../../src/entries/map/world-inputs.js';
import { createSceneSim, restoreSceneSim, SCENES } from '../../../src/scenes/index.js';
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
    }
  | { readonly kind: 'map'; readonly boot: MapWorkerBoot };

export const INJECTED_FAULT_MESSAGE = 'injected tick fault';

export function buildTestWorld(boot: TestWorldBoot): HostedBuild<null> {
  if (boot.kind === 'map') {
    const { sim } = buildMapWorkerWorld(boot.boot);
    return { sim, extras: null };
  }
  const scene = SCENES.find((s) => s.id === boot.id);
  if (scene === undefined) throw new Error(`no '${boot.id}' scene in the registry`);
  const sim = boot.save === undefined ? createSceneSim(scene) : restoreSceneSim(scene, boot.save);
  if (boot.fault !== undefined) injectFault(sim, boot.fault);
  return { sim, extras: null };
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
