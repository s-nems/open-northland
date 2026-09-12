# Publish animated own-character cast shadows

**Area:** pipeline, app
**Priority:** P2

## Scope

Five civilian appearances have retained model-derived shadow atlases and matching runtime/gallery
support on `art/character-shadows`. Candidate builds preserve every delivered body pixel and all
body layout, scale and animation metadata. The shared lighting profile now matches the accepted
building direction across exporter cameras, with black shadows at 0.48 opacity. Source hashes reject
stale shadows after motion or lighting changes. Existing woodland has contact shading only; adding
its separate cast shadows is outside this character delivery.

Visually review the prepared family at zoom ×2 on Magiczny Las and in the animation gallery.
After acceptance, record each candidate's presentation digest, publish the five character packages
and merge the reviewed branch. Do not treat successful validation as visual acceptance.

Concurrent animation work is outside this branch. If newly accepted clips enter the same delivery,
regenerate paired shadows from those sources before publication; never overwrite the other worktree.

## Verify

`npm run check`, `npm run build`, `npm test`, `npm run test:art`, catalog build/validation and source
policy checks pass. Recheck source freshness before publication. Human review must cover foot contact,
fixed light direction, idle/walk/tool poses and overlapping actors. Use the shared character production
commands to regenerate; recipe changes invalidate the appearance's complete shadow export.
