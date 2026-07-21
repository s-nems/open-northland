# Exclude construction sites from job openings

**Area:** sim · **Priority:** P3

Neither the automatic jobSystem nor hand-assignment gates job openings on `UnderConstruction`
(`systems/economy/jobs/openings.ts` — `openJobAt`/`openPostFor`), so a NEW idle settler can be bound
to an upgrading (or fresh-site) building's open worker slot and then stand idle at the planner's
stand-down gate (`ai.ts`, below planBuilder) for the whole build instead of taking a productive job
elsewhere. Not a deadlock — the binding resumes work the tick the site finishes — but a
player-visible idle hire.

## Scope

Skip every `UnderConstruction` workplace in both automatic openings and hand assignment. This also
disables pre-hiring for fresh sites; `jobtypes.ini` only proves that the work requires a finished
building, so record the hiring timing as an approximation.

## Verify

A module test covers fresh construction and upgrades: neither accepts a worker until completion, and
the idle settler can take another opening meanwhile. Run `npm test`, `npm run check`, and `npm run build`;
name any intentional golden change.
