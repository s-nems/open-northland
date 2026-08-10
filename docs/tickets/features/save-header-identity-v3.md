# Record a save's own timestamp and a real content fingerprint

**Area:** sim, app, data · **Focus:** save format · **Priority:** P2

Two header gaps share one format bump.

The header carries no save time, so the list's "Saved" column is the browser store's write time on one
platform and the file's mtime on the other. Restoring a backup, copying a save between machines, or
moving a file into the saves folder all report the copy time, and the same save shows different dates on
desktop and in the browser.

Content identity is `irVersion` plus the pipeline's hand-maintained `contentRevision`, which is
`NO_PIPELINE_REVISION` for every scene and sandbox world. Editing `sandboxContent()` or reordering the
authored catalog extras therefore leaves older scene saves loading silently against shifted good, job,
and building ids, with no warning at all. `terrainGridFingerprint` already shows the shape the fix wants,
and `packages/data/src/fnv.ts` holds the mixer.

## Scope

- Bump `SAVE_FORMAT_VERSION` with a migration for both fields at once, and keep the v1 and v2 goldens
  passing.
- Add `savedAt` to the header, written at export. The stores keep their own timestamp as the fallback for
  a save that predates the field.
- Fingerprint the resolved content's id tables (goods, jobs, buildings) the way the terrain grid is
  fingerprinted, record it, and compare it on restore. Keep `contentRevision`'s current reporting
  behavior; the fingerprint is the check that must not be forgettable.
- State in `docs/DATA-FORMAT.md` which mismatch rejects and which one only reports.

## Verify

- A v2 fixture migrates and restores; a save whose content id tables moved is caught by the fingerprint,
  not by a crash later in the session.
- The list shows the same date for the same save on both stores, and a copied file keeps its original date.
- `npm run check`, `npm run build`, `npm test`.
