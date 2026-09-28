# Fail free-roamer long walks the walk-sector graph cannot connect

**Area:** sim, pipeline · **Focus:** navigation · **Priority:** P2

Original behavior: soldiers, heroes, scouts, hunters and druids route a long walk through the map's
walk-sector graph (`lasw`, [MAPDAT.md](../../formats/MAPDAT.md)), and the walk fails when no sector
path joins start and goal. Ours routes them by full-map A* whenever the two nodes share a walk
component (`nav/graph.ts`, `nav/find-path.ts`), and fighters skip the signpost limit
(`settlers/navigation/network.ts`), so they arrive where the original gives up.

The stored graph can split ground the nodes connect. Two neighbouring sectors link only when a path
of cost at most 50 joins their base points inside the pair's 40x20-node box, so a corridor leaving
the box by one node drops the link. On `wielkie_sprzatanie` the sectors based at (292,330) and
(287,307) stay unlinked because the path between the bridges there crosses x = 300 at y 315-316, one
node outside the box. The stored graph splits seat 2's side (187 sectors) from seats 3 and 0 (303),
and replaying the rule reproduces all 625 stored land links of that map. Our seat-2 soldiers cross
six bridges and reach seat 3's side in about four minutes.

Other maps whose stored graph splits a node-connected landmass: joined only by bridges on
`ciezka_wspolpraca` (201 | 43 sectors), `starozytny_trakt` (219 | 11), `straznicypolnocy` (435 | 19),
`kraina_starych_bohaterow` (580 | 5) and its `_sub1` (24 | 8); without bridges on about 23 more, such
as `wichry_zimy` (184 | 136) and `nowa_nadzieja` (470 | 11 | 9 | 8).

Basis: byte-level map lanes and an exact replay of the stored links. Not yet confirmed against the
running original, including whether its short local searches still carry a unit across near a split.

## Scope

- Decode the `lasw` land plane (its 52-byte sector records) with byte evidence in MAPDAT.md and
  import it as map data.
- Refuse a free roamer's long walk when the start and goal sectors are not linked; the order ends
  like any failed walk. Local walks inside the search range stay as they are.
- Name the approximation while sectors are not re-derived after buildings or palisades change their
  walk blocks, or re-derive the changed sectors within the tick budget.
- Fix the comments calling bridges unwalkable in `settlers/targets/resources.ts` and
  `conflict/chase.ts`; bridge decks are walkable land.
- Once this lands, the `wielkie-sprzatanie-ai-default-positions` pipeline correction is no longer
  what keeps those armies home; the owner decides whether it stays.

## Verify

A synthetic test refuses a walk between two unlinked sectors and allows it once they link. A
real-content test orders a seat-2 soldier on `wielkie_sprzatanie` to (295,23) and sees the walk
fail. The gate's per-tick cost is measured on the `magiczny_las` bench.
