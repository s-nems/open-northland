import type { GameSession } from '@open-northland/lockstep';
import type { LobbyAction, TickDigest } from '@open-northland/net-client';
import type { ServerMessage } from '@open-northland/net-protocol';
import type { SaveGame } from '@open-northland/sim';
import type { FromWorker, ToWorker, WireError, WorkerSessionOptions } from './protocol.js';

/**
 * The messages between the runtime and the network worker, which owns one relay connection, its client
 * and the world that client adopts. The adopted world is served with the session protocol; everything
 * else here is the connection's.
 */

export type LinkState = 'ok' | 'reconnecting' | 'closed';

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
  | { readonly method: 'shareSave'; readonly to: string | null; readonly save: SaveGame };

/** The session protocol's messages, minus the boot a world request replaces. */
type SessionMessage = Exclude<ToWorker<never>, { readonly kind: 'boot' }>;

export type ToNetWorker<B> =
  | SessionMessage
  | { readonly kind: 'connect'; readonly url: string; readonly token: string; readonly nick: string }
  | { readonly kind: 'lobby'; readonly name: LobbyAction; readonly args: readonly unknown[] }
  | { readonly kind: 'clock'; readonly paused?: boolean; readonly speed?: number }
  /** End the connection; `leave` gives a seat in a started game up first. */
  | { readonly kind: 'leave'; readonly leave: boolean }
  /** The link dropped: the client is no longer welcomed, and `left` leaves a lobby room it sat in. */
  | { readonly kind: 'reset'; readonly left: boolean }
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
  | { readonly kind: 'failure'; readonly what: string; readonly error: WireError }
  | { readonly kind: 'warning'; readonly message: string }
  | { readonly kind: 'answer'; readonly id: number; readonly ok: true; readonly value: RelayAnswer }
  | { readonly kind: 'answer'; readonly id: number; readonly ok: false; readonly error: WireError }
  /** The connection ended after a `leave`; the worker closes itself. */
  | { readonly kind: 'closed' };

export interface RestoredHeader {
  readonly tick: number;
  readonly mapId: string | null;
}

export type RelayAnswer = readonly TickDigest[] | null;
