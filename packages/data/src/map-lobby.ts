import type { MapSeatRelation, MapSeatStance, MapsIndexPlayerSlot } from './schema/maps/listing.js';
import {
  ComputerModuleId,
  type MapAiSeat,
  type MapDiplomacy,
  type MapMultiplayerSlot,
  type MapPlayerSlot,
  type MapScript,
} from './schema/maps/script.js';

/** What a seat's `playeroption` row, or its absence, lets the lobby do with it. */
export function mapSlotEligibility(
  type: MapPlayerSlot['type'],
  allowed: MapMultiplayerSlot['allowed'] | undefined,
): Pick<MapsIndexPlayerSlot, 'claimable' | 'aiAllowed' | 'noneAllowed'> {
  return {
    claimable: type !== 'none' && (allowed === undefined ? type === 'human' : allowed.includes('human')),
    aiAllowed: allowed === undefined || allowed.includes('ai'),
    noneAllowed: allowed === undefined || allowed.includes('none'),
  };
}

/** The lobby seats a script authors: its roster rows read against the `[multiplayer]` table. */
export function mapLobbySlots(script: MapScript): MapsIndexPlayerSlot[] {
  const table = script.multiplayer;
  return script.players.map((slot) => {
    const allowed = table?.slotOptions.find((row) => row.player === slot.player)?.allowed;
    const eligibility = mapSlotEligibility(slot.type, allowed);
    return {
      ...slot,
      claimable: eligibility.claimable,
      hidden: table?.hiddenSlots.includes(slot.player) ?? false,
      aiAllowed: eligibility.aiAllowed,
      noneAllowed: eligibility.noneAllowed,
      hasComputerControl: mapAllowsComputerControl(script.ai?.find((row) => row.player === slot.player)),
    };
  });
}

/**
 * The roster's start relations that are not neutral, each pair once with its lower slot first. A pair
 * the `diplomacy` rows leave unset starts neutral, as the world builder fills it. Allied means both
 * directions `friend`, the rule victory and shared vision read; enemy means either direction `enemy`,
 * the rule a fight reads.
 */
export function mapSeatRelations(script: MapScript): MapSeatRelation[] {
  const rows = new Map(script.diplomacy.map((row) => [`${row.from}:${row.to}`, row.state]));
  const state = (from: number, to: number): MapDiplomacy['state'] => rows.get(`${from}:${to}`) ?? 'neutral';
  const seats = [...new Set(script.players.map((slot) => slot.player))].sort((x, y) => x - y);
  const relations: MapSeatRelation[] = [];
  for (const [index, a] of seats.entries()) {
    for (const b of seats.slice(index + 1)) {
      const stance = pairStance(state(a, b), state(b, a));
      if (stance !== 'neutral') relations.push({ a, b, stance });
    }
  }
  return relations;
}

function pairStance(there: MapDiplomacy['state'], back: MapDiplomacy['state']): MapSeatStance {
  if (there === 'enemy' || back === 'enemy') return 'enemy';
  return there === 'friend' && back === 'friend' ? 'ally' : 'neutral';
}

/** Whether the authored switches permit any autonomous computer-player capability. */
export function mapAllowsComputerControl(row: MapAiSeat | undefined): boolean {
  if (row === undefined) return true;
  if (row.allDisabled || row.computerDisabled) return false;
  return !ComputerModuleId.options.every((id) => row.disabledComputerModules.includes(id));
}
