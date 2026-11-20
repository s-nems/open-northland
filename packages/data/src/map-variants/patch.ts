import { isLanguage, textReadingOrder } from '../languages.js';
import { mapSlotEligibility } from '../map-lobby.js';
import { type MapCells, onMap } from '../map-modules/fit.js';
import type { MapBriefing } from '../schema/maps/briefing.js';
import type { TerrainEntities } from '../schema/maps/entities.js';
import type { MapsIndexPlayerSlot } from '../schema/maps/listing.js';
import type { MapMission, MapRelationFlag, MapScript } from '../schema/maps/script.js';
import type { MapStrings } from '../schema/maps/strings.js';
import type { MapVariant, MapVariantStartSeat } from './schema.js';

const ACTIVATE_MISSION = 'ActivateMission';

/**
 * The map's script as the variant plays it. Throws when the variant names a mission the script lacks
 * or leaves a kept mission activating a neutralised one: either means the variant was written for
 * another version of the map, and playing it half-applied would be a third map.
 */
export function applyMapVariantScript(script: MapScript, variant: MapVariant): MapScript {
  const patch = variant.script;
  const seats = new Set(script.players.map((row) => row.player));
  for (const { player } of patch.slotOptions) {
    if (!seats.has(player)) throw new Error(`${label(variant)}: the script has no seat ${player} to offer`);
  }
  const traders = new Set(script.tradeAgreements.map((row) => row.missionId));
  for (const house of patch.droppedTradeHouses) {
    if (!traders.has(house)) throw new Error(`${label(variant)}: the script has no trade house ${house}`);
  }
  const indexOf = missionIndexes(script.missions, variant);
  const neutralized = new Set(patch.neutralizedMissions.map(indexOf));
  const appended = new Map<number, MapMission['results']>();
  for (const row of patch.appendedResults) {
    const index = indexOf(row.mission);
    if (neutralized.has(index)) throw new Error(`${label(variant)}: appends to neutralised ${row.mission}`);
    appended.set(index, [...(appended.get(index) ?? []), ...row.results]);
  }
  const missions = script.missions.map((mission, index): MapMission => {
    if (neutralized.has(index)) return neutralizedMission(mission);
    const extra = appended.get(index);
    return extra === undefined ? mission : { ...mission, results: [...mission.results, ...extra] };
  });
  missions.forEach((mission, index) => {
    if (neutralized.has(index)) return;
    for (const line of mission.results) {
      const target = line.values[0] === ACTIVATE_MISSION ? Number(line.values[1]) : null;
      if (target !== null && neutralized.has(target))
        throw new Error(
          `${label(variant)}: ${mission.debugName ?? index} still activates neutralised ${target}`,
        );
    }
  });
  const dropped = new Set(patch.droppedTradeHouses);
  return {
    ...script,
    specialItems: copiedSeatRows(script.specialItems, variant, (row, player) => ({ ...row, player })),
    relationFlags: copiedRelationFlags(script.relationFlags, variant),
    ai: patchedAi(script.ai, variant),
    ...(script.multiplayer === undefined && patch.slotOptions.length === 0
      ? {}
      : { multiplayer: patchedMultiplayer(script.multiplayer, patch.slotOptions) }),
    tradeAgreements: script.tradeAgreements.filter((row) => !dropped.has(row.missionId)),
    missions,
  };
}

/**
 * Throws when the variant does not fit the map it is played on: a placed object off the map, whose
 * `size` is in cells, which means the variant was written for another version of it. Its modules have
 * their own check, `assertMapModulesFitMap`.
 */
export function assertMapVariantFitsMap(variant: MapVariant, size: MapCells): void {
  for (const row of variant.landscapeObjects) {
    if (!onMap(size, row.hx, row.hy))
      throw new Error(`${label(variant)}: places ${row.object} at (${row.hx}, ${row.hy}), off the map`);
  }
}

/** The map's placements as the variant starts them: each start seat's copied settlers after the
 *  authored ones, its own left out. A copy carries no mission object id, house or vehicle attachment,
 *  which name the source seat's own objects. Throws when a shift moves a settler off the map, whose
 *  `size` is in cells. */
export function applyMapVariantEntities(
  entities: TerrainEntities,
  variant: MapVariant,
  size: MapCells,
): TerrainEntities {
  if (variant.startSeats.length === 0) return entities;
  const humans = copiedSeatRows(entities.humans, variant, (human, player, seat) => {
    const { missionId: _id, attach: _attach, boardVehicleAt: _vehicle, ...copy } = human;
    const hx = human.hx + seat.dx;
    const hy = human.hy + seat.dy;
    if (!onMap(size, hx, hy)) throw new Error(`${label(variant)}: seat ${player}'s start leaves the map`);
    return { ...copy, player, hx, hy };
  });
  return { ...entities, humans };
}

/** The map's briefing as the variant tells it: each page the variant writes replaces that page in every
 *  language the briefing carries it in. A map without a briefing stays without one. */
export function applyMapVariantBriefing(briefing: MapBriefing, variant: MapVariant): MapBriefing {
  const written = variant.briefingPages;
  if (written === undefined) return briefing;
  const texts: MapBriefing['texts'] = {};
  for (const [lang, pages] of Object.entries(briefing.texts)) {
    const patched = { ...pages };
    for (const [id, byLanguage] of Object.entries(written)) {
      const page = isLanguage(lang)
        ? textReadingOrder(lang)
            .map((candidate) => byLanguage[candidate])
            .find((blocks) => blocks !== undefined)
        : undefined;
      if (pages[id] !== undefined && page !== undefined) patched[id] = page;
    }
    texts[lang] = patched;
  }
  return { ...briefing, texts };
}

/** The map's string table with the variant's strings added, each under its id in every language it is
 *  written in. Throws on an id the map's table already uses in that language. */
export function applyMapVariantStrings(strings: MapStrings | null, variant: MapVariant): MapStrings | null {
  const added = Object.entries(variant.strings);
  if (added.length === 0) return strings;
  const patched: MapStrings = { ...strings };
  for (const [id, byLanguage] of added) {
    for (const [lang, text] of Object.entries(byLanguage)) {
      if (!isLanguage(lang) || text === undefined) continue;
      const table = { ...patched[lang] };
      if (table[id] !== undefined) throw new Error(`${label(variant)}: map string ${id} is taken in ${lang}`);
      table[id] = text;
      patched[lang] = table;
    }
  }
  return patched;
}

/** The lobby rows of a map index entry as the variant offers them: only the eligibility a replaced
 *  `playeroption` row decides changes. */
export function applyMapVariantSlots(
  slots: readonly MapsIndexPlayerSlot[],
  variant: MapVariant,
): MapsIndexPlayerSlot[] {
  const options = new Map(variant.script.slotOptions.map((row) => [row.player, row.allowed]));
  return slots.map((slot) => {
    const allowed = options.get(slot.player);
    return allowed === undefined ? slot : { ...slot, ...mapSlotEligibility(slot.type, allowed) };
  });
}

/** `rows` with each start seat's own rows left out and copies of its source seat's appended, in the
 *  start seats' order. Throws on a seat started twice or started from another start seat. */
function copiedSeatRows<T extends { readonly player: number }>(
  rows: readonly T[],
  variant: MapVariant,
  copy: (row: T, player: number, seat: MapVariantStartSeat) => T,
): T[] {
  const seats = startSeatsOf(variant);
  if (seats.size === 0) return [...rows];
  const kept = rows.filter((row) => !seats.has(row.player));
  const copies = variant.startSeats.flatMap((seat) =>
    rows.filter((row) => row.player === seat.from).map((row) => copy(row, seat.player, seat)),
  );
  return [...kept, ...copies];
}

/** The relation flags with each start seat's own rows replaced: every row between seats that are not
 *  start seats is kept and copied onto each pair its seats start, a start seat standing in for its
 *  source. Two seats started from one source get no row between them, as the source has none with itself. */
function copiedRelationFlags(rows: readonly MapRelationFlag[], variant: MapVariant): MapRelationFlag[] {
  const seats = startSeatsOf(variant);
  if (seats.size === 0) return [...rows];
  const startedAs = (seat: number): number[] => [
    seat,
    ...variant.startSeats.filter(({ from }) => from === seat).map(({ player }) => player),
  ];
  const kept = rows.filter((row) => !seats.has(row.a) && !seats.has(row.b));
  const copies = kept.flatMap((row) =>
    startedAs(row.a).flatMap((a) =>
      startedAs(row.b).flatMap((b) => (a === row.a && b === row.b ? [] : [{ ...row, a, b }])),
    ),
  );
  return [...kept, ...copies];
}

function startSeatsOf(variant: MapVariant): ReadonlySet<number> {
  const seats = new Set<number>();
  for (const { player } of variant.startSeats) {
    if (seats.has(player)) throw new Error(`${label(variant)}: starts seat ${player} twice`);
    seats.add(player);
  }
  for (const { from } of variant.startSeats) {
    if (seats.has(from)) throw new Error(`${label(variant)}: starts a seat from start seat ${from}`);
  }
  return seats;
}

function missionIndexes(missions: readonly MapMission[], variant: MapVariant): (name: string) => number {
  const byName = new Map<string, number>();
  // A repeated label cannot name one mission, so the variant may not use it.
  const repeated = new Set<string>();
  missions.forEach((mission, index) => {
    if (mission.debugName === undefined) return;
    if (byName.has(mission.debugName)) repeated.add(mission.debugName);
    byName.set(mission.debugName, index);
  });
  return (name) => {
    const index = byName.get(name);
    if (index === undefined || repeated.has(name))
      throw new Error(`${label(variant)}: the script has no single mission named ${name}`);
    return index;
  };
}

/** Each seat's rows with the variant's tasks after its authored ones. */
function patchedAi(rows: MapScript['ai'], variant: MapVariant): MapScript['ai'] {
  const appended = variant.script.appendedAiTasks;
  for (const row of appended) {
    if (!rows.some((seat) => seat.player === row.player))
      throw new Error(`${label(variant)}: the script has no [AIData] rows for seat ${row.player}`);
  }
  if (appended.length === 0) return rows;
  return rows.map((seat) => {
    const extra = appended.filter((row) => row.player === seat.player).flatMap((row) => row.tasks);
    return extra.length === 0 ? seat : { ...seat, tasks: [...seat.tasks, ...extra] };
  });
}

function neutralizedMission(mission: MapMission): MapMission {
  return {
    ...(mission.debugName === undefined ? {} : { debugName: mission.debugName }),
    goals: [],
    results: [],
    other: [],
  };
}

function patchedMultiplayer(
  table: MapScript['multiplayer'],
  rows: MapVariant['script']['slotOptions'],
): NonNullable<MapScript['multiplayer']> {
  const replaced = new Set(rows.map((row) => row.player));
  const kept = (table?.slotOptions ?? []).filter((row) => !replaced.has(row.player));
  return {
    hiddenSlots: [],
    other: [],
    ...table,
    slotOptions: [...kept, ...rows].sort((a, b) => a.player - b.player),
  };
}

function label(variant: MapVariant): string {
  return `map variant ${variant.mapId}/${variant.kind}`;
}
