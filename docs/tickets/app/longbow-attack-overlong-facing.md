# Bind the longbow attack when one facing's frame list overruns its sequence

**Area:** app · **Focus:** settler-gfx · **Priority:** P2

The longbow attack (action 81, `human_man_Warrior_Longbow_attack`, 168 frames) authors eight frame
lists; seven stay inside the sequence, but one runs to offsets 168-195. `drawsProgram`
(`packages/app/src/content/settler-gfx/bindings-character.ts`) rejects the whole program when an
offset past the sequence hits a blank or missing bob. On the frank and byzantine longbow look (tribes
2 and 3, job 41, body 32) those bobs are blank, so the attack is not bound and these archers shoot
from their idle pose. On the viking body the same offsets resolve to bobs of the next sequence, so one
facing may play frames of another clip.

Real maps place about 5700 frank and 700 byzantine longbowmen (36 and 21 maps).

## Scope

- Bind the attack per facing: a facing whose list stays inside the sequence plays as authored; a facing
  whose list overruns stands in with the nearest valid facing's list.
- Apply the same per-facing rule to every program `drawsProgram` checks, so one bad list never drops
  the other seven.
- Name the stand-in as an approximation in the binding.

## Verify

- Unit test: a program with one overrunning facing binds the other seven and substitutes the eighth.
- Content test: tribes 2 and 3, job 41 bind action 81.
- Browser: frank longbowmen in a skirmish draw the bow animation in every direction.
