# Extract original building names for the details panel

**Area:** pipeline + app · **Origin:** original-ui plan reconciliation, 2026-07-12

The details panel already shows Polish building names, but from a **hand-authored stopgap** table
(`packages/app/src/catalog/building-i18n.ts` `localizedBuildingName`, e.g. barracks → "Koszary";
consumed by `hud/details-panel/model/context.ts`), not from the original extracted strings. Two
gaps remain: long labels overflow the name column, and the "Pojemność" capacity line is absent
because that string is not in the decoded tables (verify whether another table carries it before
declaring it unavailable).

## Scope

- Replace the hand-authored `building-i18n.ts` stopgap with names extracted from the readable data
  (the `.cif`/string-table lane that already yields the `housewindow`/`humanwindow` strings), keyed
  to building typeIds and fed through the existing `loadGuiStrings`/`uiStringLookup` path.
- Fix the name-column overflow (truncate/fit, matching the original's behavior if observable) and
  add the missing "Pojemność" capacity line if a source string is found.

## Verify

- `npm test`; pipeline run against the owned game copy.
- Details panel shows original names without overflow — **user's eyes**.
