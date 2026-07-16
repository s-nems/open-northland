# Human pixel pass: graded indexed alpha across GUI, fonts, goods icons

**Area:** app · **Origin:** visual-polish review battery, 2026-07-16 · **Priority:** P2

The visual-polish branch restored graded alpha in the indexed atlas bake (the pipeline no longer
flattens coverage to binary; the `PalettedSprite` shader modulates alpha instead of discarding at
0.5, and indexed sheets now load straight-alpha so premultiply-on-upload can't corrupt the palette
index in red). This repaints every surface drawn from an indexed sheet with sub-255 coverage —
settler edges, GUI chrome, font glyphs, goods icons (the old flattener comment measured 12.6% of
`ls_goods`' visible pixels as sub-128).

Task: a recorded human pixel pass over those surfaces against the running original (the settler
edges were eyeballed at merge; the GUI/font/icon sweep was not):

- tool-panel strip, build menu, goods window, stats window chrome + text,
- details-panel text and gauges,
- goods icons in menus and door badges,
- `?anim` settler montage edges (all facings).

Requires locally regenerated `content/` (the graded bake). Delete this ticket when the pass is done
and any retunes are filed.
