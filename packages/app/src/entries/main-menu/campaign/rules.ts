import type { ResourceYieldFactor } from '@open-northland/lockstep';
import { onOffParam } from '../../../game/match/session-rules.js';
import { writeSessionRuleParams } from '../../../game/match/session-url.js';
import { initialLobbyOptions, type LobbyOptions, lobbyRules } from '../lobby/model.js';

type RulesStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Per viewer: the rules every campaign mission launches with, as their launch params. */
const CAMPAIGN_RULES_KEY = 'open-northland.campaignScreen.rules';

/** Owner ruling: the campaigns play with doubled iron and gold deposits until the person picks otherwise. */
export const CAMPAIGN_ORE_YIELD: ResourceYieldFactor = 2;

/** Each player keeps their map to themselves, as a mission plays without a rule of its own. */
const CAMPAIGN_ALLIED_VISION = false;

/** The rules this viewer last chose for the campaigns, else the campaign defaults. Storage that is
 *  missing or throws reads as no choice. */
export function readCampaignRules(storage: RulesStorage | undefined): LobbyOptions {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(CAMPAIGN_RULES_KEY) ?? null;
  } catch {
    stored = null;
  }
  if (stored === null)
    return {
      ...initialLobbyOptions(new URLSearchParams(), CAMPAIGN_ALLIED_VISION),
      oreYield: CAMPAIGN_ORE_YIELD,
    };
  const params = new URLSearchParams(stored);
  return initialLobbyOptions(params, onOffParam(params, 'alliedvision') ?? CAMPAIGN_ALLIED_VISION);
}

export function rememberCampaignRules(storage: RulesStorage | undefined, options: LobbyOptions): void {
  const params = new URLSearchParams();
  writeSessionRuleParams(params, lobbyRules(options));
  try {
    storage?.setItem(CAMPAIGN_RULES_KEY, params.toString());
  } catch {
    // A convenience; the next visit starts from the campaign defaults.
  }
}
