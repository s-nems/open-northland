# Extract a shared Manhattan-ring node enumerator

**Area:** sim (refactor / dedup) · **Origin:** carry-interrupt-drop code review, 2026-07-16 · **Priority:** P3

The half-cell Manhattan-ring walk — for radius `r`, enumerate the offsets `dxMag = r - |dy|` over
`dy ∈ [-r, r]` with `dx ∈ {-dxMag, dxMag}` (and `[0]` when `dxMag === 0`) — is now hand-inlined in at
least three places:

- `packages/sim/src/systems/agents/effects-goods/carry.ts` (`dropCarriedLoad`, the spill search),
- `packages/sim/src/systems/agents/targets/stores/stock.ts` (`nearestFreeYardNode`, the gatherer yard
  search),
- and the same shape appears in the flee direction scan / other ring walks (grep `dxMag` / `r - Math.abs`).

They differ only in what they do per node (collect-and-sort vs pick-min-id-and-return), not in how they
enumerate the ring. The duplication is the second/third real caller, so it clears the AGENTS.md
"deduplicate at the second real caller" bar.

## Scope

- Extract a pure generator (e.g. `manhattanRingNodes(terrain, cx, cy, r): Iterable<NodeId>` or a raw
  offset generator `ringOffsets(r): Iterable<[dx, dy]>`) into a shared home — `nav/` or `systems/spatial.ts`
  beside `clearNavState`/`NodeBuckets` — and have both `dropCarriedLoad` and `nearestFreeYardNode` consume
  it. Keep each caller's own per-node policy (canonical sort vs min-id early return).
- Preserve determinism exactly: the enumeration order and the tie-breaks must be byte-identical, so the
  `nearestFreeYardNode`-driven gatherer goldens do not move. A moved golden here means the refactor changed
  behavior — stop and reassess (this is why it is split out from the feature branch rather than done inline).

## Verify

- `npm test` — no golden hashes move (`nearestFreeYardNode` feeds the gatherer economy goldens); the
  carry-interrupt-drop spill test still passes.
- `npm run check`, `npm run build`.
