# Discover own terrain materials from manifests

**Area:** app, tooling
**Priority:** P3

Adding an own terrain image currently requires editing the filename enum in
`packages/art-contracts/src/terrain.ts`, the URL table in
`packages/app/src/content/own-assets/terrain.ts`, and the manifest imports in
`packages/app/src/content/own-assets/materials.ts`. The art catalog alone cannot add a material.

## Scope

Load material manifests and their images from the delivered terrain directory. Keep runtime manifests
separate from map-compatibility bindings. Validate duplicate material IDs, missing images and atlas
rectangles in both prepared delivery and runtime loading. Preserve the existing material choices and
fallback behavior; this change does not redesign terrain or expand map coverage.

## Verify

Verify with a synthetic additional material requiring no loader edits, duplicate/missing-image
rejection, own-content tests, candidate preview and the web build. Existing terrain must render with
the same images and calibration.
