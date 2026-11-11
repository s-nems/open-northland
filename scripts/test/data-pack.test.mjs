import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { dataPath, readCampaigns, readDataPack } from '../data-pack.mjs';
import { syntheticPack } from './support/data-pack.mjs';

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'data-contract-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('rejects unsafe paths, extra files and changed source bytes', async (t) => {
  for (const path of ['/root', '../escape', 'C:/file', 'a\\b', 'a/./b', 'a//b', 'a\0b'])
    assert.throws(() => dataPath(path), /Invalid data path/);
  const root = await temp(t);
  await syntheticPack(root);
  await readDataPack(root);
  await writeFile(join(root, 'unexpected'), 'extra');
  await assert.rejects(readDataPack(root), /inventory/);
  await rm(join(root, 'unexpected'));
  await writeFile(join(root, 'base/rules/types/example.ini'), 'changed');
  await assert.rejects(readDataPack(root), /checksum/);
});

test('rejects the previous source layout version', async (t) => {
  const root = await temp(t);
  const manifest = await syntheticPack(root);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ ...manifest, version: 1 }));
  await assert.rejects(readDataPack(root), /version|Unsupported/);
});

test('rejects symlinks inside a source tree', async (t) => {
  const root = await temp(t);
  await syntheticPack(root);
  await symlink(join(root, 'manifest.json'), join(root, 'linked'));
  await assert.rejects(readDataPack(root), /non-regular/);
});

function campaignPack(overrides = {}) {
  const map = {
    id: 'first_map',
    shared: { 'map.dat': 'world/map.dat', 'mission.inc': 'mission/mission.inc' },
    locales: {
      pol: { 'text/pol/strings.ini': 'locales/pol/strings.ini', 'sfx/pol/0001.wav': 'locales/pol/0001.wav' },
      eng: { 'text/eng/strings.ini': 'locales/eng/strings.ini' },
      ita: { 'text/ita/strings.ini': 'locales/ita/strings.ini' },
    },
  };
  const campaign = {
    version: 2,
    id: 'synthetic',
    campaignId: 100,
    order: 1,
    title: { pol: 'Syntetyczna', eng: 'Synthetic' },
    background: 'presentation/map.png',
    logo: { pol: 'presentation/logo-pol.png' },
    stages: [{ missionId: 2, x: 0.25, y: 0.5 }],
    movies: {
      pol: {
        videos: [
          {
            sequence: 0,
            video: 'films/video/end.webm',
            audio: 'films/pol/end.webm',
            width: 640,
            height: 480,
          },
        ],
      },
    },
    maps: [map],
    ...overrides,
  };
  const files = {
    'campaigns/synthetic/campaign.json': JSON.stringify(campaign),
    'campaigns/synthetic/maps/first_map/world/map.dat': 'synthetic terrain',
    'campaigns/synthetic/maps/first_map/mission/mission.inc': 'shared mission',
    'campaigns/synthetic/maps/first_map/locales/pol/strings.ini': 'polski',
    'campaigns/synthetic/maps/first_map/locales/pol/0001.wav': 'glos',
    'campaigns/synthetic/maps/first_map/locales/eng/strings.ini': 'english',
    'campaigns/synthetic/maps/first_map/locales/ita/strings.ini': 'italiano',
    'campaigns/synthetic/presentation/map.png': 'background',
    'campaigns/synthetic/presentation/logo-pol.png': 'logo',
    'campaigns/synthetic/films/video/end.webm': 'picture',
    'campaigns/synthetic/films/pol/end.webm': 'sound',
  };
  return { map, campaign, files };
}

test('reads a campaign with shared map files, language layers, presentation and films', async (t) => {
  const root = await temp(t);
  const { files } = campaignPack();
  const manifest = await syntheticPack(root, files, ['synthetic']);
  await readDataPack(root);
  const [campaign] = await readCampaigns(root, manifest);
  assert.deepEqual(campaign.languages, ['pol', 'eng', 'ita']);
  assert.equal(campaign.maps[0].locales.pol['sfx/pol/0001.wav'], 'locales/pol/0001.wav');
  assert.equal(campaign.movies.pol.videos[0].audio, 'films/pol/end.webm');
});

test('keeps every language in its own folders and every map in the same languages', async (t) => {
  const reject = async (mutate, pattern) => {
    const root = await temp(t);
    const pack = campaignPack();
    mutate(pack);
    await syntheticPack(
      root,
      { ...pack.files, 'campaigns/synthetic/campaign.json': JSON.stringify(pack.campaign) },
      ['synthetic'],
    );
    await assert.rejects(readDataPack(root), pattern);
  };
  await reject(({ map }) => {
    map.shared['text/eng/strings.ini'] = 'world/map.dat';
  }, /shared file in a language folder/);
  await reject(({ map }) => {
    map.locales.eng['map.dat'] = 'locales/eng/strings.ini';
  }, /outside its language folders/);
  await reject(({ map }) => {
    map.locales.pol['text/pol/strings.ini'] = 'locales/eng/strings.ini';
  }, /outside locales\/pol/);
  await reject(({ campaign, map, files }) => {
    campaign.maps = [map, { ...map, id: 'second_map', locales: { pol: map.locales.pol } }];
    for (const [path, bytes] of Object.entries(files))
      if (path.includes('/first_map/')) files[path.replace('/first_map/', '/second_map/')] = bytes;
  }, /other languages/);
  await reject(({ campaign }) => {
    campaign.background = 'presentation/Map.png';
  }, /invalid file/);
  await reject(({ campaign }) => {
    campaign.logo = { pol: 'presentation/missing.png' };
  }, /Missing campaign file/);
  await reject(({ campaign }) => {
    campaign.version = 1;
  }, /version/);
});
