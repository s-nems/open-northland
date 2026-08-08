# Honor non-block walk frame lists for animals

**Area:** app · **Priority:** P3

`blockAnimFromLists` reduces a `gfxwalkframelist` table to a `DirectionalAnim` only when every
facing's list is the same contiguous run `facing*stride .. facing*stride + frames - 1`. Every viking
human list satisfies that; a few animal gaits do not (the chicken and bull rows mix run lengths
across directions). Those fall back to the whole ×8 block, an approximation that plays block frames
the authored list skips.

Play the authored cut for those gaits too:

- The gait clock (`gaitPhase`) currently indexes a uniform stride. Either extend `DirectionalAnim`
  with per-facing frame counts, or route non-block gaits through a `FrameListAnim` driven by the
  gait clock instead of the acting clock.
- Keep the human path untouched - the block cut is already exact there and cheaper.

## Scope

- `packages/app/src/content/settler-gfx/seq-anim.ts` (or a shared home if animals stop going through
  it), `packages/app/src/content/animal-gfx/bindings.ts`, and the sprite-pool frame selection for
  moving sprites. No schema changes - the lists are already in the IR.

## Verify

- Unit: a mixed-run-length table produces per-facing lists that never index outside the authored
  list; the human block path still reduces to `{stride, frames}`.
- Human pass: chicken and bull walk cycles on a real map show no stray frames at the cycle seam.
