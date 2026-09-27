// Proposal L, Karta rozdziału: a scripted briefing opens as a full-screen chapter card over a painted
// scene, like a campaign interstitial; voluntary reading uses a framed window headed by the same
// painting, with a chapter chronicle of cards.

/** A picture wider than this is a painted still, not a speaker's portrait (portraits are 164 px). */
const PORTRAIT_MAX_W = 200;
/** One painting per mission (generated for the review, see /mission-review/art/l-*.json). */
const PAINTING = {
  zdradziecka_mielizna: 'l-shoal',
  gringo: 'l-bridge',
  cn_0: 'l-lava',
  boso_przez_swiat: 'l-oasis',
};
const FALLBACK_PAINTING = 'l-shoal';
/** Crops of the painting per chapter, so each chapter's banner and card differ (background-position at 190 %). */
const CROPS = ['72% 62%', '88% 38%', '58% 78%', '96% 70%', '64% 30%', '80% 88%', '50% 55%', '100% 45%', '70% 20%', '86% 100%'];
const CROP_ZOOM = '190%';
/** Where the full-screen card places the painting, per chapter (background-position with `cover`). */
const CARD_FOCUS = ['right 40%', 'right 55%', 'right 30%', 'right 65%'];

const SVG = {
  play: '<svg aria-hidden="true" class="on-glyph on-glyph--solid" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg aria-hidden="true" class="on-glyph on-glyph--solid" viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  replay: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"/></svg>',
  check: '<svg aria-hidden="true" class="mpl-tick" viewBox="0 0 24 24"><path d="M4.5 12.5c2 1.2 3.4 2.8 4.6 5 2.6-5.4 6-9.3 10.6-12.6"/></svg>',
  diamond: '<svg aria-hidden="true" class="mpl-diamond" viewBox="0 0 12 12"><path d="M6 1 11 6 6 11 1 6z"/></svg>',
};

/** analysePage's title for a page without one. */
const UNTITLED = '\u2014';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const roman = (i) => ROMAN[i] ?? String(i + 1);
const paintingUrl = (map) => `/mission-review/art/${PAINTING[map] ?? FALLBACK_PAINTING}.jpg`;
const cropStyle = (map, i) =>
  `background-image:url(${paintingUrl(map)});background-size:${CROP_ZOOM} auto;background-position:${CROPS[i % CROPS.length]}`;

function niceTitle(title) {
  if (title !== title.toUpperCase()) return title;
  return title.toLowerCase().replace(/(^|:\s+)(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
}

function chapterTitle(page) {
  if (page.title !== UNTITLED) return niceTitle(page.title);
  const first = page.segments.find((s) => s.kind === 'para' || s.kind === 'speech');
  const words = (first?.text ?? '').replace(/^[-"„\s]+/, '').split(/\s+/).slice(0, 5).join(' ');
  return words ? `${words}…` : 'Wieść';
}

/** Longest speaker name in words; a longer "Name: text" opening is narration the analyser misread. */
const SPEAKER_MAX_WORDS = 2;

function fixSpeech(s) {
  if (s.kind !== 'speech' || s.speaker === null || s.speaker.split(/\s+/).length <= SPEAKER_MAX_WORDS) return s;
  return { kind: 'para', text: `${s.speaker}: ${s.text}`, align: 'left', link: null };
}

function normalise(ctx) {
  for (const page of ctx.pages) page.segments = page.segments.map(fixSpeech);
}

// ---------- state (module-level, reset when the harness moves to another map, page or view) ----------

const st = { key: '', tab: 'chapter', chapter: 0, playing: false, closed: false };
let current = null;

function sync(ctx) {
  const key = `${ctx.map}|${ctx.pageIndex}|${ctx.view}`;
  if (st.key === key) return;
  Object.assign(st, {
    key,
    tab: ctx.view === 'goals' ? 'goals' : ctx.view === 'history' ? 'history' : 'chapter',
    chapter: ctx.pages.length - 1,
    playing: false,
    closed: false,
  });
}

// ---------- shared pieces ----------

function voiceHtml() {
  const label = st.playing ? 'Wstrzymaj lektora' : 'Posłuchaj';
  return `<div class="mpl-voice${st.playing ? ' is-playing' : ''}">
    <button type="button" class="on-medallion mpl-voice__btn" data-act="voice" aria-label="${label}" title="${label}">${st.playing ? SVG.pause : SVG.play}</button>
    <button type="button" class="on-medallion mpl-voice__btn" data-act="voice-replay" aria-label="Od początku" title="Od początku">${SVG.replay}</button>
    <span class="mpl-voice__label">${st.playing ? 'Lektor czyta' : 'Lektor'}</span>
  </div>`;
}

/** The page's segments as a reading column; `lead` gives the first narration its drop cap. */
function readingHtml(ctx, page, { lead }) {
  const { esc } = ctx.lib;
  let leadDone = !lead;
  return page.segments
    .map((s) => {
      switch (s.kind) {
        case 'heading':
          return `<h4 class="mpl-h">${SVG.diamond}${esc(s.text)}</h4>`;
        case 'para': {
          const text = esc(s.text).replace(/\n/g, '<br>');
          if (!leadDone) {
            leadDone = true;
            return `<p class="mpl-lead">${text}</p>`;
          }
          return `<p class="mpl-p">${text}</p>`;
        }
        case 'speech': {
          leadDone = true;
          const face = s.portrait
            ? `<span class="mpl-oval"><img src="${s.portrait}" alt=""></span>`
            : `<span class="mpl-oval mpl-oval--initial" aria-hidden="true">${esc((s.speaker ?? '?')[0])}</span>`;
          return `<figure class="mpl-speech">${face}<figcaption>${s.speaker ? `<b>${esc(s.speaker)}</b>` : ''}<q>${esc(s.text.replace(/^["„”]+|["„”]+\s*$/g, ''))}</q></figcaption></figure>`;
        }
        case 'picture':
          return s.width > PORTRAIT_MAX_W
            ? `<img class="mpl-still" src="${s.src}" alt="">`
            : `<span class="mpl-oval mpl-oval--float"><img src="${s.src}" alt=""></span>`;
        case 'mapview':
          return `<button type="button" class="mpl-view" data-act="show"><span class="mpl-view__img" style="${ctx.lib.mapViewStyle(ctx.map, s.icon, 264, 132)}"></span><span class="mpl-view__cap">${ctx.lib.GLYPH.pin}Pokaż na mapie</span></button>`;
        case 'signature':
          return `<p class="mpl-sign">${esc(s.text)}</p>`;
        default:
          return '';
      }
    })
    .join('');
}

// ---------- arrival: the full-screen chapter card ----------

function arrivalHtml(ctx) {
  const { esc } = ctx.lib;
  const i = ctx.pages.length - 1;
  const page = ctx.pages[i];
  const title = chapterTitle(page);
  const mission = ctx.lib.missionName(ctx.mission);
  const open = ctx.goals.filter((g) => g.state === 'open');
  const done = ctx.goals.filter((g) => g.state === 'done');
  const waiting = ctx.goals.filter((g) => g.state === 'idle').length;
  const goals = [...done.map((g) => ({ g, done: true })), ...open.map((g) => ({ g, done: false }))]
    .map(({ g, done: d }) => `<li class="${d ? 'is-done' : ''}">${d ? SVG.check : SVG.diamond}<span>${esc(ctx.lib.goalText(g))}</span>${g.emphasis ? '<em>Główne</em>' : ''}</li>`)
    .join('');
  const pips = ctx.pages
    .map((_, k) => `<li class="${k === i ? 'is-now' : ''}">${roman(k)}</li>`)
    .join('<li class="mpl-pips__gap" aria-hidden="true"></li>');
  return `<div class="mpl-card" role="dialog" aria-label="${esc(`Rozdział ${roman(i)}: ${title}`)}">
    <div class="mpl-card__art" style="background-image:url(${paintingUrl(ctx.map)});background-position:${CARD_FOCUS[i % CARD_FOCUS.length]}"></div>
    <div class="mpl-card__shade"></div>
    <div class="mpl-card__top">
      <span class="mpl-paused">${SVG.pause}Gra wstrzymana</span>
      ${voiceHtml()}
    </div>
    <article class="mpl-col">
      <header class="mpl-col__head">
        <p class="mpl-kicker"><span>Rozdział ${roman(i)}</span></p>
        <h1 class="mpl-title">${esc(title)}</h1>
        ${title.toLowerCase() === mission.toLowerCase() ? '' : `<p class="mpl-mission">${esc(mission)}</p>`}
        <p class="mpl-ornament" aria-hidden="true"><span></span>${SVG.diamond}<span></span></p>
      </header>
      <div class="mpl-scroll">
        ${readingHtml(ctx, page, { lead: true })}
        ${
          goals
            ? `<section class="mpl-tasks"><h2 class="mpl-tasks__title">Twoje zadania</h2><ul>${goals}</ul>${
                waiting ? `<p class="mpl-tasks__more">Kolejne zadania (${waiting}) odsłoni dalsza opowieść.</p>` : ''
              }</section>`
            : ''
        }
      </div>
      <footer class="mpl-col__foot">
        <button type="button" class="mpl-go" data-act="close">Do dzieła</button>
        <p class="mpl-go__hint"><kbd class="on-key">Enter</kbd>Tekst i zadania zostają w oknie Misja.</p>
      </footer>
    </article>
    <ol class="mpl-pips" aria-label="Rozdziały">${pips}</ol>
  </div>`;
}

// ---------- the framed window ----------

function chapterPane(ctx) {
  const page = ctx.pages[st.chapter];
  return `<div class="on-parchment mpl-sheet mpl-sheet--read">${readingHtml(ctx, page, { lead: true })}</div>`;
}

function goalsPane(ctx) {
  const { esc } = ctx.lib;
  const done = ctx.goals.filter((g) => g.state === 'done').length;
  const rows = ctx.goals
    .map((g) => {
      const box = g.state === 'done' ? `<span class="mpl-box">${SVG.check}</span>` : `<span class="mpl-box"></span>`;
      const note = g.state === 'idle' ? '<span class="mpl-goal__note">wkrótce</span>' : g.state === 'done' ? '<span class="mpl-goal__note">wykonane</span>' : '';
      return `<li class="mpl-goal is-${g.state}">${box}<span class="mpl-goal__text">${g.emphasis ? '<em class="mpl-main">Główne</em>' : ''}${esc(ctx.lib.goalText(g))}</span>${note}</li>`;
    })
    .join('');
  return `<div class="on-parchment mpl-sheet">
    <header class="mpl-goalhead">
      <h3>Twoje zadania</h3>
      <p><b>${done}</b> z ${ctx.goals.length} wykonane</p>
    </header>
    <span class="mpl-progress"><i style="width:${(done / ctx.goals.length) * 100}%"></i></span>
    <ul class="mpl-goals">${rows}</ul>
  </div>`;
}

function historyPane(ctx) {
  const { esc } = ctx.lib;
  const last = ctx.pages.length - 1;
  const cards = ctx.pages
    .map(
      (page, i) => `<button type="button" class="mpl-chap${i === st.chapter ? ' is-open' : ''}" data-act="read" data-i="${i}">
        <span class="mpl-chap__art" style="${cropStyle(ctx.map, i)}"><span class="mpl-chap__num">${roman(i)}</span>${i === last ? '<span class="mpl-chap__new">Nowy</span>' : ''}</span>
        <span class="mpl-chap__title">${esc(chapterTitle(page))}</span>
        <span class="mpl-chap__time">${ctx.lib.receivedAt(i)}</span>
      </button>`,
    )
    .join('');
  return `<div class="on-parchment mpl-sheet">
    <p class="on-parchment__note">Kronika misji<span class="on-parchment__count">${ctx.pages.length}</span></p>
    <div class="mpl-chaps">${cards}</div>
    <button type="button" class="mpl-wiki" data-act="wiki">Tablice historyczne<span>→</span>Wiedza</button>
  </div>`;
}

function windowHtml(ctx) {
  const { esc } = ctx.lib;
  const page = ctx.pages[st.chapter];
  const last = ctx.pages.length - 1;
  const done = ctx.goals.filter((g) => g.state === 'done').length;
  const tabs = [
    ['chapter', 'Rozdział', roman(st.chapter)],
    ['goals', 'Zadania', `${done}/${ctx.goals.length}`],
    ['history', 'Kronika', String(ctx.pages.length)],
  ]
    .map(
      ([id, label, count]) =>
        `<button type="button" role="tab" class="on-tab" data-act="tab" data-i="${id}" aria-selected="${st.tab === id}">${label}<span class="on-tab__count">${count}</span></button>`,
    )
    .join('');
  const pane = st.tab === 'goals' ? goalsPane(ctx) : st.tab === 'history' ? historyPane(ctx) : chapterPane(ctx);
  const foot =
    st.tab === 'chapter'
      ? `<button type="button" class="on-button mpl-step" data-act="prev" ${st.chapter === 0 ? 'disabled' : ''}>${ctx.lib.GLYPH.back}${st.chapter > 0 ? `Rozdział ${roman(st.chapter - 1)}` : 'Początek'}</button>
         <span class="mpl-live"><i></i>Gra toczy się dalej</span>
         <button type="button" class="on-button mpl-step" data-act="next" ${st.chapter === last ? 'disabled' : ''}>${st.chapter < last ? `Rozdział ${roman(st.chapter + 1)}` : 'Najnowszy'}${ctx.lib.GLYPH.next}</button>`
      : `<span></span><span class="mpl-live"><i></i>Gra toczy się dalej</span><span></span>`;
  return `<section class="on-window on-panel mpl-win" style="left:322px;top:72px;width:720px;height:606px" aria-label="Misja">
    ${ctx.lib.ORNAMENTS}
    <header class="mpl-banner" style="${cropStyle(ctx.map, st.chapter)}">
      <div class="mpl-banner__text">
        <p class="mpl-banner__kicker">${esc(ctx.lib.missionName(ctx.mission))} · Rozdział ${roman(st.chapter)} · ${ctx.lib.receivedAt(st.chapter)}</p>
        <h2 class="mpl-banner__title">${esc(chapterTitle(page))}</h2>
      </div>
      ${voiceHtml()}
      ${ctx.lib.closeMedallion('on-window__close mpl-close')}
    </header>
    <nav class="on-tabs mpl-tabs" role="tablist">${tabs}</nav>
    ${pane}
    <footer class="mpl-foot">${foot}</footer>
  </section>`;
}

// ---------- update: a small chapter card at the head of the screen ----------

function updateHtml(ctx) {
  const { esc } = ctx.lib;
  const i = ctx.pages.length - 1;
  const done = ctx.goals.filter((g) => g.state === 'done').at(-1);
  const fresh = ctx.goals.find((g) => g.state === 'open');
  return `<aside class="on-panel mpl-toast" aria-live="polite">
    <span class="mpl-toast__art" style="${cropStyle(ctx.map, i)}"><span>${roman(i)}</span></span>
    <div class="mpl-toast__body">
      <p class="mpl-toast__kicker">Twoje zadania</p>
      ${done ? `<p class="mpl-toast__row is-done">${SVG.check}<s>${esc(ctx.lib.goalText(done))}</s></p>` : ''}
      ${fresh ? `<p class="mpl-toast__row is-new">${SVG.diamond}<span><b>Nowe:</b> ${esc(ctx.lib.goalText(fresh))}</span></p>` : ''}
    </div>
    <button type="button" class="mpl-toast__open" data-act="noop" aria-label="Otwórz Misję">${ctx.lib.GLYPH.next}</button>
  </aside>`;
}

// ---------- module ----------

function render(ctx) {
  sync(ctx);
  normalise(ctx);
  if (ctx.view === 'update') return updateHtml(ctx);
  if (st.closed) return ctx.view === 'arrival' ? `<p class="mpl-resumed">${SVG.play}Gra wznowiona</p>` : '';
  if (ctx.view === 'arrival') return arrivalHtml(ctx);
  return windowHtml(ctx);
}

function refresh(keepScroll) {
  if (current === null) return;
  const { root, ctx } = current;
  const scroll = root.querySelector('.mpl-scroll, .mpl-sheet')?.scrollTop ?? 0;
  root.innerHTML = ctx.lib.SYMBOLS + render(ctx);
  mount(root, ctx);
  const pane = root.querySelector('.mpl-scroll, .mpl-sheet');
  if (pane && keepScroll) pane.scrollTop = scroll;
}

function act(ctx, action, arg) {
  const before = `${st.tab}|${st.chapter}`;
  switch (action) {
    case 'close':
      st.closed = true;
      break;
    case 'tab':
      st.tab = arg;
      break;
    case 'read':
      st.chapter = Number(arg);
      st.tab = 'chapter';
      break;
    case 'prev':
      st.chapter = Math.max(0, st.chapter - 1);
      break;
    case 'next':
      st.chapter = Math.min(ctx.pages.length - 1, st.chapter + 1);
      break;
    case 'voice':
      st.playing = !st.playing;
      break;
    case 'voice-replay':
      st.playing = true;
      break;
    default:
      return;
  }
  refresh(before === `${st.tab}|${st.chapter}`);
}

let keysBound = false;

function mount(root, ctx) {
  current = { root, ctx };
  root.onclick = (event) => {
    const target = event.target.closest('[data-act], .mpl-close');
    if (target === null || target.disabled) return;
    if (target.classList.contains('mpl-close')) act(ctx, 'close');
    else act(ctx, target.dataset.act, target.dataset.i);
  };
  if (!keysBound) {
    keysBound = true;
    document.addEventListener('keydown', (event) => {
      if (current === null || !current.root.classList.contains('mp-l')) return;
      if (current.ctx.view === 'arrival' && event.key === 'Enter' && !st.closed) {
        event.preventDefault();
        act(current.ctx, 'close');
      }
    });
  }
}

export default {
  id: 'l',
  name: 'Karta rozdziału',
  blurb:
    'Nowy rozdział otwiera się jak plansza kampanii: pełnoekranowy obraz sceny, "Rozdział II", tytuł, tekst w eleganckiej kolumnie na przyciemnionej części obrazu i na końcu "Twoje zadania" z dużym "Do dzieła". Misja z belki to zwykłe okno z tym samym obrazem jako nagłówkiem, zadaniami jako lista do odhaczania i kroniką rozdziałów jako kartami.',
  css: 'l-rozdzial.css',
  views: ['arrival', 'task', 'goals', 'history', 'update'],
  render,
  mount,
};
