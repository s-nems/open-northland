# In-game UI visual foundation — approved style reference

**Status:** approved as the shared visual direction: the frozen HUD layout of the wireframe with the
B · Leśny łupek slate base and the wood, bronze and parchment chrome of study 05. Runtime primitives
and production art exports remain ticket 01 work. Individual panel contents still require their own
detailed design review; the construction and selection panels shown here are illustrative.

The reference is [foundation.html](foundation.html) with `foundation.css` and `foundation.js`. It is
a single flattened stylesheet: later panel mockups extend it instead of layering overrides. The
tokens below are the shared language for every screen, including a future main-menu redesign.

## Tokens

| Role | Token | Value |
| --- | --- | --- |
| Deep shadow / dark HUD surface | `--deep` / `--fill` | `#182521` / `#273832` |
| Wood rails (mid / light / dark) | `--wood` / `--wood-hi` / `--wood-lo` | `#4d3b28` / `#7a5f40` / `#2b2117` |
| Bronze fittings (mid / light / dark) | `--bronze` / `--bronze-hi` / `--bronze-lo` | `#c9a262` / `#efd28f` / `#7a5a2f` |
| Parchment (mid / light / dark) | `--parchment` / `--parchment-hi` / `--parchment-lo` | `#d9c9a4` / `#ebdfc0` / `#b8a77f` |
| Ink on parchment (primary / secondary) | `--ink` / `--ink-muted` | `#2b2317` / `#5c4c37` |
| Text on dark (body / emphasis / secondary) | `--text` / `--text-hi` / `--muted` | `#f0e6cf` / `#f6ecd4` / `#c1baa8` |
| Selected action | `--active` | `#e3b868` |
| Good / warning / danger text on dark | `--ok` / `--warning` / `--danger` | `#afc594` / `#efbe70` / `#eda08d` |
| Wax seals: fine / attention / urgent | `--wax-ok` / `--wax-warn` / `--wax-danger` | `#6f8f5a` / `#c98a3a` / `#a8412f` |
| Error on parchment | `--paper-error` | `#783321` |
| Keyboard focus | `--focus` | `#f3e3bb` |

Nominal contrast of the solid pairs: `--text` on `--fill` 10.0:1, `--muted` 6.4:1, `--ink` on
`--parchment` 9.5:1, `--ink-muted` 5.0:1, `--paper-error` 5.6:1. Solid-token ratios do not certify textured or translucent
pixels; inspect overlays against both terrain variants. Amber marks selected actions and warnings;
ordinary text is neutral. Warnings also state the problem in words, and wax seals carry accessible
labels, so colour is never the only carrier of state.

## Materials and chrome

- Persistent HUD regions are dark slate over the subtle leather texture of `nordic-surface-v1.png`;
  its carved top band is the beam under the bottom navigation.
- Large windows have 7 px wood-gradient rails, a bronze inner hairline, knot-work corner ornaments
  and a bronze knot at the top centre. Minor controls use thinner edges. Close buttons, the message
  count, the game menu and the settler level are bronze medallions.
- Catalogue interiors are parchment with a faint SVG grain. Entries look like permits: parchment
  cards, ink text, cost chips, a wax check on the selected card, a lock badge on locked entries.
- Bottom navigation: seven bronze medallions on the carved beam, persistent labels, hotkey badge
  1–7, lit medallion and marker for the active entry.
- Top bar: one beam carrying population symbols, goods counters, the simulation clock, the segmented
  pause / ×1 / ×3 control and the menu medallion. Categories reveal a parchment breakdown on
  hover/focus with dotted leaders.
- Notifications are frameless cards down the left edge with the settler on a translucent backing, a
  wax seal in the bottom-right corner for priority and a go-to chevron on hover. The count and three
  seal filters sit above the list.
- Selection details use ledger rows with dotted leaders, small-caps section titles with rules,
  quarter ticks on meters and icon buttons for orders.
- The placement bar under the catalogue is an interaction proposal for the construction ticket. The
  digit badges on the beam are dropped: digits 1-9 and 0 are the control-group keys, so the runtime
  beam carries no digit hotkeys.

## Components and geometry

Alegreya Sans carries information; Almendra SC (Google Fonts, Cinzel fallback) is for short window
titles only. Body copy uses 14 design px, compact metadata 12 px, beam labels 11 px, window titles
25 px (selection 20 px). Pointer targets are at least 36 px; spacing follows 4 px. The compact notification filters
are an explicit 26 px exception in this mouse/keyboard study.

- Main action art: 36 px; resource art: 29 px; gallery art: 44 px.
- Bottom actions: 56 × 64 px on a 44 px medallion, with persistent labels and a selected marker.
- Construction: 540 px wide, content-sized rather than filling the screen vertically.
- Selection placeholder: 318 px; its contents await the separate panel ticket.
- Notifications: 198 px, no opaque background in unused column space.
- Minimap: 270 × 214 px, touching the bottom-left corner.

At 125% the catalogue scrolls within available height to avoid bottom navigation. The intended minimum
is 1280 × 720 at 90%; a 90–130% range in 5% steps remains proposed, not a verified runtime capability.
The preview offers 90/100/125%, light/dark terrain and selected long English labels, not a full translation.

Hover lifts action art and medallions slightly; selection adds the lit rim and marker. Disabled
catalogue entries keep readable requirements with faded art. Reduced-motion suppresses transitions
and the walk loop. Escape/close hides construction; Buduj restores it.

## HUD shell

The runtime shell (ticket 02) places the regions on the DOM plane in design px and keeps the legacy
Pixi panels behind the new navigation until their owner tickets replace them.

| Region | Placement | Content today |
| --- | --- | --- |
| Navigation beam | bottom centre, 420 × 72, seven 56 × 64 actions | Buduj, Mieszkańcy, Asystent, Statystyki, Misja, Dyplomacja, Wiedza |
| System bar | top right, flush with both edges | pause / ×1 / ×2 / ×3 segments, menu medallion; counters and clock come with ticket 04 |
| Notifications | left 10, top 18, width 198, ends above the minimap | count medallion and three seal filters; the legacy note row stays along the top edge until ticket 03 |
| Central window | between the left column and the selection panel, top 96, floor at the beam | one legacy window at a time, centred in the region; Mieszkańcy and Wiedza show a framed pending note |
| Selection | bottom right, legacy 322 px panel | lifts above the beam when the beam reaches under it (viewport narrower than 1076 design px) |
| Minimap | bottom left, legacy 224 × 200 | unchanged until ticket 19 |

Rules the shell enforces:

- One central window at a time. A beam entry closes the other window and toggles its own; the same
  entry pressed again closes it. Buduj, Asystent and Misja drop a held placement or paper first;
  Statystyki, Dyplomacja, Mieszkańcy and Wiedza leave a running placement alone.
- Esc steps back one level per press: a held placement or paper, then the open central window, then
  the unit controls' own ladder (job list, armed order, selection). The shell handles Esc before the
  other listeners and stops it once it consumed the press.
- Closing with Esc or the close medallion returns keyboard focus to the beam entry that owns the
  window. Only the mission sheet and the system menu hold the simulation paused; other windows never
  touch the pause.
- A wheel over a DOM region never reaches the camera, and the edge pan pauses while the pointer is
  over one. Presses on a region never reach the map; presses on the map keep the window open and
  select independently, with the details panel in its own corner.
- A legacy window that cannot fit above the beam shortens its list or lifts toward the top bar; a
  window wider than the region centres on the screen and yields to the minimap as before.

## Confirmed imagery

- Notifications and selected-settler details use the full game character, appearance/equipment and
  current activity animation with a transparent sprite. Notifications give it a subtle translucent
  backing; selection details use a dedicated framed background. Separate painted face portraits are
  rejected.
- The preview samples existing game character atlases. Walking is a demonstrative clip, not a live
  reading of the named settler's activity. Runtime must bind the real subject, handle pause, reduced
  motion and removed targets, and animate only visible previews.
- Residents navigation uses stylized wooden figures, not realistic faces. Top population counters
  use compact female/male/child symbols. Goods reuse the active game's art.
- Construction must display the actual game building. The current catalogue uses vector mock
  thumbnails. Character and building artwork is not redesigned here.
- Runtime UI must support both original and own asset sets; decoded original data stays outside Git.

## Original art and remaining work

The painted action icons and the surface texture are the `ui/foundation` art package
([recipe](../../art/ui/foundation/asset.json), [package notes](../../art/ui/foundation/README.md)):
the 4 × 2 atlas `nordic-icons-v4.png` of simple single-object icons, the game-menu sheet
`nordic-menu-v1.png` (its oak door is the menu medallion) and the carved wood/leather material study
`nordic-surface-v1.png`, each with its generation record. The reference page samples the masters
directly; the runtime uses the package's delivered atlas and texture. The atlas's pawn and door cells and
the sheet's other candidates are unused.

No original game UI art is copied. Ticket 01 remains open for shared runtime primitives. Panel
contents and illustrative counts are not production specifications.

## Resume the local review

Continue in `~/Projects/vikings/on-ingame-ui`, branch `design/ingame-ui`. Serve the
reference with

```sh
node docs/design/ingame-menu/serve.mjs 5188 /private/tmp/ingame-foundation
```

and open `http://127.0.0.1:5188/`. The server reads repository files first and falls back to the
local review directory for fonts, `world.png` and the decoded review inputs, so nothing is copied
into the temporary directory. Do not use `python3 -m http.server`: it drops parallel connections on
this page and previews load randomly. `index.html` in the repository is the architecture wireframe,
not this visual reference.

Local-only review inputs in `/private/tmp/ingame-foundation` (never add these to Git):

- `alegreya-400/500/700.woff2`, `alegreya-latinext-400/500/700.woff2`, `cinzel.woff2`, `cinzel-latinext.woff2`: the
  review fonts, copies of the runtime subsets in `packages/app/public/fonts/`; the repository page falls back to
  system fonts without them, and without the Latin Extended files Polish diacritics fall back alone.
- `world.png`: existing map capture; preserve it while the temporary directory exists.
- `review-characters/ir.json`: copy of the primary checkout's generated `content/ir.json`.
- `review-characters/`: original `content/bobs/cr_hum_{body_00,head_00,body_10,head_10}.test_human_00`
  PNG/atlas.json pairs. The preview reads tribe 1 jobs 6 and 5, compositing body/head with authored offsets.
- `review-goods/manifest.json`: `content/goods/manifest.json`; bread, wood, sword, shoes and crockery
  `ls_goods.goods_*` PNG/atlas.json pairs from `content/bobs/`.

If the temporary directory is lost, restore these from the primary checkout's generated content,
and use the mockup's terrain fallback until a fresh permitted local world capture is available.
Missing original assets are reported below the preview; do not mistake empty canvases for success.
