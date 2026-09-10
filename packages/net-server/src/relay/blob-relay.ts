import type { BlobType, ServerMessage } from '@open-northland/net-protocol';
import type { Deliver, Member, Refusal } from './member.js';

export interface BlobUpload {
  readonly type: BlobType;
  readonly to: string | null;
  readonly tick: number | null;
  readonly bytes: string;
}

/** Hand a blob to the member `to` names, or to everyone but the sender. One message object, so the
 *  host serialises it once. */
export function relayBlob(
  members: Iterable<Member>,
  deliver: Deliver,
  sender: Member,
  upload: BlobUpload,
): Refusal {
  const message: ServerMessage = {
    kind: 'blob',
    type: upload.type,
    from: sender.nick,
    tick: upload.tick,
    bytes: upload.bytes,
  };
  if (upload.to === null) {
    for (const member of members) {
      if (member.connected && member !== sender) deliver(member, message);
    }
    return null;
  }
  for (const member of members) {
    if (member.nick === upload.to) {
      deliver(member, message);
      return null;
    }
  }
  return `no ${upload.to} in the room`;
}
