import type { HypertextParagraph, MapBriefing, MapScript, MapScriptLine } from '@open-northland/data';
import type { MatchOutcome } from '@open-northland/sim';

/**
 * What the mission window shows for one world: the map's briefing page and its goals. Pure joins over
 * the decoded script and briefing sidecars; the window itself is HUD.
 */
export interface MissionGoal {
  readonly text: string;
  /** An authored trigger's description is listed as information; the skirmish rule is what decides. */
  readonly rule: 'authored' | 'skirmish';
  readonly done: boolean;
}

export interface MissionBrief {
  readonly title: string;
  /** The briefing text; a map without one reads its menu description, a scene its summary. */
  readonly paragraphs: readonly HypertextParagraph[];
  readonly goals: readonly MissionGoal[];
}

const GOAL_TRUE = 'True';
const GOAL_TIME_GONE = 'TimeGone';
/** A `TimeGone <n>` goal up to this fires as good as at once. Observation over the decoded maps: most
 *  briefings open on `True` or `TimeGone 0`, a few on `TimeGone 1`. */
const IMMEDIATE_TIME_GONE_LIMIT = 1;
const RESULT_PLAY_CUTSCENE = 'PlayCutscene';
/** A goal description starting with this is printed without it, in the window's emphasis colour
 *  (approximation: the emphasis is not applied). */
const GOAL_EMPHASIS_MARK = '@';
/** The mission window's language order: the app locale, then the mod's authoring language. */
const BRIEFING_LANG_FALLBACKS = ['pol', 'eng'] as const;

/** Whether a goal line holds from the first ticks: `True`, or a `TimeGone` that has as good as passed. */
function firesAtOnce(goal: MapScriptLine): boolean {
  if (goal.values[0] === GOAL_TRUE) return true;
  if (goal.values[0] !== GOAL_TIME_GONE) return false;
  const after = Number.parseInt(goal.values[1] ?? '', 10);
  return Number.isInteger(after) && after <= IMMEDIATE_TIME_GONE_LIMIT;
}

/**
 * The cutscene the map opens on: the first active trigger whose goals all fire at once and whose
 * results play one. Null when the map opens on no briefing.
 */
export function introCutsceneId(script: Pick<MapScript, 'missions'>): number | null {
  for (const mission of script.missions) {
    if (mission.active === false || mission.goals.length === 0 || !mission.goals.every(firesAtOnce)) continue;
    for (const line of mission.results) {
      if (line.values[0] !== RESULT_PLAY_CUTSCENE) continue;
      const id = Number.parseInt(line.values[1] ?? '', 10);
      if (Number.isInteger(id) && id >= 0) return id;
    }
  }
  return null;
}

/** The goal texts of the triggers the author marked visible and active, in script order, deduplicated.
 *  Approximation: whether the original lists a visible trigger that starts inactive is unobserved. */
export function missionGoals(script: Pick<MapScript, 'missions'>): string[] {
  const goals: string[] = [];
  for (const mission of script.missions) {
    if (mission.active === false || mission.visible === false) continue;
    const raw = mission.description?.trim();
    const text = raw?.startsWith(GOAL_EMPHASIS_MARK) ? raw.slice(GOAL_EMPHASIS_MARK.length).trim() : raw;
    if (text === undefined || text === '' || goals.includes(text)) continue;
    goals.push(text);
  }
  return goals;
}

/** The briefing page for `id` in `lang`, falling back through the authoring languages. */
export function briefingPage(
  briefing: MapBriefing | null,
  lang: string,
  id: number | null,
): readonly HypertextParagraph[] | null {
  if (briefing === null || id === null) return null;
  for (const candidate of [lang, ...BRIEFING_LANG_FALLBACKS]) {
    const page = briefing.texts[candidate]?.[String(id)];
    if (page !== undefined && page.length > 0) return page;
  }
  return null;
}

export interface MapBriefInput {
  readonly script: MapScript | null;
  readonly briefing: MapBriefing | null;
  readonly lang: string;
  readonly name: string | undefined;
  readonly description: string | undefined;
  /** The skirmish goal text, listed whenever a match runs: it is the rule that actually decides. */
  readonly skirmishGoal: string;
  /** Whether the world declared a match with someone to beat. */
  readonly matchDeclared: boolean;
}

/**
 * Assemble a decoded map's brief. The briefing page's own headline is the title when it has one and
 * is not repeated in the body; otherwise the map name heads the page and the menu description is the
 * body. The authored goals come first; the skirmish rule follows unless the author already wrote it.
 */
export function mapMissionBrief(input: MapBriefInput): MissionBrief {
  const script = input.script;
  const page = script === null ? null : briefingPage(input.briefing, input.lang, introCutsceneId(script));
  const authored = script === null ? [] : missionGoals(script);
  const goals: MissionGoal[] = authored.map((text) => ({ text, rule: 'authored', done: false }));
  if (input.matchDeclared && !authored.includes(input.skirmishGoal)) {
    goals.push({ text: input.skirmishGoal, rule: 'skirmish', done: false });
  }
  const fallbackTitle = input.name ?? '';
  if (page === null) {
    return {
      title: fallbackTitle,
      paragraphs: input.description === undefined ? [] : [{ style: 'body', text: input.description }],
      goals,
    };
  }
  const [first, ...rest] = page;
  const headed = first !== undefined && first.style === 'title';
  return { title: headed ? first.text : fallbackTitle, paragraphs: headed ? rest : page, goals };
}

/** The brief with its skirmish goals ticked once the match is won; authored goals are never evaluated. */
export function briefAtOutcome(brief: MissionBrief, outcome: MatchOutcome): MissionBrief {
  if (outcome !== 'victory' || !brief.goals.some((g) => g.rule === 'skirmish')) return brief;
  return {
    ...brief,
    goals: brief.goals.map((g) => (g.rule === 'skirmish' ? { ...g, done: true } : g)),
  };
}
