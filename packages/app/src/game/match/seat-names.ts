import type { MapScript, MapTextLanguage } from '@open-northland/data';
import type { ComputerDifficulty, GameSession } from '@open-northland/lockstep';
import { formatMessage, messages } from '../../i18n/index.js';
import { playerNameMapWithLang } from '../map/roster.js';
import type { LocalizedMapString } from '../map/strings.js';
import { computerLevelsOf } from './session-roles.js';

/** A seat's number as the player reads it: from one, as the lobby numbers the seats. */
export function seatNumber(player: number): number {
  return player + 1;
}

/** `name` with the computer's level beside it, "Wikingowie 1 (Trudny)". */
export function withComputerLevel(name: string, level: ComputerDifficulty): string {
  const copy = messages();
  return formatMessage(copy.hud.computerSeat, { name, level: copy.mainMenu.lobby.difficulty[level] });
}

/** The nick of the person sitting a seat, before the seat's name: "Seba (Wikingowie 1)". */
export function withSeatNick(nick: string, name: string): string {
  return formatMessage(messages().hud.seatNick, { nick, name });
}

/**
 * A seat's name in play: the map's authored name, with the lobby level beside it for a computer seat,
 * so two computers of one people stay apart. A seat a person sits in now leads with their nick; once
 * they leave it or turn to watching, it goes back to the map's name. An unnamed seat takes the lobby's
 * label, numbered from one, beside a computer's level or a nick; an unnamed person's seat without a nick
 * stays `undefined` for the HUD to number. An authored name a `translate` hands a foreign reading of is
 * translated per read, so a landed translation swaps in on the next display that asks; the nick and the
 * level labels wrap the translated name, never going into the engine themselves.
 */
export function seatNameMap(
  session: Pick<GameSession, 'seats'>,
  script: Pick<MapScript, 'players'> | null,
  lang: MapTextLanguage,
  seatedNickOf?: (player: number) => string | undefined,
  translate?: (found: LocalizedMapString) => string,
): (player: number) => string | undefined {
  const authoredWithLang = playerNameMapWithLang(script, lang);
  const authored = (player: number): string | undefined => {
    const found = authoredWithLang(player);
    if (found === undefined) return undefined;
    return translate === undefined ? found.text : translate(found);
  };
  const lobby = messages().mainMenu.lobby;
  const slotName = (player: number): string =>
    authored(player) ?? formatMessage(lobby.playerSlotLabel, { n: seatNumber(player) });
  const levelOf = computerLevelsOf(session);
  return (player) => {
    const nick = seatedNickOf?.(player);
    if (nick !== undefined) return withSeatNick(nick, slotName(player));
    const level = levelOf.get(player);
    if (level !== undefined) return withComputerLevel(slotName(player), level);
    return authored(player);
  };
}
