import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { patchConfig, readConfig, writeConfig } from '../src/config.js';
import { makeTempDir, type TempDir } from './support/temp-dir.js';

describe('desktop config', () => {
  let temp: TempDir;
  let file: string;

  beforeEach(async () => {
    temp = await makeTempDir('desktop-config');
    file = `${temp.path}/desktop-config.json`;
  });

  afterEach(() => temp.cleanup());

  it('round-trips the remembered locale alongside the other fields', () => {
    writeConfig(file, { modPath: '/mod', locale: 'pol' });
    expect(readConfig(file)).toEqual({ modPath: '/mod', locale: 'pol' });
  });

  it('drops an unsupported locale rather than trusting it', () => {
    writeFileSync(file, JSON.stringify({ modPath: '/mod', locale: 'de' }));
    const config = readConfig(file);
    expect(config.modPath).toBe('/mod');
    expect('locale' in config).toBe(false);
  });

  it('degrades a malformed file to an empty config', () => {
    writeFileSync(file, 'not json');
    expect(readConfig(file)).toEqual({});
  });

  it('patches one field while preserving the other remembered fields', () => {
    writeConfig(file, { locale: 'pol' });
    patchConfig(file, { modPath: '/mod' });
    patchConfig(file, { locale: 'eng' });
    expect(readConfig(file)).toEqual({ modPath: '/mod', locale: 'eng' });
  });

  it('patches an absent config into just the patched field', () => {
    patchConfig(file, { modPath: '/mod' });
    expect(readConfig(file)).toEqual({ modPath: '/mod' });
  });
});
