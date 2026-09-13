import type { MapsIndexProvenance } from '@open-northland/content-resolver/wire';
import type { ClientMessage, RoomView, ServerMessage } from '@open-northland/net-protocol';
import { withBaseUrl } from '../../base-url.js';
import { parseMapsIndex } from '../maps-index.js';
import { loadPersistedMap, persistedMapOrigin, persistVerifiedMap } from './cache.js';
import { decodeMapTransfer, encodeMapTransfer, mapDeliveryAllowed } from './codec.js';
import {
  loadVerifiedMapDocuments,
  readVerifiedMapDocuments,
  type VerifiedMapDocuments,
} from './documents.js';

type Upload = Omit<Extract<ClientMessage, { kind: 'blob' }>, 'kind'>;
export interface RoomMapTransferOptions {
  readonly client: { readonly nick: string; sendBlob(upload: Upload): void; requestMap(): void };
  readonly onVerified: (documents: VerifiedMapDocuments | null) => void;
  readonly onError: (error: Error) => void;
  readonly fetchImpl?: typeof fetch;
  readonly cacheRead?: typeof loadPersistedMap;
  readonly cacheWrite?: typeof persistVerifiedMap;
}

/** Retains one room's validated documents until handover; asynchronous loads cannot outlive that room. */
export function createRoomMapTransfer(options: RoomMapTransferOptions) {
  let room: RoomView | null = null;
  let prepared: VerifiedMapDocuments | null = null;
  let roomPrepared: VerifiedMapDocuments | null = null;
  let identity = '';
  let generation = 0;
  let abort: AbortController | undefined;
  let documents: VerifiedMapDocuments | null = null;
  let origin: MapsIndexProvenance | undefined;
  let locallyListed = false;
  let loaded = false;
  let loading = false;
  let encodedMap: string | undefined;
  let cacheFingerprint: string | null = null;
  let requested = false;
  let disposed = false;
  const pending = new Set<string>();
  const fetchImpl = options.fetchImpl ?? fetch;
  const reportError = (error: unknown) =>
    options.onError(error instanceof Error ? error : new Error(String(error)));
  function expectedFingerprint(): string | null {
    return room?.members.find((member) => member.nick === room?.creator)?.compatibility?.map ?? null;
  }
  function requestMissing() {
    if (
      !loaded ||
      documents !== null ||
      requested ||
      room?.state !== 'lobby' ||
      room.creator === options.client.nick ||
      expectedFingerprint() === null
    )
      return;
    if (
      !mapDeliveryAllowed({ kind: room.settings.mapOrigin ?? 'unknown' }) ||
      (locallyListed && !mapDeliveryAllowed(origin))
    ) {
      reportError(new Error('Missing map cannot be delivered from this origin'));
      requested = true;
      return;
    }
    requested = true;
    options.client.requestMap();
  }
  function sendTo(nick: string) {
    if (
      room?.state !== 'lobby' ||
      room.creator !== options.client.nick ||
      documents === null ||
      !room.members.some((member) => member.nick === nick && member.connected) ||
      nick === options.client.nick
    )
      return;
    const deliveryOrigin = origin?.kind ?? persistedMapOrigin(documents);
    if (
      (locallyListed && !mapDeliveryAllowed(origin)) ||
      (deliveryOrigin !== 'mod' && deliveryOrigin !== 'user') ||
      deliveryOrigin !== room.settings.mapOrigin
    ) {
      reportError(new Error('Local map origin does not permit delivery'));
      return;
    }
    if (documents.fingerprint !== expectedFingerprint()) return;
    encodedMap ??= encodeMapTransfer(documents, { kind: deliveryOrigin });
    options.client.sendBlob({
      type: 'map',
      to: nick,
      tick: null,
      bytes: encodedMap,
    });
  }
  function flushPending() {
    if (documents === null || documents.fingerprint !== expectedFingerprint()) return;
    for (const nick of pending) sendTo(nick);
    pending.clear();
  }
  async function load() {
    const active = ++generation;
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    documents = null;
    encodedMap = undefined;
    origin = undefined;
    locallyListed = false;
    loaded = false;
    requested = false;
    const mapId = room?.settings.world.kind === 'map' ? room.settings.world.mapId : null;
    if (mapId === null) return;
    loading = true;
    const transport: typeof fetch = (input, init) => fetchImpl(input, { ...init, signal });
    try {
      const [handle, response] = await Promise.all([
        roomPrepared?.mapId === mapId ? roomPrepared : loadVerifiedMapDocuments(mapId, transport),
        transport(withBaseUrl('/maps-index')),
      ]);
      if (!response.ok && response.status !== 404)
        throw new Error(`Cannot read map provenance: HTTP ${response.status}`);
      const index = response.ok ? parseMapsIndex(await response.json()) : [];
      if (disposed || generation !== active) return;
      const matches = index.filter((item) => item.id.toLowerCase() === mapId.toLowerCase());
      const entry = matches.find((item) => !mapDeliveryAllowed(item.provenance)) ?? matches[0];
      origin = entry?.provenance;
      locallyListed = entry !== undefined;
      let resolved = handle;
      const fingerprint = expectedFingerprint();
      const allowedOrigin = room?.settings.mapOrigin;
      cacheFingerprint = fingerprint;
      // The creator's own report is what everyone else compares against, so it reads the cache by
      // origin alone; a member needs the creator's fingerprint to accept a cached copy.
      const creator = room?.creator === options.client.nick;
      if (
        resolved === null &&
        (creator || fingerprint !== null) &&
        allowedOrigin !== undefined &&
        (!locallyListed || mapDeliveryAllowed(origin))
      ) {
        const cached = await (options.cacheRead ?? loadPersistedMap)(mapId, {
          ...(fingerprint === null ? {} : { fingerprint }),
          origin: allowedOrigin,
        });
        if (disposed || generation !== active) return;
        if (fingerprint !== expectedFingerprint()) {
          void load();
          return;
        }
        resolved = cached?.handle ?? null;
      }
      documents = resolved;
      loaded = true;
      options.onVerified(resolved);
      requestMissing();
      flushPending();
    } catch (error) {
      if (!disposed && generation === active) {
        abort?.abort();
        reportError(error);
      }
    } finally {
      if (generation === active) loading = false;
    }
  }
  return {
    prepare(handle: VerifiedMapDocuments) {
      if (!disposed) {
        readVerifiedMapDocuments(handle);
        prepared = handle;
      }
    },
    observe(next: RoomView | null) {
      if (disposed) return;
      room = next;
      if (next === null) {
        // Leaving keeps the identity and the documents prepared for it: a reconnect re-enters the
        // same room before any compatibility report exists to look the map up by.
        pending.clear();
        generation++;
        abort?.abort();
        documents = null;
        encodedMap = undefined;
        loaded = false;
        loading = false;
        return;
      }
      const key = `${next.id}:${next.creator}:${JSON.stringify(next.settings.world)}`;
      if (key !== identity) {
        identity = key;
        roomPrepared = prepared;
        prepared = null;
        pending.clear();
        generation++;
        abort?.abort();
        documents = null;
        encodedMap = undefined;
        loaded = false;
        void load();
      } else if (!loaded && !loading) {
        void load();
      } else if (loaded && documents === null && cacheFingerprint !== expectedFingerprint()) {
        void load();
      } else {
        requestMissing();
        flushPending();
      }
    },
    observeBlob(message: ServerMessage) {
      if (disposed || room?.state !== 'lobby') return;
      try {
        if (message.kind === 'mapRequest') {
          if (
            room.creator !== options.client.nick ||
            !room.members.some((member) => member.nick === message.from && member.connected)
          )
            return;
          pending.add(message.from);
          flushPending();
          return;
        }
        if (message.kind !== 'blob' || message.type !== 'map') return;
        // A retry can leave two responses in flight; the already verified documents remain authoritative.
        if (documents !== null || !loaded || !requested) return;
        if (message.from !== room.creator || message.tick !== null || room.settings.world.kind !== 'map')
          throw new Error('Unexpected map delivery');
        const fingerprint = expectedFingerprint();
        if (fingerprint === null || (locallyListed && !mapDeliveryAllowed(origin)))
          throw new Error('Map delivery is not authorized');
        const handle = decodeMapTransfer(message.bytes, {
          mapId: room.settings.world.mapId,
          fingerprint,
          provenance: { kind: room.settings.mapOrigin ?? 'unknown' },
        });
        documents = handle;
        const active = generation;
        const allowedOrigin = room.settings.mapOrigin;
        if (allowedOrigin === undefined) throw new Error('Map delivery is not authorized');
        void (options.cacheWrite ?? persistVerifiedMap)(handle, allowedOrigin)
          .then(() => {
            if (!disposed && generation === active && documents === handle) options.onVerified(handle);
          })
          .catch((error) => {
            if (!disposed && generation === active) reportError(error);
          });
      } catch (error) {
        reportError(error);
      }
    },
    retry() {
      if (!disposed && room !== null) void load();
    },
    verified() {
      return documents;
    },
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      pending.clear();
      room = null;
      documents = null;
      prepared = null;
      roomPrepared = null;
      encodedMap = undefined;
    },
  };
}
