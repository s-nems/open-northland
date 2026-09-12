# Pair the published woman idle with cast shadows

**Area:** pipeline, app
**Priority:** P2

## Scope

The published blonde woman's six-second idle now has 144 poses per facing. The previous 12-pose
shadow candidate was superseded during integration and is not compatible with this atlas.
Her accepted body and animation remain published, using the existing oval fallback shadow.
The four male appearances have approved model-derived cast shadows.

Regenerate walk and idle shadows from the current woman recipe using the shared character exporter
and the 0.44 character opacity in `docs/art/lighting.json`. Pack the atlas, add the shadow binding and
copy output to her asset recipe, then build and review the candidate beside the published body on a
real map at zoom ×2. Preserve all body pixels, timing and layout. Publish after visual acceptance.

## Verify

Verify paired frame coverage (128 walk + 1152 idle), source freshness, ground contact, fixed light
direction, atlas bounds, and unchanged body presentation. Use the commands in
`docs/art/characters/PIPELINE.md`.
