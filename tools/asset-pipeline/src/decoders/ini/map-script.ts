/**
 * Map scripting reducer: `playerdata`/`playermisc`/`multiplayer`/`MissionData` sections into a validated
 * {@link MapScript}. Token resolution accepts both source skins: the plaintext `player.inc`/`mission.inc`
 * macros (`#PLAYER_TYPE_HUMAN`) and the packed `map.cif` carrying those macros already resolved to numbers.
 */
import { MAP_PLAYER_COLOR_COUNT, MapScript, type MapScriptLine } from '@open-northland/data';
import { makeSource, type RuleProp, type RuleSection, type SourceRef } from './grammar.js';

/**
 * The `#define` codes the plaintext macros resolve through, from the owned copy's
 * `Data/GameSourceIncludes/logicdefines.inc`. Keys are upper-cased because the corpus spells macros in
 * mixed case (`#PLAYER_TYPE_human`, `#TRIBE_TYPE_HUMAN_viking`).
 */
const MACRO_CODES: Readonly<Record<string, number>> = {
  PLAYER_TYPE_NONE: 0,
  PLAYER_TYPE_HUMAN: 1,
  PLAYER_TYPE_AI: 2,
  TRIBE_TYPE_HUMAN_VIKING: 1,
  TRIBE_TYPE_HUMAN_FRANK: 2,
  TRIBE_TYPE_HUMAN_BYZANTINE: 3,
  TRIBE_TYPE_HUMAN_SARACEN: 4,
  TRIBE_TYPE_HUMAN_WERESNAKE: 5,
  TRIBE_TYPE_HUMAN_WEREWOLF: 6,
  TRIBE_TYPE_HUMAN_EGYPT: 7,
  PLAYER_COLOR_ID_BLUE: 0,
  PLAYER_COLOR_ID_RED: 1,
  PLAYER_COLOR_ID_YELLOW: 2,
  PLAYER_COLOR_ID_CYAN: 3,
  PLAYER_COLOR_ID_GREEN: 4,
  PLAYER_COLOR_ID_PURPLE: 5,
  PLAYER_COLOR_ID_GREY: 6,
  PLAYER_COLOR_ID_ORANGE: 7,
  PLAYER_COLOR_ID_NEON: 8,
  PLAYER_COLOR_ID_BLACK: 9,
  DIPLOMACY_STATE_FRIEND: 1,
  DIPLOMACY_STATE_NEUTRAL: 2,
  DIPLOMACY_STATE_ENEMY: 3,
};

const PLAYER_TYPE_NONE = 0;
const PLAYER_TYPE_HUMAN = 1;
const PLAYER_TYPE_AI = 2;
const PLAYER_TYPE_NAMES: Readonly<Record<number, 'human' | 'ai' | 'none'>> = {
  [PLAYER_TYPE_NONE]: 'none',
  [PLAYER_TYPE_HUMAN]: 'human',
  [PLAYER_TYPE_AI]: 'ai',
};
const DIPLOMACY_NAMES: Readonly<Record<number, 'friend' | 'neutral' | 'enemy'>> = {
  1: 'friend',
  2: 'neutral',
  3: 'enemy',
};

/** Resolves one token to its numeric code: a plain int, or a `#MACRO` (case-insensitive). */
function code(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  if (/^-?\d+$/.test(token)) return Number.parseInt(token, 10);
  if (token.startsWith('#')) return MACRO_CODES[token.slice(1).toUpperCase()];
  return undefined;
}

function int(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  const n = Number.parseInt(token, 10);
  return Number.isNaN(n) ? undefined : n;
}

function asLine(p: RuleProp): MapScriptLine {
  return { key: p.key, values: [...p.values] };
}

/** `player <slot> <type> <tribe> <colorId>` to a roster row, or undefined when malformed. The range
 *  checks mirror the {@link MapScript} schema so an out-of-range row degrades to `misc` instead of
 *  failing the whole map's sidecar at the final parse. */
function playerRow(p: RuleProp): MapScript['players'][number] | undefined {
  const [slotRaw, typeRaw, tribeRaw, colorRaw] = p.values;
  const player = int(slotRaw);
  const type = code(typeRaw);
  const tribeId = code(tribeRaw);
  const colorId = code(colorRaw);
  if (player === undefined || player < 0 || tribeId === undefined || tribeId < 1) return undefined;
  if (colorId === undefined || colorId < 0 || colorId >= MAP_PLAYER_COLOR_COUNT) return undefined;
  if (type !== PLAYER_TYPE_HUMAN && type !== PLAYER_TYPE_AI) return undefined;
  return { player, type: type === PLAYER_TYPE_HUMAN ? 'human' : 'ai', tribeId, colorId };
}

/** `diplomacy <from> <to> <state>` to a matrix row, or undefined when malformed. */
function diplomacyRow(p: RuleProp): MapScript['diplomacy'][number] | undefined {
  const [fromRaw, toRaw, stateRaw] = p.values;
  const from = int(fromRaw);
  const to = int(toRaw);
  const state = DIPLOMACY_NAMES[code(stateRaw) ?? -1];
  if (from === undefined || from < 0 || to === undefined || to < 0 || state === undefined) {
    return undefined;
  }
  return { from, to, state };
}

/**
 * Folds one `[multiplayer]` section into the accumulator, which stays mutable so a map splitting the
 * section across inc files still merges into one table. Unrecognized lines stay lossless in `other`,
 * including the corpus's hand-wrapped `playeroption` continuation lines (a bare `#PLAYER_TYPE_NONE` on
 * its own line), which the original's keyed line parser would not attach either.
 */
function multiplayerSection(sec: RuleSection, out: NonNullable<MapScript['multiplayer']>): void {
  for (const p of sec.props) {
    if (p.key === 'playeroption') {
      const player = int(p.values[0]);
      const allowed = p.values
        .slice(1)
        .map((token) => PLAYER_TYPE_NAMES[code(token) ?? -1])
        .filter((t): t is NonNullable<typeof t> => t !== undefined);
      if (player !== undefined && player >= 0 && allowed.length > 0) {
        if (!out.slotOptions.some((s) => s.player === player)) {
          out.slotOptions.push({ player, allowed: [...new Set(allowed)] });
        }
        continue;
      }
    } else if (p.key === 'playerhideinmenu') {
      const slots = p.values.map(int).filter((n): n is number => n !== undefined && n >= 0);
      if (slots.length > 0) {
        for (const slot of slots) if (!out.hiddenSlots.includes(slot)) out.hiddenSlots.push(slot);
        continue;
      }
    } else if (p.key === 'playerfixcolors') {
      // Presence implies locked: a bare or unparsable value reads as `1` (the corpus only authors `1`).
      out.fixedColors = int(p.values[0]) !== 0;
      continue;
    }
    out.other.push(asLine(p));
  }
}

/** One repeated `MissionData` section as a trigger: typed header scalars, lossless goal/result lines. */
function mission(sec: RuleSection): MapScript['missions'][number] {
  const out: MapScript['missions'][number] = { goals: [], results: [], other: [] };
  for (const p of sec.props) {
    switch (p.key) {
      case 'debuginfo':
        if (p.values[0] !== undefined) out.debugName = p.values[0];
        break;
      case 'description': {
        const id = int(p.values[0]);
        if (id !== undefined) out.descriptionStringId = id;
        break;
      }
      case 'active':
        out.active = int(p.values[0]) !== 0;
        break;
      case 'visible':
        out.visible = int(p.values[0]) !== 0;
        break;
      case 'successfullif': {
        const n = int(p.values[0]);
        if (n !== undefined) out.successfullIf = n;
        break;
      }
      case 'goal':
        out.goals.push(asLine(p));
        break;
      case 'result':
        out.results.push(asLine(p));
        break;
      default:
        out.other.push(asLine(p));
    }
  }
  return out;
}

/**
 * Reduces a map's decoded sections into its validated {@link MapScript}, keeping every `playermisc`
 * line and unrecognized `playerdata` line lossless in `misc` and one mission per repeated `MissionData`
 * section in authored order. Section names match case-insensitively (the corpus carries both `[AIData]`
 * and `[aidata]`), and a duplicate `player` slot keeps its first row. Returns undefined when no section
 * yields anything, and the caller then emits no script sidecar. `aidata`, the AI task and condition
 * program, is out of scope here.
 */
export function extractMapScript(sections: readonly RuleSection[], src: SourceRef): MapScript | undefined {
  const players: NonNullable<MapScript['players']> = [];
  const seenSlots = new Set<number>();
  const diplomacy: NonNullable<MapScript['diplomacy']> = [];
  const misc: NonNullable<MapScript['misc']> = [];
  const missions: NonNullable<MapScript['missions']> = [];
  let multiplayer: NonNullable<MapScript['multiplayer']> | undefined;
  for (const sec of sections) {
    const name = sec.name.toLowerCase();
    if (name === 'playerdata') {
      for (const p of sec.props) {
        if (p.key === 'player') {
          const row = playerRow(p);
          if (row !== undefined && !seenSlots.has(row.player)) {
            seenSlots.add(row.player);
            players.push(row);
            continue;
          }
        } else if (p.key === 'diplomacy') {
          const row = diplomacyRow(p);
          if (row !== undefined) {
            diplomacy.push(row);
            continue;
          }
        }
        misc.push(asLine(p));
      }
    } else if (name === 'playermisc') {
      for (const p of sec.props) misc.push(asLine(p));
    } else if (name === 'multiplayer') {
      multiplayer ??= { slotOptions: [], hiddenSlots: [], other: [] };
      multiplayerSection(sec, multiplayer);
    } else if (name === 'missiondata') {
      missions.push(mission(sec));
    }
  }
  if (players.length + diplomacy.length + misc.length + missions.length === 0 && multiplayer === undefined) {
    return undefined;
  }
  return MapScript.parse({
    players,
    diplomacy,
    multiplayer,
    misc,
    missions,
    // Provenance names the section the payload actually came from, not a fixed `playerdata`.
    source: makeSource(
      src,
      players.length + diplomacy.length + misc.length > 0
        ? 'playerdata'
        : missions.length > 0
          ? 'MissionData'
          : 'multiplayer',
    ),
  });
}
