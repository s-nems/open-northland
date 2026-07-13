# Confirm the montage-guessed GUI atlas frames with the user (human-oracle pass)

**Area:** app (content metadata) · **Origin:** original-ui plan reconciliation, 2026-07-12 · **Priority:** P3
**Needs user:** live naming Q&A with the user — not autonomously runnable.

`packages/app/src/content/gui-atlas-map.ts` is total over the 193-frame `ls_gui_window` sheet
(totality enforced by `packages/app/test/gui-atlas-map.test.ts`) but only 20 frames are
authoritatively `source:'openvikings'`; 173 are `source:'montage'` best-guesses, many still named
`unknown_NNN`. The order-command icons (frames ~96–136, consumed by the action ring) can NEVER be
code-recovered: OpenVikings' `sHumanCommandTypeToIconId` lookup is an unfilled placeholder — only
the 0x6b fallback is code-pinned. The user is the only oracle.

**This is a live interactive session** (repeated user Q&A) — it cannot run autonomously.

## Scope

- Regenerate `content/` if absent (`npm run pipeline -- --game "../Cultures 8th Wonder" --mod
  DataCnmd --out content`).
- Render a numbered montage of all 193 frames (grid, large index labels, 2× scale); present
  best guesses grouped by visual similarity; STOP for the user to confirm/correct frame by frame.
- Rename confirmed frames, promote each `source` per the provenance convention; keep the totality
  test green.

## Verify

- `npm test` + `npm run check` green; provenance notes in the map header updated.
- The confirmations themselves are the user's — no self-signing.
