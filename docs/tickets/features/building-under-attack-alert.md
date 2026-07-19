# Alert the defender when their buildings come under siege

**Area:** app + render (+ audio) · **Origin:** attack-enemy-buildings review, 2026-07-19 ·
**Priority:** P3

Warriors can now besiege and raze enemy buildings, but the **defending** player gets no alert when a
siege begins. Their only feedback is the damage-smoke gauge and (once
`building-destroyed-feedback.md` lands) the destruction cue — both require the player to already be
looking at the building. A genre-standard "your buildings are under attack" alert (a minimap ping at
the struck building + optional stinger, rate-limited so a long siege pings once, not every swing) is
the missing-feedback half of the feature.

**Source basis:** the original surfaces player-facing notifications through its decoded `messages`
string table (see `building-destroyed-feedback.md` and `hunger-notifications.md`, which wire the
same `messages` surface). Whether the original had a specific "under attack" message id is an
investigate-first item — grep `content/gui/strings/` for a siege/attack string; if none exists, name
the substitute (reuse the destruction cue's copy, or an English placeholder per the English-strings
rule, with the i18n agent owning the Polish).

## Scope

- A sim signal the defender can react to: a `combatHit`/`projectileHit` carrying `structure: true`
  (the flag already set when a blow lands on a building) whose `target` the local player owns;
  render/app rate-limits per building (one alert per building per N seconds of continuous fire). The
  hit event carries `target` + `at` but not the owner, so the consumer reads the owner from the
  target — or, if the building has already been razed that tick, from a `buildingDestroyed` fallback.
- A minimap ping at the struck building's node and/or a non-spatial stinger for `player ===
  humanPlayer` — the building twin of the settler-death and hunger alerts. Reuse the notification
  surface `hunger-notifications.md` builds if it lands first; otherwise this ticket needs that toast
  surface (name the dependency).
- **Needs user:** any audio stinger needs the user's ears (`?sounds` / `?scene=siege`).

## Verify

`npm test` (the alert consumes an existing event — a render/app-side rate-limit + ping unit test);
`?scene=siege` from the defender's view — a besieged building pings the minimap once when the siege
starts, not on every swing (human check).
