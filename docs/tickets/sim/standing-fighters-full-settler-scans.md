# Index the owned fighters across ticks for collision posts, walk blocks and melee slots

**Area:** sim · **Focus:** movement/collision, conflict · **Priority:** P2

Three consumers find the standing fighters (owned settlers of a fighter trade, not walking) by scanning
every `Settler` with a `Position`, people and animals alike:

- `collectColliders` (`movement/collision/separation/colliders.ts`), whenever any firm mover walks:

  ```ts
  for (const e of world.query(Settler, Position)) {
    if (hasBodyCollision(world, ctx.content, e) && isStanding(world, e)) posts[postCount++] = e;
  }
  ```

- `eachStandingFighter` (`movement/collision/bodies.ts`) behind `unitWalkBlocks`, built on every
  pathfinding tick that routes a collider (`movement/routing.ts`);
- the same helper behind `standingFighterPosts`, which `MeleeSlots` builds once per combat pass that
  asks for a taken contact slot or an enemy's crowding.

With hundreds of fighters alive, some firm mover walks on every tick, so each is an O(population) pass
per tick. Measured on `magiczny_las`, AI seats 0-6 (869-1015 fighters late), profile from the 80k
checkpoint (2000 ticks, busy box), share of the whole profile: `separationSystem` 10.4%,
`collectColliders` 5.2% (2.0% self, which holds the post scan beside the mover census),
`unitWalkBlocks` 1.9% (`eachStandingFighter` 0.9%). The separation median grew 49.9x across a 100k run
while settlers grew 4.3x and fighters 16x. The melee-slot scan is predicted to join at war scale.

## Scope

- One per-world index of owned fighter settlers (the `hasBodyCollision` rule: `Owner` plus a fighter
  job), kept from the `Owner` and `Settler` membership journals and `settlerTradeLog` for trade changes,
  read by all three consumers, which keep testing `isStanding` and `Position` live. Narrowing it further
  to the standing subset from `PathFollow` and `PathRequest` changes is welcome if its verifier stays
  simple.
- `posts` stays sorted ascending and `unitWalkBlocks` counts are order-free, so the state hash does not
  move.
- Out of scope: the per-mover work (`writeLegHeading` 1.5%, `NodeBuckets.refill` 1.1%), which scales
  with walkers.

## Verify

- A cache verifier (`World.registerCacheVerifier`) compares the index with a fresh scan; a test changes
  a trade, an owner, a death and a spawn between reads.
- On an idle box, `ON_BENCH_MAP=magiczny_las ON_BENCH_SEATS=0,1,2,3,4,5
  ON_BENCH_CHECKPOINT=bench-out/ml6.t80000.checkpoint ON_BENCH_TICKS=4000 npm run bench:map` before and
  after (checkpoint from one 100k run, `docs/DEVELOPMENT.md`, Measuring performance), then
  `npm run bench:compare`: same state hash, separation and pathfinding medians fall.
- `npm test`, `npm run check`, `npm run build`.
