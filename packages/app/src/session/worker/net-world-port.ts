import type { GameSession, InitialSaveSeatSetup } from '@open-northland/lockstep';
import { decodeSnapshot, type OpenedWorld, type WorldPort } from '@open-northland/net-client';
import type { SaveGame, Simulation } from '@open-northland/sim';
import type { FromNetWorker, RelayedWorldAnswer } from './net-protocol.js';
import type { WorkerSessionOptions } from './protocol.js';
import type { BuiltWorld, ReplaySource } from './serve.js';

/** A relayed world as built, with the generation its acknowledgements carry. Its driver is the relay
 *  client's, which `serve` supplies, so the build carries only the sim and its recording footing. */
export interface RelayedBuild<E> extends BuiltWorld<E> {
  readonly generation: number;
  readonly initialSeatSetups?: readonly InitialSaveSeatSetup[];
  /** Where the session's own replay capture reads its start. */
  readonly replaySource?: ReplaySource;
}

/** Builds a relayed world from the runtime's inputs, or restores it from a snapshot the relay served;
 *  the snapshot crosses as the compressed bytes it arrived as, so the restore records from them
 *  without holding a serialization of it for the session. */
export type RelayedWorldBuilder<B, E> = (
  boot: B,
  snapshot: SaveGame | null,
  snapshotBytes: string | null,
) => RelayedBuild<E>;

/** A world built for the client and not yet adopted: what serving it takes beside the sim. */
export interface CandidateWorld<E> {
  readonly requestId: number;
  readonly extras: E;
  readonly options: WorkerSessionOptions;
  readonly buildMs: number;
}

interface PendingRequest {
  readonly snapshot: SaveGame | null;
  readonly snapshotBytes: string | null;
  resolve(world: OpenedWorld | null): void;
  reject(error: unknown): void;
}

/**
 * The worker client's world port: each world it asks for is a request the runtime answers with the
 * inputs it assembled its presentation from, and the worker builds the sim from them here. A snapshot
 * is decoded here; only its header crosses.
 */
export class RelayedWorldPort<B, E> implements WorldPort {
  private nextRequestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly candidates = new Map<Simulation, CandidateWorld<E>>();
  private disposed = false;

  constructor(
    private readonly post: (message: FromNetWorker<E>) => void,
    private readonly build: RelayedWorldBuilder<B, E>,
  ) {}

  open(session: GameSession, snapshotTick: number | null): Promise<OpenedWorld | null> {
    return this.request(null, null, (requestId) => ({
      kind: 'openWorld',
      requestId,
      session,
      snapshotTick,
    }));
  }

  async restore(session: GameSession, bytes: string): Promise<OpenedWorld | null> {
    if (this.disposed) return null;
    const snapshot = await decodeSnapshot(bytes);
    const { tick, mapId, view } = snapshot.header;
    // The compressed bytes ride beside the parsed save; the capture decodes them when it composes
    // its recording, instead of holding a text serialization for the whole session.
    return this.request(snapshot, bytes, (requestId) => ({
      kind: 'restoreWorld',
      requestId,
      session,
      header: { tick, mapId, view },
    }));
  }

  answer(requestId: number, answer: RelayedWorldAnswer<B> | null): void {
    const request = this.take(requestId);
    if (request === undefined) return;
    if (answer === null) {
      request.resolve(null);
      return;
    }
    const startMs = performance.now();
    let built: RelayedBuild<E>;
    try {
      built = this.build(answer.boot, request.snapshot, request.snapshotBytes);
    } catch (err) {
      request.reject(err);
      this.post({ kind: 'unadopted', requestId });
      return;
    }
    const { sim } = built;
    const candidate: CandidateWorld<E> = {
      requestId,
      extras: built.extras,
      options: answer.options,
      buildMs: performance.now() - startMs,
    };
    this.candidates.set(sim, candidate);
    request.resolve({
      sim,
      generation: built.generation,
      ...(built.initialSeatSetups === undefined ? {} : { initialSeatSetups: built.initialSeatSetups }),
      ...(built.replaySource === undefined ? {} : { replaySource: built.replaySource }),
      ...(answer.initialSaveFingerprint === undefined
        ? {}
        : { initialSaveFingerprint: answer.initialSaveFingerprint }),
    });
    // The client adopts a world in the microtasks that follow its port's answer, or not at all.
    setTimeout(() => {
      if (this.candidates.get(sim) !== candidate) return;
      this.candidates.delete(sim);
      this.post({ kind: 'unadopted', requestId });
    }, 0);
  }

  fail(requestId: number, error: Error): void {
    this.take(requestId)?.reject(error);
  }

  /** What serving the adopted `sim` takes; undefined for a world this port did not build. */
  adopt(sim: Simulation): CandidateWorld<E> | undefined {
    const candidate = this.candidates.get(sim);
    this.candidates.delete(sim);
    return candidate;
  }

  /** The connection ended: every open request is refused. */
  dispose(): void {
    this.disposed = true;
    for (const request of this.pending.values()) request.resolve(null);
    this.pending.clear();
    this.candidates.clear();
  }

  private request(
    snapshot: SaveGame | null,
    snapshotBytes: string | null,
    message: (requestId: number) => FromNetWorker<E>,
  ): Promise<OpenedWorld | null> {
    if (this.disposed) return Promise.resolve(null);
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { snapshot, snapshotBytes, resolve, reject });
      this.post(message(requestId));
    });
  }

  private take(requestId: number): PendingRequest | undefined {
    const request = this.pending.get(requestId);
    this.pending.delete(requestId);
    return request;
  }
}
