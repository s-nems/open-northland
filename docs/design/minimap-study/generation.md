# Atlas frame provenance

Delivered asset: [atlas-frame.png](../../../packages/app/src/assets/ui/minimap/atlas-frame.png).
SHA-256: `f7d4a269fcbbf6806f58a5ae7a25f9736368437ed41e511adb18b77c7f566df3`.

The built-in `image_gen` tool generated the frame as a 1254 × 1254 RGBA image with a transparent
centre and exterior. The delivered file preserves the generated alpha. The recorded response did
not identify a model, quality or seed. No original-game artwork was supplied to the generator.

The sole input image was the generated six-direction concept board described below; its upper-left
A panel supplied the material reference. Reference SHA-256:
`db955823c1bc7ee14c105ec0dbcdf0fc890970ac0ff3d9deb125b4f28b4c1651`.
The other concepts and the board's terrain are not runtime assets.

## Runtime presentation

The asset is used without a destructive recolour. [chrome.css](../../../packages/app/src/hud/minimap/chrome.css)
uses a 190-source-pixel border slice, rendered with fixed 32 design-pixel corners, and the approved
muted parchment treatment: saturation 0.56 and brightness 0.72. Aspect changes stretch the rails
between the corners. The [paper layer](../../../packages/app/src/hud/minimap/paper.ts) reuses paper and
torn-edge regions of the same source; the visible map is drawn separately. Controls and labels remain
independent DOM elements. See [the approved direction](../ingame-menu/FOUNDATION.md#minimap-direction).

## Frame prompt

```text
Use case: ui-mockup.
Asset type: production UI frame texture for an interactive square minimap, isolated with a genuinely transparent central aperture and transparent exterior.
Input image 1 is STYLE REFERENCE ONLY: the board's A panel, upper left. Recreate its warm aged parchment edge, slender dark leather outer binding and softly worn bronze rim, with restrained Nordic ink corner ornaments. Ignore the other five panels and all reference map terrain.
Create ONE perfectly square atlas frame, straight orthographic front view, all edges axis aligned. Outer square fills the image nearly edge to edge with only 8px transparent exterior margin in a 1024x1024 composition. The central empty transparent SQUARE aperture extends from x=66,y=66 to x=958,y=958. All visible material is confined to that narrow perimeter. A thin dark leather binding along the outside, a fine aged bronze rule inside it, a softly uneven warm ivory parchment border around the aperture. Parchment edge should look like an actual map sheet with fibers, lightly weathered edges, subtle cartographer measuring ticks, and a tiny ink interlaced knot at upper-left and lower-right, plus small restrained diamond cartography marks along sides. Beautiful handmade atlas rather than a metal dashboard. Slim material bands, visible craftsmanship at small UI size. Warm but muted ivory/tan/aged bronze against dark brown leather. Subtle tactile relief and soft side-light, no perspective or outer drop shadow.
IMPORTANT: No terrain, no ocean, no geography, no game screenshot, no controls, no buttons, no toolbar, no lettering or words, no compass labels. Empty fully transparent central aperture, actual alpha not checkerboard. One frame only. Keep all ornaments within the frame band, do not invade usable map opening. Preserve the shape and material identity of reference A; do not make a generic green HUD or a solid metal picture frame.
```

## Reference-board prompt

The board was generated without input images, with `transparent_background: false`; its opaque
background was intentional. The tool did not expose model, quality or seed.

```text
Use case: ui-mockup. Create one high-resolution landscape art direction board, SIX clearly distinct minimap UI concepts for a modern Nordic economic RTS, arranged in a clean 3-column 2-row grid on a nearly black forest slate background. This is original UI concept artwork, no existing game assets. All six have IDENTICAL readable stylized top-down synthetic coastal island geography, muted moss terrain, teal water, ivory camera rectangle, a few simple cyan village dots and ochre objective diamonds; subordinate terrain detail to markers. Each map about 300px wide, generous spacing. At top of each tile typeset only one simple large identifier A, B, C, D, E, F. A: ATLAS, a warm parchment square map with an elegant very thin aged bronze inner rim, dark slate outer rim, two tiny restrained Nordic corner details; sophisticated and quiet. B: SLATE, crisply squared dark charcoal slate map panel, low profile, precise hairline warm bronze edge and a small tab, most modern and minimal. C: TRAVELLER, softly folded parchment sheet secured at two corners by dark leather, no heavy frame, field cartographer feel. D: CARTOGRAPHER, landscape 4:3 map inset in slim warm dark oak with small bronze instrument dial outside the usable map, practical crafted precision. E: MEDALLION, circular cartographic disk in a narrow bronze ring, restrained compass tick marks; obvious round silhouette. F: SAGA, a compact little open atlas book, single continuous mapped spread, dark leather binding, subtle page edges and one burgundy fabric bookmark, matching a saga mission book without large ornaments. Under each map a neat small low-profile toolbar with minus, plus and expand vector-like symbols, no prose. Use materially convincing softly worn wood/leather/bronze/parchment but modern readable UI hierarchy. Straight-on orthographic UI plates, not perspective objects. No photoreal world, no cinematic backgrounds, no dragons, no swords, no fantasy portraits, no neon, no bright gold, no huge runes. Keep map interiors unobstructed and decorative frames very thin. Consistent scale and lighting, crisp product UI concept board. No titles other than A B C D E F.
```
