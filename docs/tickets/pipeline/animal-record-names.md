# Give extracted animal records their species name

**Area:** pipeline · **Priority:** P3

All 35 IR `animals` records ship `name: null` and a fallback id `animal_<tribeType>`:
`animaltypes.ini` has no `name` key (species appear only as `//` comments), so
`extractAnimals` finds nothing. The species name is recoverable at extract time by joining
`tribeType` onto the tribes table (every animal tribe 8..41 has a readable slug: `bears`,
`stags`, ...), and the display name lives in `Data/text/eng/strings/gameobjects/tribes.ini`
(`stringn <tribetype> "Bear"`). Consumers currently re-do the tribes join ad hoc (e.g. the
unbound-species warning in `packages/app/src/content/animal-gfx/load.ts`).

## Scope

- At extraction, resolve each animal record's `id`/`name` through the tribes join (slug for `id`,
  the strings table for `name` when the locale ships one), keeping `tribeType` the record key.

## Verify

- `npm run test:pipeline`; regenerated `content/ir.json` animals carry slugs/names;
  `npm run test:content` joins stay green.
