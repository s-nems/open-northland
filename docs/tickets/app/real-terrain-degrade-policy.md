# Make real-terrain loading own its fallback policy

**Area:** app · **Priority:** P2

`loadRealTerrain` throws when generated IR or textures are absent even though missing `content/` is a
supported app state. `?map=` catches the error, `?scene=` does not, and `?shot&terrain` intentionally
wants failure. This caller-by-caller policy currently makes a bare-checkout scene crash.

## Scope

- Return `undefined` from the normal real-terrain loader when optional content is unavailable.
- Let map and scene entries pass that value to the flat fallback and emit one bounded diagnostic.
- Keep an explicit required-terrain assertion for deterministic shot mode; it must not silently change
  rendering basis.

## Verify

A fetch-injected test covers absence and failure. Bare-checkout `?scene=sandbox` boots with flat terrain;
real-content entries and `npm run shot` are unchanged. Run `npm test`, `npm run check`, and `npm run build`.
