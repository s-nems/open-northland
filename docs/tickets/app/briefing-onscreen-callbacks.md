# Move the camera when a briefing's on-screen callback comes into view

**Area:** pipeline, data, app · **Focus:** `decoders/hypertext.ts`, `hud/tool-panel/mission` · **Priority:** P2

Briefing pages carry `<onscreencallback:kind,a,b>` tags (13,793 in the CnMod corpus: 13,577 of kind
1001, 172 of kind 1000, 44 of kind 2000). The decoder drops them, so opening a briefing never moves
the main view to what the text describes.

In the original the tag hands its three integers to the mission window when its line is drawn, and the window acts on them once while a one-shot flag is
clear: 1000 centres the main display on half-cell node
(a, b); 1001, 1002 and 1003 centre it on the average position of the humans, vehicles or houses stamped
with mission id `a`; 2000 plays `<map>\SFX\<lang>\NNNN.wav` (no map in the corpus ships one).

## Scope

- Investigate first: where the original clears the one-shot flag (page open, page change or window
  open).
- Keep the tag in the page data at its line position, and fire it from the mission window when its
  line scrolls into the viewport, honouring the one-shot flag.
- Kinds 1000-1003 move the camera through the existing camera seam; kind 2000 stays unimplemented
  until a map ships the file.

## Verify

- Decoder test: the tag survives at its line with its three integers.
- Window test: scrolling a callback into view requests one camera move, and a second callback on the
  same page does not while the flag holds.
- Browser: cn_0's page 501 opens on `<onscreencallback:1001,5,0>` and the view centres on the humans
  stamped with mission id 5.
