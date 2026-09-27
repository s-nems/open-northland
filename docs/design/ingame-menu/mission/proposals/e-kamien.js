// E · Kamień runiczny: the mission as a carved runestone slab standing over the map. The story sits on
// a pale polished tablet let into the stone, the goals are carved runes that fill with gold when done,
// the journal is a row of small standing stones.

/** Younger-futhark-like staves, one per goal, drawn as grooves in a 24 × 32 box. */
const RUNES = [
  'M8 30V2M8 9l10-7M8 17l10-7',
  'M7 30V2l11 8v20',
  'M8 2v28M8 9l9 7-9 7',
  'M12 2v28M4 9l16 13M20 9 4 22',
  'M8 30V2l10 7-10 7 10 14',
  'M12 30V2M4 10l8-8 8 8',
  'M8 2v28M8 2l9 7-9 7 9 7-9 7',
  'M12 2v28M6 12l12 8',
  'M8 4l8 10-8 6 8 10',
  'M8 30V2l10 8',
];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

const PLAY = '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M8 5v14l11-7Z" fill="currentColor"/></svg>';
const PAUSE = '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg>';
const REPLAY = '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5"/></svg>';

const rune = (i, cls = '') =>
  `<svg aria-hidden="true" class="e-rune ${cls}" viewBox="0 0 24 32"><path d="${RUNES[i % RUNES.length]}"/></svg>`;

const STATE_LABEL = { done: 'Wykonany', open: 'Aktywny', idle: 'Jeszcze nieodsłonięty' };

function goalProgress(goals) {
  const done = goals.filter((g) => g.state === 'done').length;
  return { done, total: goals.length };
}

/** Carved tally marks, the gold ones counting the goals done. */
function tally(goals) {
  const { done, total } = goalProgress(goals);
  const marks = goals.map((g) => `<i class="${g.state === 'done' ? 'is-lit' : ''}"></i>`).join('');
  return `<span class="e-tally" role="img" aria-label="Wykonano ${done} z ${total}">${marks}</span><span class="e-count"><b>${done}</b> / ${total}</span>`;
}

function goalRows(lib, goals, { large = false } = {}) {
  return goals
    .map(
      (g, i) => `<li class="e-goal e-goal--${g.state}${g.emphasis ? ' e-goal--main' : ''}">
        <span class="e-goal__rune">${rune(i)}</span>
        <span class="e-goal__text">${g.emphasis ? '<small>Cel główny</small>' : ''}${lib.esc(lib.goalText(g))}${
          large ? `<em>${STATE_LABEL[g.state]}</em>` : ''
        }</span>
        <span class="on-sr">${STATE_LABEL[g.state]}</span>
      </li>`,
    )
    .join('');
}

/** The story tablet's content: dialogue alternates sides by portrait, narration reads left-aligned. */
function storyHtml(lib, map, page) {
  const sides = new Map();
  let chapterOpened = false;
  return page.segments
    .map((s) => {
      switch (s.kind) {
        case 'heading':
          return `<h4 class="e-sub">${lib.esc(s.text)}</h4>`;
        case 'para': {
          const text = lib.esc(s.text).replace(/\n/g, '<br>');
          const first = !chapterOpened;
          chapterOpened = true;
          return `<p class="e-para${first ? ' e-para--lead' : ''}">${text}</p>`;
        }
        case 'speech': {
          if (!s.portrait)
            return `<p class="e-line">${s.speaker ? `<b>${lib.esc(s.speaker)}</b>` : ''}${lib.esc(s.text)}</p>`;
          if (!sides.has(s.portrait)) sides.set(s.portrait, sides.size % 2 === 0 ? 'l' : 'r');
          return `<figure class="e-say e-say--${sides.get(s.portrait)}">
            <span class="e-say__face"><img src="${s.portrait}" alt=""></span>
            <blockquote>${lib.esc(s.text.replace(/^["„”«»]\s*|\s*["„”«»]$/g, ''))}</blockquote>
          </figure>`;
        }
        case 'picture':
          return `<figure class="e-pic"><img src="${s.src}" alt="" style="aspect-ratio:${s.width}/${s.height}"></figure>`;
        case 'mapview':
          return `<button type="button" class="e-view" data-view>
            <span class="e-view__world" style="${lib.mapViewStyle(map, s.icon, 496, 170)}"></span>
            <span class="e-view__cap">${lib.GLYPH.pin}Pokaż na mapie</span>
          </button>`;
        case 'signature':
          return `<p class="e-sign"><span></span>${lib.esc(s.text)}<span></span></p>`;
        default:
          return '';
      }
    })
    .join('');
}

function voice() {
  return `<div class="e-voice" data-voice>
    <button type="button" class="on-medallion e-voice__play" data-play aria-label="Odtwórz narrację">${PLAY}</button>
    <span class="e-voice__meta"><span class="e-voice__label">Narracja</span><span class="e-voice__bar"><i></i></span></span>
    <button type="button" class="e-voice__again" data-replay aria-label="Od początku">${REPLAY}</button>
  </div>`;
}

function goalsAside(lib, goals) {
  return `<aside class="e-aside">
    <h3 class="e-aside__title">Cele</h3>
    <div class="e-aside__tally">${tally(goals)}</div>
    <ol class="e-goals">${goalRows(lib, goals)}</ol>
    ${voice()}
  </aside>`;
}

function historyHtml(lib, pages, shown) {
  const stones = pages
    .map(
      (p, i) => `<button type="button" class="e-stone${i === shown ? ' is-current' : ''}" data-open="${i}">
        <span class="e-stone__num">${ROMAN[i] ?? i + 1}</span>
        <span class="e-stone__title">${lib.esc(p.title)}</span>
        <span class="e-stone__time">${lib.receivedAt(i)}</span>
      </button>`,
    )
    .join('');
  return `<div class="e-history">
    <p class="e-note">Każdy kamień to rozdział, który już do Ciebie dotarł. Kliknij, by go odczytać.</p>
    <div class="e-stones">${stones}</div>
    <a class="e-wiedza" href="#" data-wiedza>Tablice historyczne ${lib.GLYPH.next} Wiedza</a>
  </div>`;
}

function goalsPanel(lib, goals) {
  const { done, total } = goalProgress(goals);
  return `<div class="e-goalboard">
    <div class="e-goalboard__head">
      <div class="e-goalboard__tally">${tally(goals)}</div>
      <p>${done === total ? 'Wszystkie cele wykonane.' : `Wykonano ${done} z ${total}. Runy wypełnione złotem to cele osiągnięte, przygaszone jeszcze się nie odsłoniły.`}</p>
    </div>
    <ol class="e-goals e-goals--large">${goalRows(lib, goals, { large: true })}</ol>
  </div>`;
}

function slab(ctx, st) {
  const { lib, mission, pages, goals, view } = ctx;
  const arrival = view === 'arrival';
  const shown = st.page;
  const page = pages[shown];
  const name = lib.missionName(mission);
  const { done, total } = goalProgress(goals);
  const tab = arrival ? 'story' : st.tab;
  const tabs = arrival
    ? ''
    : `<nav class="e-tabs" role="tablist">
        ${[
          ['story', 'Opowieść', ''],
          ['goals', 'Cele', `${done}/${total}`],
          ['history', 'Kronika', String(pages.length)],
        ]
          .map(
            ([id, label, count]) =>
              `<button type="button" role="tab" class="e-tab" data-tab="${id}" aria-selected="${tab === id}">${label}${count ? `<small>${count}</small>` : ''}</button>`,
          )
          .join('')}
      </nav>`;
  const heading =
    tab === 'story'
      ? `<p class="e-kicker">Rozdział ${ROMAN[shown] ?? shown + 1} · ${lib.esc(name)}</p><h2 class="e-title">${lib.esc(page.title)}</h2>`
      : `<p class="e-kicker">${lib.esc(name)}</p><h2 class="e-title">${tab === 'goals' ? 'Runy celów' : 'Kronika wyprawy'}</h2>`;
  let main;
  if (tab === 'story')
    main = `<div class="e-main"><article class="e-tablet" data-scroll>${storyHtml(lib, ctx.map, page)}</article>${goalsAside(lib, goals)}</div>`;
  else if (tab === 'goals') main = `<div class="e-main e-main--full">${goalsPanel(lib, goals)}</div>`;
  else main = `<div class="e-main e-main--full">${historyHtml(lib, pages, shown)}</div>`;

  const foot = arrival
    ? `<footer class="e-foot">
        <p class="e-paused">${PAUSE}<span><b>Gra wstrzymana</b>Świat czeka, aż skończysz czytać.</span></p>
        <button type="button" class="e-go" data-continue>Kontynuuj<kbd>Enter</kbd></button>
      </footer>`
    : tab === 'story'
      ? `<footer class="e-foot">
          <p class="e-running"><i></i>Gra toczy się dalej</p>
          <div class="e-pager">
            <button type="button" class="e-step" data-step="-1" ${shown === 0 ? 'disabled' : ''} aria-label="Wcześniejszy rozdział">${lib.GLYPH.back}</button>
            <span class="e-pips">${pages.map((_, i) => `<i class="${i === shown ? 'is-on' : ''}"></i>`).join('')}</span>
            <span class="e-pager__label">Rozdział ${shown + 1} z ${pages.length}</span>
            <button type="button" class="e-step" data-step="1" ${shown === pages.length - 1 ? 'disabled' : ''} aria-label="Późniejszy rozdział">${lib.GLYPH.next}</button>
          </div>
        </footer>`
      : `<footer class="e-foot"><p class="e-running"><i></i>Gra toczy się dalej</p></footer>`;

  return `${arrival ? '<div class="e-veil"></div>' : ''}
  <section class="e-slab${arrival ? ' e-slab--arrival' : ''}" aria-label="Misja">
    <div class="e-crown"><span class="e-crown__band"></span></div>
    <span class="e-strap e-strap--l"></span><span class="e-strap e-strap--r"></span>
    ${arrival ? '' : lib.closeMedallion('e-close')}
    <header class="e-head">${heading}</header>
    ${tabs}
    ${main}
    ${foot}
  </section>`;
}

function updateHtml(ctx) {
  const { lib, goals } = ctx;
  const doneIdx = goals.map((g) => g.state).lastIndexOf('done');
  const newIdx = goals.map((g) => g.state).lastIndexOf('open');
  const done = goals[doneIdx];
  const fresh = goals[newIdx];
  return `<aside class="e-tracker" aria-label="Cele misji">
    <div class="e-tracker__crown"></div>
    <div class="e-tracker__head">${tally(goals)}</div>
    ${done ? `<div class="e-tracker__row e-tracker__row--done">${rune(doneIdx, 'is-kindling')}<p><small>Cel wykonany</small>${lib.esc(lib.goalText(done))}</p></div>` : ''}
    ${fresh ? `<div class="e-tracker__row e-tracker__row--new">${rune(newIdx)}<p><small>Nowy cel</small>${lib.esc(lib.goalText(fresh))}</p></div>` : ''}
    <button type="button" class="e-tracker__open">Otwórz misję <kbd>M</kbd></button>
  </aside>
  <span class="e-beampip" aria-hidden="true"></span>`;
}

// Local window state: the tab and the chapter the player stepped to, reset when the review switches.
let local = { key: '', tab: 'story', page: 0 };

function stateFor(ctx) {
  const key = `${ctx.map}|${ctx.view}|${ctx.pageIndex}`;
  if (local.key !== key) {
    const tab = ctx.view === 'goals' ? 'goals' : ctx.view === 'history' ? 'history' : 'story';
    local = { key, tab, page: ctx.pages.length - 1 };
  }
  return local;
}

export default {
  id: 'e',
  name: 'Kamień runiczny',
  blurb:
    'Misja jako kamień runiczny wbity w mapę: fabuła na jasnej, wpuszczonej w kamień tablicy (czytelny atrament, 16 px), cele jako runy, które przy wykonaniu wypełniają się złotem, a kronika to rząd małych kamieni, po jednym na rozdział. Ten sam kamień przy wiadomości ze skryptu i przy otwarciu z belki, różni się tylko stopką (pauza lub „gra trwa”).',
  css: 'e-kamien.css',
  views: ['arrival', 'task', 'goals', 'history', 'update'],
  render(ctx) {
    if (ctx.view === 'update') return updateHtml(ctx);
    return slab(ctx, stateFor(ctx));
  },
  mount(root, ctx) {
    if (ctx.view === 'update') return;
    const draw = () => {
      root.innerHTML = ctx.lib.SYMBOLS + slab(ctx, local);
      wire();
    };
    const wire = () => {
      root.querySelectorAll('[data-tab]').forEach((b) =>
        b.addEventListener('click', () => {
          local.tab = b.dataset.tab;
          draw();
        }),
      );
      root.querySelectorAll('[data-step]').forEach((b) =>
        b.addEventListener('click', () => {
          local.page = Math.max(0, Math.min(ctx.pages.length - 1, local.page + Number(b.dataset.step)));
          draw();
        }),
      );
      root.querySelectorAll('[data-open]').forEach((b) =>
        b.addEventListener('click', () => {
          local.page = Number(b.dataset.open);
          local.tab = 'story';
          draw();
        }),
      );
      const voiceBox = root.querySelector('[data-voice]');
      const play = root.querySelector('[data-play]');
      play?.addEventListener('click', () => {
        const on = voiceBox.classList.toggle('is-playing');
        play.innerHTML = on ? PAUSE : PLAY;
        play.setAttribute('aria-label', on ? 'Wstrzymaj narrację' : 'Odtwórz narrację');
      });
      root.querySelector('[data-replay]')?.addEventListener('click', () => {
        const bar = voiceBox.querySelector('.e-voice__bar i');
        voiceBox.classList.remove('is-playing');
        void bar.offsetWidth;
        voiceBox.classList.add('is-playing');
        play.innerHTML = PAUSE;
      });
      root.querySelector('[data-continue]')?.addEventListener('click', () => {
        root.querySelector('.e-slab')?.classList.add('is-leaving');
        root.querySelector('.e-veil')?.classList.add('is-leaving');
      });
      root.querySelector('[data-wiedza]')?.addEventListener('click', (e) => e.preventDefault());
    };
    wire();
  },
};
