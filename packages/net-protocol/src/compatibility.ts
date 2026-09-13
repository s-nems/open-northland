import type { RoomMemberView } from './messages.js';
import { PROTOCOL_VERSION } from './version.js';

export interface LobbyCompatibility {
  readonly content: string;
  readonly map: string | null;
  readonly client: string;
  readonly protocol: number;
  readonly save?: string | null;
}

export interface CompatibilityIssue {
  readonly nick: string;
  readonly kind: 'report' | 'content' | 'map' | 'client' | 'protocol' | 'save';
  readonly reason: 'missing' | 'mismatch';
}

/** The creator is the reference for locally generated content, map bytes and client build. */
export function compatibilityIssues(
  members: readonly Pick<RoomMemberView, 'nick' | 'compatibility'>[],
  creator: string,
  initialSave?: { readonly fingerprint: string },
): readonly CompatibilityIssue[] {
  const reference = members.find((member) => member.nick === creator)?.compatibility;
  const issues: CompatibilityIssue[] = [];
  for (const member of members) {
    const report = member.compatibility;
    if (report === null) {
      issues.push({ nick: member.nick, kind: 'report', reason: 'missing' });
      continue;
    }
    const expectedSave = initialSave?.fingerprint ?? null;
    if ((report.save ?? null) !== expectedSave) {
      issues.push({ nick: member.nick, kind: 'save', reason: report.save == null ? 'missing' : 'mismatch' });
    }
    if (report.protocol !== PROTOCOL_VERSION) {
      issues.push({ nick: member.nick, kind: 'protocol', reason: 'mismatch' });
    }
    if (report.map === null) issues.push({ nick: member.nick, kind: 'map', reason: 'missing' });
    if (reference === null || reference === undefined) continue;
    for (const kind of ['content', 'map', 'client'] as const) {
      if (kind === 'map' && (report.map === null || reference.map === null)) continue;
      if (report[kind] !== reference[kind]) issues.push({ nick: member.nick, kind, reason: 'mismatch' });
    }
  }
  return issues;
}

export function sameCompatibility(a: LobbyCompatibility | null, b: LobbyCompatibility | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.content === b.content &&
    a.map === b.map &&
    a.client === b.client &&
    a.protocol === b.protocol &&
    (a.save ?? null) === (b.save ?? null)
  );
}
