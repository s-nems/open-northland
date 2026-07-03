# Roadmap archive — completed work

Reflection-only record of finished phases — **the executor never reads this** (`/iterate` reads only
the live [ROADMAP.md](ROADMAP.md)). It preserves the clean-room verification trail (the
"**Hands-on:**" notes) for every landed slice, so the live roadmap can stay lean without losing the
evidence. New completed items are swept here from `ROADMAP.md` during `/reflect`'s doc-bloat pass.

For the live plan and the current target, see [ROADMAP.md](ROADMAP.md).

**One entry per roadmap item, filed under its phase — a re-sweep UPDATES that entry in place, it never
appends a new dated "Nth doc-bloat pass" section.** (Appending is what triplicated Animals / Combat /
N-tribes / Construction across three parallel narratives.) Keep the final golden hash + the one headline
verified number; drop superseded intermediate hashes and re-explanation — git history is the full record.

---

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
      Done — `packages/sim/test/core/golden-trace.test.ts`. The *integration* golden (the per-mechanic
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
- [x] NeedsSystem: hunger + non-food needs implied by atomics (eat, plus `pray`/`enjoy`/`make_love`).
      DONE — every named need has its rise (`needsSystem`) + its atomic reset wired; eat/sleep/pray
      carry full drives (the planner chooses them at a threshold), while enjoy + make_love (which share
      the **same leisure/`enjoyment` channel 3**, not separate needs) ship rise + reset only, their
      *drive* deferred for one recorded reason: no readable building satisfier in `houses.ini` (see
      docs/FIDELITY.md). "social" is a render/grouping concern, not a settler bar. Refinement open: the
      per-activity `event (type,value)` rates + the satisfier→need binding that would pin the enjoy/
      make_love drives, both waiting on the deferred atomic-`event`-vocabulary extraction.
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
      - [x] **Enjoyment rise** (the recreation/leisure need — the rise half) — `needsSystem` now also
            raises every {@link Settler}'s `enjoyment` by `ENJOYMENT_RISE_PER_TICK` (=ONE/32768, half
            piety's rate so it's the least-pressing of the four bars) each tick, clamped at ONE (a new
            `enjoymentInRange` core invariant). The pairing **reset** is the `enjoy` atomic id **17**,
            pinned to the original `tribetypes` `setatomic 6 17 "..._civilist_enjoy"` bindings (the
            civilist + woman jobs across tribes); its animation restores the need via `event <at> 3
            <delta>` tuples (channel 3 = the leisure need, as channel 1 = rest, 2 = hunger). The new
            `enjoy` {@link AtomicEffect} (`commands.ts`/`atomic.ts`) zeroes `enjoyment` on completion (no
            goods consumed — like sleep/pray). APPROXIMATED (see FIDELITY.md): like the other needs the
            per-tick rate is a constant stand-in for the event-driven model. **Unlike pray (a temple),
            `enjoy` has NO readable building satisfier** — the only no-recipe/no-worker/no-stock houses in
            `houses.ini` are the temple (lt 37) and a decorative wall (`work murek`, lt 55), neither a
            leisure site — so the `isTemple`-style structural-signature trick does NOT extend, and the
            **drive (where it is satisfied) is deferred** pending a content building→need binding; only
            the rise + reset are pinned. **Hands-on:** through the real `Simulation.step()` schedule →
            enjoyment rises at exactly ONE/32768 (200 after 100 ticks), stays ≤ piety every tick, clamps
            exactly at ONE at tick 32768, 0 invariant violations, two seed-5 runs hash-equal (`1f0add20`).
            The golden state hash moved (`d780b4ad`→`d1ac5fbe`) — settlers carry a fourth need field — but
            the atomic trace + 8-plank output are unchanged (no enjoy DRIVE: enjoyment only rises, never
            reaching a threshold over the 1000-tick slice). **Still open:** the `enjoy` drive once a
            satisfier building→need binding is extractable; then `make_love` id 78.
      - [x] **Make-love reset** (the last named non-food need — `make_love` id **78**) — a new
            `make_love` {@link AtomicEffect} (`commands.ts`/`atomic.ts`) zeroes a settler's `enjoyment`
            on completion. KEY FIDELITY FINDING: `make_love` is **not a separate need** — the
            `..._make_love` animation restores the **same channel 3** as `enjoy` (`event <at> 3 +800`
            tuples, a bigger leisure boost than enjoy's `+100`), the leisure/`enjoyment` bar — so it
            resets the **same field**, no new component. The atomic id 78 is pinned to
            `#define MAP_MOVEABLES_ATOMIC_ACTION_TYPE_MAKE_LOVE 78` (`logicdefines.inc`) + the mod's
            `setatomic 5 78 "..._woman_make_love"` / `setatomic 6 78 "..._civilist_make_love"` bindings
            (woman job 5 + civilist job 6 across tribes). Its **drive is deferred** for the identical
            reason as `enjoy` — no readable building satisfier in `houses.ini` — so only the reset is
            wired (no planner branch chooses it yet). **Hands-on:** a settler with enjoyment=ONE running
            `make_love` (id 78, duration 3) through the real `Simulation.step()` schedule resets
            enjoyment at tick 3, CurrentAtomic removed on completion, two seed-5 runs hash-equal
            (`e52c6f77`). The golden trace + state hash are untouched (no make_love drive — the slice
            never spawns it). With this, all five named non-food needs (eat/sleep/pray/enjoy/make_love)
            have their atomic resets in place; the NeedsSystem rise/reset half is complete.
- [ ] **ProgressionSystem** — experience + tech graph: `humanjobexperiencetypes` per-specialization
      XP, `trainforjob` schooling, `needfor*`/`allow*`/`jobEnables*` gating goods/houses/jobs/vehicles.
      - [x] **`humanjobexperiencetypes` IR extracted** — `extractJobExperience` (`decoders/ini.ts`)
            reduces `Data/logic/humanjobexperiencetypes.ini`'s `[humanjobexperiencetype]` records to the
            validated `HumanJobExperienceType` schema (`@vinland/data`): a per-specialization XP track
            keyed on `typeId`, naming its owning `jobType` (`job`, always) and, when good-specific, the
            `goodType` (`good`) it trains on, plus `experienceFactor` + optional `baseRepeatCounter` —
            all 1:1 with the source keys, no interpretation (the XP curve is the accrual system's job).
            Wired into the CLI (`buildIr` + a new base `resolveIniSources` entry + the `ContentSet`
            `jobExperience` field); `validateCrossReferences` checks every `job`/`good` ref resolves.
            **Hands-on:** `npm run pipeline` on the real game → **70 tracks** (44 good-specific, 26
            general, 3 with a baseRepeatCounter, 26 distinct jobs, experienceFactor 1..250), 0 dangling
            refs.
      - [x] **XP-accrual wired** — `grantWorkExperience` (`systems/progression.ts`), called from the
            AtomicSystem when a settler completes a **work** atomic that yields a good (today: `harvest`).
            It resolves the matching `(settler.jobType, goodType)` track — preferring the good-specific
            track over the job's "general" one (`trackFor`) — and adds its `experienceFactor` to the
            settler's per-specialization XP (`Settler.experience`, keyed by the track's `typeId`). XP is
            event-shaped (it accrues at the instant a work atomic completes) and sim events are
            render-only, so the grant lives in the executor's effect-apply, not a poll-driven system —
            the `progressionSystem` stub stays reserved for the **gating/tech-graph** half. **Hands-on:**
            the real `Simulation.step()` vertical slice (seed 7, 1000 ticks) → the woodcutter accrues
            exactly **80 XP** in its wood track (8 harvests × experienceFactor 10), the carrier + mill
            operator accrue nothing; golden atomic trace + 8-plank output unchanged, state hash moved
            deliberately (`d1ac5fbe → f0edd147`).
      - [x] **`jobEnables*` tech-graph edges extracted** — `extractJobEnables` (`decoders/ini.ts`,
            called from `extractTribes`) reduces each `[tribetype]`'s `jobEnablesGood`/`jobEnablesHouse`/
            `jobEnablesJob`/`jobEnablesVehicle <jobType> <targetId>` lines to unified
            `TribeType.jobEnables` edges (`{jobType, kind, targetId}` discriminated by `kind`) — the
            **gate** half of progression: a settler of `jobType` present in the tribe unlocks producing/
            building/training/using the target. Edges kept in exact source file order (the data
            interleaves the four kinds within a job's block); repeats kept verbatim (like `setatomic`). `validateCrossReferences` resolves good/house(building)/job
            targets; the `vehicle` kind is skipped (its id is the `logicvehicletype` namespace, not yet
            in the IR — would false-positive). **Data-only this iteration — no sim consumes the edges
            yet.** **Hands-on:** `npm run pipeline` on the real game → **1325 edges across the 5 playable
            tribes** (285 good / 880 house / 110 job / 50 vehicle; animals none), 0 dangling refs, vehicle
            ids `{1..5}`.
      - [x] **`jobEnablesHouse` placement gate wired into the sim** — `buildingEnabled` (`systems/
            progression.ts`) is the *read* side of the tech-graph: CommandSystem's `placeBuilding` now
            consults it before creating a building. A house with **no** `jobEnablesHouse` edge gating it
            (the headquarters) places freely; one that *is* gated places only while a `Settler` of an
            enabling job is alive in the **same** tribe — otherwise the placement is a recoverable
            boundary failure (skipped but still command-logged, so replay stays faithful). A tribe absent
            from the content tribe table gates nothing (a mapless/tribe-less fixture still places start
            buildings — the determinism golden is untouched). The query is a pure **membership** check
            (does *some* enabling-job settler exist?), so it stays deterministic without a sorted scan.
            Only the **house** kind is consumed yet; good/job/vehicle unlocks await their producer /
            JobSystem slices. **Hands-on:** compiled `dist` `Simulation.step()` — a `placeBuilding` smithy
            (gated `jobEnablesHouse 2 4`) with no carpenter → **0 entities, command logged**; spawn the
            carpenter then retry → smithy (type 4) placed; a carpenter in a *different* tribe does not
            unlock it.
      - [x] **`{need,train}for{job,good}` XP/schooling requirements extracted** — `extractJobRequirements`
            (`decoders/ini.ts`, called from `extractTribes`) reduces each `[tribetype]`'s
            `{need,train}for{job,good} <targetId> <amount> <expType> [expType2]` lines to unified
            `TribeType.jobRequirements` records (`{requirement, target, targetId, amount,
            experienceTypes[]}`) — the **threshold** half of progression under the `jobEnables*` gate.
            Two orthogonal dimensions: `requirement` = `need` (XP already accrued) vs `train` (schooling
            cost), `target` = `job` vs `good`. Records kept in exact source order, repeats verbatim,
            malformed lines skipped (the `jobEnables`/`setatomic` stance). `validateCrossReferences`
            resolves each `targetId` against the job/good table; the `experienceTypes` are NOT checked
            (they span an id space wider than the 70-entry `humanjobexperiencetypes` table — `need` ids
            reach 75, `train` uses synthetic "school" markers 57/77 — so resolving would false-positive,
            like the unchecked `vehicle` jobEnables kind). **Data-only — no sim consumes them yet.**
            DEVIATION-FROM-DOC recorded in FIDELITY: `info.txt` says `trainfor*`'s school expType is
            "always 77", but the real data also uses 57. **Hands-on:** `npm run pipeline` on the real
            game → **575 requirements across the 5 playable tribes** (145 needforjob / 115 trainforjob /
            160 needforgood / 155 trainforgood; animals none), 20 lines with two expTypes, 0 dangling
            target refs.
      - [x] **`jobEnablesGood` production gate wired into the sim** — `goodEnabled` (`systems/
            progression.ts`) is the *read* side of the tech-graph's **good** kind, the sibling of
            `buildingEnabled`: ProductionSystem's `canStartCycle` now consults it before a workplace
            begins a cycle. A good with **no** `jobEnablesGood` edge gating it is produced freely; one
            that *is* gated produces only while a `Settler` of an enabling job is alive in the **same**
            tribe — otherwise the cycle simply never starts (inputs untouched, no waste), exactly like
            the worker-presence / output-capacity gates. The two readers share one
            `tribeUnlockEnabled(kind, targetId)` membership helper (no duplicated tribe-scan). A
            mapless/tribe-less fixture gates nothing (the determinism golden + 8-plank slice are
            untouched — the slice always has a woodcutter in the tribe). **Hands-on:** compiled `dist`
            `Simulation.step()` — a sawmill (output PLANK gated `jobEnablesGood 1 2`) staffed by a
            carpenter but with **no woodcutter** → **0 planks, wood untouched at 5**; spawn a woodcutter
            in the tribe → 1 plank; a woodcutter in a *different* tribe leaves it gated; two seed-7 runs
            hash-equal (`bb6ef2e9`).
      - [x] **`needfor*` XP-threshold read side** — `experienceRequirementMet` + `settlerMeetsNeed`
            (`systems/progression.ts`) interpret the `needfor{job,good}` thresholds (`TribeType.jobRequirements`,
            `requirement === 'need'`) against the **accruing** `Settler.experience` — the *threshold* half
            of the XP→unlock curve, the first piece to consume the XP `grantWorkExperience` produces.
            `experienceRequirementMet(experience, req)` sums the settler's accrued XP across the line's
            `experienceTypes` (keyed by the **same** `humanjobexperiencetypes` track typeIds the accrual
            writes) and compares to `amount`; `settlerMeetsNeed(ctx, tribe, target, targetId, experience)`
            checks **all** the `need` requirements gating one `(target, targetId)` are met. `train`
            requirements are skipped (a schooling COST at a training house, not an accrued-XP threshold);
            a target with no `need` requirement / a tribe absent from content thresholds nothing. Pure read
            over content + the XP Map (no RNG/wall-clock; sum in the fixed `experienceTypes` order).
            **Read-side helper only — no planner/system consumes it yet** (like `jobEnables` was data-only
            before its gate). APPROXIMATED (FIDELITY): a two-`expType` line is read as "sum the named
            tracks"; the `baseRepeatCounter`→competence-tier curve stays deferred. **Hands-on:** the real
            game IR → **305 `need` requirements across 41 tribes** (26 distinct expTypes, 23 resolving to a
            real track typeId; range 3..75); `experienceRequirementMet` on a real `needforjob 19 10 45`
            gates at the boundary (9 XP → false, 10 → true), is monotone non-decreasing (first met exactly
            at `amount`, never re-locks), a `train` line is vacuously met.
      - [x] **`needforgood` harvest-side gate consumed in the AI planner** — `nearestHarvestableFor`
            (`systems/ai.ts`) now calls `settlerMeetsNeed(ctx, tribe, 'good', good, experience)` alongside
            the existing job-`allowedAtomics` gate: a settler may only harvest a resource whose good its
            **own accrued XP** clears (`needforgood <good> <amount> <expType…>`) — the *who-may-do-it*
            gate, the per-settler sibling of the production-side tribe-presence `jobEnablesGood` gate. A
            below-threshold settler isn't even given a harvest MoveGoal/atomic; an unthresholded good is
            harvestable from 0 XP, and the settler *trains* the good's track by harvesting it
            (`grantWorkExperience`), so the gate is self-consistent. The shared fixture thresholds only
            PLANK (never harvested), so the gate is inert there and the golden trace is untouched.
            **Hands-on:** compiled `dist` `Simulation.step()` over a wood good gated `needforgood 1 20 [1]`
            — a woodcutter with **19** wood XP → **0 harvests, tree untouched**; with **20** XP →
            harvesting begins (tree 5→4 within 100 ticks); two same-seed runs hash-equal.
            **Next:** interpret `baseRepeatCounter` into the multi-tier competence curve (output
            quality/speed by XP tier); consume `needforjob`/`settlerMeetsNeed(target='job')` from the
            JobSystem so a settler only takes a gated *job* once its XP clears the threshold; and consume
            the `job`/`vehicle` jobEnables edge kinds as their JobSystem/vehicle slices land.


---

## Phase 3 — Economy, progression & population (swept item narratives)

Swept from ROADMAP.md during the doc-bloat reflection pass. These items stay **open** on the live
roadmap (each carries an oracle-blocked or human-gated deferral); their full landed-narrative is
preserved here so the live item can read as a one-line summary. Text is verbatim as it stood when swept.

- [ ] **JobSystem** — assignment **landed** (idle settlers take open, tech-enabled, understaffed
      workplace jobs, gated by `needforjob` XP — `systems/jobs.ts`), each is **bound to its workplace**
      (the `JobAssignment{workplace}` record — understaffing is now per-building, so two same-type
      workplaces staff independently and a worker stays latched to *its* mill across a step-off the
      tile), and a freshly-assigned operator **walks to its bound workplace** (the AI
      walk-to-bound-workplace drive — `boundWorkplaceTarget` in `systems/ai.ts` — so a pure-operator job
      like the carpenter reaches its station instead of idling), and the **binding's demolition path is
      closed** (the `demolish` command unbinds + idles every settler bound to a building before
      destroying it — `unbindWorkersOf` in `systems/command.ts` — so a worker is never stranded latched
      to a dead workplace; the JobSystem re-employs it next tick). **Vehicle data extracted** — the
      `vehicletypes` table (incl. `stockSlots` carry capacity: handcart 15 / oxcart 30 / ships 50,200)
      now lands in the IR (`VehicleType`, `Data/logic/vehicletypes.ini`), the param the carrier slice
      consumes, and the **`jobEnablesVehicle` cross-ref is now resolved** in `validateCrossReferences`
      (the `vehicle` kind keys into `VehicleType.typeId`, the distinct `logicvehicletype` namespace — the
      real data's 50 vehicle edges, ids `{1..5}`, all land within the 6-entry table). **`stockSlots` is now
      wired into the sim** — a carrier hauls a batch sized by `carrierCarryCapacity` (`systems/progression.ts`):
      the largest `stockSlots` among the vehicle types its tribe has UNLOCKED via `jobEnablesVehicle`,
      falling back to 1 (a single unit on foot) before any vehicle is available — the **sim's first
      consumer of the `vehicle` `jobEnables` edge kind**. The carrier→vehicle PAIRING (a per-carrier
      vehicle entity, cart logistics) is still approximated (see docs/FIDELITY.md). **The `job`
      `jobEnables` edge kind is now also consumed** — `jobEnabled` (`systems/progression.ts`, called from
      `openJobAt`) gates an idle settler's assignment on the `jobEnablesJob` tech edge (a job a settler
      must already be present to unlock, e.g. a smith unlocking a weaponsmith), so the `tribeUnlockEnabled`
      read side now covers **all four** edge kinds. The carrier→vehicle PAIRING (a per-carrier vehicle
      entity, cart logistics, the per-vehicle `logicgood` carry-filter) is now a **recorded conscious
      deviation** (docs/FIDELITY.md — *Carrier→vehicle pairing*): it is oracle-blocked (`vehicletypes.ini`
      carries no carrier→vehicle binding or dispatch key; OpenVikings' sim is a stub), so modelling a
      cart-as-entity now would be invented, not faithful — the data (`stockSlots` + the `vehicle` unlock
      edge) is consumed, the divergence is knowable, and the faithful path is named, deferred to a
      vehicle-entity slice once an oracle exists. With that decision recorded, the JobSystem has no
      remaining *unrecorded* unmodelled behavior.
- [ ] **ReproductionSystem** — birth **landed** (`systems/reproduction.ts`): one settler per tribe per
      tick while `tribePopulation < housingCapacity` — the first WRITER of the housing read model, born a
      **baby** at the tribe's lowest-id built `home` tile. The cadence IS the gate (deterministic, no RNG,
      self-limiting at capacity), so the **`populationWithinHousing` invariant** (a content-bound factory
      in `invariants.ts` — it needs the `homeSize` param the `Invariant` signature doesn't carry) can
      never be breached by a birth. **Age-class structure now landed** — a newborn's `jobType` is the
      data-pinned youngest age class (`NEWBORN_AGE_CLASS` = `baby_female` id 1, pinned to `logicdefines.inc`
      `JOB_TYPE_HUMAN_BABY_FEMALE` + the `jobtypes.ini` records), because in the original the first five
      `jobtypes` (`baby_female`/`baby_male`/`child_female`/`child_male`/`woman`) are **age/sex classes**,
      not working trades. `systems/ageclass.ts` is the sim-side recognition (`isBaby`/`isChild`/
      `isNonWorkingAge`, ids 1–4 non-working), so the JobSystem leaves a baby unemployed (non-null jobType
      → skipped; no `workers` slot lists a baby → never adopted). The birth *rate*, *sex*, and the
      **growth cadence** are below the readable `.ini` (no birth-rate/sex/grow-up key; `make_love` restores
      the leisure channel, not a birth yield), so they are **approximated** (see docs/FIDELITY.md).
      **The growth transition now LANDED** — `systems/ageclass.ts`'s `growthSystem` ages each born settler
      (the new **`Age{ticks}`** optional component the ReproductionSystem adds at birth, mirroring
      `JobAssignment`) and promotes its age-class `jobType` baby→child→adult-eligible over `GROWUP_TICKS`
      per stage, **sex preserved** (baby_female→child_female, baby_male→child_male), removing the `Age`
      component once it reaches adult-eligibility (`jobType` null) so the JobSystem then employs it. The AI
      planner skips a still-growing settler (keyed on the **`Age` component**, not the age-class id — a
      synthetic fixture's adult job id can collide with a real age-class id, but only a born-young settler
      carries `Age`), so a baby/child no longer runs the adult eat/sleep/pray drives — faithful to "a baby
      is cared for, it doesn't self-feed". `GROWUP_TICKS`=8192 is the unpinned approximated cadence (the
      hunger-rise-style constant pattern); inert in the golden/slice (no `home`-kind content → 0 births →
      golden hash + trace unchanged). **Next:** the carrier→vehicle pairing / a per-carrier vehicle entity
      (the JobSystem's last unmodeled behavior), or the HUD slice — births→growth→employment now closes
      the population lifecycle loop.
- [ ] HUD: stocks, population, jobs, the goods graph. **Read model started** — the HUD's data half is
      a set of pure, deterministic derived views over world state (no mechanic, no pixels): `tribeStocks`
      (`systems/shared.ts`) sums each good a tribe holds across all its stores (`Building`+`Stockpile`),
      the **stocks** panel's source, joining `tribePopulation`/`housingCapacity` (the **population** half,
      already landed). The **jobs** breakdown now landed too — `tribePopulationByJob` (`systems/shared.ts`)
      tallies a tribe's settlers by `jobType` into a `Map<jobType, count>`, idle (`null`) adults keyed by
      the negative `IDLE_JOB` sentinel so they can't collide with a real job id, with the age-class
      (ids 1–4) vs trade split left to the consumer to partition by key (the `jobType`-as-life-stage model).
      The **goods-graph** view now landed too — `goodsGraph` (`systems/shared.ts`) surfaces the recipe-DAG
      IR as one `GoodsGraphNode` per good: its node `layer` (raw / produced / unclassified, from
      `GoodClassification`), `inputGood` flag, the input-side edges (`GoodType.productionInputs`), and the
      **output side** joined in — the building **type ids** that make it (`BuildingType.produces`, falling
      back to a materialized `recipe.outputs`), `producedBy` sorted for a stable view. The only read view
      over `content` rather than world state, so it is pure of world/RNG (deterministic by construction).
      **Render-side HUD MODEL landed** — `buildHud(snapshot, tribe)` (`packages/render/src/hud.ts`) is the
      pure, self-verifiable data half of the on-screen HUD, exactly analogous to `buildScene` for the world
      view: it re-derives population / per-job head-counts / per-good stock totals from the **frozen
      `WorldSnapshot`** (not the live stores — `render` is a pure consumer), emitting a flat, sorted
      `HudModel`. The aggregates match the sim read views by construction (a count/sum is order-independent)
      but never re-enter the sim; output is total-ordered (ascending id), so the panel is reproducible
      frame-to-frame. **Render-side HUD LAYOUT landed too** — `layoutHud(model)` (`packages/render/src/hud.ts`)
      is the pure, self-verifiable bridge from the `HudModel` to its pixels, exactly analogous to how
      `buildScene` turns a snapshot into positioned `DrawItem`s before the GPU draws them: it stacks the model
      into labelled sections (header `Tribe N · tick T` / `Population` / an indented **Jobs** tally list with
      the idle sentinel rendered as `idle` / an indented **Stocks** tally list), assigning each row a
      panel-relative `(x, y)` (rows advance by a fixed line height; tallies indented under their heading) and
      sizing the panel `height` to exactly fit the row count. Pure + total (a function of the model alone — no
      Pixi, no glyph metrics; width is a fixed column, height counts rows), so the same model lays out
      byte-identically — *which line lands where* is now unit-tested without a screen, leaving only the glyph
      rasterization to a human. **Render-side HUD PLACEMENT + Pixi DRAW landed too** — the last
      self-verifiable decision (where on the canvas the panel lands) is `placeHud(layout, corner, screen)`
      (`packages/render/src/hud.ts`): it anchors the `HudLayout` to a screen `HudCorner`, **clamps** it
      on-screen, and re-anchors every row's panel-relative `(x, y)` to absolute canvas pixels (the
      screen-space analogue of `terrainMapToScene`) — pure + total, unit-tested. `renderHud(app, placement,
      style?)` (`packages/render/src/pixi-renderer.ts`) is the GPU half (twin of `renderScene`): a pure
      consumer of the `HudPlacement` that paints a backing rect + one Pixi `Text` per screen-positioned row,
      now overlaid on the scene each frame in BOTH `main.ts` (live) and `shot.ts` (the screenshot harness,
      single-tribe viking). Only the **glyph rasterization/typography** (font/colour) is left un-self-verifiable
      — a human eyeballs it via the shot. The goods-graph view (over `content`, not the snapshot) stays a
      sim-side read view the panel can call directly. **Next:** the HUD slice is complete, and the
      carrier→vehicle PAIRING is now a **recorded conscious deviation** (docs/FIDELITY.md — oracle-blocked,
      so the decision was to defer the cart-as-entity rather than invent it). With both closed, every
      Phase-3 mechanic is either landed or explicitly recorded as deferred. The only remaining Phase-3
      work is the two long-open **human-gated render items** (the Phase-1 oracle pixel-diffs; the Phase-2
      real decoded-bob-atlas bind) — an agent cannot self-judge pixels, so they await an owned game copy +
      a human eyeballing the OpenVikings oracle, and Phase 3's economy/progression/population substance is
      otherwise done; the next feature iteration should advance toward **Phase 4 (Conflict & content
      breadth)** — the smallest start being the **N data-defined tribes** scaffolding or the
      `weapontypes`/`armortypes` CombatSystem read side.
- **Exit:** a self-sustaining, progressing single-tribe settlement you can grow.


---

## Phase 4 — Conflict & content breadth (swept item narratives)

Swept from ROADMAP.md during the doc-bloat reflection pass. **Animals as non-controllable tribes**
is substance-complete (every `animaltypes.ini` aggression input consumed); its full landed-narrative
is preserved here verbatim so the live item can read as a one-line summary.

### Animals as non-controllable tribes (`animaltypes.ini`) — substance-complete
- [ ] **Animals as non-controllable tribes** (`animaltypes.ini`: aggression, groups, hitpoints) —
      same entity/AI model, not a separate bolt-on. **Data extracted** — the `animaltypes.ini` table
      (`AnimalType`, base `Data/logic/animaltypes.ini`) lands in the IR: 35 creature/monster tribes with
      `aggressive`/`getAngry`/`angryGameTime` (the aggression inputs), `hitpointsAdult`/`hitpointsBaby`
      (the HP param the `Health`-stamp already reads), the herd/territory params (`maximumGroupSize`/
      `searchForLeader`/`maximumDistanceTo*`/…) and locomotion+flags (`moveSpeed`/`runSpeed`/`catchable`/
      `cannotBeAttacked`/…). **Keyed on `tribetype`** (not `type` — an animal's identity IS its tribe),
      cross-ref-validated; a record with no `tribetype` (a disabled stub) is dropped. **The sim-side
      civ-vs-animal aggression behavior now LANDED** — `combatSystem`'s targeting now consults a single
      hostility relation `mayAttack(content, attacker, target)` (`systems/readviews.ts`) for both
      attacker-eligibility and per-candidate targeting: an **aggressive** animal (`isAggressiveAnimal` —
      `animaltypes.ini` `aggressive`) attacks a nearby civilization unprovoked, the civilization fights
      it back (the fight is mutual), a **passive** animal (no record / not aggressive) neither attacks
      nor is attacked (hunting prey is the separate `catchable`/hunter mechanic), a `cannotBeAttacked`
      animal (`animalCannotBeAttacked` — decorative fauna/bees) is exempt as a civ's *target* (yet, if
      aggressive, can still attack), and two animals don't fight each other. The animal `Health`-stamp
      source is now read by `animalHitpoints(content, tribeType)` (the `hitpoints_adult` pool — a bear's
      15000 — the value a spawned animal's `Health` gets). Faithful (the `aggressive`/`cannotbeattacked`
      flags + net-damage param + atomic id 81); **approximated** (nearest-in-range target acquisition,
      swing cadence, in-place strike, civ-engages-only-aggressive-animals split). **Provoked anger now
      LANDED** — `getAngry`/`angryGameTime` (a passive animal struck → temporarily hostile) is wired via
      a per-entity **`Anger{until}`** timer: the AtomicSystem's `attack` effect stamps it on a struck
      `isProvokableAnimal` (`provokeAnger`, reading `angryGameTimeOf`), and `combatSystem` reads it
      (`hostileAnimalNow` attacker side, `mayTarget` target side) so a provoked animal fights back and is
      a valid target until the timer lapses (reaped on the attacker scan), a re-strike refreshing it — so
      **every** `animaltypes.ini` aggression input is now consumed (see docs/FIDELITY.md). Inert on the
      goldens/slice (no settler carries `Health`). **The herd/spawn
      read side now LANDED** — `herdParams(content, tribeType)` (`systems/readviews.ts`) surfaces the
      already-extracted `animaltypes.ini` group/leader/territory params as one struct (`maxGroupSize`
      from `maximumgroupsize`, `searchForLeader`, `birthPointRange` from `maximumdistancetobirthpoint`,
      `stayPointRange` from `maximumdistancetostaypoint`) — null when the tribe has no animal record (a
      civilization / unknown), the same one-call read shape `animalHitpoints` gives the HP stamp. It is
      a pure derived view (FIDELITY n/a — invents no behaviour; the params are verbatim, 0-passthrough
      drift across all 35 real animals), the data foundation the spawner consumes: every real animal
      carries a herd (`maximumGroupSize` 3..6) and 23 of 35 follow a leader. **The spawn/placement
      mechanic now LANDED** — the `spawnAnimalHerd{tribe,x,y}` command (`systems/command.ts`, the animal
      analogue of `spawnSettler` on the mutation seam) actually places a group of creatures on the map:
      `max(1, maximumGroupSize)` `Settler`s of the animal tribe (jobType null — an animal isn't born into
      a trade), each carrying a `Health` pool stamped from `animalHitpoints` (`hitpoints_adult`),
      deterministically scattered (an expanding 8-direction ring, no RNG) within `birthPointRange` of the
      birth point, and — when `searchForLeader` — a designated **leader** (the herd's lowest-id member)
      every member records via the new optional `HerdMember{leader}` component (a solitary animal carries
      none). A non-animal tribe (a civilization) is bad input and skipped (still command-logged). Faithful
      (group size / HP / birth-range / leader-presence params); **approximated** (the scatter pattern and
      the one-shot placement with no respawn/territory upkeep — recorded in docs/FIDELITY.md "Animal herd
      spawn/placement"). Inert on the goldens/slice (no herd is spawned there). **The animal→weapon binding
      now LANDED** — a spawned animal carries `jobType: null`, but `combatSystem`'s `attackerWeapon`
      (`systems/combat.ts`) now resolves a **jobless animal's** weapon by **`tribeType` alone** (an
      animal's combat identity IS its tribe — each animal tribe carries one attack weapon, `claw`/
      `bearfist`/`wolvefist`; the weapon's `jobType` in the data is the monster combat-class, not a
      player-assignable trade), while a settler with a job still resolves by `(tribeType, jobType)` and a
      jobless *civilian* stays unarmed. So a spawned aggressive animal now actually does damage (the gap
      the spawn opened — faithful, the weapon param is the verbatim `weapontypes` join; docs/FIDELITY.md
      "Combat targeting drive"). **The follow-the-leader movement drive now LANDED** — `herdingSystem`
      (`systems/herding.ts`, runs just before `aiSystem` so the goal is routed same-tick) is the first
      reader of the `HerdMember` relation: a strayed idle follower (farther than `maximumLeaderDistance`
      from its leader — surfaced via `herdParams().leaderDistance`) gets a `MoveGoal` to the leader's cell
      and walks back via the existing path chain, coming to rest inside the radius; the leader itself
      (`leader === self`) and a solitary animal (no `HerdMember`) run no drive, and a reaped leader leaves
      the follower in place. Faithful (the cohesion-radius param); approximated (walk-straight-back-to-
      leader-cell behavior — no flocking/formation oracle; see docs/FIDELITY.md). Inert on the goldens/
      slice (no `HerdMember` there). **The map populator now LANDED** — `seedAnimalHerds(content, terrain, options?)`
      (`packages/sim/src/populate.ts`) is the AnimalSystem/scenario seam that *issues* `spawnAnimalHerd` to seed a
      real loaded map's wildlife: a **pure command-producer** (not a per-tick system — seeding is a one-shot at map
      load) that returns the ordered `spawnAnimalHerd` commands placing every **recorded** animal tribe's herds
      (canonical ascending order; a civilization is never seeded) at **walkable** birth points (stride through the
      terrain's walkable cells in canonical row-major order, round-robin successive birth points across the animal
      tribes, capped by `cellStride`/`maxHerds`). The caller enqueues the returned commands through the one mutation
      seam, so seeding is replay-faithful for free. Faithful (the set of animal tribes + each herd's
      size/HP/range/leader params); **approximated** (*where* + *how many* birth points — the original's per-map
      animal spawn points are below the readable `.ini`; recorded in docs/FIDELITY.md "Animal map populator").
      Verified on the REAL pipeline IR (35 animals) + a real 250×250 decoded map: 125 herds across 34 distinct
      animal tribes, all birth points walkable + in-bounds, deterministic. **The populated-map combat scenario
      now LANDED** — `populated-map-combat.test.ts` is the end-to-end slice this item named: it wires the
      already-landed pieces together as ONE run through the real `step()` schedule — `seedAnimalHerds` produces
      the `spawnAnimalHerd` commands, the caller enqueues them through the mutation seam, the `commandSystem`
      places a real seeded **bear herd** (3 creatures, leader, HP 15000), and a **civilization combatant** beside
      it triggers the mutual civ⇄animal fight: the aggressive bear charges the viking (the unprovoked-aggression
      drive), the viking fights it back, the `attack` atomic drains `Health`, and a lone frail viking is ground
      down by the pack and **reaped** by the `cleanupSystem` (one `settlerDied`) — the seed→combat→hit→death loop,
      end-to-end + deterministic (two same-seed runs reach the same `hashState`). The civ combatant is placed
      directly (with `Health`), since `spawnSettler` mints no `Health` pool yet (settler-side Health/soldier
      stamping is a later slice); the test verifies the *integration* of landed pieces, adds no mechanic, and is
      inert on the goldens. With the **provoked-anger timer now landed** (above), **every** `animaltypes.ini`
      aggression input — `aggressive`, `cannotbeattacked`, `getAngry`/`angryGameTime`, `hitpoints_adult` — is
      consumed, so this item is **substance-complete**. **The hunter strike on `catchable` prey now LANDED** —
      the last unconsumed `animaltypes.ini` driver (`catchable`) is wired, and it is the real **provocation
      SOURCE** the `Anger` timer waits on. `combatSystem`'s targeting (`mayTarget`) now composes a third relation
      alongside hostility (`mayAttack`) and provoked-anger: the **predation** relation
      `mayHunt(content, attackerJob, targetTribe)` (`systems/readviews/tribes.ts`) — a civilization **hunter**
      (`HUNTER_JOB` 15, pinned to `jobtypes.ini` `type 15` + `logicdefines.inc` `JOB_TYPE_HUMAN_HUNTER`) may
      strike a `catchable` prey animal (`isCatchableAnimal` — the cow/livestock a non-hunter combatant leaves
      alone), gated by the attacker's *job* not tribe hostility. The strike reuses the **same `attack` atomic id
      81** every fighting job binds (the original's `setatomic 15 81 "..._hunter_attack"`) and the verbatim
      `weapontypes` net-damage, so the hunter's hit drains `Health` and — for a `getAngry catchable` prey — flows
      through the existing `provokeAnger` path → the `Anger` timer (the provocation the timer waited on). A
      `cannotbeattacked` animal stays exempt from a hunter too. Faithful (the `catchable` param + hunter job id +
      net-damage + atomic id 81); **approximated** (nearest-prey-in-range acquisition, an in-place strike with no
      walk-to-prey advance and no `harvest_cadaver` follow-up, prey only fighting back once provoked — see
      docs/FIDELITY.md "Hunter strike on catchable prey"). Verified on the REAL pipeline IR (2 catchable animals
      tribes 10/19; each of the 5 civilizations carries a real `hunter_bow` job-15 weapon) + a real `step()`
      schedule (a viking hunter drains a real cow's `Health`; a non-hunter leaves it alone). Inert on the
      goldens/slice. **The weapon reach BAND is now honored** — `combatSystem` filters a target to
      `[minRange, maxRange]` Manhattan cells (both verbatim `weapontypes` params), not just the far `maxRange`:
      a target **closer than `minRange`** is too near to hit, so a real hunter's `hunter_bow` (`minRange 3`,
      `maxRange 17`) **can't fire on adjacent prey** — it must be 3+ cells away. This closes the gap LESSONS
      [3f9b610] flagged (25 of 105 real weapons carry `minRange > 1`: bows 3, crossbows/long_bow 4, catapult 8,
      so all ranged weapons were illegally striking point-blank before). Verified on the REAL IR through `step()`
      (a real viking hunter does NOT fire on a real catchable prey 1 cell away but DOES at 3). **Next:** seed a
      real **multi-civilization** scenario exercising two playable tribes' asymmetric bindings end-to-end (the
      asymmetry is in the data; a scenario proves the sim runs it) — or the hunter's `harvest_cadaver`
      (atomic 33) follow-up that yields meat from a felled animal.
      **Later-landed (folded here when the Phase-4 re-sweep was deduped):** the `harvest_cadaver` follow-up above is now LANDED — a hunter's killing blow on `catchable` prey yields the carcass's meat (`cadaverYieldOf` `maximumcadaversize` meat → the slayer's back, good 21). Locomotion is surfaced as a pure read view (`locomotionOf` — `movespeed`/`runspeed`), and the **walk-pace mechanic LANDED** (the `MoveSpeed{perTick}` component + `movementSystem`: a creature whose record sets `movespeed` walks `ONE/movespeed` tile/tick — a boar's `movespeed 8` grazes at 0.125 vs the 0.25 settler default; the direction of the scale, larger = slower, is the one approximation, docs/FIDELITY.md). A `runspeed` also stamps the faster `MoveSpeed{runPerTick}` gait (inert until the deferred flee/charge drive).

### CombatSystem from `weapontypes`/`armortypes` — substance landed (refinements deferred)
- [ ] CombatSystem from `weapontypes`/`armortypes` (a large subsystem: many soldier classes, armor
      tiers, named heroes, amulets/potions — scope it honestly). **Armor data now extracted** — the
      `armortypes` table (`ArmorType`, base `Data/logic/armortypes.ini`: 4 classes woolen/leather/chain/plate,
      each with a `blockingValue` damage-mitigation + a `goodType`) lands in the IR alongside the
      already-extracted `weapontypes` (`WeaponType`, with per-armor-class `damage`). This **closes the
      data join the combat read side needs**: a weapon's `damagevalue <armorClass>` keys were unresolvable
      until the armor-class table existed; now class 1..4 resolve to an armor record (class 0 = unarmored,
      no record). **CombatSystem read side now landed** — `combatDamage(content)` (`systems/shared.ts`),
      a pure content-only derived view (the analogue of `goodsGraph`), joins each `WeaponType.damage`
      against each `ArmorType.blockingValue` into one `CombatProfile` per weapon: its identity (the
      composite `(tribeType, typeId)` `key` + `id`) and a `CombatDamageRow` per armor class it can target,
      carrying `netDamage = max(0, rawDamage - blockingValue)` (clamped — armor never heals). The class set
      is the union of class 0 (unarmored, no record) + the armor records (1..4) + any class the weapon's own
      `damage` lists; the **KNOWN GAP is handled** — out-of-table classes 6/7 (no `[armortype]` record) are
      treated as **unarmored** (`blockingValue 0`, `hasArmorRecord false`), never a crash. Returned as an
      **array, not a Map** — no weapon key is unique (the real animal weapons reuse even `(tribeType,
      typeId)`: tribe 5's `chicken`+`claw`, tribe 8's doubled `bearfist`), so a keyed map would silently
      drop records; the array keeps all 105. **The hit-resolution mechanic now LANDED** — the first real
      combat *behavior*: a completed `attack` `AtomicEffect` (`atomic.ts` → `resolveHit`) drains the
      **resolved net `combatDamage`** (carried already-resolved on the effect, like `pickup`/`eat`'s
      `amount`) from the target's new optional **`Health{hitpoints, max}`** component, **clamped at 0** (a
      hit never heals). So the read-side damage table now has its first consumer. **Faithful (net-damage
      param):** the per-hit amount is the verbatim `weapontypes`×`armortypes` join. **Approximated (no
      oracle):** the **hitpoint pool** (only `animaltypes.ini` carries readable `hitpoints` — 200..20000;
      humans' are below the `.ini`) is a per-content stamp on the large-integer scale, and the **hit loop**
      (who attacks whom, target selection, swing cadence, death/cleanup at 0 HP) is deferred — for now a
      0-HP target just stops being viable and a missing-`Health` target is a no-op (see docs/FIDELITY.md).
      `Health` is a separate optional component (like `JobAssignment`/`Age`), so the golden slice has none
      and the hash is untouched. **The death/cleanup half now LANDED** — `cleanupSystem` (`systems/cleanup.ts`,
      graduated from the stub, runs **last** in `SYSTEM_ORDER`) destroys every entity whose `Health.hitpoints`
      has reached 0 and emits a `settlerDied{entity, cause:'damage'}` event for render/audio. It runs after
      AtomicSystem so a lethal `attack` landed earlier in the tick is reaped the **same** tick (nothing
      downstream sees a 0-HP zombie; the entity is gone by the snapshot render reads). The reaped entity holds
      its own cross-references (a worker's `JobAssignment` points settler→building, never the reverse), so
      destroying it leaves no dangling binding — the reverse hazard (a *building* destroyed under a bound
      worker) stays handled at the `demolish` seam. Collect-then-destroy (canonical ascending-id) keeps the
      scan mutation-safe and the death-event order reproducible. Inert on the goldens/slice (no `Health`-bearing
      entity → no death → hash untouched). **The targeting half now LANDED** — `combatSystem`
      (`systems/combat.ts`, graduated from the stub) gives each idle, living **combatant** (a `Settler` carrying
      a `Health` pool) a target: the nearest **enemy** (`Health`-bearing settler of a *different* tribe) within
      its weapon range, issuing the `attack` `CurrentAtomic` with the `combatDamage`-resolved net damage (the
      attacker's weapon, keyed by `(tribeType, jobType)`, vs an **unarmored** target — settlers wear no armor
      yet). The **attack atomic id is 81** (the original's `setatomic <job> 81 "..._attack"`, verified in
      `DataCnmd/tribetypes12/tribetypes.ini`), its duration resolved through the tribe's binding like every
      atomic. This **closes the targeting→attack→hit→death loop**: combatSystem picks + swings, the AtomicSystem
      `attack` effect lands the hit (drains `Health`), and `cleanupSystem` reaps the felled one — all in-order
      within a tick. Faithful (net-damage param + atomic id); **approximated** (target acquisition = nearest
      enemy in range, swing cadence, in-place strike with no walk-into-melee, every target unarmored — no
      oracle; see docs/FIDELITY.md). Inert on the goldens/slice (no settler carries `Health` → no combatant →
      hash untouched). **Next:** the **N data-defined tribes** scaffolding (never hardcode "two") — the next
      roadmap item — which combat then exercises; the deferred combat refinements (armor-on-a-settler, the
      walk-into-melee advance, animal combatants) ride on that + an oracle.

### N data-defined tribes — scaffolding landed
- [ ] **N data-defined tribes** (viking/frank/saracen/byzantine/egypt), asymmetry expressed through
      each tribe's atomic bindings + `allow*`/`needfor*` graph — never hardcode "two". **Scaffolding
      landed** — the pipeline already extracts ALL 41 `[tribetype]`s (the 5 civilizations + 36
      animal/monster tribes), and the sim already resolves every per-tribe rule (`jobEnables`/`needfor*`
      gates, weapon/atomic bindings) off `settler.tribe` → `content.tribes.find(...)`, so the mechanics
      are tribe-agnostic by construction. The new **`playableTribes`/`isPlayableTribe` read view**
      (`systems/readviews.ts`) is the data-defined enumeration of the **controllable** civilizations —
      distinguished from animals **by the tech graph alone** (only a civilization carries `jobEnables`
      edges; an animal tribe has none), never by a hardcoded name or the count "two". This is the
      foundation the combat cross-tribe targeting and the next item (non-controllable animals) both build
      on. **The animal-vs-civ split is now wired into combat targeting** — `combatSystem`'s
      player-vs-player drive excludes a **known animal tribe** (`isAnimalTribe` in `systems/readviews.ts`
      — a recorded `[tribetype]` with no tech graph, the complement of `isPlayableTribe` *restricted to
      recorded tribes*) both as attacker and as target, so a civilization no longer mis-fires the
      same-different-tribe rule on wildlife; civ-vs-animal aggression is left to the next item's
      `animaltypes.ini` model. The boundary is faithful to the unknown case: a different-tribe combatant
      with **no record at all** (a synthetic enemy) is NOT an animal and stays a valid PvP enemy.
      **Next:** the **animals as non-controllable tribes** item below (the `animaltypes.ini`
      aggression/hitpoints/groups model that drives civ-vs-animal combat), and/or seed a real
      **multi-civilization** scenario/slice exercising two playable tribes' asymmetric bindings
      end-to-end (the asymmetry is in the data; a scenario proves the sim runs it).
      **Later-landed (folded here when the Phase-4 re-sweep was deduped):** the **multi-civilization scenario** above now runs end-to-end (`two-civ-combat.test.ts`: two playable tribes with **asymmetric** weapon + `setatomic 81` swing bindings fight through the real `step()` — mutual, a frail side felled+reaped, deterministic). A civilization becomes a combatant **from the command data** — `spawnSettler{hitpoints}` stamps a `Health` pool (Settler-side Health stamping; HP magnitude approximated, docs/FIDELITY.md), and an optional `Armor{armorClass}` (`spawnSettler{armorClass}`) so a hit resolves the per-class `weapontypes`×`armortypes` net-damage join against the worn class rather than always class 0. **Open (oracle-blocked):** tribe-vs-tribe diplomacy/alliances and the soldier-class→armor-tier content binding.

---

## Phase 3/4 sweep — 2026-06-26 (second doc-bloat pass)

The ROADMAP items below had re-accreted multi-paragraph "now LANDED" narratives after the prior
sweep (they each still carry an oracle-blocked or human-gated deferral, so they stay **open** on the
live roadmap). Their full landed-narrative is preserved here **verbatim** as it stood when swept, so
the live item can read as a one-line summary again.

### Phase 3 — ConstructionSystem (build + deliver + house leveling) — substance landed
- [ ] ConstructionSystem: place → deliver materials → build; **house leveling** (`home level 00..04`) →
      capacity → the births→housing loop. **Landed** (→ archive): the `homeSize` housing read model
      (`housingCapacity`/`tribePopulation`, `systems/shared.ts`); a placed building is immediately built.
      **Build-cost DATA now LANDED** (→ `BuildingType.construction` + `extractConstructionCosts`): the
      per-level build-material cost (and the home level chain typeIds 2..6, each its own tier cost) is
      extracted from the **graphics** table `DataCnmd/budynki12/houses/houses.ini` (`[GfxHouse]`
      `LogicConstructionGoods`) — correcting the earlier "the cost lives below the `.ini`" claim, which
      conflated the logic table (`types/houses.ini`, no cost key) with its graphics twin. Overlaid onto
      buildings by `typeId`, run-length-encoded to `{goodType, amount}`, cross-checked against goods;
      53/55 buildings carry a cost (HQ + one omitted type free). Per-tribe cost spread collapsed to the
      reference tribe (docs/FIDELITY.md). **Build-completion behavior now LANDED** (→ `constructionSystem`,
      `systems/construction.ts` — graduated from the stub): a building placed `underConstruction` (a new
      `placeBuilding{underConstruction}` flag, the opt-in richer entity like `spawnSettler{hitpoints}`)
      enters at `built = 0` with an empty hold; once its own stockpile holds the full `construction`
      material cost the system **consumes** those materials and flips `built` to `ONE`, emitting
      `buildingFinished` (the construction analogue of production's consume-inputs→deposit-outputs cycle;
      a free type — HQ, empty cost — finishes on the first tick). Proven by `construction-system.test.ts`
      (8 cases: partial-cost waits, full-cost builds+consumes, surplus left, free type, never-revisit-a-built,
      determinism, the command path) + hands-on over the real `step()` schedule. The `housingCapacity`
      gate already counted only `built >= ONE` homes, so a finished home now joins housing with no extra
      wiring. **Material-DELIVERY dispatch now LANDED** (→ `stockCapacity`'s under-construction branch,
      `systems/shared.ts`): a `built < ONE` building advertises room for *exactly* its outstanding
      `construction` materials (capacity = the cost-line amount, 0 for any non-material or already-full
      good), so the EXISTING carrier path (`nearestStoreFor` → `MoveGoal` → `pileup`) hauls the build
      goods to the site with **no construction-specific transport code** — a carrier carrying a needed
      good walks to the site, deposits it (capped at the need), and once the full cost lands the
      `constructionSystem` finishes it the same tick. A built building reverts to its normal stock-slot
      capacity, so it stops attracting materials. Proven by `construction-system.test.ts` (3 new cases:
      single-good sink, end-to-end full-cost build via three loaded carriers, determinism) over the real
      `step()` schedule. **Under-construction PRODUCTION gate now LANDED** (→ `productionSystem`'s start
      loop, `systems/production.ts`): a workplace still `built < ONE` is skipped, so **an under-construction
      workshop produces nothing** — the original's "a building doesn't function until built" behavior, now
      *guaranteed* rather than an incidental side effect of the site's construction-only `stockCapacity`
      (a recipe whose input overlapped a delivered build material could previously have been raided by
      production, which runs before construction in `SYSTEM_ORDER`). Inert on the golden (every golden
      building is placed `built = ONE`). **Home LEVEL-UP trigger now LANDED** (→ `constructionSystem`'s
      built-home branch, `systems/construction.ts`): a **built** `home` whose own stockpile accumulates the
      **next tier's** `construction` cost consumes those materials and **upgrades** — its `buildingType`
      becomes the next tier's typeId and `level` increments, so its larger `homeSize` immediately raises
      `housingCapacity` (the births→housing loop gains room). The level chain is read off the **consecutive
      `home` typeIds** (`home_level_00..04` = typeIds 2..6; the next tier is `typeId + 1` when that is also a
      `home`), so the upgrade is purely data-driven — no separate "next level" pointer. The top tier
      (`home_level_04`, no next typeId) never upgrades; a non-home built building is finished forever. At most
      ONE tier per tick (`world.query` snapshots the matches; the new typeId's next-tier cost isn't present
      after the jump). Proven by `construction-system.test.ts` (7 new cases: missing-cost waits, upgrade+
      consume, capacity rises, one-tier-per-tick, top-tier-never, non-home-never, determinism) + a hands-on
      over the **real IR** (a `home_level_00` paying `home_level_01`'s real cost upgrades typeId 2→3,
      capacity 1→2, through the real `step()`). Inert on the golden (no `home`-kind building in the fixture).
      **Upgrade-material DELIVERY dispatch now LANDED** (→ `stockCapacity`'s built-home branch,
      `systems/shared.ts`): a **built** `home` that can still level up (`homeNextTier` — a `home` with a next
      tier, now hoisted into `shared.ts` so both the system and the capacity read it) advertises its NEXT
      tier's `construction` cost as carrier-delivery demand — the per-good ceiling is the **larger** of the
      home's normal stock-slot capacity and the next tier's cost-line amount — so the SAME carrier path that
      supplies a build site (`nearestStoreFor` → `MoveGoal` → `pileup`) now accumulates the upgrade materials
      at the home with **no upgrade-specific transport code**; once the full next-tier cost lands the
      level-up trigger fires, closing the births→housing→upgrade→more-housing loop end-to-end. A top-tier
      home (no next tier) reverts to its plain stock-slot capacity, so a maxed home stops attracting
      materials. Proven by `construction-system.test.ts` (3 new cases: carriers haul the next-tier cost to a
      built home which then upgrades; a top-tier home attracts no upgrade materials; determinism) + a
      hands-on over the **real IR** (a `home_level_00` whose next-tier cost — good4×1 + good3×2 + good26×1 —
      is hauled by four carriers through the real `step()` upgrades typeId 2→3, capacity 1→2; a `home_level_04`
      attracts nothing). Inert on the golden (no `home`-kind building in the fixture).
      **Full loop now PROVEN COMPOSING end-to-end** (→ `births-housing-upgrade-loop.test.ts`): each slice was
      proven in isolation calling ONE system directly; a game-level test now drives the real `step()` schedule
      over 200 ticks and shows them composing — a level-0 home (cap 3) births into its spare slot, two carriers
      haul the next-tier cost in, it **upgrades** to level-1 (cap 5), and births fill the new slots (3 total =
      the L1 ceiling), invariant never breached, deterministic. Surfaced that every settler (carriers included)
      is a housed mouth (`tribePopulation` counts all), so a settlement seeds workers UNDER capacity.

### Phase 4 — Sea/Northland identity — first steps landed
- [ ] **Sea/Northland identity:** water valency, boats as mobile stores, embark/disembark atomics,
      `fisher_sea`/`trader_sea`/`carpenter ship`, `vehicle_ship`. **First step landed** (→ the
      `shipVehicles`/`isShipVehicle`/`largestShipCapacity` read view, `systems/readviews/vehicles.ts`):
      the `vehicle_ship` rows are classified out of `content.vehicles` **by the data alone** (a vehicle
      that carries passengers, `passengerSlots > 0` — the two ships are also the only `logicSize 2` rows),
      sorted by typeId, with the largest ship `stockSlots` exposed as the "boat as mobile store" hold
      (50/200). Proven over the **real IR** (2 ships out of 6 vehicles, `largestShipCapacity 200`).
      **Ship-unlock tech gate now LANDED** (→ `tribeShipsUnlocked`, `systems/progression.ts`): the ships
      a tribe has currently UNLOCKED — `isShipVehicle` ∩ the SAME `jobEnablesVehicle` `vehicle`-kind gate
      `carrierCarryCapacity` uses (`tribeUnlockEnabled`) — so a boat-building/embark slice can ask which
      hulls a tribe may field. In the **real IR** both ships are GATED (job 9 enables ships 3 & 4), so a
      tribe with no settlers fields zero ships; spawning a job-9 settler flips the unlocked set to `[3,4]`.
      **Cargo allow-list now LANDED** (→ `VehicleType.cargoGoods` + `vehicleCargoGoods`/`vehicleMayCarry`,
      `systems/readviews/vehicles.ts`): `extractVehicles` pulls each vehicle's `logicgood` allow-list (the
      goodtype ids a hold may carry — WHAT a boat-as-mobile-store holds, distinct from `stockSlots`' how
      *much*), and the read side gives the per-hold load gate. In the **real IR** both ships + all 3 carts
      enumerate 49 cargo goods, the catapult none.
      **Boat-hull ENTITY now LANDED** (→ `placeBoat` command + the `Vehicle{vehicleType,tribe}` component,
      `systems/command.ts`): a placed hull carrying an (empty) `Stockpile` — the "boats as mobile stores"
      entity, the boat analogue of `placeBuilding`, entering the world through the one mutation seam. Gated
      by `tribeShipsUnlocked` (only a `vehicle_ship` row the tribe has UNLOCKED is fielded; a cart/catapult/
      unknown/locked type is skipped, still logged), so a hull always references a ship the tribe may field.
      Proven by `place-boat.test.ts` through the real `step()` schedule (place ungated ship / gate-then-unlock
      a shipwright ship / refuse cart+unknown+wrong-tribe / deterministic). The hull is a STATIC store for now.
      **Cargo-LOAD gate now LANDED** (→ `stockCapacity`'s Vehicle branch, `systems/shared.ts`): hauling a
      good INTO a hull's `Stockpile` is filtered by the ship's `VehicleType` — a `cargoGoods` (`logicgood`)
      good gets the whole `stockSlots` hold capacity, a forbidden good gets 0 (refused), so a carrier never
      deposits an unhaulable good into a boat. The existing `nearestStoreFor`+`pileup` deposit path routes
      through `stockCapacity` unchanged, so the load gate is inherited with NO new system — the load half of
      the empty hull. Proven by `boat-cargo-load.test.ts` (deposit a carryable plank / refuse a forbidden
      good / never over-fill the hold / deterministic) + hands-on over the real IR (`ship_big#4` resolves
      capacity 200 for a carryable good, 0 for a forbidden one). The carrier carry-BATCH filter (sizing a
      haul by the cart's allow-list) stays deferred with the cart entity (docs/FIDELITY.md — *Carrier→vehicle
      pairing* (a)).
      **Sea-job read view now LANDED** (→ `seaJobs`/`isSeaJob`, `systems/readviews/jobs.ts`): the
      `fisher_sea`/`trader_sea` water trades classified out of `content.jobs` **by the data alone** (the
      `_sea` id suffix the `jobtypes` data carries — the sea variants are distinct jobtypes whose only
      extracted distinguisher from their land counterparts is the name, their atomics coming per-tribe via
      `setatomic`), sorted by typeId. The job-side analogue of `shipVehicles`. In the **real IR** the
      suffix isolates EXACTLY `fisher_sea#23` and `trader_sea#26` out of 55 jobs (no false positives), and
      a [3826bab] *distinguishable-before-planning* check confirmed no other extracted param splits sea
      from land (so the data's name is the discriminator, not an invented flag).
      **Open:** water-valency terrain (which cells a ship floats on — map-decode-blocked, the water
      surface lives in the triangle/terrain grid, not a `landscapetypes.ini` flag), boat movement +
      embark/disembark atomics (no embark/disembark atomic exists in the mod `.ini` — that vocabulary is
      below the readable data, deferred with movement), and the sea-job BEHAVIOR (a sea worker reaching
      its fishing/trading station by boat — rides on boat movement).

### Phase 4 — Import full base + culturesnation content — overlays landed
- [ ] Import full base + `culturesnation` content; bring over the mod's balance edits (data).
      **Scoped (corrected):** the mod does NOT ship overriding copies of the base `Data/logic` type
      tables (no `goodtypes`/`jobtypes`/`landscapetypes`/`vehicletypes`/`armortypes`/`animaltypes`.ini
      under `DataCnmd` — verified on disk), so there is no logic-table overlay merge to do; the
      pipeline already reads each rule table from its single readable source. The mod's *readable*
      contribution is its richer **graphics + tribe + house + weapon + atomic** `.ini`s, most of which
      the pipeline already prefers (golden rule #4). **First overlay landed** (→ `resolveGraphicsBindings`):
      the mod's `types/vehiclestype/jobgraphics.ini` `[jobgraphics]` cart/ship recolours now overlay the
      base `vehicles/jobgraphics.cif` (22 records across tribes 1..4 vs the base's 6 across tribes 1 & 4),
      mirroring the existing humans overlay; `convertBmdTree` keys atlases on `(bmd, palette)` so the
      base pairs (a subset) emit the same atlas files while the mod gains the extra tribes' cross-refs.
      Proven over the **real IR** (vehicle-bmd bindings 6→28, now spanning all four base tribes; 5
      distinct atlas keys unchanged). **Second overlay landed** (→ `extractConstructionCosts`,
      `BuildingType.construction`): the mod's `budynki12/houses/houses.ini` is NOT purely graphics —
      its `[GfxHouse]` records carry the per-level `LogicConstructionGoods` **build-material cost** (and
      the home level chain), now extracted and overlaid onto the logic-table buildings by `typeId`
      (53/55 buildings get a cost). This corrects the earlier scoping that deferred the whole file as
      render-only. **Open:** the file's actual graphics/coords (`GfxBobId`/`GfxFirePoint`/walk-block
      areas) + `animation/.../animations.ini` are render/animation overlays for the render-atlas leg,
      not balance data — deferred with the render-atlas work (the only balance datum the file held was
      the construction cost, now imported).

### Phase 4 — read-view coverage of the extracted combat / animation / vehicle / animal tables
The data-extraction vein that ran from ~[df9847b] through [24bec38]: as each new field landed on the
weapon/armor, atomic-animation, vehicle, and animal IR records, a pure one-call **sim read view**
landed beside it so a deferred behaviour could switch on the data without re-extracting. The vein is
**now exhausted** — every extracted field on these four tables has a sim read view; the behaviours
they seed stay oracle-blocked (no mechanics oracle — docs/FIDELITY.md). The read views, by table:

- **Weapon / armor** (`systems/readviews/combat.ts`, mod `types/weapons.ini` + `armortypes.ini`):
  `combatDamage` (the `weapontypes`×`armortypes` net-damage join); `WeaponType.goodType` (70/105 — the
  good that IS each weapon, the armor `goodType` twin) + `WeaponType.mainType`/`weight` (coarse class +
  encumbrance, all 105) + `WeaponType.munitionType` (30/105 ranged-ammo class — doubles as the "is
  ranged" marker) + `WeaponType.damageType` (5/105 catapult AoE class). Consumers:
  `isRangedWeapon`/`rangedWeapons` + `isSiegeWeapon`/`siegeWeapons` (classify by those markers — 30
  ranged = 25 bows + 5 catapults, siege ⊆ ranged); `weaponClassOf`/`weaponsByClass` (lossless
  `Map<mainType, WeaponType[]>`, 7 classes); the armor twins `armorClassOf`/`armorByClass`
  (`mainType`, 2 light/heavy classes) + `armorMaterialOf`/`armorByMaterial` (finer `materialType`,
  4 cloth/leather/chain/plate buckets); `weaponWeightOf`/`armorWeightOf` (plain `weight` accessors —
  armor `weight` is NOT tier-monotonic, leather tier-2 weighs 0 < cloth tier-1 weighs 1, so it is its
  own field); `weaponsByJob`/`weaponsForJob` (the **soldier-class→weapon roster join** off each
  weapon's `jobtype` — lossless `Map<jobType, WeaponType[]>`, 20 wielding jobs, e.g.
  `soldier_unarmed→{fist,claw}`). Every weapon field (`mainType`/`weight`/`munitionType`/`damageType`/
  `jobType`/`goodType`/`damage`) and every armor field (`mainType`/`materialType`/`weight`/
  `blockingValue`/`goodType`/`typeId`) now has a read view.
- **Atomic animations** (`systems/readviews/animations.ts`, `atomicanimations.ini`):
  `atomicAnimationByName` (the canonical name→record resolver the `atomicDuration`/combat-cadence
  lookups spelled out inline); `isInterruptibleAtomic` (the `interruptable` flag, 245/896 — the
  atomic-preemption drive's seed); `atomicStartDirection` (the `startdirection` facing, 89/896);
  `atomicEventChannelDelta` (the net signed delta an animation contributes to one
  `event <at> <type> <value>` need-bar channel — `ATOMIC_EVENT_CHANNEL` names the four
  REST/HUNGER/LEISURE/PIETY = types 1/2/3/4 — turning the channel-restore magnitudes the
  needs/eat/sleep/pray/enjoy systems assert only in *prose* into a data-pinned lookup);
  `atomicHasExtendedEvents` (does the animation carry any `eventx`? — 43/~2900 lines, all 14 carrier
  `*_produce_*` smith animations, so it doubles as the "producing animation that self-drains the
  worker" marker). Every `AtomicAnimation` field (`length`/`interruptible`/`startDirection`/`events`)
  and every `AtomicEvent` field (`at`/`type`/`value`/`extended`) now has a read view. **Open:** the
  file's graphics/coords + the render-side timing/cue `event` channels (non-need `type` ids 8..36 —
  sounds/effect cues) are render/animation overlays deferred with the render-atlas work; the
  event-driven NEEDS DRIVE that would replace the approximated per-tick rise/reset constants with
  these real deltas stays oracle-blocked (no trigger-cadence oracle).
- **Vehicles** (`systems/readviews/vehicles.ts`, `vehicletypes.ini`):
  `shipVehicles`/`isShipVehicle`/`largestShipCapacity` (the `vehicle_ship` rows by the data alone,
  2/6); `tribeShipsUnlocked` (ships unlocked via the `jobEnablesVehicle` gate); `VehicleType.cargoGoods`/
  `vehicleMayCarry` (each hold's `logicgood` allow-list); `vehicleSizeOf` (`logicSize` footprint class
  `{0:cart,1:catapult,2:ship}` — a third independent ship signal converging with
  `passengerSlots`/`logiccommander`). Every vehicle field
  (`stockSlots`/`passengerSlots`/`cargoGoods`/`logicSize`) now has a read view.
- **Landscape placement layer** (`systems/readviews/landscape.ts`, `landscapetypes.ini`): the full
  `allowedon{land,water,everything}` triple — `landLayerLandscape`/`isLandLayerType` (86 land types),
  `waterLayerLandscape`/`isWaterLayerType` (the 3 wall/gate structures spanning water),
  `universalLayerLandscape`/`isUniversalLayerType` (the single layer-agnostic `void`), read straight off
  the genuinely-extracted ints (`walkable`/`buildable` are schema defaults, not these flags);
  land(86)+universal(1) partition the 87 rows exactly. This is the placement-side seed — distinct from
  water-VALENCY terrain (which cells are water — map-decode-blocked, the water surface lives in the
  triangle/terrain grid, not a `landscapetypes.ini` flag).
- **Animals** (`systems/readviews/`, `animaltypes.ini`): `herdParams`/`locomotionOf`
  (`movespeed`/`runspeed`); `animalHitpoints` + `animalBabyHitpoints` (the `hitpoints_adult`/
  `hitpoints_baby` life-stage pools, e.g. wolf baby 500 vs adult 1000); `isWarrantableAnimal`
  (livestock-ownership, 20/35) + `ignoresHousesAnimal` (pathing-through-buildings, 1/35) — which
  **closes the animal-record consumer coverage: every extracted `animaltypes.ini` field now has a sim
  read view** (the behaviours they seed stay deferred).

## Phase 2 / render-ladder / Cross-cutting-DX sweep — 2026-06-30 (third doc-bloat pass)
Verbatim trails for items that landed during the building-bob render run; swept out of the live
ROADMAP so the current target stays legible. The collapsed live ROADMAP keeps a one-line summary +
the unchecked next steps; the full clean-room evidence is below.

### Phase 2 — Resource/tree bob + animation ranges + building bob bound (the `Bind a REAL decoded bob atlas` children)
  - [x] **Resource/tree bob bound** — `landscapes.cif` `[GfxLandscape]` → `ls_trees.bmd` via
        `extractLandscapeGraphics`, emitted through the existing `convertBmdTree`, drawn under `?atlas=real`
        as a per-kind `SpriteSheet.kindLayers` layer (the woodcutter's wood node is now a real tree, not a
        green box). Commits `e663e71` + `42b0b1a`; deviation (species/frame pick) in docs/FIDELITY.md.
  - [x] **Animation ranges from data, not magic numbers** — `extractBobSequences` reads
        `animations.ini`'s `[bobseq]` tables into the IR's `bobSequences` (15 sets / 359 sequences), and
        `?atlas=real` now derives the settler's walk/chop/carry `DirectionalAnim`s from them by sequence
        name (`stride = length / 8`) instead of hard-coded frame constants — `app/src/real-sprites.ts`
        `buildHumanBindings`/`directionalAnimFromSeq`. The extracted ranges match the old constants
        byte-for-byte (walk 1988/96, chop 5106/120, walk_wood 4580/96), kept as a graceful fallback for a
        checkout without `content/`. Render-taste tuning (which seq drives which state, the chop
        `phaseStart` windup, the single-frame idle hold) stays in code. Unit-tested; pixels still need the
        scene sign-off below.
  - [x] **Building bob bound** — the HQ now draws the decoded `ls_houses_viking.bmd` (palette `house01`,
        bob 11 — the viking home, a stone-and-thatch cottage) under `?atlas=real`, as a per-kind
        `SpriteSheet.kindLayers` layer like the tree (the same universal `.bmd`→atlas path; the bob layout
        is identical across all `.bmd`), down-scaled via `SpriteSheet.kindScales` (`BUILDING_SCALE` 0.7) so
        the native-oversized house reads in proportion with the native settler + tree. Render `building`
        binding + scale in `app/src/real-sprites.ts`; deviation (one frame for every type; render scale)
        in docs/FIDELITY.md.
    - [x] **Pipeline `extractBuildingGraphics` leg** — the mod's `[GfxHouse]` table
          (`budynki12/houses/houses.ini`) now emits every settlement house's `ls_houses_*.bmd` body → atlas
          (one binding per `GfxPalette` value, so a body's multiple skins all build), through the existing
          `convertBmdTree` like the landscape leg. So `npm run pipeline` reproducibly produces ALL house
          atlases — including the warehouse's `ls_houses_viking.house02` (the previously-missing asset),
          not just the one `house01` an agent had hand-built. Render-side per-`[GfxHouse]`-type frame
          selection (each building draws ITS house bob) **landed as rung 1 of the Render breadth ladder**
          below (single `ls_houses_viking.house01` family; the multi-`.bmd` generalisation is its remainder).

### Phase 2 — Render terrain from real landscape ground textures (full trail)
- [x] **Render terrain from real landscape ground textures** — **LANDED (approximated, behind `?terrain`).**
      The flat 4-colour `TILE_COLOURS` tint is replaced by real decoded `text_*.pcx` ground: the meadow grass
      + rock mountain textures now draw per cell (human pixel-check done — a real `?map=` shot shows grass +
      rock patches, not flat colour). **Placement is APPROXIMATED (a recorded deviation, docs/FIDELITY.md):
      the 1:1 pattern algorithm is oracle-blocked** (OpenVikings does not render terrain → no algorithm
      oracle; no `map.dat` lane holds a direct pattern id — the per-cell pattern is engine-computed from
      corner types + variant lanes), so every cell of a landscape family draws the SAME representative
      ground tile. Steps 1/2/4/5 done; step 3 (per-cell variety) deferred. **Known gap:** no map's `lmlt`
      decodes a water typeId, so water never shows (the water surface is map-decode-blocked, ROADMAP Phase 4
      Sea/Northland). Data model in docs/SOURCES.md "Terrain ground graphics + landscape objects".
  1. [x] **Pipeline — patterns + triangle types.** `extractPatterns`/`extractTrianglePatternTypes`
     (`decoders/ini.ts`) → zod `GfxPattern`/`TrianglePatternType` IR (`packages/data`), unit-tested. `id`
     is the **0-based position** in the `GfxPattern` list (no explicit id field — the extractor keeps every
     record so ids stay contiguous). Hands-on against the real game `.cif`: **927 patterns** (ids 0..926, 56
     textures, logicType ∈ {0..10}, 0 wrong-arity coords) + **10 triangle types** (NOT 82 — "82" was the
     decoded *string* count; SOURCES.md corrected), and **every `logicType ≠ 0` resolves** to a triangle
     `type` (the `logicType` cross-ref is sound). Faithful extraction (docs/FIDELITY.md "ground-graphics
     tables"); the 56 `text_*.pcx` already decode (pcx stage) — no new decoder. **Not yet wired into the
     ContentSet / `npm run pipeline` emit — that is step 2's "emit the table to IR".**
  2. [x] **Pipeline — typeId→pattern map (approximated).** `buildTerrainPatterns` (`decoders/ini.ts`) classifies
     each landscape typeId by name (`water`→water, `rock`/`stone`→mountain, else→land), binds it to ONE
     representative `GfxPattern` per family (shortest-seed-name pick: `water 01`/`meadow 01`/`mountain 01`) +
     the logic-type `debugColor`, emitted as the `TerrainPattern` IR (`ContentSet.terrainPatterns`) by `npm
     run pipeline`. Hands-on: **87 rows** (land 82 / water 1 / mountain 4). Approximation recorded in
     docs/FIDELITY.md. Commit `8960db6`.
  3. [ ] **Pipeline — per-cell variety (DEFERRED).** Use `lmpa`/`lmpb` (0..10) as a variant index into the
     type's pattern family; emit those lanes beside `typeIds`. Skipped for the MVP (uniform-per-type ships).
  4. [x] **Render — textured ground.** `terrain.ts` (pure UV/diamond geometry, unit-tested) + `pixi-renderer.ts`
     `buildTerrainLayer`: one **batched `Mesh` per texture page** (all same-page cells in one positions/uvs/
     indices buffer — far cheaper than the per-cell flat-diamond it replaces), the pattern's `GfxCoords`
     bbox → the tile's UV sub-rect, with a `debugColor` flat-diamond fallback for unbound cells. Commit
     `4c141bc`.
  5. [x] **App + shot.** `?terrain` flag (`real-terrain.ts` loads the table + `text_*.png` pages over new
     `/ir.json` + `/textures` vite routes), wired through `main.ts` + `shot.ts` + `npm run shot --terrain`.
     Human pixel-check **done** (a `wilczy_lad_sub` shot shows real grass + rock). The only 1:1 oracle is the
     running original game (a later human-driven calibration). Commit `4c141bc`.
  - **Open (deferred):** step 3 per-cell variety; water-surface cells (map-decode-blocked); caching the
    terrain mesh across frames (it rebuilds per frame like the rest of the scene — fine for the shot + the
    real maps, a live-perf optimization for the 640k-cell maps).

### Render breadth ladder — rung 1 (Buildings per-type frame selection) full trail
1. [x] **Buildings per-type frame selection** (render-only) — **LANDED (single-atlas family; human pixel
   sign-off ✓).** A building draw item now carries its `Building.buildingType`, and a
   `BuildingTypeBinding` (`byType: typeId→bob, default`) draws each viking type its OWN house bob — the
   `[GfxHouse]` `LogicType`→`GfxBobId` join (`real-sprites.ts` `VIKING_HOUSE01_BOBS`: home 41 / well 131 /
   hive 91 / farm 60 / bakery 105, transcribed from `houses.ini`), no longer the one bob 11 reused for all
   55 types. New `building-types` acceptance scene shows the five side by side; unit-tested + the table
   pinned. **Supersedes** the "Remaining" note on the Phase-2 *Building bob bound* item.
   - [x] **Extract the `(typeId→bob)` join into the IR** — `extractBuildingBobs` (`decoders/ini.ts`) reads
     each `[GfxHouse]`'s paired `LogicType <lvl> <typeId>` ⊗ `GfxBobId <lvl> <bobId>` level-tables (the same
     level pairing `extractConstructionCosts` uses) → the validated `BuildingBob` IR (`ContentSet.buildingBobs`,
     one row per `(tribeId, typeId, level, bmd, palette, bobId)`), emitted by `npm run pipeline`. The five
     lumped `[GfxHouse]` brackets (the saracen/egypt blocks pack 4–24 houses under one header) are split
     per-`EditName`, and the join is **multi-valued** by level/variant (wonders, wall orientations, HQ-vs-house) —
     the consumer disambiguates by `level`/`editName`. Hands-on over the real `houses.ini`: **336 rows / 234
     distinct (tribe, typeId) / 6 tribes / 17 palette skins**, reproducing the 5 transcribed `house01` mappings
     *exactly* (home `6`→41, well `10`→131, hive `11`→91, farm `12`→60, bakery `15`→105) **and** recovering the
     home growth chain (t2→bob1 … t6→bob41) the constant dropped. Faithful, data-pinned (docs/FIDELITY.md).
     Unit-tested; the sim ignores it (render-binding data, golden hash untouched). (`extractConstructionCosts`/
     `extractBuildingGraphics` share the same pre-existing lumping bug — a flagged follow-up.)
   - [x] **Render consumes the join (data-pinned end-to-end)** — `BuildingTypeBinding.byType` is now derived
     from the extracted `buildingBobs` table (`real-sprites.ts` `buildingBobsByType`: filtered to the loaded
     `(bmd, palette)` = `ls_houses_viking.bmd`/`house01`, highest-`level` row per typeId), **overlaid** onto
     the transcribed `VIKING_HOUSE01_BOBS` and fed through `buildHumanBindings` like `bodySequencesByName`
     feeds the walk/chop ranges — real data wins per type, the constant backs its five known types when the
     IR is partial/absent (graceful type-by-type degradation). Hands-on
     over the real regenerated `ir.json`: the data path reproduces the signed-off constant for typeIds
     6/10/11/12/15 **exactly** (so `?scene=building-types&atlas=real` renders identically) and additionally
     recovers the home (t2..t6 = typeIds 2..6 → 1/11/21/31/41) + bakery (14→101) growth-stage bobs the constant
     dropped. Unit-tested (`buildingBobsByType` reduction + the empty-map fallback); commit pins it.
   - **Remaining — multi-`.bmd`/palette per type (DESIGNED + decomposed; data scoped, see SOURCES.md
     "Building graphics families").** Investigation settled the shape: the render's `building` kind binds ONE
     atlas layer (`ls_houses_viking.house01`), but viking buildings span **6+ `.bmd`s** (`ls_houses_viking`,
     `viking2/3/4`, `frank_well_hive`, `frank_mill`, `f_*`) × **multiple palettes each** (every `(bmd,palette)`
     is its own decoded PNG), and **`(tribe,typeId)` is NOT unique** (viking typeId 10 = well in `house01`,
     other bobs in `house02`/`dungeon01`), so the join needs an `editName`-keyed disambiguation, not just
     highest-level. The real viking **HQ (typeId 1) is `ls_houses_viking4.bmd` bob 34** ("viking headquarters"),
     a different atlas than the one loaded. Ordered sub-steps (each its own `/iterate`):
     1. [x] **Render — layer-aware building binding** (render-only, no visual change) — **LANDED.**
        `BuildingTypeBinding.byType`/`default` are now `BuildingBobRef` (`number | {layer, bob}`); a pure
        `resolveBuildingDraw(binding,item) → {bob, layer?}` (`sprites.ts`) unwraps them (a plain id → no
        layer = the default building layer; a `{layer, bob}` carries its family name). `SpriteSheet` gained
        `families` (name→`SpriteLayer`) + `familyScales`, and `atlasLayers` (`pixi-renderer.ts`) blits a
        layer-qualified building from its named family's own source/atlas/scale — falling through to the
        single `kindLayers.building` path for a plain ref or an unloaded family, so a sheet without
        `families` is byte-identical (the app still emits plain-number bindings; the synthetic-atlas shot is
        unchanged). Unit-tested (7 `resolveBuildingDraw` cases). No app/scene change yet.
     2. [x] **App — canonical (family,bob) reducer + load viking atlases + draw the real HQ.** The
        data-driven reducer + the FIRST viking family **LANDED (human pixel sign-off ✓).**
        `real-sprites.ts` `buildingBobRefsByType` picks the canonical `(bmd,palette,bob)` per (viking,
        typeId) across ALL viking families — palette-preference → `editName` disambiguation (HQ →
        `ls_houses_viking4.bmd` bob 34 "viking headquarters", not bob 44 "…house") → max-level → lowest-bob
        — emitting a **bare id** for the default `ls_houses_viking.house01` layer or a **layer-qualified
        `{layer,bob}`** for a LOADED named family; a row whose family is NOT loaded is **dropped** (it falls
        back to the default house, never a wrong bob borrowed from the default layer). `loadHumanSpriteSheet`
        loads the `ls_houses_viking4.house01` family into `SpriteSheet.families`, lighting up the **HQ** +
        animal farm / druid hut / barracks / tower (bobs 34/30/5/10/25/15/20, verified over the real
        `ir.json`); the `building-types` scene gains the HQ — laid out in two screen rows (large back row,
        small front row) so the big iso sprites don't overlap. Unit-tested; the default house01 types are
        unchanged. Human confirmed the six distinct buildings (incl. the HQ as an imposing structure) on
        screen.

### Render breadth ladder — rung 2 (Resource nodes by goodType + loose piles/flags) full trail
Two rung-2 bullets landed together as **Step 2 of the gathering-economy plan** (`docs/plans/gathering-economy.md`).
- [x] **Resource nodes by goodType** — every gatherable good draws its OWN decoded standing node instead of
  the one hardcoded yew: a `ResourceTypeBinding {byGood, default}` (mirrors `BuildingTypeBinding`) resolves a
  node's `Resource.goodType` (read into the `DrawItem` by `scene.ts` `classify`/`collectSprites`) through
  `resolveResourceDraw` — a bare bob from the default yew `kindLayers.resource` layer, or a layer-qualified
  `{layer,bob}` into a loaded `ls_ground`/`ls_mushrooms` family. Built from the Step-1 `gatheringPipeline`
  join (`resource-gfx.ts` `buildResourceBinding`), matched to each run good by id-SLUG so a scene's own
  goodType numbering resolves the right real object. Wood→"yew 01" bob 60 (reproduces the prior look),
  stone→"stones 01 khaki" (`ls_ground.rock03`), clay/iron/gold→"…mine 01" (`ls_ground.clay01/iron01/gold01`),
  mushroom→"…agaric 01" (`ls_mushrooms.flower01`).
- [x] **Loose ground piles + flags rendering** — a bare `Stockpile+Position` (previously `classify`→null →
  invisible) is a new `'stockpile'` `DrawKind`: a HELD pile draws its dominant good's `ls_goods.<good>` heap
  via a `StockpileBinding {byGood, flag, default}` indexed by the pile's fill amount (5 fill states, growing
  small→full), an EMPTY pile draws the `ls_temp.human_player01` delivery flag. `resolveStockpileDraw` +
  `buildStockpileBinding`; a stockpile never falls through to the body atlas (it draws only from a loaded
  family, else the placeholder heap).
- **Reused the building `families` mechanism:** the GPU `layeredLayerFor` (generalized from `buildingLayerFor`)
  resolves building/resource/stockpile layer-qualified refs identically; the needed atlases (`ls_ground`/
  `ls_goods`/`ls_mushrooms`/`ls_temp` skins) are derived from the join at load time (`gatheringAtlasStems`),
  loaded best-effort, and only a LOADED family is ever bound (drop-unloaded — no wrong-bob borrow), exactly
  the building-family contract.
- **Verification:** `npm test` (1328, +29: render `scene`/`sprites` classify+resolver units, app
  `resource-gfx` reducer units, `gathering-render` scene units) + `npm run check` + `npm run build` green;
  **no sim change → goldens byte-identical**. Acceptance scene `?scene=gathering` (one node per good + wood/
  stone piles at fills 1/3/5 + a flag); headless half asserts the classify + per-good binding resolution.
  Hands-on: pipeline regenerated (11 gathering pipelines; all stages resolve to real gfx records). Pixel
  sign-off (each node distinct, piles look like that good and grow, flag reads as a flag) is the human's
  call — docs/FIDELITY.md "Gathering-economy graphics" records the representative-pick / fill-map /
  single-player-flag approximations. **Deferred to later gathering steps:** per-object species variety +
  node shrink-by-remaining (Step 4), produced-good piles, per-owner flag colour.

### Cross-cutting DX — Web Worker / time-travel inspector / content hot-reload (full trails)
- [ ] **Run the sim in a Web Worker.** It's pure/headless/deterministic, so moving `step()` off the
      main thread keeps render at 60fps under heavy ticks. Design the Phase-2 snapshot as a plain
      **transferable** structure (no class instances / live `Map`s) so this is free later, not a retrofit.
      **Transferability now PINNED** (`test/inspect/snapshot-transferable.test.ts`): the load-bearing
      precondition — that a real `step()`-driven `WorldSnapshot` survives the `postMessage` boundary —
      is proven against the actual structured-clone algorithm, not just asserted in the docstring. A
      live run's snapshot `structuredClone()`s without throwing (a function / class instance / live
      `Map` would raise `DataCloneError`), round-trips deep-equal AND byte-identical via `JSON.stringify`
      (lossless transfer), deep-copies without aliasing the sim's live state (a worker owns its copy),
      and a building's `Stockpile` `Map` is confirmed lowered by `takeSnapshot` to a clone-safe sorted
      `[k,v]` array. **Open:** the app-side Worker wiring itself (host ↔ worker `postMessage` protocol,
      render reading the transferred snapshot) — an `app`/`render` concern, not headless-verifiable.
- [ ] **Time-travel / replay inspector.** With `rng.getState/setState`, the command log, and
      `hashState`, a dev overlay can scrub ticks, diff state between two ticks, and dump an entity.
      "Hash diverged at tick 432" → jump there → inspect. Biggest debuggability multiplier for agents.
      **Headless core landed** (`packages/sim/src/replay.ts`): a pure `replay({content,seed,map?,log,untilTick?})`
      reconstructs the exact state at any tick by re-applying the command log into a fresh sim — the
      "jump to tick N" primitive (scrub backward past later commands = the live state AT tick N;
      run past the last command = the deterministic tail). Its oracle is `hashState()` byte-equality
      with the original run at every tick (`test/replay/replay.test.ts`; hands-on: a 1000-tick command-driven
      run replayed bit-for-bit at 4 scrub points, and state created OUTSIDE the command seam correctly
      does NOT reconstruct — replay rebuilds command-driven state only). Single-world constraint: the
      replayed sim supersedes the original (component stores are shared singletons — docs/LESSONS.md
      [56e8d3e]). The **per-tick hash/snapshot ring buffer** that feeds it is also landed
      (`packages/sim/src/hashtrace.ts`): a pure, bounded `HashTrace` records `{tick, hash, snapshot?}`
      during a live run (a large cheap hash window + a smaller recent-snapshot window, oldest dropped
      when full) and `divergedFrom(other)` localizes the FIRST tick two runs' hashes split — "hash
      diverged at tick N" computed WITHOUT re-replaying (hands-on: a 200-tick live run recorded, a
      2000-tick run capped at 500 held exactly the most-recent 500, a different-seed run localized to
      tick 1). It is a passive recorder the caller drives (it deliberately does NOT hook `step()`), so
      the inspector is opt-in and can't perturb the golden hashes. The **"diff state between two ticks"**
      half is also landed (`packages/sim/src/snapshot-diff.ts`): a pure `diffSnapshots(a,b)` merge-joins
      two plain `WorldSnapshot`s into a per-entity / per-component delta (entities added/removed, and for
      survivors the components added/removed/changed with before/after), canonical-JSON equality mirroring
      `hashState()` so "diverged" agrees with the hash, output ascending-id / sorted-name without a
      re-sort (hands-on: a real `step()`-run diffed tick 2→8 surfaced the spawned woodcutter as the lone
      `added` entity with its `Position`+`Settler` components, byte-identically re-diffable). The
      **"dump an entity"** half is also landed (`packages/sim/src/entity-dump.ts`): a pure
      `dumpEntity(snapshot,id)` binary-searches the canonical entity list for ONE entity's full component
      view at a tick (null when absent), and `traceEntity(snapshots,id)` follows that entity across a tick
      window — per step its alive flag, components, the spawn/despawn life-edge, and (on a survivor
      transition) its per-component `changes`, reusing the same canonical-JSON comparison as
      `diffSnapshots` so an entity's per-tick delta equals its slice of the full two-tick diff (hands-on: a
      real 8-tick run dumped the spawned woodcutter's `Position`+`Settler` block and traced it absent→
      SPAWNED@3→`Settler:changed` per tick, byte-identically re-traceable). The **end-to-end composition**
      is also landed (`packages/sim/src/localize-divergence.ts`): a `localizeDivergence(runA,traceA,runB,
      traceB)` wires the four primitives into the inspector's documented workflow — `HashTrace.divergedFrom`
      finds the first split tick WITHOUT re-replaying, then `replay()`s BOTH runs to that tick (serially,
      respecting the single-world shared-store constraint — A snapshot, clear, B snapshot) and
      `diffSnapshots()` the two states, returning `{tick,hashA,hashB,diff}` (or `null` when the traces'
      overlap agrees). Self-verifiable headlessly (hands-on: two runs differing by one tick-7
      `spawnSettler` localized to tick 7 with the carpenter as the lone `added` entity, byte-equal to a
      hand-replayed `diffSnapshots`; identical runs → `null`). The **single-run "free scrubbing"**
      composition is also landed (`packages/sim/src/scrub-window.ts`): a `scrubWindow(run,fromTick,toTick)`
      reconstructs a CONTIGUOUS window of plain `WorldSnapshot`s from one command log in a single forward
      pass (replay once, enqueue each logged command on its recorded tick, snapshot the in-window ticks —
      byte-identical to N separate `replay()`s but O(toTick), not O(window×toTick)), ready to feed
      `traceEntity()` (the whole window) and `diffSnapshots()` (adjacent pairs); it clamps `fromTick` to 1
      (tick 0 is the un-snapshotted initial state), yields `[]` on an empty window, throws on a negative
      target, and steps the deterministic tail past the last command. Self-verifiable headlessly (hands-on:
      a 30-tick run scrubbed `[4..8]`, the carpenter traced absent→SPAWNED@6, the 5→6 step diffed to the
      lone added settler, and both an in-window tick and a tail tick byte-equalled an independent `replay()`).
      **Open:** the dev OVERLAY that wires scrub/diff/dump into UI (a `render` concern, human-eyed) — it
      calls `localizeDivergence()` for the "diverged at N → inspect" path and `scrubWindow()`+`traceEntity()`
      for free scrubbing.
- [ ] **Content hot-reload.** Content is validated JSON injected into the sim; wire Vite HMR to
      re-parse and rebase the sim on file change → instant balance-tweak feedback, no rebuild.
      **Headless core landed** (`packages/sim/src/rebase-content.ts`): a pure `rebaseContent(rawContent,
      {seed,map?,log,untilTick?})` validates a freshly-read RAW content blob through the data package's
      `parseContentSet` (zod schema + cross-reference pass) and, if valid, REBASES the run onto it by
      replaying the command log into a fresh `Simulation` built with the NEW `ContentSet` — so the
      rebuilt run carries the same player history forward under the new rules. Bad content is an
      EXPECTED boundary failure (a half-saved file), so it returns a typed `{kind:'error',message}`
      WITHOUT touching the shared stores — the live sim is undisturbed (CLAUDE.md "throw for bugs,
      return for expected failures"). It rebuilds rather than swapping `content` in place because a
      mid-run state is the product of every past tick's content, so only a full replay yields a state a
      clean run could also reach (determinism). Two oracles, both self-verifiable headlessly (hands-on:
      a real 60-tick `step()` run rebased onto IDENTICAL content reproduced its hash bit-for-bit;
      rebased onto an HQ-starting-wood edit `10→42` reached a DIFFERENT hash at the same tick and
      carried the new datum; rebased BACK to the original restored the original hash exactly — the
      reload is reversible; a malformed `typeId` returned `error` and built nothing). **Open:** the
      Vite-HMR glue that watches the content file and calls this on change (a `render`/`app` concern,
      not headless-verifiable) — and a FUTURE-ticks-only reload policy (apply new content without a
      replay), an app-layer choice on top of this primitive.
