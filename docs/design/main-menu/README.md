# Main menu design reference

A complete design for a new Open Northland menu flow: main menu, map selection, game lobby,
settings, and credits. Art direction is "polar night": the live in-game settlement scene renders
behind every screen, color-graded to a cool night palette, with an aurora glow and large serif
display typography.

This is a reference to build against, not code to copy.

## How to use this

[`menu-designs.html`](menu-designs.html) is the mockup. Open it in a browser; each screen is a
1920x1080 frame at 50% scale. Accepted screens carry ids `2a` main menu, `4a` map select, `4b`
lobby, `3c` settings, `5a` credits. Turns `1a`-`1c`, `2b`, and `3a` are exploration history; `3b`
(the *Wczytaj grę* list layout) is unrevised but directionally accepted.

The menu to replace is `packages/app/src/entries/menu.ts` with
`packages/app/src/entries/menu/menu.css`. It is already a DOM overlay above the Pixi canvas, so
these specs translate to CSS directly. Drawing the menu in-engine is possible but not recommended.

Fidelity is high. Colors, typography, spacing, and states are final and should be matched exactly.
Blocks marked `[ ... ]` (scene, map thumbnails, save screenshots) are placeholders for live engine
renders.

Accepted deviations (user feedback, 2026-08-03): the mockups' 1:1 scale read oversized in a real
viewport, so sub-screens render all design px at 0.8 (`--u` override in `menu.css`), which also
lowers the 19px text minimum proportionally; the home screen shrinks its type (logo 110, menu items
30, eyebrow 19, version 18, badge 14); the lobby has no "Zmień mapę" link - the header back button
and Esc cover it. The credits screen drops the mockup's two-column split: the "no original files"
paragraph was removed entirely (the setup flow owns that message), and the sparse remainder - intro, repo
links, the team and thanks cards, legal line - sits as one centered column. Its cards carry real
content, not the mockup placeholders: the team card lists the one actual maintainer (no
"współtwórcy GitHub" row), the thanks card adds the CulturesNation.pl community beside Funatics,
and the legal line reuses the home screen's version constant, so it reads "GPL-3.0" rather than
"licencja GPL-3.0".

Settings deviations: every live control applies and persists immediately, so the footer keeps only
"Przywróć domyślne" plus an autosave note - there is no "Zapisz" button. Controls without an engine
backend yet (resolution, the volume sliders, scroll speed, edge scrolling, the whole Sterowanie
tab) render disabled with the "wkrótce" badge instead of being omitted; the resolution slot shows
the live window size until a real dropdown exists (desktop). The design's "Płynne przewijanie
mapy" and "Animowana scena w menu" rows are dropped entirely (user decision 2026-08-03); reduced
motion still gets a motionless backdrop (background deviation below). Rows the design lacks: "Język" (endonym segment),
"Dźwięk w grze" (the `?sound` mute - the game has no in-game sound toggle, starts audible and
resumes its audio context on the first input gesture), "Prędkość przewijania mapy" and
"Przewijanie przy krawędzi ekranu". The scale slider is labelled "Skala
interfejsu w grze" because it drives only the in-game HUD; the menu's own scale stays
viewport-derived.

Background deviation (user decision 2026-08-03): layer 1 of the background stack is not a live sim
render. The menu rotates through settlement stills captured from decoded maps (`npm run
menu-backdrops` into the gitignored `content/backdrops/` - the stills contain original art and
never enter the repository), starting at a random one and crossfading with a slow push-in; the
grade layers above are unchanged. The ambient-scene boot lives on as the `?backdrop` capture
entry. Without the stills the static brand art stands. Under prefers-reduced-motion the rotation keeps
its slow crossfade (a fade is the reduced-motion substitute for movement) and only the push-in
stops; the earlier freeze-everything reading hid the backdrop change entirely on systems with
Reduce Motion enabled.

Fonts are the one asset gap. The design calls for Cinzel (display) and Alegreya Sans (UI); the repo
currently bundles only Tinos under `packages/app/public/fonts/`. Both are OFL, so an implementation
should bundle them locally rather than keep the mockup's Google Fonts link.

### Provenance

The design came from a Claude design-canvas session. The mockup here is that output with its
runtime removed: the `support.js` bundle is dropped, the `<x-dc>`/`<helmet>` wrapper is unwrapped
into a normal `<head>`, and the `style-hover` attributes are compiled into plain CSS `:hover` rules.
The page is static and renders with no script.

## Design tokens

### Colors

```
--bg-base:        #0c1420   (deepest background, fallback behind scene)
--bg-panel:       #16283a   (scene tint color; also gradient stop)
--bg-panel-2:     #101d2c / #1b3140 (gradient stops)
--surface:        rgba(16,29,44,.6)   (card/row background)
--surface-active: rgba(20,38,54,.75)  (selected card/row)
--accent:         #63c4a0   (mint/aurora green - borders, active, primary)
--accent-bright:  #8ff0c8   (hover text, primary-button gradient top)
--accent-dim:     rgba(99,196,160,.18) (idle borders; .35 for inputs, .5 emphasized)
--text-primary:   #e9f1ee   (headings)
--text-body:      #dbe8e3   (labels, menu items)
--text-muted:     rgba(180,205,200,.55-.7) (secondary)
--text-label:     #8fb8ad   (eyebrows, kickers; rgba(143,184,173,.7) for column headers)
--danger:         #c96a4a   (exit hover border), #e8a58a (exit hover text)
--on-accent:      #0c1420   (text on green buttons)
Player colors: #c94f3e red · #3e6fc9 blue · #c9a83e yellow · #5e9e4a green
```

### Background stack (every screen, bottom to top)

1. **Live scene**: the animated in-game settlement render (slow camera drift), CSS
   `filter: saturate(.55) brightness(.5)`
2. **Tint layer**: full-bleed `#16283a` with `mix-blend-mode: color`
3. **Darkening gradient**: main menu
   `linear-gradient(200deg, rgba(12,20,32,.85), rgba(16,29,44,.55) 45%, rgba(20,38,54,.6) 78%, rgba(9,15,22,.92))`;
   sub-screens use a heavier version (.9 / .72 / .94) for content legibility
4. **Aurora**: two blurred radial gradients top-left, `rgba(84,196,160,.26)` (green, blur 6px) and
   `rgba(110,170,220,.16)` (blue, blur 8px); sub-screens use green only at .18

Settings has a toggle *Animowana scena w menu*. When off, freeze the scene to a static frame and
keep the grade.

### Typography

- **Display/serif:** Cinzel (700 titles, 600 dialog headers) for logo and screen titles
- **UI/sans:** Alegreya Sans (400 body, 500 UI, 700 emphasis)
- Scale at 1920x1080: logo 150px/0.98 · screen title 60-64px · row title 27px · menu items 34px/500
  · buttons 24-28px · body 25-30px · secondary 19-22px · eyebrow 20-22px, letter-spacing .3em,
  uppercase
- Minimum text size 19px at 1080p, scaling proportionally with the UI scale setting

### Shape and elevation

- Radius: 6px buttons/inputs · 8px cards/rows · 50% avatars
- Borders: 2px solid, accent at .18 idle, .35-.5 active or selected
- Primary button: `linear-gradient(180deg,#8ff0c8,#63c4a0)`, text `#0c1420` 700, glow
  `0 0 34px rgba(99,196,160,.35)`, to `.55` plus `translateY(-2px)` on hover
- Selected card glow: `0 0 30-34px rgba(99,196,160,.15-.2)`
- Diamond motif: 9px square rotated 45°, `#63c4a0`, precedes eyebrow labels

## Screens

### 1. Main menu (`2a`)

Content block is bottom-anchored: `left/right: 120px; bottom: 96px`, two columns space-between.

**Left:** eyebrow (diamond + "OTWARTA REIMPLEMENTACJA SERII CULTURES", 22px, ls .34em, `#8fb8ad`),
then logo "OPEN␤NORTHLAND" (Cinzel 700 150px, `#e9f1ee`,
`text-shadow: 0 0 60px rgba(99,196,160,.25)`), then the version line "pre-alpha 0.1 · GPL-3.0" (21px
muted).

**Right:** vertical nav, right-aligned, gap 22px. Items 34px/500 `#dbe8e3`. Hover: color `#8ff0c8`,
2px bottom border `#63c4a0`, letter-spacing .04em to .07em, transition ~150ms.

Items: *Nowa gra* · *Wczytaj grę* · *Multiplayer* · *Ustawienia* · *Twórcy* · *Wyjście*.
*Multiplayer* is disabled: text at .35 opacity plus a pill badge "WKRÓTCE" (16px, ls .14em,
`#63c4a0`, 1px border `rgba(99,196,160,.5)`, radius 20px, padding 4px 11px). *Wyjście* sits at .6
opacity and hovers to `#e8a58a` text with a `#c96a4a` underline.

**Wyjście quits immediately, with no confirmation dialog.**

### 2. New game, map select (`4a`)

Padding 72px 120px 80px. Header row: back link "← Menu" (24px, muted, `#8ff0c8` on hover) plus title
"Nowa gra" (Cinzel 60px). Right side: search field (340px, 2px accent-dim border, placeholder
"Szukaj mapy…") plus a segmented filter *Wszystkie / Fabularne / Multiplayer / Sceny testowe*
(active segment: `#63c4a0` background, `#0c1420` text 700; joined segments, shared 2px border,
radius 6px).

**Body:** two columns, gap 56px.

- **Left (620px, scrollable):** map rows with an 84x56 thumbnail, name 25px, meta 19px ("średnia ·
  2-4 graczy"). Selected: 4px left border `#63c4a0`, background `rgba(99,196,160,.12)`, name in
  `#8ff0c8`. Hover background at .06. Thin 6px accent scrollbar, bottom fade gradient, footer count
  "23 mapy · przewijaj lub szukaj". Designed for dozens of maps: virtualize or scroll, search
  filters by name, tabs filter by category.
- **Right (flex):** large live map preview (2px border accent .35, radius 8px, subtle glow), then
  map name 34px, meta chips 22px (size · dimensions · players · tags), and the primary button
  *Dalej* (28px, padding 20px 60px) leading to the lobby.

### 3. Lobby (`4b`), shared between local play and future multiplayer

Same padding and header pattern; back link "← Wybór mapy", title "Lobby", right kicker "GRA LOKALNA"
(22px, ls .24em).

**Left column, player slots.** The slot list is fixed and defined by the map: no add or remove. Grid
per row `56px | 1fr | 280px | 240px`, gap 24px, padding 20px 26px.

- Column headers: SLOT · STEROWANIE (19px, ls .14em, uppercase, `rgba(143,184,173,.7)`).
- Slot color chip: 44x44, radius 8px, player color, slot number in white 700 22px. Your slot's chip
  gets `box-shadow: 0 0 0 3px rgba(255,255,255,.2)`.
- **Your slot** uses the selected style (border accent .4, background surface-active): name 27px
  `#e9f1ee`, sub "tu siedzisz" (20px `#8fb8ad`), control cell a static "Człowiek" (23px `#8ff0c8`,
  2px border accent .5).
- **Locked scenario-AI slot:** row at .75 opacity, border accent .12, name (for example "Jarl
  Sigurd") plus sub "przeciwnik scenariusza", control "SI - zablokowany" (muted). No sit action, not
  editable.
- **Open slot:** name "Wolny slot" plus a sub reflecting its state; control is a segmented toggle
  *Komputer / Bezczynny* (active segment `#63c4a0` background); the last cell is a "Usiądź tutaj"
  button (2px dashed accent .35, to solid `#63c4a0` with `#8ff0c8` text on hover). Sitting moves the
  player between slots.
- Footnote: "Sloty definiuje mapa - nie da się ich dodać ani usunąć. Możesz zmienić miejsce,
  siadając w wolnym slocie."

**Right column (420px):** map preview 260px, name and meta, a "Zmień mapę" underlined link, and a
bottom-anchored *Ustawienia rozgrywki* card (2px border accent .2, radius 8px) holding an eyebrow
header and two toggle rows, *Mgła wojny* and *Rozwój zawodów*. Toggle spec: 66x34 pill, on =
`#63c4a0` track with a `#0c1420` knob at 26px, off = track `rgba(99,196,160,.2)` with the knob left.
Below the card, the primary button *Rozpocznij grę* (30px, full width).

Multiplayer reuses this layout: open slots become joinable by network players and the kicker
changes.

### 4. Settings (`3c`)

Header: "← Menu" plus "Ustawienia" (Cinzel 64px).

**Left nav (300px):** *Grafika · Dźwięk · Rozgrywka · Sterowanie*, 27px items. Active: 700
`#8ff0c8`, 4px left border `#63c4a0`, background `rgba(99,196,160,.1)`. Hover: left border at 40%
accent.

**Right panel (max 960px)**, rows space-between, gap 34px. Label 26px/500 `#dbe8e3`. Controls:

- Segmented: *Pełny ekran / Okno*, styled as the filter tabs
- Dropdown: "1920 × 1080 ▾" (2px border accent .35, padding 12px 26px)
- Slider: 420px track 6px, fill `#63c4a0`, knob 22px `#8ff0c8` with glow, value right-aligned
  ("110%")
- Toggles: *Płynne przewijanie mapy* and *Animowana scena w menu*, same pill spec as the lobby

**Footer, right-aligned:** *Przywróć domyślne* (ghost: muted text, 2px rgba-white border) and
*Zapisz* (primary).

### 5. Credits / about (`5a`)

Header: "← Menu" plus "O projekcie".

**Left (max 860px):** intro paragraph 30px/1.55 `#dbe8e3`, second paragraph 26px muted (original
game files are not included; the user points at their own *Cultures - 8th Wonder of the World*
copy), then two ghost buttons, "Kod źródłowy - GitHub" (accent border) and "Zgłoś błąd"
(white-muted border), wired to the repo URLs.

**Right (max 520px):** two cards (border accent .2, background surface, padding 28px 32px),
*Zespół* (rows: name left, role right-muted) and *Podziękowania* (Funatics Software credit). Below
them a legal line 21px at .45 opacity: "pre-alpha 0.1 · licencja GPL-3.0 · projekt niekomercyjny,
niezwiązany z posiadaczami praw do serii".

## Interactions and behavior

- Hover transitions ~150ms ease-out on color, border, letter-spacing, and translateY.
- Navigation: *Nowa gra* to map select, *Dalej* to lobby, *Rozpocznij grę* to the game. Back links
  return one level. *Wyjście* quits immediately.
- Screen transitions crossfade the content over the persistent scene (~200-250ms); the graded scene
  layer never reloads between menu screens.
- Keyboard: arrows and enter navigate the main menu, Esc goes back one level.
- Disabled (*Multiplayer*): non-interactive, no hover, default cursor.
- Scene toggle off means a static frame instead of the animated scene.

## State

- `menuScreen`: `main | newGame | lobby | load | settings | credits`
- `mapFilter` (`all | story | multiplayer | test`), `mapSearch`, `selectedMapId`
- Lobby: `slots[]` from the map definition, each
  `{ id, color, kind: human|scenarioAI|open, control: computer|idle, occupant }`, plus `mySlotId`.
  Actions: `sitInSlot(id)` (only `kind=open`) and `setSlotControl(id, control)`. Flags `fogOfWar`
  and `professionDevelopment`.
- Settings persist locally: `displayMode`, `resolution`, `uiScale`, `smoothScroll`,
  `animatedMenuScene`.

## Assets

No raster assets. The aurora and the color grading are pure CSS. Every `[ ... ]` placeholder is an
engine render: the scene, map minimaps and previews, and save screenshots.
