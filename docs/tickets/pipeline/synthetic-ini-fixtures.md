# Make the ini fixtures genuinely synthetic (open-source release blocker)

**Area:** pipeline (test fixtures) · **Origin:** pre-release quality audit 2026-07-13 · **Priority:** P1

`tools/asset-pipeline/test/fixtures/ini-sources.ts` claims in its header comment that "No
copyrighted fixtures are committed: these snippets are synthetic". That claim is false: an audit
diffed the fixture against the real game files and found **~126 of 189 data lines copied verbatim**
from `Data/logic/*.ini` / `DataCnmd/**/*.ini`. The copying is provable, not coincidental:

- The five `<CULTURES_CIF_BEGIN><03FD><...>` header lines carry the *file-specific* hex values of
  the real `goodtypes.ini`, `jobtypes.ini`, `landscapetypes.ini`, `humanjobexperiencetypes.ini`,
  and `vehicletypes.ini` headers.
- `setatomic 52 84 "viking_ship_small_idle_short_a" // "viking_ship_small_dock"` is a real
  `tribetypes.ini` line copied **including its trailing comment**.
- Real record names and stock values throughout (`"herb & mush guy"`, `"viking_woman_pickup"`,
  the `water` goodtype record).

This directly contradicts the repo's legal posture (README / `docs/SOURCES.md` /
`tools/asset-pipeline/AGENTS.md`: tests use synthetic fixtures, never real game data) and blocks
publishing the repo. Half the file already does it right — the HQ record's worker/stock ids were
changed, and the malformed lines (`notanint`) are invented — so this is a rewrite of the copied
half, not a redesign.

## Scope

1. Rewrite every fixture constant in `ini-sources.ts` with **invented** type names, ids, numeric
   values, and comment text. Preserve only the *grammar shapes* the specs exercise: quoted names,
   repeated single-value keys, one-line multi-value keys, trailing `//` comments, the
   `<CULTURES_CIF_BEGIN><hex><hex>` header **with made-up hex values**, and the deliberately
   malformed lines. Cross-reference consistency inside the fixture (e.g. a jobtype referencing a
   goodtype id) must keep holding so the IR-integration spec still passes — invent a coherent
   little universe, don't just scramble tokens.
2. Update the specs that assert on specific fixture values (grep consumers of each exported
   constant) to the new invented values.
3. The header comment stays — after this change it is finally true.
4. Sanity sweep: grep the new fixture's names/values against `Cultures 8th Wonder/` sources to
   confirm zero verbatim data lines remain (header sentinel + key names are format vocabulary,
   fine; values and name strings must not match).

## Verify

`npm test` (pipeline + IR integration specs), `npm run check`. The grep sweep from step 4 recorded
in the commit message.

## Source basis

Legal hygiene only — no production behavior change. The `.ini` grammar shapes being preserved are
format knowledge (OpenVikings + readable mod sources), which is fine; the copied *content* is not.
