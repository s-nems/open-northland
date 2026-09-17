# In-game UI redesign

The user approved the navigation/layout direction in [the interactive wireframe](index.html).
This approval covers information architecture, not final panel designs, production artwork,
placeholder values or gameplay behavior. The functional baseline is
[Original in-game menu bar](../../ORIGINAL-INGAME-MENU-BAR.md); its current-implementation comparison
is revision-specific and must be rechecked against code.

Ticket 01's [visual foundation reference](foundation.html) and
[written specification](FOUNDATION.md) establish the approved visual direction: the B · Leśny łupek
slate base with wood, bronze and parchment chrome, notification refinements, framed selection preview,
population symbols and original Cultures character preview. Ticket 01 still needs shared runtime
primitives and production art exports; approval does not finalize individual panel contents or
validate runtime behavior. See [resume instructions](FOUNDATION.md#resume-the-local-review).

## Approved product direction

- Economic RTS for mouse and keyboard. No controller/touch redesign in this scope.
- Modern, readable UI with a restrained Nordic character and original assets. Keep decoration
  subordinate to gameplay information; match the world without copying original GUI art.
- Seven direct bottom-bar entries: **Buduj, Mieszkańcy, Asystent, Statystyki, Misja, Dyplomacja,
  Wiedza**. No intermediate Osada/Wyprawa menus and no second navigation row.
- Buduj opens the catalog immediately. Roads, stockades, gates and Documents are reachable inside
  construction. Documents retain all paper types, not only building permits.
- Mieszkańcy opens the residents list immediately. Selecting an object has a separate bottom-right
  detail panel for a person, building or group.
- Main content windows occupy the space between the side regions, have their own close control and
  retain visible navigation. Selecting a construction item exposes the map for placement.
- Notifications are narrow, separate cards down the **left** edge to the minimap. No enclosing frame
  or background; empty space remains map. A compact count and three-level filter remain above the list.
  Settler subjects show the actual full-body settler and current activity animation, not a separate
  painted face. Transparent sprites sit over a light translucent backing in notifications and a
  dedicated framed background in selected-settler details. Scrolling must not
  hide events permanently; visible-only animation and pause/reduced-motion handling belong to implementation.
- Above-right: women, men, children across the local player's entire tribe/map, plus Food, Materials,
  Armament, Equipment and Other, all to the left of the clock. Categories reveal per-item quantities
  on hover/focus. The wireframe proposes warehouse inventory; verify and make the final scope explicit.
- The clock is elapsed **simulation time**: x3 advances three times faster, pause stops it. It is not
  OS time or unscaled real session duration.
- Wiedza combines **Produkcja i rozwój**, **Encyklopedia**, **Jak grać** in one window. Remember the
  last tab during the session. F1 opens guidance; F8 opens dependencies. Contextual help/requirements
  links go directly to the appropriate entry.
- Settings/save/load/restart/quit remain available through the system entry by time controls.
  The minimap keeps its own large-map entry.
- Resource/population summaries reuse icons or sprites from the active game asset set. The residents
  navigation icon must not use realistic faces. Construction thumbnails show the actual game buildings,
  not independently generated substitutes. Placeholders are allowed in the current style review only.

The mockup's fonts, Unicode icons, SVG people, map shapes, stock numbers, recipes and simulated timer
are illustrative. They are not approved assets, catalog data or reusable game-state code.

## Panel workflow

Every player-facing ticket starts with detailed design, even after the shared foundation is accepted:

1. Inspect the panel's real models, commands, content, tests and original functional scope. Classify
   behavior as implemented, missing, deliberately redesigned or uncertain. Never port an existing
   placeholder as if it were the original function.
2. Develop the actual panel layout and flow in the accepted visual language. Include normal, selected,
   hover/focus, disabled, empty, error and overflowing states as applicable, realistic long text,
   actual controls and interaction with adjacent HUD regions. Show representative data, not just boxes.
3. Present the concrete detailed design in the local preview for user review before implementing
   that panel. Architecture approval is not blanket visual approval of every new panel. Small edits
   expressly requested by the user need no repeated permission question; implement and show them.
4. Implement the accepted design against the existing engine boundaries. State-changing actions use
   session commands. Keep pure projections/testable interaction logic separate from drawing.
   Do not expand a presentation ticket into an unbounded simulation project: expose exact missing
   prerequisites and split bounded implementation work when required.
5. Verify behavior at the lowest useful layer and in the real game. Compare with the approved shared
   reference and already completed panels. Hand off a verified task preview and name remaining human
   checks. Follow [testing](../../TESTING.md) and [preview verification](../../DEVELOPMENT.md#worktree-previews).

Each implementation ticket removes the legacy panel code, styling, imports and obsolete tests that
its accepted replacement makes unreachable. Shared legacy pieces remain only while a real unmigrated
consumer still needs them. Ticket 20 audits residual paths and consistency; it is not the point where
the old HUD is removed in bulk.

Ticket 01 establishes the shared component/style reference: [FOUNDATION.md](FOUNDATION.md) with
the reference page, and at runtime `packages/app/src/hud/dom/foundation.css` shown on the gallery
board (`?art=gallery&tab=hud`). Keep palette, typography, spacing, icon semantics, sizes and states in
that one source; later panels reuse it. A new common pattern must update that source and be checked against existing consumers.
Do not grow one unrelated UI implementation per session. No universal UI framework is required.

## Original assets and generation

Use original UI assets. Simple crisp controls and diagrams can be vector/code-native; generation is
appropriate for illustrated icons/material details when it improves the design. Do not generate
complete windows with baked text or use wireframe symbols as finished art.

For raster generation, read the available imagegen skill and relevant
[art instructions](../../art/AGENTS.md) / [production workflow](../../art/PIPELINE.md).
Prefer the built-in generator with existing plan usage when it meets the need. The user's standing
authorization permits a bounded OpenAI API batch when a needed capability or material quality
advantage justifies it (for example, genuine transparent output); explain the reason for switching.
Convenience alone is not grounds for separately billed generation. Do not ask again solely because
an image skill describes approval for users without that authorization.

Read the primary checkout's .env by absolute path only into the process needing it, using a dotenv
parser or Node --env-file. Never source it as shell code, print values, copy it into this worktree,
embed secrets in prompts/browser code or commit credentials. A present key is not proof of access.

Keep exact prompts, model/tool/settings, ordered references and hashes, selected masters and export
parameters. Review icons at their runtime sizes, including true alpha where needed, and obtain
concrete visual acceptance. Reuse one icon family throughout the UI. For goods reuse the
[goods icon contract](../../art/goods/README.md); menu action icons need an appropriate ownership/export
route established by ticket 01 rather than being mislabelled as tradeable goods. UI-only work does
not authorize replacement world buildings or characters.

## Implementation order

Work one panel/ticket at a time in the shared checkout; see [session instructions](AGENTS.md).
The shell is in place; finish 01, then 03–07 to establish the basic play loop. Continue with details, automation,
statistics, mission, diplomacy, Knowledge, settings and maps. Blocked-by links express real technical
prerequisites; numbering is the suggested review order, not permission for parallel sessions to edit
shared files. Ticket 12 separates statistics data from chart rendering because the current popup is
only diagnostics.

| Ticket | Outcome |
| --- | --- |
| [01-visual-foundation](../../tickets/app/ingame-ui-01-visual-foundation.md) | Design and approve the shared in-game UI language |
| [03-notifications](../../tickets/app/ingame-ui-03-notifications.md) | Build the narrow frameless notification column |
| [04-summary-and-clock](../../tickets/app/ingame-ui-04-summary-and-clock.md) | Add tribe counters, grouped resources and simulation time |
| [05-construction](../../tickets/app/ingame-ui-05-construction.md) | Design and implement the direct construction window |
| [06-documents](../../tickets/app/ingame-ui-06-documents.md) | Integrate permits and other documents into construction |
| [07-residents](../../tickets/app/ingame-ui-07-residents.md) | Build the direct residents list and actionable filters |
| [08-settler-details](../../tickets/app/ingame-ui-08-settler-details.md) | Redesign the selected resident panel |
| [09-building-details](../../tickets/app/ingame-ui-09-building-details.md) | Redesign the selected building panel |
| [10-group-details](../../tickets/app/ingame-ui-10-group-details.md) | Redesign multiple-selection details and shared orders |
| [11-assistant](../../tickets/app/ingame-ui-11-assistant.md) | Create the direct assistant window |
| [12-statistics-data](../../tickets/app/ingame-ui-12-statistics-data.md) | Provide the real historical data required by statistics |
| [13-statistics-window](../../tickets/app/ingame-ui-13-statistics-window.md) | Implement the designed statistics charts and lists |
| [14-mission](../../tickets/app/ingame-ui-14-mission.md) | Redesign mission briefing, objectives and history |
| [15-diplomacy](../../tickets/app/ingame-ui-15-diplomacy.md) | Redesign diplomacy with actionable relations and tribute |
| [16-knowledge-reference](../../tickets/app/ingame-ui-16-knowledge-reference.md) | Build Knowledge with encyclopedia and gameplay guidance |
| [17-knowledge-dependencies](../../tickets/app/ingame-ui-17-knowledge-dependencies.md) | Add production and progression dependencies to Knowledge |
| [18-system-menu](../../tickets/app/ingame-ui-18-system-menu.md) | Redesign in-game settings and save/load surfaces |
| [19-map-overview](../../tickets/app/ingame-ui-19-map-overview.md) | Redesign minimap and its separate large overview |
| [20-final-acceptance](../../tickets/app/ingame-ui-20-final-acceptance.md) | Verify the complete redesigned HUD and retire obsolete UI |

When a ticket finishes, delete it per the repository lifecycle, remove its row here and remove/update
incoming dependency links in the same commit. Remaining tickets describe remaining work only.
Do not use this document as a chronological session log.

Existing save, progression, wall/gate and related detail-panel tickets retain ownership of their
mechanics. The redesign tickets identify overlap; they do not silently mark those tasks done.
The last acceptance pass must account for any unresolved prerequisites before calling the redesign
functionally complete.
