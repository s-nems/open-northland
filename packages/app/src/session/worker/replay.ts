import { ReplayDriver, ReplayTransport } from '@open-northland/lockstep';
import type { LoggedCommand } from '@open-northland/sim';
import type { WorkerSessionOptions } from './protocol.js';
import type { BuiltWorld, HostedBuild } from './serve.js';

/** A recording the worker's world plays back: the commands its session applied, the last tick it
 *  covers and the state hash its capturing session took there, which the playback checks. */
export interface ReplayServing {
  readonly log: readonly LoggedCommand[];
  readonly endTick: number;
  readonly stateHash: string;
}

/** A recorded world played back: the replay driver clocks it over the recording's transport, and no
 *  off-clock run exists, for the recording alone decides what applies. */
export function servedOverReplay<E>(
  world: BuiltWorld<E>,
  clock: Pick<WorkerSessionOptions, 'speed' | 'paused'>,
  replay: ReplayServing,
): HostedBuild<E> {
  const { sim } = world;
  const transport = new ReplayTransport(replay.log, sim.tick, replay.endTick);
  const driver = new ReplayDriver({ sim, transport, speed: clock.speed, paused: clock.paused });
  return { ...world, driver, replayEnd: { endTick: replay.endTick, stateHash: replay.stateHash } };
}
