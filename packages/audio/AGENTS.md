# Audio package contract

`packages/audio` consumes the same snapshots and one-shot events as render. It is a sink: it never
mutates the simulation or calls back into it. The root [`AGENTS.md`](../../AGENTS.md) applies.

## Pure decisions and browser playback

- `src/data/` decides what should be audible. Keep it pure and headless-testable.
- `src/web/` owns Web Audio, clocks, fetches, sample caching, fades, and playback state.
- Platform seams such as context creation, byte fetching, and randomness stay injectable for tests.

Bindings from sim events or content rows to sounds are data. Add or override a binding instead of
hardcoding content ids into playback control flow.

## Invariants

- Read only plain snapshot and event input supplied by app.
- Cull positional sound to the viewport and stride bounded ambient scans. Cost follows the visible
  screen, not the whole map.
- Accumulate events from all simulation steps in a rendered frame before calling the driver.
- Cache decoded samples and memoize failures so a missing local file does not cause repeated fetches.
- A checkout without a decoded sound bank degrades to silence and still boots.
- Export and document tuning constants. State whether gains, fades, rates, and cooldowns come from
  extracted data or are approximations.

Randomness and wall-clock time are allowed only in the browser playback layer. The pure decision
layer receives any needed source through an explicit parameter.

## Verification

`npm test` covers binding, spatial, director, driver, and fake-audio behavior. Use `?sounds` to
audition decoded clips and a playable scene to check event timing and positioning. Final audio quality
and balance require human listening.
