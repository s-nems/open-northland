# Measuring performance

Run benchmarks on an idle machine, without tests, builds or other benchmarks. Discard reports marked
untrustworthy and rerun. Profiled timings include overhead: never use them as comparison baselines.

| Question | Tool |
| --- | --- |
| What costs time as a settlement grows? | `npm run bench:map` |
| Which function costs CPU time? | `npm run bench:profile` |
| Which function allocates memory? | `ON_BENCH_PROFILE=alloc npm run bench:profile` |
| How does cost scale with settlers/fighters? | `npm run bench:sim` |
| Did a change make the same world slower? | `npm run bench:compare` |
| Does a restored world match continuous play? | `npm run bench:parity` |
| Is a live frame limited by simulation or rendering? | `?debug=profile` and `await window.__opennorthland.perf()` |
| How does a checkpoint render at different speeds/zooms? | `npm run bench:browser` |
| What costs GPU time? | `npm run bench:gpu` |
| What does the HUD cost the main thread and the compositor? | `npm run bench:hud` |
| How much JavaScript does each entry load? | Size table from `npm run build` |

## Simulation benchmarks

These run plain Node over compiled packages, without a test runner. `bench:sim`, `bench:map` and
`bench:profile` rebuild first. `bench:compare` only reads reports.

### Real maps

```bash
npm run bench:map
ON_BENCH_MAP=magiczny_las ON_BENCH_TICKS=50000 npm run bench:map
ON_BENCH_SESSION='?map=piec_dolin&player=overseer&difficulty=0:hard,1:hard&computer=0,1&seed=144792704&weathermode=map' npm run bench:map
```

Requires generated content; `ON_CONTENT_DIR` selects another directory. The benchmark uses the
same map world builder and seat rules as the browser, including the map's reserved AI seats.

| Variable | Meaning |
| --- | --- |
| `ON_BENCH_SESSION` | A browser URL or its query, parsed as the `?map=` entry parses it; replaces the map, seat, seed, tribe and rule knobs below, which must then be unset. Fog defaults to `classic`, seed to 7 |
| `ON_BENCH_MAP` | Map id; default `magiczny_las` |
| `ON_BENCH_SEATS` | Computer seats: count `n` means `0..n-1` (default 6); a comma list names seats; `n,` selects only seat `n` |
| `ON_BENCH_SEED` | Seed; default 7 |
| `ON_BENCH_TRIBES` | Seat/tribe pairs, e.g. `0:4,1:2`; unset keeps map tribes |
| `ON_BENCH_PROGRESSION`, `ON_BENCH_NEEDS` | `on`/`off`; unset keeps map rules |
| `ON_BENCH_TICKS` | Measured ticks; default 20000 |
| `ON_BENCH_WARMUP`, `ON_BENCH_WINDOWS` | Unmeasured warm-up and report segments |
| `ON_BENCH_SYNC_DIGEST` | Include per-tick network digest cost |
| `ON_BENCH_ASSERTS=on` | Enable fixed-point overflow checks; default off, matching production |
| `ON_BENCH_JSON` | Report destination; default under `bench-out/` |
| `ON_BENCH_MARCH_TICK` | Absolute tick a player's group attack-move applies on: `ON_BENCH_MARCH_COUNT` fighters (default 300; `0` is the control run without the order) of `ON_BENCH_MARCH_SEAT` (default the seat with most fighters) sent to `ON_BENCH_MARCH_TARGET` (`hx,hy`; default the farthest headquarters of a seat at war with it); `ON_BENCH_MARCH_SPAWN` fighters (default 0) join that army from `ON_BENCH_MARCH_SPAWN_LEAD` ticks (default 300) before the order, copying its fighters' class, weapon, armor and worn equipment; prints before, order, wake (the first 50 ticks of the march), march (`ON_BENCH_MARCH_PHASE` ticks, default 1500) and after phases |

Reports include system mean/median/p95/max, the tick mean (the fast-forward throughput) and quantiles, entity counts, GC pauses, heap/RSS and
the ten slowest ticks. Rank occasional work by its mean: a system's median can be zero despite real cost.

| Metric | Meaning |
| --- | --- |
| `cpuMsPerTick` | Main-thread CPU time (user + system) per tick, per window and whole run, read at window bounds. Moves less with machine load than the wall tick; includes the harness hooks, excludes GC on helper threads |
| `allocKbPerTick` | V8 KiB allocated per tick, per window and whole run, from the isolate's cumulative counter. Nearly load-independent; the target for allocation and GC work. `null` (`n/a`) on a runtime whose V8 lacks the counter |

### Profiles

```bash
npm run bench:profile
ON_BENCH_PROFILE=alloc npm run bench:profile
```

CPU mode writes `.cpuprofile` files and tables by function/file. Allocation mode writes `.heapprofile`
files and bytes per tick. Open them in DevTools or Speedscope as appropriate.

Uses the real-map controls except `ON_BENCH_WINDOWS`, `ON_BENCH_JSON` and `ON_BENCH_CHECKPOINTS`;
defaults to 2000 ticks. With the march knobs, start the profile at the order with `ON_BENCH_WARMUP`:
`ON_BENCH_CHECKPOINT=<t90000> ON_BENCH_MARCH_TICK=90202 ON_BENCH_TICKS=1500 npm run bench:profile` profiles
the order tick and the march after the default 200-tick warm-up. Allocation sampling defaults to 4096
bytes between samples. If the inspector reply overflows, increase `ON_BENCH_ALLOC_INTERVAL` or measure
fewer ticks.

### Checkpoints

```bash
ON_BENCH_CHECKPOINT=/tmp/late.checkpoint ON_BENCH_SKIP=40000 npm run bench:profile
```

The first run builds the world, skips ticks and saves it. Later runs restore it before measuring.
Warm-up still applies because restored caches are cold. Map, seed, the canonical session search
(seats, tribes, difficulty, rules), IR version and restored state hash must match.

`ON_BENCH_CHECKPOINTS` saves extra checkpoints at absolute ticks. Writes are outside tick timings,
but their allocations affect GC measurements. Example:

```bash
export ON_BENCH_MAP=magiczny_las_12_players ON_BENCH_SEATS=0,1,2,3,4,5,7,8,9,10,11,12 \
  ON_BENCH_PROGRESSION=on ON_BENCH_NEEDS=on
ON_BENCH_TICKS=60000 ON_BENCH_WINDOWS=12 ON_BENCH_CHECKPOINT=bench-out/ml12.checkpoint \
  ON_BENCH_CHECKPOINTS=10000,20000,30000,40000,50000,60000 npm run bench:map
ON_BENCH_CHECKPOINT=bench-out/ml12.t50000.checkpoint npm run bench:profile
```

### Synthetic worlds and mirror diagnostics

`npm run bench:sim` supports `ON_BENCH_SETTLEMENTS`, `ON_BENCH_FIGHTERS`, `ON_BENCH_HUNTERS`,
`ON_BENCH_TICKS`, `ON_BENCH_WARMUP`, `ON_BENCH_WINDOWS` and `ON_BENCH_JSON`.
Hunters exercise both hare hunting and livestock fallback.

Real-map mirror controls:

| Variable | Effect |
| --- | --- |
| `ON_BENCH_MIRROR=on` | Time the worker seam as `serve.ts` pays it (delta take, event clones, facts, V8 serialization of the batch), deserialization, mirror/index application and size; check parity at each window end |
| `ON_BENCH_MIRROR_BATCH` | Ticks per delta; default 1 |
| `ON_BENCH_MIRROR_SPLIT=on` | Measure each frame index reader against a bare mirror |
| `ON_BENCH_MIRROR_PARITY=on` | Vary deltas from 1–7 ticks and check indexes after each delta |
| `ON_BENCH_MIRROR_BREAKDOWN=on` | Report component writes, equal rewrites, bytes and changed fields |
| `ON_BENCH_MIRROR_DIGEST=on` | Include the worker truth digest and main-thread check; fail on mismatch |

These diagnostics allocate memory outside timed sections; that memory still affects GC columns.

## Restore parity and comparisons

`npm run bench:parity` uses the same map controls and checkpoint. It compares restored worlds against
continuous play: state hash every 50 ticks and sync digest every tick. Matching state hashes alone
are insufficient; different write order can still cause a network desync.

| Variable | Meaning |
| --- | --- |
| `ON_BENCH_TICKS` | Default 3000 |
| `ON_BENCH_PARITY_POINTS` | Evenly spaced restore points; default 12; also checks important link/AI ticks |
| `ON_BENCH_PARITY_AT` | Extra absolute restore ticks |
| `ON_BENCH_PARITY_FRESH=on` | Compare two fresh worlds instead |

A failure names the tick and, within 16 ticks after restore, the first differing digest component/entity.
To narrow a later failure, restore just before it with `ON_BENCH_PARITY_AT`; use `npm run diag -- diff`
for hash differences.

```bash
npm run bench:compare
npm run bench:compare -- before.json after.json
```

Without arguments, compares the two latest compatible reports in untracked `bench-out/`.
It rejects different worlds/report formats, including real-map runs of different canonical sessions,
and reports changed state hashes as behavior changes.

## Browser benchmark

Start a dev server in the checkpoint's checkout, then run:

```bash
npm run bench:browser -- bench-out/late.t100000.checkpoint http://127.0.0.1:5174 bench-out/browser 15
```

Arguments: checkpoint, origin, output directory (default `bench-out/browser`), seconds per window
(default 15). The probe verifies checkout/content and restores the checkpoint hash before each window.
It uses muted headed Chromium at 1440×900 and device scale 1 ([browser and window](#browser-and-window)),
fullscreen off, no frame cap and five seconds of warm-up, with the pointer resting over the middle of
the world so each window pays the hover the same way. Input is blocked while measuring. Audio runs as in a player's game: Chromium stays muted but may
start audio without a gesture, a press of Shift (a modifier the game only tracks while held, so it selects
and orders nothing) starts the sound driver after each restore, and each window reports the frames it
decided as `audioFrames`. `bench:gpu` does the same with sound on.

| Variable | Effect |
| --- | --- |
| `ON_BENCH_BROWSER_MODE` | `baseline`, `profile` or default `all` |
| `ON_BENCH_BROWSER_WINDOWS` | Override baseline windows, e.g. `dense:3,wide:0`; cameras: `dense`, `zoom07`, `zoom05`, `wide`, `empty`; also the [moving and panning windows](#moving-and-panning-windows) |
| `ON_BENCH_BROWSER_FILTER` | Art filter: `off` (enhanced sampling off), `xbr` (default), `xbrz`, `superxbr` or `mmpx`; every other graphics setting stays at its default |
| `ON_BENCH_BROWSER_RENDER_SCALE` | Backing-resolution multiplier, 0.5 to 2; default 1 |
| `ON_BENCH_BROWSER_PROFILE_VIEWS` | Diagnostic views; default dense and wide at ×3 |
| `ON_BENCH_BROWSER_CPU_THROTTLE` | DevTools main-thread slowdown; workers are not throttled |
| `ON_BENCH_BROWSER_SEAT` | Watch a seat with its fog and HUD |
| `ON_BENCH_BROWSER_WORKER_PROFILE=1` | Profile the worker per baseline window; use a separate unprofiled run for timings |

The default matrix covers dense views paused and at ×1/×3/×10, wide views paused and at ×3/×10,
zoom 0.7/0.5 at ×3, an empty view and a repeated dense ×3 window.

`report.md` tabulates each window's RAF quantiles, delivered speed, app CPU per frame, sim time per
tick and WebGL calls under a header naming the adapter, device scale, art filter and render scale. A
second table lists each window's frames over 50 ms, its five longest frames with the second they fell
in, and the textures it uploaded. `report.json` includes RAF quantiles, performance metrics,
WebGL calls/uploads, camera, canvas, ticks, hardware and errors. Screenshots identify each view.
Diagnostic runs add CPU/allocation/GPU profiles; their timings include instrumentation overhead.

Periodic hitches, such as the minimap's object rebake every 4 s while objects change, show in the
second table of long windows over a watched seat:

```bash
ON_BENCH_BROWSER_WINDOWS=dense:3 ON_BENCH_BROWSER_SEAT=0 npm run bench:browser -- <checkpoint> <origin> <out> 30
```

### Moving and panning windows

`dense-move` and `wide-move` frame the dense and wide views while the real pointer travels a Lissajous
curve over the middle of the world at a mean 60 px/s, sending a move every 8 ms, which the browser
coalesces to one per frame. Pointer moves reach the game; keys, wheel and buttons stay blocked. Each
window's `pointerMoves` in `report.json` counts the moves the game received, none in a window at rest.
Read `dense-move-x3` against `dense-x3` for what pointer movement costs, such as the scene hit test.

`first-pan` measures from the restore on, without warm-up and for 10 s whatever the window length, while
the camera pans one lap of an ellipse from the dense view at 900 px/s (the arrow keys' rate at scroll
speed 1): the first uploads and first-use hitches of a session land in it. Read its spikes row.

Hidden tabs, camera/canvas drift and browser errors invalidate windows and fail the command.
One-minute OS load per CPU above 1.5 at either boundary also invalidates a window. Platforms without
load averages mark that check unavailable. Passing these checks alone does not prove an idle machine.
Failures retain completed results before closing the browser.

### Browser and window

`bench:browser`, `bench:gpu`, `bench:hud` and `bench:browser-shots` share these:

| Variable | Effect |
| --- | --- |
| `ON_BENCH_VIEWPORT` | Window as `WxH`; default `1440x900`. Numbers compare only at one size; `1920x1080` is the players' resolution |
| `ON_BENCH_DEVICE_SCALE` | Device pixel ratio; default 1; `2` measures a Retina display |
| `ON_BENCH_WINDOW_POSITION` | `x,y` screen position of a headed browser window, to keep it on a display nobody works on; a covered window keeps its frame rate, a minimized one does not |
| `ON_BENCH_CDP` | DevTools endpoint, e.g. `http://127.0.0.1:9333`, of a running Chromium to drive instead of launching Playwright's |

A browser reached over CDP keeps the flags and window position it started with, so start it windowed
with a fresh profile, `--mute-audio` and `--autoplay-policy=no-user-gesture-required`, plus the ANGLE
backend to measure (`--use-gl=angle --use-angle=d3d11` for Windows Chrome driven from WSL). Its load is
outside the load gate's host, which then reads only the dev server and the script; the report says so
and names the browser version and endpoint beside the adapter. Over CDP, `ON_BENCH_VIEWPORT` is emulated
on the page rather than applied to the window, so the page renders at `WxH` whatever the window's frame
shows.

### Reading frame metrics

| Metric | Meaning |
| --- | --- |
| `perf().frame` | Recent exponential moving averages |
| `perf().window` | Whole-window means: CPU, receive, draw and world-renderer cost |
| `frame.simMs`, `window.simMsPerTick` | Worker simulation time |
| `frame.receiveMs`, `window.receiveMsPerTick` | Main-thread mirror update; Chromium also includes message deserialization |
| `window.batchesPerFrame`, `window.maxLeadTicks` | Messages received per frame and worker lead |
| `throughput.deliveredSpeed`, `droppedTicks` | Actual game speed and missed simulation ticks |
| `perf().frame.gpuMs` | RAF interval minus app CPU, including idle/vsync/compositor time; **not GPU execution time** |
| `perf().gpu.ms` | Actual WebGL timer span, averaged over half a second; null when the FPS counter is off |
| `perf().gpu.adapter` | WebGL renderer string |

Worker lead is bounded (`leadTickLimit`). A slow main thread reduces FPS and eventually game speed.
Pause before reading a stopped tick, and reject samples with `sampling.hidden`.
The GPU timer covers ground-wave rendering through the last inset, not DOM HUD compositing.

## GPU benchmark

```bash
npm run bench:gpu -- bench-out/late.t100000.checkpoint http://127.0.0.1:5174 bench-out/gpu 5 3
```

Arguments: checkpoint, origin, output directory (default `bench-out/gpu`), seconds per repeat
(default 5), repeats (default 3). Each scenario restores the checkpoint/settings, enables the FPS
counter, warms for three seconds and samples GPU time every half second. With a prescaled art filter it
then waits until no drawn page waits for its twin, up to 30 s; a window in which prescale passes ran
is void as `prescaling`, and the table lists the twins, their memory and the pages over budget.

Scenarios cover enhancements off/on, each magnifier at zoom 0.5/0.7/1/2, pause/×3, a selected settler
and portrait, groups of 10 and at least 50 settlers, rain, snow, sand, a thunderstorm, a blizzard and
clear weather, and zoom 0.35.
`ON_BENCH_GPU_SCENARIOS=panel-x3,on-x3` selects specific scenarios.

Framing scenarios:

| Scenario | Shows | Read against |
| --- | --- | --- |
| `coast-x3` | The shore waves nearest the densest town, kept inside the view, the view shifted towards the town | `coast-no-environmentMotion-x3`, the same view without the wave pass |
| `roads-hidden-paused`, `roads-hidden-off-paused` | The paused dense view with the road layer hidden, art filter xBR or off | `magnify-xbr-z1`, `magnify-off-z1` |
| `panel-hover-x3` | One selected settler's panel with the pointer over the middle of the world | `panel-x3` |
| `trade-x3` | The trade window of the nearest trader whose route joins two own houses, opened with clicks, with its house portraits | `panel-x3` |

A map without shore waves, or without a trader whose trade window opens, skips that view; `report.md`
says so under the table.

Toggle scenarios run at ×3 with every graphics setting on but one: `no-<setting>-x3` against `on-x3`,
and `-z0.5` twins at zoom 0.5, for soft shadows, enhanced water, environment motion, grounded buildings,
building damage, post-processing (`postFxEnabled`) and sprite smoothing. Blood and bone fading show only
where fighting is, so `battle-no-blood-x3` and `battle-no-bonesFade-x3` read against `battle-x3`, framed
on the densest cluster of fighters holding a target (bone piles when nobody fights). `scale1.5-x3` and
`scale2-x3` set the render scale. At ×3 a setting that costs under a millisecond sits inside the
timer's clock-mode noise (below), so these scenarios give each setting's WebGL calls and texture uploads,
and the milliseconds only of costs as large as render scale; a setting's GPU milliseconds come from the
[per-setting loop](#per-setting-gpu-cost).

`report.md` has the summary; `report.json` has every repeat. The summary uses the lowest per-repeat
median and includes WebGL calls, selection/inset counts and adapter. Load, visibility and camera
checks apply here too. Missing supported GPU readings or incomplete selections fail the scenario.
Read milliseconds only from an idle machine; WebGL call counts remain useful under load.

### Per-setting GPU cost

The measured column of the cost basis in [GRAPHICS.md](GRAPHICS.md#cost-basis) comes from a paused,
GPU-bound loop run in the page through `window.__opennorthland`; no command wraps it yet.

1. Restore the checkpoint with every graphics option on, frame the densest buildings (the densest
   fighting for blood and bones) at the zoom under test, run ten seconds at ×3 so bakes and caches
   settle, pause, and wait 1.5 s.
2. Per cycle, set the option on and off in turn (`renderer.setGraphicsEnhancements`, or
   `renderer.chrome` for post effects and sprite smoothing), alternating which state comes first.
   After each change wait four animation frames and render 15 frames unmeasured.
3. Time one state: a 1x1 `gl.readPixels` drains the GPU, then `renderer.app.render()` runs 60 times
   with `gl.flush()` after each, then a second `readPixels`. The wall-clock span over 60 is that
   state's milliseconds per frame.
4. Ten cycles. The setting's cost is the median of the per-cycle on-minus-off differences, reported
   with their range, beside a control row that sets nothing.

The loop redraws one paused stage, so it measures drawing alone, not baking or uploads.

Any loop that renders many frames between two `readPixels` must call `gl.flush()` once per frame, as
a real present does. Without it, ANGLE over Metal stacks the frames into one command buffer that runs
about 50% slower, and anything that switches the render target (a filter, Pixi's `useBackBuffer`)
breaks the stack up and looks like a saving it is not.
Time such a loop on the wall clock, from a drained GPU (`readPixels`) to a final drain, with enough
GPU work per frame that the CPU never waits on it. Timer queries do not fit a loop: one query around
it counts the GPU's idle gaps, and on Apple GPUs a query per frame overlaps the neighbouring frames' work
and grows along the run (about 4 ms at the first frame and 17-20 ms by the twentieth, where the
app's own meter read about 9 ms).

At ×3 on an Apple M2 Pro, `perf().gpu.ms` holds one of two clock modes for seconds at a time, about
3.5 ms apart in a dense view, so a setting that costs well under a millisecond only shows as a paired
on/off delta within one mode; the paused loop above is steadier for a per-setting cost.

Playwright's default headless browser renders on SwiftShader, far below a real frame rate; launching
with `channel: 'chromium'` runs Chromium's new headless mode on the real GPU, which suits counts and
pixel captures of a probe that should not open a window.

## HUD benchmark

```bash
npm run bench:hud -- bench-out/late.t100000.checkpoint http://127.0.0.1:5174 bench-out/hud 5
ON_BENCH_VIEWPORT=1920x1080 ON_BENCH_HUD_TRACE=1 npm run bench:hud -- <checkpoint> <origin>
```

Arguments: checkpoint, origin, output directory (default `bench-out/hud`), seconds per window (default
5). Each scenario restores the checkpoint with every graphics setting at its default, watches one seat
over its own densest cluster, reaches its HUD state with the player's input (a click, a box drag, a
window's key) and measures at x3 with the pointer resting on the bottom bar. Scenarios: nothing open,
a settler or a building selected (and each again with the pointer over the world), the residents
window, the mission book, diplomacy, the construction window (and switching its tabs every 0.4 s), the
notices, 50 or more settlers selected, the pointer over the world, the mouse button pressed and
released every 0.25 s, the FPS counter and group numbers.

`report.md` lists the RAF interval's median, 95th percentile and maximum, and per rendered frame:
layouts and style recalculations with their milliseconds, script and task time, DOM mutations,
composited layers and their repaints, portrait insets and HUD nodes.
`report.json` adds the mutations by HUD class and the layers by owner and compositing reason. Counts
are robust to load; durations are not. The browser is the full Chromium build headless, on the GPU at
60 frames a second, unless `ON_BENCH_HUD_HEADED=1`: a headless page composites without presenting to a
display, so compositor and frame-pacing readings need the headed run (with `ON_BENCH_WINDOW_POSITION`).
The [browser and window](#browser-and-window) variables apply, `ON_BENCH_DEVICE_SCALE` and `ON_BENCH_CDP`
included; the report's header names the device scale and, over CDP, the endpoint.

| Variable | Effect |
| --- | --- |
| `ON_BENCH_HUD_SCENARIOS` | Comma-separated scenario ids |
| `ON_BENCH_HUD_SEAT` | The watched seat; default 0 |
| `ON_BENCH_HUD_TRACE=1` | A 3 s trace after each window: the renderer's frame phases, the compositor, raster and the GPU process per frame; `keep` also writes the whole trace as `<scenario>.trace.json` (about 100 MB) |
| `ON_BENCH_HUD_INVALIDATIONS=1` | The trace also names what restyles, relayouts and repaints (node, cause, script frame), with a census of running CSS animations |
| `ON_BENCH_HUD_PROFILE=1` | A CPU profile after each window, self time by source area and function |
| `ON_BENCH_HUD_AB_CSS` | A stylesheet traced interleaved without (A) and with (B) it, four rounds ABBA, each side's frame pacing, app frame cost and phases averaged: a pure style change measured in one session |

## Render comparisons

Capture both versions with the same paused checkpoint:

```bash
npm run bench:browser-shots -- capture <checkpoint> <origin> <out-dir>
npm run bench:browser-shots -- compare <dir-a> <dir-b>
```

Compares pixels at zoom 1, 0.5, 0.35 and 2. `ON_BENCH_SHOT_STEPS` optionally advances ticks first.
