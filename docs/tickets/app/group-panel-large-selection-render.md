# Cut the group panel's per-frame render with a large selection

**Area:** app · **Focus:** group panel roster · **Priority:** P3

With 220 settlers selected (`bench:hud` `select50`, `magiczny_las` t100000, 1920x1080, zoom 0.5, AMD
Vega 7), the group panel costs about 4.5 ms of main-thread rendering outside JavaScript each frame. A
trace against `none-zoomed` reads per frame: Paint 1.92 against 0.57 ms, Layerize 1.00 against 0.31,
UpdateLayoutTree 1.27 against 0.22, HitTest 0.45 against 0.13, and the compositor's draw 1.47 against
0.79. Hiding `.on-selection` with CSS takes most of it away (Paint 3.64 to 1.21 ms, UpdateLayoutTree
1.47 to 0.35 in one A/B window), and a page A/B with the panel hidden ran 4.9 ms a frame faster. The
world side of the selection is not the lead: GPU frame time rises about 1.8 ms at zoom 1 (`bench:gpu`
`select10-paused`), the GPU process's WebGL time 0.5 ms, and the JavaScript in WebGL calls 0.4 ms.

One measured cause: the roster relaid every attached well about 1.6 times a second (8 relists in 128
frames), each from `roster.update` (`hud/dom/group-panel/members.ts`) because the member id order
changed on a panel rebuild, so `attach(true)` replaced the roster's children and `fit` forced a
layout per row count it tried. The invalidation trace names those wells' SVG rects, bars and badges as
the layout objects added and removed.

## Scope

- Attribute the per-frame Paint and Layerize to the panel's elements (the figure overlay canvas, the
  bars, the badges) with the paint invalidation trace, and find why the member order changes.
- Cut the largest part without changing what the panel shows or how its members are ordered.

## Verify

`bench:hud` `select50` and `none-zoomed`, base and branch alternating twice: task ms per frame and the
traced Paint, Layerize and UpdateLayoutTree; the `select50` screenshots unchanged.
