# Roadmap

Phased plan. Each phase ends with something runnable or testable. The **current target** is the
top unchecked milestone. Do the smallest next step toward it; don't build ahead.

## Phase 0 — Foundation  ✅ (this scaffold)
- [x] Monorepo, packages, docs, conventions, determinism rules.
- [ ] `npm install` + `npm run build` + `npm test` green on the stub.

## Phase 1 — Asset pipeline (de-risk formats first)
Goal: turn your owned game copy into the IR. This removes the biggest technical unknown.
- [ ] `.lib` archive unpacker (ref: `CSimpleFileLibrary.cs`).
- [ ] Palette + `.pcx` decoder → PNG (ref: `CPalette.cs`, `CPicture.cs`).
- [ ] `.bmd` bob decoder → atlas PNG + anim JSON (ref: `CBobManager.cs`, `CBitmap.cs`). **Hardest.**
- [ ] `.ini` rule parser → typed IR for goods/buildings/jobs/weapons (prefer `DataCnmd/*.ini`).
- [ ] One map decoded to IR.
- **Exit:** `npm run pipeline` produces a validated `content/` for one campaign map + its types.

## Phase 2 — Vertical slice (prove the sim)  ← **first real target**
Goal: one tribe, headless-correct, then on screen.
- [ ] Terrain grid world resource from a map IR; walk/build queries.
- [ ] Render: draw isometric terrain + a static settler sprite from the atlas.
- [ ] Pathfinding + MovementSystem (fixed-point) across the grid.
- [ ] One settler: AI picks "gather wood" → path to tree → harvest → carry to store.
- [ ] One workplace consuming one input → producing one good (ProductionSystem).
- [ ] Golden determinism test over ~1000 ticks of the above.
- **Exit:** click to place one workplace; a settler autonomously supplies it; deterministic + tested.

## Phase 3 — Economy & population
- [ ] Multiple goods, the food chain (NeedsSystem: settlers eat, houses consume).
- [ ] JobSystem assignment across many workplaces; carriers (TransportSystem).
- [ ] ConstructionSystem: place → deliver materials → build.
- [ ] ReproductionSystem: families, children, growth.
- [ ] HUD: stocks, population, job overview.
- **Exit:** a self-sustaining single-tribe settlement you can grow.

## Phase 4 — Conflict & content breadth
- [ ] Second tribe; CombatSystem from `weapontypes` (range/melee/damage tables).
- [ ] Animals (`animaltypes`), vehicles/boats (`vehicletypes`) — incl. sea travel for *Northland*.
- [ ] Import full base + `culturesnation` content; bring over the mod's balance changes.
- **Exit:** two tribes can fight; most content types represented.

## Phase 5 — Campaigns, polish, platform
- [ ] Campaign/scripting layer; load `OsmyCudSwiata` / `WyprawaNaPolnoc` / `BramyAsgardu`.
- [ ] Save/load (seed + command log; then snapshot fast-load).
- [ ] Audio (transcoded ogg; no DirectMusic dependency).
- [ ] Tauri desktop builds for Mac/Win/Linux.
- [ ] (Stretch) lockstep multiplayer — the determinism work pays off here.

## Explicitly deferred / risks to watch
- **`.cif` decryption** — avoid by preferring `.ini`; only if a needed type is `.cif`-only.
- **Settler AI fidelity** — the soul of Cultures and *not* documented anywhere; reconstruct by
  observation + design. Expect iteration; this is where most effort goes.
- **Triangle landscape grid** — non-trivial geometry for pathfinding/placement; model + test alone.
- **Determinism drift** — every new system must keep golden tests green.
