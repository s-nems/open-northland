import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseIniSections } from '../src/decoders/ini.js';
import { resolveMapMeta } from '../src/stages/maps/meta.js';

/**
 * Covers the map meta sidecar resolution: the header-id fallback chain (misc.inc/map.ini/map.cif →
 * observed default 0/1), the pol-before-eng language preference, and the "no strings → no sidecar"
 * degrade. Fixtures are plain ASCII `.ini` (windows-1250 decodes ASCII 1:1). Only `resolveMapMeta` is
 * public; the private id/table resolvers are exercised through it.
 */
async function mapFolder(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vinland-map-meta-'));
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
    expect(await resolveMapMeta(dir, 'x/map.dat', undefined)).toBeUndefined();
  });

  it('uses the observed default ids 0 (name) / 1 (description) with no header', async () => {
    const dir = await mapFolder();
    // Bare `string` lines take running ids from 0, so id 0 is the name, id 1 the description.
    await writeStrings(dir, 'pol', 'string "Green Valley"\nstring "A lush test map."');
    expect(await resolveMapMeta(dir, 'x/map.dat', undefined)).toEqual({
      name: 'Green Valley',
      description: 'A lush test map.',
    });
  });

  it('honours a misc.inc [misc_mapname] header overriding the string ids', async () => {
    const dir = await mapFolder();
    await writeStrings(dir, 'pol', 'stringn 5 "Custom Name"\nstringn 6 "Custom Desc"');
    await writeFile(join(dir, 'misc.inc'), '[misc_mapname]\nmapnamestringid 5\nmapdescriptionstringid 6\n');
    expect(await resolveMapMeta(dir, 'x/map.dat', undefined)).toEqual({
      name: 'Custom Name',
      description: 'Custom Desc',
    });
  });

  it('prefers the Polish string table over English', async () => {
    const dir = await mapFolder();
    await writeStrings(dir, 'pol', 'string "Nazwa"\nstring "Opis"');
    await writeStrings(dir, 'eng', 'string "Name"\nstring "Description"');
    expect(await resolveMapMeta(dir, 'x/map.dat', undefined)).toEqual({ name: 'Nazwa', description: 'Opis' });
  });

  it('falls back to the decoded map.cif header ids when no readable header ships', async () => {
    const dir = await mapFolder();
    await writeStrings(dir, 'pol', 'stringn 5 "Cif Name"\nstringn 6 "Cif Desc"');
    const cifSections = parseIniSections('[misc_mapname]\nmapnamestringid 5\nmapdescriptionstringid 6\n');
    expect(await resolveMapMeta(dir, 'x/map.dat', cifSections)).toEqual({
      name: 'Cif Name',
      description: 'Cif Desc',
    });
  });

  it('returns undefined when the table lacks the resolved header ids', async () => {
    const dir = await mapFolder();
    // Only id 0/1 exist, but the header points name/description at 5/6 → neither resolves.
    await writeStrings(dir, 'pol', 'string "Only Name"\nstring "Only Desc"');
    await writeFile(join(dir, 'misc.inc'), '[misc_mapname]\nmapnamestringid 5\nmapdescriptionstringid 6\n');
    expect(await resolveMapMeta(dir, 'x/map.dat', undefined)).toBeUndefined();
  });
});
