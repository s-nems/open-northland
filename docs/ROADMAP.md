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
      **Wired into the CLI** — `cli.ts` `unpackLibTree` walks the `--game` tree for `.lib` archives and
      extracts each member to `--out` under its internal path (`libMemberRelPath` rewrites the
      backslash names to native separators and drops any that would escape `--out`); a corrupt archive
      or unsafe member is warned-and-skipped, not fatal. Runs first so the embedded `.pcx`/`.bmd`/`.cif`
      are available as loose files for the later stages. **Hands-on:** real `data0001.lib` → 2691
      members (189 `.cif`, 409 `.pcx`, 205 `.bmd`), a sampled `ls_bridge.bmd` byte-equal to its payload.
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
            (pure composition) + `convertPcxTree(srcDir, outDir)` walk a tree, convert each `.pcx`
            to a `.png` (mirrored under `outDir`), and skip+warn per-file on a malformed/palette-less
            picture so one bad image can't abort the batch. `npm run pipeline` now emits real `.png`.
            (`start` runs the compiled `dist/cli.js`: raw-TS strip-types can't resolve the `.js`
            import specifiers.) **Both trees are converted:** once over the `--game` tree (loose
            pictures shipped as files, mirrored into `--out`) and once **in place** over `--out`
            (the `.pcx` the unpack stage just extracted from `data0001.lib` gain a `.png` sibling) —
            so embedded pictures are no longer left unconverted. The two roots are disjoint sources;
            `--game`==`--out` is not a supported invocation. The in-place pass is not idempotent (the
            source `.pcx` survives, so a re-run re-converts it to identical bytes) — fine for a build
            tool. **Hands-on:** a scratch `.lib` embedding a `.pcx` + a loose `.pcx` → the documented
            `npm run pipeline` reports "2 picture(s) (1 loose, 1 embedded)"; the unpacked
            `data/.../embedded.pcx` gains a valid 2×2 RGBA `embedded.png` sibling, loose → `pics/loose.png`.
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
      end-to-end on the real game: 65 goods, 55 jobs, 105 weapons, 87 landscape, 41 tribes, 896 atomic
      animations.
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
- [x] **Weapon-type extraction:** done — `extractWeapons` in `decoders/ini.ts` reduces the mod's
      readable `DataCnmd/types/weapons.ini` `[weapontype]` records (the base game's `weapontypes.cif`
      is the encrypted twin; preferring the `.ini` per golden rule #4) to `WeaponType` IR:
      `minimumrange`/`maximumrange` → `minRange`/`maxRange`, repeated `damagevalue <armorClass> <value>`
      → the armor-class-keyed `damage` record, `jobtype` (the wielding job, cross-checked by
      `validateCrossReferences`), and `tribetype` — a weapon's `type` id is **not** globally unique
      (the original keys it by `(tribetype, type)`, so the same id recurs per tribe), so `tribeType`
      is captured to keep records distinguishable. The combat extras (`soundtype_*`/`munitiontype`/
      `createsmoke`/`damagetype`) aren't in the `WeaponType` schema yet — they belong with the Phase-4
      CombatSystem. **Wired into the CLI** via `resolveIniSources` + `buildIr`. **Hands-on:** `npm run
      pipeline` on the real game → **105 weapons** (`(tribeType, typeId)` distinguishes 103; the 2
      remaining are genuinely-duplicated animal records the engine resolves last-wins), all 105
      `jobType` refs resolving against the 55-job table (0 dangling).
- [x] **Building-type extraction:** done — `extractBuildings` in `decoders/ini.ts` reduces the mod's
      readable `DataCnmd/types/houses.ini` `[logichousetype]` records (the base game's `housetypes.cif`
      is the encrypted twin; preferring the `.ini` per golden rule #4) to `BuildingType` IR. A house
      record keys its id on `logictype` (not the usual `type`) and its name on `debugname`; captured:
      `logicworker <job> <count>` → `workers`, `logicstock <good> <cap> <init>` → `stock`,
      `logicproduction <good>` → `produces` (output good ids only — input goods come from the
      Phase-3 goods-graph join, `fillBuildingRecipes`, which now fills `recipe`), `logichomesize` →
      `homeSize`. `kind` maps
      `logicmaintype` (1 storage, 2 home, 3 workplace, 4 training, 5 tower, 6 vehicle, 7 wonder). The
      placement/defence/graphics extras (`debugcolor`/`logicCanEnableDefenceMode`/`logicSchoolSize`/
      `logicvehicletype`/`logicbuildon*`) are skipped — later construction/combat systems.
      `validateCrossReferences` now also checks `produces` good ids resolve. **Wired into the CLI** via
      `resolveIniSources` + `buildIr`. **Hands-on:** `npm run pipeline` on the real game → **55
      buildings** (storage 4, home 5, workplace 28, tower 3, training 2, vehicle 5, wonder 8), 69
      `produces` lines, all worker/stock/produces ids resolving against the 55-job / 65-good tables (0
      dangling).
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
      - [x] **Packed-line RLE → frame pixels.** Done — `decodeBobFrame(bmd, bobIndex)` in
            `decoders/bmd.ts` walks one bob's scanlines from the packed-line stream
            (`lineControl[area.y + line]` = `[xMin (10b)][offset (22b)]`, `0xFFFFFFFF` = empty row;
            within a line, `0` terminates, high-bit-clear byte = raw run of `count = b & 0x7F`
            pixels, high-bit-set = transparent skip run). Dispatches on bob `type`: 8-bit (1)/TimeMask
            (3) = one index byte/pixel; 1-bit mask (2) = 0/1 byte drawn as index 0xFF; Double8Bit (4) =
            two bytes/pixel (index + skipped byte); empty (0) = transparent frame. Yields a `BobFrame`
            {width, height, indexed `pixels`, opacity `mask`} — index 0 is a real colour, so a parallel
            mask carries transparency (like `.pcx` indexed output; palette→RGBA stays a separate step).
            Out-of-frame columns are clipped, a truncated stream stops gracefully (mirrors the original's
            clipped `Draw_SetPixel`). Ported from `CBobManager.cs` `PrintBob_*Core` + `PrintPackedLine_*`
            + `Generate_PackLine_*` (the encode inverse pins the byte layout). **Hands-on:** decodes all
            bobs of real `ls_ground.bmd` (95 bobs: 44×8-bit, 50×double, 1 empty; 77 725 opaque px) and
            `ls_menu_logos.bmd` (20 double-byte; a 711×572 logo → 252 193 opaque px); an independent
            raw-run recount confirms no decoded bob ever writes more pixels than its runs hold.
      - [x] **Atlas PNG + anim JSON (packer + CLI seam).** Done — `decoders/atlas.ts`
            (`packBobAtlas`: colours every `decodeBobFrame` output with a 768-byte RGB palette via
            `expandBobFrame` — index 0 is a real colour so alpha comes from the frame `mask`, not a
            colour-key — and deterministic shelf/row-packs the non-empty frames, 1px gutter, into one
            `RgbaImage` atlas; emits an `AtlasManifest` of per-bob `{bobId, type, rect, offsetX/Y,
            opaque}`, one entry per bob in id order so empty/0×0 bobs stay id-addressable; `firstBobId
            + index` is the join key for the later anim/`setatomic` grouping the `.bmd` itself doesn't
            carry). Wired into the CLI as the pure `bmdToAtlas(bmdBytes, palette)` composition seam
            (mirrors `pcxToPng`): `encodePng(atlas.image)` + JSON-stringify the manifest. **Hands-on:**
            real `ls_gui_window.bmd` (193 bobs) → a valid 1021×1690 8-bit RGBA PNG, 188 opaque frames,
            all rects in-bounds. **Still open:** the batch tree-walk + per-`.bmd` palette pairing
            (which `palettes.ini`/`.pcx`-trailer palette goes with each bob set) — `bmdToAtlas` takes
            the palette as a parameter until that's decided.
      - [x] **Palette index** (first leg of the pairing graph) — `extractPaletteIndex` in
            `decoders/ini.ts` reduces `palettes.ini`'s `[GfxPalette256]` records to name→`.pcx`
            `PaletteAlias`es (the `.pcx` trailer palette is the real colour table). Each record has one
            `gfxfile` + one-or-more `editname` aliases; paths are normalized to forward-slash/lower-case
            for host-OS/case-independent lookup against the unpacked `--out` tree. The `[GfxPalette16]`
            records (16-colour sub-palettes built via `gfxcolorrange`, no `.pcx`) are correctly skipped.
            **Hands-on:** real `palettes.ini` → 143 aliases over 143 distinct `.pcx`, all normalized.
      - [x] **`.bmd`→palette binding (readable leg).** `extractGraphicsBindings` in
            `decoders/ini.ts` reduces the readable `[jobgraphics]` records
            (`Data/engine2d/inis/animals/jobgraphics.ini` — the one graphics binding file shipped as
            plain `.ini`) to `BmdPaletteBinding`s: each `gfxbobmanagerbody "<body>.bmd" "<shadow>.bmd"`
            paired with its `gfxpalettebody "<editname>"` (+ `logictribe`/`logicjob` cross-refs). Paths
            are normalized like {@link PaletteAlias}; the `editname` join key is **lower-cased on both
            legs** (`normalizePaletteName`) because the real data mixes case across them — `palettes.ini`
            declares `Lion01`/`Chicken01` while `jobgraphics.ini` references `LION01`/`chicken01`, and
            the original engine matches case-insensitively. **Hands-on:** real `animals/jobgraphics.ini`
            → 50 bindings (all with shadows, 8 distinct palettes), and joining onto `extractPaletteIndex`
            now resolves **50/50** to a `.pcx` (40/50 before the case fix); e.g.
            `cr_ani_body_00.bmd` → `bear01` → `creatures/bear.pcx`.
      - [x] **`[jobbasegraphics]` binding (richer mod leg).** `extractJobBaseGraphics` in
            `decoders/ini.ts` reduces the mod's `DataCnmd/types/humanstype/jobgraphics.ini`
            `[jobbasegraphics]` records to `JobBaseGraphicsBinding`s — the second binding skin alongside
            the flat `[jobgraphics]` one. A human draws from an indexed **body** bob plus numbered
            **head** bobs: each `gfxbobmanagerbody/head <index> "<bmd>" ["<shadow>"]` line puts the `.bmd`
            path on `values[1]` (the leading int slot index occupies `values[0]` — the structural reason
            it can't reuse `extractGraphicsBindings`, whose path is on `values[0]`). Palettes split three
            ways (`gfxpalettebasebody`/`gfxpalettebasehead`/`gfxpaletterandom`), all optional and
            lower-cased to join onto `extractPaletteIndex` case-insensitively; head bobs carry no shadow.
            A record with no usable body bob is skipped (matches the other index extractors). **Hands-on:**
            real mod `jobgraphics.ini` → 72 bindings (72 body slots, 143 head slots; 68 body / 61 head /
            61 random palettes — matching a raw `grep`/`awk` count), 14/29 distinct palette names resolve
            against `palettes.ini` (the rest are `[GfxPalette16]`/`.cif`-only character-tint palettes —
            `vik_man_base`, `hero_*` — a later leg).
      - [x] **`convertBmdTree` wired into the CLI (readable leg).** `cli.ts` `resolveGraphicsBindings`
            reads `animals/jobgraphics.ini` + `palettes.ini` → `extractGraphicsBindings` +
            `extractPaletteIndex`; `convertBmdTree` resolves each binding's palette `editname` → `.pcx`
            via the index, decodes the `.pcx` trailer palette, runs `bmdToAtlas` on the body `.bmd`, and
            writes `<bmd>.png` (atlas sheet) + `<bmd>.atlas.json` (per-bob manifest) as siblings under
            `--out`. Both the `.bmd` and palette `.pcx` are read from the just-unpacked `--out` tree;
            `indexOutTree` resolves the extractors' lower-cased refs to the real mixed-case on-disk paths
            (case-insensitive, like the original). Per-binding boundary failures (unknown palette, missing
            file, palette-less `.pcx`, malformed `.bmd`) are warned-and-skipped, never fatal. **Hands-on:**
            `npm run pipeline` on the real game → all **50/50** readable bindings resolve, collapsing onto
            **2 distinct** body `.bmd`s (`cr_ani_body_00/01` — the animals are one geometry recoloured per
            creature, so the last binding's palette wins per file); `cr_ani_body_00.png` = a valid
            1024×6037 RGBA atlas, 3120 frames (1410 opaque). Per-creature recolour naming belongs with the
            `[jobbasegraphics]`/`.cif` legs (the `editname` is the only per-creature differentiator).
      - [x] **Mod `[jobbasegraphics]` skin wired into the CLI.** `cli.ts` `resolveGraphicsBindings` now
            takes the `--mod` and, when given, reads `<mod>/types/humanstype/jobgraphics.ini` →
            `extractJobBaseGraphics`, **flattening** each `JobBaseGraphicsBinding` into the flat
            `BmdPaletteBinding` shape via the pure `jobBaseGraphicsToBindings` (body slot → `bodyPalette`,
            head slot → `headPalette`; a palette-less slot is dropped, the `gfxpaletterandom` runtime tint
            is not emitted). Those merge onto the base animals bindings and reuse the **same**
            `convertBmdTree` resolve→decode→atlas path — no second copy of the conversion logic — so the
            human body/head `.bmd`s get atlas PNGs + manifests under `--out`. **Hands-on:** `npm run
            pipeline` on the real game → **256 of 257** readable bindings resolve (the 1 skip is
            `cr_hum_body_74` → the seasonal `weihnachtsmann.pcx` palette absent from `--out`, warned-and-
            skipped), **62 distinct** atlas files (2 animal + 60 human body/head); `cr_hum_body_00.png` =
            a valid 1024×7693 RGBA atlas, 5418 frames (5290 opaque), manifest dims agreeing.
      - [x] **`.cif`-only base-human binding leg wired into the CLI.** `cli.ts` `resolveGraphicsBindings`
            now also reads the base game's `Data/engine2d/inis/humans/jobgraphics.cif` — the base-game
            human body/head bob sets ship *only* as encrypted `.cif` (no readable `.ini` twin) — decoding
            it via `decodeCifStringArray` → `cifLinesToSections` into the same `RuleSection` model the
            `.ini` parser yields, then reusing the **same** `extractJobBaseGraphics` →
            `jobBaseGraphicsToBindings` → `convertBmdTree` path as the readable mod skin (no second copy of
            the conversion logic). Only the `[jobbasegraphics]` records are picked up; the sibling
            `[jobchangegraphics]` equipment skins use the same grammar but a different section name and are
            a later leg. A missing/corrupt `.cif` is warned-and-skipped, never fatal. **Hands-on:** `npm
            run pipeline` on the real game → bindings rose **257 → 407** (the 53 base-game
            `[jobbasegraphics]` records expand into 53 body + ~262 head/body slots; 315 carry the base
            `test_human_00` palette), still **62 distinct** atlas files (the base-human `.bmd`s overlap the
            mod skin's), **406/407** resolving (the same 1 seasonal `weihnachtsmann.pcx` skip).
      - [x] **`[jobchangegraphics]` equipment-skin leg wired into the CLI.** `extractJobChangeGraphics`
            in `decoders/ini.ts` reduces the `[jobchangegraphics]` records (the per-job **equipment skin**
            layer) — the sibling of `[jobbasegraphics]` (base appearance), shipping in the *same* files
            (base `Data/engine2d/inis/humans/jobgraphics.cif` + the mod's `DataCnmd/types/humanstype/
            jobgraphics.ini`, preferred per golden rule #4). The two layers share the **identical grammar**
            (indexed `gfxbobmanagerbody/head` slots + the three palette keys), so both extractors delegate
            to one shared `extractIndexedGraphics(sections, sectionName)` and yield the same
            {@link JobBaseGraphicsBinding} shape, flattening through the existing `jobBaseGraphicsToBindings`
            → `convertBmdTree` path (no second copy of the conversion logic). `cli.ts`
            `resolveGraphicsBindings` now reads the `[jobchangegraphics]` records from both the `.cif` and
            the mod `.ini` alongside the base ones. **Hands-on:** `npm run pipeline` on the real game →
            bindings rose **407 → 483** (the base `.cif`'s 31 change records carry only `gfxpaletterandom`
            — a runtime tint, not a bob palette — so they correctly flatten to **0** emitted bindings; the
            mod's readable change records, which declare `gfxpalettebase{body,head}`, add the **76** new
            ones), **482/483** resolving (same 1 seasonal `weihnachtsmann.pcx` skip), **63 distinct** atlas
            files (up from 62); a sampled equipment-skin head bob → a valid 1023×675 RGBA atlas PNG.
      - [x] **Vehicles `.cif` `[jobgraphics]` leg wired into the CLI.** The base game's
            `Data/engine2d/inis/vehicles/jobgraphics.cif` (carts/ships) ships *only* as encrypted `.cif`
            and uses the **identical flat `[jobgraphics]` grammar** as the readable animals `.ini`
            (`gfxbobmanagerbody "<body>.bmd" ["<shadow>.bmd"]` + `gfxpalettebody "<editname>"`) — it
            differs only in the cross-ref key (`logicvehicle` instead of `logicjob`, simply left
            `undefined`), so `cli.ts` `resolveGraphicsBindings` decodes it via `decodeCifStringArray` →
            `cifLinesToSections` and reuses `extractGraphicsBindings` **verbatim** (no new extractor), then
            the same `convertBmdTree` resolve→decode→atlas path. The sibling
            `goods/goodgraphics.cif` is **intentionally not read**: its `[goodgraphics]` records carry only
            `graphicshumanrandompalette "<name>"` (a runtime tint) and **no `gfxbobmanagerbody`** — there
            is no bob set to atlas, so it yields zero bindings (carried goods are tinted in the human/
            vehicle sheets at runtime). **Hands-on:** `npm run pipeline` on the real game → bindings rose
            **483 → 489** (the 6 vehicle records), **65 distinct** atlas files (up from 63: `cr_veh_body_00`
            + `ls_vehicles`), **488/489** resolving (same 1 seasonal `weihnachtsmann.pcx` skip);
            `cr_veh_body_00.png` = a valid 1022×2768 RGBA atlas, 306 frames, manifest dims agreeing.
      - [x] **Per-creature recolour output naming.** Atlases are now named `<bmd-stem>.<palette>.png`
            (+ `.atlas.json`) keyed on the palette `editname`, not the `.bmd` alone — `convertBmdTree` in
            `cli.ts` (`paletteSlug` makes the editname filesystem-safe; `BmdConversion` carries
            `paletteName`). Many bindings collapse onto one shared body `.bmd` (the animals are a single
            geometry recoloured per creature; the humans one body re-tinted per tribe/job), so the old
            `<bmd>.png` naming overwrote them last-palette-wins — the `editname` is the only per-creature
            differentiator, so it rides in the filename and `(bmd, palette)` now names a distinct atlas.
            **Hands-on:** `npm run pipeline` on the real game → 488/489 bindings now fan out to **81 atlas
            files over 65 distinct `.bmd`** (was 65 files, the recolours lost); `cr_ani_body_00.bmd` →
            7 atlases (bear/cattle/chicken/deer/house/lion/wolves), bear vs lion byte-distinct (same
            1024×6037 geometry, recoloured) — no longer clobbered.
      - [ ] **Atlas oracle pixel-diff.** Compare an emitted atlas frame against the OpenVikings render
            pixel-for-pixel (needs an owned game copy + the oracle; an agent can't self-judge it).
- [ ] One map (`map.cif` + its `.ini`/`.inc` parts) decoded to IR.
      - [x] **Map logic-header metadata** — `extractMapInfo` in `decoders/ini.ts` reduces a decoded
            `map.cif`'s `CStringArray` (`logiccontrol` `mapsize`/`mapguid` + `misc_maptype`/`misc_mapname`)
            to a validated {@link MapInfo} IR: `width`/`height`, the 16-byte `guid`, `mapType`, optional
            `campaign {campaignId,missionId}`, and the name/description string-table ids. The map's
            scripting payload (`MissionData` goals/results, `StaticObjects` pre-placed houses/goods,
            `playerdata`/`AIData`) is deliberately NOT extracted — that is the Phase-5 campaign/trigger
            layer, a far larger vocabulary. Throws on a header-less/`mapsize`-less `.cif` (not a map).
            **Wired into the CLI** — `cli.ts` `mapCifToInfo` (pure decode→sections→extract composition,
            mirrors `pcxToPng`) + `decodeMapTree` walk the `--game` tree for `map.cif`, decode each in a
            stable (path-sorted) order with the folder name as `id` (`mapIdFromPath`), warn-and-skip a
            corrupt/non-map file, and feed the records into `buildIr`→`content/ir.json`. **Hands-on:**
            `npm run pipeline` on the real game → **13 maps** (tutorials 1-7 = type 1, `campaign [100,N]`;
            skirmish/multiplayer = type 4, no campaign), each with distinct dims + a 16-byte GUID.
      - [ ] **Map tile/landscape grid + mission scripting** — **container decoded; packed layers
            pending.** The binary terrain grid (the Phase-2 cell-graph input) is **not** in `map.cif`
            (only the logic-header `CStringArray`) — it lives in the sibling **`map.dat`**, a flat
            `hoix`-chunk container (0x20-byte headers; oracle `CIoHelper.cs`).
            The `MissionData`/`StaticObjects` campaign layer (Phase 5) is still separate.
            - [x] **`hoix`-chunk reader + `lsiz` dims** — `decoders/mapdat.ts` (`decodeMapDat`: walks
                  the flat 0x20-byte-header chunk sequence to EOF into a `{tag, version, length, depth,
                  checksum, payload}` table, zero-copy payload views; `idToTag`/`tagToId` reverse the
                  disk-byte order so the human tag `lsiz` ↔ disk `zisl`; `decodeMapSize` reads the one
                  *raw* chunk `lsiz` = `[u32 width][u32 height]`; `findChunk` selects a layer by tag;
                  `encodeMapDat`/`encodeMapSize` are the round-trip inverse, no committed fixtures).
                  Throws on a non-`hoix` marker or a payload that overruns the buffer (a batch run
                  wraps it per-file). Ported from `CIoHelper.cs` `SIoHelperChunk`/`IO_File_Chunk_*`.
                  **Hands-on:** real `SPECJALNA- FORTECA/map.dat` → 39 chunks (`logi lgmm lsiz lmhe
                  lmpa lmpb` … `emla xend tend`), `lsiz` = 250×250 = 62500 cells, walk reaches exact
                  EOF (0 trailing), `lmhe` 64778 B ≈ 1 B/cell + pck wrapper; `oasis_o_plenty/map.dat`
                  → 40 chunks, 250×250.
            - [x] **`pck`/`X8el` packed-layer unpack** — `decoders/mapdat.ts` `unpackMapLayer`
                  decodes the RLE-packed `lm**`/`em**` grid payloads. The 21-byte inner header is
                  reverse-engineered (probed across 5 real maps): `[u8 ver][u32 innerSize]` + the
                  on-disk marker `"kcp"` ("pck" reversed) + the codec id `X8el`/`X6el` (8/6-bit) +
                  a constant `0x72` sub-format byte + `[u32 unpackedLength][u32 innerSize]`, then the
                  stream. The codec is the `.bmd` packed-line family with raw/run roles swapped: a
                  control byte with the high bit **set** is a run of `(b&0x7F)` copies of the next
                  byte, **clear** is a literal run of `b` bytes — decode stops at exactly
                  `unpackedLength` (which consumes the stream to the payload end on every real X8el
                  layer). `packMapLayer` is the round-trip inverse (fixture-free tests). **X8el** = one
                  byte per output cell (`lmhe` height ≈ 1 B/cell, `lmlt` landscape-type 4 B/cell —
                  per-corner type ids). **Hands-on:** 69 X8el
                  layers across 3 real maps unpacked, 0 mismatches (every length an exact multiple of
                  `cells`), all 23 oasis_o_plenty grids `pack→unpack` byte-exact; `lmhe`∈[0,242],
                  `lmlt`∈[0,85] (within the 87-type table). The `eatd`/`eald` structured record-lists
                  (pre-placed objects, depth-prefixed text) are the Phase-5 territory layer, separate.
            - [x] **`X6el` 2-byte ownership-layer unpack** — `decoders/mapdat.ts` `unpackX6elLayer`
                  decodes the `empa`/`empb` entity/territory-ownership planes (the remaining packed
                  layer family). The container inner header is **byte-identical** to X8el (same 21-byte
                  layout, same u32 unpacked-**byte** length), but the RLE stream operates on **2-byte
                  (little-endian u16) elements** instead of single bytes: a run control (high bit set) =
                  `count = b&0x7F` copies of the next u16; a literal control (clear) = `count = b` u16s
                  copied verbatim. Returns a `Uint16Array` of one id per cell (id 0 = unowned). The
                  X8el byte path (`unpackMapLayer`) keeps its `Uint8Array` contract; the two codecs are
                  separate functions selected by the codec id. `packX6elLayer` is the round-trip inverse
                  (fixture-free tests). **Hands-on:** the real exported decoder over **all 130 maps →
                  260 X6el layers, 0 mismatches**, each exactly `width×height` u16s, **all 260
                  `pack→unpack` byte-exact**; e.g. `Arabskie Wyspy` empa 250×250 = 62500 cells, 335
                  distinct owner ids, 1987 unowned, max id 866. **What the ids *mean*** (the
                  territory/object-ownership graph) is the Phase-5 layer — this leg pins only the codec.
            - [x] **`lmlt` 4-corner layer → per-cell landscape-typeId grid** — `decoders/mapdat.ts`
                  `lmltToTerrainMap(layer, size)` collapses the unpacked `lmlt` (4 B/cell = four
                  per-corner triangle typeIds, confirmed `lmlt` is the landscape-type lane) + the
                  `lsiz` dims into the plain `{ width, height, typeIds }` shape the sim's
                  `buildTerrainGraph` (`packages/sim/src/terrain.ts`) consumes as a `TerrainMap` — a
                  plain value so the build tool never imports `sim`. Each cell's typeId is the
                  `reduceCornersToCell` **dominant corner** (lowest-typeId tie-break — canonical,
                  corner-order-independent). APPROXIMATED: the corner→cell reduction has no behavioral
                  oracle (OpenVikings decodes the container but doesn't simulate nav); dominant-corner
                  is a deterministic bulk-terrain choice — see docs/FIDELITY.md. Walkability/valency
                  are resolved downstream from the IR `LandscapeType` flags, not here. Throws on a
                  layer length ≠ `width × height × 4`. **Hands-on:** real `oasis_o_plenty/map.dat`
                  `lmlt` (250000 B) → a 62500-typeId grid (== cells), distinct cell types
                  `{0,1,4,9,10,12,15,18,21,36}` (all in the 87-type table), 64.2% uniform cells passed
                  through + 22382 transitions reduced; that grid feeds the real `buildTerrainGraph` →
                  a 62500-cell graph (centre cell 4 neighbours). Same for `WICHRY_ZIMY` (32400 cells).
            - [x] **`map.dat` terrain grid wired into the CLI → `content/maps/<id>.json`** —
                  `cli.ts` `mapDatToTerrain` (pure decode→`lsiz`→unpack `lmlt`→`lmltToTerrainMap`
                  composition, mirrors `mapCifToInfo`) + `convertMapDatTree` walk the `--game` tree for
                  every `map.dat` in a stable (path-sorted) order, convert each to the sim's `TerrainMap`
                  shape, and write `maps/<id>.json` (`id` from the containing folder via `mapIdFromPath`,
                  so it joins onto the same-folder `map.cif`'s `MapInfo` `id`); a corrupt/non-container/
                  `lmlt`-less/`X6el`-only/dims-mismatch file is warned-and-skipped, never fatal. **Fixed
                  the 0-based↔1-based indexing seam** discovered on the real run: the binary `lmlt`
                  layer is 0-based but `LandscapeType.typeId` mirrors the 1-based `.ini` `type`, so
                  `lmltToTerrainMap` now shifts the reduced index `+1` (`LMLT_TYPEID_BASE`) — without it
                  the sim's `buildTerrainGraph` rejected raw `0` ("void") as absent. **Hands-on:** the
                  documented `npm run pipeline` on the real game → **130 map grids (5 490 088 cells) →
                  125 `maps/*.json`**; **all 125 load through the real `buildTerrainGraph` with 0
                  absent-typeId failures**; `oasis_o_plenty.json` → a 62500-cell graph, centre cell
                  walkable with 4 neighbours, distinct typeIds `{1,2,5,10,11,13,16,19,22,37}` (the
                  +1-shifted set). The `eatd`/`eald` record-lists + `X6el` ownership layers stay Phase-5.
- **Exit:** `npm run pipeline` produces a validated `content/` (types + atlases + one map), decoded
  graphics verified against the oracle.

## Phase 2 — Vertical slice (prove the sim)  ← **first real target**
Goal: one tribe, headless-correct, then on screen. Establish the invariants that the rest depends on.

> **TL;DR (live target).** The slice runs end-to-end and deterministic: terrain cell-graph → A\* →
> movement → the atomic planner (harvest→carry→pileup) → one workplace with capacity → the carrier
> (haul workplace outputs to a store) → **CommandSystem (the mutation seam) + the snapshot read-view**
> → the **golden state-hash + atomic-action trace over 1000 ticks** are all built and green. The
> **pure depth-sort scene layer** (snapshot → iso draw list, sprites sorted by feet anchor) is now
> built and unit-tested too, and the **GPU draw + `npm run shot` screenshot harness** (a Pixi
> renderer consuming the draw list + a deterministic headless `?shot` entry + a committed Playwright
> script) now produces a reproducible PNG — eyeballed gross-correct (iso terrain behind feet-sorted
> sprites), pixel fidelity still deferred to a human. **The terrain-graph decode chain is now fully
> closed:** `map.dat` `hoix` container → `pck`/`X8el` layer unpack → `lmltToTerrainMap` (the `lmlt`
> 4-corner landscape-type lane reduced to one per-cell typeId) → the sim's `buildTerrainGraph`, proven
> hands-on on real maps (`oasis_o_plenty` 250×250 → a 62500-cell graph). **That chain is now wired into
> the CLI** — `npm run pipeline` emits a per-map `TerrainMap` to `content/maps/<id>.json` (130 grids on
> the real game; all 125 distinct files load through the real `buildTerrainGraph`, 0 failures, after
> fixing the 0-based→1-based `lmlt`→IR-typeId seam). **And that grid now loads INTO the sim:**
> `parseTerrainMap` (the `@vinland/data` loader/validator boundary) reads a `content/maps/<id>.json`
> into the structural `TerrainMap`, and `scenario(content, { map })` / `new Simulation({ map })` build
> the cell-graph from it in place of the synthetic grass grid — proven hands-on by feeding the real
> emitted `oasis_o_plenty.json` (250×250 = 62500 cells) through the loader into a real terrain graph
> and stepping the sim deterministically over it. **The `map.dat` packed-layer decode chain is now
> complete:** the `X6el` `empa`/`empb` 2-byte entity-ownership layers are decoded too
> (`unpackX6elLayer` — same inner header as X8el, the RLE family over little-endian u16 elements;
> verified across all 130 real maps, 260 layers, 0 mismatches, all round-trip byte-exact). What the
> ownership ids *mean* is a Phase-5 layer. **The map→scene seam is now in place:**
> `terrainMapToScene` (`packages/render/src/scene.ts`) projects a loaded `TerrainMap` (the
> `parseTerrainMap` shape) straight onto the renderer's `SceneTerrain`, varied landscape typeIds and
> all, and the vertical-slice demo's terrain is derived through it (no hand-duplicated grid).
> **And the shot/dev entry now LOADS an actual `content/maps/<id>.json`:** `?map=<id>` (the gitignored
> repo-root grids bridged to `/maps/<id>.json` by a vite dev-server middleware; `loadTerrainMap`
> fetches + `parseTerrainMap`-validates) draws a real decoded grid behind the slice sprites, falling
> back to the synthetic strip when absent — proven hands-on by `npm run shot -- --map mroczny_swiat_sub2`
> (a real 50×50 grid → a 2500-tile PNG, 0 page errors).
> **And the SIM now navigates a loaded map too:** `runSlice(seed, ticks, map?)` (`vertical-slice.ts`),
> when handed a loaded `TerrainMap`, places the slice's six entities (HQ, sawmill, woodcutter, carrier,
> two wood nodes) on the **first walkable cells of the real grid** (canonical row-major order) instead
> of the hardcoded 6×1 strip, and folds the grid's landscape typeIds into the synthetic demo content
> (each declared walkable) so `buildTerrainGraph` builds the cell-graph over it without a content gap.
> Both `shot.ts`/`main.ts` pass the loaded map to the sim AND the renderer, so `?map=<id>` now runs the
> slice ON the decoded grid. Proven hands-on by loading the real `content/maps/cn_1.json` (50×50 = 2500
> cells, typeIds {1,2,16,24,45,48}) → a 2500-cell terrain graph, the 6 entities spread across real cells
> ((38,19),(13,20),(22,7),…), deterministic over 100 ticks (`be0e8d14`).
> **And the textured-sprite branch is now exercised end to end with a FREE synthetic atlas:**
> `synthetic-atlas.ts` (`packages/render`) stands in a tiny hand-authored atlas — one flat-colour
> marker frame per drawable kind (settler/building/resource), the *frame geometry* pure + unit-tested
> (`syntheticAtlasFrames`/`SYNTHETIC_BINDINGS`), the canvas→`CanvasSource` texture the human-judged
> pixel half — so the renderer's textured branch can be bound *without* copyrighted bobs. The shot/dev
> entry binds it behind `?atlas` (`npm run shot -- --atlas`); the default stays placeholder geometry
> (byte-reproducible). Eyeballed gross-correct: textured atlas sprites at their feet anchors, depth-
> sorted, iso terrain behind — distinct pixels from the placeholder default. Real bob atlases bind
> through the same `SpriteSheet` shape with no renderer change.
> **The per-state sprite binding now lands:** `buildScene` derives each settler's coarse
> {@link SpriteState} (`idle`/`moving`/`acting`, from `CurrentAtomic`/`PathFollow`) + carries the acting
> `atomicId` (the `setatomic` join key) onto its `DrawItem`, and `SpriteBindings.settler` may now be a
> `SettlerStateBinding` (`idle`/`moving`/`acting` bob ids + a `byAtomic` per-atomic override) so
> `resolveSpriteFrame` picks the *right* frame per state, falling back idle←moving/acting and a plain
> number staying valid (back-compat). The free synthetic atlas binds three distinct settler markers
> (idle off-white / moving blue / acting warm), so `?atlas` exercises the per-state path end to end —
> eyeballed gross-correct (a walking settler draws its blue marker, not the idle one).
> **Next smallest step:** bind a REAL decoded bob atlas through the same `SpriteSheet` shape and
> populate the `setatomic`→bob `byAtomic` table from the extracted tribe bindings (gated on an owned
> game copy + a human eyeballing the pixels via the OpenVikings oracle). (A "per-type walk-cost field"
> is *not* a pending step: `landscapetypes.ini` has no movement weight — only `maximumValency` +
> placement flags — so uniform unit cost is faithful.) Lines tagged *(core done…)* pass tests today but
> await one wiring piece.
- [x] **CommandSystem + serializable command schema** — the ONLY way state mutates. Done —
      `systems/command.ts` (`commandSystem`, first in `SYSTEM_ORDER`) drains a per-sim
      {@link CommandQueue} (`commands.ts`) each tick and applies each serializable {@link Command}
      (`placeBuilding`/`spawnSettler`/`setProduction`/`demolish`) via an exhaustive `assertNever`
      switch, appending it to the **append-only command log** (`Simulation.commands.log`, each entry
      `{tick, command}`) — the save / replay / lockstep record, built from tick 1 (disk format later;
      the invariant is now). The UI/AI/loader enqueue via `Simulation.enqueue`; nothing else pokes the
      world. `placeBuilding` seeds the building's {@link Stockpile} from the building type's `stock`
      slots; an unknown type id / dead-entity reference is a recoverable boundary failure (skipped,
      still logged for faithful replay), not a throw. The **snapshot read-view** (`snapshot.ts`,
      `Simulation.snapshot()`) is the immutable, plain (no class instances / live Maps — transferable
      to a render Worker for free) value `render`/audio consume instead of live stores, so render never
      reads mid-mutation; Maps become canonical sorted `[k,v]` arrays, entities in ascending-id order,
      plus the tick's events. Pure + deterministic: the queue is a FIFO array (apply order == enqueue
      order), no RNG/wall-clock, golden untouched. **Hands-on:** through the real `Simulation.step()`
      schedule, 2 enqueued commands (place HQ + spawn woodcutter) → applied tick 1, 2 entities, HQ
      stockpile seeded `[[1,10]]`, log `[{1,placeBuilding},{1,spawnSettler}]`, snapshot plain
      `{amounts:[[1,10]]}`; two seed-7 runs hash-equal (`1a6611ea`). **Still to do:** `setProduction`
      becomes a real recipe/output selection once the goods-graph lands (Phase 3); a disk format for
      the log (Phase 5 save/load).
- [x] Terrain as a **cell-adjacency graph** with per-type valency + uniform walk cost (from
      `landscapetypes.ini`). *Not* the triangle geometry — that's render-only.
      *(DONE end-to-end — graph builder + `world.terrain` resource wired, the **decode chain from a
      real map is closed AND wired into the CLI** (`map.dat` `hoix` container → `pck`/`X8el` layer
      unpack → `lmltToTerrainMap` (the `lmlt` 4-corner landscape-type lane → one per-cell typeId,
      `+1`-shifted onto the 1-based IR `typeId`) → `content/maps/<id>.json`), and **that grid now
      loads back into the sim**: `parseTerrainMap` validates a `content/maps/<id>.json` and
      `scenario(content, { map })` / `new Simulation({ map })` build the cell-graph from it in place
      of the synthetic grass grid. `npm run pipeline` emits 130 grids on the real game; all 125
      distinct files load through the real builder (0 failures), and the real `oasis_o_plenty.json`
      (250×250 = 62500 cells) loads through the loader into a real graph + steps deterministically.
      NOTE corrected on inspection: a "per-type walk-cost field" is NOT a pending extraction —
      `landscapetypes.ini` carries no movement weight, only `maximumValency` (capacity) + the
      `allowedon{land,water,everything}` placement flags; uniform unit cost is the faithful model. A
      variable cost would need a source that actually has one.)*
      - The per-type IR inputs are extracted: `extractLandscape` (`decoders/ini.ts`) now captures
        `maximumValency` (per-cell capacity → `maxValency`) and the `allowedonland`/`allowedonwater`/
        `allowedoneverything` placement-layer flags onto `LandscapeType`. **Hands-on:** real
        `Data/logic/landscapetypes.ini` → 87 types, maxValency 1..100, 86 on-land / 3 on-water (wall +
        2 gates) / 1 on-everything (void).
      - [x] **Graph builder** — `packages/sim/src/terrain.ts` (`TerrainGraph` + `buildTerrainGraph`):
        a pure, deterministic world-resource over a row-major `(width, height)` landscape-typeId grid.
        Cells are addressed by a monotonic id (`y*width + x`); per-type props (walkable, fixed-point
        `walkCost`=ONE for the slice, `maxValency`) are resolved once from the IR `LandscapeType` table.
        4-connected `neighbours`/`walkableNeighbours` are emitted in a fixed **canonical N,E,S,W order**
        (no map-history dependence) — the precondition for A* tie-breaking + lockstep replay. Builder
        throws on a typeId absent from content (loud bad-pairing signal) and on grid/dimension mismatch.
        `cellManhattanDistance` is the fixed-point heuristic seed for the pathfinder. **Hands-on:** built
        `dist/` on a 5×4 grid w/ a 4-cell water river → 16 walkable / 4 blocked, canonical neighbour
        order stable across rebuilds, water dropped from walkable edges, absent-typeId guard fires.
        **The `map.dat` → `lmltToTerrainMap` → `buildTerrainGraph` decode chain is now wired into the
        CLI** (`cli.ts` `convertMapDatTree` → `content/maps/<id>.json`; the `+1` 0-based→1-based typeId
        seam fixed on the real run so every emitted grid loads). (Walk cost stays uniform
        ONE — a non-goal to vary, confirmed on inspecting `landscapetypes.ini`: it has no
        movement-weight property, only `maximumValency` + placement-layer flags; uniform unit cost
        is faithful to the engine.)
      - [x] **`content/maps/<id>.json` loaded into the sim** — `parseTerrainMap` (`@vinland/data`
        `index.ts` + the `TerrainMapFile` zod schema in `schema.ts`) is the loader/validator boundary:
        it reads a decoded map file (the `{ width, height, typeIds }` shape `convertMapDatTree` emits),
        enforces `typeIds.length === width × height`, and returns the structural `TerrainMap` the sim
        consumes — the I/O (file read + validation) stays in `data`, never the pure sim. The
        `scenario()` harness now takes `scenario(content, { seed, map })` (back-compat: a bare numeric
        seed still works), so a real map's grid feeds straight into the cell-graph in place of the
        synthetic grass grid. **Hands-on:** the documented `npm run pipeline` on the real game emitted
        125 `content/maps/*.json`; loading the real `oasis_o_plenty.json` (250×250 = 62500 cells)
        through `parseTerrainMap` → `scenario({ map })` built a 62500-cell graph (centre cell walkable,
        4 walkable neighbours) and stepped the sim 200 ticks deterministically (hash `0acec0f0`, equal
        across two runs); a length-mismatched file is rejected at load.
      - [x] **Wired as the `world.terrain` resource.** `SimOptions` now takes an optional `map:
        TerrainMap`; the `Simulation` builds the graph once at construction (`buildTerrainGraph`) and
        owns it as `readonly terrain?: TerrainGraph`, surfacing it on every system's `SystemContext.terrain`
        each `step()`. Optional because trivial fixtures (the determinism golden) run mapless — the
        pathfinding/terrain systems that need it check-and-no-op when absent. The resource is **not
        hashed** (immutable input, like `content`), so it never affects determinism; the builder's
        absent-typeId guard now fires at sim construction. Under `exactOptionalPropertyTypes` the ctx
        key is omitted (not set to `undefined`) when mapless. **Hands-on:** built `dist/`, a seed-9 sim
        over a 3×3 water-centre map → `terrain` present (9 cells, centre non-walkable, walkable-neighbour
        filtering correct); two same-seed+map runs hash-equal over 200 ticks (`1ef172ae`); a mapless sim
        has `terrain===undefined`; a typeId-99 map throws at construction.
- [ ] PathfindingSystem: A* on the cell graph with **canonical tie-breaking** (budgeted/tick).
      *(done — A\* core + system glue both landed; see sub-items.)*
      - [x] **A\* search core** — `packages/sim/src/pathfinding.ts` (`findPath(graph, start, goal)`):
        a pure, deterministic A* over `TerrainGraph.walkableNeighbours` (the canonical N,E,S,W edge
        set), `cellManhattanDistance` as the admissible heuristic and `walkCost` as edge cost; returns
        the lowest-cost start→goal cell sequence (inclusive) or `null` (unwalkable endpoint / no route).
        Tie-breaking is fully history-independent — the open set is a **flat dense array** (not a
        Map/Set, whose iteration order leaks insertion history), scanned ascending for the canonical
        minimum (lowest f, then lowest h, then implicitly lowest cell id). No floats touch the search
        (all costs `Fixed`); closed cells are never relaxed (consistent heuristic). **Hands-on:** built
        `dist/`, a 10×10 grid w/ a water wall (gap at y≥8) → 25-step path (0,0)→(9,0), contiguous +
        all-walkable, routes through the gap, detour > the 9-cell straight-line Manhattan; a fully-walled
        goal → `null`.
      - [x] **System glue** — `packages/sim/src/systems/index.ts` (`pathfindingSystem` + the
        `PathRequest` component). The system drains pending `PathRequest`s (start/goal raw cell ids + a
        `failed` flag) in **ascending entity-id order** (`canonicalEntities()`, a sort — not Map
        insertion order), up to `PATHFINDING_BUDGET_PER_TICK` (=8) per tick so A* — the heaviest
        per-call work — stays bounded under crowds; the cut is deterministic (lowest ids first, never a
        wall-clock cutoff). On success it writes cell-centre fixed-point waypoints into the existing
        `PathFollow` and removes the request; on failure (no route / unwalkable / out-of-range id) it
        flags the request `failed` (so the planner can react and the dead query isn't retried every
        tick) and drops any stale `PathFollow`. Out-of-range cell ids are guarded to "no route" rather
        than throwing inside the search (a request is boundary input). No-ops entirely when
        `ctx.terrain` is absent — a mapless sim has nothing to route over, so the determinism golden is
        untouched. **Hands-on:** compiled-`dist` smoke on a 5×5 walled map → a `PathRequest` resolves to
        a 13-waypoint detour `(0,0)→…→(4,0)` through the gap, request cleared; two same-seed sims
        hash-equal (`bee6f39f`); 12 requests → exactly 8 served tick 1, 0 left after tick 2; a mapless
        sim leaves the request untouched. **Still to do:** MovementSystem consuming `PathFollow`; the
        AISystem issuing `PathRequest`s.
- [x] MovementSystem (fixed-point) following paths. Done — `movementSystem` in
      `packages/sim/src/systems/index.js` now has two modes in precedence: (1) a {@link PathFollow}
      entity steps toward its current waypoint's cell centre by `MOVE_SPEED_PER_TICK` (=1/4 tile,
      a `fx.div` of exact fractions so each step lands on an integer fraction — no rounding drift),
      per-axis clamp-toward so it never overshoots; on reaching a waypoint it advances `index`, and
      on reaching the last it removes the `PathFollow` (the planner reads a path-less entity as
      arrived/idle); (2) the original `Velocity`-only constant-integration, kept for the determinism
      golden and free movers. A path-driven entity ignores any `Velocity` (it is skipped in pass 2),
      so it never double-moves. Pure fixed-point — no floats, no sqrt/normalisation; `stepToward` is
      a pure function of position+target. One target is consumed per tick, so the first tick of a
      path whose `waypoints[0]` is the start cell just advances the index (movement begins next tick).
      **Hands-on:** a 5×5 map with a water wall (gap at y=4), a `PathRequest` (0,0)→(4,0) through the
      real `Simulation.step()` schedule → PathfindingSystem resolved a **13-waypoint** detour, then
      MovementSystem walked the entity to cell-centre (4,0) in **49 ticks** (12 segments × 4 ticks + 1
      start-waypoint tick) and cleared the `PathFollow`. The request→path→move loop is now closed by
      the AISystem navigation slice below.
- [x] **AISystem navigation planner (intent→request→path→move).** Done — `aiSystem` in
      `packages/sim/src/systems/index.ts` (no longer a stub) + the `MoveGoal` component (a destination
      cell id, the *intent* layer above pathing). For an entity with a `MoveGoal` that is **not already
      travelling** (no live `PathRequest`, no `PathFollow`) and not standing on its goal, the planner
      emits a `PathRequest` from the entity's current cell (`terrain.cellAtClamped(fx.toInt(pos))`) to
      the goal; PathfindingSystem turns that into a `PathFollow`, MovementSystem walks it, and the goal
      is removed once the entity reaches the goal cell (an off-map/unreachable goal id is dropped rather
      than re-issued forever). `MoveGoal` is kept separate from the transient request/path so a future
      slice can repath without forgetting the destination. Pure + deterministic: no RNG/wall-clock, the
      action is a function of position+goal; no-ops on a mapless sim (golden untouched). This is the
      *navigation* planner only — the atomic-utility planner (pick the next atomic) sits on top of it.
      **Hands-on:** a settler given **only** a `MoveGoal` to (4,0) on a 5×5 map with a water wall
      (gap at y=4), through the real `Simulation.step()` schedule → AISystem issued the request,
      PathfindingSystem produced a **13-waypoint** detour, MovementSystem walked it, and the goal
      cleared on arrival at (4,0) after **50 ticks** (`MoveGoal`/`PathFollow`/`PathRequest` all gone);
      two same-seed runs hash-equal (`42b87f68`). **Still to do:** the atomic planner choosing *which*
      goal (a store/resource cell) — the next slice.
- [ ] **Atomic planner slice:** AISystem picks an atomic (utility over the job's allowed atomics);
      AtomicSystem executes it to completion and applies its effect. One settler: harvest wood →
      pickup → carry → pileup at store. *(done — executor + utility planner + resource depletion all
      landed; see sub-items.)*
      - [x] **AtomicSystem executor** — `atomicSystem` in `packages/sim/src/systems/index.ts` (no
            longer a stub) + the {@link AtomicEffect}/`elapsed`/`duration` fields on the `CurrentAtomic`
            component. Each tick it advances the integer `elapsed` counter (NOT an accumulated
            fixed-point step: `ONE / duration` truncates, e.g. ONE/3, so summing it would fall short of
            ONE and the atomic would hang — completion is the exact `elapsed >= duration`, with
            `progress` a derived 0..ONE display value for render interpolation). On completion it applies
            the typed {@link AtomicEffect} via an exhaustive `assertNever` switch, emits an
            `atomicCompleted` event, and removes the component (the planner reads a CurrentAtomic-less
            entity as ready for its next atomic). The harvest→pickup→carry→pileup chain is implemented:
            `harvest`/`pickup` add to the settler's `Carrying` (goods never teleport), `pileup` deposits
            into a store's `Stockpile` capped at the building type's per-good capacity (overflow stays
            carried — goods conserved), `eat` zeroes hunger; `produce`/`attack` only signal completion
            (owned by Production/CombatSystem later); `move`/`idle` are pure markers. Pure +
            deterministic: no RNG/wall-clock, each effect a function of current state, Stockpile writes
            via the canonical Map. **Hands-on:** a settler harvest (duration 3) → carries 1 wood, then
            pileup (duration 2) → store Stockpile = 1 wood, settler unloaded, 2 `atomicCompleted` events,
            all through the real `Simulation.step()` schedule; two same-seed runs hash-equal (`c2eed8ec`).
            **Still to do:** the AISystem atomic-utility planner (pick *which* goal/atomic for an idle
            settler, sequencing the chain) — the next slice on top of this executor.
      - [x] **AISystem atomic-utility planner** — `aiSystem` in `packages/sim/src/systems/index.ts` is
            now two layered passes: `atomicPlanner` (the *what* — pick the next atomic for an idle
            settler) on top of the existing `navigationPlanner` (the *where* — `MoveGoal`→`PathRequest`),
            run in that order so a freshly-set goal is routed the same tick. The planner is a small,
            pure state machine over an idle settler (has `Settler`+`Position`, no `CurrentAtomic`, not
            travelling): carrying goods → `MoveGoal` to the nearest store that can stock them, or, once
            on it, start a `pileup` `CurrentAtomic`; empty-handed → `MoveGoal` to the nearest harvestable
            resource its job permits, or, once on it, start a `harvest` `CurrentAtomic`. A new
            {@link Resource} component (goodType + remaining + harvestAtomic) is the harvestable node.
            Data-driven, not bespoke per-job: the harvest atomic is the resource good's `atomics.harvest`,
            gated by the job's `allowedAtomics`∪`baseAtomics`−`forbiddenAtomics` (`jobAtomics`), and the
            atomic `duration` is resolved through the tribe's `setatomic` binding → `atomicAnimations`
            length (`atomicDuration`, default 4 when the chain is absent). Target selection is the nearest
            by Manhattan distance, scanned in canonical entity-id order with an ascending-cell-id
            tie-break — no Map-insertion-order dependence. Pure + deterministic: no RNG/wall-clock,
            no-ops on a mapless sim (golden untouched). The pileup atomic id is a constant (the readable
            data binds no per-good deposit atomic; the typed `pileup` effect is what the executor
            applies). **Hands-on:** a woodcutter on a 4×1 strip (cutter@0, wood@1, store@2) through the
            real `Simulation.step()` schedule → a clean alternating atomic trace harvest(24)→pileup(23)→…
            (one cycle ≈ every 19 ticks), **6 wood** in the store after 120 ticks, cutter unloaded; two
            same-seed runs hash-equal (`b2aced06`). **Still to do:** hunger/needs-driven goal choice
            (NeedsSystem, Phase 3) and JobSystem assignment.
      - [x] **Resource depletion** — a completed `harvest` atomic now decrements the harvested node's
            `Resource.remaining` by the same `HARVEST_YIELD` (=1) it grants the settler (`harvestFromNode`
            in `systems/index.ts`), clamped at 0, so a finite node of N units survives exactly N harvests
            and the planner's `remaining <= 0` gate then skips it (goods conserved end to end). A node
            entity that vanished between the swing starting and completing just skips the decrement (the
            carry still happens). Pure + deterministic. **Hands-on:** a 3-unit tree (cutter@0, tree@1,
            store@2) through the real `Simulation.step()` schedule → `tree.remaining` 3→0 over 600 ticks,
            exactly 3 wood in the store, cutter unloaded, planner idles (hash `f09ed12a`).
- [x] One workplace: ProductionSystem consumes input → output, **enforcing per-good stock capacity**.
      Done — `productionSystem` in `packages/sim/src/systems/index.ts` (no longer a stub) + the
      {@link Production} component (per-cycle `elapsed`/`duration`). A workplace is a `Building` with a
      `Stockpile` whose building type carries a `recipe` (inputs→outputs over `recipe.ticks`). Each
      tick: a running cycle advances the integer `elapsed` counter and, on the exact `elapsed >=
      duration` tick (NOT an accumulated fixed-point step, which truncates and hangs — same rule as
      `CurrentAtomic`), deposits the outputs into the building's own stockpile + emits a `goodProduced`
      event per output; an idle workplace starts a cycle iff its stockpile holds every input in full
      AND every output has free room to its per-good capacity. Inputs are consumed at cycle start
      (reserving them), outputs deposited at completion (room reserved at start, so they always fit) —
      a cycle is the net inputs→outputs transformation, goods conserved. **Capacity enforcement is on
      the output side**: a cycle never starts unless its outputs fit, so the stockpile never overflows
      and inputs aren't wasted when blocked. Pure + deterministic: recipe read from CONTENT, no
      RNG/wall-clock, stockpile writes via the canonical Map. **Real building recipes are now extracted**
      (the output-side join — `fillBuildingRecipes`, see the goods-graph note below): a workplace's
      `logicproduction` output good joins through that good's `goodtypes.productionInputGoods` to fill
      `recipe.inputs`/`outputs`, so the sim runs the original economy (mill `wheat→flour`, bakery
      `water+flour→bread`, …) rather than the old synthetic sawmill stand-in. **Hands-on:** a sawmill
      with 5 wood + a plank cap of 3, run 120 ticks through the real `Simulation.step()` schedule →
      exactly **3 planks** (capped, never exceeded), **2 wood left** (production halted on full output,
      inputs untouched), 3 `goodProduced` events, two same-seed runs hash-equal (`57b0f116`); and the
      real-game `npm run pipeline` → **26 of 28 workplaces** carry a recipe (22 with non-empty inputs),
      0 dangling refs. **The per-cycle `recipe.ticks` is now data-pinned** (`resolveRecipeTicks`):
      worker `jobType` + the produced good's `goodtypes.atomicForProduction` → the reference tribe's
      `setatomic`→`atomicanimations` `length` (22/26 workplaces resolve to a real length — mill
      flour=200, brewery mead=50, pottery brick=80, …; the 4 raw-good producers with no produce-atomic
      keep the default 20). Reference-tribe + primary-output approximations recorded in FIDELITY (the
      source length varies per tribe/output). **The worker-presence gate now lands:** a workplace only
      runs a cycle (start AND advance) while its worker is present — a {@link Settler} whose `jobType`
      matches the building type's `workers` slot stands on the workplace's tile (`workerPresentAt` in
      `systems/shared.ts`; an in-flight cycle pauses with `elapsed` held if the worker leaves, resumes
      on return). A building type that declares no `workers` slot is unstaffed-by-design and produces
      freely (passive stores / worker-less fixtures unaffected). The AI planner pins a settler standing
      on a workplace it staffs (`staffsWorkplaceHere`) so the operator isn't re-planned off to harvest/
      haul — the minimal "keep the worker put" piece without the full JobSystem (assignment across many
      workplaces stays a Phase-3 slice). **Hands-on:** through the compiled `dist` `productionSystem`,
      an unstaffed sawmill with 5 wood → **0 planks** (gate blocks it, wood untouched at 5); a staffed
      sawmill (carpenter on its tile) → wood drained 5→0, **4 planks** produced. The golden trace's
      sawmill is now staffed by a carpenter spawned on it; the 33-entry atomic trace + 8-plank output
      are unchanged, only the state hash moved (a new operator entity). **Still to do:** JobSystem
      assignment across many workplaces + a per-tribe recipe-timing table (the fully-faithful model).
- [x] A minimal **carrier** moving goods between store and workplace (goods never teleport). Done —
      the AISystem's `atomicPlanner` now has a carrier fallback: an idle settler with nothing to
      harvest hauls a workplace's finished outputs out to a store that can stock them. `pickup` now
      carries a `from` source store (the `AtomicEffect` gained a `from: Entity | null`); a pickup
      `from` a store removes exactly what it grants the carrier, so goods are conserved (the old
      sourceless pickup is `from: null`). `nearestWorkplaceOutput` finds the nearest workplace
      (a `Building` with a recipe) holding one of its recipe **outputs** that a *different* store can
      take (canonical entity-id scan, ascending-goodType good choice via `stockpileEntries`);
      `nearestStoreFor` now refuses to deliver a good back into its own producer (no carry-it-back
      livelock). The existing carry→pileup chain hauls and deposits it. Reuses the same
      MoveGoal→PathRequest→PathFollow navigation as the woodcutter; the `transportSystem` stub stays a
      stub (carrier behavior is the atomic vocabulary, not a bespoke system). Pure + deterministic;
      no-ops on a mapless sim (golden untouched). **Hands-on:** a carrier on a 4×1 strip (carrier@0,
      sawmill@1 with 3 planks, HQ@2) through the real `Simulation.step()` schedule → the sawmill
      drains 3→0, exactly **3 planks** reach the HQ (none created/lost), the carrier unloads; never
      delivers back into the producer; two seed-13 runs hash-equal.
- [ ] Render: isometric terrain + the settler sprite from the atlas, **depth-sorted by feet anchor**
      (a visual checklist item — can't be golden-hashed; see docs/TESTING.md).
      *(GPU draw + the `npm run shot` harness now land with **placeholder geometry**, the
      **map→scene seam** (`terrainMapToScene`) projects a loaded `TerrainMap` (the `parseTerrainMap`
      shape) straight onto the renderer's `SceneTerrain` — the demo's terrain is derived through it,
      not a hand-built grid — **and the shot/dev entry now LOADS an actual `content/maps/<id>.json`**
      via `?map=<id>` (a vite dev-server middleware bridges the gitignored repo-root grids to
      `/maps/<id>.json`; `loadTerrainMap` fetches + `parseTerrainMap`-validates them), drawing a real
      decoded grid behind the slice sprites — falling back to the synthetic strip when absent. The
      **atlas-sprite swap is now wired end to end with a FREE synthetic atlas**: the pure *which-frame*
      lookup (`resolveSpriteFrame`, `DrawItem`→atlas frame rect) is built + unit-tested, `renderScene`
      draws a bound sprite as a textured atlas sub-rect when handed an optional `SpriteSheet`, and the
      `synthetic-atlas.ts` module now supplies a free hand-authored atlas (geometry + bindings + a
      `CanvasSource` texture) the shot/dev entry binds behind `?atlas` — so the textured branch is
      exercised + eyeballable without copyrighted bobs. The remaining open part is a **richer per-job/
      per-state binding** + a **REAL decoded bob atlas** (gated on an owned game copy + a human
      eyeballing those pixels).)*
      - [x] **`terrainMapToScene` map→scene seam** — `packages/render/src/scene.ts`: a pure, total
            projection from a loaded `TerrainMap` (`{ width, height, typeIds }` — the shape
            `@vinland/data` `parseTerrainMap` validates a `content/maps/<id>.json` into) onto the
            renderer's `SceneTerrain`. This is the typed boundary from a **real decoded map** to the
            draw line: the map's varied landscape typeIds carry straight through (the GPU layer tints
            each tile by typeId), so a real multi-terrain grid renders its actual ground, not a uniform
            fill. The vertical-slice demo's `sliceTerrain()` now derives from the SAME `TerrainMap` the
            sim navigates via this seam (no hand-duplicated grid), so `npm run shot` already exercises
            the map→scene path. **Hands-on:** `npm run shot` → a valid 1000×600 PNG, eyeballed
            gross-correct (6 iso grass tiles behind 6 feet-sorted sprites), unchanged by the refactor;
            a unit test feeds a varied-typeId `{2,3}` grid through `terrainMapToScene` → `buildScene`
            and asserts each tile keeps its typeId.
      - [x] **Shot/dev entry LOADS an actual `content/maps/<id>.json`** — `?map=<id>` on the headless
            shot entry (`packages/app/src/shot.ts`) and live `main.ts` now draws a **real decoded map**
            as the terrain instead of the synthetic 6×1 grass strip. The I/O seam is `loadTerrainMap`
            (`packages/app/src/vertical-slice.ts`): a browser `fetch('/maps/<id>.json')` →
            `@vinland/data` `parseTerrainMap` (zod-validates the shape + the `typeIds.length ===
            width*height` invariant) → the structural `TerrainMap` fed through the existing
            `terrainMapToScene` seam. The gitignored repo-root grids are bridged to `/maps/<id>.json`
            by a vite dev-server middleware (`vite.config.ts`, path-traversal-rejecting), so both
            `npm run dev` and the shot harness (`scripts/shot.mjs --map <id>`) can reach them. A bad id
            / 404 / malformed file degrades gracefully to the synthetic strip (logged), so a checkout
            **without** the gitignored maps still renders and the default `npm run shot` stays
            reproducible. This draws the real grid as the terrain backdrop. **Hands-on:** `npm run shot
            -- --map mroczny_swiat_sub2` (a real 50×50 = 2500-cell grid) → a valid 55 KB PNG (vs the
            10 KB 6-tile strip), 0 page errors, eyeballed gross-correct (a full iso terrain grid behind
            the feet-sorted slice sprites); `cn_4` (100×100, 16 distinct typeIds) likewise.
      - [x] **The SIM navigates the loaded map** — `runSlice(seed, ticks, map?)` (`vertical-slice.ts`)
            now, when handed a loaded `TerrainMap`, places the slice's six entities (HQ, sawmill,
            woodcutter, carrier, two wood nodes) on the **first walkable cells of the real grid** (in
            canonical row-major id order via `walkableCells`) instead of the hardcoded 6×1 strip, and
            folds the grid's landscape typeIds into the synthetic demo content (`demoLandscape`, each
            declared walkable) so `buildTerrainGraph` builds the cell-graph over a real decoded grid
            without a content-gap throw. `shot.ts`/`main.ts` pass the loaded map to the sim AND the
            renderer, so `?map=<id>` runs the slice ON the decoded grid. **Hands-on:** loading the real
            `content/maps/cn_1.json` (50×50 = 2500 cells, typeIds {1,2,16,24,45,48}) → a 2500-cell
            terrain graph, the 6 entities spread across real cells ((38,19),(13,20),(22,7),…),
            deterministic over 100 ticks (`be0e8d14`). **Still open (render line):** the atlas sprite in
            place of the placeholder box geometry (gated on a free/synthetic atlas).
      - [x] **Atlas-frame resolution seam (the self-verifiable half of the atlas swap)** —
            `packages/render/src/sprites.ts`: the pure data path from a bob atlas to a per-sprite frame,
            split off from the GPU texture binding so the *which-frame* decision is unit-testable
            without a screen (the *pixels* stay deferred to a human). `SpriteAtlas` (atlas dims + frames
            indexed by bob id, the renderer's reduced view of the build pipeline's `AtlasManifest` —
            re-declared structurally so `render` never imports the build tool), `SpriteBindings` (a
            per-kind `settler`/`building`/`resource` → bob-id table), `indexAtlasFrames` (manifest
            frame-list → the id-keyed `SpriteAtlas`), and `resolveSpriteFrame(item, bindings, atlas)`
            → the atlas frame a drawable `DrawItem` should draw, or `null` (→ placeholder) for a tile /
            unbound kind / missing-or-0×0 frame. `renderScene` now takes an **optional** `SpriteSheet`
            (`{ source, atlas, bindings }`): a bound sprite draws as a feet-anchored textured sub-rect
            (`new Texture({ source, frame: Rectangle })`, the frame's `offsetX/Y` placing it at the feet
            anchor); everything else — and the whole scene when no sheet is given — stays placeholder
            geometry, so the default `npm run shot` is byte-unchanged. **Hands-on:** `npm run shot` → the
            same valid 1000×600 PNG, eyeballed gross-correct (6 grass tiles behind 6 feet-sorted boxes),
            unchanged by the wiring; 7 new `sprites.test.ts` units pin the resolution (bound→frame, tile/
            unbound/missing/empty→null, purity).
      - [x] **Free synthetic atlas IMAGE + `?atlas` binding (the textured branch, exercised)** —
            `packages/render/src/synthetic-atlas.ts`: a tiny hand-authored 64×64 atlas — one flat-colour
            marker frame per drawable kind (settler/building/resource), feet-anchored
            (`offsetX=-w/2`, `offsetY=-h`) so the textured branch reproduces the placeholder's feet
            placement — that lets the renderer's `SpriteSheet` path be bound **without** copyrighted
            bobs (real bob atlases are decoded from an owned game copy + gitignored). The split mirrors
            `sprites.ts`: `syntheticAtlasFrames`/`SYNTHETIC_BINDINGS` are pure data (unit-tested — every
            kind resolves to an in-bounds, non-overlapping, non-empty frame), while
            `createSyntheticAtlasSource` draws those rects into a canvas → a Pixi `CanvasSource` (the
            pixel half, human-judged). The shot/dev entry binds it behind **`?atlas`** (`shot.ts`/
            `main.ts`; `npm run shot -- --atlas`); without the flag, sprites stay placeholder geometry,
            so the default `npm run shot` PNG is byte-reproducible. **Hands-on:** `npm run shot --atlas`
            (real entry, 0 page errors) → a PNG **distinct** from the placeholder default (different
            size + hash), eyeballed gross-correct — textured atlas sprites at their feet anchors,
            depth-sorted, iso terrain behind; the default `npm run shot` unchanged. **Still open:**
            binding a REAL decoded bob atlas through the same `SpriteSheet` shape (human eyeballs pixels).
      - [x] **Richer per-state settler binding (the `setatomic` join, self-verifiable half)** —
            `buildScene` now derives each settler's coarse {@link SpriteState} from its snapshot
            components — `CurrentAtomic` ⇒ `acting` (and the atomic's numeric id rides onto the
            `DrawItem` as the `setatomic` join key), else a live `PathFollow` ⇒ `moving`, else `idle`;
            buildings/resources stay `idle` (no per-state animation in this slice). `SpriteBindings.settler`
            may now be a `SettlerStateBinding` (`packages/render/src/sprites.ts`): `idle` (required) +
            optional `moving`/`acting` bob ids + a `byAtomic` per-atomic-id override (so chop vs carry can
            draw different frames). `resolveSpriteFrame` picks by state with a total fallback chain
            (`acting`→`byAtomic[id]`→`acting`→`idle`; `moving`→`idle`), and a **plain number stays valid**
            (back-compat — the same frame for every state), so old bindings need no change. The free
            synthetic atlas now binds three distinct settler markers (idle off-white / moving blue /
            acting warm) through that shape, so `?atlas` exercises the per-state path end to end. APPROXIMATED
            (see FIDELITY.md): the join *key* (atomic id) is faithful to `setatomic`, but the coarse
            render state model + which-frame-per-state are our coarsening, and no real bob/animation table
            is bound yet (the `byAtomic` table is empty until one is extracted). **Hands-on:** `npm run shot
            -- --atlas` (real entry, 0 page errors) → a 1000×600 PNG showing a settler drawing its blue
            `moving` marker distinct from the idle off-white one (the per-state binding live), default
            `npm run shot` still byte-identical across two runs; 18 new render unit tests pin the state
            derivation + the binding fallback chain (385 tests green). **Still open:** a REAL decoded bob
            atlas + populating `byAtomic` from the extracted tribe `setatomic` bindings (human eyeballs pixels).
      - [x] **Pure scene/depth-sort layer** — `packages/render/src/scene.ts` (`buildScene`): turns a
            `WorldSnapshot` + the terrain grid dimensions into a flat, **depth-sorted** isometric
            draw list (`DrawItem[]`), the testable core of the render line that an agent CAN
            self-verify (the pixels are deferred to a human). Two correctness properties are pinned by
            unit tests: (1) **terrain always behind sprites** — tiles emit row-major back-to-front in a
            negative depth band strictly below every sprite, so ground never paints over a sprite; (2)
            **sprites sorted by feet anchor** — ascending world `(y, x, entityId)`, a total/stable
            order so a settler lower/further-right occludes one behind it. Reads the snapshot's `Fixed`
            position (scaled int) / `ONE` → float tile coord (render-only; never re-enters the sim);
            entities classify by marker (`Building`/`Resource`/`Settler`), a marker-less positioned
            entity is skipped. Pure: same snapshot ⇒ byte-identical list. **Hands-on:** the vertical
            slice (6×1 grass strip, HQ@5 + sawmill@4 placed via commands, woodcutter + carrier, 2 wood
            nodes) run 20 ticks through the real `Simulation.step()` → snapshot → `buildScene` yields
            **12 draw items** (6 tiles depth −1000000..−999995, then 2 settlers / 2 resources / 2
            buildings sorted by feet, x=0.5→5), terrain strictly behind sprites, deterministic across
            two snapshots (`scene.integration.test.ts` exercises this exact path).
      - [x] **GPU draw + screenshot harness** (the human-judged remainder). Done — three pieces:
            (1) a Pixi renderer (`packages/render/src/pixi-renderer.ts`: `createPixiApp` + `renderScene`)
            consuming the `buildScene` draw list in array order (already depth-sorted, so painter's order
            == correct occlusion); it draws **placeholder geometry** per item — an iso ground diamond per
            tile (tinted by landscape typeId) + a feet-anchored body box per sprite (coloured by kind) —
            because real bob atlases are decoded from a copyrighted copy and gitignored (atlas sprites
            are a later leg once a free/synthetic atlas exists). (2) a deterministic, headless render
            entry (`packages/app/src/shot.ts` + `vertical-slice.ts`): `?shot[&seed&ticks]` builds the
            vertical-slice sim from a tiny synthetic content set, steps N ticks, draws ONE frame, and
            sets `window.__vinlandShotReady` — NOT the RAF loop. (3) `npm run shot`
            (`packages/app/scripts/shot.mjs`): boots the app's Vite dev server, drives Chromium via
            Playwright, waits on the ready flag, and writes a PNG (`--seed/--ticks/--out`). Pixels can't
            be golden-hashed — the committed script (not the MCP) is the chosen tool; rationale in
            docs/TESTING.md. **Hands-on:** `npm run shot --out shot.png` → a valid 1000×600 PNG, 0 page
            errors; eyeballed gross-correct — 6 iso grass diamonds (terrain strictly behind), 6
            feet-sorted sprites (2 off-white settlers, 2 green resources, 2 gold buildings) occluding
            back-to-front in the right iso half. Pixel fidelity / feel still deferred to a human.
- [x] Golden state-hash + golden **atomic-action trace** over ~1000 ticks; invariants each tick.
      Done — `packages/sim/test/golden-trace.test.ts`. The *integration* golden (the per-mechanic
      goldens pin one slice each; this pins the whole economy): a self-supplying woodcutter + a carrier
      placed via the **command log** (HQ + sawmill + both settlers), two finite wood nodes, run **1000
      ticks** through the real `Simulation.step()` schedule. Pins three complementary fingerprints —
      the final canonical `hashState()` (`7f89b94d`), the ordered **atomic-action trace** (33
      `atomicCompleted` events as `"tick:entity:atomicId"` — 24 harvest / 23 pileup / 22 pickup, the
      behavioral record that says *which* behavior diverged and *when*, not just *that* state did), and
      the production count (8 planks). `CORE_INVARIANTS` run **after every tick** (not just at the end),
      so a transient break is caught at the exact tick. **Hands-on:** the real 1000-tick run →
      hash `7f89b94d`, 33-entry trace, 8 planks, **0** invariant violations, byte-identical across two
      same-seed runs; 289 tests / check / build green.
- **Exit:** click to place one workplace; a settler autonomously supplies it via atomics; carrier
  hauls output; deterministic, invariant-clean, replay-equal.

## Phase 3 — Economy, progression & population
- [x] Full **goods graph** as an explicit IR artifact (extract from `goodtypes.productionInputGoods`):
      raw → flour/plank/tool → bread/weapons, two food tiers (`food_simple`/`food_extra`).
      Done — the *edges* (`productionInputs`) and *node layers* (`classification`: raw/in-house/input,
      from the `[goodtype]` flags) are both extracted, and the output side is joined into building
      `recipe`s (see sub-items). The graph is the validated `content/ir.json` goods table, not a separate
      file — one source of truth the sim + future HUD read.
      - [x] **Input side extracted** — `extractGoods` (`decoders/ini.ts`) now captures each good's
            `productionInputGoods` onto `GoodType.productionInputs` (`@vinland/data` schema): the flat
            multiset is collapsed to `{ goodType, amount }` pairs where a **repeated good id encodes the
            quantity** (`… 1 1 14 14 …` = 2×1 + 2×14), first-seen order preserved. Keyed by the **output**
            good (the good being made); a raw/harvested good gets `[]`. `validateCrossReferences` now also
            checks every input good id resolves. **Hands-on:** `npm run pipeline` on the real game →
            **42/65 goods carry inputs** (`coin <- wood+gold`, `flour <- wheat`, `tile <- 2x mud + 1x wood`),
            **0 dangling** input refs.
      - [x] **Output side joined into building recipes** — `fillBuildingRecipes` (`decoders/ini.ts`),
            run in `buildIr` after both the goods and buildings tables are assembled (cross-table). For
            each producing workplace it joins each `logicproduction` output good → that good's
            `productionInputs` to materialize `recipe.inputs` (merged + summed per input goodType across
            several outputs, ascending-id order) and `recipe.outputs` (each produced good at amount 1 —
            the `logicproduction <good>` semantics carry no per-output quantity). `recipe.ticks` is now
            data-pinned by `resolveRecipeTicks`: worker `jobType` + the primary produced good's
            `goodtypes.atomicForProduction` → the reference tribe's (lowest-`typeId`)
            `setatomic`→`atomicanimations` `length`, falling back to the schema default 20 only when no
            produced good's produce-atomic resolves (raw-good producers). Reference-tribe + primary-output
            APPROXIMATED in FIDELITY.md (the source length varies per tribe/output). A non-producing building (`produces` empty)
            gets no recipe. `validateCrossReferences` already checks recipe good ids resolve. **Hands-on:**
            `npm run pipeline` on the real game → **26/28 workplaces** carry a recipe (22 with non-empty
            inputs), 0 dangling refs, recognisably the original economy (`mill: wheat→flour`,
            `bakery: water+flour→bread`, `brewery: water+honey→mead`); the sim no longer needs the
            synthetic sawmill stand-in. **Still open:** the per-cycle timing (above).
      - [x] **Node layers (raw → produced → food tiers)** — `extractGoods` (`decoders/ini.ts`) now
            captures each `[goodtype]`'s boolean classification flags onto `GoodType.classification`
            ({@link GoodClassification} in `@vinland/data` schema): `isProducedOnMapFlag` →
            `producedOnMap` (a raw good gathered from the map — wheat/stone/wood/iron), `isProducedInHouseFlag`
            → `producedInHouse` (a workplace output — flour/bread/`food_simple`/`food_extra`),
            `isInputGoodFlag` → `inputGood` (consumable as a recipe input). Three **independent**
            booleans, not a mutually-exclusive enum — the source sets several at once (`leather` carries
            all three). These node layers plus the `productionInputs` edges are the explicit goods-graph
            IR. **Hands-on:** `npm run pipeline` on the real game → 65 goods → 16 raw / 48 in-house / 17
            input; `food_simple`/`food_extra` correctly in-house terminal, `flour` in-house+input (the
            intermediate tier), `wheat`/`stone`/`wood` raw+input.
- [ ] NeedsSystem: hunger + non-food needs implied by atomics (eat, plus deferred-but-named
      `pray`/`enjoy`/social/`make_love`).
      - [x] **Hunger rise** — `needsSystem` (`packages/sim/src/systems/needs.ts`, graduated from the
            stub into its own module) raises every {@link Settler}'s `hunger` by `HUNGER_RISE_PER_TICK`
            (=ONE/4096) each tick, clamped at ONE so the `hungerInRange` invariant holds; the `eat`
            atomic already resets it to 0 (AtomicSystem), so this + that effect form the rise/reset loop.
            APPROXIMATED (see FIDELITY.md): the original drives hunger through per-animation
            `event 30 2 <delta>` tuples (activity drains `-100`, `eat_slot_food` restores `+4000`) — an
            event-driven model needing the atomic `event (type,value)` vocabulary decoded (deferred); a
            flat per-tick rate is the bounded "hunger grows, eating resets it" core. **Hands-on:** 5000
            ticks through the real `Simulation.step()` schedule → hunger rises and **clamps exactly at
            ONE** (4096 ticks to fill, then pinned), **0** invariant violations, two seed-7 runs
            hash-equal (`1d2b05fd`). The golden state hash moved (`64b872d3`→`db68cc53`) — settlers now
            carry non-zero hunger — but the **atomic trace + 8-plank output are unchanged** (no behavior
            change: the eat-DRIVE isn't here yet).
      - [x] **Eat drive** — the AI atomic planner (`systems/ai.ts` `atomicPlanner`) now chooses an
            `eat` atomic (id **10**, the original's `setatomic <job> 10 "..._eat_slot_food"` slot) when
            a settler's `hunger >= HUNGER_EAT_THRESHOLD` (=¾·ONE), **above** harvest/haul/staffing so a
            starving operator leaves its workplace to feed. It eats its own carried food first (no walk;
            `eat` effect with `from:null`), else heads to / eats at the nearest store holding a food good
            (`nearestFoodStore`, canonical scan). Food is recognised by the `food` id prefix
            (`isFood`, `systems/shared.ts` — `food_simple`/`food_extra`, the original's slot-food goods;
            no `iseatable` flag in `goodtypes.ini`). The `eat` AtomicEffect gained a `from` source and
            now **consumes one unit of food** (`consumeFood`, from the store or carried load) as it
            zeroes hunger — closing the rise→eat→reset loop with goods conserved (food destroyed on the
            bite, never conjured; an emptied source still resets hunger). APPROXIMATED (see FIDELITY.md):
            the atomic id is pinned, but the ¾·ONE trigger + the slug-based food-id are inferred (the
            original eats off per-animation `event 30 2 <delta>` cadence + a slot→good binding below the
            readable rule files), deferred to the same atomic-`event`-vocabulary decode the hunger-rise
            row waits on. **Hands-on:** a settler crossing the threshold beside a larder (real
            `Simulation.step()` schedule) walks one tile, eats at tick 11 (hunger 49312→0), consumes
            exactly 1 of the larder's 5 food units, 0 invariant violations; two same-seed runs hash-equal.
            The 1000-tick integration golden is untouched (hunger reaches ¾·ONE only at tick ~3072). **Still
            open:** the non-food needs (`pray`/`enjoy`/social/`make_love`), and tuning the trigger/food-id
            once the atomic `event` vocabulary + an eatable-flag extraction land.
      - [x] **Fatigue rise** (the first non-food need — the rest/sleep bar) — `needsSystem` now also
            raises every {@link Settler}'s `fatigue` by `FATIGUE_RISE_PER_TICK` (=ONE/8192, half hunger's
            rate so a settler eats about twice per sleep) each tick, clamped at ONE (a new `fatigueInRange`
            core invariant). The pairing reset is the **`sleep` atomic** (id **8**, bound for every
            job/tribe in the original `tribetypes` `setatomic <job> 8 "..._sleep"`); this is the rise half,
            the same split hunger went through. The other named non-food needs (`pray` id 12 / `enjoy` id
            17 / `make_love` id 78 — each satisfied at a target site, not in place) follow. APPROXIMATED
            (see FIDELITY.md): like hunger, the original ticks rest via per-animation events
            (`viking_civilist_sleep` carries `event <at> 1 +4000`, type 1 = the rest channel) needing the
            atomic `event (type,value)` decode; a flat per-tick rate is the bounded "tiredness grows,
            sleeping resets it" core. **Hands-on:** 200 ticks through the real `Simulation.step()`
            schedule (settler spawned via the command queue) → fatigue rises at exactly half hunger's
            rate (1600 vs 3200), stays below it, **0** invariant violations every tick, two seed-7 runs
            hash-equal (`98993f42`). The golden state hash moved (`db68cc53`→`ff907e9a`) — settlers now
            carry a second need field — but the **atomic trace + 8-plank output are unchanged** (no sleep
            DRIVE yet: fatigue only rises, never reaching a threshold over the 1000-tick slice).
      - [x] **Sleep drive** — the AI atomic planner (`systems/ai.ts` `atomicPlanner`) now chooses a
            `sleep` atomic (id **8**, the original's `setatomic <job> 8 "..._sleep"` slot) when a
            settler's `fatigue >= FATIGUE_SLEEP_THRESHOLD` (=¾·ONE), mirroring the eat drive. Placed
            **below** the eat drive (a starving settler eats before it can rest) but **above**
            harvest/haul/staffing so a worn-out operator stops working. The settler sleeps **in place**
            (no walk, no target site) — the new `sleep` {@link AtomicEffect} zeroes `fatigue` on
            completion (AtomicSystem, no goods consumed — resting is free, unlike `eat`), closing the
            rise→sleep→reset loop. APPROXIMATED (see FIDELITY.md): the atomic id (8) is pinned, but the
            ¾·ONE trigger is inferred (like the eat trigger) and the **in-place** rest is the slice
            stand-in — the original sleeps at *home*, but the housing/home system that would give a
            sleep target is a later slice. **Hands-on:** a settler crossing the threshold through the
            real `Simulation.step()` schedule starts the sleep atomic tick 1, fatigue resets to 0 by
            tick 6 (the 6-tick `viking_sleep` animation), peak never breached ONE, 0 invariant
            violations; two seed-5 runs hash-equal (`8e2e10b0`). The 1000-tick integration golden is
            untouched (fatigue reaches ¾·ONE only at tick ~6144). **Still open:** the target-bound
            non-food needs (`pray` id 12 / `enjoy` id 17 / `make_love` id 78 — each satisfied at a
            site, needing a need→satisfier→building-target lookup).
      - [x] **Piety rise** (the first target-bound non-food need — the rise half) — `needsSystem` now
            also raises every {@link Settler}'s `piety` by `PIETY_RISE_PER_TICK` (=ONE/16384, half
            fatigue's rate so a settler prays about once per two sleeps) each tick, clamped at ONE (a new
            `pietyInRange` core invariant). Piety is the first need satisfied at a **target site** rather
            than at a store (eat) or in place (sleep): the original pairs it with the `pray` atomic (id
            **12**, bound for the civilist job in every tribe's `tribetypes` `setatomic 6 12 "..._pray"`)
            run **at a temple**. This is only the rise half — the *reset* (the `pray` atomic) and the
            *drive* (walk to a temple when piety crosses a threshold, the genuinely-new need→satisfier→
            building-target lookup) follow, the same rise-then-drive split hunger and fatigue went
            through. APPROXIMATED (see FIDELITY.md): like hunger/fatigue, the original ticks devotion via
            per-animation events on a numbered channel needing the atomic `event (type,value)` decode; a
            flat per-tick rate is the bounded "devotion lapses, praying restores it" core. **Hands-on:**
            20000 ticks through the real `Simulation.step()` schedule → piety rises and **clamps exactly
            at ONE** at tick 16384, then pinned; piety ≤ fatigue ≤ hunger every tick (slowest rate rises
            least), **0** invariant violations, two seed-7 runs hash-equal (`0a20b59b`). The golden state
            hash moved (`ff907e9a`→`d780b4ad`) — settlers now carry a third need field — but the **atomic
            trace + 8-plank output are unchanged** (no pray DRIVE yet: piety only rises, never reaching a
            threshold over the 1000-tick slice). **Still open:** the pray drive (the need→satisfier→
            temple-target lookup), then `enjoy` id 17 / `make_love` id 78 the same way.
      - [x] **Pray drive** (the first **target-bound** need — walk to a temple) — the AI atomic planner
            (`systems/ai.ts` `atomicPlanner`) now chooses a `pray` atomic (id **12**, the original's
            `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_PRAY` / `setatomic 6 12 "..._pray"`) when a settler's
            `piety >= PIETY_PRAY_THRESHOLD` (=¾·ONE), mirroring the eat/sleep drives but doing the
            genuinely-new **need→satisfier→building-target lookup**: it finds the nearest **temple** and
            sets a `MoveGoal` to walk there (unlike eat at a store / sleep in place — the first need that
            requires reaching a specific *building*), and on arrival starts the atomic. The new `pray`
            `AtomicEffect` (`commands.ts`/`atomic.ts`) zeroes `piety` on completion (no goods consumed —
            like sleep), closing the rise→pray→reset loop. Placed **below** eat + sleep (survival outranks
            devotion); a devout settler with no temple anywhere falls through to normal work (piety stays
            pinned at ONE). A temple is recognised by its structural signature (`isTemple`, `shared.ts`):
            a `kind === 'workplace'` building with **no recipe, no workers, no stock** — the original's
            `HOUSE_TYPE_WORK_TEMPLE` (logictype 37, logicmaintype 3) carries none. APPROXIMATED (see
            FIDELITY.md): the temple→pray-need link isn't a readable flag, so it is inferred from that
            signature (like food→eat-slot); the ¾·ONE trigger is unpinned like eat/sleep. **Hands-on:**
            a devout settler a few cells from a temple walks over and prays through the real schedule,
            piety resets to 0, peak never breached ONE, 0 invariant violations, two seed-5 runs
            hash-equal; the golden trace + state hash are untouched (the slice never spawns a temple, so
            no settler ever crosses the pray threshold). **Still open:** `enjoy` id 17 / `make_love` id 78
            the same target-bound way.
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

**Live:**
- **Settler AI fidelity** — the soul, undocumented. Approach = planner over the data-extracted
  atomic vocabulary; base atomic timings/yields come from `atomicanimations.ini` (see below), with
  only fine-tuning by observation, kept as data so tuning is a diff. See docs/ECS.md "Settler AI".
- **Map binary tile grid** — **decode chain closed** (was "container decoded"): the per-cell landscape
  grid (the Phase-2 nav-graph input) lives in the sibling **`map.dat`**, NOT in `map.cif` (which is
  only the logic-header `CStringArray`). `map.dat` is a flat `hoix`-chunk container (0x20-byte headers;
  oracle `CIoHelper.cs`) — decoded by `decoders/mapdat.ts` (`decodeMapDat` chunk table + `lsiz` dims).
  The `lm**` layers are `pck`/`X8el`-packed (the `.bmd` packed-line codec family, confirmed) and
  unpack via `unpackMapLayer`; the landscape-type lane is **`lmlt`** (4 B/cell = four per-corner
  triangle typeIds), reduced to one per-cell typeId by `lmltToTerrainMap` → fed to the sim's
  `buildTerrainGraph` (hands-on: `oasis_o_plenty` 250×250 → 62500-cell graph). The remaining leg is
  CLI wiring (emit a per-map `TerrainMap` into `content/`). The corner→cell reduction is
  *approximated* (no behavioral oracle — see docs/FIDELITY.md). See docs/SOURCES.md "`map.dat` chunk
  container". This grid (not `landscapetypes.ini`) is also the only plausible home for any per-cell
  walk weight — the type table has none (confirmed: only `maximumValency` + placement flags), so
  uniform walk cost stays faithful unless a real attribute turns up in a `map.dat` layer.
- **Combat & campaign scripting scope** — both larger than one roadmap line implies.
- **Determinism drift** — every new system must keep golden state + trace tests green.

**Resolved (archived):**
- ~~**`.cif` decrypted payload structure**~~ — **SOLVED** in Phase 1 (`decoders/cif.ts`): root
  `CStringArray` of Mode1-encrypted depth-prefixed text lines; verified on type tables + a map.
- ~~**Atomic timings/effects**~~ — **extracted** (`extractAtomicAnimations`): the mod's readable
  `DataCnmd/atomicanimations12/atomicanimations.ini` gives `length`/`event`/`startdirection` per
  named animation. The remaining open part is decoding what each `event` `(type, value)` means
  (yields/needs/cues) — only fine tuning should need observation.
