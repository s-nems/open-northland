# Cut the idle builders' road-site search on seats with colonies

**Area:** sim · **Focus:** settlers/drives/economy, computer-player road-build · **Priority:** P3

Late in the island game the builders' road-site search is the largest remaining sim cost. Every idle
builder weighs every pending road site of its side whenever the seat holds stone somewhere
(`planBuilder` in `settlers/drives/economy/builder.ts`, through `pickRoad` and the road-site plan). The
computer player keeps up to `MAX_PENDING_ROAD_SITES` (24) pending road sites per hub land
(`computer-player/road-build.ts`), and a colony is a second hub land, so a seat with one colony keeps up to
48; a seat without colonies has 0-24 and mostly no stone, so its search ends at once.

Measured on `bench:map` with
`ON_BENCH_SESSION='?map=arabskie_wyspy_wolna_gra_mieszana&player=observer&computer=0,1,2,3,4&seed=7'`,
2000 ticks from a checkpoint at tick 86400 (minute 120): about 4.4-4.7 ms CPU per tick in total, of which
the road-site search takes about 0.5-0.7 ms (12-15%) and the rest of the builder search 0.3-0.4 ms. Two
behaviour-neutral attempts (memoizing the spot tests across passes, scanning the side's filed stores
directly) gained 0-2%, so the remaining gain needs a behaviour change.

## Scope

- Make an idle builder of a computer seat skip the road-site search when no road site it could serve can
  get stone: for example a seat-wide gate while the unstocked road sites far outnumber the stone in reach,
  or fewer pending road sites on colony lands. Choose by measurement; keep colony roads (they are an owner
  rule: colonies build roads once home does).
- Human players' builders keep today's behaviour.
- Non-goal: changing how often builders re-plan in general.

## Verify

- The checkpoint run above: the road-site search's share at minute 120 at least halved, and total CPU per
  tick reported with the machine's load.
- Roads paved by minute 150 on the same map, seeds 7, 13 and 21, at most a small drop against the base
  (report the counts), and no seat's population or fighters worse beyond the seeds' usual spread.
- `npm test`, `npm run check`, `npm run build`.
