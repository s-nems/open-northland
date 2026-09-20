# In-game UI visual foundation: approved style reference

**Status:** approved as the shared visual direction: the frozen HUD layout of the wireframe with the
B · Leśny łupek slate base and the wood, bronze and parchment chrome of study 05. The runtime
primitives live in `packages/app/src/hud/dom/` and the production art in the published `ui/foundation`
package. Individual panel contents still require their own detailed design review; the selection panel
shown here is illustrative, the construction window is the accepted design (rules below).

The reference is [foundation.html](foundation.html) with `foundation.css` and `foundation.js`. It is
a single flattened stylesheet: later panel mockups extend it instead of layering overrides. Where a
rule below differs from the mockup (a change accepted on the running game), the rule wins. The
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
  cards, ink text, cost slots with a corner badge, a lit rim on the card last picked, a lock badge on
  locked entries.
- Bottom navigation: seven bronze medallions on the carved beam, persistent labels, hotkey badge
  1–7, lit medallion and marker for the active entry.
- Top bar: one beam carrying population symbols, goods counters, the simulation clock, the segmented
  pause / ×1 / ×3 control and the menu medallion. Categories reveal a parchment breakdown on
  hover/focus with dotted leaders.
- Notifications are frameless cards down the left edge with the settler on a translucent backing, a
  wax seal on the thumbnail's corner for priority and a go-to chevron on hover. Three seal filters
  above the list carry the tally of each weight.
- Selection details use ledger rows with dotted leaders, small-caps section titles with rules,
  quarter ticks on meters and icon buttons for orders.
- A held building or paper shows as a dark strip at the head of the central region, not inside the
  window (the window is away while placing). The digit badges on the beam are dropped: digits 1-9 and 0
  are the control-group keys, so the runtime beam carries no digit hotkeys.

## Components and geometry

Alegreya Sans carries information; Cinzel, the main menu's display face, is for short window
titles only. Body copy uses 14 design px, compact metadata 12 px, beam labels 11 px, window titles
25 px (selection 20 px). Pointer targets are at least 36 px; spacing follows 4 px. The 32 px notification
filters are an explicit exception in this mouse/keyboard study.

- Main action art: 36 px; resource art: 29 px; gallery art: 44 px.
- Bottom actions: 56 × 64 px on a 44 px medallion, with persistent labels and a selected marker.
- Construction: 640 px wide, so the widest bill in the content (eight goods) sits in one row on a
  card (user rule); content-sized rather than filling the screen vertically; the catalogue scrolls
  inside it once the window would reach the beam.
- Selection placeholder: 318 px; its contents await the separate panel ticket.
- Notifications: 160 px, no opaque background in unused column space.
- Minimap: 270 × 214 px, touching the bottom-left corner.

At 125% the catalogue scrolls within available height to avoid bottom navigation. The intended minimum
is 1280 × 720 at 90%; a 90–130% range in 5% steps remains proposed, not a verified runtime capability.
The preview offers 90/100/125%, light/dark terrain and selected long English labels, not a full translation.

Hover lifts action art and medallions slightly; selection adds the lit rim and marker. Disabled
catalogue entries keep readable requirements with faded art. Reduced-motion suppresses transitions
and the walk loop. Escape/close hides construction; Buduj restores it.

### Construction window

The window (ticket 05) replaces the legacy tabbed list on the DOM plane; the sim's commands stay as
they were.

- Head: the painted build icon and the title alone, no subtitle. The quick row holds Droga, Palisada
  and Brama as line glyphs of their own: a cobbled track bending away, a stake fence, a gate between
  two stakes (no highway markings, no battlements: user rule); disabled with the tooltip "Niedostępne w tej wersji gry" until the sim has a road, wall
  and gate command, and Papiery at the right with a count of the plans a pick could spend. Papiery
  lights like a tab and turns the same window to its papers page; the page's one "‹ Katalog" tab
  turns it back.
- Tabs: the original's five categories (Wszystko, Praca, Magazyn, Dom, Wojsko; tower and training
  fold into Wojsko), each counting the entries buildable now. At the tabs' right end a two-button
  toggle switches the catalogue between tiles and a list; the choice is one for both pages and is
  remembered for the game, with the page, the tab, the scroll and the last pick, in the tool-window
  state (never browser storage).
- Entries: every house kind the content has, minus vehicles, wonders and types with no construction
  cost (the headquarters stands from the map, the wall segment comes from the wall tool). A type the
  map or the tribe bans is never listed; an undiscovered one is listed after the open entries under a
  "Zablokowane" note with their count, faded, with a lock badge, its "?" still live. No requirement
  text on the card or under the note (user rule): the "?" page is where the discoveries are read.
  With nothing to list at all the parchment says "Nic do zbudowania" (a banned map, a spectator seat).
- A card is one fixed size in both views (120 px tile, 36 px list row), so the grid stays symmetric
  and the "?" medallion sits at the same bottom-right spot of every card. The picture is the finished
  body the map draws for the seat's tribe, cut from the loaded sheet into the card's own canvas,
  contained whole in a 72 px box (a tower stands small rather than cropped). A card without a sheet
  frame shows the house glyph. The name wraps to two lines; the cost sits under it
  as one slot per good, the amount as a corner badge, in one row: the window is wide enough for the
  widest bill in the content, and the plane scales as a whole, so no UI scale wraps it. A slot the seat cannot
  cover from its stock is marked red with "masz N z M" in its tooltip; it is information only, since
  placement never checks stock (the original neither) and the builders wait for the goods. No worker,
  product or capacity text on the card: that is Knowledge's.
- Cost is the from-scratch bill the sim charges (`constructionBillForType`): a leveled tier sums
  its whole chain down to the base, since the site is placed at that tier from nothing.
- Every good icon on the DOM plane (the cost slots, the summary counters) comes from the asset set the
  map draws with: the original pile atlas under the original set, the project's own art under the own
  set with the original's frame where the project has none yet. The two sets never mix on one screen.
- A pick hides the window and starts the placement with the strip up; Esc, the right button or Buduj
  bring the window back as it was, the picked card lit and focused. A site that lands leaves the
  window away, and so does an informational window opened over the placement (one window at a
  time): its cancel then returns to no window, and Buduj reopens the catalogue as it was.
- The "?" opens the building's Knowledge page; until the knowledge ticket it opens the pending note.

### Papers page

The plans the seat found in chests, inside the construction window (ticket 06); the chest window
keeps the assistant alone.

- Only the three placing kinds are listed (a named house, a named house with its store filled, a
  house of the player's choice), under a "Plany budowy" note with their count. The other four kinds
  of the engine's table (the indulgence, the build, learn and produce permits) are not listed: a
  click on them does nothing in the original, and no chest or map hands them out. With
  nothing to list the parchment says "Brak papierów" and where papers come from.
- A plan is a card in the building card's frame: the named house's picture (the house glyph for a
  place-any plan), the paper's name from the original's `misclogic` table, and under it what
  spending it does. Alike plans fold into one card with a "×N" tally at the card's corner (inline
  in the list row). A named house's "?" opens its Knowledge page; a place-any plan has none.
- A named house's card starts the placement at once, the window hidden and the strip reading "z
  planu: wskaż miejsce, budynek stanie gotowy"; Esc or the right button bring the papers page back.
  The plan leaves the list only when the house lands: the sim spends it after every gate has passed.
  The card is always live: the plan authorizes its house past the technology gate in the original
  (its selection window lists the named house without it) and past the map's ban too in the sim.
- A place-any plan turns the window to the catalogue with the plan in hand: the strip sits above the
  open window ("Plan budowy · wybierz budynek z okna"), the next pick spends it, and Esc, the right
  button, a world click or closing the window drop it back into the list unspent. The plan pays for
  the house and lifts no technology lock: the original's selection window keeps its gates for this
  kind too. A cancelled placement from a place-any plan hands the plan back into the hand with the
  catalogue, so a second Esc drops it: one rung per press.

### Residents window

The seat's people as one list (ticket 07), in the construction window's frame and width. Mieszkańcy
on the beam or F7, the original's subjects-window key, opens it at once; F7 is fixed, since the
F-row is outside the rebindable set, and works from inside the search field too.

- Listed: the local seat's humans. Animals, vehicles and other seats' people stay out. The list
  follows the tick while it is open and costs nothing closed: one walk over the snapshot's actors.
- The find row: a search over name, profession and workplace at once ("piek" finds the bakers and
  the bakery's crew), a Zawód list of the professions present with their head counts, and a Może
  zostać list of the picker's trades, which keeps the holders of the trade and the grown men the sim
  would let take it (`Simulation.canChooseJob`, asked only while that filter is set; a script's
  trade lock on a unit is not mirrored).
- Two chip rows share one grid of eight equal rectangular cells across the window, the count on top
  and the caption under it, "Kto" and "Bez" in one narrow label column. A count narrows to the
  other filters (user ruling): a cell counts what its own pick would list, so a Kto cell swaps the
  group and a Bez cell adds its lack to the picked ones, and the Zawód list counts the same way. A
  cell at zero is dimmed.
- Kto is one choice at a time (user ruling): Wszyscy, Mężczyźni, Kobiety, Dzieci, Pracownicy,
  Cywile, Żołnierze, Bohaterowie. The groups follow the original subjects window: men and women are
  adults, heroines stay out of the women, workers are adult men with a trade that is no soldier or
  hero class. Cywile, adult men without a trade, is this project's addition: they are whom the player
  opens the list to find.
- Bez combines, and combines with everything else (user ruling): domu, pracy, narzędzi, butów, pary,
  dzieci, broni, miodu. Home and partner skip soldiers and heroes, children counts the women, weapon
  the soldiers. The worn lacks (tools, shoes, weapon, mead) ask only a man whose equipment may
  change, the sim's `mayChangeEquipment`: a woman, a child and a hero wear nothing the player hands
  out, so the settler panel shows a woman and a child no Ekwipunek section either, nor a
  Doświadczenie section, since they hold no trade to train in. Tools counts the workers other than
  the scout, which is narrower than the original's every grown man who is no soldier or hero: it is
  whom the assistant hands a tool. A child lacks nothing: it is housed and dressed through its
  parents. Two lacks are this project's own. "Bez pracy" is a worker whose trade some workplace
  employs, posted at none and tied to no work flag, so a builder or a scout never shows; it replaces
  a separate roster of unposted tradesmen. "Bez miodu" is such a man with a job and no mead bottle
  in the misc slots: the people the assistant's mead grant reaches. Approximation: the sim tracks a
  couple's one growing child, so "bez dzieci" means none growing now, not a family history.
- The parchment: a summary line naming the active filters with "Wyczyść filtry", sortable column
  heads (Imię, Zawód, Miejsce pracy, Braki; a second press reverses), and 34 px rows: the map's own
  settler standing still (a list runs to hundreds of rows, so nothing animates and only the rows on
  screen are painted), the name the details panel shows, the profession (a child's with its age),
  the workplace, and the lacks as the chip glyphs with tooltips. No live-activity column: the game
  knows only coarse states. The list opens by profession, since a generated name tells the player
  little; heroes lead under every order, as the original keeps them; unposted rows follow the posted
  ones in both directions; the lacks order opens with the neediest.
- A row press selects the person alone, centres the view and closes the window; the details panel
  takes over. The modifiers work as in a file list and keep the window (user ruling): Ctrl, or Cmd
  where a Ctrl click opens the context menu, puts the row in the selected group or takes it out;
  Shift replaces the selection with the rows from the last row pressed without Shift to the pressed
  one, from the top while that row is not listed; both together add that range to the group. The
  rows are lit for whatever the unit controls hold selected and the footer counts them. "Zaznacz
  pokazanych" selects the whole filtered list and closes, or with a modifier adds it to the group.
- Chip captions and list options open with a capital letter; the lack names stay lower case in the
  catalog, since the summary and the tooltips set them into "bez ..." phrases.
- Filters, order and scroll are kept for the game in the tool-window state (never browser storage).
  A tick rewrites only the rows that changed: a dead settler leaves, a new one enters at its place
  in the order, and focus and scroll stay put. Esc closes the window; in the search field the first
  Esc clears a typed query and the next one closes.
- Empty states: "Nikt nie pasuje" with its own clear button, and "Nie masz mieszkańców".

## HUD shell

The runtime shell (ticket 02) places the regions on the DOM plane in design px and keeps the legacy
Pixi panels behind the new navigation until their owner tickets replace them.

| Region | Placement | Content today |
| --- | --- | --- |
| Navigation beam | bottom centre, 420 × 72, seven 56 × 64 actions | Buduj, Mieszkańcy, Asystent, Statystyki, Misja, Dyplomacja, Wiedza |
| System bar | top right, flush with both edges | residents and five stock counters with breakdowns, the sim clock, pause / ×1 / ×2 / ×3 segments, menu medallion (rules below) |
| Notifications | left 10, top 18, width 160, ends 16 px above the minimap | three seal filters with tallies over the fanning card list (rules below) |
| Central window | centred on the screen's vertical axis, the beam's; top 96, floor at the beam | one window at a time; Mieszkańcy and Wiedza show a framed pending note |
| Selection | bottom right, legacy 322 px panel | lifts above the beam when the beam reaches under it (viewport narrower than 1076 design px) |
| Minimap | bottom left, legacy 224 × 200 | unchanged until ticket 19 |

Rules the shell enforces:

- A beam action shows no focus ring (user rule): its pressed art and the lit key hint are the cues.
- One central window at a time. A beam entry closes the other window and toggles its own; the same
  entry pressed again closes it. Buduj, Asystent and Misja drop a held placement or paper first;
  Statystyki, Dyplomacja, Mieszkańcy and Wiedza leave a running placement alone.
- Esc steps back one level per press: a held placement or paper, then the open central window, then
  the unit controls' own ladder (job list, armed order, selection). The shell handles Esc before the
  other listeners and stops it once it consumed the press. With every rung clear, Esc opens the game
  menu: that last step is the rebindable "Menu gry" action (default Esc, the one action Esc may hold)
  and on any other key it opens the menu at once. "Okno budowania" (default B) toggles the
  construction window like its beam entry.
- Closing with Esc or the close medallion returns keyboard focus to the beam entry that owns the
  window. Only the mission sheet and the system menu hold the simulation paused; other windows never
  touch the pause.
- A wheel over a DOM region never reaches the camera, and the edge pan pauses while the pointer is
  over one. Presses on a region never reach the map; presses on the map keep the window open and
  select independently, with the details panel in its own corner.
- A legacy window that cannot fit above the beam shortens its list or lifts toward the top bar; a
  window wider than the region centres on the screen and yields to the minimap as before.

### Summary bar

The top-right bar (ticket 04) is one panel: the counters, the clock, the speed segments and the menu
medallion, with no divider frame between them.

- Residents are the seat's whole population across the map, by `Owner.player` (never by tribe: a seat
  fields several). The bar shows two counters, women and men: the grown people with and without the
  sim's `Female` marker (a woman in a trade, or a heroine, is a woman). The breakdown adds the men
  split into workers and soldiers (the `jobtypes.ini` soldier band and the heroes; an idle man is a
  worker), the children as one figure split into girls and boys (babies included in each), and the
  total. Women, men and children are disjoint and sum to the total.
- Stock scope is every unit the seat holds, wherever it sits: the piles of its buildings (warehouses,
  homes and workplaces alike, a workplace's inputs counted like its products) and boat hulls, the
  inventory a building keeps aside while it upgrades, the unit in a settler's hands, and every heap on
  the ground (felled trunk, ore pile, gatherer's yard heap, evicted stack) strictly under the 50-node
  walk range of one of the seat's signposts or buildings (the `buildHud` projection the statistics
  window already shows). The ground term is an approximation of the collecting settler's own
  navigation limit: its post-range term, the seat's buildings standing in for a collector's own radius,
  without group catching or terrain connectivity. Hands and yard heaps count so the figure holds still
  while a unit travels from trunk to heap to store. A deliberate divergence from the original's
  counting, which takes a workplace's product slots and skips its input slots (the reading behind the
  sim's `countsAsOwnStock`).
- Five categories with fixed rows (`hud/summary/model.ts`, keyed by good string id): Żywność (wheat,
  flour, food, cake, honey, mead; a dish still in its bakery or farm counts as the edible it leaves
  as, the sim's `EDIBLE_FORM_BY_DISH`, so bread and meat are food and candy is cake), Materiały (wood, stone, clay, iron, gold, mushrooms, leather, wool | brick,
  tile, stone block, marble, holy oil), Uzbrojenie (six weapons | four armours), Wyposażenie (shoes,
  wooden and iron tools, crockery, furniture), Inne (herbs, six potions | coin, six amulets). A listed
  good with nothing on hand stays listed as a muted zero; a stocked good outside every list is
  appended to the shorter Inne column, so nothing on hand goes unreported. Water is the one exception:
  a well's working stock, never reported. Row names are the content's localized good names, never a
  second copy in the catalogs.
- A category's icon is its representative good (food, wood, short sword, shoes, strength amulet): the
  project's own art when it exists, else the original's recoloured pile frame, sized by area
  (`good-art.ts`) so a thin sword and a round loaf carry the same visual mass in the 25 px box. The
  frame element is exactly the crop, never a box-sized background, so the sheet's neighbouring frames
  cannot show beside a thin sprite.
- The bar is 48 design px tall (the panel border, 6 px padding and the 34 px medallion); counters set
  their figures at 13 px, the clock at 13 px, the speed segments at 11 px.
- A breakdown opens on hover or focus of its counters, one at a time, stays while the pointer moves
  into it (a 12 px invisible bridge spans the bar's frame), closes on leave, blur or Esc; a press
  toggles it. The first three hang left-aligned under their counters, the last three right-aligned,
  and any tip that would still run past a screen edge is shifted back inside it, 6 px off the edge,
  measured when it opens and on every resize. A single-column tip is 235 px wide, a two-column one
  480 px.
- The clock is elapsed simulation time from the session tick, `h:mm:ss` with the hour always shown so
  the bar never re-flows. It runs at the picked speed, stops with the pause and reads back after a
  save or a load.
- A map script's info lines print under the bar, which owns the corner.

### Notifications

The column (ticket 03) is the DOM message centre; the runtime feed keeps the original's 200 slots,
lifetime, dedupe and priority table.

- The three seals are filter and tally in one: each shows how many live notes carry its weight,
  filtered or not, so the filter only hides (the original drops filtered notes). Levels: all,
  notable and important, important only. The tally cannot pass three digits.
- Order: important first, then notable, then routine; within a weight the newest first.
- A card is one event line at 10.5 px beside a 48 × 50 thumbnail, 148 × 46 px when the cards fit; the
  subject (name · trade, the building, seat or paper) is only in the whole message. The event line is
  a short label per message type from the app catalog, capitalised, short enough to fit the card
  without an ellipsis (a good or stance the row is about follows a colon: "Brak: drewno",
  "Obcy: wrogi"); the original's sentence is never on the card. The thumbnail is the live settler
  painted into the card's own canvas, as on the map with its current activity, motion and pace, over
  a translucent backing that shows the map through; a finished or upgraded building is its body as
  the construction card pictures it, painted once; an attacked settler or building, a death, a seat,
  a paper and a subjectless row show a flat graphic emblem from the notification atlas instead (sword
  and axe, house for a building whose type is gone, skull on a dim backing, shield for a first
  contact, banner for a changed stance, chest, scroll). A card about another seat (first contact,
  changed stance, a seat out of the game) paints the shield face, the banner cloth or the skull in
  that seat's colour; an own settler's skull is bone ivory. The bronze line glyphs stand in while the
  atlas is undelivered or fails to load. The seal on the thumbnail's right edge, the event line and the × share one line,
  centred in the card's visible part; the card carries no hairline, the seal alone tells the weight.
- Left click or Enter centres the camera on the target and selects it, without a window. A card with
  no target left (an unnamed death, a seat) has no chevron, and a press pins its message instead. Right click, Delete or the ×
  dismisses one card; Shift with any of them, or the bin button beside the seal filters, dismisses
  every shown card. The × stays on every card, so a covered card closes without parting the fan. Nothing else the player does removes a card: selecting or
  deselecting its subject leaves it (the original clears a human's notes on deselect; dropped as a
  user rule), so a card goes only by dismissal, when its cause ends or when its lifetime runs out.
- The whole message in the original's wording unfolds in a box to the right of the column on hover
  or focus of any card, and a press pins it when the card has no target.
- When the cards do not fit above the minimap they fan: each slides under the one before it by one
  uniform overlap, weightier cards in front, leaving the event line visible with the seal at the top
  of the strip. The covered part of a card is clipped, never drawn over the card in front. A covered
  card's figure moves down to the middle of its visible strip, and its emblem or building shrinks
  into the strip whole. Nothing moves or grows on
  hover or focus: the whole message opens beside the column instead, so the × stays under the pointer.
  Below a 27 px strip per card the fan stops, the list scrolls without a scrollbar, the bottom fades
  and a "jeszcze N" badge counts the cards past the edge.
- A fresh card slides in and an urgent fresh seal pulses three times. Figures are painted only on
  cards inside the list's visible area; a paused game holds their frame. Reduced motion drops the
  slide and the pulse, never the figure's activity, which is game content like the map.
- Every row at once, for a check of the column: `?scene=sandbox&debug=notices` (DEVELOPMENT.md).

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

The painted action icons, the notification emblems and the surface texture are the `ui/foundation` art package
([recipe](../../art/ui/foundation/asset.json), [package notes](../../art/ui/foundation/README.md)):
the 4 × 2 atlas `nordic-icons-v4.png` of simple single-object icons, the game-menu sheet
`nordic-menu-v1.png` (its oak door is the menu medallion), the 4 × 2 notification emblem sheet
`nordic-notices-v1.png` (flat emblems whose magenta areas are the seat-colour key) and the carved
wood/leather material study `nordic-surface-v1.png`, each with its generation record. The reference page samples the masters
directly; the runtime uses the package's delivered atlas and texture. The atlas's pawn and door cells, the
menu sheet's other candidates and the emblem sheet's horn are unused.

No original game UI art is copied. Panel contents and illustrative counts are not production
specifications.

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
- `review-goods/manifest.json`: `content/goods/manifest.json`; bread, wood, sword, shoes, crockery and food
  `ls_goods.goods_*` PNG/atlas.json pairs from `content/bobs/`.

If the temporary directory is lost, restore these from the primary checkout's generated content,
and use the mockup's terrain fallback until a fresh permitted local world capture is available.
Missing original assets are reported below the preview; do not mistake empty canvases for success.
