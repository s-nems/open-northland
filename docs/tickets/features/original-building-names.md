# Extract original building names for the details panel

**Area:** pipeline + app · **Priority:** P2

The details panel already shows Polish building names, but from a **hand-authored stopgap** table
(`packages/app/src/catalog/building-i18n.ts` `localizedBuildingName`, e.g. barracks → "Koszary";
consumed by `hud/details-panel/model/context.ts`), not from the original extracted strings. Long
source labels can also overflow the fixed name column.

## Scope

- Replace the hand-authored `building-i18n.ts` stopgap with names extracted from the readable data
  (the `.cif`/string-table lane that already yields the `housewindow`/`humanwindow` strings), keyed
  to building typeIds and fed through the existing `loadGuiStrings`/`uiStringLookup` path.
- Fit or truncate the resulting labels within the existing name column, matching the original when
  observable. Do not add unrelated details-panel rows in this ticket.

## Verify

- `npm test`; pipeline run against the owned game copy.
- Details panel shows original names without overflow — **user's eyes**.
