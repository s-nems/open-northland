# Import `lmtw` and pin the nav graph against it

**Area:** pipeline, app · **Priority:** P3

`lmtw` is the original's own per-node walk-edge plane, and its derivation from `empa`/`empb` replays
byte-identically on all 130 owned maps (`docs/formats/MAPDAT.md`). It is the only oracle that can say
whether our collision grid connects the same ground the original does. The importer drops the lane, so
that check exists only as throwaway probes, and nothing would notice the collision grid drifting
from it.

## Scope

- Import `lmtw` into the decoded map alongside the existing lanes.
- Add a content-mode test that labels components over `lmtw` and over `buildCollisionTerrain`, and
  asserts every one of ours falls inside a single `lmtw` component, allowing any residual pockets
  by an explicit bound rather than a per-map list.
- The lane is a fidelity oracle for tests, not sim input. Do not route nav through it.

## Verify

`npm run test:pipeline` covers the new lane; `npm run test:content` runs the comparison. A deliberate
regression of `groundKinds` (`packages/app/src/content/collision.ts`) to the cell-resolution join
must fail the new assertion.
