import type { Campaign, CampaignMovie, MapTextLanguage } from '@open-northland/data';
import { RECOMMENDED_CAMPAIGN_TRIBE } from '../../../campaign/launch.js';
import { campaignFinale, campaignMovies } from '../../../campaign/locale.js';
import type { CampaignProgress } from '../../../campaign/progress.js';
import type { SystemConfirmCopy } from '../../../hud/dom/system-confirm.js';
import { formatMessage, type Messages } from '../../../i18n/index.js';

type ScreenStorage = Pick<Storage, 'getItem' | 'setItem'>;
type Stage = Campaign['stages'][number];

/** Per-viewer conveniences only; campaign progress itself lives under `campaign/progress.ts`. */
const CHOSEN_CAMPAIGN_KEY = 'open-northland.campaignScreen.campaign';
const REVEALED_ROUTES_PREFIX = 'open-northland.campaignScreen.routes.';

export interface UnlockedStage {
  readonly stage: Stage;
  /** The stage's place in the campaign, from 1. */
  readonly number: number;
}

/** The stages the person may play, in campaign order; locked stages are not shown at all. */
export function unlockedStages(campaign: Campaign, progress: CampaignProgress): UnlockedStage[] {
  const unlocked = new Set(progress.unlocked);
  return campaign.stages
    .map((stage, index) => ({ stage, number: index + 1 }))
    .filter(({ stage }) => unlocked.has(stage.mapId));
}

/** The films the screen replays: the intro when there is one, the finale once the campaign is completed. */
export function campaignFilms(
  campaign: Campaign,
  language: MapTextLanguage,
  progress: CampaignProgress,
): { readonly intro: CampaignMovie | undefined; readonly finale: CampaignMovie | undefined } {
  return {
    intro: campaignMovies(campaign, language).intro,
    finale: progress.completed ? campaignFinale(campaign, language) : undefined,
  };
}

/** The URL's campaign first, then the one this viewer last chose, then the first in display order. */
export function initialCampaign(
  campaigns: readonly Campaign[],
  requested: string | null,
  remembered: string | null,
): Campaign | undefined {
  const byId = (id: string | null): Campaign | undefined => campaigns.find((campaign) => campaign.id === id);
  return byId(requested) ?? byId(remembered) ?? campaigns[0];
}

/** The tribe a launch passes on: none for the recommended one, so the map keeps its own seat. */
export function launchTribe(tribe: number): number | undefined {
  return tribe === RECOMMENDED_CAMPAIGN_TRIBE ? undefined : tribe;
}

/** The newest unlocked stage, when its route into it has not been drawn for this viewer yet. */
export function routeToReveal(
  stages: readonly UnlockedStage[],
  revealed: readonly string[],
): string | undefined {
  const newest = stages.at(-1)?.stage;
  if (newest?.route === undefined || revealed.includes(newest.mapId)) return undefined;
  return newest.mapId;
}

/** Storage that may be missing or throw (private windows, blocked site data) reads as empty. */
export function readChosenCampaign(storage: ScreenStorage | undefined): string | null {
  try {
    return storage?.getItem(CHOSEN_CAMPAIGN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function rememberChosenCampaign(storage: ScreenStorage | undefined, id: string): void {
  try {
    storage?.setItem(CHOSEN_CAMPAIGN_KEY, id);
  } catch {
    // A convenience; the screen works without it.
  }
}

export function readRevealedRoutes(storage: ScreenStorage | undefined, campaign: Campaign): string[] {
  let value: unknown;
  try {
    value = JSON.parse(storage?.getItem(REVEALED_ROUTES_PREFIX + campaign.id) ?? '[]');
  } catch {
    return [];
  }
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

/** A reset draws each route again as its stage is unlocked anew. */
export function forgetRevealedRoutes(storage: ScreenStorage | undefined, campaign: Campaign): void {
  try {
    storage?.setItem(REVEALED_ROUTES_PREFIX + campaign.id, '[]');
  } catch {
    // Without storage the routes simply stay drawn.
  }
}

/** The reset question names the campaign; Cancel holds the default focus, so Enter alone never resets. */
export function campaignResetQuestion(copy: Messages['campaign'], title: string): SystemConfirmCopy {
  return {
    title: copy.reset,
    message: formatMessage(copy.resetConfirm, { campaign: title }),
    cancel: copy.cancel,
    confirm: copy.resetAction,
  };
}

export function rememberRevealedRoute(
  storage: ScreenStorage | undefined,
  campaign: Campaign,
  mapId: string,
): void {
  const revealed = new Set(readRevealedRoutes(storage, campaign)).add(mapId);
  // Only the campaign's own stages, so the record never outgrows the campaign.
  const kept = campaign.stages.map((stage) => stage.mapId).filter((id) => revealed.has(id));
  try {
    storage?.setItem(REVEALED_ROUTES_PREFIX + campaign.id, JSON.stringify(kept));
  } catch {
    // Without storage the route draws again next time; nothing else depends on it.
  }
}
