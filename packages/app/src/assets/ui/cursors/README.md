# Cursor UI

Original artwork generated for this project, without original-game assets as input.
The shared interface uses four families: forged iron, bone, amber and cold steel (default).
Transparent PNG deliveries cover 16 states at 24, 28 and 32 CSS px, each at 1× and 2× density.

`view/cursors/hotspots.ts` owns the CSS-pixel click points, shared by both density variants.
The pointer, selection and pressed states retain the same click point. Cursor size is independent
of camera zoom and HUD scale; the system option retains the operating system's own cursor settings.
