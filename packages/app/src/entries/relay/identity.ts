import { newToken } from '@open-northland/net-client';
import { patchStoredSettings, readStoredSettings } from '../../view/settings-store.js';

/** The display name a player who never chose one shows up as. */
const DEFAULT_NICK = 'Gracz';

export interface RelayIdentity {
  readonly token: string;
  readonly nick: string;
}

/** The stored identity, minted on first use; a `?nick=` in the search becomes the stored name. */
export function relayIdentity(params: URLSearchParams): RelayIdentity {
  const stored = readStoredSettings();
  const token = stored.netToken ?? newToken();
  const nick = params.get('nick')?.trim() || stored.netNick || DEFAULT_NICK;
  if (token !== stored.netToken || nick !== stored.netNick)
    patchStoredSettings({ netToken: token, netNick: nick });
  return { token, nick };
}
