import type { GameSession } from '@open-northland/lockstep';
import { decodeSnapshot, type OpenedWorld, type WorldPort } from '@open-northland/net-client';
import type { SaveGame, Simulation } from '@open-northland/sim';
import type { FromNetWorker, RelayedWorldAnswer } from './net-protocol.js';
import type { WorkerSessionOptions } from './protocol.js';
import type { BuiltWorld } from './serve.js';

/** A relayed world as built, with the generation its acknowledgements carry. */
export interface RelayedBuild<E> extends BuiltWorld<E> {
  readonly generation: number;
}

/** Builds a relayed world from the runtime's inputs, or restores it from a snapshot the relay served. */
export type RelayedWorldBuilder<B, E> = (boot: B, snapshot: SaveGame | null) => RelayedBuild<E>;

/** A world built for the client and not yet adopted: what serving it takes beside the sim. */
export interface CandidateWorld<E> {
  readonly requestId: number;
  readonly extras: E;
  readonly options: WorkerSessionOptions;
  readonly buildMs: number;
}

interface PendingRequest {
  readonly snapshot: SaveGame | null;
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

  constructor(
    private readonly post: (message: FromNetWorker<E>) => void,
    private readonly build: RelayedWorldBuilder<B, E>,
  ) {}

  open(session: GameSession, snapshotTick: number | null): Promise<OpenedWorld | null> {
    return this.request(null, (requestId) => ({ kind: 'openWorld', requestId, session, snapshotTick }));
  }

  async restore(session: GameSession, bytes: string): Promise<OpenedWorld | null> {
    const snapshot = await decodeSnapshot(bytes);
    const { tick, mapId } = snapshot.header;
    return this.request(snapshot, (requestId) => ({
      kind: 'restoreWorld',
      requestId,
      session,
      header: { tick, mapId },
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
      built = this.build(answer.boot, request.snapshot);
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
    for (const request of this.pending.values()) request.resolve(null);
    this.pending.clear();
    this.candidates.clear();
  }

  private request(
    snapshot: SaveGame | null,
    message: (requestId: number) => FromNetWorker<E>,
  ): Promise<OpenedWorld | null> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { snapshot, resolve, reject });
      this.post(message(requestId));
    });
  }

  private take(requestId: number): PendingRequest | undefined {
    const request = this.pending.get(requestId);
    this.pending.delete(requestId);
    return request;
  }
}
