import { LockstepDriver, LoopbackTransport } from '@open-northland/lockstep';
import type { WorkerSessionOptions } from './protocol.js';
import type { BuiltWorld, HostedBuild } from './serve.js';

/** A single-player world served as its own authority: the loopback driver clocks it, and `run` steps
 *  outside that clock with each tick's frame from the same transport. */
export function servedOverLoopback<E>(
  world: BuiltWorld<E>,
  clock: Pick<WorkerSessionOptions, 'speed' | 'paused'>,
): HostedBuild<E> {
  const { sim } = world;
  const transport = new LoopbackTransport();
  const driver = new LockstepDriver({ sim, transport, speed: clock.speed, paused: clock.paused });
  const step = (): void => {
    const tick = sim.tick + 1;
    for (const command of transport.take(tick).commands)
      sim.enqueueAt(command.envelope, tick, command.sequence);
    sim.step();
  };
  return { ...world, driver, run: { step } };
}
