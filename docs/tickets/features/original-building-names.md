# Extract original building names for the details panel

**Area:** pipeline + app · **Origin:** original-ui plan reconciliation, 2026-07-12

The details panel shows English catalog building names — the original Polish house names are not
yet extracted, and long labels overflow the name column. The "Pojemność" capacity line is absent
because that string is not in the decoded tables (verify whether another table carries it before
declaring it unavailable).

## Scope

- Extract the building display names from the readable data (the `.cif`/string-table lane that
  already yields the `housewindow`/`humanwindow` strings) and key them to building typeIds.
- Feed them through the existing `loadGuiStrings`/`uiStringLookup` path; fix the name-column
  overflow (truncate/fit, matching the original's behavior if observable).

## Verify

- `npm test`; pipeline run against the owned game copy.
- Details panel shows original names without overflow — **user's eyes**.
