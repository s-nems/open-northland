import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript, mapLobbySlots, TerrainMapFile } from '@open-northland/data';
import { exportSaveGame } from '@open-northland/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as irLoader from '../../../src/content/ir/load.js';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import * as realContent from '../../../src/content/real-content.js';
import { verifyMapDocuments } from '../../../src/content/transfer/documents.js';
import { validateNetworkSave } from '../../../src/entries/main-menu/network/save.js';
import { buildMapWorldFromInputs } from '../../../src/entries/map/world-inputs.js';
import { mapSession } from '../../../src/game/match/session-url.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from '../helpers.js';

/** A multiplayer map whose missions name the authored Viking tribe, so a chosen nation rewrites them. */
const MAP = 'bogata_kotlina';
const FRANK = 2;
const OPENING_TICKS = 5;

describe.runIf(hasRealIr())('a single-player save offered to a network room', () => {
  afterEach(() => vi.restoreAllMocks());

  it('validates against the missions its chosen nation played', async () => {
    const ir = rawIrUnderTest() as ContentIr;
    const { merge } = await loadContentUnderTest();
    vi.spyOn(irLoader, 'loadIr').mockResolvedValue(ir);
    vi.spyOn(realContent, 'loadRuntimeRealContent').mockResolvedValue(merge);
    const read = (suffix: string): unknown =>
      JSON.parse(readFileSync(resolve(contentDir(), 'maps', `${MAP}${suffix}`), 'utf8'));
    const map = TerrainMapFile.parse(read('.json'));
    const script = MapScript.parse(read('.script.json'));
    const seat = mapLobbySlots(script).find((slot) => slot.claimable && !slot.hidden);
    if (seat === undefined) throw new Error(`${MAP} has no claimable seat`);
    const entry = `map=${MAP}&player=${seat.player}&tribes=${seat.player}:${FRANK}`;
    const sim = buildMapWorldFromInputs({
      map,
      ir,
      script,
      content: merge.content,
      session: mapSession(new URLSearchParams(entry), mapLobbySlots(script)),
      missions: null,
      save: null,
    }).sim;
    sim.run(OPENING_TICKS);
    const save = exportSaveGame(sim, { mapId: MAP, entry });

    await expect(
      validateNetworkSave(save, verifyMapDocuments(MAP, read('.json'), read('.script.json'))),
    ).resolves.toBeDefined();
  });
});
