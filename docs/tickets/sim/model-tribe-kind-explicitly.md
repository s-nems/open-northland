# Model civilization, animal, and monster tribes explicitly

**Area:** data, pipeline, sim · **Focus:** content · **Priority:** P3

The sim currently defines a playable civilization as a tribe with `jobEnables.length > 0` and an animal
as a recorded tribe with an empty graph. That graph is progression data, not a tribe-kind discriminator.
The current generated corpus already disproves equivalence: `weresnake` and `werewolf` have empty
`jobEnables` but no `animals` record, while the other empty-graph tribes are backed by the animal table.
A legal authored civilization with no progression edges would also be reclassified as wildlife and
silently lose civilization-only needs, jobs, experience, AI, and conflict behavior.

## Scope

- Represent the civilization/animal/monster distinction explicitly in validated content. Animal
  membership comes from the animal table; confirm the readable or observed basis for the two monster
  tribes before pinning their category.
- Replace `jobEnables.length` classification with the explicit kind and update callers according to the
  distinction they actually need (controllable civilization, animal behavior record, or any hostile
  non-civilization).
- Keep progression graphs responsible only for unlocks. A civilization with an empty graph remains a
  civilization.
- Preserve current known-corpus behavior unless the source check proves a monster path is presently
  wrong; name any resulting mechanic change and approximation.

## Verify

Schema and content tests pin every current tribe into exactly one kind, including `weresnake` and
`werewolf`. A synthetic no-tech civilization still runs civilization needs/jobs and is not treated as
wildlife. Run `npm run test:pipeline`, `npm run test:content` when local content exists, `npm test`,
`npm run check`, and `npm run build`.
