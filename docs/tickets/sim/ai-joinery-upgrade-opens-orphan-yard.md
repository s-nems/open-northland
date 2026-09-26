# AI joinery upgrade opens a vehicle yard nobody fills

**Area:** sim · **Priority:** P3


When an AI seat's joinery finishes its level-3 upgrade, its new hires start with the default
product selection, which covers every product. One craft cycle can land on the handcart before the
next craft decision narrows the seats back to tools and furniture, and that cycle opens a hidden
handcart yard site beside the workshop. The AI never returns to the cart good and nothing demolishes
the yard, so it stands at 0% for the rest of the game. Seen headless on `magiczny_las` with six AI
seats around tick 86000 (the yard no longer holds a build-order site slot).

## Scope

- Keep the seat's craft selection across an upgrade, or narrow it on the tier change before the
  first cycle runs (`packages/sim/src/systems/ai-player/workforce/craft.ts`).
- Let the AI demolish a yard site whose good no craft plan of its owner selects.

## Verify

A case in `packages/sim/test/systems/ai-player/garrison-and-craft.cases.ts`: a joinery upgraded to
the tier that offers a vehicle never opens a yard under the AI's selection, and an orphan yard is
torn down at the next craft decision.
