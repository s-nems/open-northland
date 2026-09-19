# Surface livestock stalls to the player

**Area:** app · **Priority:** P3

The animal farm's panel names its herd but not why it stands idle. The sim side already decides: a
breeder breeds only while exactly two grown animals of the species stand at the farm, and it needs
water and grain for each (`systems/settlers/drives/husbandry`). A player reading 0% on the species
row has no way to tell which of those is missing.

## Scope

1. **Too few or too many.** Name the herd state that stops the breeding on the species row: a lone
   animal waiting for a second, or a third grown one waiting to be slaughtered rather than bred from.
2. **Nothing to breed with.** A staffed farm with an empty row and no animal to adopt anywhere near
   is a silent 0%; say that the breeder has no stock to take in.
3. **Banned chain.** An authored map can forbid a species; name that permission lock on its row.

## Verify

- Browser `?scene=livestock`: the row names the stall for a lone animal and for an empty herd.
- Browser real content with a scripted species ban: the lock is named on the Wół row.
