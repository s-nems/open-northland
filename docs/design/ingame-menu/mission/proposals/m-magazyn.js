// M · Magazyn: the briefing set like a magazine feature. A hero banner (the page's first world view,
// or its picture as a cut-out) carries the chapter title; the text runs in two columns that turn as
// spreads, with a pull quote and the speakers' portraits floated into the text; goals sit in a sidebar.

const HERO = { w: 971, h: 176 };
/** The world capture is magnified in the hero, so a view reads as a place rather than a thumbnail. */
const HERO_ZOOM = 1.25;
const WORLD = { w: 1365, h: 768 };
/** Where the capture shows only world (no HUD), in capture px. */
const WORLD_SAFE = { x0: 200, y0: 60, y1: 600 };
const COLUMN_GAP = 34;
/** One wheel gesture turns one spread. */
const WHEEL_FLIP_MS = 350;
const QUOTE_MIN = 40;
const QUOTE_MAX = 200;
const QUOTE_AFTER = 2;
const SHORT_PAGE = 900;
/** Title lengths (characters) past which the hero sets the title smaller. */
const TITLE_MEDIUM = 22;
const TITLE_LONG = 36;
/** The harness mounts on every re-render into the same element; the previous listener goes first. */
let detach = null;

const ICON = {
  play: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
  replay: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5"/></svg>',
  check: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  next: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
  prev: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
  eye: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** A magnified crop of the world capture for the hero, moved by the view's node like lib.mapViewStyle. */
function heroWorldStyle(map, seedA, seedB, lib) {
  const x = WORLD_SAFE.x0 + ((seedA * 37 + seedB * 11) % 560);
  const y = WORLD_SAFE.y0 + ((seedA * 13 + seedB * 29) % 330);
  const left = clamp(x * HERO_ZOOM, WORLD_SAFE.x0 * HERO_ZOOM, WORLD.w * HERO_ZOOM - HERO.w);
  const top = clamp(y * HERO_ZOOM, WORLD_SAFE.y0 * HERO_ZOOM, WORLD_SAFE.y1 * HERO_ZOOM - HERO.h);
  return `background:#223 url(${lib.worldUrl(map)}) -${left}px -${top}px / ${WORLD.w * HERO_ZOOM}px ${WORLD.h * HERO_ZOOM}px no-repeat`;
}

function heroOf(ctx, page, pageNumber) {
  const view = page.segments.find((s) => s.kind === 'mapview');
  const picture = page.segments.find((s) => s.kind === 'picture' || (s.kind === 'speech' && s.portrait));
  const seed = Number(page.id) || pageNumber;
  return {
    style: view ? heroWorldStyle(ctx.map, view.icon[1], view.icon[2], ctx.lib) : heroWorldStyle(ctx.map, seed, pageNumber * 7, ctx.lib),
    isView: Boolean(view),
    cutout: picture ? picture.src ?? picture.portrait : null,
  };
}

/** The most striking line for the pull quote, taken from past the quote's own position so it never
 *  repeats the paragraph right above it. */
function pullQuoteOf(page) {
  const fits = (t) => t.length >= QUOTE_MIN && t.length <= QUOTE_MAX;
  const later = page.segments.slice(QUOTE_AFTER + 1);
  const pool = later.length ? later : page.segments;
  const spoken = pool.filter((s) => s.kind === 'speech' && fits(s.text));
  const striking = spoken.find((s) => /[!?]/.test(s.text)) ?? [...spoken].sort((a, b) => b.text.length - a.text.length)[0];
  if (striking) return { text: striking.text.replace(/^[-\s"„”«»]+|["„”«»\s]+$/g, ''), by: striking.speaker };
  const total = page.segments.reduce((n, s) => n + (s.text?.length ?? 0), 0);
  if (total < SHORT_PAGE) return null;
  const sentences = pool
    .filter((s) => s.kind === 'para')
    .flatMap((s) => s.text.match(/[^.!?]+[.!?]+/g) ?? [])
    .map((t) => t.replace(/^[-\s"„”«»]+|["„”«»\s]+$/g, ''));
  const line = sentences.find((t) => fits(t) && /!/.test(t)) ?? sentences.find(fits);
  return line ? { text: line, by: null } : null;
}

function articleHtml(ctx, page, heroCutout) {
  const { lib } = ctx;
  const quote = pullQuoteOf(page);
  const portraits = [];
  let skippedHeroView = false;
  const parts = [];
  page.segments.forEach((s, i) => {
    switch (s.kind) {
      case 'heading':
        parts.push(`<h4 class="mm-sub">${lib.esc(s.text)}</h4>`);
        break;
      case 'para':
        parts.push(`<p class="mm-para">${lib.esc(s.text).replace(/\n/g, '<br>')}</p>`);
        break;
      case 'speech': {
        let side = '';
        if (s.portrait) {
          if (!portraits.includes(s.portrait)) portraits.push(s.portrait);
          side = portraits.indexOf(s.portrait) % 2 === 0 ? 'left' : 'right';
        }
        parts.push(`<p class="mm-speech">${s.portrait ? `<img class="mm-face mm-face--${side}" src="${s.portrait}" alt="">` : ''}${s.speaker ? `<b>${lib.esc(s.speaker)}</b> ` : ''}${lib.esc(s.text)}</p>`);
        break;
      }
      case 'picture':
        if (s.src === heroCutout) break;
        parts.push(`<figure class="mm-figure${s.width > 300 ? ' is-wide' : ' is-small'}"><img src="${s.src}" alt=""></figure>`);
        break;
      case 'mapview':
        if (!skippedHeroView) {
          skippedHeroView = true;
          break;
        }
        parts.push(`<figure class="mm-view"><button type="button" class="mm-view__shot" data-view style="${lib.mapViewStyle(ctx.map, s.icon, 322, 132)}"><em>${ICON.eye}Pokaż na mapie</em></button></figure>`);
        break;
      case 'signature':
        parts.push(`<p class="mm-signature">${lib.esc(s.text)}</p>`);
        break;
      default:
        break;
    }
    if (quote && i === QUOTE_AFTER - 1) parts.push(pullHtml(lib, quote));
  });
  if (quote && page.segments.length < QUOTE_AFTER) parts.push(pullHtml(lib, quote));
  return parts.join('');
}

const pullHtml = (lib, quote) =>
  `<blockquote class="mm-pull"><p>${lib.esc(quote.text)}</p>${quote.by ? `<cite>${lib.esc(quote.by)}</cite>` : ''}</blockquote>`;

function goalsAside(ctx) {
  const { lib, goals } = ctx;
  const done = goals.filter((g) => g.state === 'done').length;
  const order = [...goals.filter((g) => g.state === 'open'), ...goals.filter((g) => g.state === 'idle'), ...goals.filter((g) => g.state === 'done')];
  return `<aside class="mm-aside"><p class="mm-aside__kicker">W tym rozdziale</p><h3 class="mm-aside__title">Cele</h3><p class="mm-aside__score"><b>${done}</b><span>/ ${goals.length} wykonanych</span></p><ul class="mm-goals">${order
    .map((g) => `<li class="is-${g.state}${g.emphasis ? ' is-main' : ''}"><span class="mm-mark">${g.state === 'done' ? ICON.check : ''}</span><span>${lib.esc(lib.goalText(g))}</span></li>`)
    .join('')}</ul><button type="button" class="mm-aside__more" data-section="goals">Wszystkie cele ${ICON.next}</button></aside>`;
}

function goalsFeature(ctx) {
  const { lib, goals } = ctx;
  const done = goals.filter((g) => g.state === 'done').length;
  const block = (state, label) => {
    const rows = goals.filter((g) => g.state === state);
    if (!rows.length) return '';
    return `<section class="mm-feature__group is-${state}"><h4>${label} <span>${rows.length}</span></h4><ol>${rows
      .map((g) => `<li class="${g.emphasis ? 'is-main' : ''}"><span class="mm-mark">${state === 'done' ? ICON.check : ''}</span><span>${lib.esc(lib.goalText(g))}${g.emphasis ? ' <small>Główny cel</small>' : ''}</span></li>`)
      .join('')}</ol></section>`;
  };
  return `<div class="mm-feature"><div class="mm-feature__score"><p class="mm-feature__big">${done}<small>/${goals.length}</small></p><p class="mm-feature__caption">celów wykonanych</p><span class="mm-feature__bar"><i style="width:${(done / goals.length) * 100}%"></i></span></div><div class="mm-feature__lists">${block('open', 'Do wykonania')}${block('idle', 'Czekają na swój czas')}${block('done', 'Wykonane')}</div></div>`;
}

function contentsHtml(ctx, local) {
  const { lib, pages } = ctx;
  return `<div class="mm-contents"><ol>${pages
    .map((p, i) => `<li><button type="button" class="mm-entry${i === local.shown ? ' is-shown' : ''}" data-open="${i}"><span class="mm-entry__n">${String(i + 1).padStart(2, '0')}</span><span class="mm-entry__title">${lib.esc(p.title)}</span><span class="mm-entry__dots"></span><span class="mm-entry__time">${lib.receivedAt(i)}</span></button></li>`)
    .join('')}</ol><a href="#" class="mm-tables" data-tables>Tablice historyczne ${ICON.next} Wiedza</a></div>`;
}

function windowHtml(ctx, local) {
  const { lib, pages } = ctx;
  const latest = pages.length - 1;
  const page = lib.analysePage(ctx.mission.pages[local.shown]);
  const story = local.section === 'story';
  const hero = story ? heroOf(ctx, page, local.shown + 1) : { style: heroWorldStyle(ctx.map, 3, 5, lib), cutout: null, isView: false };
  const section = (id, label) => `<button type="button" class="mm-nav__item" data-section="${id}" aria-current="${local.section === id}">${label}</button>`;
  const kicker = story
    ? `${local.arrival && local.shown === latest ? 'Nowy rozdział · ' : ''}Rozdział ${local.shown + 1} z ${pages.length} · ${lib.receivedAt(local.shown)}`
    : lib.missionName(ctx.mission);
  const title = story ? page.title : local.section === 'goals' ? 'Cele misji' : 'Spis rozdziałów';
  const main = story
    ? `<div class="mm-main"><div class="mm-article"><div class="mm-spread"><div class="mm-columns">${articleHtml(ctx, page, hero.cutout)}</div></div></div>${goalsAside(ctx)}</div>`
    : `<div class="mm-main mm-main--full">${local.section === 'goals' ? goalsFeature(ctx) : contentsHtml(ctx, local)}</div>`;
  const foot = story
    ? `<footer class="mm-foot"><div class="mm-turn"><button type="button" class="mm-turn__btn" data-spread="-1" aria-label="Poprzednia strona">${ICON.prev}</button><span class="mm-turn__label" data-spread-label>Strona 1</span><button type="button" class="mm-turn__btn" data-spread="1" aria-label="Następna strona">${ICON.next}</button></div>
       <div class="mm-chapters"><button type="button" class="mm-link" data-step="-1" ${local.shown === 0 ? 'disabled' : ''}>${ICON.prev}Poprzedni rozdział</button><button type="button" class="mm-link" data-step="1" ${local.shown === latest ? 'disabled' : ''}>Następny rozdział${ICON.next}</button></div>
       ${local.arrival ? `<button type="button" class="on-button mm-go" data-continue>Kontynuuj grę ${ICON.next}</button>` : '<span class="mm-running">Gra toczy się dalej</span>'}</footer>`
    : `<footer class="mm-foot"><span></span>${local.arrival ? `<button type="button" class="on-button mm-go" data-continue>Kontynuuj grę ${ICON.next}</button>` : '<span class="mm-running">Gra toczy się dalej</span>'}</footer>`;
  return `${local.arrival ? '<div class="mm-scrim"></div>' : ''}<section class="on-window on-panel on-window--headless mm-window${local.arrival ? ' is-arrival' : ''}" aria-label="Misja">${lib.ORNAMENTS}
    <header class="mm-hero">
      <div class="mm-hero__image" style="${hero.style}"></div>
      ${hero.cutout ? `<img class="mm-hero__cutout" src="${hero.cutout}" alt="">` : ''}
      <div class="mm-hero__shade"></div>
      <nav class="mm-nav" aria-label="Działy">${section('story', 'Rozdział')}${section('goals', 'Cele')}${section('contents', 'Spis treści')}</nav>
      ${local.arrival ? `<span class="mm-paused">${ICON.pause}Gra wstrzymana</span>` : ''}
      ${lib.closeMedallion('mm-close')}
      <div class="mm-hero__text"><p class="mm-kicker">${lib.esc(kicker)}</p><h2 class="mm-title${title.length > TITLE_LONG ? ' is-long' : title.length > TITLE_MEDIUM ? ' is-medium' : ''}">${lib.esc(title)}</h2>
        ${story ? `<div class="mm-hero__tools"><button type="button" class="mm-listen" data-voice>${ICON.play}<span>Posłuchaj</span><span class="mm-listen__time">1:12</span></button>${hero.isView ? `<button type="button" class="mm-listen mm-listen--view" data-view>${ICON.eye}<span>Pokaż na mapie</span></button>` : ''}</div>` : ''}</div>
    </header>
    ${main}
    ${foot}
  </section>`;
}

function clippingHtml(ctx) {
  const { lib, goals } = ctx;
  const done = goals.filter((g) => g.state === 'done').length;
  const finished = goals.filter((g) => g.state === 'done').at(-1);
  const fresh = goals.filter((g) => g.state === 'open').at(-1);
  return `<aside class="mm-clipping" aria-live="polite"><p class="mm-clipping__kicker">Misja · cele ${done} / ${goals.length}</p><h3 class="mm-clipping__head">Cel wykonany</h3><p class="mm-clipping__done">${lib.esc(lib.goalText(finished))}</p><p class="mm-clipping__new"><span>Nowy cel</span>${lib.esc(lib.goalText(fresh))}</p><button type="button" class="mm-clipping__open" data-section="goals">Czytaj w Misji ${ICON.next}</button></aside>`;
}

function build(ctx, local) {
  if (local.closed) return '<div class="mm-root"></div>';
  return `<div class="mm-root">${local.clipping ? clippingHtml(ctx) : windowHtml(ctx, local)}</div>`;
}

function initialLocal(ctx) {
  return {
    section: { goals: 'goals', history: 'contents' }[ctx.view] ?? 'story',
    shown: ctx.pages.length - 1,
    arrival: ctx.view === 'arrival',
    clipping: ctx.view === 'update',
    spread: 0,
    closed: false,
  };
}

/** The columns overflow sideways; a spread is the article's width plus one gap. */
function layoutSpreads(root, local) {
  const columns = root.querySelector('.mm-columns');
  const label = root.querySelector('[data-spread-label]');
  if (!columns || !label) return;
  const step = columns.clientWidth + COLUMN_GAP;
  const count = Math.max(1, Math.round((columns.scrollWidth + COLUMN_GAP) / step));
  local.spread = clamp(local.spread, 0, count - 1);
  columns.style.transform = `translateX(${-local.spread * step}px)`;
  label.textContent = `Strona ${local.spread + 1} z ${count}`;
  root.querySelector('[data-spread="-1"]').disabled = local.spread === 0;
  root.querySelector('[data-spread="1"]').disabled = local.spread === count - 1;
  local.spreadCount = count;
}

export default {
  id: 'm',
  name: 'Magazyn',
  blurb:
    'Rozdział złożony jak artykuł w magazynie: szeroki baner z widokiem świata i tytułem, tekst w dwóch szpaltach przewracanych jak rozkładówki, cytat wyróżniony i portrety rozmówców wtopione w tekst, a cele w ramce z boku. Mocna hierarchia typograficzna zamiast ściany wyśrodkowanego tekstu.',
  css: 'm-magazyn.css',
  views: ['arrival', 'task', 'goals', 'history', 'update'],
  render(ctx) {
    return build(ctx, initialLocal(ctx));
  },
  mount(root, ctx) {
    detach?.();
    const local = initialLocal(ctx);
    const relayout = () => layoutSpreads(root, local);
    const watchImages = () => {
      relayout();
      root.querySelectorAll('.mm-columns img').forEach((img) => img.complete || img.addEventListener('load', relayout, { once: true }));
      document.fonts?.ready.then(relayout);
    };
    const redraw = () => {
      root.querySelector('.mm-root').outerHTML = build(ctx, local);
      watchImages();
    };
    watchImages();
    const onClick = (event) => {
      if (root.querySelector('.mm-root') === null) return;
      const target = event.target.closest('button, a');
      if (target === null || !root.contains(target)) return;
      const { dataset } = target;
      if (dataset.section) {
        local.section = dataset.section;
        local.clipping = false;
        local.spread = 0;
        redraw();
      } else if (dataset.spread) {
        local.spread += Number(dataset.spread);
        relayout();
      } else if (dataset.step) {
        local.shown = clamp(local.shown + Number(dataset.step), 0, ctx.pages.length - 1);
        local.spread = 0;
        redraw();
      } else if (dataset.open !== undefined) {
        local.shown = Number(dataset.open);
        local.section = 'story';
        local.spread = 0;
        redraw();
      } else if (dataset.continue !== undefined || target.classList.contains('mm-close')) {
        local.closed = true;
        redraw();
      } else if (dataset.voice !== undefined) {
        const playing = target.classList.toggle('is-playing');
        target.firstElementChild.outerHTML = playing ? ICON.pause : ICON.play;
      } else if (dataset.view !== undefined) {
        target.classList.add('is-picked');
      } else if (dataset.tables !== undefined) {
        event.preventDefault();
      }
    };
    let lastFlip = 0;
    const onWheel = (event) => {
      if (!event.target.closest?.('.mm-spread') || !local.spreadCount) return;
      event.preventDefault();
      if (event.timeStamp - lastFlip < WHEEL_FLIP_MS) return;
      lastFlip = event.timeStamp;
      const next = clamp(local.spread + Math.sign(event.deltaY), 0, local.spreadCount - 1);
      if (next !== local.spread) {
        local.spread = next;
        relayout();
      }
    };
    root.addEventListener('click', onClick);
    root.addEventListener('wheel', onWheel, { passive: false });
    detach = () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('wheel', onWheel);
    };
  },
};
