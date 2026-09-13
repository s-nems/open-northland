import { newToken } from '@open-northland/net-client';
import { patchStoredSettings, readStoredSettings } from '../../view/settings-store.js';

/** The display name a player who never chose one shows up as. */
const DEFAULT_NICK = 'Gracz';
const tokens = new Map<string, string>();

export interface RelayIdentity {
  readonly token: string;
  readonly nick: string;
}

/** A reconnect secret belongs to one relay endpoint; the display name is shared across relays. */
export function relayIdentity(params: URLSearchParams, relayUrl: string): RelayIdentity {
  const stored = readStoredSettings();
  const url = new URL(relayUrl);
  const key = `open-northland.relay-token:${url.origin}${url.pathname}`;
  let token = tokens.get(key);
  try {
    token ??= window.localStorage.getItem(key) ?? undefined;
  } catch {
    // Storage denial still permits reconnects within this document.
  }
  token ??= newToken();
  tokens.set(key, token);
  try {
    window.localStorage.setItem(key, token);
  } catch {
    // The document keeps the identity when storage is unavailable.
  }
  const nick = params.get('nick')?.trim() || stored.netNick || DEFAULT_NICK;
  if (stored.netToken !== null || nick !== stored.netNick)
    patchStoredSettings({ netToken: null, netNick: nick });
  return { token, nick };
}
