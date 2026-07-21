# Split the overgrown details-panel modules

**Area:** app · **Priority:** P3

`hud/details-panel/panel.ts` is about 595 lines, `chrome.ts` about 410, and both settler model files
exceed the repository's rough 300-line boundary. The controller mixes lifecycle with hover probes;
the model mixes work choices, equipment, experience, and status; `Chrome` also redeclares the text-kit
surface. These are current responsibility boundaries, not a request to split by line count alone.

## Scope

- Extract hover/hit hint decisions from `panel.ts` while keeping layout rectangles as their source.
- Split settler model construction into work choices and personal state.
- Compose or extend the existing `TextKit` instead of repeating its method signatures in `Chrome`.
- Preserve the current details-panel public barrel and behavior.

## Verify

`npm test`, `npm run check`, and `npm run build`; existing panel model, layout, and hover tests stay
behavior-identical.
