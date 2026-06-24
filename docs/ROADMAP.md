# Roadmap

Phased plan. Each phase ends with something runnable or testable. The **current target** is the
top unchecked milestone. Do the smallest next step toward it; don't build ahead.

> This roadmap was revised after a design review against the actual game data. Key corrections:
> `.cif` decoding is on the critical path (not deferrable); settler behavior is an **atomic-action
> planner** (not bespoke per-job code); a **progression/tech graph** is a first-class system;
> navigation is a **cell graph** (the triangle grid is a *render* concern); there are **N tribes**,
> not two. See docs/SOURCES.md and docs/ECS.md.

## Phase 0 — Foundation  ✅ (this scaffold)
- [x] Monorepo, packages, docs, conventions, determinism rules.
- [x] Deterministic ECS, scaled-integer fixed-point (no BigInt/overflow), seeded RNG, canonical
      full-state hash, invariants + headless scenario harness, synthetic test fixture.
- [x] Modern type vocabulary: **branded** `Fixed`/`Entity`, **discriminated-union** commands /
      atomic-effects / events + `assertNever`, typed per-tick event buffer (render/audio seam).
- [x] DX guardrails: **Biome** (format+lint), **CI** (check+typecheck+test), and a determinism
      source-hygiene test that fails if a nondeterministic global enters `sim`.
- [x] `npm install` + `npm run build` + `npm test` + `npm run check` green.

## Phase 1 — Asset pipeline + `.cif` (de-risk formats first)
Goal: turn an owned game copy into the IR. This removes the biggest technical unknowns. **`.cif`
is here, not later** — core types (`housetypes`, `weapontypes`, `trianglepatterntypes`,
`atomicanimations`) and **all maps** are `.cif`-only.
- [x] **`.cif` decrypt + container parse.** Done — `tools/asset-pipeline/src/decoders/cif.ts`
      (round-trip tested, no committed fixtures). The record layout (the genuine unknown) is
      **solved**: a `.cif` is a serialized `CStorable` graph (`[u32 id][u32 ver][body]`); type
      tables + maps root at a **`CStringArray` (id 0x3FD)** holding two Mode1-encrypted `CMemory`
      blobs (offsets table + string pool). Decrypted pool = **depth-prefixed text lines** (leading
      byte 1=section, 2=property) — the same vocabulary as the readable `.ini`. Verified end-to-end
      against `housetypes`, `weapontypes`, `trianglepatterntypes`, and a `map.cif`. See SOURCES.md.
- [x] **`.lib` archive unpacker.** Done — `tools/asset-pipeline/src/decoders/lib.ts` (round-trip
      tested via `encodeLib`, no committed fixtures). Format (LE u32s): `version` (observed 1),
      `groupCount`, `fileCount`, then group `{name,value}` and file `{name,position,size}` records;
      payloads live at absolute `position`. `decodeLib` returns zero-copy payload views; the on-disk
      record has no checksum — `findLibFile` recomputes the filename checksum (lowercased-ASCII byte
      sum) as the lookup key, like the original. Verified against real `data0001.lib` header.
- [ ] Palette + `.pcx` decoder → PNG (ref `CPalette.cs`, `CPicture.cs`). **Validate against the
      OpenVikings oracle** (it renders the originals) pixel-for-pixel.
      - [x] **`.pcx` decode + embedded palette** — `tools/asset-pipeline/src/decoders/pcx.ts`
            (`decodePcx`: header → per-row RLE → indexed pixels + 256-RGB palette via the 0x0C
            trailer; `expandToRgba` applies the palette; `encodePcx` is the round-trip inverse, no
            committed fixtures). Format ported from `CPicture.cs` `UnpackPCX` / `CPalette.cs`.
      - [x] **PNG container encode** — `tools/asset-pipeline/src/decoders/png.ts` (`encodePng`:
            `RgbaImage` → PNG bytes via signature + CRC-32'd IHDR/IDAT/IEND chunks, 8-bit colour-type-6,
            filter-0 scanlines, one zlib-deflated IDAT; `decodePng` is the round-trip inverse, no
            committed fixtures). zlib via `node:zlib` (build tool, not the sim). Foreign PNGs using row
            filters 1..4 are rejected loudly; extend when the oracle diff needs to read them.
      - [x] Wire `decodePcx` → `expandToRgba` → `encodePng` into the CLI — `cli.ts` `pcxToPng`
            (pure composition) + `convertPcxTree` walk the `--game` tree, convert each loose `.pcx`
            to a `.png` mirrored under `--out`, and skip+warn per-file on a malformed/palette-less
            picture so one bad image can't abort the batch. `npm run pipeline` now emits real `.png`.
            (`start` runs the compiled `dist/cli.js`: raw-TS strip-types can't resolve the `.js`
            import specifiers.) `.lib`-embedded pictures arrive once the unpack stage feeds this.
      - [ ] **Oracle pixel-diff** — compare an emitted `.png` against the OpenVikings render
            pixel-for-pixel. Needs an owned game copy + the oracle; an agent can't self-judge it.
      - [x] Standalone `CPalette` (id 0x3F6) decode — `tools/asset-pipeline/src/decoders/palette.ts`
            (`decodePalette`: 8-byte storable header `[u32 id=0x3F6][u32 version]` + raw 0x400-byte
            `[B,G,R,_]×256` body → 256 RGB triples reordered to match the `.pcx` trailer so they drop
            straight into `expandToRgba`; `encodePalette` is the round-trip inverse, no committed
            fixtures). Body is read raw — no CMemory wrapper or encryption. For bobs/maps; the `.pcx`
            trailer still covers picture palettes. Ported from `CPalette.cs` + `XBStorable.cs`.
- [x] `.ini` rule parser → typed IR — `decoders/ini.ts`. `parseIniSections` reduces readable
      `Data/logic/*.ini`/`DataCnmd/types/*` (and, via `cifLinesToSections`, decoded `.cif`) to a
      generic `RuleSection` model; the `<CULTURES_CIF_BEGIN>` header line is skipped and `//`
      comments stripped (quote-aware). The byte→text seam is `decodeIni`, which decodes raw bytes as
      **CP1250** (Windows-1250), not UTF-8 — display names carry Polish glyphs in 0x80..0xFF that a
      UTF-8 read would mangle; ASCII structure is unaffected. Typed extractors (goods/jobs/tribes/
      landscape/atomic-animations) below build on this. **Wired into the CLI** — `cli.ts`
      `resolveIniSources` (mod `.ini` preferred per golden rule #4) + `buildIr` read the readable
      sources, run the extractors, and `parseContentSet`-validate them into `content/ir.json`. Verified
      end-to-end on the real game: 65 goods, 55 jobs, 87 landscape, 41 tribes, 896 atomic animations.
- [x] **Atomic vocabulary extraction** (free, from readable data): done in `decoders/ini.ts`
      (`extractJobs`/`extractTribes` + `atomicFor*` in `extractGoods`). Captures `jobtypes`
      `allowatomic`/`baseatomics`, `tribetypes` `setatomic` (atomic→animation per tribe),
      `goodtypes` `atomicFor{Harvesting,Cultivating,Planting,Production}`. Verified against real
      data: 55 jobs, 41 tribes (1914 bindings), 65 goods.
- [x] **Atomic timings/effects extraction:** done — `extractAtomicAnimations` in `decoders/ini.ts`
      reduces `atomicanimations.ini` `[atomicanimation]` records to `AtomicAnimation` IR:
      `length` (duration), `interruptable`, `startdirection`, and ordered `event`/`eventx`
      `(at, type, value?)` tuples. `name` is the join key onto `tribetypes` `setatomic` bindings.
      The event `type`/`value` vocabulary is undocumented — captured faithfully, interpreted by the
      Phase-2 AtomicSystem (like `AtomicId`, a raw id with no master table). **Wired into the CLI**
      via `buildIr` (see the `.ini` parser item) — `npm run pipeline` now emits real `content/ir.json`.
- [ ] `.bmd` bob decoder → atlas PNG + anim JSON (ref `CBobManager.cs`, `CBitmap.cs`). **Hardest.**
      - [x] **`.bmd` container parse** — `tools/asset-pipeline/src/decoders/bmd.ts` (`decodeBmd`:
            storable root `[u32 id=0x3F4][u32 ver]` + a 0x1C-byte header `{firstBobId, bobCount,
            packedLineDataUsedBytes, lineControlCount, 3 generator counters}` + three `CMemory`
            blocks → typed `BobRecord[]` {type, area{x,y,w,h}, misc}, the raw packed-line byte
            stream, and the `lineControl` u32 array; `encodeBmd` is the round-trip inverse, no
            committed fixtures). The `CMemory` bodies are raw here (not Mode1-encrypted like the
            `.cif` CStringArray). Ported from `CBobManager.cs` `CBobManager(CFile)` /
            `Storable_SaveData` / `ReadBobDataFromMemory` + `SBobData`. **Hands-on:** all 247 real
            `.bmd` decode + round-trip structurally byte-equal (e.g. `ls_gui_window.bmd` = 193 bobs).
      - [ ] **Packed-line RLE → frame pixels.** Decode each bob's scanlines from the packed-line
            stream (`lineControl[absoluteY]` = `[xMin (10b)][offset (22b)]`), applying the
            per-bob-type codec (1-bit mask / 8-bit / double-byte) → indexed pixels, then palette/remap
            → RGBA. Ref `CBobManager.cs` `PrintBob_*Core` + the packed-line walkers (~line 1700+).
      - [ ] **Atlas PNG + anim JSON.** Pack decoded frames into an atlas via `encodePng`; emit frame
            rects + per-bob metadata as anim JSON. Validate against the OpenVikings oracle.
- [ ] One map (`map.cif` + its `.ini`/`.inc` parts) decoded to IR.
- **Exit:** `npm run pipeline` produces a validated `content/` (types + atlases + one map), decoded
  graphics verified against the oracle.

## Phase 2 — Vertical slice (prove the sim)  ← **first real target**
Goal: one tribe, headless-correct, then on screen. Establish the invariants that the rest depends on.
- [ ] **CommandSystem + serializable command schema** — the ONLY way state mutates. Save = command
      log from day one (disk format later; the invariant is now). Define the **snapshot read-view**
      (double-buffer or immutable view) so `render` never reads mid-mutation.
- [ ] Terrain as a **cell-adjacency graph** with per-type walk cost/valency (from
      `landscapetypes.ini`). *Not* the triangle geometry — that's render-only.
- [ ] PathfindingSystem: A* on the cell graph with **canonical tie-breaking** (budgeted/tick).
- [ ] MovementSystem (fixed-point) following paths.
- [ ] **Atomic planner slice:** AISystem picks an atomic (utility over the job's allowed atomics);
      AtomicSystem executes it to completion and applies its effect. One settler: harvest wood →
      pickup → carry → pileup at store.
- [ ] One workplace: ProductionSystem consumes input → output, **enforcing per-good stock capacity**.
- [ ] A minimal **carrier** moving goods between store and workplace (goods never teleport).
- [ ] Render: isometric terrain + the settler sprite from the atlas, **depth-sorted by feet anchor**
      (a visual checklist item — can't be golden-hashed; see docs/TESTING.md).
- [ ] Golden state-hash + golden **atomic-action trace** over ~1000 ticks; invariants each tick.
- **Exit:** click to place one workplace; a settler autonomously supplies it via atomics; carrier
  hauls output; deterministic, invariant-clean, replay-equal.

## Phase 3 — Economy, progression & population
- [ ] Full **goods graph** as an explicit IR artifact (extract from `goodtypes.productionInputGoods`):
      raw → flour/plank/tool → bread/weapons, two food tiers (`food_simple`/`food_extra`).
- [ ] NeedsSystem: hunger + non-food needs implied by atomics (eat, plus deferred-but-named
      `pray`/`enjoy`/social/`make_love`).
- [ ] **ProgressionSystem** — experience + tech graph: `humanjobexperiencetypes` per-specialization
      XP, `trainforjob` schooling, `needfor*`/`allow*`/`jobEnables*` gating goods/houses/jobs/vehicles.
- [ ] JobSystem assignment across many workplaces; multiple carriers + vehicle stock slots.
- [ ] ConstructionSystem: place → deliver materials → build; **house leveling** (`home level 00..04`)
      → population capacity → the births→housing→births loop.
- [ ] ReproductionSystem: families, children growing up, gated by housing.
- [ ] HUD: stocks, population, jobs, the goods graph.
- **Exit:** a self-sustaining, progressing single-tribe settlement you can grow.

## Phase 4 — Conflict & content breadth (N tribes)
- [ ] CombatSystem from `weapontypes`/`armortypes` (a large subsystem: many soldier classes, armor
      tiers, named heroes, amulets/potions — scope it honestly).
- [ ] **N data-defined tribes** (viking/frank/saracen/byzantine/egypt), asymmetry expressed through
      each tribe's atomic bindings + `allow*`/`needfor*` graph — never hardcode "two".
- [ ] **Animals as non-controllable tribes** (`animaltypes.ini`: aggression, groups, hitpoints) —
      same entity/AI model, not a separate bolt-on.
- [ ] **Sea/Northland identity:** water valency, boats as mobile stores, embark/disembark atomics,
      `fisher_sea`/`trader_sea`/`carpenter ship`, `vehicle_ship`.
- [ ] Import full base + `culturesnation` content; bring over the mod's balance edits (data).
- **Exit:** N tribes can coexist/fight; sea travel works; most content types represented.

## Phase 5 — Campaigns, polish, platform
- [ ] Campaign/scripting layer (decide early: data-driven triggers preferred over code) — load
      `OsmyCudSwiata` / `WyprawaNaPolnoc` / `BramyAsgardu`. **Verify whether mod campaigns carry
      scripted behavior** a data-only pipeline would miss.
- [ ] Save/load: command-log replay + **snapshot fast-load** (replay-all is unviable for hours-long
      settlements). Snapshot schema designed alongside components in Phase 2, finalized here.
- [ ] Audio (transcoded ogg; no DirectMusic `.sgt`/`.dls` dependency).
- [ ] Tauri desktop builds for Mac/Win/Linux (renderer stays WebView-compatible).
- [ ] (Stretch) lockstep multiplayer — the determinism work pays off here.

## Cross-cutting DX (modern wins — the deterministic core makes these cheap)
- [ ] **Run the sim in a Web Worker.** It's pure/headless/deterministic, so moving `step()` off the
      main thread keeps render at 60fps under heavy ticks. Design the Phase-2 snapshot as a plain
      **transferable** structure (no class instances / live `Map`s) so this is free later, not a retrofit.
- [ ] **Time-travel / replay inspector.** With `rng.getState/setState`, the command log, and
      `hashState`, a dev overlay can scrub ticks, diff state between two ticks, and dump an entity.
      "Hash diverged at tick 432" → jump there → inspect. Biggest debuggability multiplier for agents.
- [ ] **Content hot-reload.** Content is validated JSON injected into the sim; wire Vite HMR to
      re-parse and rebase the sim on file change → instant balance-tweak feedback, no rebuild.

## Risks & open unknowns (watch these)
- ~~**`.cif` decrypted payload structure**~~ — **SOLVED** in Phase 1 (`decoders/cif.ts`): root
  `CStringArray` of Mode1-encrypted depth-prefixed text lines; verified on type tables + a map.
  Remaining map unknown: the binary tile grid, if stored outside the logic-header CStringArray.
- **Settler AI fidelity** — the soul, undocumented. Approach = planner over the data-extracted
  atomic vocabulary; base atomic timings/yields come from `atomicanimations.ini` (see below), with
  only fine-tuning by observation, kept as data so tuning is a diff. See docs/ECS.md "Settler AI".
- ~~**Atomic timings/effects**~~ — **extracted** (`extractAtomicAnimations`): the mod's readable
  `DataCnmd/atomicanimations12/atomicanimations.ini` gives `length`/`event`/`startdirection` per
  named animation. Vocabulary + base timings are now in the IR; the open part is decoding what each
  `event` `(type, value)` means (yields/needs/cues) — only fine tuning should need observation.
- **Combat & campaign scripting scope** — both larger than one roadmap line implies.
- **Determinism drift** — every new system must keep golden state + trace tests green.
