import { uiFoundationArt } from '../../content/own-assets/ui-foundation.js';
import { type BuildingCardView, buildingCardMarkup } from '../../hud/dom/construction-window.js';
import foundationCss from '../../hud/dom/foundation.css?inline';
import { goodIconMarkup } from '../../hud/dom/good-art.js';
import { ACTION_ART_PX, FIGURE, GLYPH, menuArt, paintedIcon, RESIDENTS_TOKEN } from '../../hud/dom/icons.js';
import { createNoticeArt, noticeTint } from '../../hud/dom/notice-art.js';
import { type NoticeCardView, noticeCardMarkup, paintNoticeThumb } from '../../hud/dom/notice-column.js';
import { createHudPlane } from '../../hud/dom/root.js';
import { WINDOW_ORNAMENTS } from '../../hud/dom/symbols.js';
import { NOTICE_COLUMN } from '../../hud/regions.js';
import { MAX_UI_SCALE_BASE, MIN_UI_SCALE, UI_SCALE_FACTOR_MAX } from '../../hud/ui-scale.js';
import { element } from './controls.js';

/** The board's design-px frame: the minimum supported viewport at 90% (FOUNDATION.md). */
const BOARD_WIDTH = 1280;
const BOARD_HEIGHT = 720;
const TITLE_ART_PX = 43;
const MENU_MEDALLION_PX = 34;
const MENU_ART_PX = 29;
const SCALE_STEP = 0.05;

/** The five stock counters, Materiały with its breakdown open, the last three hanging their tip to
 *  the left as the runtime does; the icon boxes stay bare on the board. */
const SAMPLE_CATEGORIES: readonly (readonly [label: string, count: number, open: boolean, flip: boolean])[] =
  [
    ['Żywność', 53, false, false],
    ['Materiały', 60, true, false],
    ['Uzbrojenie', 2, false, true],
    ['Wyposażenie', 0, false, true],
    ['Inne', 13, false, true],
  ];

const ACTIONS: readonly (readonly [icon: string | null, label: string])[] = [
  ['build', 'Buduj'],
  [null, 'Mieszkańcy'],
  ['assistant', 'Asystent'],
  ['statistics', 'Statystyki'],
  ['mission', 'Misja'],
  ['diplomacy', 'Dyplomacja'],
  ['knowledge', 'Wiedza'],
];

/** The seat the sample first-contact card is about; its swatch paints the shield. */
const SAMPLE_SEAT = 1;
/** The column's states on one board: a settler card (its figure is the Pixi layer's, so the box stays
 *  bare here), a gone subject, a long subjectless row, and the two lower weights. */
const SAMPLE_NOTICES: readonly NoticeCardView[] = [
  {
    id: 1,
    level: 2,
    short: 'Głoduje',
    full: 'Leif (budowniczy) umiera z głodu',
    thumb: { kind: 'settler', entity: 1 },
    canGo: true,
    fresh: false,
  },
  {
    id: 2,
    level: 2,
    short: 'Nie żyje',
    full: 'Sigrun (zbieraczka) już nie z nami',
    thumb: { kind: 'glyph', glyph: 'skull', dim: true, seat: null },
    canGo: true,
    fresh: false,
  },
  {
    id: 3,
    level: 2,
    short: 'Obcy: neutralny',
    full: 'Plemię Ragnara pierwszy kontakt, nastawienie neutralne',
    thumb: { kind: 'glyph', glyph: 'shield', dim: false, seat: SAMPLE_SEAT },
    canGo: false,
    fresh: false,
  },
  {
    id: 4,
    level: 1,
    short: 'Brak surowców',
    full: 'Eirik (drwal) brakuje materiału budowlanego',
    thumb: { kind: 'settler', entity: 2 },
    canGo: true,
    fresh: false,
  },
  {
    id: 5,
    level: 0,
    short: 'Ukończono',
    full: 'Chata rybaka - budowa zakończona',
    thumb: { kind: 'glyph', glyph: 'house', dim: false, seat: null },
    canGo: true,
    fresh: false,
  },
];
const noticeTally = (level: NoticeCardView['level']): number =>
  SAMPLE_NOTICES.filter((card) => card.level === level).length;

/** A construction card on the board: the picture box holds the house glyph, as a card without a
 *  sheet does. */
function card(view: Omit<BuildingCardView, 'thumb' | 'helpLabel'>): string {
  return `<article class="on-bcard${view.locked === true ? ' on-bcard--locked' : ''}">${buildingCardMarkup({
    ...view,
    thumb: GLYPH.house,
    helpLabel: `Wiedza: ${view.title}`,
  })}</article>`;
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
<div class="on-bar on-bar--right on-panel" style="position:absolute;top:0;right:0;z-index:30">
  <div class="on-summary" role="group" aria-label="Osada">
    <div class="on-resource">
      <button type="button" class="on-bar__count" aria-label="Kobiety: 12" aria-expanded="false">${FIGURE.woman}<b>12</b></button>
      <button type="button" class="on-bar__count" aria-label="Mężczyźni: 16" aria-expanded="false">${FIGURE.man}<b>16</b></button>
    </div>
    ${SAMPLE_CATEGORIES.map(
      ([name, count, open, flip]) =>
        `<div class="on-resource${flip ? ' on-resource--flip' : ''}"><button type="button" class="on-bar__count" aria-label="${name}: ${count}" aria-expanded="${open}">${goodIconMarkup()}<b>${count}</b></button>${
          open
            ? `<div class="on-tip on-tip--wide" role="tooltip"><h4 class="on-tip__title">${name}</h4><div class="on-tip__columns"><div><p class="on-tip__row"><span>Drewno</span><b>42</b></p><p class="on-tip__row"><span>Kamień</span><b>18</b></p><p class="on-tip__row on-tip__row--zero"><span>Żelazo</span><b>0</b></p></div><div><p class="on-tip__row on-tip__row--zero"><span>Cegła</span><b>0</b></p><p class="on-tip__row on-tip__row--zero"><span>Dachówka</span><b>0</b></p></div></div></div>`
            : ''
        }</div>`,
    ).join('')}
  </div>
  <time class="on-clock" role="timer" aria-label="Czas gry">1:24:08</time>
  <div class="on-speed" role="toolbar" aria-label="Tempo symulacji"><button type="button" aria-label="Pauza" aria-pressed="false">❚❚</button><button type="button" aria-pressed="true">×1</button><button type="button" aria-pressed="false">×2</button><button type="button" aria-pressed="false">×3</button></div>
  <button type="button" class="on-medallion" style="width:${MENU_MEDALLION_PX}px;height:${MENU_MEDALLION_PX}px;margin-left:3px" aria-label="Menu gry">${menuArt(MENU_ART_PX)}</button>
</div>
<aside class="on-notices" style="top:${NOTICE_COLUMN.top}px;left:${NOTICE_COLUMN.left}px;width:${NOTICE_COLUMN.width}px;bottom:230px">
  <div class="on-notices__head"><span class="on-sr">Wiadomości: ${SAMPLE_NOTICES.length}</span><div class="on-filters" role="toolbar" aria-label="Poziom wiadomości"><button type="button" class="on-filter on-filter--low" aria-label="Wszystkie · zwykłe: ${noticeTally(0)}" aria-pressed="true"><span class="on-filter__count">${noticeTally(0)}</span></button><button type="button" class="on-filter on-filter--medium" aria-label="Ważne i pilne · ważne: ${noticeTally(1)}" aria-pressed="false"><span class="on-filter__count">${noticeTally(1)}</span></button><button type="button" class="on-filter on-filter--high" aria-label="Tylko pilne · pilne: ${noticeTally(2)}" aria-pressed="false"><span class="on-filter__count">${noticeTally(2)}</span></button></div></div>
  <ul class="on-notices__list" aria-label="Powiadomienia">${SAMPLE_NOTICES.map((card) => noticeCardMarkup(card, 'Usuń powiadomienie')).join('')}</ul>
</aside>
<section class="on-window on-window--construction on-panel" style="left:50%;top:96px;width:640px;transform:translateX(-50%)" aria-label="Budowanie">
  ${WINDOW_ORNAMENTS}
  <header class="on-window__head"><div class="on-window__heading">${paintedIcon('build', TITLE_ART_PX)}<div><h2 class="on-window__title">Budowanie</h2></div></div><button type="button" class="on-medallion on-window__close" aria-label="Zamknij">${GLYPH.close}</button></header>
  <div class="on-window__body on-window__body--column">
  <div class="on-toolrow"><button type="button" class="on-button" disabled>Droga</button><button type="button" class="on-button" disabled>Palisada</button><button type="button" class="on-button" disabled>Brama</button><button type="button" class="on-button on-button--accent">${GLYPH.papers}Papiery<span class="on-count">2</span></button></div>
  <div class="on-tabs" role="tablist"><button type="button" role="tab" class="on-tab" aria-selected="true">Wszystko<span class="on-tab__count">2</span></button><button type="button" role="tab" class="on-tab" aria-selected="false">Praca<span class="on-tab__count">1</span></button><button type="button" role="tab" class="on-tab" aria-selected="false">Magazyn<span class="on-tab__count">1</span></button><button type="button" role="tab" class="on-tab" aria-selected="false">Dom<span class="on-tab__count">0</span></button><button type="button" role="tab" class="on-tab" aria-selected="false">Wojsko<span class="on-tab__count">0</span></button><fieldset class="on-view"><legend class="on-sr">Widok</legend><button type="button" class="on-view__button" aria-pressed="true" title="Kafelki">${GLYPH.grid}</button><button type="button" class="on-view__button" aria-pressed="false" title="Lista">${GLYPH.list}</button></fieldset></div>
  <div class="on-parchment on-catalog" data-view="grid"><p class="on-parchment__note"><span>Dostępne teraz</span><span class="on-parchment__count">2</span></p><div class="on-build-grid">
    ${card({ title: 'Chata drwala', cost: [2, 1], picked: true })}
    ${card({ title: 'Magazyn (poziom 1)', cost: [1, 1, 2, 1], short: [2] })}
  </div><p class="on-parchment__note on-parchment__note--locked"><span>Zablokowane</span><span class="on-parchment__count">1</span></p><div class="on-build-grid">
    ${card({ title: 'Kuźnia (poziom 1)', cost: [2, 1, 1, 1, 1], locked: true })}
  </div></div>
  </div>
</section>
<div class="on-strip" role="status" style="top:60px">${GLYPH.pin}<span class="on-strip__text"><b>Chata drwala</b><span> · wskaż miejsce na mapie</span></span><span class="on-strip__keys"><kbd class="on-key">Esc</kbd><kbd class="on-key">PPM</kbd><span>anuluje</span></span></div>
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
export function renderHudFoundation(main: HTMLElement, initialScale: number, status: HTMLElement): void {
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
  const noticeArt = createNoticeArt();
  const sampleCards = plane.element.querySelectorAll('.on-notice');
  SAMPLE_NOTICES.forEach((card, i) => {
    const li = sampleCards[i];
    if (li === undefined) return;
    paintNoticeThumb(li, card.thumb, {
      paintBuilding: () => false,
      paintGlyph: (canvas, glyph, seat, onFail) =>
        noticeArt?.paint(canvas, glyph, noticeTint(seat), onFail) === true,
    });
  });
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
  main.replaceChildren(detail, stage, status);
}
