// B · Księga: the mission window as an open saga book lying over the map. The chapter's text flows
// across both pages through CSS columns instead of a scrollbar; pictures and world views stand where
// the page's author placed them. Tabs on the fore-edge switch the book, and on the map a folding goal
// slip hangs under the summary bar.

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const roman = (i) => ROMAN[i] ?? String(i + 1);
const TABS = [
  ['brief', 'Zadanie'],
  ['goals', 'Cele'],
  ['history', 'Kronika'],
];
const TAB_OF_VIEW = { arrival: 'brief', task: 'brief', goals: 'goals', history: 'history' };
/** Picture placement: inside the text as the page has it, or gathered on the left page. */
const PLACEMENT = { text: 'text', side: 'side' };
const PLATE = { w: 320, h: 250 };
const PLATE_WITH_THUMBS = { w: 300, h: 196 };
const THUMB = { w: 62, h: 46 };
const PREVIEW = { w: 128, h: 96 };
/** An inline picture or world view fits the text column, less the plate frame. */
const FIGURE = { w: 318, h: 230 };
const VIEW_GAP = 8;
const VIEW_ASPECT = 0.6;
const EXCERPT_CHARS = 330;
/** A quote this short moves whole to the next page rather than leave its portrait behind. */
const SHORT_SPEECH = 260;
/** Painted portraits are small rasters; past this they blur. */
const MAX_UPSCALE = 1.25;
/** Small pictures are head-and-shoulders portraits (164 x 136 in the campaigns); they get a soft oval. */
const PORTRAIT_MAX_W = 200;
/** Open goals the map slip lists before it points to the book. */
const SLIP_ROWS = 4;

const SVG = {
  play: '<svg viewBox="0 0 20 20" class="bk-ico"><path d="M6 4l10 6-10 6z" fill="currentColor"/></svg>',
  prev: '<svg viewBox="0 0 20 20" class="bk-ico"><path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 20 20" class="bk-ico"><path d="M7.5 4.5L13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fold: '<svg viewBox="0 0 20 20" class="bk-ico"><path d="M5 12.5l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 20 20" class="bk-ico"><path d="M4.5 10.5l3.6 3.4 7.4-8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  flourish:
    '<svg viewBox="0 0 120 16" class="bk-flourish" aria-hidden="true"><path d="M2 8h44M74 8h44" stroke="currentColor" stroke-width="1"/><path d="M60 2l6 6-6 6-6-6z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="60" cy="8" r="1.6" fill="currentColor"/><path d="M46 8c4-4 6-4 8 0M74 8c-4 4-6 4-8 0" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
};

/** Interaction state kept between re-renders of one review state (map, view, page, placement). */
const S = { key: '', tab: 'brief', chapter: 0, spread: 0, plate: 0, pick: 0, slip: true };

function sync(ctx) {
  const key = `${ctx.map}|${ctx.view}|${ctx.pageIndex}|${ctx.option}`;
  if (S.key === key) return;
  Object.assign(S, { key, tab: TAB_OF_VIEW[ctx.view] ?? 'brief', chapter: ctx.pageIndex, spread: 0, plate: 0, pick: ctx.pageIndex, slip: ctx.view !== 'map' });
}

const inline = (ctx) => ctx.option !== PLACEMENT.side;
const niceTitle = (t) => (t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s:(„-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase()) : t);
/** Only goals the mission has revealed: the original keeps later goals, and their count, hidden. */
const revealed = (goals) => goals.filter((g) => g.state !== 'idle');

/** Plates for the left page: free pictures and world views; portraits tied to a quote stay in the text. */
function platesOf(page) {
  return page.segments.filter((s) => s.kind === 'picture' || s.kind === 'mapview');
}

function castOf(page) {
  return [...new Set(page.segments.filter((s) => s.kind === 'speech' && s.portrait).map((s) => s.portrait))];
}

function chapterHead(ctx, index) {
  const { lib } = ctx;
  const fresh = ctx.view === 'arrival' && index === ctx.pageIndex;
  return `<p class="bk-kicker">${fresh ? '<span class="bk-new">Nowy rozdział</span>' : ''}Rozdział ${roman(index)}</p>
    <p class="bk-when">${lib.esc(lib.missionName(ctx.mission))} · zapisano w ${lib.receivedAt(index)}</p>`;
}

function figureHtml(plate) {
  const scale = Math.min(FIGURE.w / plate.width, FIGURE.h / plate.height, MAX_UPSCALE);
  const w = Math.round(plate.width * scale);
  const h = Math.round(plate.height * scale);
  if (plate.width <= PORTRAIT_MAX_W) {
    return `<figure class="bk-fig bk-fig--portrait"><img class="bk-plate__img bk-plate__img--portrait" src="${plate.src}" width="${w}" height="${h}" alt=""></figure>`;
  }
  return `<figure class="bk-fig"><span class="bk-plate__frame"><img class="bk-plate__img" src="${plate.src}" width="${w}" height="${h}" alt=""></span></figure>`;
}

/** Consecutive world views share a row; each keeps its own "show on map". */
function viewsHtml(lib, map, views) {
  const across = Math.min(views.length, 2);
  const w = Math.floor((FIGURE.w - (across - 1) * VIEW_GAP) / across);
  const h = Math.round(w * VIEW_ASPECT);
  return `<div class="bk-views bk-views--${across}">${views
    .map(
      (v) =>
        `<button type="button" class="bk-view" data-goto aria-label="Pokaż na mapie"><span class="bk-plate__view" style="${lib.mapViewStyle(map, v.icon, w, h)}"></span><span class="bk-view__go">${lib.GLYPH.pin}Pokaż na mapie</span></button>`,
    )
    .join('')}</div>`;
}

function flowHtml(ctx, page, index) {
  const { lib, map } = ctx;
  const withFigures = inline(ctx);
  const out = [];
  let first = true;
  for (let i = 0; i < page.segments.length; i++) {
    const s = page.segments[i];
    switch (s.kind) {
      case 'heading':
        out.push(`<h4 class="bk-sub">${lib.esc(niceTitle(s.text))}</h4>`);
        break;
      case 'para':
        out.push(`<p class="bk-p${first ? ' bk-p--first' : ''}">${lib.esc(s.text).replace(/\n/g, '<br>')}</p>`);
        first = false;
        break;
      case 'speech': {
        first = false;
        const face = s.portrait ? `<img class="bk-speech__face" src="${s.portrait}" alt="">` : '';
        const who = s.speaker ? `<b class="bk-speech__who">${lib.esc(s.speaker)}</b>` : '';
        const keep = s.text.length <= SHORT_SPEECH ? ' bk-speech--keep' : '';
        out.push(`<div class="bk-speech${s.portrait ? ' bk-speech--face' : ''}${keep}">${face}<p>${who}${lib.esc(s.text.replace(/^["„”«»]|["„”«»]$/g, ''))}</p></div>`);
        break;
      }
      case 'picture':
        if (withFigures) out.push(figureHtml(s));
        break;
      case 'mapview': {
        let end = i;
        while (page.segments[end + 1]?.kind === 'mapview') end++;
        if (withFigures) out.push(viewsHtml(lib, map, page.segments.slice(i, end + 1)));
        i = end;
        break;
      }
      case 'signature':
        out.push(`<p class="bk-sign">${lib.esc(s.text)}</p>`);
        break;
    }
  }
  const head = withFigures ? chapterHead(ctx, index) : '';
  const title = page.titled ? `<h3 class="bk-title">${lib.esc(niceTitle(page.title))}</h3>${SVG.flourish}` : withFigures ? SVG.flourish : '';
  return `${head}${title}${out.join('')}<p class="bk-fin" aria-hidden="true">❦</p>`;
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

/** The left page of a chapter's first spread when pictures are gathered there. */
function leftFront(ctx, page) {
  const { lib, map } = ctx;
  const plates = platesOf(page);
  const cast = castOf(page);
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
    art = `<div class="bk-front"><span class="bk-front__num">${roman(S.chapter)}</span>${SVG.flourish}${
      page.titled ? `<p class="bk-front__title">${lib.esc(niceTitle(page.title))}</p>` : ''
    }</div>`;
  }
  return `<div class="bk-left-front">${chapterHead(ctx, S.chapter)}<div class="bk-art">${art}</div></div>`;
}

function footer(side, label) {
  return `<p class="bk-folio bk-folio--${side}">${label}</p>`;
}

function briefSpread(ctx) {
  const page = ctx.pages[S.chapter];
  const flow = `<div class="bk-flow" data-flow>${flowHtml(ctx, page, S.chapter)}</div>`;
  const arrival = ctx.view === 'arrival';
  const front = inline(ctx) ? '' : `<div class="bk-sheet" data-front>${leftFront(ctx, page)}</div>`;
  return `
    <div class="bk-page bk-page--left">
      ${front}
      <div class="bk-window bk-window--left" data-col="left">${flow}</div>
      ${footer('left', `<span data-folio-left></span>`)}
      <button type="button" class="bk-corner bk-corner--prev" data-prev aria-label="Poprzednia strona">${SVG.prev}</button>
    </div>
    <div class="bk-page bk-page--right">
      <div class="bk-window bk-window--right" data-col="right">${flow}</div>
      <div class="bk-foot">
        <span class="bk-foot__chapter">Rozdział ${S.chapter + 1} z ${ctx.pages.length}</span>
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
      : '<span class="bk-goal__box" aria-label="Aktywny"></span>';
  return `<li class="bk-goal bk-goal--${g.state}">${mark}<span class="bk-goal__text">${lib.esc(lib.goalText(g))}${main}</span></li>`;
}

function goalsSpread(ctx) {
  const { lib } = ctx;
  const shown = revealed(ctx.goals);
  const done = shown.filter((g) => g.state === 'done');
  const open = shown.filter((g) => g.state === 'open');
  return `
    <div class="bk-page bk-page--left">
      <div class="bk-sheet bk-sheet--pad">
        <p class="bk-kicker">Cele misji<small> · ${lib.esc(lib.missionName(ctx.mission))}</small></p>
        <h3 class="bk-title">Co jest do zrobienia</h3>
        ${SVG.flourish}
        <p class="bk-list-head">Aktualne · ${open.length}</p>
        <ul class="bk-goals">${open.map((g) => goalRow(lib, g)).join('') || '<li class="bk-empty">Brak aktywnych celów.</li>'}</ul>
      </div>
      ${footer('left', 'Cele')}
    </div>
    <div class="bk-page bk-page--right">
      <div class="bk-sheet bk-sheet--pad">
        <p class="bk-list-head">Wypełnione · ${done.length}</p>
        <ul class="bk-goals">${done.map((g) => goalRow(lib, g)).join('') || '<li class="bk-empty">Jeszcze nic.</li>'}</ul>
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

/** A page's own title, or its opening words set apart as a derived label. */
function tocTitle(lib, page) {
  return page.titled ? lib.esc(niceTitle(page.title)) : `<i class="bk-toc__derived">${lib.esc(page.title)}</i>`;
}

function historySpread(ctx) {
  const { lib } = ctx;
  const pick = Math.min(S.pick, ctx.pages.length - 1);
  const rows = ctx.pages
    .map(
      (p, i) => `<li><button type="button" class="bk-toc__row" data-pick="${i}" aria-current="${i === pick}">
        <span class="bk-toc__num">${roman(i)}</span>
        <span class="bk-toc__title">${tocTitle(lib, p)}${i === ctx.pages.length - 1 ? '<span class="bk-toc__new">najnowszy</span>' : ''}</span>
        <span class="bk-toc__time">${lib.receivedAt(i)}</span></button></li>`,
    )
    .join('');
  const page = ctx.pages[pick];
  const plates = platesOf(page);
  const cast = castOf(page);
  const thumb = plates[0] ? plateHtml(lib, ctx.map, plates[0], PREVIEW) : cast[0] ? `<img src="${cast[0]}" alt="">` : '';
  const count = ctx.pages.length;
  return `
    <div class="bk-page bk-page--left">
      <div class="bk-sheet bk-sheet--pad">
        <p class="bk-kicker">Kronika wyprawy<small> · ${count} ${count === 1 ? 'rozdział' : count < 5 ? 'rozdziały' : 'rozdziałów'}</small></p>
        <h3 class="bk-title bk-title--toc">Spis rozdziałów</h3>
        <ol class="bk-toc">${rows}</ol>
      </div>
      ${footer('left', 'Kronika')}
    </div>
    <div class="bk-page bk-page--right">
      <div class="bk-sheet bk-sheet--pad bk-preview">
        <p class="bk-kicker">Rozdział ${roman(pick)}<small> · zapisano w ${lib.receivedAt(pick)}</small></p>
        ${page.titled ? `<h3 class="bk-title">${lib.esc(niceTitle(page.title))}</h3>` : ''}
        <div class="bk-preview__body">${thumb ? `<span class="bk-preview__art">${thumb}</span>` : ''}<p class="bk-p bk-p--first">${lib.esc(excerptOf(page))}</p></div>
        <button type="button" class="on-button on-button--accent bk-open" data-open="${pick}">Czytaj rozdział ${roman(pick)}</button>
        <p class="bk-wiedza">Tablice historyczne (siedem cudów, mitologia) są teraz w Wiedzy. <button type="button" class="bk-link">Otwórz w Wiedzy ›</button></p>
      </div>
      ${footer('right', 'Kronika')}
    </div>`;
}

function tabs(ctx) {
  const open = revealed(ctx.goals).filter((g) => g.state === 'open').length;
  return `<div class="bk-tabs" role="tablist" aria-label="Księga misji">${TABS.map(
    ([id, label]) =>
      `<button type="button" role="tab" class="bk-tab" data-tab="${id}" aria-selected="${S.tab === id}"><span>${label}${
        id === 'goals' && open > 0 ? `<span class="on-tab__count">${open}</span>` : ''
      }</span></button>`,
  ).join('')}</div>`;
}

function book(ctx) {
  const { lib } = ctx;
  const spread = S.tab === 'goals' ? goalsSpread(ctx) : S.tab === 'history' ? historySpread(ctx) : briefSpread(ctx);
  const arrival = ctx.view === 'arrival';
  return `<section class="bk-book${arrival ? ' bk-book--arrival' : ''}" aria-label="Misja">
    <div class="bk-cover">${lib.ORNAMENTS}</div>
    ${tabs(ctx)}
    <div class="bk-spread bk-spread--${S.tab}${inline(ctx) ? ' bk-spread--inline' : ''}" data-spread>${spread}</div>
    ${arrival ? '<div class="bk-paused" role="status"><span class="bk-paused__bars"></span>Gra wstrzymana · opowieść trwa</div>' : lib.closeMedallion('bk-close')}
  </section>`;
}

/** The goal slip under the summary bar, folded to its tab or open. `update` shows a goal just changed. */
function slip(ctx) {
  const { lib } = ctx;
  const shown = revealed(ctx.goals);
  const open = shown.filter((g) => g.state === 'open');
  const update = ctx.view === 'update';
  const justDone = update ? shown.filter((g) => g.state === 'done').at(-1) : undefined;
  const fresh = update ? open.at(-1) : undefined;
  const rest = open.filter((g) => g !== fresh).slice(0, SLIP_ROWS - (fresh ? 1 : 0));
  const more = open.length - rest.length - (fresh ? 1 : 0);
  const tab = `<button type="button" class="bk-sliptab${S.slip ? ' bk-sliptab--open' : ''}" data-slip aria-expanded="${S.slip}" aria-controls="bk-slip">
      <span class="bk-sliptab__label">Cele</span><span class="on-tab__count">${open.length}</span>${update && !S.slip ? '<i class="bk-sliptab__mark" aria-label="Zmiana celów"></i>' : ''}${SVG.fold}
    </button>`;
  if (!S.slip) return `<div class="bk-slipdock">${tab}</div>`;
  return `<div class="bk-slipdock">
    <aside class="bk-tracker${update ? ' bk-tracker--update' : ''}" id="bk-slip" aria-label="Cele misji">
      <ul class="bk-tracker__list">
        ${justDone ? `<li class="bk-tr bk-tr--done"><span class="bk-goal__seal">${SVG.check}</span><span><em>Wypełniony</em>${lib.esc(lib.goalText(justDone))}</span></li>` : ''}
        ${fresh ? `<li class="bk-tr bk-tr--new"><span class="bk-goal__box"></span><span><em>Nowy cel</em>${lib.esc(lib.goalText(fresh))}</span></li>` : ''}
        ${rest.map((g) => `<li class="bk-tr"><span class="bk-goal__box"></span><span>${lib.esc(lib.goalText(g))}</span></li>`).join('')}
        ${open.length === 0 ? '<li class="bk-tr bk-tr--empty">Brak aktywnych celów.</li>' : ''}
      </ul>
      <button type="button" class="bk-tracker__open" data-book>${more > 0 ? `<span>i ${more} więcej</span>` : '<span></span>'}<span>Otwórz księgę <kbd class="on-key">M</kbd></span></button>
    </aside>
    ${tab}
  </div>`;
}

function scene(ctx) {
  sync(ctx);
  if (ctx.view === 'update' || ctx.view === 'map') {
    return `<div class="bk-scene bk-scene--map">${slip(ctx)}${ctx.view === 'update' ? '<span class="bk-beam-mark" aria-label="Nowy wpis w księdze"></span>' : ''}</div>`;
  }
  const arrival = ctx.view === 'arrival';
  return `<div class="bk-scene${arrival ? ' bk-scene--arrival' : ''}">${arrival ? '<div class="bk-dim"></div>' : ''}${book(ctx)}</div>`;
}

/**
 * Column flow. Pictures in the text: spread k shows columns 2k and 2k + 1. Pictures on the left: the
 * first spread's left page holds them, so spread k shows columns 2k - 1 and 2k.
 */
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
  const offset = front === null ? 0 : 1;
  const spreads = Math.max(1, Math.ceil((columns + offset) / 2));
  if (S.spread === 'last' || S.spread >= spreads) S.spread = spreads - 1;
  const leftCol = 2 * S.spread - offset;
  const rightCol = leftCol + 1;
  if (front !== null) front.hidden = leftCol >= 0;
  left.hidden = leftCol < 0;
  left.querySelector('[data-flow]').style.transform = `translateX(${-leftCol * step}px)`;
  flow.style.transform = `translateX(${-rightCol * step}px)`;
  right.classList.toggle('bk-window--blank', rightCol >= columns);
  root.querySelector('[data-folio-left]').textContent = leftCol >= 0 ? `strona ${leftCol + 1}` : '';
  root.querySelector('[data-folio-right]').textContent = rightCol < columns ? `strona ${rightCol + 1} z ${columns}` : '';
  const atStart = S.spread === 0 && S.chapter === 0;
  const atEnd = S.spread === spreads - 1 && S.chapter === ctx.pages.length - 1;
  const prev = root.querySelector('[data-prev]');
  const next = root.querySelector('[data-next]');
  prev.disabled = atStart;
  next.disabled = atEnd;
  next.setAttribute('aria-label', S.spread < spreads - 1 ? 'Następna strona' : 'Następny rozdział');
  next.classList.toggle('bk-corner--chapter', S.spread === spreads - 1 && !atEnd);
  prev.classList.toggle('bk-corner--chapter', S.spread === 0 && !atStart);
  next.dataset.spreads = String(spreads);
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
    'Misja jako otwarta księga sagi leżąca na mapie, w ramie okien nowego UI. Tekst rozdziału płynie przez obie strony zamiast paska przewijania, ryciny i widoki krainy stoją tam, gdzie postawił je autor mapy. Rogi stron przewracają kartki i rozdziały, zakładki na krawędzi przełączają Zadanie, Cele i Kronikę. Cele pokazują tylko to, co misja już odsłoniła. Na mapie zwijana karta celów wisi pod paskiem zasobów.',
  css: 'b-ksiega.css',
  views: ['arrival', 'task', 'goals', 'history', 'update', 'map'],
  option: {
    label: 'Ryciny',
    values: [
      [PLACEMENT.text, 'W tekście, jak w oryginale'],
      [PLACEMENT.side, 'Zebrane na lewej stronie'],
    ],
  },
  render: scene,
  mount(root, ctx) {
    const refresh = () => {
      root.querySelector('.bk-scene').outerHTML = scene(ctx);
      wire();
    };
    const wire = () => {
      // The flow is measured once the proposal stylesheet, the fonts and the pictures have landed.
      const relayout = () => root.isConnected && layout(root, ctx);
      relayout();
      document.fonts.ready.then(relayout);
      document.querySelector('[data-proposal-css]')?.addEventListener('load', relayout, { once: true });
      root.querySelectorAll('.bk-flow img').forEach((img) => img.complete || img.addEventListener('load', relayout, { once: true }));
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
      root.querySelector('[data-book]')?.addEventListener('click', () => {
        const params = new URLSearchParams(location.hash.slice(1));
        params.set('v', 'task');
        location.hash = params.toString();
        location.reload();
      });
      root.querySelector('[data-slip]')?.addEventListener('click', () => {
        S.slip = !S.slip;
        refresh();
      });
    };
    wire();
  },
};
