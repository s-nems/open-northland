/**
 * The component groups a sync digest folds separately, so a mismatch between two clients names the
 * area that diverged instead of only the fact that they did. Every component declares one at
 * {@link defineComponent}.
 *
 * `rng` and `entities` carry no components at all: they cover the RNG stream position and the entity
 * allocation state, which live outside the component stores. `fog` covers the masks, which do too, plus
 * the rule that drives them.
 */
export const SYNC_DOMAINS = [
  'rng',
  'entities',
  'players',
  'movement',
  'settlers',
  'economy',
  'combat',
  'fog',
] as const;

export type SyncDomain = (typeof SYNC_DOMAINS)[number];
