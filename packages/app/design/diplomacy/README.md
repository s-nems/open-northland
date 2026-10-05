# Diplomacy design study

Open `/design/diplomacy/` on this checkout's development server. The page is an isolated design
preview, not a game entry or a replacement for the live diplomacy window. Data, delayed command
results and nation names are authored examples. Goods icons load from generated content.

## Review

- Select nations: relations are directional; the three buttons control only your attitude.
  Hostility, and neutrality that stops trading, require inline confirmation. Escape cancels the
  confirmation before closing the window. Locked relations explain the map's authority.
- Tributes follow relations because they require an action. Each shows cost, eligible stock,
  shortage and payment together. Payment confirmation, pending, success and rejection are separate
  states. The paid item disappears and remaining examples read the updated shared stock.
- Trade offers follow tributes. The row states why trade is available or blocked without promising
  that a route exists. A hostile partner remains dangerous even when your attitude permits trade.
- The review toolbar switches to no contacts, observer, long names/many tributes or command rejection.
  “Pełne zapasy” resets the examples with sufficient stock; it is not an in-game control.
- Inspect the layout at 1440×1000, 1280×720 and 390×844. The nation list and details scroll
  independently on desktop; the narrow layout uses a horizontal nation strip and one content scroll.

## Implementation boundary

The study imports `createHudPlane`, `createHudWindow`, `GLYPH`, `createGoodIconPainter`, the HUD
foundation and the bundled fonts. Its CSS is confined to the study; runtime modules are unchanged.
The material, ornament and typography choices therefore follow the current rebuilt panels.

Current app data comes from `view/projections/diplomacy-rows.ts`; commands are submitted by
`view/runtime/game-view.ts`. The sim trade gate reads our `friend` stance. Tribute availability
comes from eligible warehouse and workplace stock, with food-class substitution and shared-demand
accounting. The study uses distinct exact goods to demonstrate the layout; production must consume
the host's `payable` value rather than its simplified demonstration calculation.

Production also needs explicit disable reasons (map lock, hidden details, observer), authoritative
pending/result reconciliation, content-authored tribute text without invented promises, both
languages, actual HUD scaling and beam integration. The study splits a sample tribute into a title
and message for readability; a live row currently provides one optional text field. Use a numbered
heading with that intact message unless content supplies a separate title.

No nation positions are invented. Original-behavior fidelity and the remaining implementation are
tracked in the [diplomacy ticket](../../../../docs/tickets/app/ingame-ui-diplomacy.md).
