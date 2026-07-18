# Job openings should skip construction sites

**Area:** sim · **Origin:** building-upgrades merge review, 2026-07-18 · **Priority:** P3

Neither the automatic jobSystem nor hand-assignment gates job openings on `UnderConstruction`
(`systems/economy/jobs/openings.ts` — `openJobAt`/`openPostFor`), so a NEW idle settler can be bound
to an upgrading (or fresh-site) building's open worker slot and then stand idle at the planner's
stand-down gate (`ai.ts`, below planBuilder) for the whole build instead of taking a productive job
elsewhere. Not a deadlock — the binding resumes work the tick the site finishes — but a
player-visible idle hire.

Scope: skip site workplaces when opening jobs (both the automatic scan and the hand-assign path),
and decide the fresh-construction case deliberately: gating fresh sites changes hiring TIMING for
normal construction (workers today can pre-bind while the building rises), so check the goldens and
name the chosen behavior. Source basis: whether the original pre-hires for an unfinished workhouse
is unobserved — `jobtypes.ini` `mustHaveFinishedWorkHouseFlag 1` gates the WORK, not necessarily the
hire; observe or name the approximation.
