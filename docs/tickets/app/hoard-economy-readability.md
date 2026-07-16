# Explain the housewives' food hoarding in the economy UI

**Area:** app (HUD readability) · **Origin:** marriage/children review, 2026-07-16 · **Priority:** P3

Women with a home continuously haul `food_simple`/`food_extra` from warehouses, the HQ, and ground
piles into their private home larders (`packages/sim/src/systems/family/hoard.ts`), and only that
home's residents may eat from them (`systems/agents/targets/food.ts` `edibleFoodGoodFor`). This is
user-directed design — but a player watching a warehouse drain has no answer to "where is my food
going?" beyond clicking every home in the settlement.

## Scope

Give the drain a readable surface — candidates (pick the cheapest that answers the question):

- The stats window's goods view: split the food total into "w magazynach" vs "w domach" (the per-home
  larder sum), so the settlement total visibly isn't shrinking, just moving.
- A carry tooltip / selection caption for a hoarding woman ("znosi jedzenie do domu"), so the walking
  carrier explains herself when clicked.
- The same caption seam should cover a woman driving a standing child order (the ChildOrder stages —
  stocking the child fund, waiting inside): today the only readable state is the make-child button
  disappearing and, much later, the hearts badge; a one-line status ("czeka na dziecko") in the
  settler panel's status text answers "what is she doing?".
- The home panel already shows the larder stock — no change needed there.

## Verify

- Headless: whatever aggregate is added gets a unit test over a hand-built snapshot.
- Human: watch a `?scene=family`-style settlement with hoarding women; the chosen surface answers
  "why is the warehouse draining" without clicking homes.
