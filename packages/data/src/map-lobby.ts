import type { MapsIndexPlayerSlot } from './schema/maps/listing.js';
import { MapAiModule, type MapAiSeat, type MapScript } from './schema/maps/script.js';

/** The lobby seats a script authors: its roster rows read against the `[multiplayer]` table. */
export function mapLobbySlots(script: MapScript): MapsIndexPlayerSlot[] {
  const table = script.multiplayer;
  return script.players.map((slot) => {
    const allowed = table?.slotOptions.find((row) => row.player === slot.player)?.allowed;
    return {
      ...slot,
      claimable: slot.type === 'human' || allowed?.includes('human') === true,
      hidden: table?.hiddenSlots.includes(slot.player) ?? false,
      aiAllowed: allowed === undefined || allowed.includes('ai'),
      noneAllowed: allowed === undefined || allowed.includes('none'),
      strategicAi: strategicAiPlays(script.ai?.find((row) => row.player === slot.player)),
    };
  });
}

/** Whether a seat's `[AIData]` row leaves the strategic AI running: a seat without a row plays with
 *  every module; `AI_Disable` or a blanket `HAI_Disable` leaves only the scripted handler. */
export function strategicAiPlays(row: MapAiSeat | undefined): boolean {
  if (row === undefined) return true;
  if (row.disabled) return false;
  return !MapAiModule.options.every((id) => row.strategicOff.includes(id));
}
