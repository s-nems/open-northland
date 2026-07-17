# Report countable sub-progress inside the boot card's long steps

**Area:** app (view, content) · **Origin:** feat/loading-screen, 2026-07-17 · **Priority:** P3

`view/boot-progress.ts` advances its bar one equal step per boot phase (`bootFraction`). The phases'
real costs differ by an order of magnitude — on a decoded map the sprite-atlas and terrain steps run
for seconds while the minimap step is near-instant — so the bar sits still through the long ones and
jumps through the short ones. The equal weighting is a deliberate placeholder: a fixed weight table
would be invented numbers, and the honest fix is to report what the long steps can actually count.

Three of the long steps already `Promise.all` over a known-length list, so they can report real
`done/total` progress rather than a guess:

- `content/terrain.ts` — the terrain texture pages (`pageKeys.size`, ~56–75 pages).
- `content/objects.ts` (`loadMapObjects`) — the landscape atlases.
- `content/sprite-sheet/human-sheet.ts` (`resolveSpriteSheet`) — six serial sub-phases (body/head
  layers, player LUT, characters, goods icon manifest, gathering families).

## Scope

- Give the loaders above an optional progress callback (`(done, total) => void`) — an injected
  reporter, so `content/` gains no dependency on `view/`.
- Have `?map=`/`?scene=` pass one through and let `boot-progress.ts` render fractional progress within
  a step (label + `n/total`, bar interpolating across the step's own span).
- `messages().loading` labels take a `{done}`/`{total}` placeholder via `formatMessage` for the steps
  that report counts; the steps that cannot count keep their plain label.
- Only then consider weighting the phases, driven by measured counts rather than hand-picked numbers.

## Verify

- `npm test` + `npm run check` + `npm run build`.
- `npm run dev` → `?map=<id>` on a checkout with `content/`: the bar advances smoothly through the
  terrain and object steps instead of standing still. Human sign-off on the feel (an agent cannot
  judge whether the motion reads as progress).
