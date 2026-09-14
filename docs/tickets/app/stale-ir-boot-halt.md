# Route an IR version mismatch through the boot halt card

**Area:** app · **Priority:** P3

`parseContentSet` now rejects any `manifest.version` but `IR_VERSION`, so a checkout's `content/`
left unregenerated across a version bump makes `loadLocalizedRealContent` throw. Both playable entries call
it before their `MissingTerrainError` guard (`entries/map.ts:121` ahead of the `try` at 129,
`entries/scene.ts:79`), so the throw escapes and the run ends as a crash-capture report instead of the
existing "regenerate content" card that the same situation already gets for missing terrain.

A bare checkout is unaffected: no `ir.json` still returns `null` and the sandbox fallback stands.

## Scope

- Catch the version mismatch at the playable-entry boot seam and halt through the existing
  `haltOnMissingContent` path (or a sibling that words a stale root rather than a missing one).
- Distinguishing it from a genuine schema break needs a typed error out of the data package; a message
  match is not enough.

## Verify

A headless entry test asserting a stale-stamped IR halts with the notice instead of rejecting, plus a
human browser pass on the rendered card.
