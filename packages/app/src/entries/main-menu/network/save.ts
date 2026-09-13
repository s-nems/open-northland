import type { prepareInitialSave } from '@open-northland/net-client';
import { components, type SaveGame } from '@open-northland/sim';
import { buildingFootprints } from '../../../content/ir/joins.js';
import { loadIr } from '../../../content/ir/load.js';
import { loadRuntimeRealContent } from '../../../content/real-content.js';
import {
  isMapId,
  readVerifiedMapDocuments,
  type VerifiedMapDocuments,
} from '../../../content/transfer/index.js';
import { decodeSaveText, type SaveBytes } from '../../../view/runtime/save-load/codec.js';
import { evaluateSaveDocument } from '../../../view/runtime/save-load/evaluate.js';
import { restoreMapWorld } from '../../map/world.js';
import { restoreSavedSeats } from './saved-roster.js';

export async function readNetworkSave(bytes: SaveBytes): Promise<SaveGame> {
  const result = evaluateSaveDocument(await decodeSaveText(bytes));
  if (!result.ok || result.save.header.mapId === null || !isMapId(result.save.header.mapId))
    throw new Error('Invalid multiplayer map save');
  return result.save;
}

export async function validateNetworkSave(save: SaveGame, handle: VerifiedMapDocuments) {
  if (save.header.mapId !== handle.mapId) throw new Error('Save belongs to another map');
  const [ir, runtime] = await Promise.all([loadIr(), loadRuntimeRealContent()]);
  if (ir === null || runtime === null) throw new Error('Missing game content');
  const { map, script } = readVerifiedMapDocuments(handle);
  restoreSavedSeats(
    save,
    (script?.players ?? []).map((seat) => ({
      player: seat.player,
      color: seat.colorId,
      mode: seat.type === 'ai' ? 'ai' : 'idle',
    })),
  );
  const { sim } = restoreMapWorld(
    {
      map,
      ir,
      playerRoster: script?.players ?? [],
      content: { content: runtime.content, footprints: buildingFootprints(ir) },
    },
    save,
  );
  return {
    fog: components.fogMode(sim.world),
    progression: components.professionProgressionEnabled(sim.world),
    needs: components.needsEnabled(sim.world),
  };
}

export type PreparedNetworkSave = Awaited<ReturnType<typeof prepareInitialSave>>;
