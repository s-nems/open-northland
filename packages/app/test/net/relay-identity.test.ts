import { afterEach, expect, it, vi } from 'vitest';
import { relayIdentity } from '../../src/entries/relay/identity.js';

afterEach(() => vi.unstubAllGlobals());

it('keeps reconnect tokens per normalized relay endpoint and never reuses the legacy global secret', () => {
  const storage = new Map<string, string>([
    ['open-northland.settings', JSON.stringify({ netToken: 'legacy-global-secret', netNick: 'Ania' })],
  ]);
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  const params = new URLSearchParams();
  const trusted = relayIdentity(params, 'wss://trusted.example:443/relay');
  const repeat = relayIdentity(params, 'wss://TRUSTED.example/relay?room=another');
  const other = relayIdentity(params, 'wss://other.example/relay');
  const otherPath = relayIdentity(params, 'wss://trusted.example/other');
  expect(trusted).toEqual(repeat);
  expect(trusted.nick).toBe('Ania');
  expect(trusted.token).not.toBe('legacy-global-secret');
  expect(other.token).not.toBe(trusted.token);
  expect(otherPath.token).not.toBe(trusted.token);
  expect(JSON.parse(storage.get('open-northland.settings') ?? '{}').netToken).toBeNull();
});
