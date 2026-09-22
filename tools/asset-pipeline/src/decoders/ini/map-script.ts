/**
 * Map scripting reducer: `playerdata`/`playermisc`/`multiplayer`/`specialItems`/`AIData`/`MissionData`
 * sections into a validated {@link MapScript}. Token resolution accepts both source skins: the plaintext
 * `player.inc`/`mission.inc` macros (`#PLAYER_TYPE_HUMAN`) and the packed `map.cif` carrying those macros
 * already resolved to numbers.
 */
import {
  MAP_PLAYER_COLOR_COUNT,
  MAP_SPECIAL_ITEM_KIND_COUNT,
  MapAiCondition,
  MapAiModule,
  type MapAiSeat,
  MapAiTask,
  MapScript,
  type MapScriptLine,
  WERESNAKE_TRIBE,
  WEREWOLF_TRIBE,
} from '@open-northland/data';
import { GOOD_TYPE_CODES } from './good-type-codes.js';
import type { RuleProp, RuleSection } from './grammar.js';
import { HOUSE_TYPE_CODES } from './house-type-codes.js';
import { makeSource, type SourceRef } from './ir-fields.js';
import { codeOf } from './props.js';

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
  TRIBE_TYPE_HUMAN_WERESNAKE: WERESNAKE_TRIBE,
  TRIBE_TYPE_HUMAN_WEREWOLF: WEREWOLF_TRIBE,
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
  // The shipped file names six kinds where the engine's string table has seven (its 4 is "place the
  // house and fill its store"); the engine resolves a plaintext macro through this same file, so the
  // codes stay as written.
  SPECIAL_ITEM_TYPE_NONE: 0,
  SPECIAL_ITEM_TYPE_LETTER_OF_INDULGENCE: 1,
  SPECIAL_ITEM_TYPE_LETTER_TO_SET_ANY_HOUSE: 2,
  SPECIAL_ITEM_TYPE_LETTER_TO_SET_GIVEN_HOUSE: 3,
  SPECIAL_ITEM_TYPE_LETTER_TO_ALLOW_A_HOUSE: 4,
  SPECIAL_ITEM_TYPE_LETTER_TO_ALLOW_A_JOB: 5,
  SPECIAL_ITEM_TYPE_LETTER_TO_ALLOW_GOOD: 6,
  ...HOUSE_TYPE_CODES,
  ...GOOD_TYPE_CODES,
};

const PERMISSION_KINDS: Readonly<Record<string, 'job' | 'house' | 'good'>> = {
  allowjob: 'job',
  forbidjob: 'job',
  allowhouse: 'house',
  forbidhouse: 'house',
  allowgood: 'good',
  forbidgood: 'good',
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

const code = (token: string | undefined): number | undefined => codeOf(token, MACRO_CODES);

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

/** `add <player> <kind> [<houseType>]` to a starting paper, or undefined when malformed. */
function specialItemRow(p: RuleProp): MapScript['specialItems'][number] | undefined {
  const [playerRaw, kindRaw, paramRaw] = p.values;
  const player = int(playerRaw);
  const kind = code(kindRaw);
  const param = paramRaw === undefined ? 0 : code(paramRaw);
  if (player === undefined || player < 0 || param === undefined || param < 0) return undefined;
  if (kind === undefined || kind < 1 || kind > MAP_SPECIAL_ITEM_KIND_COUNT) return undefined;
  return { player, kind, param };
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

const RELATION_FLAG_KINDS: Readonly<Record<string, MapScript['relationFlags'][number]['kind']>> = {
  relationnotchangeable: 'notChangeable',
  relationhide: 'hide',
  relationhidedetails: 'hideDetails',
};

/** A `[playermisc]` `relation* <a> <b>` line to a row, or undefined for any other line or a malformed
 *  one. A missing second slot reads 0, as the loader's integer read returns 0 at the end of the line
 *  in the original: the corpus's five single-slot `relationhide` lines pair with player 0. */
function relationFlagRow(p: RuleProp): MapScript['relationFlags'][number] | undefined {
  const kind = RELATION_FLAG_KINDS[p.key];
  const [aRaw, bRaw] = p.values;
  const a = int(aRaw);
  const b = bRaw === undefined ? 0 : int(bRaw);
  if (kind === undefined || a === undefined || a < 0 || b === undefined || b < 0) return undefined;
  return { kind, a, b };
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

/** The `HAI_Disable<Module>` keywords, lower-cased, by the strategic module each one stops. */
const HAI_MODULE_KEYWORDS: Readonly<Record<string, MapAiModule>> = {
  hai_disablecollectresources: 'collectResources',
  hai_disableguidebuild: 'guideBuild',
  hai_disablehomeexpansion: 'homeExpansion',
  hai_disablemilitary: 'military',
  hai_disableroadbuild: 'roadBuild',
};

/** Ticks per authored minute and per authored second: the loader's own conversions of `OnTime` and
 *  `OnConditionChangeDelayed` arguments in the original. */
const TICKS_PER_MINUTE = 720;
const TICKS_PER_SECOND = 12;

/** The ints after the player of one `[AIData]` line, the way the loader reads them: each in turn, a
 *  macro through the code table, and a missing one as 0. Approximation: a token that is neither reads
 *  as 0, where the loader takes the first digits it finds in it; the corpus has one such token, on a
 *  slot no task reads. */
class AiLineReader {
  private next = 1;
  constructor(private readonly values: readonly string[]) {}
  int(): number {
    return code(this.values[this.next++]) ?? 0;
  }
  bool(): boolean {
    return this.int() !== 0;
  }
  /** Every remaining int, up to `limit`. */
  rest(limit: number): number[] {
    const out: number[] = [];
    while (this.next < this.values.length && out.length < limit) out.push(this.int());
    return out;
  }
}

/** The `AI_SetCondition_*` keywords, lower-cased, each reading its line the way the loader does. */
const AI_CONDITION_LINES: Readonly<Record<string, (slot: number, r: AiLineReader) => MapAiCondition>> = {
  ai_setcondition_true: (slot) => ({ kind: 'true', slot }),
  ai_setcondition_ontime: (slot, r) => ({ kind: 'onTime', slot, ticks: r.int() * TICKS_PER_MINUTE }),
  ai_setcondition_onconditions: (slot, r) => {
    const sticky = r.bool();
    return { kind: 'onConditions', slot, sticky, mode: r.int(), slots: r.rest(10) };
  },
  ai_setcondition_onconditionchangedelayed: (slot, r) => {
    const sticky = r.bool();
    const source = r.int();
    const onActivation = r.bool();
    return {
      kind: 'onConditionChangeDelayed',
      slot,
      sticky,
      source,
      onActivation,
      delayTicks: r.int() * TICKS_PER_SECOND,
    };
  },
  ai_setcondition_ondiplomacychange: (slot, r) => {
    const sticky = r.bool();
    const from = r.int();
    const to = r.int();
    return { kind: 'onDiplomacyChange', slot, sticky, from, to, state: r.int() };
  },
  ai_setcondition_oncreatureinrange: (slot, r) => {
    const sticky = r.bool();
    const x = r.int();
    const y = r.int();
    const range = r.int();
    const player = r.int();
    const enemiesOnly = r.bool();
    return {
      kind: 'onCreatureInRange',
      slot,
      sticky,
      x,
      y,
      range,
      player,
      enemiesOnly,
      soldiersOnly: r.bool(),
    };
  },
  ai_setcondition_onhouseinrange: (slot, r) => {
    const sticky = r.bool();
    const x = r.int();
    const y = r.int();
    const range = r.int();
    const player = r.int();
    const enemiesOnly = r.bool();
    const houseType = r.int();
    return {
      kind: 'onHouseInRange',
      slot,
      sticky,
      x,
      y,
      range,
      player,
      enemiesOnly,
      houseType,
      finishedOnly: r.bool(),
    };
  },
  ai_setcondition_onplayerseen: (slot, r) => {
    const sticky = r.bool();
    const seer = r.int();
    return { kind: 'onPlayerSeen', slot, sticky, seer, seen: r.int() };
  },
  ai_setcondition_onplayerdead: (slot, r) => ({ kind: 'onPlayerDead', slot, player: r.int() }),
  ai_setcondition_onnumberofsoldiers: (slot, r) => {
    const sticky = r.bool();
    const count = r.int();
    return { kind: 'onNumberOfSoldiers', slot, sticky, count, player: r.int() };
  },
  ai_setcondition_onexternal: (slot, r) => ({ kind: 'onExternal', slot, raised: r.bool() }),
  ai_setcondition_ontimer: (slot, r) => {
    const delayTicks = r.int();
    const activeTicks = r.int();
    return { kind: 'onTimer', slot, delayTicks, activeTicks, inactiveTicks: r.int() };
  },
};

/** The `AI_MainTask_*` keywords, lower-cased, each reading its line the way the loader does. */
const AI_TASK_LINES: Readonly<Record<string, (r: AiLineReader) => MapAiTask>> = {
  ai_maintask_defend: (r) => {
    const priority = r.int();
    const condition = r.int();
    const x = r.int();
    const y = r.int();
    const range = r.int();
    const min = r.int();
    return { kind: 'defend', priority, condition, x, y, range, min, max: r.int() };
  },
  ai_maintask_attack: (r) => {
    const priority = r.int();
    const condition = r.int();
    const x = r.int();
    const y = r.int();
    const range = r.int();
    const min = r.int();
    const max = r.int();
    const rallyX = r.int();
    const rallyY = r.int();
    return { kind: 'attack', priority, condition, x, y, range, min, max, rallyX, rallyY, stance: r.int() };
  },
  ai_maintask_createcreatures: (r) => {
    const priority = r.int();
    const condition = r.int();
    const tribe = r.int();
    const job = r.int();
    const x = r.int();
    const y = r.int();
    const missionId = r.int();
    const count = r.int();
    return {
      kind: 'createCreatures',
      priority,
      condition,
      tribe,
      job,
      x,
      y,
      missionId,
      count,
      once: r.bool(),
    };
  },
  ai_maintask_changediplomacy: (r) => {
    const priority = r.int();
    const condition = r.int();
    const player = r.int();
    return { kind: 'changeDiplomacy', priority, condition, player, state: r.int() };
  },
  ai_maintask_selfdestroyplayer: (r) => ({ kind: 'selfDestroyPlayer', condition: r.int() }),
};

/**
 * Folds one `[AIData]` section into `out`, one row per player, keyed case-insensitively like the
 * engine's token table: the seat toggles, the unit limits, the soldiers' default position and the
 * scripted handler's condition and task program.
 */
function aiSection(sec: RuleSection, out: MapAiSeat[]): void {
  for (const p of sec.props) {
    const key = p.key.toLowerCase();
    const player = int(p.values[0]);
    if (player === undefined || player < 0) continue;
    const seat = (): MapAiSeat => {
      let row = out.find((r) => r.player === player);
      if (row === undefined) {
        row = { player, disabled: false, strategicOff: [], conditions: [], tasks: [] };
        out.push(row);
      }
      return row;
    };
    const reader = new AiLineReader(p.values);
    const module = HAI_MODULE_KEYWORDS[key];
    const condition = AI_CONDITION_LINES[key];
    const task = AI_TASK_LINES[key];
    if (key === 'ai_disable') seat().disabled = true;
    else if (key === 'hai_disable' || module !== undefined) {
      const row = seat();
      const off = key === 'hai_disable' ? MapAiModule.options : [module as MapAiModule];
      for (const id of off) if (!row.strategicOff.includes(id)) row.strategicOff.push(id);
    } else if (key === 'ai_unitlimit') seat().unitLimit = reader.int();
    else if (key === 'ai_maxunitlimit') seat().maxUnitLimit = reader.int();
    else if (key === 'ai_soldiersdefaultposition') {
      const x = reader.int();
      const y = reader.int();
      seat().defaultPosition = { x, y, range: reader.int() };
    } else if (condition !== undefined) {
      // A row the schema refuses (a negative slot, range or count) is dropped here, where the loader
      // would read the value unsigned, rather than failing the whole sidecar at the final parse.
      const row = MapAiCondition.safeParse(condition(reader.int(), reader));
      if (row.success) seat().conditions.push(row.data);
    } else if (task !== undefined) {
      const row = MapAiTask.safeParse(task(reader));
      if (row.success) seat().tasks.push(row.data);
    }
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

/** `tradeagreement <houseId> <giveGood> <giveAmount> <takeGood> <takeAmount>`; a row short of five
 *  resolvable numbers is dropped, as the engine's own reader skips it. */
function tradeAgreementRow(p: RuleProp): MapScript['tradeAgreements'][number] | undefined {
  if (p.key !== 'tradeagreement') return undefined;
  const [missionId, giveGood, giveAmount, takeGood, takeAmount] = p.values.map(code);
  if (
    missionId === undefined ||
    giveGood === undefined ||
    giveAmount === undefined ||
    takeGood === undefined ||
    takeAmount === undefined ||
    giveGood < 0 ||
    takeGood < 0 ||
    giveAmount < 0 ||
    takeAmount < 0
  ) {
    return undefined;
  }
  return { missionId, giveGood, giveAmount, takeGood, takeAmount };
}

/** One `setname <humanId> <stringId>` row, or undefined when either id is malformed. */
function humanNameRow(p: RuleProp): MapScript['humanNames'][number] | undefined {
  if (p.key !== 'setname') return undefined;
  const humanId = int(p.values[0]);
  const stringId = int(p.values[1]);
  return humanId === undefined || stringId === undefined ? undefined : { humanId, stringId };
}

/**
 * Reduces a map's decoded sections into its validated {@link MapScript}, keeping every `playermisc`
 * line and unrecognized `playerdata` or `specialItems` line lossless in `misc`, the `misc_humannames`
 * rows typed, and one mission per repeated `MissionData` section in authored order. Section names match
 * case-insensitively (the corpus carries both `[AIData]` and `[aidata]`), and a duplicate `player`
 * slot keeps its first row. Returns undefined when no section yields anything, and the caller then
 * emits no script sidecar.
 */
export function extractMapScript(sections: readonly RuleSection[], src: SourceRef): MapScript | undefined {
  const permissions: NonNullable<MapScript['permissions']> = [];
  const players: NonNullable<MapScript['players']> = [];
  const seenSlots = new Set<number>();
  const diplomacy: NonNullable<MapScript['diplomacy']> = [];
  const relationFlags: NonNullable<MapScript['relationFlags']> = [];
  const specialItems: NonNullable<MapScript['specialItems']> = [];
  const ai: MapAiSeat[] = [];
  const misc: NonNullable<MapScript['misc']> = [];
  const humanNames: NonNullable<MapScript['humanNames']> = [];
  const tradeAgreements: NonNullable<MapScript['tradeAgreements']> = [];
  const missions: NonNullable<MapScript['missions']> = [];
  let multiplayer: NonNullable<MapScript['multiplayer']> | undefined;
  for (const sec of sections) {
    const name = sec.name.toLowerCase();
    if (name === 'allowedthings') {
      for (const p of sec.props) {
        const kind = PERMISSION_KINDS[p.key];
        const allowed = p.key.startsWith('allow');
        const [player, tribe, typeId] = p.values.map(code);
        if (
          kind !== undefined &&
          (allowed || p.key.startsWith('forbid')) &&
          player !== undefined &&
          player >= 0 &&
          tribe !== undefined &&
          tribe >= 0 &&
          typeId !== undefined &&
          typeId >= 0
        ) {
          permissions.push({ player, tribe, kind, typeId, allowed });
        } else misc.push(asLine(p));
      }
    } else if (name === 'misc_humannames') {
      for (const p of sec.props) {
        const row = humanNameRow(p);
        if (row !== undefined) humanNames.push(row);
      }
    } else if (name === 'misc_tradeagreement') {
      for (const p of sec.props) {
        const row = tradeAgreementRow(p);
        if (row !== undefined) tradeAgreements.push(row);
      }
    } else if (name === 'playerdata') {
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
      for (const p of sec.props) {
        const row = relationFlagRow(p);
        if (row === undefined) misc.push(asLine(p));
        else relationFlags.push(row);
      }
    } else if (name === 'specialitems') {
      for (const p of sec.props) {
        const row = p.key === 'add' ? specialItemRow(p) : undefined;
        if (row === undefined) misc.push(asLine(p));
        else specialItems.push(row);
      }
    } else if (name === 'multiplayer') {
      multiplayer ??= { slotOptions: [], hiddenSlots: [], other: [] };
      multiplayerSection(sec, multiplayer);
    } else if (name === 'aidata') {
      aiSection(sec, ai);
    } else if (name === 'missiondata') {
      missions.push(mission(sec));
    }
  }
  const playerLines =
    players.length + diplomacy.length + relationFlags.length + specialItems.length + misc.length;
  const scripted =
    playerLines +
    missions.length +
    humanNames.length +
    permissions.length +
    ai.length +
    tradeAgreements.length;
  if (scripted === 0 && multiplayer === undefined) return undefined;
  return MapScript.parse({
    players,
    ...(permissions.length > 0 ? { permissions } : {}),
    diplomacy,
    relationFlags,
    ai,
    multiplayer,
    specialItems,
    misc,
    humanNames,
    tradeAgreements,
    missions,
    // Provenance names the section the payload actually came from, not a fixed `playerdata`.
    source: makeSource(
      src,
      playerLines > 0
        ? 'playerdata'
        : missions.length > 0
          ? 'MissionData'
          : ai.length > 0
            ? 'AIData'
            : 'multiplayer',
    ),
  });
}
