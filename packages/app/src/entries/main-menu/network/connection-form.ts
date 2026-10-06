import { MAX_NICK_LENGTH } from '@open-northland/net-protocol';
import { quietTextField } from '../../../hud/dom/parts/text-field.js';
import { messages } from '../../../i18n/index.js';
import { patchStoredSettings, readStoredSettings } from '../../../view/settings-store.js';
import { node } from '../dom.js';
import { relayAddress } from './model.js';
import { button, field } from './parts.js';
import { DEFAULT_RELAY_URL } from './relay-default.js';

export function connectionForm(initialAddress: string | null, onDisconnect: () => void) {
  const copy = messages().network;
  const address = node('input');
  address.type = 'text';
  quietTextField(address);
  address.value = initialAddress ?? readStoredSettings().netRelayUrl ?? DEFAULT_RELAY_URL;
  const rememberAddress = (): void => {
    if (relayAddress(address.value) !== null) patchStoredSettings({ netRelayUrl: address.value.trim() });
  };
  address.addEventListener('change', rememberAddress);
  const nick = quietTextField(node('input'));
  nick.value = readStoredSettings().netNick ?? '';
  nick.maxLength = MAX_NICK_LENGTH;
  nick.required = true;
  nick.setAttribute('autocomplete', 'nickname');
  const form = node('form', 'network-menu__connection');
  const serverName = node('p', 'network-menu__eyebrow');
  const describeServer = (): void => {
    serverName.textContent =
      address.value.trim() === DEFAULT_RELAY_URL ? copy.officialServer : copy.customServer;
  };
  address.addEventListener('input', describeServer);
  describeServer();
  const intro = node('div', 'network-menu__intro');
  intro.append(node('h2', '', copy.welcome), serverName);
  const advanced = node('details', 'network-menu__advanced');
  advanced.open = address.value !== DEFAULT_RELAY_URL;
  const resetServer = button(copy.resetServer, () => {
    address.value = DEFAULT_RELAY_URL;
    describeServer();
    rememberAddress();
  });
  advanced.append(
    node('summary', '', copy.advanced),
    node('p', 'network-menu__muted', copy.serverHint),
    field(copy.server, address),
    resetServer,
  );
  const account = node('div', 'network-menu__account');
  const accountName = node('strong');
  const connect = node('button', 'main-menu__primary', copy.connect);
  connect.type = 'submit';
  const disconnect = button(copy.disconnect, onDisconnect);
  form.append(intro, field(copy.nick, nick), connect, advanced);
  account.append(accountName, disconnect);
  return {
    form,
    account,
    accountName,
    address,
    nick,
    advanced,
    resetServer,
    connect,
    disconnect,
    rememberAddress,
  };
}
