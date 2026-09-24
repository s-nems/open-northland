# Verify whether the worker host keeps ticking in a hidden browser tab

**Area:** app, net-client · **Focus:** worker host · **Priority:** P3
**Blocked by:** [05 Transport in the worker](05-transport-in-worker.md)

A hidden browser tab stops `requestAnimationFrame`, so today a browser client stops ticking and
acknowledging, and the room waits for it. The desktop build disables Electron's background
throttling and is the primary target, so this is a check, not a design driver.

## Scope

- With the sim and transport in the worker, measure in Chrome, Firefox and Safari whether the
  worker's timer loop and its acknowledgements keep their cadence while the tab is hidden, and for
  how long before the browser throttles them.
- Outcome, one of two: `docs/NETWORK.md` "Background windows" states that a hidden tab keeps its
  cadence in the listed browsers, or it names the browsers that throttle the worker and the delay at
  which they do, and the limiter indication of 08 remains what tells the player.

## Verify

- The measured cadence per browser in the closing report and in `docs/NETWORK.md`.
