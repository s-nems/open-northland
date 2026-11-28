import { newToken } from '@open-northland/net-client';
import { type PlayerFlag, parseFlag, withFlag } from '@open-northland/net-protocol';
import { messages } from '../../i18n/index.js';
import { patchStoredSettings, readStoredSettings } from '../../view/settings/store.js';

const tokens = new Map<string, string>();
/** The stored `netFlag` of a player who chose to show no flag. */
const NO_FLAG = 'none';

export interface RelayIdentity {
  readonly token: string;
  readonly nick: string;
  readonly flag?: PlayerFlag;
}

/** The flag the player last chose, null for a choice of none; undefined while they never chose. */
export function storedFlag(): PlayerFlag | null | undefined {
  const { netFlag } = readStoredSettings();
  if (netFlag === NO_FLAG) return null;
  if (netFlag === null) return undefined;
  // Anything else the relay would refuse counts as no choice.
  try {
    return parseFlag({ flag: netFlag }, 'netFlag').flag;
  } catch {
    return undefined;
  }
}

/** The player's flag from now on, on every relay; none when absent. */
export function rememberFlag(flag: PlayerFlag | undefined): void {
  patchStoredSettings({ netFlag: flag ?? NO_FLAG });
}

/** A reconnect secret belongs to one relay endpoint; the display name and flag are shared across
 *  relays, and a player who never chose a name shows up under the catalog's default. */
export function relayIdentity(relayUrl: string, requestedNick: string | null): RelayIdentity {
  const stored = readStoredSettings();
  const token = storedToken(tokenKey(relayUrl));
  const nick = requestedNick?.trim() || stored.netNick || messages().net.defaultNick;
  if (nick !== stored.netNick) patchStoredSettings({ netNick: nick });
  return { token, nick, ...withFlag(storedFlag() ?? undefined) };
}

/** The developer entry's identity: a nick the URL names gets a secret of its own, so two tabs of one
 *  browser play as two people and a reload rejoins as the same one. The menu's name is left alone. */
export function devRelayIdentity(relayUrl: string, urlNick: string | null): RelayIdentity {
  const nick = urlNick?.trim() ?? '';
  if (nick.length === 0) return relayIdentity(relayUrl, null);
  return {
    token: storedToken(`${tokenKey(relayUrl)}#${nick}`),
    nick,
    ...withFlag(storedFlag() ?? undefined),
  };
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
