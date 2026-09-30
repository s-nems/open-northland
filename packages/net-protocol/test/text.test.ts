import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseServerMessage } from '../src/index.js';

const parseServer = (value: unknown) =>
  parseServerMessage(value, () => {
    throw new Error('unexpected descriptor');
  });

describe('printable wire lines', () => {
  it.each(['\u2028', '\u2029'])('refuses Unicode line separator %j in chat and nicks', (separator) => {
    const text = `Ania${separator}Bartek`;
    expect(() => parseClientMessage({ kind: 'chat', text })).toThrow(/one printable line/);
    expect(() => parseServer({ kind: 'chat', from: 'Ania', text })).toThrow(/one printable line/);
    expect(() =>
      parseClientMessage({ kind: 'hello', protocol: 1, token: 'abcdefghijklmnop', nick: text }),
    ).toThrow(/one printable line/);
    expect(() => parseServer({ kind: 'welcome', protocol: 1, nick: text })).toThrow(/one printable line/);
  });

  it('trims ordinary surrounding whitespace and preserves accented and astral characters', () => {
    expect(parseClientMessage({ kind: 'chat', text: '  Cześć 😀  ' })).toEqual({
      kind: 'chat',
      text: 'Cześć 😀',
    });
    expect(parseServer({ kind: 'welcome', protocol: 1, nick: '  Łucja😀  ' })).toEqual({
      kind: 'welcome',
      protocol: 1,
      nick: 'Łucja😀',
    });
  });
});
