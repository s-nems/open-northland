# Give packages/app a DOM test environment

**Area:** app (test) · **Origin:** review of feat/loading-screen, 2026-07-17 · **Priority:** P3

The repo has no DOM test environment: no `jsdom`/`happy-dom` dependency anywhere, and no vitest
`environment` setting. Every DOM-mounting module in `packages/app` is therefore proven only by its pure
half — `view/boot-progress.ts` unit-tests `bootFraction` while `mountBootProgress`/`dismissBootProgress`
(a module-level singleton, `document.body` mutation, an idempotent teardown) are untested, and the same
holds for `view/overlay.ts`, `diag/crash.ts`, and the menu's mount path.

This is the shape that regresses silently: a refactor that drops a teardown or double-mounts leaves the
suite green. The pure/DOM split the modules already follow is the right design — it just has no harness
for the DOM side. A second instance surfaced on fix/camera-startup-edge-drift (2026-07-18): the
`createCameraController` edge-scroll drifted the camera to the top-left at load because `pointerInside`
went true (via `mouseenter`) while `pointerX/pointerY` were still the stale initial `(0,0)` — a
controller-state coupling the pure `edgePanVelocity`/`stepZoomToward` tests structurally cannot see.

**Investigate first:** whether this is worth a repo-wide dependency. The alternative is to keep proving
DOM behaviour in the browser (Playwright, as `scripts/shot.mjs` already does) and leave these modules
unit-untested on purpose. Decide that before adding the dependency — do not add `jsdom` just because a
test would then be possible.

## Scope

- Add a DOM environment (`jsdom` or `happy-dom`) as a dev dependency, opted into per file via
  `// @vitest-environment jsdom` so the node-only suites (sim, pipeline) keep their current speed.
- Prove `view/boot-progress.ts` first, as the module that prompted this: mount → `finish()` leaves
  `document.body` empty; `dismissBootProgress()` is idempotent; a remount drops the previous card.
- A natural second target is `view/camera.ts`'s `createCameraController`: dispatch `mouseenter` then
  step `update()` and assert no pan before the first `mousemove` (the fix/camera-startup-edge-drift
  regression), plus that edge-scroll resumes after a real move.
- Note in `docs/TESTING.md` when a DOM test is the right tool versus a browser pass.

## Verify

- `npm test` stays green and does not slow down measurably for the node-only packages.
- The new tests fail when the teardown is deliberately removed (prove they bite).
