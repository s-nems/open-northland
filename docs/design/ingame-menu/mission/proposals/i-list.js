// I · List z pieczęcią: every briefing arrives as a sealed letter. The script's chapter lands as a
// folded letter on the darkened map and is read after the seal breaks; voluntarily the latest letter
// lies open on the desk with the goals pinned to it as a checklist, and the history is the pile of
// letters received so far.

const SEAL = '/mission-review/art/i-seal-320.png';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
/** Slight tilts of the letters in the pile, so it reads as paper laid by hand. */
const PILE_TILT = [-1.6, 1.2, -0.6, 1.8, -1.1, 0.7, -1.9, 1.4, -0.4, 1];

const PLAY = '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M8 5v14l11-7Z" fill="currentColor"/></svg>';
const PAUSE = '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg>';
const REPLAY = '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5"/></svg>';
const TICK = '<svg aria-hidden="true" class="i-tick" viewBox="0 0 24 24"><path d="M4 13c2 1.5 3.6 3.4 5 6 2.8-6.4 6.4-10.6 11-14"/></svg>';
const LETTER = '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M3 6h18v12H3zM3 6l9 7 9-7"/></svg>';

const STATE_LABEL = { done: 'wykonany', open: 'do zrobienia', idle: 'jeszcze nieogłoszony' };

const progress = (goals) => ({ done: goals.filter((g) => g.state === 'done').length, total: goals.length });

/** A sentence-cased chapter title: the pages carry them in capitals, a letter heading reads better. */
function titleCase(text) {
  if (text !== text.toUpperCase()) return text;
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function letterBody(lib, map, page) {
  let lead = true;
  return page.segments
    .map((s) => {
      switch (s.kind) {
        case 'heading':
          return `<h4 class="i-sub">${lib.esc(titleCase(s.text))}</h4>`;
        case 'para': {
          const cls = lead ? 'i-para i-para--lead' : 'i-para';
          lead = false;
          return `<p class="${cls}">${lib.esc(s.text).replace(/\n/g, '<br>')}</p>`;
        }
        case 'speech':
          if (s.portrait)
            return `<figure class="i-say"><img src="${s.portrait}" alt=""><blockquote>${lib.esc(s.text)}</blockquote></figure>`;
          return `<p class="i-line">${s.speaker ? `<b>${lib.esc(s.speaker)}:</b> ` : ''}${lib.esc(s.text)}</p>`;
        case 'picture':
          return `<figure class="i-pic"><img src="${s.src}" alt="" style="aspect-ratio:${s.width}/${s.height}"></figure>`;
        case 'mapview':
          return `<figure class="i-sketch"><span class="i-sketch__pin"></span>
            <span class="i-sketch__world" style="${lib.mapViewStyle(map, s.icon, 460, 160)}"></span>
            <button type="button" class="i-sketch__go" data-view>${lib.GLYPH.pin}Pokaż na mapie</button></figure>`;
        case 'signature':
          return `<p class="i-signature"><span>${lib.esc(s.text.replace(/^(made by|by)\s+/i, ''))}</span></p>`;
        default:
          return '';
      }
    })
    .join('');
}

function voice() {
  return `<div class="i-voice" data-voice>
    <button type="button" class="i-voice__play" data-play aria-label="Odczytaj list na głos">${PLAY}</button>
    <span class="i-voice__meta"><span>Odczytaj na głos</span><span class="i-voice__bar"><i></i></span></span>
    <button type="button" class="i-voice__again" data-replay aria-label="Od początku">${REPLAY}</button>
  </div>`;
}

/** The letter sheet: the broken seal on top, the heading, the scrolling text, a foot slot. */
function sheet(ctx, index, foot, cls = '') {
  const { lib, pages } = ctx;
  const page = pages[index];
  return `<div class="i-letter ${cls}">
    <span class="i-broken" aria-hidden="true"><img src="${SEAL}" alt=""><img src="${SEAL}" alt=""></span>
    <article class="i-sheet">
      <header class="i-sheet__head">
        <p class="i-meta"><span>List ${ROMAN[index] ?? index + 1}</span><span>otrzymany ${lib.receivedAt(index)}</span></p>
        <h2 class="i-title">${lib.esc(titleCase(page.title))}</h2>
      </header>
      <div class="i-sheet__text" data-scroll>${letterBody(lib, ctx.map, page)}</div>
      ${foot}
    </article>
  </div>`;
}

function checklist(lib, goals, { large = false } = {}) {
  const { done, total } = progress(goals);
  const rows = goals
    .map(
      (g) => `<li class="i-check i-check--${g.state}${g.emphasis ? ' i-check--main' : ''}">
        <span class="i-box">${g.state === 'done' ? TICK : ''}</span>
        <span>${g.emphasis ? '<small>Cel główny</small>' : ''}${lib.esc(lib.goalText(g))}${
          large ? `<em>${STATE_LABEL[g.state]}</em>` : ''
        }<span class="on-sr"> (${STATE_LABEL[g.state]})</span></span>
      </li>`,
    )
    .join('');
  return `<div class="i-slip${large ? ' i-slip--large' : ''}">
    <span class="i-slip__pin" aria-hidden="true"></span>
    <header class="i-slip__head"><h3>Cele</h3><span class="i-slip__count"><b>${done}</b> z ${total}</span></header>
    <span class="i-slip__bar"><i style="width:${(done / total) * 100}%"></i></span>
    <ol class="i-checks">${rows}</ol>
  </div>`;
}

// ---------- arrival: the sealed letter, then the opened one ----------

function arrival(ctx, st) {
  const { lib, mission, pages } = ctx;
  const index = pages.length - 1;
  const page = pages[index];
  const paused = `<p class="i-paused">${PAUSE}<span>Gra wstrzymana</span></p>`;
  if (st.sealed)
    return `<div class="i-veil"></div>${paused}
    <div class="i-arrive">
      <p class="i-arrive__kicker">Goniec przynosi list · ${lib.esc(lib.missionName(mission))}</p>
      <div class="i-envelope">
        <span class="i-envelope__fold"><span class="i-envelope__flap"></span></span>
        <p class="i-envelope__to">${lib.esc(titleCase(page.title))}</p>
        <p class="i-envelope__no">List ${ROMAN[index] ?? index + 1}</p>
        <button type="button" class="i-seal" data-break aria-label="Złam pieczęć i przeczytaj"><img src="${SEAL}" alt=""></button>
      </div>
      <button type="button" class="i-break" data-break>Złam pieczęć<kbd>Enter</kbd></button>
    </div>`;
  const foot = `<footer class="i-sheet__foot">${voice()}<button type="button" class="i-go" data-continue>Kontynuuj<kbd>Enter</kbd></button></footer>`;
  return `<div class="i-veil"></div>
  <div class="i-reading">
    ${sheet(ctx, index, foot, 'i-letter--unfold')}
    ${checklist(lib, ctx.goals)}
    ${paused}
  </div>`;
}

// ---------- the voluntary window: letter, goals, pile ----------

function windowBody(ctx, st) {
  const { lib, pages, goals } = ctx;
  const { done, total } = progress(goals);
  const tabs = [
    ['letter', 'List', ''],
    ['goals', 'Cele', `${done}/${total}`],
    ['pile', 'Wszystkie listy', String(pages.length)],
  ]
    .map(
      ([id, label, count]) =>
        `<button type="button" role="tab" class="on-tab" data-tab="${id}" aria-selected="${st.tab === id}">${label}${
          count ? `<span class="on-tab__count">${count}</span>` : ''
        }</button>`,
    )
    .join('');
  let desk;
  if (st.tab === 'letter') {
    const i = st.page;
    const foot = `<footer class="i-sheet__foot i-sheet__foot--nav">
      <button type="button" class="i-turn" data-step="-1" ${i === 0 ? 'disabled' : ''}>${lib.GLYPH.back}Wcześniejszy</button>
      <span class="i-turn__label">List ${i + 1} z ${pages.length}</span>
      <button type="button" class="i-turn" data-step="1" ${i === pages.length - 1 ? 'disabled' : ''}>Późniejszy${lib.GLYPH.next}</button>
    </footer>`;
    desk = `<div class="i-desk i-desk--letter">${sheet(ctx, i, foot)}<div class="i-side">${checklist(lib, goals)}${voice()}</div></div>`;
  } else if (st.tab === 'goals') {
    desk = `<div class="i-desk i-desk--goals"><div class="i-under" aria-hidden="true"></div>${checklist(lib, goals, { large: true })}</div>`;
  } else {
    const letters = pages
      .map((p, i) => ({ p, i }))
      .reverse()
      .map(
        ({ p, i }) => `<button type="button" class="i-note${i === pages.length - 1 ? ' is-latest' : ''}" data-open="${i}" style="--tilt:${PILE_TILT[i % PILE_TILT.length]}deg">
          <span class="i-broken i-broken--note" aria-hidden="true"><img src="${SEAL}" alt=""><img src="${SEAL}" alt=""></span>
          <span class="i-note__no">List ${ROMAN[i] ?? i + 1}</span>
          <span class="i-note__title">${lib.esc(titleCase(p.title))}</span>
          <span class="i-note__time">${lib.receivedAt(i)}</span>
        </button>`,
      )
      .join('');
    desk = `<div class="i-desk i-desk--pile">
      <div class="i-pile">${letters}</div>
      <p class="i-pile__foot"><span>Najnowszy list leży na wierzchu. Kliknij list, by go przeczytać.</span><a href="#" data-wiedza>Tablice historyczne ${lib.GLYPH.next} Wiedza</a></p>
    </div>`;
  }
  return `<nav class="on-tabs i-tabs" role="tablist">${tabs}<span class="i-running"><i></i>Gra toczy się dalej</span></nav>${desk}`;
}

// ---------- update: cards in the notification column and a seal on the beam ----------

function update(ctx) {
  const { lib, goals } = ctx;
  const states = goals.map((g) => g.state);
  const done = goals[states.lastIndexOf('done')];
  const fresh = goals[states.lastIndexOf('open')];
  const card = (kind, label, goal) => `<div class="i-card i-card--${kind}">
      <span class="i-card__thumb">${LETTER}</span>
      <span class="i-card__seal"></span>
      <p><small>${label}</small>${lib.esc(lib.goalText(goal))}</p>
    </div>`;
  return `<div class="i-cards">
      ${fresh ? card('new', 'Nowy cel', fresh) : ''}
      ${done ? card('done', 'Cel wykonany', done) : ''}
    </div>
    <span class="i-beamseal" aria-label="Nowy cel w misji"><img src="${SEAL}" alt=""></span>`;
}

// Local window state (the tab, the letter shown, the seal), reset when the review switches state.
let local = { key: '', tab: 'letter', page: 0, sealed: true };

function stateFor(ctx) {
  const key = `${ctx.map}|${ctx.view}|${ctx.pageIndex}`;
  if (local.key !== key) {
    const tab = ctx.view === 'goals' ? 'goals' : ctx.view === 'history' ? 'pile' : 'letter';
    local = { key, tab, page: ctx.pages.length - 1, sealed: true };
  }
  return local;
}

function view(ctx, st) {
  const { lib, view: v, mission } = ctx;
  if (v === 'update') return update(ctx);
  if (v === 'arrival') return arrival(ctx, st);
  return lib.hudWindow({
    title: 'Misja',
    kicker: lib.missionName(mission),
    width: 940,
    cls: 'i-window',
    style: 'left:212px;top:60px;height:622px',
    body: windowBody(ctx, st),
  });
}

export default {
  id: 'i',
  name: 'List z pieczęcią',
  blurb:
    'Każdy briefing to list: skrypt kładzie na przyciemnionej mapie zapieczętowany list, gracz łamie pieczęć i czyta go jak prawdziwą korespondencję, z podpisem autora na dole i listą celów przypiętą obok. Z belki otwiera się ostatni list na biurku, a historia to stos otwartych listów z pieczęciami i godzinami.',
  css: 'i-list.css',
  views: ['arrival', 'task', 'goals', 'history', 'update'],
  render(ctx) {
    return view(ctx, stateFor(ctx));
  },
  mount(root, ctx) {
    const draw = () => {
      root.innerHTML = ctx.lib.SYMBOLS + view(ctx, local);
      wire();
    };
    const wire = () => {
      root.querySelectorAll('[data-break]').forEach((b) =>
        b.addEventListener('click', () => {
          root.querySelector('.i-arrive')?.classList.add('is-breaking');
          setTimeout(() => {
            local.sealed = false;
            draw();
          }, 380);
        }),
      );
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
          local.tab = 'letter';
          draw();
        }),
      );
      const voiceBox = root.querySelector('[data-voice]');
      const play = root.querySelector('[data-play]');
      play?.addEventListener('click', () => {
        const on = voiceBox.classList.toggle('is-playing');
        play.innerHTML = on ? PAUSE : PLAY;
      });
      root.querySelector('[data-replay]')?.addEventListener('click', () => {
        voiceBox.classList.remove('is-playing');
        void voiceBox.offsetWidth;
        voiceBox.classList.add('is-playing');
        play.innerHTML = PAUSE;
      });
      root.querySelector('[data-continue]')?.addEventListener('click', () => {
        root.querySelector('.i-reading')?.classList.add('is-leaving');
        root.querySelector('.i-veil')?.classList.add('is-leaving');
        root.querySelector('.i-paused')?.classList.add('is-leaving');
      });
      root.querySelector('[data-wiedza]')?.addEventListener('click', (e) => e.preventDefault());
    };
    wire();
  },
};
