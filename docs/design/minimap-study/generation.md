# Minimap frame provenance

The three frames and the backing texture in `packages/app/src/assets/ui/minimap/` were generated for
this project with the OpenAI Images API (`gpt-image-1.5`, quality `high`, 1024 × 1024,
`background: transparent`); no seed is exposed. No original-game artwork was supplied to the generator.

| File | SHA-256 | Input image |
| --- | --- | --- |
| `frames/zelazo.webp` | `2f9bc3b96a4979336c87f964e2abf297126142d1e13b9cde8daaf2800655e1fe` | none |
| `frames/ksiega.webp` | `12b194de16eb80bc82d6d93138ae63e029ea201f47dca8540bcc964308347fc9` | the mission book spread |
| `frames/urnes.webp` | `d0e1b4396e291b312aa783075da2feb5b40f81bf07a8aeeb0c1ba43f2618806c` | none |
| `wood.webp` | `c33b2ff6916be4110bcde96dae5d92fa6b8fb21b4712d82083cf11ecbe5f7d6c` | none |

The Księga frame used the project's own `assets/ui/mission-book/spread.webp`, converted to PNG, as a
style reference through the edits endpoint.

## Post-processing

Each frame was cropped to its opaque outer square, scaled to 768 × 768 and saved as WebP (quality 90,
full-quality alpha). The rails were measured on the delivered alpha; [chrome.css](../../../packages/app/src/hud/minimap/chrome.css)
slices each frame at 1.5 rail widths (Żelazo 166, Księga 123, Urnes 141 source px) and renders the slice
at 39 design px, so each rail ends 20 px inside the panel. The backing tile was generated opaque at
`medium` quality, scaled to 256 px and mirrored into a seamless 512 px tile; CSS multiplies it with a
per-frame tint.

## Frame prompt

Every frame prompt is the shared text followed by its design sentence.

```text
Production UI frame texture for an interactive minimap in a dark Nordic economic RTS HUD (dark oak, blackened leather, muted aged bronze). One perfectly square frame, straight orthographic front view, all edges axis aligned, filling a 1024x1024 canvas edge to edge with about 8px transparent margin. The central opening is a large empty fully TRANSPARENT square from about x=80,y=80 to x=944,y=944: all material is confined to a slim perimeter band of about 70px. It must be 9-slice friendly: four decorated corners of about 150px, and the four straight rails between them uniform along their length (repeatable or cleanly stretchable, no unique centered ornaments on the rails). Dark, low-key, restrained values so it sits quietly next to a dark UI; no bright or pale material dominating. Soft top-left light, subtle tactile relief, no perspective, no outer drop shadow. IMPORTANT: no terrain, no map, no geography inside, no buttons, no lettering, no words, no numbers; genuinely transparent center and exterior (real alpha, not a checkerboard). Design:
```

Żelazo:

```text
IRON-BOUND CHEST. The rails are dark almost black oak planks with visible grain, edged by thin blackened forged iron straps; at each corner an L-shaped hand-forged iron bracket with round rivets and a small curled scroll end. Heavy but slim, like the lid of a Viking sea chest.
```

Księga (plus the reference sentence):

```text
BOOK COVER. The rails are dark weathered oak board with a shallow carved Nordic interlace band, exactly the material of the reference book cover; each corner has a triangular aged brass-bronze corner protector with three domed rivets and a small punched knot. Slim, crafted, calm. Input image 1 is a STYLE REFERENCE ONLY for material, carving, fittings and colour: a mission book cover of the same game. Do not copy its pages or its layout.
```

Urnes:

```text
URNES CARVING. The rails are dark smoked oak with two parallel carved grooves, plain and uniform; each corner is a compact deep-relief carving of an interlaced Urnes-style beast biting its own tail, in the same dark wood with faint worn highlights. Museum-quality woodcarving, all one dark wood colour.
```

## Backing prompt

```text
Seamless tileable texture, straight-on flat scan: dark smoked oak board surface with fine horizontal grain, very low contrast, deep brown-black, subtle wear. No knots, no planks seams, no carving, no objects. Must tile seamlessly on all edges.
```
