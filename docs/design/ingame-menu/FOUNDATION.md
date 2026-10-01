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

## Minimap direction

The minimap sits in one of three dark frames the player picks in the
graphics settings: **Żelazo** (iron-bound dark oak, the default), **Księga** (the mission book's carved
oak and brass corners) and **Urnes** (smoked oak with carved beast corners). A light frame drew the eye away from the dark HUD, so none is offered.

- Provide S/M/L/XL sizes with nominal longest sides of 224/280/344/416 design px.
  Anchor the panel flush to the bottom-left screen corner. Cap its
  longest side before the centred navigation beam's left edge with a 6 design-px gap; keep the
  selection panel clear. Both dimensions have a 124 design-px minimum. Hide the panel when that
  minimum cannot fit rather than covering adjacent controls.
- Trim the shorter frame side toward the projected map's proportions, by at most one third of the
  longer side (outer aspect at most 1.5:1). Use the same scale on both terrain axes. Dark wood, tinted to the frame, fills unused bands;
  a bronze rule and a soft shadow follow the visible terrain's edge during zoom.
- Every frame is a nine-slice with the same 20 design-px rail inside the panel; corner ornaments keep
  their size and aspect changes stretch only the rails between them. All five small round
  bronze controls sit on the right frame edge: zoom out, zoom in, whole map, size and filters.
  There is no header bar or separate toolbar inside the frame.
- Include independent minimap zoom (1–4×), small +/− controls and a return to the whole map.
  The third control uses a fit-corners icon and the short hint “Show all” (“Pokaż całą”).
  Show short hints on hover and keyboard focus; accessible zoom labels also include the current scale
  and zoom limits. Middle drag pans the zoomed map.
- Put people/building filters in a compact dark-wood disclosure opening to the right of the minimap.
  Lift it above the bottom navigation when needed. Keep fog gating and return focus on closing it.
- Do not include a hover preview of map areas.
- Defer terrain appearance until the actual game maps can be compared in the renderer.
- The three compact minimap frames are approved. The separate large-map frame remains undecided;
  [ticket 19](../../tickets/app/ingame-ui-19-map-overview.md) owns its design and implementation.

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
`--parchment` 9.5:1, `--ink-muted` 5.0:1, `--paper-error` 5.6:1. Solid-token ratios do not certify
textured or translucent pixels; inspect overlays against both terrain variants. Amber marks selected
actions and warnings; ordinary text is neutral. Warnings also state the problem in words, and wax
seals carry accessible labels, so colour is never the only carrier of state.

## Materials and chrome

- Persistent HUD regions are dark slate over the subtle leather texture of `nordic-surface-v1.png`;
  its carved top band is the beam under the bottom navigation.
- Large windows have 7 px wood-gradient rails, a bronze inner hairline, knot-work corner ornaments
  and a bronze knot at the top centre. Minor controls use thinner edges. Close buttons, the message
  count, the game menu and the settler level are bronze medallions.
- Catalogue interiors are parchment with a faint SVG grain. Entries look like permits: parchment
  cards, ink text, cost slots with a corner badge, a lit rim on the card last picked, a lock badge on
  locked entries.
- Bottom navigation: seven bronze medallions on the carved beam, persistent labels, lit medallion
  and marker for the active entry.
- Top bar: one beam carrying population symbols, goods counters, the simulation clock, the segmented
  pause / ×1 / ×2 / ×3 control and the menu medallion. Categories reveal a parchment breakdown on
  hover/focus with dotted leaders.
- Notifications are frameless cards down the left edge with the settler on a translucent backing, a
  wax seal between the thumbnail and the text for priority and a go-to chevron on hover. Three seal filters
  above the list carry the tally of each weight.
- Selection details use ledger rows with dotted leaders, small-caps section titles with rules,
  quarter ticks on meters and icon buttons for orders.
- A held building or paper shows as a dark strip at the head of the central region, not inside the
  window (the window is away while placing).

## Components and geometry

Alegreya Sans carries information; Cinzel, the main menu's display face, is for short window
titles only. Body copy uses 14 design px, compact metadata 12 px, beam labels 11 px, window titles
25 px (selection 20 px). Pointer targets are at least 36 px; spacing follows 4 px. The 32 px notification
filters are an explicit exception in this mouse/keyboard study.

- Main action art: 36 px; resource art: 29 px; gallery art: 44 px.
- Bottom actions: 56 × 64 px on a 44 px medallion, with persistent labels and a selected marker.
- Construction: 640 px wide, so the widest bill in the content (eight goods) sits in one row on a
  card; content-sized rather than filling the screen vertically; the catalogue scrolls
  inside it once the window would reach the beam.
- Selection: the settler, vehicle, building and group panels are 318 px on the DOM plane; a signpost
  and a palisade keep the legacy 322 px panel until ticket 10 replaces it.
- Notifications: 173 px, no opaque background in unused column space.
- Minimap: S/M/L/XL with bounded aspect trim, flush to the bottom-left corner; capped before the centred
  navigation beam with a 6 design-px gap, as specified in [Minimap direction](#minimap-direction).

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
  two stakes, without highway markings or battlements; disabled with the tooltip "Niedostępne w tej
  wersji gry" until the sim has a road, wall and gate command, and Papiery at the right with a count
  of the plans a pick could spend. Papiery lights like a tab and turns the same window to its papers
  page; the page's one "‹ Katalog" tab turns it back. Left of Papiery, a seat with more than one
  build nation gets a nation switch, one button per nation drawn as its headquarters; it turns both
  pages to that nation's houses, and a pick places the house in it. Roads, walls and gates stay the
  seat's own nation.
- Tabs: the original's five categories (Wszystko, Praca, Magazyn, Dom, Wojsko; tower and training
  fold into Wojsko), each counting the entries buildable now. At the tabs' right end a two-button
  toggle switches the catalogue between tiles and a list; the choice is one for both pages and is
  remembered for the game, with the page, the tab, the scroll and the last pick, in the tool-window
  state (never browser storage).
- Entries: every house kind the content has, minus vehicles, wonders and types with no construction
  cost (the headquarters stands from the map, the wall segment comes from the wall tool). A type the
  map or the tribe bans is never listed; an undiscovered one is listed after the open entries under a
  "Zablokowane" note with their count, faded, with a lock badge, its "?" still live. No requirement
  text on the card or under the note: the "?" page is where the discoveries are read.
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
- Every good icon on the DOM plane (the cost slots, the summary counters) comes from the art the map
  draws with: a presentation pack's icon when it has one, else the original's pile atlas.
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
  the original knows (the indulgence, the build, learn and produce permits) are not listed: a
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

The seat's people as one list (ticket 07), in the construction window's frame and width. Poddani
on the beam opens it at once.

- Listed: the local seat's humans. Animals, vehicles and other seats' people stay out. The list
  follows the tick while it is open and costs nothing closed: one walk over the snapshot's actors.
- The find row: a search over name, profession and workplace at once ("piek" finds the bakers and
  the bakery's crew), a Zawód list of the professions present with their head counts, and a Może
  zostać list of the picker's trades, which keeps the holders of the trade and the grown men the sim
  would let take it (`Simulation.canChooseJob`, asked only while that filter is set; a script's
  trade lock on a unit is not mirrored). Both profession filters use the picker's groups and
  alphabetical order within each group; the current-profession filter retains its counts.
- Two chip rows share one grid of eight equal rectangular cells across the window, the count on top
  and the caption under it, "Kto" and "Bez" in one narrow label column. A count narrows to the
  other filters: a cell counts what its own pick would list, so a Kto cell swaps the
  group and a Bez cell adds its lack to the picked ones, and the Zawód list counts the same way. A
  cell at zero is dimmed.
- Kto is one choice at a time: Wszyscy, Mężczyźni, Kobiety, Dzieci, Pracownicy,
  Cywile, Żołnierze, Bohaterowie. The groups follow the original subjects window: men and women are
  adults, heroines stay out of the women, workers are adult men with a trade that is no soldier or
  hero class. Cywile, adult men without a trade, is this project's addition: they are whom the player
  opens the list to find.
- Bez combines, and combines with everything else: domu, miejsca pracy, narzędzi,
  butów, pary, dzieci, broni, miodu. Home and partner skip soldiers and heroes, children counts the
  women, weapon the soldiers. The worn lacks (tools, shoes, weapon, mead) ask only a man whose
  equipment may change, the sim's `mayChangeEquipment`: a woman, a child and a hero wear nothing the
  player hands out, so the settler panel shows a woman and a child no Ekwipunek section either, nor
  a Doświadczenie section, since they hold no trade to train in. Tools counts the workers other than
  the scout, which is narrower than the original's every grown man who is no soldier or hero: it is
  whom the assistant hands a tool. A child lacks nothing: it is housed and dressed through its
  parents. Two lacks are this project's own. "Bez miejsca pracy" is a worker whose trade some
  workplace employs, posted at none and tied to no work flag, so a builder or a scout never shows;
  it replaces a separate roster of unposted tradesmen. "Bez miodu" is such a man with a job and no
  mead bottle in the misc slots: the people the assistant's mead grant reaches. Approximation: the
  sim tracks a couple's one growing child, so "bez dzieci" means none growing now, not a family
  history.
- The parchment: a summary line naming the active filters with "Wyczyść filtry", sortable column
  heads (Imię, Zawód, Miejsce pracy, Braki; a second press reverses), and 34 px rows: the map's own
  settler doing what it does on the map, with its gait, work strokes and hero glow (only the rows on
  screen are painted, every frame), the name the details panel shows, the profession (a child's with its age),
  the workplace, and the lacks as the chip glyphs with tooltips. No live-activity column: the game
  knows only coarse states. The list opens by profession, since a generated name tells the player
  little; heroes lead under every order, as the original keeps them; unposted rows follow the posted
  ones in both directions; the lacks order opens with the neediest.
- A row press selects the person alone, centres the view and closes the window; the details panel
  takes over. The modifiers work as in a file list and keep the window: Ctrl, or Cmd
  where a Ctrl click opens the context menu, puts the row in the selected group or takes it out;
  Shift replaces the selection with the rows from the last row pressed without Shift to the pressed
  one, from the top while that row is not listed; both together add that range to the group. The
  rows are lit for whatever the unit controls hold selected and the footer counts them. "Zaznacz
  pokazanych" selects the whole filtered list and closes, or with a modifier adds it to the group.
- Chip captions open every word with a capital ("Miejsca Pracy") and list options open with one; the
  lack names stay lower case in the catalog, since the summary and the tooltips set them into "bez
  ..." phrases.
- Filters, order and scroll are kept for the game in the tool-window state (never browser storage).
  A tick rewrites only the rows that changed: a dead settler leaves, a new one enters at its place
  in the order, and focus and scroll stay put. Esc closes the window; in the search field the first
  Esc clears a typed query and the next one closes.
- Empty states: "Nikt nie pasuje" with its own clear button, and "Nie masz mieszkańców".

### Trade window (Okno handlu)

The trade between a trader's two own houses, opened by "Konfiguruj handel" in the settler panel: a
central window 720 px wide, in the construction window's frame, so on the 1365 px plane of a
1280 × 720 screen it clears the settler panel, which stays open at the right edge. It has no head:
the bronze close medallion takes the frame's top-right corner ornament, and the height a title
took goes to the lists. The window names itself ("Handel · " and the trader's name) only for
assistive tech.

- Houses: house A left and house B right, B mirroring A. Each is headed by a live portrait of the
  house, a 64 px square in the settler portrait's frame at the outer edge (A's left, B's right),
  painted by the renderer through a hole in the window's slate like the settler panel's portrait. A
  click on it brings the house into view and keeps the trader's selection and the window. Beside the
  portrait its badge (26 px) and its name in the settler panel's name type at 15 px, large so A and B
  read at a glance within the portrait's height (a long name ends in an ellipsis; the hover card
  names it), the name as a link (select and bring into view, which closes the window with
  the trader's selection, as a residents row does; resting shows the hover card and no tooltip, which
  would cover it) and the arrow while
  the trader heads there, over the house's own strip of square icon tabs with solid silhouettes:
  Wszystkie first (three bars, the house's eight largest stocks, most first), then the eight stock
  categories (a loaf, a tankard, a log, bricks, a mallet, a boot, a sword, a potion flask), standing
  on the list's parchment. Each house keeps its own open tab (A on Żywność while B is
  on Wojsko), a tab's tooltip is the category's name alone (a category the house holds nothing of
  reads faded), a lit dot marks a category with a transfer, and the
  arrow keys move along the strip. A new trader, or a slot that took another house since the last
  open, opens that house on Wszystkie; the open tabs stay across ticks
  and a reopen for the same trader and houses. The stock browser
  owns the strip, so the building window can show the same per house.
- Under the head the house's stock of the open tab: per good its icon, name, "amount / shelf" and a
  thin meter; in a category the goods in stock first and the empty ones faded after them. That order
  is taken when the window opens or the tab changes and kept while amounts change, so no row moves under the
  cursor. Every list shows nine 28 px rows whatever the tab holds, so switching tabs moves nothing,
  and nine is what fits the 768 px plane of a 1280 × 720 screen (the window stands 567 px of its
  592 px allowance); a longer category ("Inne" in a warehouse) scrolls inside its list, never the
  window.
- A row's arrow sets up the transfer into the other house: "→" at the right end of A's rows (named
  "Wieź do punktu B" for assistive tech; it shows no tooltip), "←" at the left end of B's, so the two
  lists' arrows flank the gap between them; Ctrl (or ⌘) + click balances the good instead (Ctrl on a
  one-way good turns it balanced).
  A good in a transfer has its arrow lit on both sides, pointing the way it goes ("⇄" when balanced),
  and a plain press on it removes the transfer. An arrow into a house that does not store the good is
  faded with the reason in its tooltip.
- Przewozy: one 32 px line per transfer in good order: the good in its well and its name, a strip
  "A → B", "⇄", "B → A" (the lit option stays lit on a press; an option into a house that does not
  store the good is faded with the reason), and for a one-way transfer "do N", the ceiling the
  destination is filled to (1 to 100, ∞ for none), and "zostaw N", the units always left in the
  source (0 to 100), both the production counter's −/n/+ with its Shift and Ctrl keys; ✕ removes the
  transfer. A balanced line keeps the counters' place empty, so the columns line up; turning a
  limited one-way good balanced sets its kept mark again, so a balanced flow never carries a limit
  the window does not show. Five lines show, more scroll inside the list; with none it reads "Brak
  przewozów. Kliknij strzałkę przy towarze, żeby dodać." The window keeps one height whatever the
  route moves.
- Live: the window repaints from the settler panel's model every tick, rebuilding a list only when
  its set of goods changes and otherwise rewriting words and attributes, so counters, tooltips and
  the hover card never flicker.
- Closing: the cross, Esc (after an open action ring, before an armed pick and the selection),
  another selection, or a route that loses an own house. Esc or the cross hands focus back to
  "Konfiguruj handel". It takes turns with the beam's windows: opening it closes the open one, and a
  beam window opened later closes it.

### Settler panel

The selected person's panel (ticket 08), bottom right, 318 px wide, in the window frame. The head
is centred between two medallions: at the left the gold orders one, with the ring glyph and the ring
hotkey in its tooltip (gold and first, so a new player finds the ring; blank for another seat's
person, so the centre holds), at the right the bronze close that clears the selection. Between them
the trade as the bronze kicker (13 px, the line the player checks) over the person's name in smaller
type (12.5 px) with 4 px between them, and an owner line only when it says something (another seat's
person, a child's age). The orders medallion and a right click on the portrait open the action ring
around the cursor, as a right click on the figure in the world does. The ring stands over the panel,
which stays in place under it, until an order, Space or Esc closes it (Esc closes the ring first and
keeps the selection). An open trade window stays: that ring keeps right of its edge, so no arm opens
under it. The kicker browses the trade:
chevrons on both sides and "2 / 5" step to the previous or next person of the same trade and bring
them into view (Tab and Shift+Tab do the same while the panel is open and no field or other window
has the focus); they are absent while the person is the only one of the trade. A double click on
the trade selects every person of that trade as a group. The name is an in-place rename (a pen on
hover), except for a hero and another seat's person. The panel is a quick look: every state fits the
810 px design plane without a scrollbar (the frame stops 16 px under the summary bar), so anything
that would not fit is folded or cut at design time, never scrolled. It shows what the player can
read or act on and nothing else: no explanatory lines, no help buttons. Every control's tooltip is a
few words in the panel's own chip at the cursor after half a second (the browser's own tooltip
waits a full one and cannot be told otherwise): what the press does, or why it is refused. Keyboard
focus shows the focused control's tip at once, at the control; a shown tip follows its text when a
tick changes it and goes when the control does. The same text is the control's accessible
description. Review
states: `settler.js` in the mockup, switched by the "Osadnik" buttons. The mockup's trader and
family states predate the Handel section, the trade window, the Pojazd row and the wedding-rings
button; for those the built panel is the reference.

- Portrait row: the live settler in the 96 × 92 px framed portrait is the centre-view button. The
  renderer paints its world cutout on the canvas under the plane, through a hole the panel's fill
  leaves at the frame. A person inside a building shows the building instead, fitted to the frame
  (a craft the content choreographs still shows the worker at it), never an empty frame or a frozen
  figure on the panel's backdrop. The column beside it holds the equipment as two rows of 30 px sockets at the
  top and the status strip along the frame's floor. The sockets are the slots the person's kind
  has: the worn row in a fixed order (Broń, Zbroja, Narzędzia, Buty; a worker has the last two, a
  soldier Broń, Zbroja, Buty, a hero only the arms it carries, locked, with a lock badge in place
  of the ×) and the four-cell Torba row under it. A woman and a child show a worker's sockets faded and inert (the tooltip says
  the person wears nothing), so their panel keeps the same shape. An empty worn socket shows a
  ghost glyph of what goes there (sword, armour, tool, boot) and opens the equip picker; an
  occupied socket holds the good's icon over its wear fill, the well filled from the floor up to
  the life left (green, amber under half, red under a quarter), its tooltip the wear left as a
  percent (the minutes it buys wait for a wear-pace read seam); pressing it opens the picker to
  swap and a small × at its corner, shown on hover or focus, takes the item off. No level
  medallion: the game has no settler level.
- Status strip along the frame's floor in the column beside it: a dark well, one 24 px line in 11 px
  type that never changes height, with a tone dot, the live state and its detail after a dot
  (ellipsized when long), and at the right end "niesie" with the carried good in a small well and
  its count. The state
  names what the person is at, read off the running atomic: Pracuje for any economic step (a
  stroke, a catch, a pickup, a cart load, a craft cycle), Buduje, Naprawia, Walczy, Ćwiczy, Je, Śpi,
  Modli się, Rozmawia (a chat
  holds the person), Idzie, Idzie na rozkaz, Bezczynny (nothing running, or only the wait animation),
  Czeka na budowę warsztatu, Stoi na alarmie. A civilian eating or a builder asleep never reads as
  working. The detail is the product being made (Pracuje · Krótki miecz), a trader's destination
  (Idzie · do Magazyn), or the reason a tradesman stands idle when the sim knows one (brak
  surowców: żelazo, magazyn pełny, nic nie wybrano, bez zawodu). The dot and the text read amber
  for a tradesman's Bezczynny and Czeka na budowę warsztatu, the dot grey for a walk or a wait and
  green for anything the person is at.
- Samopoczucie: one line per stat, label, quarter-ticked meter and the percent, Zdrowie first, then
  the need bars the settler carries (a child and a hero show health alone). Under a third the fill
  and the percent turn amber, under a sixth red, so trouble reads without words. A need row is the
  order for that need: pressing Sytość, Sen, Towarzystwo or Religia sends the ring's Jedz, Śpij,
  Rozmawiaj or Módl się; Zdrowie has no order. The numbers show while the cursor rests on a line
  (health as points, a need as its percent with any stored reserve, and the order the press gives)
  in the panel's chip at the cursor at once, since a value ticking under the cursor would keep
  restarting a delayed tip.
- Praca i rodzina: ledger rows on one line each; the dotted leader gives way first, then a long
  building name ellipsizes. Praca and Dom name the building as a link that selects it (the
  original's "Pokaż miejsce pracy" and home buttons), followed by round buttons, assign (a house
  glyph, opens the pick mode) and remove (×). For a trade that works from a flag (a
  gatherer, a fisher) the assign button carries a flag glyph and arms one pick for both ways the
  trade works: the flag sprite follows the cursor as a translucent ghost, a lit building under the
  click employs the person, any other spot plants the flag there (a posted gatherer leaves its post
  for it) and the ghost goes; the tooltip says so. An empty seat the player can fill says "brak"
  in amber; when there is nothing to remove the × is absent and the value sits against the assign
  button, so every row keeps the same distances (8 px from the value to its chips). A button the
  sim would refuse stays visible, faded, with the reason in its tooltip (a person a mission holds to
  its task). Resting on the workplace link shows the building's hover card (state and stock) without
  a click; the card follows the stock while the cursor rests. Pojazd, under Dom, names the vehicle the person rides as a link that selects it, its hold
  in the tooltip ("Wóz ręczny: 3 drewno, 2 żelazo"), with a wheel button that picks another and ×
  ("Zejdź z pojazdu"); without one it reads "Przydziel pojazd" in amber, a link that arms the ring's
  "Przydziel wehikuł" pick like the wheel. Only the carrier, the trader, the soldier and the hero
  have the row, by the owner's choice, even where a vehicle type admits other trades. Rodzina names
  the spouse and the growing child as links that select them, or "bez pary" in amber with a
  wedding-rings button after it; both send the person to find the nearest partner ("Znajdź
  partnera") while the person is free to marry, and the button fades to "Ślub w toku" while the
  wedding runs. The player never picks the partner. A man without a trade has no Praca
  row, a woman has Dom and Rodzina only, a soldier Dom, Pojazd and Rodzina, a child a read-only Dom
  row, a hero Pojazd alone.
- Produkcja, under Praca for a craft operator and for a gatherer alike: one row per product the
  trade makes here, in recipe order, or per good it gathers here, in catalog order: the good's icon
  in a round button, its name and a −/n/+ counter. The counter is the original's human-window
  production counter, and a gatherer's counts down per landed unit (a stroke's yield, a catch): 0 stops the product (the row fades),
  1 to 100 is how many more to make (the original stops at 10; the wider range is an owner rule),
  ∞ never stops. − at 0 wraps to ∞, + past 100 reaches ∞, Shift with an arrow jumps to that end,
  and + at ∞ wraps to 0, as the original's window does, and Ctrl moves by ten inside the range,
  wrapping at its ends like a single step. The icon button is "Tylko ten produkt"
  (for a gatherer "Tylko to dobro"): ∞ here, 0 on every other row (the original's "Tylko
  produkuj"); with Ctrl it adds the good to what is made or takes it out (this row to ∞ or 0, the
  others untouched), so a clay gatherer takes stone as well with one Ctrl press on the stone. On
  macOS the browser turns Ctrl + click into a context-menu press; the panel takes that press as the
  Ctrl click, and ⌘ + click works too.
  A product not yet earned is listed faded with a lock, the requirement and progress in the
  tooltip; the lock is a marker, not a button, and carries the same requirement. Products rotate
  one unit at a time in the workplace's recipe order. A job whose `userCanChangeProductionFlag` is
  0 (the hunter, who takes every good of every kill) has no Produkcja section at all: the sim ignores
  its counters and refuses the orders that would set them. The rows are 24 px with 22 px chips, the
  list always open for a fresh selection; it folds to the first three rows behind "jeszcze N" only
  when the panel still runs past the plane with the experience section folded.
- Wojsko, for a soldier and a hero: Postawa as a three-way segmented control (Atak, Obrona, Ignoruj;
  a fleeing unit lights none) and Jedzenie i sen as Dozwolone / Zabronione, the same orders the action
  ring issues. Every segmented strip is the same width (174 px) with its options sharing it equally,
  so the two rows line up.
- Handel, for a trader: a compact summary; the trade itself is set up in the trade window. One row
  per route slot, both always present so the section keeps its height. A row is the slot's badge (A
  for the first house, B for the second), the house's name as a link that selects it and brings it
  into view (resting on it shows the building's hover card and no tooltip, which would cover it;
  another seat's house reads amber), a
  bronze arrow on the stop the trader serves now and × to take the house off. Every free slot reads
  "Dodaj punkt handlowy" in amber, a link that arms the house pick, which fills the first free slot
  whichever row armed it. With both stops the player's own houses the two rows' × buttons step
  left for one 24 px round button at the right edge, the balance-scale glyph with "Konfiguruj
  handel" as its tooltip, centred between the rows on a thin bronze bracket from both × so it reads
  as joining the two stops; it opens the trade window. Without it the rows keep the full width. Under
  the rows the transfers as read-only lines: the good's icon
  centred in its well and its name, a dotted leader, and its direction with the limits set ("A → B
  · do 10 · zostaw 2", "A ⇄ B"), the tooltip saying the same in words. Nothing on these lines is
  pressed. With fewer than two stops only the two stop rows show. With another tribe's house on the
  route there is no configure button: Umowa lists the map's agreements as single-choice chips "1 [coin] → 4 [iron]" ("Sprzedaj 1 × Moneta, otrzymaj 4 × Żelazo"), a second press drops the
  choice, and under the chosen chip two thin meters of the running exchange, the given half and the
  received half, faded while the partner is no friend (the tooltip says so). The route has no other
  status line: the trader's destination is in the status strip. The section starts open; when the
  panel would run past the plane, the foldable sections fold in order, Doświadczenie first,
  Produkcja next and Handel last, since the route is the trader's main control. Handel then lists
  only the transfer lines that fit, and the last line kept is a link "jeszcze N przewozów · otwórz
  okno" (the tooltip: the window lists them all) that opens the trade window; the count follows
  when another section or the plane changes size. In the 1280 × 720 trade scene a trader without
  experience shows twelve lines, the link from the thirteenth transfer on. With no room even for the
  link (or for the agreements) the section folds: it keeps its stop rows and offers "jeszcze N" (the transfers, or the agreements) in its title,
  which opens and closes it; another person starts open again.
- Doświadczenie: the trained specializations as ledger rows one to a line (a track's name runs
  long: "Murarz - kamienny blok"), the current trade's first, the bonus percent in green (the
  tooltip spells it out). Every fight track counts as a soldier's and a hero's own (approximation:
  the weapon a class fights with is not read). Then the upcoming discoveries, at most three,
  nearest first: lock-marked "what (track)" rows with "current / required" and a thin meter, for
  the professions and the goods the tribe's `needforjob` and `needforgood` tables gate behind this
  trade's tracks (a potter reads how many pots until tiles). A gated profession the picker never
  offers (the sea trades need a harbour the game has none of) and a fighter trade are not promised.
  Every row shows while the whole panel fits the plane; when it would not, this section folds first
  (before Produkcja) to the current trade's first three tracks and two discoveries behind "jeszcze
  N" in its title, which opens and closes it (open past the plane, the bottom is cut, never
  scrolled). A person whose rows fit has no toggle; selecting a person opens the fold afresh. The
  section is absent when there is nothing to list.
- No footer and no button row: the portrait centres, the head's gold medallion orders, the
  profession change is the ring's (and its hotkey's).
- First paint at map start: the panel paints a made-up person once, out of sight, when the game
  view mounts, so the browser compiles the raster pipelines of its styles behind the loading screen
  (measured at 350 + 230 ms of GPU-process raster on the first settler click without it). Every
  DOM surface that first appears on a click should warm the same way.
- Another seat's person: trade, name, owner line with the diplomatic stance, the live state,
  Zdrowie and Praca; the needs, production, experience, family and equipment stay hidden,
  the head has the close medallion alone and no control is offered.
- A dead or removed target clears the selection and the panel with it. Every control checks the seat's
  ownership before submitting a command.

### Vehicle panel

The selected vehicle's panel, in the settler panel's frame and place, built from its parts. Review
states: `vehicle.html` in the mockup (the portrait there is a crop of a capture; in game the renderer
paints the live vehicle). The same quick-look rules hold: every state fits the plane without a
scrollbar, every control's tooltip is a few words saying what the press does or why it is refused.

- Head: the vehicle's class as the kicker (Wóz, Statek, Machina oblężnicza) with the browse over
  the seat's vehicles of that class (chevrons, "1 / 3", Tab and Shift+Tab; a double click selects
  them all), the type as the title (vehicles carry no name), the owner line only for another seat's
  vehicle. A vehicle has no action ring, so the gold medallion stays blank and keeps the heading
  centred; a right click on the map drives the vehicle as before.
- Portrait row: the live vehicle in the 96 × 92 px frame is the centre-view button; a vehicle riding
  a ship shows the ship. A 7 px wear bar under the frame fills with the hitpoints left (amber under
  a third, red under a sixth), its tooltip the hitpoints. Beside it, where a person has sockets, the
  order buttons, 30 px, five to a row: Jedź do (Płyń do on a ship), Zatrzymaj, and Wjedź na statek
  for a land vehicle (Zjedź ze statku while it rides one) or Zacumuj for a ship; a siege engine adds
  a second row of red attack orders (ludzi, budynek, pojazd, miejsce). A spot or target order arms
  its pick and its button stays lit gold until the pick resolves or Esc drops it; its tooltip is the
  order's short name (Płyń do, Zacumuj), no ellipsis. A refused order is faded with the reason
  (no driver, standing on a ship, the ship at sea, waiting for the draught animal). The status strip
  along the frame's floor names the first state that holds: Na statku with the ship as a link,
  Wjeżdża na statek, Atakuje, Cumuje, Płynie or Jedzie, Czeka na zwierzę pociągowe, Czeka na
  woźnicę / kapitana / obsługę in amber, Czeka na załogę, Ładuje or Rozładowuje towary while a cargo
  hand has a trip to make, Zacumowany, Zatrzymany, Stoi.
- Wojsko (a siege engine only): Postawa as the soldier's three-way strip with the vehicle's stances,
  Atak, Obrona and Pozycja, each tooltip saying how it fights.
- Załoga: the commander is a 40 × 56 px well framed in bronze with its role's badge (a wheel for the
  driver, an anchor for the captain, a crosshair for the crew), no name. Empty, it is the amber seat
  pick that arms the pick of an own settler on the map (the sim seats the commander first, then an
  ordinary seat). A land vehicle has its role line beside the well: Woźnica / Obsługa over the
  trade, "idzie" or "Przydziel woźnicę" in amber. A ship's ordinary seats sit beside it as 28 × 36 px
  wells, seven to a row. Every rider shows live, larger in the commander's well: one aboard stands
  idle, one still walking to the door walks as the map draws it, dashed and faded (the figure glyph
  stands in without a sprite sheet), the first free seat the amber seat pick, the rest plain. A
  click on any rider selects it and a Ctrl click steps it out; the tooltip is the role and the name
  for the commander (Kapitan · the name), the name alone for a seat. A ship's deck is a Pojazd row:
  the carried cart as a link with the button that drives it ashore, or "brak" with the button that
  arms the pick of an own cart to drive aboard. The title carries the seats taken of all and "Wysadź
  wszystkich"; stepping in or out is refused at sea.
- Handel: a cart a trader rides shows the trader's Handel section as the settler panel does, and its
  configure button opens the same trade window, addressed to that trader.
- Ładownia: a load gauge over the hold's units (aboard solid, on the way hatched, a mark at the sum
  of the targets) with "aboard / slots"; then one manifest line per good aboard, asked for or
  booked: the good's well, its name, what is aboard with "+N" on the way or "−N" leaving, and the
  target as the production counter (Ctrl ±10, Shift to 0 or as much as fits; the hold's room caps
  the plus, which fades with "Ładownia jest już w całości rozdzielona"). A thin rule under the line
  fills with the part of the target aboard; a line asked for less than it holds reads muted. The
  counter echoes a step until the snapshot carries it, so steps within one snapshot add up, and a
  line keeps its place while its counts change. Past eight lines the manifest scrolls in place and
  fades at the bottom while lines sit below; the add row stays under it, and a good added from the
  picker scrolls into view. "Dodaj towar" opens the picker in place of the add
  row: the stock category tabs over the goods of the open one the type may carry, a listed good
  ticked; a press adds the line at zero (a second press on such a line takes it off). The title
  carries "Rozładuj wszystko" (every target to zero) and, while nobody works the hold (no commander
  and no carrier seated), "bez tragarza" in amber. A trader's cart lists the lines read-only under
  "według trasy": its route writes the targets.
- First paint at map start, as the settler panel's: a made-up vehicle lights every section once.
- Another seat's vehicle: class, type, owner line with the stance, the portrait, the state and the
  crew's figures; no order, no hold, no control.

### Group panel

Several units selected at once: settlers, vehicles or both, in the settler panel's frame and place.
A building is only ever selected alone (Shift+click on one replaces the selection; a control group
holds units or one building), so a group never mixes them. The point of the panel is to see who is
selected; stats and shared orders follow.

- Head: "Grupa" as the kicker, the make-up as the title ("35 osadników · 3 wehikuły", or a single
  kind's name and count, "Łucznicy · 12"), no rename, no browse. The gold medallion opens the action
  ring for the group while any member is a settler the viewer orders; a vehicle-only group blanks
  it. The close clears the selection.
- Kind tabs: "Wszyscy" then one pill per kind, fighters first (heroes, each soldier class by its
  weapon, siege engines, ships, carts), then the village (each trade, civilians, women, children),
  each with its count. The lit tab scopes everything under it: the wells, the overview, the orders
  and the details. A double click on a kind's tab selects only that kind, Shift+click drops it from
  the group. A group of one kind shows no tabs.
- Zaznaczeni: the scope's members as 32 × 42 px live wells, eight to a row, a vehicle across two;
  a hairline along each well's floor carries the health (amber under half, red under a quarter, the
  well's edge red too). Three rows show, then the grid scrolls in place and fades at the bottom. Only
  the wells in view are painted. A click selects that member alone (after a short wait, so a double
  click is not taken for one), a double click brings it into view and keeps the group, Shift+click
  drops it, Ctrl+click selects every member of its kind. The tooltip names the member, its kind and
  health, and the gestures. The cursor on a well lights that member's ring on the map in pale gold.
- Przegląd: the scope's average Zdrowie (its numbers and how many are wounded at once in the chip),
  then each need's average as the settler panel's meter line; a press orders that need for every
  member the action ring's gates let take it, and the chip says how many that is. Then the gear:
  Broń and Zbroja for the fighters, Narzędzia for the village's workers, Torba for everyone, each a
  row of good icons with how many hold them (a draught also gives the sips left in its tooltip) and
  "bez: N" for those holding nothing there. A vehicle scope adds Załoga, the seats taken of all.
- Wojsko: Postawa and Jedzenie i sen for the scope's fighters, lit when every one holds the same
  value and unlit while they differ (the label's tooltip gives the split, "Atak 20 · Obrona 6"); each
  option's tooltip says how many it reaches and an option nobody takes is faded. Siege engines get
  their own Katapulty strip.
- Szczegóły, folded until opened (the choice holds while the game runs): Ranni, Ciężko ranni, Głodni,
  Zmęczeni, Bez zbroi, Bez mikstur leczenia, W wehikułach, Uszkodzone wehikuły, each count a link
  that selects only them; then the fighters' combat experience bonus (average and best) and the
  healing sips carried. Only rows that hold someone show.
- Fit: the grid gives up rows (three, two, one) before an open Szczegóły steps aside on a fresh
  group; the player's own open press only takes rows from the grid.
- First paint at map start: a made-up group lights every section once.

### Building panel

The selected building's panel, in the settler panel's frame and place, built from the settler and
vehicle panels' parts; implemented on the running game without a separate mockup. The same quick-look
rules hold: every state fits the plane without a scrollbar, every control's tooltip is a few words
saying what the press does or why it is refused.

- Head: no class kicker; its line carries only the browse over the owner's buildings of the same
  type (chevrons, "2 / 3", Tab and Shift+Tab) and folds away when there is none. The title is the
  type's name without its tier ("Chata kamieniarza", "Dom"), and the meta line under it names the
  tier for a type with an upgrade chain ("Poziom 2"), then another seat's owner line, or the
  civilization while the seat keeps houses of more than one (a mixed-tribe seat must see which tribe
  a house belongs to: tribe partitions its economy). A building has no action ring, so the gold
  medallion stays blank and keeps the heading centred.
- Portrait row: the live building in the 96 × 92 px frame is the centre-view button, with the 7 px
  wear bar under it (Wytrzymałość in its tooltip), as the vehicle's. Beside it up to four labelled
  order tiles in two rows, each in a fixed place so the hand learns it: Pracownicy (opens Poddani
  filtered to who could take the trade: a site's builders, a store's traders, else the house's own
  craft, one with a free seat first, never its carriers or collectors; faded for a house employing
  none), Wiedza (the type's Knowledge entry), Zburz in red, which asks in the confirmation dialog
  first, and last Rozbuduj (its tooltip the next tier's bill; faded with the reason when the house is
  unfinished or a technology is missing), with Anuluj in its place while a tier is being raised. A
  top tier has no Rozbuduj, so only the last place stays empty. Another seat's house offers Wiedza
  alone. The status
  strip along the frame's floor carries the alarm bell at its end for a house that shelters civilians
  (gold while the alarm is up), shows its whole words in a tooltip when they are cut short, and names
  the first state that holds: Budowa or Rozbudowa with the percent and a proven stall (brak
  materiałów and brak budowniczego in amber, dostawa w drodze in green), Alarm with the sheltered
  count in amber, Zamieszkany or Pusty for a home, Pracuje with the product of the batch furthest
  along, Brak załogi in amber or Obsadzony for a house with tower posts (by its garrison alone,
  whatever its carriers do), Brak pracowników in amber, Bezczynny with the
  stall the first posted worker reports in amber, Pracuje, and Czynny for a house without work.
- Budowa (Rozbudowa for a tier): the percent on the rule, then a line per material of the bill: the
  good's well, its name, "delivered / needed" with "+N" on the way, and the delivered share on the
  thin rule under the line; a delivered line reads muted, and a line still short after what is on its
  way reads amber with "brak" when the owner holds none of it anywhere else.
- Every person well is a 28 × 36 px niche with a shade pool under the feet, the person in it live as
  the map draws it: walking, working, resting, a hero in its glow.
- Pracownicy: a line per declared seat trade, its label over a dotted leader and a well per seat, the
  posted people then the free seats empty, six to a row; the sheltering crowd under an alarm
  and the recruits drilling there follow as their own lines (a worker sheltering where it works stays
  on its trade's line). A press on a trade's free seat opens Poddani filtered to that trade. A line
  holds twelve wells: free seats give way first, and people past that read
  "+N" in the last well. The rule carries
  the posts filled of all. Mieszkańcy for a home: the families side by side (the man, the woman, the
  child), an empty well per free family place, the families of all on the rule. A site keeps its
  Pracownicy or Mieszkańcy, posted before it stands, under Budowniczowie: the crew raising it, "nikt"
  while nobody is. A press on a figure selects the person.
  Workforce is assigned from the person's panel; the building side only shows it.
- Produkcja: a line per product in recipe order (a breeding farm's per species, its herd against the
  cap in the name), its ingredients beside the name as the good and "have/need" for one cycle (amber
  while the shelf lacks it; the full name comes first, and the ingredients that do not fit beside it
  are left to the tooltip), the running batch's percent on the rule and in figures, the recipe in the
  tooltip;
  a product with no batch running reads muted. A list of four products or more shows only the
  batches in flight ("Nic teraz nie powstaje" while none runs) behind "rozwiń (N)" at the title's
  end, so Magazyn stays in view; "zwiń" folds it again, and the choice holds for the next house. A
  farm has one line: its fields and how many are ripe, the ripe share on the rule. What each worker makes is set in the worker's panel.
- Wyposażenie (a finished home): a line per household ware of the home's tier (holy oil from
  Poziom 3; a house placed at a higher tier outright stands on that tier), its pool on the rule
  and what it buys ("48 użyć", the holy fire "płonie" / "wygasły"), and a round toggle, a tick while
  the owner allows the ware in every home and a crossed circle while forbidden. The toggle is the
  owner's seat's only.
- Umowy handlowe: the agreements the house offers a visiting trader as the trader's read-only chips
  "1 [coin] → 4 [iron]"; another seat's trade house shows them too.
- Magazyn, last: every good the house stores in its slot order (a workshop's inputs before its
  products), "amount / shelf" (a decimal only for a
  banked fraction), the shelf's fill on the rule, an empty shelf muted, the input a posted worker waits
  for in amber and a product's full shelf in red, since production stops there. A workshop lists its
  inputs under a small "Zużywa" caption and its products under "Wytwarza". A store lists its goods under the stock's icon
  tabs, opening on Wszystkie (its eight largest stocks, most first), then one category per tab (a
  category the house does not store faded, a dot on one that holds something); any other house lists
  every shelf.
  Past its 200 px (eight lines, fewer under captions) the list scrolls in place and fades at the
  bottom; when the panel would run past the plane, the list alone gives way, down to three lines.
- First paint at map start, as the settler panel's: a made-up building lights every section once.
- Another seat's building: class, name, owner line with the stance, the portrait, the wear, the state
  and its agreements; no order, no staff, no production, no stock.

### Mission book

Misja is an open book over the map, not a framed window: the wood rails, bronze line
and top knot of the window family (no corner ornaments) around a painted spread (`assets/ui/mission-book/spread.webp`:
carved cover, bronze fittings, two vellum pages), and the tabs Zadanie, Cele and Kronika standing out
of its fore-edge as wood tabs, parchment when selected. The page rectangles are measured on that
spread, so a new spread must keep them or move `.on-book__spread`. The book keeps its 990 x 620 design
size and shrinks whole on a screen that cannot hold it.

- Only what the map provides: the page's text, its pictures, its world views and its goals. No
  narration, and a page the author left untitled gets no invented title; the book prints its chapter
  number and the map's name over it.
- A chapter's text flows across both pages in columns and is turned, not scrolled: the curled page
  corners turn a spread and at a chapter's end step into the next chapter (the arrow turns red), and
  so does the wheel. The turned page lifts and flips over the gutter, its back the new page there.
  The flip answers the reader's own click, so it plays under reduced motion too. Pictures
  and world views stand inside the text where the page places them; a narrow picture is a portrait,
  an oval beside the quote that follows it. A page whose prose the author centred as a whole is set
  flush left; a few centred lines (captions, a table's entries, links) stay centred.
- Prose is justified and hyphenated in the page's language. The page's own markers carry over: its
  headline font sets the title and the headings, centred and right-aligned lines stay so, red and
  dimmed ink stay (white and dark read as the book's ink),
  and its empty lines keep their weight: none sets the next line close under the last, one is a
  paragraph gap, two or more open a section. The format has no other emphasis to honour.
- A world view is a hole in the painted book that the renderer fills with the live map, with its own
  "Pokaż na mapie", which closes the book and centres the view there. The renderer copies the shown
  views into stills about once a second; a turning leaf shows those, while the new spread's views
  are live under it from the turn's first frame.
- Goals list what the script currently marks visible: the open ones with a box, the visible but not
  yet active ones after them in muted ink without a mark, the done ones on the right page with a green
  seal. No total and no count of what is still to come; the Cele tab counts the open goals only.
- Kronika lists the chapters delivered so far, a preview of the picked one and its "Czytaj", and the
  history tables the game ships, read in the same book with their links.
- The open book holds the game until the close medallion or Escape shuts it, however it opened; the
  book itself says nothing about the pause. A script's chapter opens the book on it marked "Nowy
  rozdział" and dims the map. On a shared clock nothing is held and the map is not dimmed.
- The goal slip hangs from the top bar at the right edge, or below the script's info lines when they
  stand there: a leaf of the book's vellum (`vellum.webp`) under a strip of the cover's carved band
  (`band.webp`), with bronze fittings at its lower corners. It folds up into its band tab "Cele" with
  the open count. It lists the goals just done,
  then the open ones with the new first, up to four, and "Otwórz księgę" with the book's key. The open
  slip shows a change for thirty seconds of real time: then a done goal leaves and a new one loses its
  tag. A goal change never unfolds it: the folded tab and the beam's Misja entry carry a wax seal until
  the open slip or the goal page shows the change. The slip hides while the book is open and with the HUD.

## HUD shell

The runtime shell (ticket 02) places the regions on the DOM plane in design px and keeps the legacy
Pixi panels behind the new navigation until their owner tickets replace them.

| Region | Placement | Content today |
| --- | --- | --- |
| Navigation beam | bottom centre, 420 × 72, seven 56 × 64 actions | Buduj, Poddani, Asystent, Statystyki, Misja, Dyplomacja, Wiedza |
| System bar | top right, flush with both edges | residents and five stock counters with breakdowns, the sim clock, pause / ×1 / ×2 / ×3 segments, menu medallion (rules below) |
| Notifications | left 10, top 18, width 173, ends 16 px above the minimap | three seal filters with tallies over the fanning card list (rules below) |
| Central window | centred on the screen's vertical axis, the beam's; top 96, floor at the beam, slid right of the minimap when a narrow screen would put it over the corner | one window at a time; Wiedza shows a framed pending note |
| Selection | bottom right: the 318 px settler, vehicle and building panels, the legacy 322 px panel for the rest | lifts above the beam when the beam reaches under it (narrower than 1056 design px for the settler panel, 1076 for the legacy one) |
| Minimap | bottom left, S/M/L/XL Atlas; outer aspect at most 1.5:1 | fixed 32 px corner glyphs; right-edge controls and filter disclosure; uniformly scaled terrain; 6 design-px navigation gap |

Rules the shell enforces:

- A beam action shows no focus ring: its pressed art and its label are the cues.
- One central window at a time. A beam entry closes the other window and toggles its own; the same
  entry pressed again closes it. Buduj, Asystent and Misja drop a held placement or paper first;
  Statystyki, Dyplomacja, Poddani and Wiedza leave a running placement alone.
- Esc steps back one level per press: a held placement or paper, then the open central window, then
  the unit controls' own ladder (job list, armed order, selection). The shell handles Esc before the
  other listeners and stops it once it consumed the press. With every rung clear, Esc opens the game
  menu: that last step is the rebindable "Menu gry" action (default Esc, the one action Esc may hold)
  and on any other key it opens the menu at once.
- Closing with Esc or the close medallion returns keyboard focus to the beam entry that owns the
  window. Only the mission book and the system menu hold the simulation paused; other windows never
  touch the pause.
- A wheel over a DOM region never reaches the camera. The edge pan keeps working over every region,
  so chrome along a screen edge never blocks scrolling. Presses on a region never reach the map;
  presses on the map keep the window open and select independently, with the details panel in its
  own corner.
- A legacy window that cannot fit above the beam shortens its list or lifts toward the top bar; a
  window wider than the region centres on the screen and yields to the minimap as before.
- The DOM plane takes every press inside a window, so a central window never stands over the minimap:
  on a screen too narrow for the centred window to miss the corner it starts at the minimap's right
  edge instead, and only a window too wide for the free space stays put, with its right edge on
  screen. Height is not the test, so a window keeps one place while its content grows.

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
  as, the sim's `EDIBLE_FORM_BY_DISH`, so bread and meat are food and candy is cake), Materiały
  (wood, stone, clay, iron, gold, mushrooms, leather, wool | brick, tile, stone block, marble, holy
  oil), Uzbrojenie (six weapons | four armours), Wyposażenie (shoes,
  wooden and iron tools, crockery, furniture), Inne (herbs, six potions | coin, six amulets). A listed
  good with nothing on hand stays listed as a muted zero; a stocked good outside every list is
  appended to the shorter Inne column, so nothing on hand goes unreported. Water is the one exception:
  a well's working stock, never reported. Row names are the content's localized good names, never a
  second copy in the catalogs.
- A category's icon is its representative good (food, wood, short sword, shoes, strength amulet): the
  presentation pack's icon when it has one, else the original's recoloured pile frame, sized by area
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
  a translucent backing that shows the map through; a vehicle is drawn the same way, fitted whole
  into the box and never enlarged past the map's size, and a subject no longer drawn (a cart driven
  aboard) turns to the scroll; a finished or upgraded building is its body as
  the construction card pictures it, painted once; an attacked settler, building or vehicle, a
  death, a seat, a paper and a subjectless row show a flat graphic emblem from the notification
  atlas instead (sword and axe, house for a building whose type is gone, skull on a dim backing,
  shield for a first contact, banner for a changed stance, chest, scroll). A card about another seat
  (first contact, changed stance, a seat out of the game) paints the shield face, the banner cloth
  or the skull in that seat's colour; an own settler's skull is bone ivory. The bronze line glyphs
  stand in while the atlas is undelivered or fails to load. The seal stands midway between the
  thumbnail and the event line, 4 px clear of each, and the seal, the event line and the × share one
  line, centred in the card's visible part; the card carries no hairline, the seal alone tells the
  weight.
- Left click or Enter centres the camera on the target and selects it, without a window. A card with
  no target left (an unnamed death, a seat) has no chevron, and a press pins its message instead.
  Right click, Delete or the × dismisses one card; Shift with any of them, or the bin button beside
  the seal filters, dismisses every shown card. The × stays on every card, so a covered card closes
  without parting the fan. Nothing else the player does removes a card: selecting or deselecting its
  subject leaves it, against the original, which clears a human's notes on deselect. A card goes only
  by dismissal, when its cause ends or when its lifetime runs out.
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

### Hover card

The cursor over a settler or a building opens a parchment card beside it, the summary bar's breakdown
sheet (`.on-tip`) as a free-floating surface. Original behavior: the engine draws a tooltip overlay for
the house under the cursor with its name, its construction or upgrade state, and one line per good it
holds.

A settler wins the cursor over whatever it stands on or in front of: it is the thing that moves, and a
house it is walking past is still there once it has gone.

- Head: the name in the breakdown sheet's small-caps title, and one muted line under it. For a
  building that line is the original's own `misc` state with the built percentage, "Budynek jest
  budowany (37%)", and only while it is a site or an upgrade.
- A settler's card is one line: its given name and, beside it, its trade, with no rule between them
  and no width floor under them. The surname stays with the details panel, which has the room for it.
  Nothing it carries or needs either, so the card is small enough to read while the settler walks.
  Wildlife and livestock have neither name nor trade, so the cursor passes through them to what they
  stand on.
- Lines: the goods the building holds, each the good icon, its localized name over a dotted leader
  and the amount to one decimal, as the store rows read it. A good at zero is no line, so the card
  says what is inside rather than what the type could hold. Lines are ordered by the localized good
  name, the original's own order. A site lists its bill instead, "delivered / needed", since its hold
  carries materials rather than wares; the original leaves the bill to its window.
- A building holding nothing is its name alone. Every building kind answers the cursor: store,
  workshop, home, military and site alike.
- The card flows into a second and third column past sixteen lines, so a warehouse's whole store
  stands in one card; a column is at least 104 px and grows to its longest good name, and the card
  itself stops at 480 px, which the content's longest names in three columns fit inside.
- Its type is half the summary bar's: 9 px lines under a 10 px title, with a 13 px good icon. The
  card is a reading aid over the map, not a panel, so it stays below the chrome in weight as well.
- It sits below-right of the cursor, flipping to the other side rather than leaving the screen, and
  never takes pointer events, so the press under it still reaches the map. It yields whenever the
  world hover does: over any HUD region, and while a placement is held.
- It opens only after the cursor rests a quarter second on one thing, so crossing a settlement does
  not flash a card over every house and passer-by on the way. Moving to another restarts that rest.

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
- Construction displays the actual game building, cut from the loaded sheet into the card's canvas
  (`building-thumb.ts`); a type without a sheet frame falls back to the house glyph. Character and
  building artwork is not redesigned here.
- Runtime UI must support both original and own asset sets; decoded original data stays outside Git.

## Original art and remaining work

The painted action icons, the notification emblems and the surface texture are the `ui/foundation` art package,
whose art sources live outside this repository:
the 4 × 2 atlas `nordic-icons-v4.png` of simple single-object icons, the game-menu sheet
`nordic-menu-v1.png` (its oak door is the menu medallion), the 4 × 2 notification emblem sheet
`nordic-notices-v1.png` (flat emblems whose magenta areas are the seat-colour key) and the carved
wood/leather material study `nordic-surface-v1.png`, each with its generation record. The reference
page samples the masters directly; the runtime uses the package's delivered atlas and texture. The
atlas's pawn and door cells, the menu sheet's other candidates and the emblem sheet's horn are
unused.

No original game UI art is copied. Panel contents and illustrative counts are not production
specifications.

## Resume the local review

Serve the reference from any checkout of this repository with

```sh
node docs/design/ingame-menu/serve.mjs 5187 <review-dir>
```

and open `http://127.0.0.1:5187/`. The server reads repository files first and falls back to the
local review directory for fonts, `world.png` and the decoded review inputs, so nothing is copied
into the temporary directory. Do not use `python3 -m http.server`: it drops parallel connections on
this page and previews load randomly. `index.html` in the repository is the architecture wireframe,
not this visual reference.

Local-only review inputs in `<review-dir>` (never add these to Git):

- `alegreya-400/500/700.woff2`, `alegreya-latinext-400/500/700.woff2`, `cinzel.woff2`, `cinzel-latinext.woff2`: the
  review fonts, copies of the runtime subsets in `packages/app/public/fonts/`; the repository page falls back to
  system fonts without them, and without the Latin Extended files Polish diacritics fall back alone.
- `world.png`: existing map capture; preserve it while the temporary directory exists.
- `review-characters/ir.json`: copy of the primary checkout's generated `content/ir.json`.
- `review-characters/`: original `content/bobs/cr_hum_{body,head}_{00,05,10,20,21}.test_human_00`
  PNG/atlas.json pairs. The preview reads tribe 1 jobs 6, 5, 4, 3 and 31, compositing body/head with authored offsets.
- `review-goods/manifest.json`: `content/goods/manifest.json`, and every `ls_goods.*` PNG/atlas.json pair from
  `content/bobs/` (the settler panel samples tools, arms and food across several palettes).

If the temporary directory is lost, restore these from the primary checkout's generated content,
and use the mockup's terrain fallback until a fresh permitted local world capture is available.
Missing original assets are reported below the preview; do not mistake empty canvases for success.

## Profession and school choice flow

Use the shared compact, narrow window and a single column of grouped choices. The profession list opens first, with search
focused and its existing text selected. Search matches the beginning of a choice label. Clicking a
profession completes a zero/one advanced-method choice immediately; multiple discovered advanced
methods require one choice in a second window, without search. Keep the frame at the same position
when filtering or changing pages; clamp it to the viewport when needed. Dismissing that window returns
without submitting.
Do not show an action-description strip below the choices. The runtime surface is `packages/app/src/hud/dom/choice-window.ts`, styled in the shared
`foundation.css`. The school scene provides the in-game review path.

School method courses do not require the pupil to already hold the profession. A civilian may choose
Smith and learn one discovered advanced method directly. Basic production is excluded from the
advanced-method count: basic plus long sword chooses long sword immediately; long sword, chainmail
and plate armor present those three choices. Learning one does not grant the other advanced methods.
