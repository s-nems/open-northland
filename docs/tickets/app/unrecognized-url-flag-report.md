# Report unrecognized URL flag values instead of silently defaulting

**Area:** app · **Focus:** entries · **Priority:** P3 · **Complexity:** low

`?fog=reveals` (a plausible typo of `reveal`) parses to null and silently keeps the world's default,
so a session that meant to pin a rule runs without it and nothing says so; `fogModeParam`,
`onOffParam`, and the other enumerated flag parsers all share the silent-fallback shape. Diagnostic
URLs are the main consumer of these flags, which makes a silent wrong value expensive.

## Scope

- On an unrecognized value for an enumerated flag, emit one console warning naming the flag, the
  rejected value, and the accepted values; keep the null fallback behaviour itself.
- Cover the enumerated parsers reachable from the playable entries; a shared helper is justified
  only if it does not obscure each flag's accepted set.

## Verify

- A unit test per parser: unrecognized value warns once and falls back; recognized values stay
  silent.
- `npm test`, `npm run check`, `npm run build`.
