import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeVfs } from '@open-northland/vfs/node';
import { describe, expect, it } from 'vitest';
import { parseIniSections } from '../src/decoders/ini.js';
import { resolveMapMeta } from '../src/stages/maps/meta.js';
import { makeTempDir } from './support/game-tree.js';

const fs = nodeVfs();

/**
 * Covers the map meta sidecar resolution: the header-id fallback chain (misc.inc/map.ini/map.cif →
 * observed default 0/1), the pol-before-eng language preference, and the "no strings → no sidecar"
 * degrade. Fixtures are plain ASCII `.ini` (windows-1250 decodes ASCII 1:1). Only `resolveMapMeta` is
 * public; the private id/table resolvers are exercised through it.
 */
async function mapFolder(): Promise<string> {
  return (await makeTempDir('map-meta')).path;
}

/** Writes `<dir>/text/<lang>/strings.ini` with the given `[text]` body. */
async function writeStrings(dir: string, lang: string, body: string): Promise<void> {
  const langDir = join(dir, 'text', lang);
  await mkdir(langDir, { recursive: true });
  await writeFile(join(langDir, 'strings.ini'), `[text]\n${body}\n`);
}

describe('resolveMapMeta', () => {
  it('returns undefined when the folder carries no string table', async () => {
    const dir = await mapFolder();
    expect(await resolveMapMeta(fs, [dir], 'x/map.dat', undefined)).toBeUndefined();
  });

  it('uses the observed default ids 0 (name) / 1 (description) with no header', async () => {
    const dir = await mapFolder();
    // Bare `string` lines take running ids from 0, so id 0 is the name, id 1 the description.
    await writeStrings(dir, 'pol', 'string "Green Valley"\nstring "A lush test map."');
    expect(await resolveMapMeta(fs, [dir], 'x/map.dat', undefined)).toEqual({
      name: 'Green Valley',
      description: 'A lush test map.',
    });
  });

  it('honours a misc.inc [misc_mapname] header overriding the string ids', async () => {
    const dir = await mapFolder();
    await writeStrings(dir, 'pol', 'stringn 5 "Custom Name"\nstringn 6 "Custom Desc"');
    await writeFile(join(dir, 'misc.inc'), '[misc_mapname]\nmapnamestringid 5\nmapdescriptionstringid 6\n');
    expect(await resolveMapMeta(fs, [dir], 'x/map.dat', undefined)).toEqual({
      name: 'Custom Name',
      description: 'Custom Desc',
    });
  });

  it('carries the [misc_maptype] listing header, with or without strings', async () => {
    const dir = await mapFolder();
    await writeFile(
      join(dir, 'misc.inc'),
      '[misc_maptype]\nmaptype #CLEAN_MAP_TYPE_MULTI_PLAYER_FREE\nmapmultiplayeronly\n',
    );
    expect(await resolveMapMeta(fs, [dir], 'x/map.dat', undefined)).toEqual({
      mapTypes: [4],
      multiplayerOnly: true,
    });
    const bare = await mapFolder();
    await writeFile(join(bare, 'misc.inc'), '[misc_maptype]\nmapcampaignid 0 5\n');
    expect(await resolveMapMeta(fs, [bare], 'x/map.dat', undefined)).toBeUndefined();
    const cif = parseIniSections('[misc_maptype]\nmaptype 2\n');
    const typed = await mapFolder();
    await writeStrings(typed, 'pol', 'string "Nazwa"\nstring "Opis"');
    expect(await resolveMapMeta(fs, [typed], 'x/map.dat', cif)).toEqual({
      name: 'Nazwa',
      description: 'Opis',
      mapTypes: [2],
    });
  });

  it('prefers the Polish string table over English', async () => {
    const dir = await mapFolder();
    await writeStrings(dir, 'pol', 'string "Nazwa"\nstring "Opis"');
    await writeStrings(dir, 'eng', 'string "Name"\nstring "Description"');
    expect(await resolveMapMeta(fs, [dir], 'x/map.dat', undefined)).toEqual({
      name: 'Nazwa',
      description: 'Opis',
    });
  });

  it('falls back to the decoded map.cif header ids when no readable header ships', async () => {
    const dir = await mapFolder();
    await writeStrings(dir, 'pol', 'stringn 5 "Cif Name"\nstringn 6 "Cif Desc"');
    const cifSections = parseIniSections('[misc_mapname]\nmapnamestringid 5\nmapdescriptionstringid 6\n');
    expect(await resolveMapMeta(fs, [dir], 'x/map.dat', cifSections)).toEqual({
      name: 'Cif Name',
      description: 'Cif Desc',
    });
  });

  it('returns undefined when the table lacks the resolved header ids', async () => {
    const dir = await mapFolder();
    // Only id 0/1 exist, but the header points name/description at 5/6 → neither resolves.
    await writeStrings(dir, 'pol', 'string "Only Name"\nstring "Only Desc"');
    await writeFile(join(dir, 'misc.inc'), '[misc_mapname]\nmapnamestringid 5\nmapdescriptionstringid 6\n');
    expect(await resolveMapMeta(fs, [dir], 'x/map.dat', undefined)).toBeUndefined();
  });

  it('joins the [misc_music] musictype next to the display strings', async () => {
    const dir = await mapFolder();
    await writeStrings(dir, 'pol', 'string "Nazwa"\nstring "Opis"');
    await writeFile(join(dir, 'misc.inc'), '[misc_music]\nmusictype #DM_MUSIC_TYPE_MISSION_BYZANZ3\n');
    expect(await resolveMapMeta(fs, [dir], 'x/map.dat', undefined)).toEqual({
      name: 'Nazwa',
      description: 'Opis',
      musicType: 15,
    });
  });

  it('emits a music-only sidecar when the folder carries no string table', async () => {
    const dir = await mapFolder();
    await writeFile(join(dir, 'map.ini'), '[misc_music]\nmusictype 10\n');
    expect(await resolveMapMeta(fs, [dir], 'x/map.dat', undefined)).toEqual({ musicType: 10 });
  });

  it('falls back to the decoded map.cif for the musictype', async () => {
    const dir = await mapFolder();
    await writeStrings(dir, 'pol', 'string "Nazwa"');
    const cifSections = parseIniSections('[misc_music]\nmusictype 36\n');
    expect(await resolveMapMeta(fs, [dir], 'x/map.dat', cifSections)).toEqual({
      name: 'Nazwa',
      musicType: 36,
    });
  });
});
