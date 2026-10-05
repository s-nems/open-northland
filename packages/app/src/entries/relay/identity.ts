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
  const token = storedToken(tokenKey(relayUrl));
  const nick = requestedNick?.trim() || stored.netNick || messages().net.defaultNick;
  if (nick !== stored.netNick) patchStoredSettings({ netNick: nick });
  return { token, nick };
}

/** The developer entry's identity: a nick the URL names gets a secret of its own, so two tabs of one
 *  browser play as two people and a reload rejoins as the same one. The menu's name is left alone. */
export function devRelayIdentity(relayUrl: string, urlNick: string | null): RelayIdentity {
  const nick = urlNick?.trim() ?? '';
  if (nick.length === 0) return relayIdentity(relayUrl, null);
  return { token: storedToken(`${tokenKey(relayUrl)}#${nick}`), nick };
}

function tokenKey(relayUrl: string): string {
  const url = new URL(relayUrl);
  return `open-northland.relay-token:${url.origin}${url.pathname}`;
}

function storedToken(key: string): string {
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
  return token;
}
