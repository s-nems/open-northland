# Bound the pool death-reap to O(1) per frame (incremental sweep)

**Area:** render · **Origin:** /worktree on [sprite-pool-per-frame-scans], 2026-07-14 · **Priority:** P3

The sprite-pool per-frame-scans work bounded the two hot scans — the detach pass and
`placePalettedFor` — to O(visible) by iterating a new `attached` set (the entities on the layer)
instead of the whole pool. The remaining pool-sized scan is the **death reap**: `reconcileSprites`
over `this.pool.keys()` in `gpu/sprite-pool/sprite-pool.ts` `SpritePool.reconcile`, now gated to run
once every `POOL_REAP_INTERVAL_FRAMES` (30) instead of every frame.

So the reap cost is O(pooled)/30 amortized — a 30× cut, but still map-proportional: the pool grows to
every entity ever on screen (it only shrinks on death), so on a very large map with heavy off-screen
entity turnover the periodic full-pool diff is the last per-frame cost that does not track the screen.
On-screen deaths already detach immediately (invisible that frame) via the O(visible) detach pass; the
interval only defers *destroying* the (already-hidden) display object, i.e. reclaiming memory.

## Scope

Replace the periodic full sweep with an incremental one so per-frame reap cost is O(1):

- Sweep a fixed per-frame budget of pool entries round-robin (a rolling cursor over a lazily-refreshed
  key snapshot, or a long-lived `Map` iterator that survives across frames), freeing any pooled ref
  absent from that frame's `liveRefs`. A dead off-screen entity is then reaped within
  ⌈pooled/budget⌉ frames — bounded latency, constant per-frame cost.
- Keep `reconcileSprites` (or its one-line death test) as the pure decision on the swept slice — its
  tests stay the guard.
- Weigh the alternative: reap on-screen deaths eagerly in the detach pass (nearly free — it already
  visits each detached entity with `liveRefs` in hand; needs the entity's id on `PooledEntity`) and
  sweep only the detached set incrementally for off-screen deaths.

Behavior-preserving apart from a bounded reap latency for invisible dead entities (a transient bump in
`stats().pooled`). No golden should move.

## Verify

`npm run build`, `npm test` (sprite-pool suite — extend `test/sprite-pool.test.ts`'s reap case to
assert the per-frame reap work is bounded, not O(pooled)), `npm run check`. Headless: `drawn ≪ pooled`
and no crash after a long pan, same as the parent ticket.
