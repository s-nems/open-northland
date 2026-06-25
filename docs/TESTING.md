# Testing & the agent feedback loop

This project is built largely by LLM agents. An agent is only as good as its ability to **check its
own work**. The architecture is shaped to make that possible: because the simulation is
**deterministic and headless**, almost everything that matters can be validated by running
`npm test` and reading pass/fail — no screen, no human in the loop. The one exception (pixels /
"feel") is called out explicitly so an agent never *claims* it when it can't prove it.

## The core principle

> If a change can break the game, there must be a test an agent can run that fails when it does.

The sim mutates state **only** through serializable commands, advances in fixed deterministic
ticks, and exposes a canonical `hashState()` over all components. That gives us, for free:
same-seed reproducibility, replay, faster-than-real-time runs, and the ability to localize the
exact tick a regression appears. Lean on it.

## The pyramid (all levels run under `npm test` / vitest)

### 1. Unit — pure functions & single systems
Fast, many, no `Simulation`. Targets: `fixed.ts` math (and its overflow assertions), `rng.ts`
reproducibility, the ECS (`world.ts`) query/insertion-order contract, and **one system over a
hand-built world** (e.g. `movementSystem` advances positions by velocity).
See `packages/sim/test/determinism.test.ts`.

### 2. Integration — many systems over many ticks
Build a `Simulation` from the synthetic `testContent()` fixture, run hundreds of ticks, and assert:
- **Determinism:** two sims, same seed + inputs ⇒ identical `hashState()`.
- **Invariants** (`src/invariants.ts`): no negative stock, hunger in range, building sanity — and
  domain laws as they land: **goods conservation** (goods are created only by production, destroyed
  only by consumption), **liveness/no-deadlock** (some settler makes progress each interval),
  **path validity** (waypoints are walkable cells).
See `packages/sim/test/scenario.test.ts`.

### 3. E2E at the game level — headless scenarios (the key agent layer)
The `scenario()` harness (`src/scenario.ts`) scripts the **same commands the UI issues**
(place building, spawn settler, set production), runs the deterministic sim for N ticks, and
asserts outcomes plus invariants **after every tick** (so a failure reports the exact breaking
tick, not just "something's wrong at the end"). This exercises the whole game loop —
placement → AI → atomic actions → economy → population — as an ordinary test an agent runs itself.

```ts
scenario(content)
  .placeBuilding('headquarters', 10, 10)   // (Phase 2, once CommandSystem exists)
  .spawnSettler('woodcutter')
  .run(2000, { checkInvariantsEachTick: true })
  .expect('settlement produced planks', (sim) => totalGood(sim, PLANK) > 0)
  .assertOk();
```

### 4. Save/load & replay equivalence
Two deterministic checks, both headless:
- **Replay:** run a command log from seed → state A; replay the same log → state B; `A === B`.
- **Snapshot round-trip:** run K ticks, snapshot, run K more → hash H; reload the snapshot, run K
  more → hash H′; assert `H === H′`. This guards the save format and any hidden nondeterminism.

### 5. Golden traces — behavioral regression
Beyond state hashes, record the **canonical sequence of atomic actions** a settler performs in a
fixed scenario (e.g. `[walk, harvest, pickup, walk, pileup, …]`) and diff against a committed
golden. When AI/economy tuning changes behavior, the diff is human/agent-readable — far more
useful than "hash changed." Intentional change → update the golden in the same commit.

## Running & debugging tests

All levels run under `npm test` (vitest). For the inner loop:
- **One file/suite:** `npm test -- scenario` (a name-substring filter) — e.g. `npm test -- hygiene`
  for just the determinism scan, `npm test -- determinism` for the unit goldens.
- **Watch mode:** `npm run test:watch` re-runs on save while you iterate on one system.
- **Typecheck only:** `npm run typecheck` (it's `tsc --build`, identical to `npm run build`).

**Debug a failing invariant.** Integration/scenario invariants assert *after every tick*, so a
failure names the **exact tick** it broke (`… at tick N`). Re-run that one scenario, narrow to that
tick, and inspect — don't re-read the whole run. A determinism failure (two same-seed runs diverge)
means a nondeterministic global or a `Map`/`Set` iteration leaked into a game decision: the hygiene
test catches the global class, the hash-divergence test catches the rest.

**Updating a golden** (state-hash or atomic-trace) is a deliberate four-step act, never a reflex:
1. Run `npm test` and read **which** golden moved.
2. Confirm the diff is **exactly** the mechanic you intended to change. A pure refactor must move
   *no* golden — if one moves, a real change crept in: stop and reassess.
3. Update the inline expected value in the same commit.
4. **Name the mechanic** in the commit message so the behavioral change stays auditable.

## What an agent CANNOT self-validate (be honest)

- **Pixel fidelity & "feel"** — isometric depth-sort correctness, animation anchors, pathing
  smoothness. Approaches: (a) **deterministic Playwright screenshots** an agent eyeballs for
  *gross* correctness (blank screen, missing terrain, sprites in the wrong iso half) — see
  *Visual validation via Playwright* below; (b) explicitly defer to a human and *say so* rather
  than asserting it works from a green typecheck. Either way: never auto-pass a render result.
- **Asset-decode correctness** — use the **OpenVikings oracle**: OpenVikings boots and renders the
  original assets, so compare the pipeline's decoded PNG/atlas output pixel-for-pixel against it.
  Plus decoder round-trip unit tests against tiny locally-generated fixtures (never commit
  copyrighted fixtures).

### Visual validation via Playwright — the decision (and why not the MCP)

Playwright closes *part* of the pixel gap — deliberately, and as a **committed script, not the
Playwright MCP**:

- **The lever is agent vision, not Playwright.** A deterministic screenshot is something an agent
  *can* look at and judge for **gross** correctness; the sim's determinism makes that frame a
  reproducible input. Playwright is just the cheapest way to produce the frame. Fidelity and
  "feel" (sub-pixel anchor drift, pathing smoothness) still need human eyes.
- **Committed `npm run shot` script, not the MCP.** The Playwright MCP's edge — accessibility-tree
  snapshots + click-by-role — is **blind to a `<canvas>`**, and the game is one canvas with no
  inner DOM (Canvas-2D, then Pixi/WebGL). So the MCP collapses to "a screenshot, statefully,
  outside git." A committed script is reproducible, lives in the repo, runs in CI, and can graduate
  to golden-image diffs. (The MCP is fine for a one-off "boot it and look," never the backbone.)
- **Prerequisite — a deterministic, headless render entry (now built).** The harness needs *"render
  scenario X at seed S, advance N ticks, draw one frame, then signal ready"* — not the wall-clock
  `requestAnimationFrame` loop. That entry now exists: `packages/app/src/shot.ts` (`?shot[&seed&ticks]`)
  builds the vertical slice (`vertical-slice.ts`), steps a fixed N ticks, draws ONE frame via the Pixi
  renderer (`packages/render/src/pixi-renderer.ts`), and sets `window.__vinlandShotReady`. `npm run
  shot` (`packages/app/scripts/shot.mjs`) boots the app's Vite dev server, drives Chromium via the
  committed Playwright script, waits on that flag, and writes a PNG (`--seed/--ticks/--out`). The
  renderer draws placeholder geometry (iso tile diamonds + feet-anchored body boxes) — atlas sprites
  are a later leg, since real bobs are copyrighted/gitignored.
- **Golden images are secondary and brittle.** The rendered frame is *not* byte-stable across
  machines (float interpolation, devicePixelRatio, canvas AA, GPU/fonts) even though the sim is.
  Start with *eyeball-the-PNG*; add `toHaveScreenshot()` baselines only once the render stabilizes,
  treat any diff as **needs human** (never auto-pass), and keep them sparse — they're binary churn
  and capture the *Vinland* synthetic render, never original assets.

**Manual poke via the Playwright MCP (ad-hoc, not the backbone).** A `playwright` MCP server is
available at *local* scope (`claude mcp get playwright`; private to this project, not committed) for
**interactive** visual checks while iterating — the complement to the committed `npm run shot`
script, not a replacement. Workflow once something renders: run `npm run dev`, point the MCP browser
at the Vite URL (`http://localhost:5173`), screenshot, and eyeball for **gross** correctness only.
The `<canvas>` has no accessibility tree, so the MCP's snapshot/click-by-role tools are blind here —
**screenshots are the only usable surface**. It is manual and stateful: nothing it does lands in git
or CI, and there is nothing to see until a renderer exists (HEAD draws a blank canvas). For anything
you'd want to *re-run or gate on*, write the `npm run shot` script instead.

## Reproducibility of fixtures

Golden/scenario tests must reproduce on any machine, but `content/` is generated from a copyrighted
game copy and is gitignored. Therefore tests use the **committed synthetic fixture**
(`packages/sim/test/fixtures/content.ts`) — hand-authored, no copyrighted data. Keep it in lockstep
with the schema. Never make a golden test depend on generated `content/`.

## The agent's checklist (also in CLAUDE.md)

1. Write/extend the test at the **lowest level** that proves the change (unit > integration > e2e).
2. Run `npm test`. Read failures; if invariants fired, note the **tick** they reported.
3. Determinism golden changed? Only update it if the change was **intentional** — say which mechanic.
4. Visual/render change? Run the screenshot diff if available; otherwise state plainly it needs a
   human. Never claim a visual result from a passing typecheck.
