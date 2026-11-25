import {
  type HypertextBlock,
  type MapBriefing,
  type MapMeta,
  type MapTextLanguage,
  textReadingOrder,
} from '@open-northland/data';
import {
  type MatchOutcome,
  type MissionScript,
  type MissionStatus,
  SUCCESSFUL_IF,
} from '@open-northland/sim';
import { localizedMapTextWithLang } from './strings.js';

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
  /** Whether the text comes from the map's script or the generic skirmish rule. */
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
  /** The map text language the page is written in; null for text in the app's language. */
  readonly lang: string | null;
  /**
   * The language tag the prose reads in when that is not `lang`: a translated page keeps `lang` for
   * its narration and callbacks while its prose reads in the app's language. Absent otherwise.
   */
  readonly proseLang?: string;
}

/** A briefing page and the map text language it was found in. */
export interface BriefingText {
  readonly blocks: readonly HypertextBlock[];
  readonly lang: string | null;
}

/** Where a world's briefs come from: its pages, the fallback text, and whether a match runs. */
export interface MissionBriefSource {
  /** The briefing page for a cutscene id, in the player's language; null when the map ships none. */
  readonly page: (id: number) => BriefingText | null;
  /**
   * What the task tab shows with no page: the map's menu name and description. `lang` names the
   * language they read in, or null for the app's; absent for a scene's own summary, which the app
   * ships in the reader's language.
   */
  readonly fallback: {
    readonly title: string;
    readonly description?: string;
    readonly lang?: MapTextLanguage | null;
  };
  /** The skirmish goal text, listed whenever a match runs, since it is the rule that decides; null
   *  for a world that declared none. */
  readonly skirmishGoal: string | null;
  /** Opening instructions whose completion follows the match verdict, not the briefing trigger. */
  readonly matchObjectives?: ReadonlySet<string>;
}

/**
 * UI approximation: maps attach their overall objective to an initially visible, unconditional
 * briefing trigger. Its firing presents the instructions; only victory completes that objective.
 * Later activated chapters and goals with gameplay conditions keep their script status.
 */
export function briefingMatchObjectives(script: MissionScript | undefined): ReadonlySet<string> {
  const objectives = new Set<string>();
  script?.missions.forEach((mission, index) => {
    if (
      mission.active &&
      mission.visible &&
      mission.description !== undefined &&
      (mission.successfullIf === SUCCESSFUL_IF.all ||
        mission.successfullIf === SUCCESSFUL_IF.any ||
        mission.successfullIf === SUCCESSFUL_IF.half) &&
      mission.goals.length > 0 &&
      mission.goals.every((goal) => goal.opcode === 'True') &&
      mission.results.some((result) => result.opcode === 'PlayCutscene')
    ) {
      objectives.add(String(index));
    }
  });
  return objectives;
}

/** The map's menu name and description in `lang`, the task tab's text when no page is shipped, with
 *  the language they read in (null for the app's), so foreign fallback text is handled like pages. */
export function mapBriefFallback(
  meta: Pick<MapMeta, 'name' | 'description'> | null,
  lang: MapTextLanguage,
): MissionBriefSource['fallback'] {
  const description = localizedMapTextWithLang(meta?.description, lang);
  const name = localizedMapTextWithLang(meta?.name, lang);
  // The description is the body the task tab shows; its language decides, a lone name's otherwise.
  const read = description ?? name;
  return {
    title: name?.text ?? '',
    ...(description !== undefined ? { description: description.text } : {}),
    ...(read !== undefined ? { lang: read.lang } : {}),
  };
}

/** A goal description starting with this is printed without it, in the window's emphasis colour. */
export const GOAL_EMPHASIS_MARK = '@';

/** The briefing page for `id` in `lang`, falling back through the authoring languages. */
export function briefingPage(
  briefing: MapBriefing | null,
  lang: MapTextLanguage,
  id: number | null,
): BriefingText | null {
  if (briefing === null || id === null) return null;
  for (const candidate of textReadingOrder(lang)) {
    const page = briefing.texts[candidate]?.[String(id)];
    if (page !== undefined && page.length > 0) return { blocks: page, lang: candidate };
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
  const goals = missionGoals(status, textOf).map(
    (goal): MissionGoal =>
      source.matchObjectives?.has(goal.key)
        ? { ...goal, state: outcome === 'victory' ? 'done' : 'open' }
        : goal,
  );
  const skirmish = source.skirmishGoal;
  if (skirmish !== null && !goals.some((g) => g.text === skirmish || source.matchObjectives?.has(g.key))) {
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
 *  description. The fallback reads in the language it was found in, so foreign text is handled
 *  like a page's. */
export function missionPage(source: MissionBriefSource, page: number | null): MissionPage {
  const text = page === null ? null : source.page(page);
  if (text !== null) return { title: '', ...text };
  const { title, description, lang } = source.fallback;
  return {
    title,
    blocks: description === undefined ? [] : [{ kind: 'text', style: 'body', text: description }],
    lang: lang ?? null,
  };
}

/** What a live reader reads off the world: the sim's mission flags, the match verdict and the tick. */
export interface MissionBriefWorld {
  readonly tick: () => number;
  readonly status: () => readonly MissionStatus[];
  readonly outcome: () => MatchOutcome;
}

/** The delivered briefing pages, oldest first, and the replayable one the beam opens on. */
export interface MissionBriefingAnswer {
  readonly history: readonly number[];
  readonly page: number | null;
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
 *  tick and `revision`, which a caller bumps when the goal texts change outside the sim (a landed
 *  translation does), so a held clock still re-reads them. */
export function missionReader(
  source: MissionBriefSource,
  world: MissionBriefWorld,
  textOf: (stringId: number) => string | undefined,
  revision: () => number = () => 0,
): MissionReader {
  const pages = new Map<number | null, MissionPage>();
  let goals: {
    readonly tick: number;
    readonly revision: number;
    readonly list: readonly MissionGoal[];
  } | null = null;
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
      const rev = revision();
      if (goals === null || goals.tick !== tick || goals.revision !== rev) {
        goals = {
          tick,
          revision: rev,
          list: missionGoalList(source, world.status(), textOf, world.outcome()),
        };
      }
      return goals.list;
    },
    missionName: source.fallback.title,
  };
}
