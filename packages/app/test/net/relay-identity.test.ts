import { afterEach, expect, it, vi } from 'vitest';
import { relayIdentity } from '../../src/entries/relay/identity.js';

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
