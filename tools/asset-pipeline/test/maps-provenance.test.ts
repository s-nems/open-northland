import { MapMeta, MapProvenance } from '@open-northland/data';
import { expect, it } from 'vitest';
import { mapProvenance } from '../src/stages/maps/provenance.js';

it.each([
  ['UserMaps/example', 'user'],
  ['CnModMaps/example', 'mod'],
  ['DataCnmd/maps/example', 'mod'],
  ['Data/maps/example', 'unknown'],
])('classifies the mod-root folder %s conservatively', (folder, kind) => {
  const rel = `${folder}/map.dat`;
  expect(mapProvenance(rel)).toEqual({ kind, folder });
});

it('reads a hand-edited sidecar without provenance and rejects unsafe provenance folders', () => {
  expect(MapMeta.parse({ name: 'Edited' }).provenance).toBeUndefined();
  for (const folder of ['/absolute', '../escape', 'C:/install', 'Data\\maps', 'a//b', './map']) {
    expect(MapProvenance.safeParse({ kind: 'unknown', folder }).success).toBe(false);
  }
});
