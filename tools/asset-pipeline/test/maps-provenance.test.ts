import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MapMeta, MapProvenance } from '@open-northland/data';
import { nodeVfs } from '@open-northland/vfs/node';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { encodeLib } from '../src/decoders/lib.js';
import { withArchiveLayer } from '../src/roots.js';
import { unpackLibTree } from '../src/stages/lib.js';
import { mapProvenance } from '../src/stages/maps/provenance.js';
import { makeTempDir } from './support/game-tree.js';

const fs = nodeVfs();
let root: string;
let game: string;
let mod: string;
let out: string;
beforeEach(async () => {
  root = (await makeTempDir('map-provenance')).path;
  game = join(root, 'game');
  mod = join(root, 'mod');
  out = join(root, 'out');
  await Promise.all([game, mod, out].map((path) => mkdir(path, { recursive: true })));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it.each([
  ['UserMaps/example', 'user'],
  ['CnModMaps/example', 'mod'],
  ['DataCnmd/maps/example', 'mod'],
  ['Data/maps/example', 'unknown'],
])('classifies the installed folder %s conservatively', async (folder, kind) => {
  const rel = `${folder}/map.dat`;
  expect(await mapProvenance(fs, { game, mod: game }, { rel, path: join(game, rel) })).toEqual({
    kind,
    folder,
    layer: 'game',
  });
});

it('recognizes a separate mod root without leaking its absolute path', async () => {
  const rel = 'Data/maps/example/map.dat';
  expect(await mapProvenance(fs, { game, mod }, { rel, path: join(mod, rel) })).toEqual({
    kind: 'mod',
    folder: 'Data/maps/example',
    layer: 'mod',
  });
});

async function archive(base: string, name: string, members: string[]): Promise<void> {
  const path = join(base, name);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, encodeLib({ files: members.map((name) => ({ name, data: new Uint8Array([1]) })) }));
}

it('tracks archive origins and denies base classification after a loose sibling override', async () => {
  const rel = 'Data/maps/example/map.dat';
  await archive(game, 'DataX/Libs/data0001.lib', [rel, 'Data/maps/example/mission.cif']);
  const roots = { game, mod };
  const extracted = await unpackLibTree(fs, roots, out);
  const sources = withArchiveLayer(
    roots,
    out,
    new Map(extracted.map((e) => [e.member.toLowerCase(), e.origin])),
  );
  const source = { rel, path: join(out, rel) };
  expect((await mapProvenance(fs, sources, source)).kind).toBe('base');
  expect((await mapProvenance(fs, withArchiveLayer(roots, out), source)).kind).toBe('unknown');
  await mkdir(join(mod, 'Data/maps/example'), { recursive: true });
  await writeFile(join(mod, 'Data/maps/example/mission.ini'), '[logiccontrol]');
  expect((await mapProvenance(fs, sources, source)).kind).toBe('unknown');
});

it('does not call a base terrain with a mod archive sibling an untouched base map', async () => {
  const rel = 'Data/maps/example/map.dat';
  await archive(game, 'DataX/Libs/data0001.lib', [rel, 'Data/maps/example/mission.cif']);
  await archive(mod, 'z.lib', ['Data/maps/example/mission.cif']);
  const roots = { game, mod };
  const extracted = await unpackLibTree(fs, roots, out);
  const sources = withArchiveLayer(
    roots,
    out,
    new Map(extracted.map((e) => [e.member.toLowerCase(), e.origin])),
  );
  expect((await mapProvenance(fs, sources, { rel, path: join(out, rel) })).kind).toBe('unknown');
});

it('tracks an overlay replacing the base-named archive as mod origin', async () => {
  const rel = 'Data/maps/example/map.dat';
  await archive(game, 'DataX/Libs/data0001.lib', [rel]);
  await archive(mod, 'DataX/Libs/data0001.lib', [rel]);
  const extracted = await unpackLibTree(fs, { game, mod }, out);
  expect(extracted.map((e) => e.origin)).toEqual(['mod']);
});

it('accepts legacy metadata but rejects unsafe provenance folders', () => {
  expect(MapMeta.parse({ name: 'Legacy' }).provenance).toBeUndefined();
  for (const folder of ['/absolute', '../escape', 'C:/install', 'Data\\maps', 'a//b', './map']) {
    expect(MapProvenance.safeParse({ kind: 'unknown', layer: 'game', folder }).success).toBe(false);
  }
});
