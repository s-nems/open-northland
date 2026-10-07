import type { GameSession } from '@open-northland/lockstep';
import {
  type CompressedSave,
  type DisputeRecord,
  type LobbyAction,
  RelayRefusal,
  type TickDigest,
} from '@open-northland/net-client';
import type { RelayReason, ResponsivenessMode, ServerMessage } from '@open-northland/net-protocol';
import {
  errorFromWire,
  type FromWorker,
  type ToWorker,
  type WireError,
  type WorkerSessionOptions,
  wireError,
} from './protocol.js';

/**
 * The messages between the runtime and the network worker, which owns one relay connection, its client
 * and the world that client adopts. The adopted world is served with the session protocol; everything
 * else here is the connection's.
 */

export type LinkState = 'ok' | 'reconnecting' | 'closed';

/** A client failure as it crosses; a relay refusal keeps its coded reason so the page can word it. */
export type WireFailure = WireError & { readonly refusal?: RelayReason };

export function wireFailure(error: unknown): WireFailure {
  const wire = wireError(error);
  return error instanceof RelayRefusal ? { ...wire, refusal: error.reason } : wire;
}

export function failureFromWire(wire: WireFailure): Error {
  if (wire.refusal === undefined) return errorFromWire(wire);
  const refusal = new RelayRefusal(wire.refusal);
  if (wire.stack !== undefined) refusal.stack = wire.stack;
  return refusal;
}

/** What only the worker's client knows, posted with every tick batch and whenever one changes. */
export interface RelayFacts {
  readonly tick: number | null;
  readonly paused: boolean;
  readonly speed: number;
  readonly bufferedTicks: number;
  readonly droppedTicks: number;
  readonly clickToApplyMs: number | null;
  readonly resultTick: number | null;
  readonly endedTick: number | null;
  readonly isOutOfSync: boolean;
  readonly worldId: number | null;
}

/** The world the runtime assembled for a world request: the inputs the worker builds the sim from. */
export interface RelayedWorldAnswer<B> {
  readonly boot: B;
  readonly options: WorkerSessionOptions;
  /** The verified initial save's fingerprint, when the world starts from it. */
  readonly initialSaveFingerprint?: string;
}

export type RelayRequest =
  | { readonly method: 'digests' }
  | { readonly method: 'dispute' }
  | { readonly method: 'shareSave'; readonly to: string | null; readonly save: CompressedSave };

/** The session protocol's messages, minus the boot a world request replaces. */
type SessionMessage = Exclude<ToWorker<never>, { readonly kind: 'boot' }>;

export type ToNetWorker<B> =
  | SessionMessage
  | { readonly kind: 'connect'; readonly url: string; readonly token: string; readonly nick: string }
  | { readonly kind: 'lobby'; readonly name: LobbyAction; readonly args: readonly unknown[] }
  | { readonly kind: 'clock'; readonly paused?: boolean; readonly speed?: number }
  /** The runtime has shown the world numbered `worldId`: the client may report it loaded. */
  | { readonly kind: 'shown'; readonly worldId: number }
  | { readonly kind: 'responsiveness'; readonly mode: ResponsivenessMode }
  /** End the connection; `leave` gives a seat in a started game up first. */
  | { readonly kind: 'leave'; readonly leave: boolean }
  /** The answer to a world request; null refuses it. */
  | { readonly kind: 'worldInputs'; readonly requestId: number; readonly world: RelayedWorldAnswer<B> | null }
  | { readonly kind: 'worldFailed'; readonly requestId: number; readonly error: WireError }
  | { readonly kind: 'request'; readonly id: number; readonly request: RelayRequest };

export type FromNetWorker<E> =
  | FromWorker<E>
  /** A relay message, after the worker's client acted on it. */
  | { readonly kind: 'message'; readonly message: ServerMessage }
  | { readonly kind: 'link'; readonly state: LinkState; readonly reason?: string }
  | { readonly kind: 'facts'; readonly facts: RelayFacts }
  | {
      readonly kind: 'openWorld';
      readonly requestId: number;
      readonly session: GameSession;
      readonly snapshotTick: number | null;
    }
  /** A snapshot the relay served, decoded in the worker; the runtime assembles around its header. */
  | {
      readonly kind: 'restoreWorld';
      readonly requestId: number;
      readonly session: GameSession;
      readonly header: RestoredHeader;
    }
  /** The answered request's world was built but not adopted: it failed to build, or the client moved
   *  on. No `ready` follows. */
  | { readonly kind: 'unadopted'; readonly requestId: number }
  /** The client could not open a world, check a result or send a command. */
  | { readonly kind: 'failure'; readonly what: string; readonly error: WireFailure }
  | { readonly kind: 'warning'; readonly message: string }
  | { readonly kind: 'answer'; readonly id: number; readonly ok: true; readonly value: RelayAnswer }
  | { readonly kind: 'answer'; readonly id: number; readonly ok: false; readonly error: WireFailure }
  /** The connection ended after a `leave`; the worker closes itself. */
  | { readonly kind: 'closed' };

export interface RestoredHeader {
  readonly tick: number;
  readonly mapId: string | null;
}

export type RelayAnswer = readonly TickDigest[] | DisputeRecord | null;

/** The answer a request's method yields; the wire carries the {@link RelayAnswer} union. */
export type RelayAnswerFor<R extends RelayRequest> = R extends { readonly method: 'digests' }
  ? readonly TickDigest[]
  : R extends { readonly method: 'dispute' }
    ? DisputeRecord | null
    : null;
