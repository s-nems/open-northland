# Verify whether the worker host keeps ticking in a hidden browser tab

**Area:** app, net-client · **Focus:** worker host · **Priority:** P3

A hidden browser tab stops `requestAnimationFrame`. A relayed client's network worker keeps stepping
and acknowledging on its own timers and sheds the events of the ticks the display does not take;
whether a browser throttles those timers in a hidden tab, and when, is unmeasured. A single-player
`?map=` session stops by design: its worker holds the clock once the main thread leaves
`UNDELIVERED_LIMIT_SECONDS` of ticks at the session speed undelivered.
The desktop build disables Electron's background throttling and is the primary target, so this is a
check, not a design driver.

## Scope

- Measure in Chrome, Firefox and Safari whether the network worker's timer loop and its
  acknowledgements keep their cadence while the tab is hidden, and for how long before the browser
  throttles them.
- Outcome, one of two: `docs/NETWORK.md` "Background windows" states that a hidden tab keeps its
  cadence in the listed browsers, or it names the browsers that throttle the worker and the delay at
  which they do, and the limiter indication of 08 remains what tells the player.

## Verify

- The measured cadence per browser in the closing report and in `docs/NETWORK.md`.
