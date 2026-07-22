import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { patchConfig, readConfig, writeConfig } from '../src/config.js';
import { makeTempDir, type TempDir } from './support/temp-dir.js';

/**
 * The shell's remembered config (`src/config.ts`). Invariants: known string fields survive a
 * round-trip, an unsupported `locale` is dropped rather than trusted, and a malformed file degrades
 * to `{}` instead of throwing.
 */
describe('desktop config', () => {
  let temp: TempDir;
  let file: string;

  beforeEach(async () => {
    temp = await makeTempDir('desktop-config');
    file = `${temp.path}/desktop-config.json`;
  });

  afterEach(() => temp.cleanup());

  it('round-trips the remembered locale alongside the other fields', () => {
    writeConfig(file, { gamePath: '/game', modPath: '/mod', locale: 'pol' });
    expect(readConfig(file)).toEqual({ gamePath: '/game', modPath: '/mod', locale: 'pol' });
  });

  it('drops an unsupported locale rather than trusting it', () => {
    writeFileSync(file, JSON.stringify({ gamePath: '/game', locale: 'de' }));
    const config = readConfig(file);
    expect(config.gamePath).toBe('/game');
    expect('locale' in config).toBe(false);
  });

  it('degrades a malformed file to an empty config', () => {
    writeFileSync(file, 'not json');
    expect(readConfig(file)).toEqual({});
  });

  it('patches one field while preserving the other remembered fields', () => {
    writeConfig(file, { gamePath: '/game', locale: 'pol' });
    patchConfig(file, { modPath: '/mod' });
    patchConfig(file, { locale: 'eng' });
    expect(readConfig(file)).toEqual({ gamePath: '/game', modPath: '/mod', locale: 'eng' });
  });

  it('patches an absent config into just the patched field', () => {
    patchConfig(file, { gamePath: '/game' });
    expect(readConfig(file)).toEqual({ gamePath: '/game' });
  });
});
