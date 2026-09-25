# Draw each clip with its authored head sequence

**Area:** app, pipeline · **Focus:** settler-gfx · **Priority:** P2

Every settler frame pairs a body bob with the head bob at the same pool offset in the head atlas. The
source can name a different head per record: `[gfxanimatomic]` and `[gfxwalkatomic]` rows carry
`gfxbobseqhead` (47 anim rows and 133 walk rows whose head sequence differs from the body sequence).
The pipeline extracts it as `headSeq`, but no app code reads it (`packages/app/src/content/ir/rows.ts`
is its only reference).

Consequences in the real content:

- **Headless soldiers.** The frank spearmen (tribe 2, jobs 32/33, body 52) have 0-px head bobs at the
  walk and wait offsets; their records name the `Sword_Walk` / `Longbow_wait` heads. Same for the frank
  and byzantine shortbow (job 40), the byzantine long sword, saber, axe and hero saber (jobs 35, 37-39,
  45), and the viking axe hero's walk (job 46). Reproduce:
  `?map=nowa_nadzieja&fog=off&center=30,107&zoom=3` shows purple frank spearmen with no heads.
- **Wrong head on heavy carriers.** The viking carry gaits for stone, mud, brick, crockery, pillar,
  spear, sword and broadsword name the stooped `walk_iron_gold` head; `carryHeadAnims`
  (`settler-gfx/bindings-character.ts`) borrows the upright base-walk head instead.

## Scope

- Resolve the head frame from the record's `headSeq` pool row when it is present, at the same program
  offset as the body; keep the same-offset head when the record names none.
- Replace the `carryHeadAnims` base-walk borrowing with the authored head sequence where one is named;
  keep the borrow only for a gait whose record names no head and whose head bob is empty.
- Covers walk, wait, atomic clips and carry gaits for every tribe look.

## Verify

- Content test over the real IR: for every bound tribe look and clip, each played frame has a non-empty
  head bob when the record authors a head sequence.
- Unit test for the head-row resolution and the carry fallback.
- Browser: the reproduce link above shows heads on all spearmen; a viking carrying stone walks stooped.
