# Bound the memory a relayed client keeps for dispute capture

**Area:** net-client · **Focus:** dispute capture · **Priority:** P3

`DisputeCapture` in `packages/net-client/src/dispute-capture.ts` keeps the `SyncDigestInputs` of the
last `DISPUTE_WINDOW_TICKS` acknowledged ticks, and every relayed client runs it. The window is 960
ticks (5 s of frames at `MAX_SPEED` 8, times `WINDOW_MARGIN` 2), up from 384, because a member may
now trail by `SLOW_AT_ONCE_MS` before the relay paces for it. Under heavy load that is an estimated
38 MB retained per client against 15 MB before. The estimate is not a measurement; per-tick input
size has never been recorded.

## Scope

Measure the retained bytes per tick of `SyncDigestInputs` on the six-AI `magiczny_las` late game
(`npm run bench:map` with `ON_BENCH_SYNC_DIGEST`, a late checkpoint). If a full window is large
next to the client's heap, cap the ring by retained bytes, or shrink `WINDOW_MARGIN`, keeping the
window above the relay's slow threshold. Keep `DISPUTE_WINDOW_TICKS` as the tick bound and a tick
that left the ring recording no inputs.

## Verify

Report the measured bytes per tick and per full window with the scenario. If the ring changes, a
`relay-client.test.ts` case shows the cap dropping the oldest ticks and a verdict for a dropped tick
recording no inputs; `npx vitest run packages/net-client` passes.
