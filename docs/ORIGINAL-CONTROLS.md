# Original controls

This document records how *Cultures - 8th Wonder of the World*, as shipped in CulturesNation mod
1.3.2, is controlled in a running map: keyboard, mouse, camera, selection, control groups, the
action menu and the buttons of the selection and tool windows. It closes with a comparison against
Open Northland. The left HUD bar and its windows stay in
[`ORIGINAL-INGAME-MENU-BAR.md`](ORIGINAL-INGAME-MENU-BAR.md); this document only corrects it.

This is scaffolding for aligning Open Northland's controls with the original, not a durable
reference. Move anything worth keeping into the owning code, test or reference once the controls
work is done, then delete this file.

## Sources and confidence

- The in-game key help page (`Data/text/<lang>/hypertext/ingamehelp/keys.txt`). The mod ships it
  byte-identical to the base game in all four languages, so the help lists no mod key.
- The complete manual, chapter 9 and the key appendix
  ([online manual copy](https://www.scribd.com/document/978738232/Cultures-4-Manual)).
- The in-game GUI string tables for tooltips and labels.
- Study of the original's behavior, as `docs/LEGAL.md` allows. Every input and button below was
  read from the original's behavior; none was checked in a running copy yet.

**Confirmed** means the original's behavior agrees with the help page or the manual.
**Unconfirmed** means the behavior is attributed to the original but neither the help nor the
manual describes it. **Requires observation** marks a conflict or gap that only a running copy can
settle.

## Key matching

- All in-game hotkeys come from one fixed table of 86 entries. The base game and both CnMod
  versions share it; CnMod 1.3.2 appends six keys (see [CnMod 1.3.2](#cnmod-132-differences)).
  There is no rebinding.
- A key matches only when Shift and Ctrl are exactly as the entry says. Alt is ignored.
- Letters and punctuation match the **typed character**, so they are case-sensitive and follow the
  keyboard layout: `b` and `B` are different keys, and a German layout swaps `y` and `z`. Caps Lock
  breaks every letter hotkey, because the character turns uppercase while Shift stays off
  (unconfirmed).
- Digits, F-keys, arrows, numpad, Esc, Tab and Space match the **physical key**, so `Shift+1` works
  regardless of the `!` it types.
- Scroll keys and Tab are polled while held, not handled as key presses.
- Only left Ctrl counts as Ctrl for modifier clicks (unconfirmed).

A key press is offered in this order: the rename text field, the construction list (a letter jumps
to the first building starting with it), the single-settler keys `c`/`a`/`w`, the multiplayer chat
line, the hotkey table, then `Ctrl+B` and `Ctrl+S`.

## Keyboard

| Key | Condition | Original behavior | Status |
| --- | --- | --- | --- |
| `Esc` | - | One step per press: cancel the active tool or target pick; else close the front window; else deselect all | Confirmed |
| `F1` | - | Help window | Confirmed |
| `F2` | - | Options window, general page | Confirmed |
| `F3` | - | Options window, load page | Confirmed |
| `F4` | - | Options window, save page | Confirmed |
| `F5` | - | Diplomacy | Confirmed |
| `F6` | - | Statistics | Confirmed |
| `F7` | - | Subjects list, unfiltered | Confirmed |
| `F8` | - | Technology tree | Confirmed |
| `F9` | - | Quick save, with a message line | Confirmed |
| `F10` | - | Toggle the minimap window | Confirmed |
| `b` | - | Construction window | Confirmed |
| `s` | - | Road tool | Confirmed |
| `d` | - | Stockade tool | Confirmed |
| `Shift+D` | - | Gate tool | Confirmed |
| `Shift+B` | - | Extras window (help: "papers window") | Confirmed |
| `e`, `Shift+A` | - | Both open the Extras window on the same page (help: `e` "extras menu", `A` "assistant") | Confirmed; which page requires observation |
| `o` | - | Opens a **new** observation window each press; it follows the current single selection, else shows the main view's centre | Confirmed |
| `v` / `Shift+V` | - | Global defence mode on / off for the local player (a synchronised command) | Confirmed |
| `p`, `Shift+P` | - | Pause toggle; unpausing restores the previous speed (synchronised) | Confirmed |
| `l` | - | Speed cycle: normal -> double -> triple -> normal; pressed while paused, resumes at normal | Confirmed |
| `z` | - | Toggle between the normal and the zoomed-out view, in the main view and every observation window | Confirmed |
| `h` | - | Centre on the **first** own headquarters or warehouse; repeated presses do not cycle | Confirmed (help says headquarters only) |
| `.` | no tool active | Select the next own idle civilian after the current one, wrapping; the camera does not move | Confirmed |
| `,` | no tool active | Same for scouts | Confirmed |
| `f`, `Shift+X` | - | Deselect, then select **all own heroes on the whole map** | `f` confirmed, `Shift+X` unconfirmed |
| `Shift+Y` | - | Deselect, then select all own soldiers **without a weapon**, whole map | Unconfirmed |
| `x` | no tool active | Drop every non-hero from the selection | Confirmed |
| `y` | no tool active | Drop every non-soldier from the selection | Confirmed |
| `Space` | a selection | Open the action menu at the cursor; pressing again re-anchors it | Confirmed |
| `c` | one settler, order offered | Same as the Change Profession menu button | Confirmed |
| `a` | one settler | Assign Work Place, or Assign Building Site for a builder | Confirmed |
| `w` | one settler, order offered | Assign Home | Confirmed |
| `0`-`9` | group exists | Select the group; if it is already the selection, centre the camera on it | Confirmed (centring unconfirmed) |
| `Ctrl+0`-`9` | - | Replace the group with the selection | Confirmed |
| `Shift+0`-`9` | - | Add the selection to the group | Confirmed |
| Arrows | held | Scroll | Confirmed |
| Numpad `8 2 4 6`, `7 9 1 3` | held | Scroll; corner keys scroll diagonally; numpad 5 is unbound | Confirmed |
| `Tab` | held | Show every settler's and building's tooltip while held | Confirmed |
| `Enter` | multiplayer | Open the chat line; `Enter` sends, `Esc` cancels | Confirmed |
| `Ctrl+B` | - | Screenshot to a numbered bitmap | Confirmed |
| `Ctrl+S` | - | Quick save with a "saved in N s" message | Confirmed |

The manual also lists `Ctrl+F3` for the large map. No such key exists; the large map opens from the
minimap's globe button.

Typed cheat words also exist: one toggles the fog, two dump the map to a bitmap, one cycles a
display filter. The main menu has campaign-unlock words, and CnMod adds one. None is a player
control.

## Mouse

The options window offers two schemes (`Input Mode`, labels Old / New). The default, which the
manual describes ("all actions are carried out by right-clicking; press the left mouse button to
cancel an order"), is:

| Input | Original behavior | Status |
| --- | --- | --- |
| Left click (acts on release) | With a tool or target pick active: cancel it with the fail sound. Otherwise select the object under the cursor; empty ground deselects all | Confirmed |
| `Shift` / `Ctrl` + left click | Add / remove a settler or vehicle to or from the selection. Buildings, animals and landscape objects ignore modifiers and replace the selection | Confirmed |
| Right click (acts on press) | First match wins: 1. place or pick the target of the active tool; 2. the contextual order for the selection against the object under the cursor; 3. walk the selection there; 4. select the own object under the cursor and open its action menu | Confirmed |
| `Ctrl` + right click | Set the work-area centre for an outdoor worker without a work building (explored ground in the same walk area) | Confirmed |
| Left drag | A box counts only if it is at least 5 px in **both** directions; a thinner drag is a click | Unconfirmed |
| Box contents | Own visible settlers whose sprite touches the box: men, women, children, soldiers, heroes. No vehicles, buildings or animals, no soldier priority, at most 300 | Unconfirmed |
| Box modifiers | None: one hit selects it, several replace the selection, **zero hits keep the selection**. `Shift` adds all hits, `Ctrl` removes them | Unconfirmed |
| Double-click a selected settler | Select every own settler with the **same job** inside an 800x600 world-pixel box around the cursor; all hero jobs count as one. `Shift`/`Ctrl` add/remove | Confirmed (box size unconfirmed) |
| Double-click timing | Second press within 400 ms and 4 px; left releases within 250 ms after it are ignored | Unconfirmed |
| Middle drag | Scrolls the camera by the mouse motion times scroll speed / 300, in the mouse's direction; option, default on | Confirmed |
| Wheel | Steps between the two zoom levels | Unconfirmed |
| Screen edge | Scrolls when the cursor is within 2 px of an edge; option, default on | Confirmed |
| Hover | Flashes outlines: an own building marks its residents and workers (up to 20); an own settler marks family members, home and workplace | Confirmed |

The alternative scheme moves orders to the left button (target pick, contextual order, walk, then
select) and makes the right button select and open the action menu.

Contextual right-click orders, one settler selected, first match wins:

- Enemy adult: attack. Friendly settler: no order, falls through to walk or select.
- Animal: attack if allowed; scouts have special handling for some animals.
- Vehicle: attack if hostile, else board it when there is room.
- Foreign building: attack if hostile; a trader adds or removes it as a trade post.
- Own building: join as builder at a site, move in as home, trader post, work there, learn there
  (school or barracks), change profession and work there, work there.
- Landscape object: attack if enemy-owned; a gatherer sets its work-area centre on a resource it
  produces, or switches product and centre; pick up a lying equipment item; open a chest.
- Own road or stockade marker: go build it.
- Ground: walk there, or "explore" on unexplored ground.

With several settlers selected, the first member picks an order and every other member must produce
the same one, otherwise the group simply walks. There is no `Ctrl` variant for groups.

## Camera

| Topic | Original behavior | Status |
| --- | --- | --- |
| Scroll speed | Options slow / medium / fast = 300 / 600 / 1200 px per second, default medium | Unconfirmed values |
| Zoom | Two levels: normal and zoomed out to half scale. `z` toggles, the wheel steps, the screen centre stays | Confirmed (levels unconfirmed) |
| Edge | The view may pass the map edge by about 100 to 200 px | Unconfirmed |
| Jumps | `h`, group key on an already-selected group, minimap click, subjects-list click, centre buttons in the selection windows, message Select | Confirmed |
| Follow | A selection window's follow button keeps the main camera on a settler or vehicle; a second press ends it | Confirmed |

## Cursor

The cursor shape never changes with context. Three images exist: normal, held left button, and
middle-button scrolling. Context is shown as text about 20 px under the cursor instead (confirmed
by the manual):

- an active tool: its name, plus the building name while placing;
- an available contextual order: "<settler name>: <order>", for example the job a change-profession
  order would give;
- otherwise hover information: settler name, job, product and experience; building name; landscape
  or animal name.

Tooltips on buttons appear on hover, immediately or after 500 ms depending on the element. An option
turns most hover text off; `Tab` shows all world tooltips while held.

## Control groups

| Topic | Original behavior | Status |
| --- | --- | --- |
| Count | 10 groups on keys `1`-`9`, `0`; saved with the game | Confirmed |
| Members | Settlers and vehicles, or exactly one building | Unconfirmed |
| Building rule | A building belongs to one group at a time, and a group holding a building holds only that building | Unconfirmed |
| `Shift+digit` | Adds; members stay in their other groups | Confirmed |

## Action menu

| Selection | Shape | Status |
| --- | --- | --- |
| One or several settlers | A cross of 32x32 icons around the cursor: bottom row, top row, right column, left column and an inner left column, inside a 232x232 box kept on screen | Confirmed |
| Vehicles, one building | A vertical text list, 240 px wide, opening to the **left** of the cursor | Unconfirmed |
| Animals, signposts, landscape | No menu | Confirmed |

Settler arms, in screen order:

- Bottom, left to right: Have a Girl, Have a Boy, Marry, Pray, Talk, Sleep, Eat, Go To.
- Top, left to right: Change Profession, Change Equipment, Assign Work Area, Show Work Area,
  Erect Signpost, Explore.
- Right, top to bottom: Remove / Assign Trade Post, Remove / Assign Building Site, Remove / Assign
  Learning Place, Remove / Assign Work Place, Remove / Assign Vehicle, Remove / Assign Home.
- Left, top to bottom: Attack Inhabitants, Attack Building, Attack Animal, Attack Vehicle, Attack
  Position.
- Inner left, top to bottom: Attack Mode, Defence Mode, Ignorant Mode, Allow Regeneration, Prohibit
  Regeneration.

Behavior:

- An order the selection cannot take is absent, not greyed. The menu re-lays itself at the same
  anchor whenever the offered set changes, and follows a new selection there.
- Buttons react to the left click only, with no modifier variants. A button closes the menu.
- Explore is immediate; every other targeted order arms a target pick and hides the left bar
  while it is active.
- A group gets the intersection of its members' orders. Groups never get Go To, home, work place,
  learning place, building site, trade post, work area, scout orders or Assign Vehicle.
- A hero gets only Go To, vehicle orders, the two stances it is not in and the attacks. A settler
  inside a vehicle gets only Remove Vehicle.
- Vehicle list: Remove Vehicle, Go To, Moor or Assign Vehicle, four catapult attacks, two catapult
  stances, Unload Goods, Disembark People. A group with a non-catapult gets no list.
- Building list: Demolish (asks for confirmation), Upgrade, Cancel Upgrade, Allow / Prohibit
  furniture, crockery and oil for homes, Start / Stop Defence Mode.

Openers: `Space`, right click as in the mouse table, right click on a portrait or mini view in a
selection window, right click on a resident in a building window or on a figure in the group
window.

## Window buttons

All selection windows anchor at the bottom right and stack collapsible sections. Each section header
has an expand/collapse button, and the collapse state is remembered per window kind. Unavailable
buttons vanish instead of greying out. Popups have a draggable title bar and an `X`, and close when
the selection changes.

Recurring button graphics: arrow "->" selects or centres, a positive mark assigns or allows, a
negative mark removes or prohibits, plus and minus change counts, an eye opens an observation window,
and an info button opens Help.

### Settler window

| Section | Shown for | Controls |
| --- | --- | --- |
| General | everyone | Live portrait (left: centre, right: action menu); Centre; Observe in a new window; Follow in main view (toggle); Name button opens Rename (not for heroes); rows for partner, child, mother, father, home and vehicle, each with Select and, where allowed, Marry, Have a Girl / Boy, Assign / Remove Home, Assign / Remove Vehicle |
| Military | adult soldiers and heroes | Text only: soldier mode, eat/sleep allowed, weapon experience |
| Work | adult working men except heroes, scouts and traders | Select / Assign / Remove Work Place or Building Site; Assign and Show Work Area; one line per producible good with Produce This, minus, plus and Info |
| Experience | adult men except heroes | 11 category tabs, the first is "Highest Experience" |
| Equipment | equipable settlers | Change buttons for weapon, armour, shoes, tools and four inventory slots |
| Trade | traders | Two trade-post rows (Select, Assign, Remove) and Set Merchant |

Production counter: 0 to 10 items, then infinite. Plus and minus step by one and wrap between none
and infinite. **`Ctrl` jumps straight to infinite or none** (confirmed).

Popups: Change Equipment (equip or put away per good, works for groups), Change Profession (sorted
jobs, current one marked; a job that needs a workplace arms Assign Work Place after the change;
collectors list their goods), Rename (12 characters, `Enter` applies, local display name only),
Change Production, Learn Profession (opens when a settler is sent to a school), Trader setup (route
import toggles per good per post, or one agreement for a foreign post).

### Group window

An "Action!" button opens the group's menu. Each figure: left click selects only that settler,
`Ctrl` + left click removes it, right click selects it and opens its menu. Up to six settlers show
health and need bars; more show a compact grid.

### Building window

| Section | Shown for | Controls |
| --- | --- | --- |
| General | own building | Mini view (left: centre, right: action menu); Upgrade (the cost line also starts it); Cancel Upgrade; Demolish (asks Yes / No); Centre; Workers (opens the subjects list filtered to the building's job); Help |
| Defence | finished buildings that can defend | Start / Stop Defence Mode toggle; Dismiss soldiers (detaches up to 10 soldiers working there; not at the headquarters) |
| Building site | under construction or upgrading | Text only: progress and material lines |
| Furnishings | homes | Allow / Prohibit furniture, crockery and oil (oil from level 2); family count |
| Store | warehouses, barracks, other buildings | Warehouse: seven category tabs (largest stock, food, building materials, resources, weapons, bonus items, miscellaneous). Click a good, then set its **minimum** with minus / plus, 0 to 100. **`Ctrl` steps by 10** (confirmed) |
| People | own building | Portraits of residents, workers and builders (left: select, right: select and open its menu) |
| Opponent | foreign building | Centre; trade offers for friendly stores |

There are no production buttons on buildings.

### Vehicle window

Sections General, Merchant, People and Warehouse. General: mini view (left centre, right menu),
Centre, Observe, Follow, Unload people and goods, Unload goods, Moor (ships), and Select / Assign /
Remove ship for a vehicle a ship carries. People: passenger portraits (left select, right select and
menu). Warehouse: the seven store categories with a wanted amount per good; **`Ctrl` steps by 10**
(unconfirmed). Several vehicles: an icon grid where left selects one, `Ctrl` + left removes it, and
right selects it and opens its list.

### Subjects list (`F7`)

All, Profession, and Possible Profession (each opens a job chooser), plus 12 exclusive filter
buttons: men, women, children, heroes, soldiers, workers, homeless, unmarried, women without
children, without shoes, without tools, soldiers without weapons. The filter survives closing.

- Row: left click selects, centres and closes the list; right click also opens the action menu.
  `Shift` + click adds and keeps the list open; `Ctrl` + click removes.
- **Select**: replace the selection with the whole list; `Shift` adds, `Ctrl` removes.

### Observation window (`o`)

Several can be open. Buttons: Magnify (zoom toggle), Follow (re-target to the selection), Select
(select the followed object), Jump To. Left click on the view jumps the main view; right click
selects and opens the menu. The manual says a left click selects, which **requires observation**.

### Minimap and large map

- Minimap buttons: Close (a reopen button appears at the bottom left; `F10` also toggles), view mode
  (cycles everything, soldiers only, simple terrain, no terrain), large map, zoom in, zoom out.
- Map input on both maps: left press jumps and keeps following while held, right click sends the
  selection there, the wheel zooms.
- Large map toggles: inhabitants, soldiers, animals, vehicles, buildings, signposts, stockades,
  roads, simple or no terrain, sheep, cows, chests, zoom. The filters are remembered.

### Messages

Right click on a message note deletes it; **`Ctrl` + right click deletes all** (unconfirmed). A
left click opens the message window with Delete Message. The manual says a left click centres on and
selects the message's subject, which **requires observation**. Unlock messages carry Help buttons
for new goods and buildings.

### Small windows

- Signpost: Centre; Demolish (no confirmation); nearby goods.
- Stockade or gate: Centre; Remove; Open / Close Gate.
- Road or stockade marker: Centre; Remove.
- Building type, animal: no buttons.
- Quit and mission-end box: Yes, No, and Restart after a lost mission.

## CnMod 1.3.2 differences

CnMod 1.3.1 changes no input. CnMod 1.3.2, the pipeline's input, adds these. Neither the help page
nor the manual mentions them, so all are unconfirmed:

| Key | Original behavior |
| --- | --- |
| `>` (`Shift+.`) | Add the next unselected own civilian to the selection, one per press |
| `<` (`Shift+,`) | Same for scouts |
| `/` | Select the next settler of one filter, probably adult women without a partner |
| `?` (`Shift+/`) | Add the next settler of that filter |
| `m` | Deselect, then select all own soldiers on the map |
| `Shift+M` | Add all own soldiers to the selection |
| `Ctrl` + Assistant minus / plus | Step by 10 |

The mod adds no window, button or GUI string. Its other GUI changes are data: new goods, buildings,
jobs and tribes fill the existing lists.

## Corrections to the menu-bar document

- The construction key is lowercase `b`. `Shift+B` is the Extras window.
- The minimap can be closed. A reopen button and `F10` bring it back. The large map has no key.
- A message note's left click opens the message window rather than centring (requires observation).

## Open Northland comparison

| Original | Open Northland today | Verdict |
| --- | --- | --- |
| Right click = order, then select and menu | Right click orders; on an own settler it selects and opens the ring | Same, except the own-settler shortcut |
| Left click cancels an active tool | Right click or `Esc` cancels; left click picks the target | Different |
| `Ctrl` + right click work centre | `Ctrl`/`Cmd` + right click sets the work flag (rebindable) | Same |
| `Shift` + click adds, `Ctrl` + click removes | `Shift` + click toggles; `Ctrl` + click is no selection modifier | Different |
| Box: settlers only, `Ctrl` removes, empty box keeps the selection | Settlers and vehicles, `Shift` adds, no remove | Different |
| Double-click: same job in 800x600 | Same trade visible in the view | Close |
| Middle drag, edge scroll, two zoom levels | Middle drag with pointer lock, 24 px edge, smooth wheel zoom 0.35 to 8 | Different by design |
| `Space` action menu | `Space` toggles the ring | Same |
| `c` change profession | `C` profession list, also for groups | Same |
| `a` assign work place | `A` is attack-move | Conflict |
| `w` assign home | none | Missing |
| `b` construction, `s` road, `d` stockade | `B`, `S`, `D` | Same |
| `Shift+D` gate | none | Missing |
| `Shift+B` / `e` / `Shift+A` extras | `F3` Assistant | Different |
| `0`-`9`, `Ctrl+`, `Shift+` groups | Same keys; `Shift+digit` also removes the units from other groups | Close |
| `v` / `Shift+V` global defence | none | Missing |
| `.` / `,` next civilian / scout | none (`Tab` browses the same trade) | Missing |
| `f`, `x`, `y`, `Shift+Y` select by kind | none | Missing |
| `h` jump to headquarters | none | Missing |
| `z` zoom toggle | wheel only | Missing key |
| `o` observation window | none | Missing |
| `p` pause | `P` | Same |
| `l` speed cycle | x1 / x2 / x3 buttons | Missing key |
| `Tab` held: all tooltips | `Tab` browses the same trade | Conflict |
| Arrows, numpad | Arrows (numpad bindable) | Close |
| `Esc` ladder | `Esc` ladder, last step opens the game menu | Same plus menu |
| `F1` Help | nothing | Missing |
| `F2` Options, `F3` Load, `F4` Save | Residents, Assistant, Statistics | Conflict |
| `F5` Diplomacy, `F6` Statistics, `F7` Subjects, `F8` Tech tree | Mission, Diplomacy, Knowledge, hide HUD | Conflict |
| `F9`, `Ctrl+S` quick save | none | Missing |
| `F10` minimap toggle | none; the minimap is always shown | Missing |
| `Ctrl+B` screenshot | none (`F8` hides the HUD) | Missing |
| `Enter` chat | `Enter` chat | Same |
| Worker production `Ctrl` = infinite / none | `Shift` jumps to the end, `Ctrl` steps by 10 | Different |
| Store minimum `Ctrl` = 10 | Counters step by 10 with `Ctrl`/`Cmd` | Same |
| CnMod `>` `<` `/` `?` `m` `M` | none | Missing |

Open Northland additions without an original counterpart: rebindable controls with a settings tab,
attack-move, HUD hide, `Tab` browsing, minimap orders, zoom and filters, placement modifiers (`Ctrl`
keeps the tool, `Shift` straight line, `Alt` removes road sites), notice dismissal keys, the
residents list's range selection, and the debug palette.

Points to decide before changing keys:

- Which scheme Open Northland follows for the left button during a target pick: the original cancels
  with left and picks with right; Open Northland picks with left.
- The `F`-key layout: the original's order or the current beam order.
- The `a` and `Tab` conflicts with attack-move and trade browsing.
- Physical keys versus typed characters: Open Northland matches physical keys, the original typed
  characters. That changes `y`/`z` on German layouts and every case-sensitive pair.

## Requires observation

1. The left click on a message note and on an observation window: open/jump (studied behavior) or
   centre and select (manual)?
2. Which Extras page `e`, `Shift+A` and `Shift+B` open.
3. Whether the construction list's letter jump also triggers `s`, `d` or `b`.
4. The exact settler filter behind CnMod's `/` and `?`.
5. Scroll speed units in the zoomed-out view.
6. Mouse button roles in the Windows input path; the right = orders, middle = scroll mapping rests
   on the manual.
7. Whether right `Ctrl` counts for `Ctrl` clicks.
8. Whether any build offers the settler window's Stop Production and Only Produce buttons, or
   production buttons on buildings; their texts exist in the string tables.
