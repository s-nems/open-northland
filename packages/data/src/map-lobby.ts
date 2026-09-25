import type { MapsIndexPlayerSlot } from './schema/maps/listing.js';
import type { MapScript } from './schema/maps/script.js';

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
    };
  });
}
