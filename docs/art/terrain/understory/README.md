# Low vegetation

Candidate pack for 23 missing map variants: four reeds, fourteen flower patches, two winter grass
patches and three dense grass tufts. Existing meadow sprites remain unchanged.

`asset.json` owns layout, compatibility names, frame dimensions, scale 0.5 and ground anchors.
The three `*-alpha.png` masters are genuine RGBA exports. `generation.json` retains the exact prompts,
ordered reference roles, hashes and API settings; the corresponding `*-master.png` images are
historical built-in studies with painted checkerboards, never runtime inputs. The first two cells of
the flower master are unused because existing meadow assets already cover those names.

Build with `npm run art -- build terrain/understory`. Follow [the shared pipeline](../../PIPELINE.md)
for validation, candidate preview, visual acceptance and publication. No approval receipt has been
created. The candidate replaces 4,161 placements on Magiczny Las across 14 covered variants.

## Review locations

Append these queries to the candidate preview server URL:

| Subject | Query |
| --- | --- |
| Gallery | `?art=gallery&tab=terrain&asset=props/reed-01&compare=props/flower-blue-01,props/grass-winter-01` |
| Reeds | `?map=magiczny_las&assets=own&intro=off&zoom=2&center=68,36&fog=off` |
| Flowers | `?map=magiczny_las&assets=own&intro=off&zoom=2&center=144,20&fog=off` |
| Winter grass | `?map=straznicypolnocy&assets=own&intro=off&zoom=2&center=88,136&fog=off` |
| Dense grass | `?map=gringo&assets=own&intro=off&zoom=2&center=76,176&fog=off` |

These are verified family placement areas, not coverage of every variant in a single view.
Inspect alpha edges on light and dark backgrounds, muted colour beside existing plants, ground
contacts and readability at zoom ×2 and zoom-out. Winter ground still uses the missing-material
checkerboard; unrelated landscape objects and actors can retain placeholders.

The vegetation is independently painted and static; original animation is not reproduced. The API
export softens and changes some fine flower shapes relative to the built-in study. Native pixels
are proportionally downsampled into original frame budgets, with preserved original anchors;
brightness follows the existing meadow calibration. Snow trees, snow bushes and harvestable herbs
are outside this low vegetation pack.
