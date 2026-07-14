# Convert `vertical-slice` runners to an options object

**Area:** packages/app/src/slice/vertical-slice.ts · **Origin:** code review of feat/open-source-prep,
2026-07-14 · **Priority:** P3

`runSlice`, `runBareMap` and `runAuthoredSlice` have grown a chain of trailing positional optional
params — `runSlice(seed, ticks, map?, owner?, footprints?, goodNames?)` — where every caller must
count commas to line an argument up with its slot, and adding the next optional (the pattern this
branch just followed for `goodNames`) widens the signature again. Past ~3 optionals a single
`readonly`-fielded options object reads better and lets callers pass only what they need by name.

## Scope

- Replace the trailing optionals of `runSlice` / `runBareMap` / `runAuthoredSlice` with one options
  object (`{ map?, owner?, footprints?, goodNames? }` for `runSlice`; the other two runners keep
  their required leading params and fold only their trailing optionals).
- Update every call site (entries + any slice tests) to the named form.
- Pure signature refactor — no behaviour change; the slice output must be byte-identical.

## Verify

`npm test`, `npm run check`, `npm run build`. No golden hash moves (behaviour unchanged).
