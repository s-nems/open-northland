# Split the two oversized music modules

**Area:** pipeline · **Priority:** P3

Two modules added by the soundtrack import are well past the ~300-line limit in `AGENTS.md`, and both
are the files a later fidelity fix has to be read whole:

- `tools/asset-pipeline/src/stages/music/interpret.ts` (454 lines) carries the message union, the
  priority policy, pattern scheduling, sequence scheduling, band conversion, segment preparation, and
  the performance clock.
- `tools/asset-pipeline/src/decoders/sgt-tracks.ts` (420 lines) carries five per-structure decoders
  plus the track-list traversal.

## Scope

- Split `interpret.ts` into scheduling (pattern/sequence/band to messages) and performance (clock,
  queue, execute), keeping `interpretSegment` as the public entry.
- Split `sgt-tracks.ts` by structure group behind a barrel that preserves the current imports.
- Behaviour-preserving: no change to rendered bytes, so `RENDER_VERSION` must not move.

## Verify

- `npm run check`, `npm test`, and `npm run test:pipeline` against the owned copy.
- The pipeline gate must still report 64 rendered, 0 failed, and the run must produce byte-identical
  oggs to the pre-split render.
