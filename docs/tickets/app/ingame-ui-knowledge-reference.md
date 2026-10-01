# Build Knowledge with encyclopedia and gameplay guidance

**Area:** app, data · **Focus:** in-game UI redesign · **Priority:** P2

The beam's Knowledge entry, the construction cards' "?" (`hud/dom/construction-window.ts`) and the
building panel's knowledge order open a pending note (`hud/tool-panel/pending-window.ts`). The
encyclopedia, rules and shortcut help have no player surface. The original's help is a hypertext
browser with general help (shortcut list included), buildings, goods and miscellaneous topics,
alphabetical lists, previous/list/next controls, and direct opening on one building or good.

## Scope

- Design one window with production-and-progression, encyclopedia and how-to-play tabs, and get it
  approved. Follow the HUD panel rules in `packages/app/AGENTS.md`. Implement the encyclopedia and help
  here; [knowledge-dependencies](ingame-ui-knowledge-dependencies.md) owns the dependency view.
- Remember the last tab during the session. Contextual question marks open the relevant entry.
- Cover building, good and profession entries, general rules, controls, search and previous/next
  navigation from verified content and authored text; localize every string.
- Provide link targets for construction, the selection panels and the dependency view. Never expose
  admin spawning (`view/admin-debug/`) through a player help route.
- Use one window and navigation owner, so the dependency ticket extends this surface.

## Verify

Test direct and contextual opening, tab memory, missing entries, links and back navigation,
localization and keyboard access. Confirm reading Knowledge never submits a world-changing command.
Provide the verified preview.
