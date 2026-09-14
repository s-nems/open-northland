import { readFileSync } from 'node:fs';
import { exportSaveGame } from '@open-northland/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import {
  decodeMapTransfer,
  encodeMapTransfer,
  readVerifiedMapDocuments,
  verifyMapDocuments,
} from '../../src/content/transfer/index.js';
import { validateNetworkSave } from '../../src/entries/main-menu/network/save.js';
import { buildMapWorld, restoreMapWorld } from '../../src/entries/map/world.js';
import { mapScriptWorld } from '../../src/game/world/mission-script.js';
import { hasRealIr, loadContentUnderTest, rawIrUnderTest, serveIrFetch } from './helpers.js';
import { realMapPath } from './real-map-world.js';

describe.runIf(hasRealIr())('verified map transfer with owned content', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('preserves fresh world hashes and preflights a save against retained terrain/script', async () => {
    const mapId = 'magiczny_las';
    const source = verifyMapDocuments(
      mapId,
      JSON.parse(readFileSync(realMapPath(mapId), 'utf8')),
      JSON.parse(readFileSync(realMapPath(mapId).replace(/\.json$/, '.script.json'), 'utf8')),
    );
    const guest = decodeMapTransfer(encodeMapTransfer(source, { kind: 'mod' }), {
      mapId,
      fingerprint: source.fingerprint,
      provenance: { kind: 'mod' },
    });
    const { merge } = await loadContentUnderTest();
    const options = (handle: typeof source) => {
      const { map, script } = readVerifiedMapDocuments(handle);
      return {
        map,
        ir: rawIrUnderTest() as ContentIr,
        content: { content: merge.content },
        playerRoster: script?.players ?? [],
        script: mapScriptWorld(script, rawIrUnderTest() as ContentIr),
        diplomacy: script?.diplomacy ?? [],
        seed: 7,
        aiSeats: [],
        assistantSeats: [],
        fog: 1 as const,
        progression: false,
        needs: false,
      };
    };
    const creator = buildMapWorld(options(source));
    const receiver = buildMapWorld(options(guest));
    expect(creator.kind).toBe('authored');
    expect(receiver.sim.hashState()).toBe(creator.sim.hashState());
    creator.sim.run(1);
    receiver.sim.run(1);
    expect(receiver.sim.hashState()).toBe(creator.sim.hashState());
    const save = exportSaveGame(creator.sim, { mapId });
    vi.stubGlobal('fetch', serveIrFetch);
    expect(await validateNetworkSave(save, guest)).toEqual({ fog: 1, progression: false, needs: false });
    const restored = restoreMapWorld(options(guest), save);
    expect(restored.sim.hashState()).toBe(creator.sim.hashState());
    const corrupted = { ...save, header: { ...save.header, contentFingerprint: '0'.repeat(64) } };
    await expect(validateNetworkSave(corrupted, guest)).rejects.toThrow(/contentFingerprint/);
  }, 60_000);
});
