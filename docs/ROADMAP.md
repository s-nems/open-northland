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
      `logicproduction <good>` → `produces` (output good ids only — input goods/amounts/timing are the
      Phase-3 goods-graph; `recipe` stays empty till then), `logichomesize` → `homeSize`. `kind` maps
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
      - [ ] **Map tile/landscape grid + mission scripting** — the binary terrain grid (the Phase-2
            cell-graph input, if stored outside the logic-header `CStringArray`) and the `MissionData`/
            `StaticObjects` campaign layer (Phase 5). Still open; metadata-only above.
- **Exit:** `npm run pipeline` produces a validated `content/` (types + atlases + one map), decoded
  graphics verified against the oracle.

## Phase 2 — Vertical slice (prove the sim)  ← **first real target**
Goal: one tribe, headless-correct, then on screen. Establish the invariants that the rest depends on.
- [ ] **CommandSystem + serializable command schema** — the ONLY way state mutates. Save = command
      log from day one (disk format later; the invariant is now). Define the **snapshot read-view**
      (double-buffer or immutable view) so `render` never reads mid-mutation.
- [ ] Terrain as a **cell-adjacency graph** with per-type walk cost/valency (from
      `landscapetypes.ini`). *Not* the triangle geometry — that's render-only.
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
        **Still to do:** a real per-type walk-cost field (uniform ONE for now), and feeding the graph
        from a decoded map's tile grid.
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
      pickup → carry → pileup at store.
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
