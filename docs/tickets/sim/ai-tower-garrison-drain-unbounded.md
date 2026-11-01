# Bound the computer player's tower garrison against its field army

**Area:** sim · **Priority:** P2

`towerPostOrders` (`packages/sim/src/systems/ai-shared/military/defence/posts.ts`) mans every standing
tower of a strategic seat with up to `TOWER_GARRISON_ARCHERS = 3` archers from its home-ready men, with
no seat-wide bound. Posted men leave the field census (`ai-shared/military/census.ts`) and the
`computer-player` rule never releases them; only the `map-ai` rule sends surplus posts back out.

Tower count has no fixed cap either. The two `towerCoverage` lanes in
`computer-player/build-order/military-line.ts` (the opening ring, then `SETTLED_DEFENCE` once
`ECONOMY_SAFE` holds) keep placing towers until the defence wants, scaled per seat by
`seatDefenceWants` (`build-order/tower-defence.ts`), are met. The draft
(`computer-player/workforce/garrison.ts`) counts only unposted men as the field army and drafts one
archer per empty tower ahead of the field share, so posted men are replaced from the seat's spare men.
Where the profile drafts to its army cap (`draftCeiling`), the towers instead eat into that capped army:
six full towers hold 18 men that never march.

## Scope

Bound strategic garrison staffing so tower growth keeps a marchable field band: for example a share of
the seat's fighters, a bounded set of manned towers, or posting only while the field holds at least
`ARMY_FLOOR_MIN` men. Name the chosen rule's basis. Keep the `map-ai` staffing and release rule intact.

## Verify

- Headless: add towers against a fixed, capped army and confirm the field band survives instead of every
  archer being posted.
- Existing garrison cases still post three archers per tower when the rule admits spare men; posted men
  stay outside the field census. Cover release and save/restore if the rule needs them.
