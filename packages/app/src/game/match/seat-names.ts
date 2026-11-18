import type { MapScript, MapTextLanguage } from '@open-northland/data';
import type { ComputerDifficulty, GameSession } from '@open-northland/lockstep';
import { formatMessage, messages } from '../../i18n/index.js';
import { playerNameMap } from '../map/roster.js';
import { computerLevelsOf } from './session-roles.js';

/** `name` with the computer's level beside it, "Wikingowie 1 (Komputer Trudny)". */
export function withComputerLevel(name: string, level: ComputerDifficulty): string {
  const copy = messages();
  return formatMessage(copy.hud.computerSeat, {
    name,
    computer: copy.mainMenu.lobby.vacantComputer,
    level: copy.mainMenu.lobby.difficulty[level],
  });
}

/**
 * A seat's name in play: the map's authored name, with the lobby level beside it for a computer seat,
 * so two computers of one people stay apart. An unnamed computer seat takes the lobby's label,
 * numbered from one; an unnamed person's seat stays `undefined` for the HUD to number.
 */
export function seatNameMap(
  session: Pick<GameSession, 'seats'>,
  script: Pick<MapScript, 'players'> | null,
  lang: MapTextLanguage,
): (player: number) => string | undefined {
  const authored = playerNameMap(script, lang);
  const lobby = messages().mainMenu.lobby;
  const leveled = new Map<number, string>();
  for (const [player, level] of computerLevelsOf(session)) {
    const name = authored(player) ?? formatMessage(lobby.playerSlotLabel, { n: player + 1 });
    leveled.set(player, withComputerLevel(name, level));
  }
  return (player) => leveled.get(player) ?? authored(player);
}
