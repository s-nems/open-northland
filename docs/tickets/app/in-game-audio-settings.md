# Reach the volume controls from inside a game

**Area:** app · **Priority:** P2

The sfx and music sliders live only on the main menu's settings screen
(`packages/app/src/entries/main-menu/settings.ts`). `mountGamePresentation`
(`packages/app/src/view/runtime/game-presentation.ts`) reads `readStoredSettings()` once at launch and
nothing re-reads it; the in-game system menu (`packages/app/src/view/system-menu.ts`) offers
Save/Load/Return/Diagnostics and no audio row, and `hud/keybindings.ts` has no mute key. Returning to
the menu is a document navigation that discards everything since the last save.

One-shot sound effects made this tolerable. A continuous soundtrack does not: a player who finds the
music too loud twenty minutes in has no way to change it without losing progress.

## Scope

- Add a music/sfx pair, or at minimum a mute toggle, to the in-game system menu, wired to
  `SoundDriver.setMusicVolume` / `setSfxVolume` and persisted through `view/settings-store.ts` so the
  main menu shows the same value on return.
- While there, decide the slider-to-gain curve. Both sliders map 0..1 linearly onto `GainNode.gain`
  (`packages/audio/src/web/engine/audio-engine.ts`), so gain 0.5 is -6 dB and the perceived midpoint
  sits near 0.25-0.3: most of the travel spends itself on the last 6 dB. The linear map is already
  named an approximation. The original's `dm_volume` / `fx_volume` are hundredths of a dB, which
  suggests a perceptual curve is the more faithful choice, but that is a hypothesis and needs the
  `docs/SOURCES.md` treatment before it becomes a claim.

## Verify

- Change music volume mid-track in game, return to the menu, and confirm the slider agrees.
- Human listening pass: sweep both sliders through their range and judge where the perceived halfway
  point lands before committing to a curve.
