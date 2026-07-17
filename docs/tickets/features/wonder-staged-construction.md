# Wonder multi-stage construction visuals (same-typeId upgrade rows)

**Area:** features (render + sim) · **Origin:** building-upgrades branch, 2026-07-17 · **Priority:** P3

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

Investigate against the running original: how does a wonder build play out — one continuous site
with staged art, or discrete player-visible stages with separate material bills? Then: extract the
per-stage costs (keyed by (typeId, sizeIdx) rather than the flat collapse), advance the site through
the stages in the sim, and wire the same-typeId upgrade rows into the staged render. Source basis to
pin: `DataCnmd/budynki12/houses/houses.ini` wonder records + observation of the original.
