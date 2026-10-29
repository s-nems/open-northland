import { components, entitiesWith, fx, systems, type WorldSnapshot } from '@open-northland/sim';
import type { AdminAiSeat, AdminAiTable } from '../../hud/dom/admin-panel/model.js';
import { formatMessage, type Messages } from '../../i18n/index.js';
import {
  type AiScriptInputs,
  intelTables,
  intentTables,
  militaryTable,
  pupilsBySeat,
  readSeatMind,
  type SeatMind,
  technologyTables,
} from './ai-mind.js';
import { readSeatWork, type SeatWork, workTables } from './ai-work.js';

const { COMPUTER_DIFFICULTIES } = components;

/** One seat whose computer controller runs, as the snapshot holds it. */
export interface AiSeatReading extends systems.SeatStrategyView {
  readonly player: number;
  readonly difficulty: components.ComputerDifficulty;
  readonly mind: SeatMind;
  readonly work: SeatWork;
}

/** The sim's last answer on a computer seat's apprentices; undefined until one landed. */
export type ApprenticesOf = (player: number) => readonly systems.ApprenticeView[] | undefined;

/** The goods whose deposits the band table sums, in row order. */
const BAND_GOOD_IDS: readonly string[] = ['wood', 'stone', 'mud'];
/** The seat brief's access key for fish, which the goods catalog names too. */
const FISH = 'fish';
const NO_VALUE = '-';

function isDifficulty(value: unknown): value is components.ComputerDifficulty {
  return COMPUTER_DIFFICULTIES.some((difficulty) => difficulty === value);
}

/** Every seat whose lowest-id `AiControl` carrier lets the computer controller run, ascending by slot,
 *  with its saved strategy, its seat brief, its mind and its work. Reads the indexed carriers and
 *  lessons, never the entity list. */
export function readAiSeats(
  snapshot: WorldSnapshot,
  scripts: AiScriptInputs | null,
  apprenticesOf: ApprenticesOf = () => undefined,
): AiSeatReading[] {
  const scan = entitiesWith(snapshot, 'MapBrief')[0]?.components.MapBrief as
    | components.MapBriefView
    | undefined;
  const brief = scan?.scanned === true ? scan : null;
  const pupils = pupilsBySeat(snapshot);
  const seen = new Set<number>();
  const seats: AiSeatReading[] = [];
  for (const carrier of entitiesWith(snapshot, 'AiControl')) {
    const control = carrier.components.AiControl as
      | { player?: unknown; computerEnabled?: unknown; difficulty?: unknown }
      | undefined;
    const player = control?.player;
    if (typeof player !== 'number' || seen.has(player)) continue;
    seen.add(player);
    if (control?.computerEnabled !== true || !isDifficulty(control.difficulty)) continue;
    const strategy = carrier.components.ComputerStrategy as components.ComputerStrategyState | undefined;
    seats.push({
      player,
      difficulty: control.difficulty,
      strategy: strategy ?? null,
      brief: brief === null ? null : systems.seatBriefOf(brief, player),
      mind: readSeatMind(snapshot.tick, carrier, player, brief, scripts, pupils.get(player)),
      work: readSeatWork(snapshot, carrier, scripts?.content ?? null, apprenticesOf(player)),
    });
  }
  return seats.sort((a, b) => a.player - b.player);
}

const listed = (items: readonly string[]): string => (items.length === 0 ? NO_VALUE : items.join(', '));

/** The AI tab's blocks: per seat its strategy, military plan and posture, the forces and zones it
 *  remembers, the map's objectives and forecast attacks, its pupils, operations and apprentices, then
 *  the home and near bands, the access to the goods it plans by, and the other seats' starts. Codes
 *  (archetype, sides, evidence) show raw. */
export function aiSeatRows(seats: readonly AiSeatReading[], msgs: Messages): AdminAiSeat[] {
  const copy = msgs.admin.ai;
  const goodName = (id: string): string => msgs.goods[id as keyof Messages['goods']] ?? id;
  return seats.map((seat) => {
    const title = formatMessage(copy.seat, {
      player: seat.player,
      difficulty: msgs.mainMenu.lobby.difficulty[seat.difficulty],
    });
    const economy = seat.strategy?.economy;
    const strategy: string[][] =
      economy === undefined
        ? [[copy.archetype, copy.undecided]]
        : [
            [copy.archetype, economy.archetype],
            [copy.sides, listed(economy.sides)],
            [copy.evidence, listed(economy.evidence)],
            [copy.decided, formatMessage(copy.decidedAt, { tick: economy.decidedAt })],
            ...(economy.challenger === null
              ? []
              : [[copy.challenger, formatMessage(copy.challengerValue, { ...economy.challenger })]]),
          ];
    const military = seat.strategy?.military;
    const tables: AdminAiTable[] = [
      { head: null, rows: strategy },
      militaryTable(military, msgs),
      ...intelTables(seat.mind, military?.ownPoints ?? null, msgs),
      ...intentTables(seat.mind, msgs),
      ...technologyTables(seat.mind, msgs),
      ...workTables(seat.work, msgs),
    ];
    const brief = seat.brief;
    if (brief === null) return { title, note: copy.noScan, tables };

    const band = (label: string, of: (sums: systems.ZoneSums) => number | undefined): string[] => {
      const cell = (sums: systems.ZoneSums): string => String(of(sums) ?? NO_VALUE);
      return [label, cell(brief.home), cell(brief.near)];
    };
    tables.push({
      head: [copy.band, copy.home, copy.near],
      rows: [
        band(copy.zones, (s) => s.zones),
        band(copy.free, (s) => s.free),
        band(copy.clearable, (s) => s.clearable),
        band(copy.blocked, (s) => s.blocked),
        band(copy.grass, (s) => s.plantable),
        ...BAND_GOOD_IDS.map((id) => band(goodName(id), (s) => s.deposits.get(id))),
        band(goodName(FISH), (s) => s.fish),
      ],
    });

    // The brief's own order: its exclusive goods, then fish.
    const access = [...brief.access].map(([key, reach]) => [
      goodName(key),
      copy.accessClasses[reach.access],
      String(reach.zones ?? NO_VALUE),
    ]);
    tables.push({ head: [copy.deposit, copy.access, copy.zones], rows: access });

    if (brief.others.length > 0) {
      tables.push({
        head: [copy.seatColumn, copy.direction, copy.distance, copy.land],
        rows: brief.others.map((other) => [
          formatMessage(copy.player, { player: other.player }),
          copy.directions[other.direction],
          String(Math.round(fx.toFloat(other.distance))),
          other.sameLand ? copy.sameLand : copy.overSea,
        ]),
      });
    }
    return { title, note: null, tables };
  });
}
