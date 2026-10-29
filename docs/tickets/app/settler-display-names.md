# Show localized settler names and keep player renames local

**Area:** app, data, sim, tooling · **Focus:** character names · **Priority:** P2

A settler's display name comes from one place today: the raw proper noun in `NameIdentity.name`
(`packages/data/src/names/index.ts`), which is the lockstep sync key and therefore shows the
source spelling in every locale. The one per-settler override, `GivenName`, is written by the
`renameSettler` command (`packages/sim/src/systems/orders/naming.ts`), so a rename runs in lockstep
and lands on every client's screen. In a cross-language session that pushes one player's text onto
clients that cannot read it, and it is an abuse vector: there is no way to refuse a name another
seat chose. Non-hero names are the gap left by
`originalNameOverlay` (`packages/app/src/content/gui/original-names.ts`), which already covers
hero names from the pack's job strings — the pools in `packages/data/src/names/` are the project's
own "independently selected given names" and carry no pack text at all.

Upstream issue s-nems/open-northland#26 proposes the split implemented here: keep the raw name as
the sync key, resolve a per-locale dictionary name for display, and make the player's rename a
local-only value that never enters sim state.

## Scope

Three stages, in order. Each stage leaves the tree green on its own.

**1. A `names` overlay kind carrying the localized pools.**

- Add `PersonalNameOverlay` to `packages/data/src/schema/translations/overlay.ts`: `version`,
  `pool`, `names` (`Record<rawName, localizedName>`, both non-empty), and the optional `derived`
  mark the other schemas carry for `translations:derive-cht`. It deliberately takes no `basis`:
  the pools are the project's own names, not pack text, so there is no source-language text to
  pin a digest to.
- File layout is **one file per pool**, `translations/<lang>/names/<pool-id>.json`, so the file
  id the loader already derives from the name is the pool id, and a locale can be filled in per
  culture. Look up by `NameIdentity.pool` then `NameIdentity.name` — the snapshot carries both
  (`packages/sim/src/core/personal-names.ts`), so this resolves the eight raw names that repeat
  across pools instead of collapsing them, and it stays a two-level O(1) lookup.
- Register the kind in `OVERLAY_KINDS` and `SCHEMAS` in `packages/translations/src/load.ts`, and
  in `TranslationOverlays`. Handle it in `misnamed()` in `tools/translations/src/audit.ts`:
  the file id must be a pool id of `PERSONAL_NAMES`.
- Leave the source-language rule in the audit alone. `isSourceLanguage(lang) && kind !== 'maps'`
  already refuses `translations/<pol|eng|ger|rus>/names/`, which is correct: a source language
  shows the pool's own spelling and needs no file. Only `chs` and `cht` ship one.
- Ship `translations/chs/names/*.json` empty-but-present (`names: {}`) plus a handful of entries
  in the viking pools to exercise the path. Everything else falls back to the raw name until a
  later pass fills the cultures.

**2. A local-only rename (`petName`), keyed by entity id and stored beside the save.**

- New app-side store under `packages/app/src/game/character-names/`: get/set/clear one entity's
  name, list them all. It holds `SETTLER_NAME_MAX_CHARS` and control-character rules the command
  used to enforce, and it is a plain app object — no sim component, no command, nothing mixed
  into `hashSimState`'s walk of every component.
- Persist it per save file, not per install: extend `SaveStore`
  (`packages/app/src/view/runtime/save-load/store.ts`) with a nickname read/write pair beside
  `read`/`write`, implemented in `store-browser.ts` as a field on the slot record rather than in
  `SaveSlotMeta`, so a save written from a header cannot overwrite names the player typed, and so
  autosave slots keep theirs.
- Name it `petName`, not `nickname`: `docs/DEVELOPMENT.md` already uses *nickname* for the relay
  lobby's player handle, and the two must not share a word in code or UI copy.

**3. Drop the synced rename and rewire the panel.**

- Remove the `GivenName` component (`packages/sim/src/components/settler.ts`), the
  `renameSettler` command (`packages/sim/src/core/commands/unit-orders.ts`, `payload.ts`,
  `envelope.ts`, `systems/command/index.ts`), `systems/orders/naming.ts`, and its test. Bump
  `SAVE_FORMAT_VERSION` in `packages/sim/src/save/format.ts` and regenerate the committed fixture
  in the same commit; the project replaces persisted formats rather than migrating them.
- `GivenName` has a second, unrelated caller: `packages/app/src/scenes/economy/idle-work.ts` and
  `far-post.ts` add it to a spawned settler and query it back to find that settler again. Give
  them their own app-side `Map<string, Entity>` for the scene's cast so removing the component
  does not strand them.
- Point the panel's rename at the local store: `rename` in
  `packages/app/src/view/unit-controls/panels/chrome.ts` writes `petName` instead of enqueuing
  `renameSettler`. Keep the `renamable` gate
  (`packages/app/src/hud/details-panel/model/settler-panel.ts`) as it is — not a hero, not
  scripted — since it now gates a local edit of the same settlers.
- Resolve display in `settlerName` (`packages/app/src/game/character-names/index.ts`) as
  `ScriptedName → petName → hero → dictionary name → NameIdentity.name → unnamed`. With a
  `petName` set, render `Nickname (Original)`; a settings switch, default on, drops the
  parenthesised original. `settlerName` already reads the active locale through `messages()`, so
  the dictionary follows the same seam — keep it out of `NameContext` and its fourteen callers.

Non-goals: translating the hero names again (the pack strings cover them), a `cht` file edited by
hand (let `translations:derive-cht` produce it), and anything that lets one seat's text reach
another client.

## Verify

- `packages/app/test/game/character-names.test.ts`: a dictionary hit in `chs`, a miss falling back
  to the raw name, `petName` outranking the dictionary, a raw name repeated in two pools resolving
  to each pool's own translation, and the `Nickname (Original)` form with the switch either way.
- `packages/translations/test/`: the new kind loads, an unknown pool id is refused, and a
  source-language `names/` directory is reported by the audit.
- `npm run check:translations`, `npm run check:docs`, `npm run check` and the package test suites
  stay green; the save fixture round-trips after the version bump.
- The two economy scenes still find their named settler after the component is gone.
- Human check, in a `chs` client: new settlers show the dictionary name where one exists and the
  raw name elsewhere; renaming shows `Nickname (Original)`; saving and reloading keeps the
  nicknames of that save only.
