import type { BriefingParagraph, MapBriefing, MapScript, MapScriptLine } from '@open-northland/data';

/**
 * What the mission window shows for one world: the map's briefing page and its authored goals. Pure
 * joins over the decoded script and briefing sidecars; the window itself is HUD.
 */
export interface MissionBrief {
  readonly title: string;
  /** The briefing text; a map without one reads its menu description, a scene its summary. */
  readonly paragraphs: readonly BriefingParagraph[];
  /** The authored goal lines in mission order, or the skirmish rule when the map authors none. */
  readonly goals: readonly string[];
}

const GOAL_TRUE = 'True';
const GOAL_TIME_GONE = 'TimeGone';
/** A `TimeGone <n>` goal up to this fires as good as at once. Observation over the decoded maps: most
 *  briefings open on `True` or `TimeGone 0`, a few on `TimeGone 1`. */
const IMMEDIATE_TIME_GONE_LIMIT = 1;
const RESULT_PLAY_CUTSCENE = 'PlayCutscene';
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
    const text = mission.description?.trim();
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
): readonly BriefingParagraph[] | null {
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
 * body. The authored goals are informational; the skirmish line names what ends the match.
 */
export function mapMissionBrief(input: MapBriefInput): MissionBrief {
  const script = input.script;
  const page = script === null ? null : briefingPage(input.briefing, input.lang, introCutsceneId(script));
  const authored = script === null ? [] : missionGoals(script);
  const goals =
    input.matchDeclared && !authored.includes(input.skirmishGoal)
      ? [...authored, input.skirmishGoal]
      : authored;
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
