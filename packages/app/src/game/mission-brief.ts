import type { HypertextBlock, MapBriefing } from '@open-northland/data';
import type { MatchOutcome, MissionStatus } from '@open-northland/sim';

/**
 * What the mission window shows for one world: a briefing page and the goal list. Pure joins over the
 * decoded briefing sidecar and the sim's mission status; the window itself is HUD.
 */
export interface MissionGoal {
  readonly text: string;
  /** An authored trigger's description is listed as information; the skirmish rule is what decides. */
  readonly rule: 'authored' | 'skirmish';
  /** A goal that fired or whose last check held shows `X`; an active unmet one shows `o`; an inactive,
   *  unmet one is dimmed with no mark. Keeping `X` after a fire is a UI approximation for repeatable
   *  scripts that consume their own goal input. */
  readonly state: 'done' | 'open' | 'idle';
}

export interface MissionBrief {
  /** The headline over fallback text; empty over a briefing page, which carries its own. */
  readonly title: string;
  /** The briefing page; a map without one reads its menu description, a scene its summary. */
  readonly blocks: readonly HypertextBlock[];
  readonly goals: readonly MissionGoal[];
}

/** Where a world's briefs come from: its pages, the fallback text, and whether a match runs. */
export interface MissionBriefSource {
  /** The briefing page for a cutscene id, in the player's language; null when the map ships none. */
  readonly page: (id: number) => readonly HypertextBlock[] | null;
  /** What the task tab shows with no page: the map's menu name and description. */
  readonly fallback: { readonly title: string; readonly description?: string };
  /** The skirmish goal text, listed whenever a match runs, since it is the rule that decides; null
   *  for a world that declared none. */
  readonly skirmishGoal: string | null;
}

/** A goal description starting with this is printed without it, in the window's emphasis colour
 *  (approximation: the emphasis is not applied). */
const GOAL_EMPHASIS_MARK = '@';
/** The mission window's language order: the app locale, then the mod's authoring language. */
const BRIEFING_LANG_FALLBACKS = ['pol', 'eng'] as const;

/** The briefing page for `id` in `lang`, falling back through the authoring languages. */
export function briefingPage(
  briefing: MapBriefing | null,
  lang: string,
  id: number | null,
): readonly HypertextBlock[] | null {
  if (briefing === null || id === null) return null;
  for (const candidate of [lang, ...BRIEFING_LANG_FALLBACKS]) {
    const page = briefing.texts[candidate]?.[String(id)];
    if (page !== undefined && page.length > 0) return page;
  }
  return null;
}

/**
 * The goals the window lists: every mission the author marked visible that names a goal text, in
 * script order, with its mark from the live flags (reading). A text the map's table lacks prints its
 * id, the way the original prints a placeholder there.
 */
export function missionGoals(
  status: readonly MissionStatus[],
  textOf: (stringId: number) => string | undefined,
): MissionGoal[] {
  const goals: MissionGoal[] = [];
  for (const mission of status) {
    if (!mission.visible || mission.description === undefined) continue;
    const raw = (textOf(mission.description) ?? `#${mission.description}`).trim();
    const text = raw.startsWith(GOAL_EMPHASIS_MARK) ? raw.slice(GOAL_EMPHASIS_MARK.length).trim() : raw;
    goals.push({
      text,
      rule: 'authored',
      state: mission.done ? 'done' : mission.active ? 'open' : 'idle',
    });
  }
  return goals;
}

/**
 * The brief for `page`: the page as authored, headline included; without one, the fallback name heads
 * the fallback description. The authored goals come first; the skirmish rule follows unless the author
 * already wrote it, ticked once the match is won.
 */
export function missionBrief(
  source: MissionBriefSource,
  page: number | null,
  status: readonly MissionStatus[],
  textOf: (stringId: number) => string | undefined,
  outcome: MatchOutcome,
): MissionBrief {
  const goals = missionGoals(status, textOf);
  const skirmish = source.skirmishGoal;
  if (skirmish !== null && !goals.some((g) => g.text === skirmish)) {
    goals.push({ text: skirmish, rule: 'skirmish', state: outcome === 'victory' ? 'done' : 'open' });
  }
  const blocks = page === null ? null : source.page(page);
  if (blocks === null) {
    const { title, description } = source.fallback;
    return {
      title,
      blocks: description === undefined ? [] : [{ kind: 'text', style: 'body', text: description }],
      goals,
    };
  }
  return { title: '', blocks, goals };
}

/** What a live brief reads off the world: the sim's mission flags, the match verdict and the tick. */
export interface MissionBriefWorld {
  readonly tick: () => number;
  readonly status: () => readonly MissionStatus[];
  readonly outcome: () => MatchOutcome;
}

/**
 * The brief reader an open mission window pulls every frame: {@link missionBrief} over the live
 * world, memoised per tick and page, since the goal marks move only with the tick.
 */
export function missionBriefReader(
  source: MissionBriefSource,
  world: MissionBriefWorld,
  textOf: (stringId: number) => string | undefined,
): (page: number | null) => MissionBrief {
  let memo: { readonly tick: number; readonly page: number | null; readonly brief: MissionBrief } | null =
    null;
  return (page) => {
    const tick = world.tick();
    if (memo === null || memo.tick !== tick || memo.page !== page) {
      memo = { tick, page, brief: missionBrief(source, page, world.status(), textOf, world.outcome()) };
    }
    return memo.brief;
  };
}
