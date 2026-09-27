// B · Księga: the mission window as an open saga book lying over the map. The left page carries the
// chapter's plates (portraits, world views), the right page the text; long text flows on to the next
// spread through CSS columns instead of a scrollbar. Ribbon tabs on the cover edge switch the book.

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const roman = (i) => ROMAN[i] ?? String(i + 1);
/** The title `lib.analysePage` gives a page without one. */
const UNTITLED = '\u2014';
const TABS = [
  ['brief', 'Zadanie'],
  ['goals', 'Cele'],
  ['history', 'Kronika'],
];
const TAB_OF_VIEW = { arrival: 'brief', task: 'brief', goals: 'goals', history: 'history' };
const PLATE = { w: 320, h: 250 };
const PLATE_WITH_THUMBS = { w: 300, h: 196 };
const THUMB = { w: 62, h: 46 };
const PREVIEW = { w: 128, h: 96 };
const EXCERPT_CHARS = 330;
/** A quote this short moves whole to the next page rather than leave its portrait behind. */
const SHORT_SPEECH = 260;
/** Painted portraits are small rasters; past this they blur. */
const MAX_UPSCALE = 1.25;
/** Small pictures are head-and-shoulders portraits (164 x 136 in the campaigns); they get a soft oval. */
const PORTRAIT_MAX_W = 200;

const SVG = {
  play: '<svg viewBox="0 0 20 20" class="bk-ico"><path d="M6 4l10 6-10 6z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 20 20" class="bk-ico"><path d="M5 4h3.5v12H5zM11.5 4H15v12h-3.5z" fill="currentColor"/></svg>',
  replay:
    '<svg viewBox="0 0 20 20" class="bk-ico"><path d="M4.5 10a5.5 5.5 0 1 0 1.8-4.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3.5 3.2v4.3h4.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  prev: '<svg viewBox="0 0 20 20" class="bk-ico"><path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 20 20" class="bk-ico"><path d="M7.5 4.5L13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 20 20" class="bk-ico"><path d="M4.5 10.5l3.6 3.4 7.4-8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  flourish:
    '<svg viewBox="0 0 120 16" class="bk-flourish" aria-hidden="true"><path d="M2 8h44M74 8h44" stroke="currentColor" stroke-width="1"/><path d="M60 2l6 6-6 6-6-6z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="60" cy="8" r="1.6" fill="currentColor"/><path d="M46 8c4-4 6-4 8 0M74 8c-4 4-6 4-8 0" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
};

/** Interaction state kept between re-renders of one review state (map, view, page). */
const S = { key: '', tab: 'brief', chapter: 0, spread: 0, plate: 0, pick: 0, playing: false };

function sync(ctx) {
  const key = `${ctx.map}|${ctx.view}|${ctx.pageIndex}`;
  if (S.key === key) return;
  Object.assign(S, { key, tab: TAB_OF_VIEW[ctx.view] ?? 'brief', chapter: ctx.pageIndex, spread: 0, plate: 0, pick: ctx.pageIndex, playing: false });
}

const titleOf = (page, i) => (page.title && page.title !== UNTITLED ? page.title : `Rozdział ${roman(i)}`);
const niceTitle = (t) => (t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s:(„-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase()) : t);

/** Plates for the left page: free pictures and world views; portraits tied to a quote stay in the text. */
function platesOf(page) {
  return page.segments.filter((s) => s.kind === 'picture' || s.kind === 'mapview');
}

function castOf(page) {
  return [...new Set(page.segments.filter((s) => s.kind === 'speech' && s.portrait).map((s) => s.portrait))];
}

function flowHtml(lib, page, index) {
  let first = true;
  const body = page.segments
    .map((s) => {
      switch (s.kind) {
        case 'heading':
          return `<h4 class="bk-sub">${lib.esc(niceTitle(s.text))}</h4>`;
        case 'para': {
          const cls = first ? 'bk-p bk-p--first' : 'bk-p';
          first = false;
          return `<p class="${cls}">${lib.esc(s.text).replace(/\n/g, '<br>')}</p>`;
        }
        case 'speech': {
          first = false;
          const face = s.portrait ? `<img class="bk-speech__face" src="${s.portrait}" alt="">` : '';
          const who = s.speaker ? `<b class="bk-speech__who">${lib.esc(s.speaker)}</b>` : '';
          const keep = s.text.length <= SHORT_SPEECH ? ' bk-speech--keep' : '';
          return `<div class="bk-speech${s.portrait ? ' bk-speech--face' : ''}${keep}">${face}<p>${who}${lib.esc(s.text.replace(/^["„”«»]|["„”«»]$/g, ''))}</p></div>`;
        }
        case 'signature':
          return `<p class="bk-sign">${lib.esc(s.text)}</p>`;
        default:
          return '';
      }
    })
    .join('');
  return `<h3 class="bk-title">${lib.esc(niceTitle(titleOf(page, index)))}</h3>${SVG.flourish}${body}<p class="bk-fin" aria-hidden="true">❦</p>`;
}

function narration(lib) {
  return `<div class="bk-voice" role="group" aria-label="Narracja">
    <button type="button" class="on-medallion bk-voice__play" data-voice aria-label="${S.playing ? 'Wstrzymaj narrację' : 'Odtwórz narrację'}">${S.playing ? SVG.pause : SVG.play}</button>
    <span class="bk-voice__bar"><i style="width:${S.playing ? 34 : 0}%"></i></span>
    <span class="bk-voice__time">${S.playing ? '0:24' : '0:00'} / 1:12</span>
    <button type="button" class="bk-voice__again" data-voice-again aria-label="Od początku">${SVG.replay}</button>
  </div>`;
}

/** A plate at its size; a thumbnail sits inside a button, so its world view is a plain span. */
function plateHtml(lib, map, plate, box = THUMB) {
  const big = box !== THUMB;
  const { w, h } = box;
  if (plate.kind === 'mapview') {
    return big
      ? `<button type="button" class="bk-plate__view" style="${lib.mapViewStyle(map, plate.icon, w, h)}" aria-label="Pokaż na mapie"></button>`
      : `<span class="bk-plate__view" style="${lib.mapViewStyle(map, plate.icon, w, h)}"></span>`;
  }
  const scale = Math.min(w / plate.width, h / plate.height, big ? MAX_UPSCALE : 1);
  const portrait = plate.width <= PORTRAIT_MAX_W ? ' bk-plate__img--portrait' : '';
  return `<img class="bk-plate__img${portrait}" src="${plate.src}" width="${Math.round(plate.width * scale)}" height="${Math.round(plate.height * scale)}" alt="">`;
}

function leftFront(ctx, page) {
  const { lib, map } = ctx;
  const plates = platesOf(page);
  const cast = castOf(page);
  const kicker = `<p class="bk-kicker">${ctx.view === 'arrival' && S.chapter === ctx.pageIndex ? '<span class="bk-new">Nowy rozdział</span>' : ''}Rozdział ${roman(S.chapter)}</p>
    <p class="bk-when">${lib.esc(lib.missionName(ctx.mission))} · zapisano w ${lib.receivedAt(S.chapter)}</p>`;
  let art;
  if (plates.length > 0) {
    const i = Math.min(S.plate, plates.length - 1);
    const shown = plates[i];
    const caption =
      shown.kind === 'mapview'
        ? `<figcaption><span>Widok krainy${plates.length > 1 ? ` ${i + 1} z ${plates.length}` : ''}</span><button type="button" class="bk-goto" data-goto>${lib.GLYPH.pin}Pokaż na mapie</button></figcaption>`
        : `<figcaption><span>Rycina${plates.length > 1 ? ` ${i + 1} z ${plates.length}` : ''}</span></figcaption>`;
    const thumbs =
      plates.length > 1
        ? `<div class="bk-thumbs" role="tablist" aria-label="Ryciny">${plates
            .map((p, j) => `<button type="button" role="tab" class="bk-thumb" data-plate="${j}" aria-selected="${j === i}">${plateHtml(lib, map, p)}</button>`)
            .join('')}</div>`
        : '';
    art = `<figure class="bk-plate bk-plate--${shown.kind}"><div class="bk-plate__frame">${plateHtml(lib, map, shown, plates.length > 1 ? PLATE_WITH_THUMBS : PLATE)}</div>${caption}</figure>${thumbs}`;
  } else if (cast.length > 0) {
    art = `<div class="bk-cast"><p class="bk-cast__head">W tym rozdziale</p><div class="bk-cast__faces bk-cast__faces--${Math.min(cast.length, 6)}">${cast
      .slice(0, 6)
      .map((src) => `<span class="bk-cast__face"><img src="${src}" alt=""></span>`)
      .join('')}</div></div>`;
  } else {
    art = `<div class="bk-front"><span class="bk-front__num">${roman(S.chapter)}</span>${SVG.flourish}<p class="bk-front__title">${lib.esc(niceTitle(titleOf(page, S.chapter)))}</p></div>`;
  }
  return `<div class="bk-left-front">${kicker}${narration(lib)}<div class="bk-art">${art}</div></div>`;
}

function footer(side, label) {
  return `<p class="bk-folio bk-folio--${side}">${label}</p>`;
}

function briefSpread(ctx) {
  const { lib } = ctx;
  const page = ctx.pages[S.chapter];
  const flow = `<div class="bk-flow" data-flow>${flowHtml(lib, page, S.chapter)}</div>`;
  const arrival = ctx.view === 'arrival';
  const chapterLine = `Rozdział ${S.chapter + 1} z ${ctx.pages.length}`;
  return `
    <div class="bk-page bk-page--left">
      <div class="bk-sheet" data-front>${leftFront(ctx, page)}</div>
      <div class="bk-window bk-window--left" data-col="left" hidden>${flow}</div>
      ${footer('left', `<span data-folio-left></span>`)}
      <button type="button" class="bk-corner bk-corner--prev" data-prev aria-label="Poprzednia strona">${SVG.prev}</button>
    </div>
    <div class="bk-page bk-page--right">
      <div class="bk-window bk-window--right" data-col="right">${flow}</div>
      <div class="bk-foot">
        <span class="bk-foot__chapter">${chapterLine}</span>
        <span class="bk-folio" data-folio-right></span>
        ${arrival ? `<button type="button" class="on-button on-button--accent bk-resume" data-close>${SVG.play}Wznów grę</button>` : '<span class="bk-foot__spacer"></span>'}
      </div>
      <button type="button" class="bk-corner bk-corner--next" data-next aria-label="Następna strona">${SVG.next}</button>
    </div>`;
}

function goalRow(lib, g) {
  const main = g.emphasis ? '<span class="bk-goal__main">Główny cel</span>' : '';
  const mark =
    g.state === 'done'
      ? `<span class="bk-goal__seal" aria-label="Wypełniony">${SVG.check}</span>`
      : g.state === 'open'
        ? '<span class="bk-goal__box" aria-label="Aktywny"></span>'
        : '<span class="bk-goal__box bk-goal__box--idle" aria-label="Jeszcze nieaktywny"></span>';
  return `<li class="bk-goal bk-goal--${g.state}">${mark}<span class="bk-goal__text">${lib.esc(lib.goalText(g))}${main}</span></li>`;
}

function goalsSpread(ctx) {
  const { lib, goals } = ctx;
  const done = goals.filter((g) => g.state === 'done');
  const open = goals.filter((g) => g.state === 'open');
  const idle = goals.filter((g) => g.state === 'idle');
  const seals = goals
    .map((g) => `<span class="bk-tally bk-tally--${g.state}" title="${lib.esc(lib.goalText(g))}">${g.state === 'done' ? SVG.check : ''}</span>`)
    .join('');
  return `
    <div class="bk-page bk-page--left">
      <div class="bk-sheet bk-sheet--pad">
        <p class="bk-kicker">Cele misji<small> · ${lib.esc(lib.missionName(ctx.mission))}</small></p>
        <h3 class="bk-title">Co jest do zrobienia</h3>
        ${SVG.flourish}
        <div class="bk-progress"><span class="bk-progress__num">${done.length}<small> / ${goals.length}</small></span><span class="bk-progress__label">celów wypełnionych</span></div>
        <div class="bk-tallies">${seals}</div>
        <p class="bk-list-head">Aktualne · ${open.length}</p>
        <ul class="bk-goals">${open.map((g) => goalRow(lib, g)).join('') || '<li class="bk-empty">Brak aktywnych celów.</li>'}</ul>
      </div>
      ${footer('left', 'Cele')}
    </div>
    <div class="bk-page bk-page--right">
      <div class="bk-sheet bk-sheet--pad">
        <p class="bk-list-head">Wypełnione · ${done.length}</p>
        <ul class="bk-goals">${done.map((g) => goalRow(lib, g)).join('') || '<li class="bk-empty">Jeszcze nic.</li>'}</ul>
        ${idle.length ? `<p class="bk-list-head">Przed tobą · ${idle.length}</p><ul class="bk-goals">${idle.map((g) => goalRow(lib, g)).join('')}</ul><p class="bk-note">Te cele ożyją w dalszych rozdziałach opowieści.</p>` : ''}
      </div>
      ${footer('right', 'Cele')}
    </div>`;
}

function excerptOf(page) {
  const text = page.segments
    .filter((s) => s.kind === 'para' || s.kind === 'speech')
    .map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text))
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^["„”«»\s-]+/, '');
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS).replace(/\s\S*$/, '')}…` : text;
}

function historySpread(ctx) {
  const { lib } = ctx;
  const pick = Math.min(S.pick, ctx.pages.length - 1);
  const rows = ctx.pages
    .map(
      (p, i) => `<li><button type="button" class="bk-toc__row" data-pick="${i}" aria-current="${i === pick}">
        <span class="bk-toc__num">${roman(i)}</span>
        <span class="bk-toc__title">${lib.esc(niceTitle(titleOf(p, i)))}${i === ctx.pages.length - 1 ? '<span class="bk-toc__new">najnowszy</span>' : ''}</span>
        <span class="bk-toc__time">${lib.receivedAt(i)}</span></button></li>`,
    )
    .join('');
  const page = ctx.pages[pick];
  const plates = platesOf(page);
  const cast = castOf(page);
  const thumb = plates[0] ? plateHtml(lib, ctx.map, plates[0], PREVIEW) : cast[0] ? `<img src="${cast[0]}" alt="">` : '';
  return `
    <div class="bk-page bk-page--left">
      <div class="bk-sheet bk-sheet--pad">
        <p class="bk-kicker">Kronika wyprawy<small> · ${ctx.pages.length} ${ctx.pages.length === 1 ? 'rozdział' : ctx.pages.length < 5 ? 'rozdziały' : 'rozdziałów'}</small></p>
        <h3 class="bk-title bk-title--toc">Spis rozdziałów</h3>
        <ol class="bk-toc">${rows}</ol>
      </div>
      ${footer('left', 'Kronika')}
    </div>
    <div class="bk-page bk-page--right">
      <div class="bk-sheet bk-sheet--pad bk-preview">
        <p class="bk-kicker">Rozdział ${roman(pick)}<small> · zapisano w ${lib.receivedAt(pick)}</small></p>
        <h3 class="bk-title">${lib.esc(niceTitle(titleOf(page, pick)))}</h3>
        <div class="bk-preview__body">${thumb ? `<span class="bk-preview__art">${thumb}</span>` : ''}<p class="bk-p bk-p--first">${lib.esc(excerptOf(page))}</p></div>
        <button type="button" class="on-button on-button--accent bk-open" data-open="${pick}">Czytaj rozdział ${roman(pick)}</button>
        <p class="bk-wiedza">Tablice historyczne (siedem cudów, mitologia) są teraz w Wiedzy. <button type="button" class="bk-link">Otwórz w Wiedzy ›</button></p>
      </div>
      ${footer('right', 'Kronika')}
    </div>`;
}

function ribbons(ctx) {
  const done = ctx.goals.filter((g) => g.state === 'done').length;
  return `<div class="bk-ribbons" role="tablist" aria-label="Księga misji">${TABS.map(
    ([id, label]) =>
      `<button type="button" role="tab" class="bk-ribbon bk-ribbon--${id}" data-tab="${id}" aria-selected="${S.tab === id}"><span>${label}${id === 'goals' ? ` <small>${done}/${ctx.goals.length}</small>` : ''}</span></button>`,
  ).join('')}</div>`;
}

function book(ctx) {
  const { lib } = ctx;
  const spread = S.tab === 'goals' ? goalsSpread(ctx) : S.tab === 'history' ? historySpread(ctx) : briefSpread(ctx);
  const arrival = ctx.view === 'arrival';
  return `<section class="bk-book${arrival ? ' bk-book--arrival' : ''}" aria-label="Misja">
    <div class="bk-cover"><svg aria-hidden="true" class="on-window__knot"><use href="#on-knot"/></svg></div>
    ${ribbons(ctx)}
    <div class="bk-spread bk-spread--${S.tab}" data-spread>${spread}</div>
    ${arrival ? '<div class="bk-paused" role="status"><span class="bk-paused__bars"></span>Gra wstrzymana · opowieść trwa</div>' : lib.closeMedallion('bk-close')}
  </section>`;
}

function tracker(ctx) {
  const { lib, goals } = ctx;
  const done = goals.filter((g) => g.state === 'done');
  const open = goals.filter((g) => g.state === 'open');
  const justDone = done.at(-1);
  const fresh = open.at(-1);
  const rest = open.slice(0, -1).slice(0, 2);
  return `
    <aside class="bk-tracker" aria-label="Cele misji">
      <span class="bk-tracker__ribbon" aria-hidden="true"></span>
      <header class="bk-tracker__head"><span>Cele</span><b>${done.length} / ${goals.length}</b></header>
      <ul class="bk-tracker__list">
        ${justDone ? `<li class="bk-tr bk-tr--done"><span class="bk-goal__seal">${SVG.check}</span><span>${lib.esc(lib.goalText(justDone))}</span></li>` : ''}
        ${fresh ? `<li class="bk-tr bk-tr--new"><span class="bk-goal__box"></span><span><em>Nowy cel</em>${lib.esc(lib.goalText(fresh))}</span></li>` : ''}
        ${rest.map((g) => `<li class="bk-tr"><span class="bk-goal__box"></span><span>${lib.esc(lib.goalText(g))}</span></li>`).join('')}
      </ul>
      <button type="button" class="bk-tracker__open">Otwórz księgę <kbd class="on-key">M</kbd></button>
    </aside>
    <span class="bk-beam-mark" aria-label="Nowy wpis w księdze"></span>`;
}

function scene(ctx) {
  sync(ctx);
  if (ctx.view === 'update') return `<div class="bk-scene bk-scene--update">${tracker(ctx)}</div>`;
  const arrival = ctx.view === 'arrival';
  return `<div class="bk-scene${arrival ? ' bk-scene--arrival' : ''}">${arrival ? '<div class="bk-dim"></div>' : ''}${book(ctx)}</div>`;
}

/** Column flow: spread 0 = plates left + column 0 right; spread k = columns 2k-1 and 2k. */
function layout(root, ctx) {
  const right = root.querySelector('[data-col="right"]');
  if (right === null) return;
  const left = root.querySelector('[data-col="left"]');
  const front = root.querySelector('[data-front]');
  const flow = right.querySelector('[data-flow]');
  const gap = parseFloat(getComputedStyle(flow).columnGap);
  if (!Number.isFinite(gap) || right.clientWidth === 0) return;
  const step = right.clientWidth + gap;
  const columns = Math.max(1, Math.round((flow.scrollWidth + gap) / step));
  const spreads = 1 + Math.ceil((columns - 1) / 2);
  if (S.spread === 'last' || S.spread >= spreads) S.spread = spreads - 1;
  const leftCol = S.spread === 0 ? -1 : 2 * S.spread - 1;
  const rightCol = S.spread === 0 ? 0 : 2 * S.spread;
  front.hidden = leftCol >= 0;
  left.hidden = leftCol < 0;
  left.querySelector('[data-flow]').style.transform = `translateX(${-leftCol * step}px)`;
  flow.style.transform = `translateX(${-rightCol * step}px)`;
  right.classList.toggle('bk-window--blank', rightCol >= columns);
  root.querySelector('[data-folio-left]').textContent = leftCol >= 0 ? `· ${leftCol + 1} ·` : '';
  root.querySelector('[data-folio-right]').textContent = rightCol < columns ? `strona ${rightCol + 1} z ${columns}` : '';
  const atStart = S.spread === 0 && S.chapter === 0;
  const atEnd = S.spread === spreads - 1 && S.chapter === ctx.pages.length - 1;
  root.querySelector('[data-prev]').disabled = atStart;
  root.querySelector('[data-next]').disabled = atEnd;
  const next = root.querySelector('[data-next]');
  next.setAttribute('aria-label', S.spread < spreads - 1 ? 'Następna strona' : 'Następny rozdział');
  next.classList.toggle('bk-corner--chapter', S.spread === spreads - 1 && !atEnd);
  root.querySelector('[data-prev]').classList.toggle('bk-corner--chapter', S.spread === 0 && !atStart);
  root.querySelector('[data-next]').dataset.spreads = String(spreads);
}

function turn(root, dir) {
  const spread = root.querySelector('[data-spread]');
  spread.classList.remove('bk-turn--next', 'bk-turn--prev');
  void spread.offsetWidth;
  spread.classList.add(dir > 0 ? 'bk-turn--next' : 'bk-turn--prev');
}

export default {
  id: 'b',
  name: 'Księga',
  blurb:
    'Misja jako otwarta księga sagi leżąca na mapie: lewa strona to ryciny (portrety, widoki krainy z „Pokaż na mapie”), prawa to tekst z inicjałem. Długi tekst przechodzi na kolejne rozkładówki zamiast paska przewijania, rogi stron przewracają kartki i rozdziały, wstążki-zakładki na krawędzi przełączają Zadanie, Cele i Kronikę.',
  css: 'b-ksiega.css',
  views: ['arrival', 'task', 'goals', 'history', 'update'],
  render: scene,
  mount(root, ctx) {
    const refresh = () => {
      root.querySelector('.bk-scene').outerHTML = scene(ctx);
      wire();
    };
    const wire = () => {
      // The flow is measured once the proposal stylesheet and the fonts have landed, and again on resize.
      const relayout = () => root.isConnected && layout(root, ctx);
      relayout();
      document.fonts.ready.then(relayout);
      document.querySelector('[data-proposal-css]')?.addEventListener('load', relayout, { once: true });
      const win = root.querySelector('[data-col="right"]');
      if (win) new ResizeObserver(relayout).observe(win);
      root.querySelectorAll('[data-tab]').forEach((b) =>
        b.addEventListener('click', () => {
          S.tab = b.dataset.tab;
          S.spread = 0;
          refresh();
        }),
      );
      root.querySelector('[data-next]')?.addEventListener('click', (e) => {
        const spreads = Number(e.currentTarget.dataset.spreads);
        if (S.spread < spreads - 1) {
          S.spread += 1;
          turn(root, 1);
          layout(root, ctx);
        } else if (S.chapter < ctx.pages.length - 1) {
          Object.assign(S, { chapter: S.chapter + 1, spread: 0, plate: 0 });
          refresh();
          turn(root, 1);
        }
      });
      root.querySelector('[data-prev]')?.addEventListener('click', () => {
        if (S.spread > 0) {
          S.spread -= 1;
          turn(root, -1);
          layout(root, ctx);
        } else if (S.chapter > 0) {
          Object.assign(S, { chapter: S.chapter - 1, spread: 'last', plate: 0 });
          refresh();
          turn(root, -1);
        }
      });
      root.querySelectorAll('[data-plate]').forEach((b) =>
        b.addEventListener('click', () => {
          S.plate = Number(b.dataset.plate);
          refresh();
        }),
      );
      root.querySelectorAll('[data-pick]').forEach((b) => {
        b.addEventListener('click', () => {
          S.pick = Number(b.dataset.pick);
          refresh();
        });
        b.addEventListener('dblclick', () => {
          Object.assign(S, { tab: 'brief', chapter: Number(b.dataset.pick), spread: 0, plate: 0 });
          refresh();
        });
      });
      root.querySelector('[data-open]')?.addEventListener('click', (e) => {
        Object.assign(S, { tab: 'brief', chapter: Number(e.currentTarget.dataset.open), spread: 0, plate: 0 });
        refresh();
      });
      root.querySelector('[data-voice]')?.addEventListener('click', () => {
        S.playing = !S.playing;
        refresh();
      });
      root.querySelector('[data-voice-again]')?.addEventListener('click', () => {
        S.playing = true;
        refresh();
      });
    };
    wire();
  },
};
