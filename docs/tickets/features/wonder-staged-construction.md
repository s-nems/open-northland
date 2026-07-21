# Render wonder construction in authored stages

**Area:** features (render + sim) · **Priority:** P3
**Needs user:** observe whether wonder stages have separate material bills in the running original.

The eight wonders are separate single buildings (typeIds 47..54, one `kind: 'wonder'` each — the
lighthouse, the gardens, the colossus, …, the 8th wonder), NOT an upgrade chain: their `[GfxHouse]`
records map several `LogicType` size levels to the SAME typeId, so the `upgradeTarget` extraction
correctly emits no chain link for them (a self-link is skipped). But those records DO carry
`GfxBobConstructionLayer` rows — including `upgrade === 1` rows between the size levels (13 such rows
across typeIds 47..53, tribe 5, in real `ir.json`) — meaning the original renders a wonder rising
through several authored construction stages of one building, with upgrade-overlay art between
stages. Today OpenNorthland treats a wonder as a single-stage build: one from-scratch stage stack
(the lowest-sizeIdx record group wins in `constructionRefsByType`), and the per-stage
`LogicConstructionGoods` collapse to the lowest sizeIdx's cost (`extractConstructionCosts`'s
lowest-sizeIdx convention), so the higher stages' costs and art are unused.

## Scope

- Observe whether the stages form one continuous build or separate material bills.
- Preserve construction costs and graphics by `(typeId, sizeIdx)` rather than collapsing them to the
  lowest row.
- Advance one building entity through the authored stages and draw the matching base/upgrade layers.
  Do not model wonders as an ordinary `upgradeTarget` chain.

Source basis: `DataCnmd/budynki12/houses/houses.ini` wonder records plus observation of the original.

## Verify

Synthetic pipeline and sim tests cover at least three same-type stages and their bills. Run
`npm run test:pipeline`, `npm test`, `npm run check`, and `npm run build`; compare one wonder's full
construction sequence with the original.
