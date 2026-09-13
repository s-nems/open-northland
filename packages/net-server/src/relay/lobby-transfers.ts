import { createHash } from 'node:crypto';
import type { RoomSettings } from '@open-northland/net-protocol';
import { type BlobUpload, relayBlob } from './blob-relay.js';
import type { CachedSnapshot } from './catch-up.js';
import { broadcast, type Deliver, type Member, type Refusal } from './member.js';

export class LobbyTransfers {
  private snapshot: CachedSnapshot | null = null;
  private readonly mapRequests = new WeakMap<Member, number>();
  private readonly saveRequests = new WeakMap<Member, number>();

  constructor(
    private readonly settings: RoomSettings,
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
    return this.settings.initialSave !== undefined && this.snapshot === null
      ? `${this.creator()?.nick ?? 'creator'}: initial save upload missing`
      : null;
  }

  upload(member: Member, upload: BlobUpload): Refusal {
    if (upload.type !== 'map' && upload.type !== 'initialSave') return 'the game has not started';
    if (member !== this.creator()) return 'only the creator supplies lobby files';
    if (upload.type === 'map') {
      if (this.settings.mapOrigin === undefined) return 'this room does not permit map delivery';
      if (upload.tick !== null) return 'a map upload has no tick';
      return relayBlob(this.members.values(), this.deliver, member, upload);
    }
    const identity = this.settings.initialSave;
    if (identity === undefined) return 'the room does not start from a save';
    if (upload.to !== null) return 'the initial save is shared with the whole room';
    if (upload.tick !== identity.tick) return 'initial save tick mismatch';
    if (createHash('sha256').update(upload.bytes).digest('hex') !== identity.fingerprint) {
      return 'initial save fingerprint mismatch';
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
    if (this.settings.initialSave === undefined) return 'the room does not start from a save';
    const snapshot = this.snapshot;
    if (snapshot === null) return this.readyRefusal();
    if (this.tooSoon(this.saveRequests, member, now)) return 'initial save retry is too soon';
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
    if (last !== undefined && now - last < 2000) return true;
    requests.set(member, now);
    return false;
  }

  requestMap(member: Member, now: number): Refusal {
    if (this.settings.mapOrigin === undefined) return 'this room does not permit map delivery';
    const creator = this.creator();
    if (creator === null || !creator.connected) return 'the map provider is not connected';
    if (creator === member) return 'the creator supplies the map';
    if (this.tooSoon(this.mapRequests, member, now)) return 'map retry is too soon';
    this.deliver(creator, { kind: 'mapRequest', from: member.nick });
    return null;
  }
}
