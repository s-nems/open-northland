import type { HypertextBlock, MapBriefing, MapMeta, MapTextLanguage } from '@open-northland/data';
import type { MatchOutcome, MissionStatus } from '@open-northland/sim';
import { localizedMapText } from './map-strings.js';

/**
 * What the mission book shows for one world: its briefing pages and the goal list. Pure joins over the
 * decoded briefing sidecar and the sim's mission status; the book itself is HUD.
 */
export interface MissionGoal {
  /** Stable while the world runs: the mission's script index, or the skirmish rule. */
  readonly key: string;
  readonly text: string;
  /** The author prefixed the text with the emphasis mark; the book sets it in its accent ink. */
  readonly emphasis: boolean;
  /** An authored trigger's description is listed as information; the skirmish rule is what decides. */
  readonly rule: 'authored' | 'skirmish';
  /** A goal that fired or whose last check held is done; an active unmet one is open; an inactive,
   *  unmet one is idle and printed dimmed (reading). Keeping done after a fire is a UI approximation
   *  for repeatable scripts that consume their own goal input. */
  readonly state: 'done' | 'open' | 'idle';
}

/** One briefing page, or the map's fallback text. */
export interface MissionPage {
  /** The headline over fallback text; empty over a briefing page, which carries its own. */
  readonly title: string;
  /** The briefing page; a map without one reads its menu description, a scene its summary. */
  readonly blocks: readonly HypertextBlock[];
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

/** The map's menu name and description in `lang`, the task tab's text when no page is shipped. */
export function mapBriefFallback(
  meta: Pick<MapMeta, 'name' | 'description'> | null,
  lang: MapTextLanguage,
): MissionBriefSource['fallback'] {
  const description = localizedMapText(meta?.description, lang);
  return {
    title: localizedMapText(meta?.name, lang) ?? '',
    ...(description !== undefined ? { description } : {}),
  };
}

/** A goal description starting with this is printed without it, in the window's emphasis colour. */
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

const SKIRMISH_GOAL_KEY = 'skirmish';

/**
 * The goals the book lists: every mission the script currently marks visible that names a goal text,
 * in script order, with its state from the live flags (reading). A hidden mission stays out, and with
 * it any count of what is still to come. A text the map's table lacks prints its id, the way the
 * original prints a placeholder there.
 */
export function missionGoals(
  status: readonly MissionStatus[],
  textOf: (stringId: number) => string | undefined,
): MissionGoal[] {
  const goals: MissionGoal[] = [];
  for (const mission of status) {
    if (!mission.visible || mission.description === undefined) continue;
    const raw = (textOf(mission.description) ?? `#${mission.description}`).trim();
    const emphasis = raw.startsWith(GOAL_EMPHASIS_MARK);
    goals.push({
      key: String(mission.index),
      text: emphasis ? raw.slice(GOAL_EMPHASIS_MARK.length).trim() : raw,
      emphasis,
      rule: 'authored',
      state: mission.done ? 'done' : mission.active ? 'open' : 'idle',
    });
  }
  return goals;
}

/** The authored goals, then the skirmish rule unless the author already wrote it, done once the match
 *  is won. */
export function missionGoalList(
  source: MissionBriefSource,
  status: readonly MissionStatus[],
  textOf: (stringId: number) => string | undefined,
  outcome: MatchOutcome,
): MissionGoal[] {
  const goals = missionGoals(status, textOf);
  const skirmish = source.skirmishGoal;
  if (skirmish !== null && !goals.some((g) => g.text === skirmish)) {
    goals.push({
      key: SKIRMISH_GOAL_KEY,
      text: skirmish,
      emphasis: false,
      rule: 'skirmish',
      state: outcome === 'victory' ? 'done' : 'open',
    });
  }
  return goals;
}

/** The page as authored, headline included; without one, the fallback name heads the fallback
 *  description. */
export function missionPage(source: MissionBriefSource, page: number | null): MissionPage {
  const blocks = page === null ? null : source.page(page);
  if (blocks !== null) return { title: '', blocks };
  const { title, description } = source.fallback;
  return {
    title,
    blocks: description === undefined ? [] : [{ kind: 'text', style: 'body', text: description }],
  };
}

/** What a live reader reads off the world: the sim's mission flags, the match verdict and the tick. */
export interface MissionBriefWorld {
  readonly tick: () => number;
  readonly status: () => readonly MissionStatus[];
  readonly outcome: () => MatchOutcome;
}

/** The pages and goals the book and the goal slip pull. */
export interface MissionReader {
  page(page: number | null): MissionPage;
  /** The same array while the tick stands, since the goal states move only with the tick. */
  goals(): readonly MissionGoal[];
  /** The map's menu name, which the book prints over its chapters. */
  readonly missionName: string;
}

/** A {@link MissionReader} over the live world; pages are fixed content, the goals are memoised per
 *  tick. */
export function missionReader(
  source: MissionBriefSource,
  world: MissionBriefWorld,
  textOf: (stringId: number) => string | undefined,
): MissionReader {
  const pages = new Map<number | null, MissionPage>();
  let goals: { readonly tick: number; readonly list: readonly MissionGoal[] } | null = null;
  return {
    page(page) {
      let found = pages.get(page);
      if (found === undefined) {
        found = missionPage(source, page);
        pages.set(page, found);
      }
      return found;
    },
    goals() {
      const tick = world.tick();
      if (goals === null || goals.tick !== tick) {
        goals = { tick, list: missionGoalList(source, world.status(), textOf, world.outcome()) };
      }
      return goals.list;
    },
    missionName: source.fallback.title,
  };
}
