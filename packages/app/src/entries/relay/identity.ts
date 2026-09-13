import { newToken } from '@open-northland/net-client';
import { messages } from '../../i18n/index.js';
import { patchStoredSettings, readStoredSettings } from '../../view/settings-store.js';

const tokens = new Map<string, string>();

export interface RelayIdentity {
  readonly token: string;
  readonly nick: string;
}

/** A reconnect secret belongs to one relay endpoint; the display name is shared across relays, and a
 *  player who never chose one shows up under the catalog's default. */
export function relayIdentity(relayUrl: string, requestedNick: string | null): RelayIdentity {
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
  const nick = requestedNick?.trim() || stored.netNick || messages().net.defaultNick;
  if (nick !== stored.netNick) patchStoredSettings({ netNick: nick });
  return { token, nick };
}
