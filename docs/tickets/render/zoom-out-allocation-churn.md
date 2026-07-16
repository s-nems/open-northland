# Zoomed-out view allocates ~37 MB/s — GC hitches while panning

**Area:** render + app · **Origin:** visual-polish perf verification, 2026-07-16 · **Priority:** P2

Measured in real Chrome (Apple GPU, `?map=blekiny_nurt`, camera at MIN_ZOOM, 8 s of 100 ms
`performance.memory.usedJSHeapSize` samples, summing positive increments): **main allocates
~37 MB/s, the visual-polish branch ~42 MB/s** — the churn is pre-existing, scales with the
zoom-out (zoom ≥ 1 is ~1 MB/s), and drives frequent GCs (27–29 drops/8 s) with p95 frame times
of ~33 ms on both builds. Steady-state FPS is fine (~79); the churn shows as periodic hitches,
which the new eased camera motion makes noticeable.

Task: profile the zoomed-out frame with a real allocation profile (Chrome DevTools allocation
sampling on a real GPU — headless SwiftShader runs too few frames to weigh sites) and cut the
dominant per-frame garbage until the zoomed-out allocation rate is within ~2× of the zoom-1 rate.
Leads from a headless CDP sampling pass (small absolute sizes there, but the only per-frame app
sites that surfaced):

- `minimap drawDots` (`packages/app/src/view/minimap/index.ts`) — rebuilds Graphics dots per frame;
  the headless sampler's top app-code site, plus downstream `GraphicsContext` allocation inside Pixi.
- Pixi render-group instruction churn (`collectRenderablesSimple`, `packQuadAttributes`,
  `addRenderable` frames) — check whether per-frame `.visible` toggles or Graphics rebuilds force
  instruction-set rebuilds scaling with visible mesh count.
- `takeSnapshot`/`cloneEntity` (`packages/sim/src/inspect/snapshot.ts`) — the per-frame snapshot
  clone; verify it is not re-cloning unchanged stores.

Verify: repeat the A/B measurement procedure above (it is cheap and robust) before/after; the
perf overlay's `pamięć` should stop sawtoothing tens of MB at MIN_ZOOM.
