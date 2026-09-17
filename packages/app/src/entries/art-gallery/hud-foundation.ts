import { uiFoundationArt } from '../../content/own-assets/ui-foundation.js';
import foundationCss from '../../hud/dom/foundation.css?inline';
import { ACTION_ART_PX, GLYPH, menuArt, paintedIcon, RESIDENTS_TOKEN } from '../../hud/dom/icons.js';
import { createHudPlane } from '../../hud/dom/root.js';
import { WINDOW_ORNAMENTS } from '../../hud/dom/symbols.js';
import { MAX_UI_SCALE_BASE, MIN_UI_SCALE, UI_SCALE_FACTOR_MAX } from '../../hud/ui-scale.js';
import { element } from './controls.js';

/** The board's design-px frame: the minimum supported viewport at 90% (FOUNDATION.md). */
const BOARD_WIDTH = 1280;
const BOARD_HEIGHT = 720;
const TITLE_ART_PX = 43;
const MENU_MEDALLION_PX = 40;
const MENU_ART_PX = 34;
const SCALE_STEP = 0.05;

const ACTIONS: readonly (readonly [icon: string | null, label: string])[] = [
  ['build', 'Buduj'],
  [null, 'Mieszkańcy'],
  ['assistant', 'Asystent'],
  ['statistics', 'Statystyki'],
  ['mission', 'Misja'],
  ['diplomacy', 'Dyplomacja'],
  ['knowledge', 'Wiedza'],
];

function card(title: string, text: string, cost: string, glyph: string, state = ''): string {
  return `<button type="button" class="on-card" ${state}><span class="on-card__thumb">${glyph}</span><span><strong class="on-card__title">${title}</strong><small class="on-card__text">${text}</small></span><span class="on-card__cost">${cost}</span></button>`;
}

/** Every primitive of the foundation on one board, laid out where the HUD regions will sit. */
function boardMarkup(): string {
  const actions = ACTIONS.map(
    ([name, label], index) =>
      `<button type="button" class="on-action" ${index === 0 ? 'aria-pressed="true"' : ''}><span class="on-action__art">${
        name === null ? RESIDENTS_TOKEN : paintedIcon(name, ACTION_ART_PX)
      }</span><span class="on-action__label">${label}</span></button>`,
  ).join('');
  return `
<div class="on-bar on-bar--left on-panel" style="position:absolute;top:0;right:246px;display:flex;z-index:30">
  <button type="button" class="on-bar__count" aria-label="Kobiety: 12">${GLYPH.woman}<b>12</b></button>
  <button type="button" class="on-bar__count" aria-label="Mężczyźni: 16">${GLYPH.man}<b>16</b></button>
  <button type="button" class="on-bar__count" aria-label="Dzieci: 6">${GLYPH.child}<b>6</b></button>
  <span class="on-bar__divider"></span>
  <button type="button" class="on-bar__count" aria-label="Materiały: 72" aria-expanded="true"><b>72</b></button>
  <div class="on-tip" role="tooltip"><h4 class="on-tip__title">Materiały</h4><p class="on-tip__row"><span>Drewno</span><b>42</b></p><p class="on-tip__row"><span>Kamień</span><b>18</b></p><small class="on-tip__foot">Magazyny Twojego plemienia · cała mapa</small></div>
</div>
<div class="on-bar on-bar--right on-panel" style="position:absolute;top:0;right:0;display:flex;z-index:30">
  <time class="on-clock">01:24:08</time>
  <div class="on-speed" role="toolbar" aria-label="Tempo symulacji"><button type="button" aria-label="Pauza" aria-pressed="false">❚❚</button><button type="button" aria-pressed="true">×1</button><button type="button" aria-pressed="false">×3</button></div>
  <button type="button" class="on-medallion" style="width:${MENU_MEDALLION_PX}px;height:${MENU_MEDALLION_PX}px;margin-left:4px" aria-label="Menu gry">${menuArt(MENU_ART_PX)}</button>
</div>
<aside style="position:absolute;top:18px;left:10px;width:198px">
  <div style="display:flex;align-items:center;gap:10px;padding:0 0 10px 2px">
    <strong class="on-counter on-medallion"><span class="on-sr">Wiadomości: </span>8</strong>
    <div class="on-filters" role="toolbar" aria-label="Poziom wiadomości"><button type="button" class="on-filter on-filter--low" aria-label="Wszystkie" aria-pressed="false"></button><button type="button" class="on-filter on-filter--medium" aria-label="Ważne i pilne" aria-pressed="true"></button><button type="button" class="on-filter on-filter--high" aria-label="Tylko pilne" aria-pressed="false"></button></div>
  </div>
  <button type="button" class="on-notice"><span class="on-notice__preview"></span><b class="on-notice__title">Brakuje narzędzi</b><small class="on-notice__text">Eirik · drwal</small><i class="on-seal on-seal--warn" aria-hidden="true"></i>${GLYPH.go}</button>
  <button type="button" class="on-notice"><span class="on-notice__preview"></span><b class="on-notice__title">Budowa ukończona</b><small class="on-notice__text">Chata rybaka</small><i class="on-seal" aria-hidden="true"></i>${GLYPH.go}</button>
  <button type="button" class="on-notice"><span class="on-notice__preview"></span><b class="on-notice__title">Osadnik głoduje</b><small class="on-notice__text">Leif · budowniczy</small><i class="on-seal on-seal--danger" aria-hidden="true"></i>${GLYPH.go}</button>
</aside>
<section class="on-window on-panel" style="left:50%;top:96px;width:540px;transform:translateX(-50%)" aria-label="Budowanie">
  ${WINDOW_ORNAMENTS}
  <header class="on-window__head"><div class="on-window__heading">${paintedIcon('build', TITLE_ART_PX)}<div><h2 class="on-window__title">Budowanie</h2><p class="on-window__subtitle">Wybierz budynek, następnie wskaż miejsce na mapie</p></div></div><button type="button" class="on-medallion on-window__close" aria-label="Zamknij">${GLYPH.close}</button></header>
  <div class="on-toolrow"><button type="button" class="on-button">Droga</button><button type="button" class="on-button">Palisada</button><button type="button" class="on-button on-button--accent">Dokumenty · 2</button></div>
  <div class="on-tabs" role="tablist"><button type="button" role="tab" class="on-tab" aria-selected="true">Wszystkie<span class="on-tab__count">4</span></button><button type="button" role="tab" class="on-tab" aria-selected="false">Praca<span class="on-tab__count">2</span></button><button type="button" role="tab" class="on-tab" aria-selected="false">Domy<span class="on-tab__count">0</span></button></div>
  <div class="on-parchment"><p class="on-parchment__note">Dostępne teraz · 4 budynki</p><div class="on-grid">
    ${card('Chata drwala', 'Produkuje drewno · 1–3 pracowników', '<i class="on-chip">🪵 8</i><i class="on-chip">◆ 4</i>', GLYPH.house, 'aria-pressed="true"')}
    ${card('Chata rybaka', 'Łowi ryby przy brzegu', '<i class="on-chip">🪵 6</i><i class="on-chip">◆ 2</i>', GLYPH.house)}
    ${card('Magazyn', 'Przechowuje towary plemienia', '<i class="on-chip">🪵 12 / 8</i><i class="on-chip on-chip--bad">brak 3</i>', GLYPH.house)}
    ${card('Kuźnia', 'Wymaga: Kowal II', '<i class="on-chip">Niedostępne</i>', GLYPH.forge, 'disabled')}
  </div></div>
  <div class="on-hint">${GLYPH.pin}<span><b>Chata drwala</b> · wskaż miejsce na mapie</span><kbd class="on-key">Esc</kbd></div>
</section>
<aside class="on-window on-panel" style="right:0;bottom:0;width:318px;height:405px" aria-label="Zaznaczenie">
  ${WINDOW_ORNAMENTS}
  <header class="on-window__head on-window__head--compact"><div><p class="on-window__kicker">ZAZNACZENIE</p><h2 class="on-window__title on-window__title--compact">Eirik · Drwal II</h2></div><button type="button" class="on-medallion on-window__close" aria-label="Usuń zaznaczenie">${GLYPH.close}</button></header>
  <div class="on-window__body">
    <div class="on-portrait"><div class="on-portrait__frame"><span class="on-level"><span class="on-sr">Poziom </span>II</span></div><div><strong class="on-portrait__name">Wraca do pracy</strong><div class="on-status--ok">Zdrowy · najedzony</div><div class="on-status--warn">Potrzebuje narzędzi</div></div></div>
    <div class="on-section">Samopoczucie</div>
    <div class="on-ledger"><span>Zdrowie</span><b>72 / 100</b></div>
    <div class="on-meter" style="--value:72%"></div>
    <div class="on-ledger"><span>Sytość</span><b>64%</b></div>
    <div class="on-section">Praca i dom</div>
    <div class="on-ledger"><span>Miejsce pracy</span><b>Chata drwala</b></div>
    <div class="on-ledger"><span>Dom</span><b>Dom rodzinny</b></div>
    <div class="on-orders"><button type="button" class="on-button on-button--rounded">${GLYPH.center}Centruj</button><button type="button" class="on-button on-button--rounded">${GLYPH.orders}Rozkazy</button></div>
  </div>
</aside>
<nav class="on-beam on-panel" style="position:absolute;left:50%;bottom:0;transform:translateX(-50%)" aria-label="Menu gry">${actions}</nav>`;
}

/** The gallery's HUD foundation tab: the primitives at a chosen HUD scale, with the delivery state. */
export function renderHudFoundation(main: HTMLElement, initialScale: number): void {
  const art = uiFoundationArt();
  const detail = element('div');
  detail.className = 'detail';
  detail.append(
    element('h2', 'HUD foundation'),
    element(
      'p',
      art === null
        ? 'Chrome art not delivered: flat fallback surfaces and empty icon slots. Build and publish ui/foundation, or run the dev server with ART_CANDIDATE.'
        : `Delivered ui/foundation: ${art.manifest.icons.names.length} icons, surface ${art.manifest.surface.width} × ${art.manifest.surface.height}.`,
    ),
  );
  const scaleLabel = element('label');
  const slider = element('input');
  slider.type = 'range';
  slider.min = String(MIN_UI_SCALE);
  slider.max = String(MAX_UI_SCALE_BASE * UI_SCALE_FACTOR_MAX);
  slider.step = String(SCALE_STEP);
  slider.value = String(initialScale);
  const scaleValue = element('span', `${initialScale}×`);
  scaleLabel.append('HUD scale ', slider, scaleValue);
  detail.append(scaleLabel);

  const stage = element('div');
  stage.className = 'viewport dark';
  const frame = element('div');
  Object.assign(frame.style, { position: 'relative', margin: '16px' });
  // A shadow root keeps the gallery's own element styles off the board, as the game page has none.
  const isolated = frame.attachShadow({ mode: 'open' });
  const sheet = document.createElement('style');
  sheet.textContent = foundationCss;
  const plane = createHudPlane(initialScale);
  plane.element.insertAdjacentHTML('beforeend', boardMarkup());
  isolated.append(sheet, plane.element);
  stage.append(frame);
  const applyScale = (scale: number): void => {
    frame.style.width = `${BOARD_WIDTH * scale}px`;
    frame.style.height = `${BOARD_HEIGHT * scale}px`;
    void plane.setUiScale(scale);
    scaleValue.textContent = `${scale}×`;
  };
  applyScale(initialScale);
  slider.addEventListener('input', () => applyScale(Number(slider.value)));
  main.replaceChildren(detail, stage);
}
