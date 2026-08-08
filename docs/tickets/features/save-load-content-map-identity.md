# Expose content and map identity for save files

**Area:** data, pipeline, app · **Priority:** P1

A save file must record which content build and which map it belongs to, and a restore must reject
mismatches before touching state. No runtime-reachable identity exists today: `CONTENT_REVISION`
lives only in `tools/asset-pipeline/src/manifest.ts` and `content/pipeline-manifest.json`, consumed
solely by the desktop staleness classifier (`packages/desktop/src/content-state.ts`); it is not part
of `ir.json`. Decoded map files (`TerrainMapFile`) carry no id or fingerprint, and `MapInfo.guid`
in `ir.json` has no runtime consumer.

## Scope

- Write `contentRevision` into the `ir.json` manifest next to `version` (pipeline writer plus
  `IrManifest` in `packages/data/src/schema/content/content-set.ts`). The manifest is a strict
  object, so older readers reject the new field as an unknown key; bump `IR_VERSION` so the
  rejection is the intended version-mismatch message. Regenerate content.
- Add a map fingerprint: FNV-1a 32-bit (same family as `hashSimState`) over the sim-relevant
  canonical projection of the map input (dimensions and type ids, not render lanes), as a pure
  helper callable from both the decoded-map path and scene-generated terrain. Expose it with the
  loaded map so app code can hand `{mapId, mapFingerprint}` to the save layer.
- Non-goals: no content hash over the whole `ir.json` (revision plus `IR_VERSION` identify a
  single-producer pipeline output), no save schema work.

## Verify

- Same map input yields the same fingerprint across load paths; a changed type id changes it.
- Desktop staleness classification still works against the regenerated manifest.
- `npm test`, `npm run check`, `npm run build`, `npm run test:pipeline` against the owned copy.
