import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MapMeta, MapProvenance } from '@open-northland/data';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mapProvenance } from '../src/stages/maps/provenance.js';
import { makeTempDir } from './support/game-tree.js';

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
  expect(mapProvenance({ game, mod: game }, { rel, path: join(game, rel) })).toEqual({
    kind,
    folder,
    layer: 'game',
  });
});

it('recognizes a separate mod root without leaking its absolute path', async () => {
  const rel = 'Data/maps/example/map.dat';
  expect(mapProvenance({ game, mod }, { rel, path: join(mod, rel) })).toEqual({
    kind: 'mod',
    folder: 'Data/maps/example',
    layer: 'mod',
  });
});

it('reads a hand-edited sidecar without provenance and rejects unsafe provenance folders', () => {
  expect(MapMeta.parse({ name: 'Edited' }).provenance).toBeUndefined();
  for (const folder of ['/absolute', '../escape', 'C:/install', 'Data\\maps', 'a//b', './map']) {
    expect(MapProvenance.safeParse({ kind: 'unknown', layer: 'game', folder }).success).toBe(false);
  }
});
