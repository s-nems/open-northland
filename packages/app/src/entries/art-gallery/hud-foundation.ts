import { iconCellStyle, uiFoundationArt } from '../../content/own-assets/ui-foundation.js';
import foundationCss from '../../hud/dom/foundation.css?inline';
import { createHudPlane } from '../../hud/dom/root.js';
import { WINDOW_ORNAMENTS } from '../../hud/dom/symbols.js';
import { MAX_UI_SCALE_BASE, MIN_UI_SCALE, UI_SCALE_FACTOR_MAX } from '../../hud/ui-scale.js';
import { element } from './controls.js';

/** The board's design-px frame: the minimum supported viewport at 90% (FOUNDATION.md). */
const BOARD_WIDTH = 1280;
const BOARD_HEIGHT = 720;
const ACTION_ART_PX = 50;
const TITLE_ART_PX = 43;
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

function icon(name: string, size: number): string {
  const art = uiFoundationArt();
  const style = art === null ? null : iconCellStyle(art.manifest.icons, name, size);
  const geometry =
    style === null
      ? ''
      : `background-size:${style.backgroundSize};background-position:${style.backgroundPosition};`;
  return `<span class="on-icon" aria-hidden="true" style="width:${size}px;height:${size}px;${geometry}"></span>`;
}

const GLYPH_CLOSE = '<svg aria-hidden="true" class="on-glyph"><use href="#on-close"/></svg>';
const GLYPH_HOUSE =
  '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m3 11 9-7 9 7M5 10v10h14V10M9 20v-6h6v6"/></svg>';
const GLYPH_FORGE =
  '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 20h16M7 20v-6h10v6M5 14h14l-2-4H7zM10 10V4h4v6M9 4h6"/></svg>';
const GLYPH_PIN =
  '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Z"/><circle cx="12" cy="10" r="2.2"/></svg>';
const GLYPH_CENTER =
  '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/></svg>';
const GLYPH_ORDERS =
  '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M5 6h14M5 12h9M5 18h6M17 15l2 2 4-4"/></svg>';
const GLYPH_MENU =
  '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14"/></svg>';
const GLYPH_GO =
  '<svg aria-hidden="true" class="on-glyph on-notice__go" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>';
const GLYPH_WOMAN =
  '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 32 32"><circle cx="16" cy="11" r="6"/><path d="M16 17v12m-5-5h10"/></svg>';
const GLYPH_MAN =
  '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 32 32"><circle cx="13" cy="19" r="6"/><path d="m17.5 14.5 9-9M19 5h8v8"/></svg>';
const GLYPH_CHILD =
  '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 32 32"><circle cx="16" cy="8" r="4"/><path d="M16 14v9m-7-8 7 3 7-3m-7 8-5 6m5-6 5 6"/></svg>';

function card(title: string, text: string, cost: string, glyph: string, state = ''): string {
  return `<button type="button" class="on-card" ${state}><span class="on-card__thumb">${glyph}</span><span><strong class="on-card__title">${title}</strong><small class="on-card__text">${text}</small></span><span class="on-card__cost">${cost}</span></button>`;
}

/** Every primitive of the foundation on one board, laid out where the HUD regions will sit. */
function boardMarkup(): string {
  const actions = ACTIONS.map(
    ([name, label], index) =>
      `<button type="button" class="on-action" ${index === 0 ? 'aria-pressed="true"' : ''} title="${label} · klawisz ${index + 1}"><kbd class="on-key" aria-hidden="true">${index + 1}</kbd>${
        name === null
          ? '<svg aria-hidden="true" class="on-token on-action__art" fill="url(#on-pawn-wood)"><use href="#on-pawns"/></svg>'
          : `<span class="on-action__art">${icon(name, ACTION_ART_PX)}</span>`
      }<span class="on-action__label">${label}</span></button>`,
  ).join('');
  return `
<div class="on-bar on-bar--left on-panel" style="position:absolute;top:0;right:246px;display:flex;z-index:30">
  <button type="button" class="on-bar__count" aria-label="Kobiety: 12">${GLYPH_WOMAN}<b>12</b></button>
  <button type="button" class="on-bar__count" aria-label="Mężczyźni: 16">${GLYPH_MAN}<b>16</b></button>
  <button type="button" class="on-bar__count" aria-label="Dzieci: 6">${GLYPH_CHILD}<b>6</b></button>
  <span class="on-bar__divider"></span>
  <button type="button" class="on-bar__count" aria-label="Materiały: 72" aria-expanded="true"><b>72</b></button>
  <div class="on-tip" role="tooltip"><h4 class="on-tip__title">Materiały</h4><p class="on-tip__row"><span>Drewno</span><b>42</b></p><p class="on-tip__row"><span>Kamień</span><b>18</b></p><small class="on-tip__foot">Magazyny Twojego plemienia · cała mapa</small></div>
</div>
<div class="on-bar on-bar--right on-panel" style="position:absolute;top:0;right:0;display:flex;z-index:30">
  <time class="on-clock">01:24:08</time>
  <div class="on-speed" role="toolbar" aria-label="Tempo symulacji"><button type="button" aria-label="Pauza" aria-pressed="false">❚❚</button><button type="button" aria-pressed="true">×1</button><button type="button" aria-pressed="false">×3</button></div>
  <button type="button" class="on-medallion" style="width:32px;height:32px;margin-left:4px" aria-label="Menu gry">${GLYPH_MENU}</button>
</div>
<aside style="position:absolute;top:18px;left:10px;width:198px">
  <div style="display:flex;align-items:center;gap:10px;padding:0 0 10px 2px">
    <strong class="on-counter on-medallion"><span class="on-sr">Wiadomości: </span>8</strong>
    <div class="on-filters" role="toolbar" aria-label="Poziom wiadomości"><button type="button" class="on-filter on-filter--low" aria-label="Wszystkie" aria-pressed="false"></button><button type="button" class="on-filter on-filter--medium" aria-label="Ważne i pilne" aria-pressed="true"></button><button type="button" class="on-filter on-filter--high" aria-label="Tylko pilne" aria-pressed="false"></button></div>
  </div>
  <button type="button" class="on-notice"><span class="on-notice__preview"></span><b class="on-notice__title">Brakuje narzędzi</b><small class="on-notice__text">Eirik · drwal</small><i class="on-seal on-seal--warn" aria-hidden="true"></i>${GLYPH_GO}</button>
  <button type="button" class="on-notice"><span class="on-notice__preview"></span><b class="on-notice__title">Budowa ukończona</b><small class="on-notice__text">Chata rybaka</small><i class="on-seal" aria-hidden="true"></i>${GLYPH_GO}</button>
  <button type="button" class="on-notice"><span class="on-notice__preview"></span><b class="on-notice__title">Osadnik głoduje</b><small class="on-notice__text">Leif · budowniczy</small><i class="on-seal on-seal--danger" aria-hidden="true"></i>${GLYPH_GO}</button>
</aside>
<section class="on-window on-panel" style="left:50%;top:96px;width:540px;transform:translateX(-50%)" aria-label="Budowanie">
  ${WINDOW_ORNAMENTS}
  <header class="on-window__head"><div class="on-window__heading">${icon('build', TITLE_ART_PX)}<div><h2 class="on-window__title">Budowanie</h2><p class="on-window__subtitle">Wybierz budynek, następnie wskaż miejsce na mapie</p></div></div><button type="button" class="on-medallion on-window__close" aria-label="Zamknij">${GLYPH_CLOSE}</button></header>
  <div class="on-toolrow"><button type="button" class="on-button">Droga</button><button type="button" class="on-button">Palisada</button><button type="button" class="on-button on-button--accent">Dokumenty · 2</button></div>
  <div class="on-tabs" role="tablist"><button type="button" role="tab" class="on-tab" aria-selected="true">Wszystkie<span class="on-tab__count">4</span></button><button type="button" role="tab" class="on-tab" aria-selected="false">Praca<span class="on-tab__count">2</span></button><button type="button" role="tab" class="on-tab" aria-selected="false">Domy<span class="on-tab__count">0</span></button></div>
  <div class="on-parchment"><p class="on-parchment__note">Dostępne teraz · 4 budynki</p><div class="on-grid">
    ${card('Chata drwala', 'Produkuje drewno · 1–3 pracowników', '<i class="on-chip">🪵 8</i><i class="on-chip">◆ 4</i>', GLYPH_HOUSE, 'aria-pressed="true"')}
    ${card('Chata rybaka', 'Łowi ryby przy brzegu', '<i class="on-chip">🪵 6</i><i class="on-chip">◆ 2</i>', GLYPH_HOUSE)}
    ${card('Magazyn', 'Przechowuje towary plemienia', '<i class="on-chip">🪵 12 / 8</i><i class="on-chip on-chip--bad">brak 3</i>', GLYPH_HOUSE)}
    ${card('Kuźnia', 'Wymaga: Kowal II', '<i class="on-chip">Niedostępne</i>', GLYPH_FORGE, 'disabled')}
  </div></div>
  <div class="on-hint">${GLYPH_PIN}<span><b>Chata drwala</b> · wskaż miejsce na mapie</span><kbd class="on-key">Esc</kbd></div>
</section>
<aside class="on-window on-panel" style="right:0;bottom:0;width:318px;height:405px" aria-label="Zaznaczenie">
  ${WINDOW_ORNAMENTS}
  <header class="on-window__head on-window__head--compact"><div><p class="on-window__kicker">ZAZNACZENIE</p><h2 class="on-window__title on-window__title--compact">Eirik · Drwal II</h2></div><button type="button" class="on-medallion on-window__close" aria-label="Usuń zaznaczenie">${GLYPH_CLOSE}</button></header>
  <div class="on-window__body">
    <div class="on-portrait"><div class="on-portrait__frame"><span class="on-level"><span class="on-sr">Poziom </span>II</span></div><div><strong class="on-portrait__name">Wraca do pracy</strong><div class="on-status--ok">Zdrowy · najedzony</div><div class="on-status--warn">Potrzebuje narzędzi</div></div></div>
    <div class="on-section">Samopoczucie</div>
    <div class="on-ledger"><span>Zdrowie</span><b>72 / 100</b></div>
    <div class="on-meter" style="--value:72%"></div>
    <div class="on-ledger"><span>Sytość</span><b>64%</b></div>
    <div class="on-section">Praca i dom</div>
    <div class="on-ledger"><span>Miejsce pracy</span><b>Chata drwala</b></div>
    <div class="on-ledger"><span>Dom</span><b>Dom rodzinny</b></div>
    <div class="on-orders"><button type="button" class="on-button on-button--rounded">${GLYPH_CENTER}Centruj</button><button type="button" class="on-button on-button--rounded">${GLYPH_ORDERS}Rozkazy</button></div>
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
