# Calibrate progression against the running original

**Area:** sim · **Priority:** P2

Player discoveries, individual work qualifications, civilian schooling and script grants now share
one saved progression model. The implemented contract and source evidence live in
[PROGRESSION.md](../../formats/PROGRESSION.md). Readable tables establish thresholds, but several
runtime details remain approximations; readings of a later edition alone do not establish the
owned build's behavior.

## Scope

- Observe gathering, production, carrying and construction in the running original. Pin which
  completed actions increment general and specialized XP, and compare the work efficiency curve.
- Measure civilian school lesson timing, any costs, interruption and target-change behavior.
  The current model uses one second per point and resumes after needs interruptions; the original
  (unconfirmed reading) counts completed exercise animations, each adding its
  atomic event value, against the summed `trainforjob` and `trainforgood` rows of a (job, good)
  course pair, and a reissued course restarts the count. Confirm on the running original, then
  model the course as the pair with the combined cost and offer it to any settler.
- Check discovery retention after losing the only qualified worker and across sub-mission transitions.

Retain explicit approximations until observations support a replacement. Equipment and military
balance, vehicles, chests and campaign archive extraction are outside this calibration task.

## Verify

Record reproducible observations and update the progression contract. Add synthetic regressions for
confirmed changes and run normal gates. Revisit the school scene and a real custom map when timing
or presentation changes. Do not commit owned files or reference captures.
