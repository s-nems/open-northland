# Create the direct assistant window

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

The beam's assistant entry still reaches the assistant through the old Extras window
(`hud/tool-panel/extras-window.ts`, `extras-menu.ts`, `view/assistant-counters.ts`) with an
approximate layout.

In the original the assistant keeps target numbers of women and men, trains soldiers by weapon class
and equips subjects with shoes, wooden tools, iron tools and mead; a direct order to one subject
overrides it. Its settings are network commands, not local preferences.

## Scope

- Design the window with clear targets, current values, enable/disable controls, limits and an
  explanation of individual-order precedence, then open it directly from the beam. Follow the HUD panel
  rules in `packages/app/AGENTS.md`.
- Keep population, soldier/weapon-class and equipment automation on the existing session commands.
  Papers stay in the construction window, not here.
- Verify counter/limit and infinity behavior against available evidence before assuming parity, and
  name an approximation separately from a changed UX rule. Do not change automation policy to simplify
  the UI.
- Remove the Extras window once nothing reaches it.

## Verify

Test limits, repeated input, disabled settings, owner isolation and multiplayer command submission.
Compare the controls with the actual assistant state on empty, small and large settlements, and
provide the verified preview.
