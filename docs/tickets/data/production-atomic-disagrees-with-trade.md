# Resolve a craft's atomic when the good and the trade disagree

**Area:** data, sim · **Focus:** production atomics · **Priority:** P3

`startCraftAtomic` reads the product's `goodtypes.ini atomicForProduction` as the atomic its maker
performs, which the render then looks a choreography up by. Three of the source's 47 rows name an
atomic the making trade is not allowed to run, so those crafts resolve no program and their worker
keeps working out of sight:

| Ware | `atomicForProduction` | The trade's `allowatomic` |
| --- | --- | --- |
| `tool_iron` | 59, the wooden trade's | smith 13: 60, 63, 64, 68, 69, 70 |
| `spear_wooden` | 65, the bowyer's | joiner 9: 57, 59, 67 |
| `water` | none | civilist 6: 44, 45 |

Each has a program the worker should be playing: the smith's 60, the joiner's 67, and the civilist's
44 (the well). The tribe's own `setatomic` rows name them (`viking_smith_produce_tool_iron` on 60,
`viking_carpenter_produce_spear_wooden` on 67, `viking_civilist_produce_water` on 44), so the
information is in the content; the good-keyed lookup alone cannot reach it.

## Scope

- Give the craft lookup a rule that reaches the trade's own atomic when the good's disagrees, keyed on
  extracted data rather than on a list of these three ids.
- The rule is the deliverable: state it, and name it an approximation if the original's own resolution
  order stays undecoded.

## Verify

- Unit: a smith crafting `tool_iron`, a joiner crafting `spear_wooden`, and a civilist drawing water
  each resolve the atomic their tribe binds, and every ware whose row already agrees keeps its atomic.
- `npm run test:content`: no viking product resolves an atomic outside its maker's allowed set.
- Human pass: a staffed smithy, joinery and well each show their worker at the craft.
