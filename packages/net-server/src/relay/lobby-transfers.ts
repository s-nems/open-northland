import { createHash } from 'node:crypto';
import type { RoomSettings } from '@open-northland/net-protocol';
import { type BlobUpload, relayBlob } from './blob-relay.js';
import type { CachedSnapshot } from './catch-up.js';
import { broadcast, type Deliver, type Member, type Refusal } from './member.js';

/** One member's map or initial-save request is answered at most this often, bounding a small
 *  request's large response. */
const REQUEST_COOLDOWN_MS = 2000;

export class LobbyTransfers {
  private snapshot: CachedSnapshot | null = null;
  private readonly mapRequests = new WeakMap<Member, number>();
  private readonly saveRequests = new WeakMap<Member, number>();

  constructor(
    private readonly settings: () => RoomSettings,
    private readonly members: ReadonlyMap<string, Member>,
    private readonly creator: () => Member | null,
    private readonly deliver: Deliver,
  ) {}

  get initialSave(): CachedSnapshot | null {
    return this.snapshot;
  }

  release(): void {
    this.snapshot = null;
  }

  readyRefusal(): Refusal {
    return this.settings().initialSave !== undefined && this.snapshot === null
      ? { code: 'initialSaveMissing' }
      : null;
  }

  upload(member: Member, upload: BlobUpload): Refusal {
    if (upload.type !== 'map' && upload.type !== 'initialSave') return { code: 'gameNotStarted' };
    if (member !== this.creator()) return { code: 'creatorOnly' };
    if (upload.type === 'map') {
      if (this.settings().mapOrigin === undefined) return { code: 'mapDeliveryOff' };
      if (upload.tick !== null) return { code: 'mapUploadHasTick' };
      return relayBlob(this.members.values(), this.deliver, member, upload);
    }
    const identity = this.settings().initialSave;
    if (identity === undefined) return { code: 'notFromSave' };
    if (upload.to !== null) return { code: 'initialSaveForEveryone' };
    if (upload.tick !== identity.tick) return { code: 'initialSaveTickMismatch' };
    if (createHash('sha256').update(upload.bytes).digest('hex') !== identity.fingerprint) {
      return { code: 'initialSaveFingerprintMismatch' };
    }
    this.snapshot = { tick: identity.tick, from: member.nick, bytes: upload.bytes };
    broadcast(this.members.values(), this.deliver, {
      kind: 'blob',
      type: 'initialSave',
      from: member.nick,
      tick: identity.tick,
      bytes: upload.bytes,
    });
    return null;
  }

  requestInitialSave(member: Member, now: number): Refusal {
    if (this.settings().initialSave === undefined) return { code: 'notFromSave' };
    const snapshot = this.snapshot;
    if (snapshot === null) return this.readyRefusal();
    if (this.tooSoon(this.saveRequests, member, now)) return { code: 'retryTooSoon' };
    this.deliver(member, {
      kind: 'blob',
      type: 'initialSave',
      from: snapshot.from,
      tick: snapshot.tick,
      bytes: snapshot.bytes,
    });
    return null;
  }

  private tooSoon(requests: WeakMap<Member, number>, member: Member, now: number): boolean {
    const last = requests.get(member);
    if (last !== undefined && now - last < REQUEST_COOLDOWN_MS) return true;
    requests.set(member, now);
    return false;
  }

  requestMap(member: Member, now: number): Refusal {
    if (this.settings().mapOrigin === undefined) return { code: 'mapDeliveryOff' };
    const creator = this.creator();
    if (creator === null || !creator.connected) return { code: 'mapProviderAway' };
    if (creator === member) return { code: 'creatorHasMap' };
    if (this.tooSoon(this.mapRequests, member, now)) return { code: 'retryTooSoon' };
    this.deliver(creator, { kind: 'mapRequest', from: member.nick });
    return null;
  }
}
