import { afterEach, expect, it, vi } from 'vitest';
import { devRelayIdentity, relayIdentity } from '../../src/entries/relay/identity.js';

afterEach(() => vi.unstubAllGlobals());

it('keeps one reconnect token per normalized relay endpoint and the nick across them', () => {
  const storage = new Map<string, string>([['open-northland.settings', JSON.stringify({ netNick: 'Ania' })]]);
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  const trusted = relayIdentity('wss://trusted.example:443/relay', null);
  const repeat = relayIdentity('wss://TRUSTED.example/relay?room=another', null);
  const other = relayIdentity('wss://other.example/relay', null);
  const otherPath = relayIdentity('wss://trusted.example/other', null);
  expect(trusted).toEqual(repeat);
  expect(trusted.nick).toBe('Ania');
  expect(other.token).not.toBe(trusted.token);
  expect(otherPath.token).not.toBe(trusted.token);
  expect(relayIdentity('wss://trusted.example/relay', ' Bartek ').nick).toBe('Bartek');
  expect(JSON.parse(storage.get('open-northland.settings') ?? '{}').netNick).toBe('Bartek');
});

it('gives each nick the developer URL names its own token, and leaves the menu name alone', () => {
  const storage = new Map<string, string>([['open-northland.settings', JSON.stringify({ netNick: 'Ania' })]]);
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  const relay = 'ws://127.0.0.1:8765';
  const first = devRelayIdentity(relay, 'Gracz 2');
  const second = devRelayIdentity(relay, 'Gracz 3');
  expect(first.nick).toBe('Gracz 2');
  expect(second.token).not.toBe(first.token);
  expect(devRelayIdentity(relay, ' Gracz 2 ')).toEqual(first);
  expect(devRelayIdentity(relay, null)).toEqual(relayIdentity(relay, null));
  expect(JSON.parse(storage.get('open-northland.settings') ?? '{}').netNick).toBe('Ania');
});
