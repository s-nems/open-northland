# Original in-game menu bar

This document describes the left-hand HUD bar in *Cultures: 8th Wonder of the World*: its button
order, the actions each button actually triggers, and the contents of the windows they open. It is
the reference for correcting the current implementation and for the later Open Northland redesign.
It does not cover the main menu shown before a map starts.

This document is scaffolding for that redesign, not a durable format or behavior reference. It is
deleted with `docs/design/ingame-menu/` once
[ticket 20](tickets/app/ingame-ui-20-final-acceptance.md) accepts the new HUD. Move anything still
worth keeping into the owning reference or a test before then.

## Executive summary

The original creates nine window buttons, a game-speed button, and a separate message-priority
button. The mapping from buttons to actions is unambiguous.

The largest functional differences in Open Northland are:

- **Options** currently opens the modern system menu instead of the original options window.
- **Help** currently opens an item-spawning palette.
- **Subjects** and **Technology Tree** have no action.
- **Statistics** shows a small diagnostic summary instead of the original charts and lists.
- **Diplomacy** displays relations and permits tribute payments, but cannot change the player's
  attitude toward another nation.
- **Mission** forcibly pauses the local game. The original is not known to pause here
  (unconfirmed against the running original).

## Sources and confidence

The readable sources used are:

1. The Polish and English `ingamegui` tables from the owned game copy, decoded locally as
   `content/gui/strings/{pol,eng}.json`. They supply the original tooltips, titles, tabs, and
   labels.
2. Chapters 9.5–9.6 and the shortcut appendix in the complete manual, pages 31–35
   ([online manual copy](https://www.scribd.com/document/978738232/Cultures-4-Manual)). The shorter
   manual of a later edition also confirms the Assistant's role
   ([PDF](https://cdn1.macgamestore.com/d2/manuals/cultures-wonders-manual.pdf)).

**Confirmed** means the original's behavior, text tables, and manual agree. **Unconfirmed** means
the behavior is attributed to the original but is not described in the manual and has not been
checked against the running original. **Requires observation** marks a detail that should be
checked in a running copy of the original.

## Geometry and order

Coordinates use the original GUI design space. The bar background occupies
`(x=0, y=10, w=50, h=433)` and uses graphic `0x33`. Every main button is `40×35`.

| Top-to-bottom | Function | `y` position | Graphic | `main` tooltip |
| ---: | --- | ---: | ---: | ---: |
| 1 | Construction | `41` | `0x2a` | `2` |
| 2 | Extras | `73` | `0x2d` | `5` |
| 3 | Mission | `117` | `0x2e` | `3` |
| 4 | Diplomacy | `151` | `0x2c` | `4` |
| 5 | Statistics | `176` | `0x32` | `7` |
| 6 | Subjects | `204` | `0x2b` | `6` |
| 7 | Technology Tree | `238` | `0x38` | `8` |
| 8 | Options | `295` | `0x2f` | `1` |
| 9 | Help | `329` | `0x30` | `0` |
| 10 | Game speed | `373` | `0x31` | `13` |

The original Polish tooltips name these actions directly, including “Open the building menu,”
“Open the subjects window,” and “Open the technology tree.” The `options` and `help` labels are
therefore definitive: graphic `0x2f` is **Options**, and `0x30` is **Help**.

The message-priority button is outside the vertical stack. It sits on the plaque at the top:

- frame: `(24, 0, 126, 41)`, graphic `0x3f`;
- button: `(106, 3, 37, 31)`, initial graphic `0x40`.

## Shared window behavior

Original windows have a draggable title bar and an `X` button. A window can be closed with
`Esc`, its `X`, or another click on the same menu-bar button.

Options, Extras, Diplomacy, Subjects, Statistics, Mission, Technology Tree and Help are the eight
main windows, and they belong to the “large windows” group. Opening one:

1. closes every other large window;
2. removes contextual selection buttons;
3. resets the active input mode;
4. creates one instance of the selected window.

The original's large-window group has ten members, the network window among them. The
construction selector is not part of it.

The original's mission window is not known to pause the game when it opens. Opening a regular
menu window should not itself pause the simulation. This finding is **unconfirmed** and should
ultimately be checked against a running copy of the original.

## Buttons and windows

### 1. Construction

**Shortcut:** `B`. **Status:** confirmed.

The window lists buildings the player can currently construct. It has five filters:

- All;
- Work;
- Warehouse;
- Dwelling;
- Military.

Selecting a building row enters placement mode for that building type. The original shows the
required materials and has an information button that opens the building's Help page. The bottom
row starts separate construction modes for roads, stockades, and gates.

The same window has a **Use Permit** variant. The owned paper limits the list in this mode, and a
selection starts the prepaid construction. The regular variant also links to the Papers tab in
Extras.

The manual says the building type is selected with the left mouse button and its location is
confirmed with the right mouse button. A current implementation comment describes a left click for
placement. This detail **requires observation** because the manual and the current assumption
disagree.

### 2. Extras

**Shortcuts:** `E` opens the window, `Shift+A` opens Assistant, and `Shift+B` opens Papers.
**Status:** the division and primary actions are confirmed; exact counter layout requires
observation.

The window has two functions:

- **Assistant** automates settlement tasks: maintaining numbers of women and men, training
  soldiers and weapon classes, and collectively equipping subjects with shoes, wooden tools, iron
  tools, and mead. Direct orders to an individual subject take precedence over Assistant settings.
- **Papers** displays documents found in chests. They include permits for any building or a
  particular building, completed or supplied buildings, and permissions for learning and
  production. A construction paper opens the construction selector or enters placement directly
  for the specified type.

Assistant interactions are network commands. They change simulation state rather than a local
interface preference.

### 3. Mission

**Menu shortcut:** the manual lists no dedicated shortcut. **Status:** confirmed.

The window has three tabs:

- **Task**: the current or replayed briefing, including images and recorded speech;
- **Objectives**: mission objectives, with completed entries crossed out;
- **History**: navigation through story and briefing pages.

It has up/down scrolling and previous/next task controls for the history. Briefing history is stored
in the saved game. Opening the window from the bar shows the current mission
context; scripts can instead open a specific page.

### 4. Diplomacy

**Shortcut:** `F5`. **Status:** confirmed.

The window lists only nations the player has encountered. It shows both directions of each
relationship separately:

- that nation's attitude toward the player;
- the player's attitude toward that nation.

The player can set their own attitude to friendly, neutral, or hostile unless the map script has
locked it. Trade is possible only when the other side is friendly. The window also displays a
tribute offer: required goods, available warehouse quantities, and the payment action. Goods at
workplaces or homes do not count toward an available tribute.

The manual also describes an overview map with nation positions in this window. Its precise layout
still needs visual confirmation in the running original; the strings confirm the other actions.

### 5. Statistics

**Shortcut:** `F6`. **Status:** confirmed.

The top tabs choose the data set:

- People: population development;
- Professions: numbers practicing each profession;
- Buildings: development of the building count;
- Building List: existing buildings, with buildings under construction in parentheses;
- Goods: production history, including food;
- Miscellaneous: including marriages, births, and deaths;
- Cemetery: deceased heroes.

Individual chart series can be enabled or disabled. An entry's color matches its plotted line, and
its current value appears beside it. The window shows elapsed game time and supports chart ranges
of 1, 2, 5, or 10 hours. Statistics data and the window setting are persisted in saved games.

### 6. Subjects

**Shortcut:** `F7`. **Status:** confirmed.

The window shows an alphabetical list of all subjects and their current activity. Filters include:

- all subjects;
- a specific current profession;
- a profession the subject can take;
- men, women, children, soldiers, heroes, and workers;
- homeless subjects, subjects without tools, unmarried subjects, women without children, subjects
  without shoes, and soldiers without weapons.

Selecting a person closes the list, selects that person, and centers the world view on them. The
window can also select everyone on the filtered list. A separate profession-selection window
supports the “Profession” and “Possible profession” filters. The selected filter and list state
participate in saved games.

### 7. Technology Tree

**Shortcut:** `F8`. **Status:** confirmed.

The tree shows the buildings, goods, and professions available on the current map and their
dependencies. It has ten sections: Food, Animals, Wood, Clay, Stone, Ore, Druid, Warehouse,
Military, and Dwellings.

An item can be locked, available, or not yet available. Its description lists missing conditions:
a required profession, item, preceding profession, or experience level in a particular field.
Clicking a building, item, or profession displays its description. The information button opens
the corresponding Help page.

### 8. Options

**Shortcut:** `F2`; `F3` opens Load directly, and `F4` opens Save directly. **Status:**
confirmed.

This is more than a pause menu. The original window has six tabs:

- **General**: quit the game or restart the map;
- **GUI**: scrolling speed, middle-button/edge/arrow-key scrolling, old or new input mode, expert
  mode, and tooltips;
- **Video**: resolution and color depth, detail level, and software or hardware cursor;
- **Music**: sound quality, jingles, music source, volume, and CD Audio settings;
- **Load**: saved-game list sortable by date, map name, and type;
- **Save**: regular, quick, and automatic saves, including the autosave interval.

Some hardware options are historical. A redesign can map them to settings supported by the modern
engine, but the button's functional scope includes settings, save/load, restart, and quit.

### 9. Help

**Shortcut:** `F1`. **Status:** confirmed.

Help is a hypertext browser with four sections:

- general help, including the shortcut list;
- buildings;
- goods;
- miscellaneous topics.

Building and goods lists are alphabetical. Bottom controls open the previous entry, the list, or
the next entry. Help can open directly on a particular building or item; the construction selector
and Technology Tree use this behavior.

### 10. Game speed

**Shortcuts:** `L` increases speed; `P` toggles pause. **Status:** confirmed.

Clicking the button cycles `×1 → ×2 → ×3 → ×1`. The three speeds run 12, 24 and 36
ticks per second. Pause is a separate state and changes the graphic to `0x36`; graphics
`0x31`, `0x34`, and `0x35` represent the three active speeds. Clicking the button while paused
makes the original select `×1`, rather than restoring the previous speed.

The tooltip is dynamic: it contains the original “Game Speed” label and current multiplier.

### 11. Message priority and note bar

**Status:** confirmed.

The envelope button cycles through three levels:

1. show all messages: graphic `0x40`, tooltip `main:14`;
2. hide unimportant messages: graphic `0x41`, tooltip `main:15`;
3. show important messages only: graphic `0x42`, tooltip `main:16`.

Messages appear as small notes along the upper-left edge. Hovering shows the text. A left click
centers and selects the referenced person or building and opens its panel. A right click removes
the message; `Ctrl` + right click removes all visible messages. The manual says messages are
automatically removed after two minutes.

## Minimap and large overview map

The large overview map is not an eleventh vertical-bar button. The original permanently creates
a small overview window in the lower-left corner. Its globe button opens the large overview
map.

The minimap:

- shows explored terrain and a rectangle for the current viewport;
- moves the camera when clicked or dragged;
- cycles filters: full, military, simplified nation, and no terrain;
- supports zooming in and out;
- marks the selected object and event locations.

The large map has separate filters for inhabitants, soldiers, animals, vehicles, buildings,
signposts, stockades, roads, terrain, sheep, cows, and chests. It should remain a separate entry
beside the minimap after the menu-bar redesign.

## Open Northland compared with the original

The table describes `main` at revision `13662beab` (2026-09-16).

| Button | Current behavior | Difference from the original | Fix priority |
| --- | --- | --- | --- |
| Construction | Opens a building list and placement mode | Roads, stockades, gates, costs, and Help link are missing; placement confirmation still needs checking | High |
| Extras | Assistant and Papers work | The row set and geometry are explicitly approximate; some paper types remain display-only | Medium |
| Mission | Task, Objectives, and History work | It forces a pause the original is not known to have | High |
| Diplomacy | Shows relations and permits tribute payment | Changing the player's attitude and the original nation map are missing | High |
| Statistics | Shows diagnostic HUD rows; clicking anywhere closes it | The entire window serves a different purpose | Critical |
| Subjects | No action | The entire list, filters, selection, and camera centering are missing | Critical |
| Technology Tree | No action | The entire tree, availability requirements, and Help links are missing | Critical |
| Options | Opens the modern system menu and forces a pause | It should open the six-tab options window; modern system information should not replace the button's actual action | Critical |
| Help | Opens an item palette that creates loose goods through an administrative command | This behavior is unrelated to Help and changes world state | Critical |
| Game speed | Cycles `×1/×2/×3`; pause has its own state | Clicking while paused restores the remembered speed, whereas the original selects `×1` | Low |
| Message priority | Cycles three levels and changes its icon | The main action matches; note lifetime and gestures still need comparison | Low |

The current action matrix is in
[`packages/app/src/hud/tool-panel/nav-effects.ts`](../packages/app/src/hud/tool-panel/nav-effects.ts),
and the menu-bar geometry is in
[`packages/app/src/hud/tool-panel/layout.ts`](../packages/app/src/hud/tool-panel/layout.ts).

## Details requiring a short original-game session

The documented behavior and manual are sufficient for redesigning the information architecture. Before reproducing
the interactions exactly, one controlled session in the original should establish:

- whether the left or right mouse button confirms building placement in the project's reference
  edition;
- the precise Assistant counter layout, limits, and infinity-symbol behavior;
- the precise nation-map layout inside Diplomacy;
- whether every large window leaves the world running in single-player mode;
- how `Esc`, repeated button clicks, and overlap between the construction selector and a large
  window behave;
- message lifetime and note ordering at each priority-filter level.

These points do not change the button mapping or functional scope documented above.
