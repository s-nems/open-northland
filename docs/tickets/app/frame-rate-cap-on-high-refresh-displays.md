# Decide and implement a frame-rate cap for high-refresh displays

**Area:** app, render · **Focus:** runtime loop · **Priority:** P3
**Needs user:** the cap's default (off, 60 fps, or match sim tick multiples) is a product choice.

The frame loop draws on every `requestAnimationFrame`, so on a 120 Hz display the render half runs
~114 times a second: on the fortress at tick ~48k, speed x3, that is 4.1 ms of draw per frame, 65% of
frame CPU, while the sim needs only 36 ticks a second. Halving the frame rate would halve the client's
largest CPU term with no change to simulation speed, and interpolated motion at 60 fps is what a 60 Hz
display already shows.

## Scope

- Add a frame-rate cap setting (settings screen, persisted like the other display options) that skips
  draw frames to hold the chosen rate, keeping the sim driver's fixed timestep untouched.
- Report the effective frame rate in the perf overlay so a capped session reads as capped, not slow.

## Verify

- With the cap at 60 on a 120 Hz display, `perf()` shows ~60 fps, unchanged delivered sim speed and
  roughly half the previous draw CPU per second; motion stays smooth to a human reviewer.
- `npm test`, `npm run check`, `npm run build`.
