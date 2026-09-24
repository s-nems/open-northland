import type { SessionRules } from '@open-northland/lockstep';
import type { LobbySettings } from './messages.js';
import { keysOf } from './untrusted.js';

// Every field is listed, so a setting added to either type fails to compile until it is compared.
const LOBBY_FIELDS = keysOf<Exclude<keyof LobbySettings, 'rules'>>({
  name: true,
  seed: true,
  speed: true,
  kickedSeatMode: true,
});
const RULE_FIELDS = keysOf<keyof SessionRules>({ fog: true, progression: true, needs: true });

export function sameSessionRules(a: SessionRules, b: SessionRules): boolean {
  return RULE_FIELDS.every((field) => a[field] === b[field]);
}

export function sameLobbySettings(a: LobbySettings, b: LobbySettings): boolean {
  return LOBBY_FIELDS.every((field) => a[field] === b[field]) && sameSessionRules(a.rules, b.rules);
}
