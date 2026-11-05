import { entityById, type WorldSnapshot } from '@open-northland/sim';
import type { BuildingPickKind, PickAim } from '../pick-mode.js';
import type { HintAction, HintRefusal, PlanHint } from './plan-hint.js';

/** The verb a building pick's press is named by, and the refusal of a building it turns down. */
const BUILDING_PICK_WORDS: Readonly<
  Record<BuildingPickKind, { readonly action: HintAction; readonly refusal: HintRefusal }>
> = {
  workplace: { action: 'work', refusal: 'cannotWorkHere' },
  home: { action: 'live', refusal: 'cannotLiveHere' },
  'building-site': { action: 'build', refusal: 'cannotBuildHere' },
  'learning-place': { action: 'train', refusal: 'cannotTrainHere' },
  'trade-house': { action: 'addToRoute', refusal: 'cannotAddToRoute' },
};

const action = (verb: HintAction, creature: number | null = null): PlanHint => ({
  tone: 'action',
  action: verb,
  job: null,
  target: creature === null ? null : { kind: 'creature', ref: creature },
});
const refusal = (reason: HintRefusal): PlanHint => ({ tone: 'refusal', refusal: reason });
const either = (fits: boolean, verb: HintAction, reason: HintRefusal): PlanHint =>
  fits ? action(verb) : refusal(reason);

/** What the armed pick's press would do, worded as the right-click label words its orders. */
export function pickHint(snapshot: WorldSnapshot, aim: PickAim | null): PlanHint | null {
  if (aim === null) return null;
  switch (aim.kind) {
    case 'strike':
      return action('attack', aim.creature ? aim.target : null);
    case 'attackMove':
      return action('attackMove');
    case 'walk':
      return action('walk');
    case 'workArea':
      return action('workArea');
    case 'signpost':
      return either(aim.fits, 'placeSignpost', 'cannotPlaceSignpost');
    case 'drive':
      return action(aim.ship ? 'sail' : 'drive');
    case 'dock':
      return either(aim.fits, aim.lands ? 'moorAndLand' : 'moor', 'cannotMoorHere');
    case 'bombard':
      return action('bombard');
    case 'board':
      return either(aim.fits, 'board', 'cannotBoard');
    case 'loadAboard':
      return either(aim.fits, 'loadAboard', 'cannotLoadAboard');
    case 'pinShip':
      return either(aim.fits, 'pinShip', 'cannotPinShip');
    case 'building': {
      const words = BUILDING_PICK_WORDS[aim.pick];
      if (!aim.fits) return refusal(words.refusal);
      if (aim.school) return action('learn');
      if (aim.pick !== 'building-site') return action(words.action);
      // The builders' pick mends a damaged standing building and builds every other site.
      const components = entityById(snapshot, aim.building)?.components;
      const mends = components?.Damaged !== undefined && components.UnderConstruction === undefined;
      return action(mends ? 'repair' : 'build');
    }
  }
}
