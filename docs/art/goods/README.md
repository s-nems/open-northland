# Goods and inventory icons

Use one `goods/<good-slug>` package per tradable resource or item. Start from
[wood/asset.json](wood/asset.json), register it in [the catalog](../assets.json), and follow
[the shared production workflow](../PIPELINE.md). Builds use retained files and never call providers.

The `goods` delivery kind writes `goods/<good-slug>/runtime.json` and one transparent atlas.
The shared [goods schema](../../../packages/art-contracts/src/good.ts) requires six frames:
indices 0–4 are ground quantities 1–5; index 5 is the UI icon. Larger amounts clamp to the fifth
world frame. Each frame has its own bounds and ground anchor. `scale` converts world frames from
source pixels to world pixels; HUD icons fit their existing UI slots independently.

Keep the same object size, perspective and materials across quantities; increase the pile, not the
individual log or stone. Check actual object count, alpha, edges and reduction at play size. UI art
may use a simpler, more compact composition. Reuse that icon across building inventory, costs and
production rows. Tree growth, deposits, harvest leftovers and carried goods are separate asset families.

Before generation verify the slug against real source, its extractor and local IR. Record the exact
prompt, ordered references and hashes, generation route, retained masters and export parameters beside
the recipe. Unapproved packages stay in candidate previews. Gallery: `tab=goods`; inspect a real map
with `assets=own&zoom=2` for contacts and scale.
