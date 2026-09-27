import { type GameSession, isSpectator, localPlayerOf } from '@open-northland/lockstep';
import { HASH_TRACE_DEBUG_FLAG, hasDebugFlag } from '../../diag/index.js';
import type { RelayedMapSession, RelayedWorldHosting } from '../../net/connection.js';
import type { WorkerSessionOptions } from '../../session/worker/protocol.js';
import type { AssembledMapWorld, HostedMapWorld } from '../map/boot.js';
import type { MapWorldDocuments } from '../map/world-inputs.js';

/** A relayed world, its sim run by the network worker's client. */
export interface RelayedMapWorld extends HostedMapWorld {
  readonly worker: RelayedMapSession;
}

/** The save a world starts from, verified on this thread: its text crosses in the world's inputs. */
export interface VerifiedStart {
  readonly text: string;
  readonly fingerprint: string;
}

/** Hand the documents to the network worker, which builds the world and serves it once its client
 *  adopted it. */
export async function hostRelayedWorld(
  host: RelayedWorldHosting,
  inputs: MapWorldDocuments,
  params: URLSearchParams,
  start: VerifiedStart | null,
): Promise<RelayedMapWorld> {
  const worker = await host(
    { ...inputs, saveText: start?.text ?? null },
    relayedSessionOptions(inputs.session, params),
    start?.fingerprint,
  );
  return {
    worker,
    host: worker.host,
    placements: worker.extras,
    matchRules: worker.matchRules,
    seed: worker.seed,
  };
}

function relayedSessionOptions(session: GameSession, params: URLSearchParams): WorkerSessionOptions {
  return {
    speed: session.speed,
    paused: false,
    // The overseer sees the whole map; a spectator's seat pick asks for its masks.
    fogSeat: isSpectator(session) ? null : localPlayerOf(session),
    diagnostics: hasDebugFlag(params, HASH_TRACE_DEBUG_FLAG),
    pauseOnSubMission: false,
  };
}

/** Free the world's renderer and its worker session. */
export function releaseRelayedWorld(world: AssembledMapWorld<RelayedMapWorld>): void {
  world.app.destroy(false, { children: true });
  world.hosted.worker.dispose();
}
