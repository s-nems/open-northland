import { mapLobbySlots } from '@open-northland/data';
import { PEACE_MINUTES, type PeaceMinutes } from '@open-northland/lockstep';
import type { prepareInitialSave } from '@open-northland/net-client';
import { components, type SaveGame, type Simulation, TICKS_PER_MINUTE } from '@open-northland/sim';
import { buildingFootprints } from '../../../content/ir/joins.js';
import { loadIr } from '../../../content/ir/load.js';
import { loadRuntimeRealContent } from '../../../content/real-content.js';
import {
  isMapId,
  readVerifiedMapDocuments,
  type VerifiedMapDocuments,
} from '../../../content/transfer/index.js';
import { assertMultiplayerMap } from '../../../game/map/multiplayer.js';
import { variantMap, variantMapScript, variantScriptWorld } from '../../../game/map/variant.js';
import { mapScriptWorld } from '../../../game/world/mission-script.js';
import { decodeSaveText, type SaveBytes } from '../../../view/runtime/save-load/codec.js';
import { evaluateSaveDocument } from '../../../view/runtime/save-load/evaluate.js';
import { restoreMapWorld } from '../../map/world.js';
import { authoredVacantMode, vacantOffers } from '../lobby/roster-state.js';
import { restoreSavedSeats, savedDayNightMode, savedMapWorld, savedWeatherMode } from './saved-roster.js';

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
  const documents = readVerifiedMapDocuments(handle);
  const world = savedMapWorld(save, handle.mapId);
  const map = variantMap(documents.map, world);
  const script = variantMapScript(documents.script, world);
  assertMultiplayerMap(script);
  restoreSavedSeats(
    save,
    (script === null ? [] : mapLobbySlots(script)).map((seat) => ({
      player: seat.player,
      color: seat.colorId,
      mode: authoredVacantMode(seat),
      offers: vacantOffers(seat),
      claimable: seat.claimable && !seat.hidden,
    })),
  );
  const { sim } = restoreMapWorld(
    {
      map,
      ir,
      playerRoster: script?.players ?? [],
      script: variantScriptWorld(mapScriptWorld(script, ir), world),
      content: { content: runtime.content, footprints: buildingFootprints(ir) },
    },
    save,
  );
  return {
    fog: components.fogMode(sim.world),
    progression: components.professionProgressionEnabled(sim.world),
    needs: components.needsEnabled(sim.world),
    weather: savedWeatherMode(save),
    dayNight: savedDayNightMode(save),
    alliedVision: components.alliedVisionEnabled(sim.world),
    peace: savedPeace(sim),
  };
}

/** The length of the peace the saved match opened while it still holds, so the room shows it; the
 *  restored world keeps its own deadline and never opens another. Null once it ended. */
function savedPeace(sim: Simulation): PeaceMinutes | null {
  const until = sim.peaceHoldsUntilTick();
  return PEACE_MINUTES.find((minutes) => minutes * TICKS_PER_MINUTE === until) ?? null;
}

export type PreparedNetworkSave = Awaited<ReturnType<typeof prepareInitialSave>>;
