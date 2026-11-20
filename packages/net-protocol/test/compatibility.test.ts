import { describe, expect, it } from 'vitest';
import {
  compatibilityIssues,
  type LobbyCompatibility,
  PROTOCOL_VERSION,
  parseClientMessage,
} from '../src/index.js';

const compatibility: LobbyCompatibility = {
  content: 'a'.repeat(64),
  map: 'b'.repeat(64),
  client: 'fixture',
  version: 'dev',
  protocol: PROTOCOL_VERSION,
};

describe('lobby compatibility protocol', () => {
  it('reports all mismatches in member order against the creator, and distinguishes missing reports/maps', () => {
    expect(
      compatibilityIssues(
        [
          { nick: 'Ania', compatibility },
          { nick: 'Bartek', compatibility: { ...compatibility, content: 'c'.repeat(64), client: 'other' } },
          { nick: 'Cezary', compatibility: null },
          { nick: 'Dorota', compatibility: { ...compatibility, map: null, protocol: PROTOCOL_VERSION + 1 } },
        ],
        'Ania',
      ),
    ).toEqual([
      { nick: 'Bartek', kind: 'content', reason: 'mismatch' },
      { nick: 'Bartek', kind: 'client', reason: 'mismatch' },
      { nick: 'Cezary', kind: 'report', reason: 'missing' },
      { nick: 'Dorota', kind: 'protocol', reason: 'mismatch' },
      { nick: 'Dorota', kind: 'map', reason: 'missing' },
    ]);
  });

  it('names another release as the one issue of its member, with both versions', () => {
    const creator = { ...compatibility, version: '0.8.0' };
    const older = { ...compatibility, version: '0.7.0', content: 'c'.repeat(64), client: 'other' };
    expect(
      compatibilityIssues(
        [
          { nick: 'Ania', compatibility: creator },
          { nick: 'Bartek', compatibility: older },
        ],
        'Ania',
      ),
    ).toEqual([{ nick: 'Bartek', kind: 'version', reason: 'mismatch', version: '0.7.0', expected: '0.8.0' }]);
  });

  it('requires the creator to hold the map and speak this protocol too', () => {
    expect(
      compatibilityIssues(
        [{ nick: 'Ania', compatibility: { ...compatibility, map: null, protocol: 0 } }],
        'Ania',
      ),
    ).toEqual([
      { nick: 'Ania', kind: 'protocol', reason: 'mismatch' },
      { nick: 'Ania', kind: 'map', reason: 'missing' },
    ]);
  });

  it.each([
    { ...compatibility, content: 'not-a-hash' },
    { ...compatibility, map: 'B'.repeat(64) },
    { ...compatibility, client: 'a\nb' },
    { ...compatibility, client: ' ' },
    { ...compatibility, client: 'x'.repeat(129) },
    { ...compatibility, version: undefined },
    { ...compatibility, version: '0.8\n0' },
    { ...compatibility, protocol: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects malformed or unbounded compatibility fields: %j', (report) => {
    expect(() => parseClientMessage({ kind: 'setCompatibility', compatibility: report })).toThrow();
  });

  it('accepts a missing map and an explicit invalidation report', () => {
    const missing = { kind: 'setCompatibility', compatibility: { ...compatibility, map: null } };
    expect(parseClientMessage(missing)).toEqual(missing);
    expect(parseClientMessage({ kind: 'setCompatibility', compatibility: null })).toEqual({
      kind: 'setCompatibility',
      compatibility: null,
    });
  });
});
