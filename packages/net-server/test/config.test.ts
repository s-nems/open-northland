import { DEFAULT_MAX_ROOMS, DEFAULT_PORT, relayConfigFromEnvironment } from '@open-northland/net-server';
import { describe, expect, it } from 'vitest';

describe('relay configuration from the environment', () => {
  it('defaults everything a deployment did not set', () => {
    expect(relayConfigFromEnvironment({})).toEqual({
      port: DEFAULT_PORT,
      host: null,
      publicUrl: null,
      maxRooms: DEFAULT_MAX_ROOMS,
      build: null,
    });
    expect(relayConfigFromEnvironment({ PORT: '', RELAY_BUILD: '  ' })).toEqual(
      relayConfigFromEnvironment({}),
    );
  });

  it('reads what is set and normalises the public URL', () => {
    expect(
      relayConfigFromEnvironment({
        PORT: '9000',
        HOST: '127.0.0.1',
        RELAY_PUBLIC_URL: 'wss://relay.example.org',
        RELAY_MAX_ROOMS: '8',
        RELAY_BUILD: 'abc1234',
      }),
    ).toEqual({
      port: 9000,
      host: '127.0.0.1',
      publicUrl: 'wss://relay.example.org/',
      maxRooms: 8,
      build: 'abc1234',
    });
  });

  it('refuses a value the relay could not run with, by name', () => {
    expect(() => relayConfigFromEnvironment({ PORT: '70000' })).toThrow(/PORT must be an integer/);
    expect(() => relayConfigFromEnvironment({ PORT: '80x' })).toThrow(/PORT/);
    expect(() => relayConfigFromEnvironment({ RELAY_MAX_ROOMS: '0' })).toThrow(/RELAY_MAX_ROOMS/);
    expect(() => relayConfigFromEnvironment({ RELAY_PUBLIC_URL: 'https://relay.example.org' })).toThrow(
      /RELAY_PUBLIC_URL must be a ws:\/\/ or wss:\/\/ URL/,
    );
    expect(() => relayConfigFromEnvironment({ RELAY_PUBLIC_URL: 'not a url' })).toThrow(/RELAY_PUBLIC_URL/);
  });
});
