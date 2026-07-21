# Close the building-kind vocabulary

**Area:** data + pipeline + app · **Priority:** P3

`BuildingType.kind` is still `z.string()` although the extractor emits the seven values named by
`BUILDING_KIND`. App fallback content also authors `headquarters`, `building`, and `house`, and the
extractor invents `maintype_<n>` for unknown source values. Closing the schema today would therefore
reject valid project-authored content or hide unknown source data.

## Scope

- Inventory kinds from extracted content and committed fallback/test builders.
- Normalize fallback-only synonyms to the existing semantic vocabulary.
- Represent an unknown `logicmaintype` explicitly instead of inventing an open-ended string.
- Make the schema a closed union and update consumers to use `BuildingKind`; do not change the extracted
  meaning of known records.

## Verify

All fallback fixtures parse, exhaustive consumers type-check, and a synthetic unknown main type follows
the documented policy. Run `npm test`, `npm run check`, `npm run build`, and `npm run test:pipeline`;
known real `buildings[].kind` values remain unchanged.
