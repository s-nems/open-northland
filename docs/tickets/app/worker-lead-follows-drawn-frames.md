# Bound the sim worker's lead to the frames the main thread draws

**Area:** app · **Focus:** session/worker · **Priority:** P2

The owner's rule: when the requested speed is more than the machine carries, the game clock slows to
what it delivers; the sim never runs ahead of what the screen shows. The local `?map=` worker breaks it
whenever the main thread is the slower side.

- The worker steps until its undelivered ticks reach `undeliveredTickLimit(speed)` (`serve.ts`,
  `UNDELIVERED_LIMIT_SECONDS = 2`): 72 ticks at x3, 240 at x10, 720 at x30. Its only backpressure is the
  count of delivered batches (`TickOutbox.delivered`); render and apply cost reach it only through the
  frame rate.
- The main thread delivers at most `maxStepsPerFrame` (5) ticks a frame (`WorkerClient.advance`,
  `worker-session.ts`), so a 60 Hz view delivers at most 300 ticks/s and a slow frame far fewer. The
  rest bank in the worker as held, already-taken deltas.
- Commands and pause apply at the worker's tick (`LockstepDriver.submit` stamps `sim.tick`), not the
  drawn one, and `advance` keeps flushing held batches after a pause.
- Below the limit each tick is posted as its own one-record batch with its own delta
  (`TICK_BATCHES_IN_FLIGHT = 2`), although a delta's cost barely depends on how many ticks it spans.

Measured (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`, live section): with 60 ms of extra main-thread
work per frame at x10 the worker ran 44 ticks ahead, a pause took 1.3 s to show and 54 more ticks
played after it; at 120 ms, 140 ticks ahead, 5.2 s and 145 ticks. At t100k one delta costs 6.6 ms to
take on the worker and 1.7 ms to deserialize plus ~6.4 ms to apply with the runtime's indexes on the
main thread, for one tick or five alike (a five-tick delta touches 1484 entities, a one-tick delta
1453).

A sim-bound worker has a milder defect of the same loop: after `FixedTimestep` caps an advance at five
steps and drops the rest, alpha is 0 and the next timer waits a full tick period (`serve.ts`
`schedule`), idling about a sixth of the time near the threshold, and the five steps arrive as two
single-tick batches plus one of three.

## Scope

- Credit flow from the main thread: each frame's `delivered` message grants the ticks the next frame
  may show at the current speed (about `ceil(speed * TICKS_PER_SECOND * frameMs / 1000) + 1`); the
  worker steps only within that credit and posts at most one batch per credit, coalescing everything
  stepped since. This replaces the two-second limit; keep a small named grace so a GC hitch costs no
  ticks.
- The main thread applies every batch that has arrived, without the five-tick cap.
- Pause and speed changes take effect within one frame: no banked ticks play after a pause, and a
  speed-down stops the fast-forward at once.
- A sim-bound worker reschedules at once after a capped advance, bounds one advance by time, and yields
  between ticks instead of sleeping a tick period.
- `perf()` reports the worker's lead in ticks and the messages received per frame.
- The relayed path keeps its own pacing; see
  [relay-pacing-sees-render-cost.md](../net-client/relay-pacing-sees-render-cost.md).

## Verify

- Loopback unit tests with fake frames: at x30 and 60 frames/s the lead stays within two frames of
  ticks; after a pause at most the lead is delivered; after a speed-down delivered speed falls within
  one frame; a stub step slower than the tick period delivers close to `1 / step cost` ticks a second.
- A late-game browser run (the reference's session from its t80k checkpoint) with added main-thread
  load: lead, pause latency and delivered speed against the numbers above; at x10 one message per
  frame and `receiveMs` per tick down.
- `npm test`, `npm run check`, `npm run build`.
