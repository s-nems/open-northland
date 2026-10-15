import { rm } from 'node:fs/promises';
import { CatalogEntry, MapBriefing } from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import { encodePcx } from '@open-northland/formats/pcx';
import { expect, it } from 'vitest';
import { briefingPictureSuffixes } from '../../app/src/content/map-source/files.js';
import { installCatalogEntry } from '../../app/src/content/map-source/install.js';
import { createInstalledMapStore } from '../../app/src/content/map-source/store.js';
import { memoryInstalledStorage } from '../../app/test/support/catalog-maps.js';
import { rampPalette } from '../../formats/test/fixtures/palette.js';
import { startApiServer } from '../src/server.js';
import { DataStore } from '../src/store.js';
import {
  catalogEntry,
  FakeFiles,
  harness,
  plaintextMap,
  syncedOf,
  temporaryDir,
  under,
  zipOf,
} from './support/conversion-fixture.js';

/** A RIFF WAVE header with no samples: what the conversion keeps and the store serves as `audio/wav`. */
const WAV = new Uint8Array([...'RIFF\x04\0\0\0WAVE'].map((c) => c.charCodeAt(0)));

it('converts, serves and installs briefing pictures and voices for offline use, scoped to their map', async () => {
  const dir = await temporaryDir();
  const entryId = 'cn-briefing';
  const mapId = `${entryId}-island`;
  const files = new FakeFiles();
  files.serve(
    entryId,
    zipOf(
      under('Island', {
        ...plaintextMap('Island'),
        'mission.inc': '[MissionData]\ngoal "Time" 0\nresult "PlayCutscene" 500 1\n',
        'text/pol/briefings/briefings.txt': '[blockstart:500]\nOpis\n[blockend:500]\n',
        'text/pol/briefings/0500.hlt': '<onscreencallback:2000,1,0>\n<picture:$local$\\graphics\\map.pcx>',
        'sfx/pol/0001.wav': WAV,
        'text/pol/briefings/graphics/map.pcx': encodePcx({
          width: 3,
          height: 2,
          pixels: new Uint8Array(6).fill(4),
          palette: rampPalette(),
        }),
      }),
    ),
  );
  const conversion = await harness(dir, files, { irVersion: IR_VERSION });
  const store = new DataStore(dir);
  await store.init();
  const server = await startApiServer({ port: 0, host: '127.0.0.1', store, content: conversion.service });
  const api = `http://127.0.0.1:${server.port}`;
  try {
    conversion.service.setCatalog(syncedOf([catalogEntry(entryId)]));
    await conversion.service.idle();
    const snapshot = conversion.published.at(-1);
    if (snapshot === undefined) throw new Error('missing catalogue');
    server.publish(snapshot);
    const entry = CatalogEntry.parse(await (await fetch(`${api}/v1/maps/${entryId}`)).json());
    const base = `${api}/v1/content/${IR_VERSION}/maps/${mapId}`;
    const briefing = MapBriefing.parse(await (await fetch(`${base}.briefing.json`)).json());
    const [suffix] = briefingPictureSuffixes(briefing);
    expect(suffix).toMatch(/^\.pictures-[a-f0-9]{16}\.png$/);
    if (suffix === undefined) throw new Error('missing picture');
    const response = await fetch(base + suffix);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    const png = new Uint8Array(await response.arrayBuffer());
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const conditional = await fetch(base + suffix, {
      headers: { 'if-none-match': response.headers.get('etag') ?? '' },
    });
    expect(conditional.status).toBe(304);
    const head = await fetch(base + suffix, { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe(String(png.byteLength));
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    expect((await fetch(`${api}/v1/content/${IR_VERSION}/maps/cn-other${suffix}`)).status).toBe(404);
    expect((await fetch(`${base}.pictures-invalid.png`)).status).toBe(404);
    const voice = await fetch(`${base}.voice-pol-0001.wav`);
    expect(voice.headers.get('content-type')).toBe('audio/wav');
    expect(new Uint8Array(await voice.arrayBuffer())).toEqual(WAV);
    const memory = memoryInstalledStorage();
    const installed = createInstalledMapStore(memory.storage, { budget: null });
    const records = await installCatalogEntry(entry, { api, store: installed });
    const record = records[0];
    if (record === undefined) throw new Error('missing installed record');
    expect(record.suffixes).toContain(suffix);
    expect(record.suffixes).toContain('.voice-pol-0001.wav');
    // Reload the persisted store without consulting the API.
    const reloaded = createInstalledMapStore(memory.storage, { budget: null });
    const offline = await reloaded.fetchFor(record)(`/maps/${mapId}${suffix}`);
    expect(offline.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await offline.arrayBuffer())).toEqual(png);
    const offlineVoice = await reloaded.fetchFor(record)(`/maps/${mapId}.voice-pol-0001.wav`);
    expect(offlineVoice.headers.get('content-type')).toBe('audio/wav');
  } finally {
    await server.close();
    await conversion.service.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
