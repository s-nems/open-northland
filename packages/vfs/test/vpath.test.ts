import { describe, expect, it } from 'vitest';
import { normalizeRelPath, relIn, toPosix, vbasename, vdirname, vjoin } from '../src/vpath.js';

describe('vjoin', () => {
  it('joins segments with single slashes', () => {
    expect(vjoin('a', 'b', 'c.txt')).toBe('a/b/c.txt');
    expect(vjoin('a/', '/b/', 'c')).toBe('a/b/c');
    expect(vjoin('', 'a', '', 'b')).toBe('a/b');
  });

  it('keeps the first segment root form', () => {
    expect(vjoin('/', 'a')).toBe('/a');
    expect(vjoin('/data', 'content', 'ir.json')).toBe('/data/content/ir.json');
    expect(vjoin('C:\\Games\\Cultures', 'DataCnmd')).toBe('C:\\Games\\Cultures/DataCnmd');
  });
});

describe('vdirname and vbasename', () => {
  it('split on either separator', () => {
    expect(vdirname('a/b/c.txt')).toBe('a/b');
    expect(vdirname('C:\\x\\y')).toBe('C:/x');
    expect(vdirname('/a')).toBe('/');
    expect(vdirname('name')).toBe('');
    expect(vbasename('a/b/c.txt')).toBe('c.txt');
    expect(vbasename('a\\b')).toBe('b');
  });
});

describe('relIn', () => {
  it('strips the root prefix', () => {
    expect(relIn('/game', '/game/Data/x.lib')).toBe('Data/x.lib');
    expect(relIn('/game', '/game')).toBe('');
    expect(relIn('C:\\game', 'C:\\game\\Data\\x.lib')).toBe('Data/x.lib');
  });

  it('rejects a path outside the root or a sibling prefix match', () => {
    expect(() => relIn('/game', '/data/x')).toThrow(/not under/);
    expect(() => relIn('/game', '/gamedir/x')).toThrow(/not under/);
  });
});

describe('normalizeRelPath', () => {
  it('normalizes archive member names to safe relative paths', () => {
    expect(normalizeRelPath('data\\engine2d\\bin\\a.bmd')).toBe('data/engine2d/bin/a.bmd');
    expect(normalizeRelPath('a/./b//c')).toBe('a/b/c');
    expect(normalizeRelPath('a/../b')).toBe('b');
  });

  it('rejects absolute, drive-relative, empty, and escaping names', () => {
    expect(normalizeRelPath('/etc/passwd')).toBeUndefined();
    expect(normalizeRelPath('C:evil')).toBeUndefined();
    expect(normalizeRelPath('C:\\evil')).toBeUndefined();
    expect(normalizeRelPath('..')).toBeUndefined();
    expect(normalizeRelPath('../up')).toBeUndefined();
    expect(normalizeRelPath('a/../../up')).toBeUndefined();
    expect(normalizeRelPath('')).toBeUndefined();
    expect(normalizeRelPath('.')).toBeUndefined();
  });
});

describe('toPosix', () => {
  it('rewrites backslashes', () => {
    expect(toPosix('a\\b/c')).toBe('a/b/c');
  });
});
