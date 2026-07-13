# Visible cue for an actively fleeing unit

**Area:** render/app · **Origin:** gameplay review of fix/no-sprint, 2026-07-13 · **Priority:** P3
**Needs user:** the cue itself is a visual/fidelity judgement — observe the original first.

Since the flee run gait was removed (every unit moves at one constant pace — no sprint by design),
an actively fleeing civilian is indistinguishable at a glance from an ordinary walker: direction of
travel is the only tell. The 2× pace was, accidentally, the only render-visible panic signal; no
flee animation, icon, or sound exists today (the stance button shows the FLEE *mode*, not the
active *state*).

## Scope

- Observe the running original (`../Cultures 8th Wonder`): does a fleeing villager visibly change
  animation/gait/posture, show an icon, or play a sound? Record the observation as the source basis.
- Expose the active-flee fact to the render side (the sim's `Fleeing` component is not in the
  snapshot today — a snapshot field or a typed `SimEvent`, per the sim boundary rules), and draw
  the observed cue. Do NOT change movement speed — the constant-pace rule is a fixed design
  decision.

## Verify

- Unit test the snapshot/event exposure; the cue itself needs the user's eyes in a combat scene
  (civilian on FLEE stance + a hostile raider).
