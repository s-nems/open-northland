# Keep flag-follow re-plants off resources sealed in a pocket

**Area:** sim · **Focus:** assistant/flag-follow · **Priority:** P3

The AI's own collector searches drop a resource whose every stance cell lies sealed in a pocket the
base's walk cannot enter (`unsealedResourceTest`, `ai-player/workforce/flag-spots.ts`). The assistant's
flag follow (`assistant/flag-follow.ts`) does not: its nearest-resource test is `reachableResourceTest`
alone, so a re-plant still spends one of its `REPLANT_ATTEMPTS` spot searches on a sealed deposit that
`GathererReach.canWork` then rejects. On `magiczny_las` with 6 AI seats these misses still occur late
in the game, all from the flag follow.

## Scope

- The flag follow's nearest-resource test drops a resource sealed from the re-plant's origin, as the AI
  collectors' does, fail-open on a pocketed origin.
- Player-visible: the assistant switch serves human players too, so a moved flag can land on another
  deposit. Confirm with the owner before changing it.

## Verify

- A unit case: a worked-out gatherer whose nearest deposit is sealed re-plants at the next one.
- Count the misses before and after: temporarily count the `replantSpot` attempts whose
  `reach.canWork` fails at a resource `unsealedResourceTest` would drop from the same origin, then run
  `npm run bench:map` on `magiczny_las`, seats 0-5, progression and needs on, 3000 ticks from a t80000
  checkpoint written by the current build (`ON_BENCH_CHECKPOINTS`, `docs/DEVELOPMENT.md`). The flag
  follow's count drops to zero. Remove the counter; `npm test`, `npm run check`.
