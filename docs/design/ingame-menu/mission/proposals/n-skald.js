// N · Głos skalda: the briefing is heard first and read along. A narration player leads the window,
// the sentence being spoken is highlighted in the text and the text scrolls with it (karaoke). A page
// without a recording keeps the same layout: the highlight then follows the reader's own scroll.
// The mockup simulates the voice with a timer; in the game the recording's cue points drive it.

const CHARS_PER_SECOND = 15; // reading pace of the simulated voice at 1×
const SENTENCE_PAUSE = 0.5; // s between sentences
const SPEEDS = [1, 1.25, 1.5];
const WAVE_BARS = 84;
const THUMB_BARS = 22;
const READING_LINE = 0.36; // share of the text viewport's height where the spoken line sits
const SCROLL_PX_PER_SECOND = 26; // "przewijaj samoczynnie" for a page without a recording, at 1×
const TICK_MS = 100;
const SMALL_PICTURE = 200;
const LONG_TITLE = 26; // characters: a longer chapter title gets the smaller heading size
const TASK_RESUME = 0.38; // the task view reopens where the player stopped listening
const UNVOICED_MAPS = new Set(['cn_0']); // in this mockup cn_0 has no recordings

const SKALD_ART = '/mission-review/art/n-skald.png';

const PLAY = '<svg aria-hidden="true" class="on-glyph ns-solid" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
const PAUSE = '<svg aria-hidden="true" class="on-glyph ns-solid" viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
const REPLAY = '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"/></svg>';
const SPEAKER = '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
const MUTED = '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m16.5 9.5 5 5M21.5 9.5l-5 5"/></svg>';
const CHECK = '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

const hasVoice = (map) => !UNVOICED_MAPS.has(map);

const splitSentences = (text) =>
  text
    .split(/\n+|(?<=[.!?…]["”']?)\s+(?=\S)/u)
    .map((t) => t.trim())
    .filter((t) => t !== '');

/** "Name: text" is a speaker only when every word of the name is capitalised ("Było nas trzech: ..."
 *  is narration). A portrait line has no name and always counts. */
const isSpeaker = (name) => name === null || name.split(/\s+/).every((w) => /^\p{Lu}/u.test(w));

/** The page as reading blocks, with every sentence numbered and timed for the simulated voice. */
function scriptOf(page) {
  const blocks = [];
  const sentences = [];
  let t = 0;
  const take = (text) =>
    splitSentences(text).map((part) => {
      const s = { i: sentences.length, text: part, start: t };
      t += part.length / CHARS_PER_SECOND + SENTENCE_PAUSE;
      s.end = t;
      sentences.push(s);
      return s;
    });
  for (const seg of page.segments) {
    if (seg.kind === 'para') blocks.push({ kind: 'para', sentences: take(seg.text) });
    else if (seg.kind === 'speech' && !isSpeaker(seg.speaker)) blocks.push({ kind: 'para', sentences: take(`${seg.speaker}: ${seg.text}`) });
    else if (seg.kind === 'speech') blocks.push({ kind: 'speech', speaker: seg.speaker, portrait: seg.portrait ?? null, sentences: take(seg.text) });
    else if (seg.kind === 'heading') blocks.push({ kind: 'heading', sentences: take(seg.text) });
    else if (seg.kind === 'picture' || seg.kind === 'mapview') blocks.push({ ...seg, at: sentences.length });
    else if (seg.kind === 'signature') blocks.push({ kind: 'signature', text: seg.text });
  }
  return { blocks, sentences, duration: Math.max(t, 1) };
}

const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Deterministic bar heights, so a chapter's "waveform" is its own and stays put between renders. */
function waveHeights(seed, n) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Array.from({ length: n }, (_, i) => {
    h = Math.imul(h ^ (h >>> 13), 1274126177) ^ i;
    const r = ((h >>> 0) % 1000) / 1000;
    const swell = 0.55 + 0.45 * Math.sin((i / n) * Math.PI * 3 + seed.length);
    return Math.round(22 + 78 * r * swell);
  });
}

function sentenceSpans(lib, list) {
  return list.map((s) => `<span class="ns-s" data-s="${s.i}">${lib.esc(s.text)}</span>`).join(' ');
}

function mediaHtml(lib, map, block, compact) {
  if (block.kind === 'mapview') {
    const [w, h] = compact ? [160, 96] : [280, 150];
    return `<figure class="ns-map" data-at="${block.at}"><button type="button" class="ns-map__view" style="${lib.mapViewStyle(map, block.icon, w, h)}" aria-label="Pokaż na mapie"></button><figcaption>${lib.GLYPH.pin}Pokaż na mapie</figcaption></figure>`;
  }
  const small = block.width <= SMALL_PICTURE;
  const w = small ? Math.round(block.width * (compact ? 0.9 : 1.1)) : compact ? 168 : 260;
  return `<figure class="ns-pic${small ? ' ns-pic--portrait' : ''}" data-at="${block.at}"><img src="${block.src}" alt="" style="width:${w}px"></figure>`;
}

/** The text column. Media stay in the flow only as small markers; the margin shows the pictures. */
function textHtml(lib, map, script) {
  return script.blocks
    .map((b) => {
      if (b.kind === 'para') return `<p class="ns-p">${sentenceSpans(lib, b.sentences)}</p>`;
      if (b.kind === 'heading') return `<h4 class="ns-h">${sentenceSpans(lib, b.sentences)}</h4>`;
      if (b.kind === 'speech') {
        const who = b.portrait
          ? `<span class="ns-who ns-who--pic"><img src="${b.portrait}" alt=""></span>`
          : `<span class="ns-who">${lib.esc(b.speaker)}</span>`;
        return `<p class="ns-p ns-p--speech">${who}<span class="ns-said">${sentenceSpans(lib, b.sentences)}</span></p>`;
      }
      if (b.kind === 'mapview') return `<button type="button" class="ns-marker" data-at="${b.at}">${lib.GLYPH.pin}<span>Widok na mapie</span></button>`;
      if (b.kind === 'picture') return '';
      if (b.kind === 'signature') return `<p class="ns-sign">${lib.esc(b.text)}</p>`;
      return '';
    })
    .join('');
}

function marginHtml(lib, map, script, compact) {
  const media = script.blocks.filter((b) => b.kind === 'picture' || b.kind === 'mapview');
  if (media.length === 0) return '';
  return `<div class="ns-margin__media">${media.map((b) => mediaHtml(lib, map, b, compact)).join('')}</div>`;
}

function waveHtml(ctx, st) {
  return `<div class="ns-wave" data-wave role="slider" aria-label="Postęp narracji" tabindex="0">${waveHeights(String(ctx.mission.name.pol) + st.page, WAVE_BARS)
    .map((h) => `<i style="height:${h}%"></i>`)
    .join('')}</div>`;
}

const speedHtml = (st) => `<button type="button" class="ns-chip" data-speed aria-label="Tempo">${String(SPEEDS[st.speed]).replace('.', ',')}×</button>`;
const autoHtml = (st) =>
  `<button type="button" class="ns-toggle" data-auto aria-pressed="${st.auto}"><span class="ns-toggle__knob"></span>${st.voiced ? 'Czytaj automatycznie' : 'Przewijaj samoczynnie'}</button>`;
const eqHtml = (on) => `<span class="ns-eq${on ? ' is-on' : ''}"><i></i><i></i><i></i><i></i></span>`;

/** The progress line: the waveform for a recording, the share read for a page without one. */
function progressHtml(ctx, st, script) {
  return st.voiced
    ? `${waveHtml(ctx, st)}<p class="ns-time"><span data-time>${clock(st.t)}</span><span>${clock(script.duration / SPEEDS[st.speed])}</span></p>`
    : `<div class="ns-read" data-read><i data-read-fill></i></div><p class="ns-time"><span data-time>0% przeczytane</span><span>ok. ${clock(script.duration)} czytania</span></p>`;
}

const playButton = (st, cls = '') =>
  st.voiced
    ? `<button type="button" class="on-medallion ns-play ${cls}" data-play aria-label="${st.playing ? 'Wstrzymaj' : 'Odtwórz'}">${st.playing ? PAUSE : PLAY}</button>`
    : `<span class="ns-play ns-play--none ${cls}" role="img" aria-label="Bez nagrania">${MUTED}</span>`;

const statusText = (st) => (st.voiced ? (st.playing ? 'Skald opowiada' : 'Wstrzymano') : 'Bez nagrania');

/** The arrival's dock under the text: the player and the one way back to the game. */
function dockHtml(ctx, st, script) {
  return `<div class="ns-dock${st.voiced ? '' : ' is-silent'}">
    ${playButton(st, 'ns-play--lg')}
    <div class="ns-dock__track"><p class="ns-status">${st.voiced ? eqHtml(st.playing) : ''}<span data-status>${statusText(st)}</span>${
      st.voiced ? '' : '<span class="ns-status__hint">podświetlenie idzie za twoim czytaniem</span>'
    }</p>${progressHtml(ctx, st, script)}</div>
    <div class="ns-tools">${st.voiced ? `<button type="button" class="ns-icon" data-replay aria-label="Od początku">${REPLAY}</button>` : ''}${speedHtml(st)}${autoHtml(st)}</div>
    <button type="button" class="on-button ns-resume" data-resume>${PLAY}<span>Wróć do gry</span></button>
  </div>`;
}

/** The window's left rail: the skald, the chapter, the player. */
function railHtml(ctx, st, script) {
  const { lib, pages } = ctx;
  const page = pages[st.page];
  return `<aside class="ns-rail${st.voiced ? '' : ' is-silent'}">
    <span class="ns-rail__art"><img src="${SKALD_ART}" alt="">${st.voiced ? eqHtml(st.playing) : ''}</span>
    <div class="ns-rail__chapter">
      <button type="button" class="on-medallion ns-step" data-page="${st.page - 1}" ${st.page === 0 ? 'disabled' : ''} aria-label="Poprzedni rozdział">${lib.GLYPH.back}</button>
      <p class="ns-kicker">Rozdział ${st.page + 1} z ${pages.length}</p>
      <button type="button" class="on-medallion ns-step" data-page="${st.page + 1}" ${st.page >= pages.length - 1 ? 'disabled' : ''} aria-label="Następny rozdział">${lib.GLYPH.next}</button>
    </div>
    <h3 class="ns-rail__title">${lib.esc(page.title)}</h3>
    <p class="ns-rail__meta">otrzymany ${lib.receivedAt(st.page)} · <span data-status>${statusText(st)}</span></p>
    <div class="ns-rail__controls">${st.voiced ? `<button type="button" class="ns-icon" data-replay aria-label="Od początku">${REPLAY}</button>` : '<span class="ns-icon"></span>'}${playButton(st)}${speedHtml(st)}</div>
    ${progressHtml(ctx, st, script)}
    ${autoHtml(st)}
  </aside>`;
}

// ---------- arrival ----------

function arrivalHtml(ctx, st) {
  const { lib, map, mission, page, pageIndex } = ctx;
  const script = scriptOf(page);
  return `<div class="ns-app ns-arrival">
    <div class="ns-veil"></div>
    <header class="ns-arrival__head"><p class="ns-kicker">Nowy rozdział ${pageIndex + 1} · ${lib.esc(lib.missionName(mission))}</p><h2${page.title.length > LONG_TITLE ? ' class="is-long"' : ''}>${lib.esc(page.title)}</h2></header>
    <p class="ns-paused">${PAUSE}<span>Gra wstrzymana</span></p>
    <figure class="ns-skald${st.voiced ? '' : ' ns-skald--quiet'}"><img src="${SKALD_ART}" alt=""><figcaption>${st.voiced ? 'Opowiada skald' : 'Ta strona nie ma nagrania'}</figcaption></figure>
    <div class="ns-text ns-text--dark" data-text>${textHtml(lib, map, script)}<div class="ns-text__tail"></div></div>
    <aside class="ns-margin ns-margin--arrival">${marginHtml(lib, map, script, false)}</aside>
    ${dockHtml(ctx, st, script)}
  </div>`;
}

// ---------- window ----------

function tabsHtml(ctx, tab) {
  const done = ctx.goals.filter((g) => g.state === 'done').length;
  const tabs = [
    ['story', 'Opowieść', ''],
    ['goals', 'Cele', `<span class="on-tab__count">${done} / ${ctx.goals.length}</span>`],
    ['saga', 'Saga', `<span class="on-tab__count">${ctx.pages.length}</span>`],
  ];
  return `<div class="on-tabs ns-tabs" role="tablist">${tabs
    .map(([id, label, count]) => `<button type="button" class="on-tab" role="tab" data-tab="${id}" aria-selected="${tab === id}">${label}${count}</button>`)
    .join('')}<p class="ns-running"><i></i>Gra toczy się dalej</p></div>`;
}

function storyHtml(ctx, st) {
  const { lib, map, pages } = ctx;
  const script = scriptOf(pages[st.page]);
  const margin = marginHtml(lib, map, script, true);
  return `<div class="ns-story">${railHtml(ctx, st, script)}
    <div class="on-parchment ns-sheet${margin ? '' : ' ns-sheet--plain'}">
      <div class="ns-text ns-text--paper" data-text>${textHtml(lib, map, script)}<div class="ns-text__tail"></div></div>
      ${margin ? `<aside class="ns-margin">${margin}</aside>` : ''}
    </div></div>`;
}

function goalsHtml(ctx) {
  const { lib, goals } = ctx;
  const done = goals.filter((g) => g.state === 'done').length;
  const order = { open: 0, done: 1, idle: 2 };
  const rows = [...goals]
    .sort((a, b) => order[a.state] - order[b.state])
    .map(
      (g, i) => `<li class="ns-goal ns-goal--${g.state}${g.emphasis ? ' ns-goal--main' : ''}">
        <span class="on-seal ns-goal__seal" role="img" aria-label="${{ done: 'Wykonany', open: 'Aktywny', idle: 'Jeszcze nieaktywny' }[g.state]}">${g.state === 'done' ? CHECK : ''}</span>
        <span class="ns-goal__text">${g.emphasis ? '<b class="ns-goal__main">Cel główny</b>' : ''}${lib.esc(lib.goalText(g))}</span>
        <span class="ns-goal__state">${{ done: 'wykonany', open: 'do zrobienia', idle: 'wkrótce' }[g.state]}</span>
        ${g.state === 'idle' ? '' : `<button type="button" class="ns-icon ns-goal__say" data-say="${i}" aria-label="Odsłuchaj cel">${SPEAKER}</button>`}
      </li>`,
    )
    .join('');
  const runes = goals.map((g) => `<i class="ns-runes__bar ns-runes__bar--${g.state}"></i>`).join('');
  return `<div class="on-parchment ns-goals">
    <div class="ns-goals__head"><div class="ns-runes">${runes}</div><p class="ns-goals__count"><b>${done}</b> z ${goals.length} celów wykonanych</p>
      <button type="button" class="on-button on-button--rounded ns-sayall" data-sayall>${SPEAKER}<span>Odczytaj cele</span></button></div>
    <ul class="ns-goallist">${rows}</ul>
  </div>`;
}

function sagaHtml(ctx, st) {
  const { lib, pages, map } = ctx;
  const voiced = hasVoice(map);
  let total = 0;
  const rows = pages
    .map((page, i) => {
      const script = scriptOf(page);
      total += script.duration;
      const thumb = waveHeights(String(ctx.mission.name.pol) + i, THUMB_BARS)
        .map((h) => `<i style="height:${h}%"></i>`)
        .join('');
      return `<li class="ns-track-row${i === pages.length - 1 ? ' is-latest' : ''}${i === st.page ? ' is-current' : ''}">
        <span class="ns-track-row__no">${i + 1}</span>
        <div class="ns-track-row__body"><h4>${lib.esc(page.title)}</h4><p>otrzymany ${lib.receivedAt(i)}${i === pages.length - 1 ? ' · <b>najnowszy</b>' : ''}</p></div>
        <span class="ns-thumb${voiced ? '' : ' ns-thumb--none'}" aria-hidden="true">${voiced ? thumb : ''}</span>
        <span class="ns-track-row__len">${voiced ? clock(script.duration) : 'bez nagrania'}</span>
        <button type="button" class="on-medallion ns-track-row__play" data-listen="${i}" aria-label="${voiced ? 'Posłuchaj' : 'Czytaj'}">${voiced ? PLAY : lib.GLYPH.next}</button>
      </li>`;
    })
    .join('');
  return `<div class="on-parchment ns-saga">
    <div class="ns-saga__head"><div><p class="on-parchment__note">Saga tej misji</p><p class="ns-saga__sum">${pages.length} rozdziałów${voiced ? ` · ${clock(total)} opowieści` : ''}</p></div>
      ${voiced ? `<button type="button" class="on-button on-button--rounded" data-listen="0">${PLAY}<span>Opowiedz od początku</span></button>` : ''}</div>
    <ol class="ns-tracks">${rows}</ol>
    <p class="ns-tables">Tablice historyczne (siedem cudów, mitologia) przeniesione do <button type="button" class="ns-link">Wiedzy ${lib.GLYPH.next}</button></p>
  </div>`;
}

function windowHtml(ctx, st) {
  const { lib, mission } = ctx;
  const body = `${tabsHtml(ctx, st.tab)}<div class="ns-pane">${st.tab === 'story' ? storyHtml(ctx, st) : st.tab === 'goals' ? goalsHtml(ctx) : sagaHtml(ctx, st)}</div>`;
  return `<div class="ns-app">${lib.hudWindow({
    title: 'Misja',
    kicker: lib.missionName(mission),
    art: `<span class="ns-headart" aria-hidden="true"><img src="${SKALD_ART}" alt=""></span>`,
    width: lib.CENTRAL.w,
    cls: 'ns-window',
    style: `left:${lib.CENTRAL.x}px;top:${lib.CENTRAL.y}px;height:${lib.CENTRAL.h}px`,
    body,
  })}</div>`;
}

// ---------- update ----------

function updateHtml(ctx) {
  const { lib, goals, map } = ctx;
  const justDone = goals.filter((g) => g.state === 'done').at(-1);
  const fresh = goals.filter((g) => g.state === 'open').at(-1);
  return `<div class="ns-app ns-update">
    <section class="ns-herald" role="status" aria-label="Zmiana celów">
      <span class="ns-herald__art"><img src="${SKALD_ART}" alt=""><span class="ns-eq is-on"><i></i><i></i><i></i><i></i></span></span>
      <div class="ns-herald__lines">
        ${justDone ? `<p class="ns-herald__done"><span class="on-seal" aria-hidden="true">${CHECK}</span><s>${lib.esc(lib.goalText(justDone))}</s></p>` : ''}
        ${fresh ? `<p class="ns-herald__new"><b>Nowy cel</b> ${lib.esc(lib.goalText(fresh))}</p>` : ''}
      </div>
      ${hasVoice(map) ? `<button type="button" class="on-medallion ns-herald__play" aria-label="Posłuchaj">${PAUSE}</button>` : ''}
      <button type="button" class="ns-icon ns-herald__close" aria-label="Zamknij">${lib.GLYPH.close}</button>
      <i class="ns-herald__timer"></i>
    </section>
    <span class="ns-beambadge" aria-label="Nowy cel w misji">1</span>
  </div>`;
}

// ---------- module ----------

const initialState = (ctx) => {
  const voiced = hasVoice(ctx.map);
  const page = ctx.pages.length - 1;
  const script = scriptOf(ctx.pages[page]);
  const task = ctx.view === 'task';
  return {
    view: ctx.view,
    tab: { goals: 'goals', history: 'saga' }[ctx.view] ?? 'story',
    page,
    voiced,
    playing: voiced && ctx.view === 'arrival',
    auto: voiced || ctx.view === 'arrival',
    scroll: 0,
    speed: 0,
    t: task && voiced ? script.duration * TASK_RESUME : 0,
  };
};

function renderState(ctx, st) {
  if (st.view === 'arrival') return arrivalHtml(ctx, st);
  if (st.view === 'update') return updateHtml(ctx);
  return windowHtml(ctx, st);
}

let timer = 0;

export default {
  id: 'n',
  name: 'Głos skalda',
  blurb:
    'Briefing się słucha: na górze odtwarzacz narracji (duży przycisk, pasek fali, tempo, „Czytaj automatycznie”), a w tekście podświetla się zdanie, które właśnie pada, i tekst sam za nim przewija. Strona bez nagrania ma ten sam układ, tylko podświetlenie idzie za przewijaniem gracza; ilustracje i widoki mapy stoją na marginesie i zapalają się, gdy opowieść do nich dojdzie.',
  css: 'n-skald.css',
  views: ['arrival', 'task', 'goals', 'history', 'update'],
  render(ctx) {
    return renderState(ctx, initialState(ctx));
  },
  mount(root, ctx) {
    clearInterval(timer);
    const st = initialState(ctx);
    let script = scriptOf(ctx.pages[st.page]);
    let spoken = -1;

    const draw = () => {
      const app = root.querySelector('.ns-app');
      if (app === null) return;
      app.outerHTML = renderState(ctx, st);
      script = scriptOf(st.view === 'arrival' ? ctx.page : ctx.pages[st.page]);
      spoken = -1;
      wire();
    };

    /** Lights sentence `k`, dims what came before, and lights the margin media reached so far. */
    const light = (k, follow) => {
      const text = root.querySelector('[data-text]');
      if (text === null || k === spoken) return;
      const first = spoken === -1;
      spoken = k;
      for (const el of text.querySelectorAll('.ns-s')) {
        const i = Number(el.dataset.s);
        el.classList.toggle('is-now', i === k);
        el.classList.toggle('is-past', i < k);
      }
      for (const el of root.querySelectorAll('[data-at]')) el.classList.toggle('is-reached', Number(el.dataset.at) <= k);
      const reached = [...root.querySelectorAll('.ns-margin [data-at].is-reached')].at(-1);
      reached?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const now = text.querySelector('.ns-s.is-now');
      if (follow && now !== null) {
        const top = now.offsetTop - text.clientHeight * READING_LINE;
        text.scrollTo({ top: Math.max(0, top), behavior: first ? 'instant' : 'smooth' });
      }
    };

    const syncPlayer = () => {
      const speed = SPEEDS[st.speed];
      const frac = Math.min(1, st.t / script.duration);
      const bars = root.querySelectorAll('[data-wave] i');
      bars.forEach((b, i) => b.classList.toggle('is-past', i / bars.length < frac));
      const time = root.querySelector('[data-time]');
      if (time && st.voiced) time.textContent = clock(st.t / speed);
      const k = script.sentences.findIndex((s) => st.t < s.end);
      light(k === -1 ? script.sentences.length - 1 : k, true);
    };

    const setPlaying = (on) => {
      st.playing = on;
      const b = root.querySelector('[data-play]');
      if (b) {
        b.innerHTML = on ? PAUSE : PLAY;
        b.setAttribute('aria-label', on ? 'Wstrzymaj' : 'Odtwórz');
      }
      root.querySelectorAll('.ns-eq').forEach((el) => el.classList.toggle('is-on', on));
      const status = root.querySelector('[data-status]');
      if (status && st.voiced) status.textContent = on ? 'Skald opowiada' : st.t >= script.duration ? 'Koniec rozdziału' : 'Wstrzymano';
      root.querySelector('.ns-skald')?.classList.toggle('is-telling', on);
    };

    const wire = () => {
      const text = root.querySelector('[data-text]');
      root.querySelector('[data-play]')?.addEventListener('click', () => {
        if (st.t >= script.duration) st.t = 0;
        setPlaying(!st.playing);
      });
      root.querySelector('[data-replay]')?.addEventListener('click', () => {
        st.t = 0;
        setPlaying(true);
        syncPlayer();
      });
      const speedBtn = root.querySelector('[data-speed]');
      speedBtn?.addEventListener('click', () => {
        st.speed = (st.speed + 1) % SPEEDS.length;
        speedBtn.textContent = `${String(SPEEDS[st.speed]).replace('.', ',')}×`;
        syncPlayer();
      });
      const autoBtn = root.querySelector('[data-auto]');
      autoBtn?.addEventListener('click', () => {
        st.auto = !st.auto;
        autoBtn.setAttribute('aria-pressed', String(st.auto));
      });
      const wave = root.querySelector('[data-wave]');
      wave?.addEventListener('click', (e) => {
        const r = wave.getBoundingClientRect();
        st.t = ((e.clientX - r.left) / r.width) * script.duration;
        syncPlayer();
      });
      root.querySelectorAll('[data-tab]').forEach((b) =>
        b.addEventListener('click', () => {
          st.tab = b.dataset.tab;
          draw();
        }),
      );
      root.querySelectorAll('[data-page]').forEach((b) =>
        b.addEventListener('click', () => {
          st.page = Math.max(0, Math.min(ctx.pages.length - 1, Number(b.dataset.page)));
          st.t = 0;
          st.playing = false;
          draw();
        }),
      );
      root.querySelectorAll('[data-listen]').forEach((b) =>
        b.addEventListener('click', () => {
          st.page = Number(b.dataset.listen);
          st.tab = 'story';
          st.t = 0;
          st.playing = st.voiced;
          draw();
        }),
      );
      root.querySelectorAll('[data-say], [data-sayall]').forEach((b) =>
        b.addEventListener('click', () => {
          root.querySelectorAll('.is-saying').forEach((el) => el.classList.remove('is-saying'));
          (b.closest('.ns-goal') ?? b).classList.add('is-saying');
        }),
      );
      root.querySelector('[data-resume]')?.addEventListener('click', () => {
        clearInterval(timer);
        root.querySelector('.ns-app').outerHTML = '<div class="ns-app"></div>';
      });
      root.querySelectorAll('.on-window__close, .ns-herald__close').forEach((b) =>
        b.addEventListener('click', () => {
          st.view = st.view === 'update' ? 'closed' : 'update';
          if (st.view === 'closed') root.querySelector('.ns-app').outerHTML = '<div class="ns-app"></div>';
          else draw();
        }),
      );
      if (text === null) return;
      if (st.voiced) {
        syncPlayer();
      } else {
        const follow = () => {
          const top = text.scrollTop + text.clientHeight * READING_LINE;
          let k = 0;
          for (const el of text.querySelectorAll('.ns-s')) {
            if (el.offsetTop <= top) k = Number(el.dataset.s);
            else break;
          }
          light(k, false);
          const max = text.scrollHeight - text.clientHeight;
          const frac = max > 0 ? text.scrollTop / max : 1;
          const fill = root.querySelector('[data-read-fill]');
          if (fill) fill.style.width = `${Math.round(frac * 100)}%`;
          const time = root.querySelector('[data-time]');
          if (time) time.textContent = `${Math.round(frac * 100)}% przeczytane`;
        };
        text.addEventListener('scroll', follow, { passive: true });
        follow();
      }
    };

    timer = setInterval(() => {
      if (!root.classList.contains('mp-n') || !document.contains(root)) {
        clearInterval(timer);
        return;
      }
      if (root.querySelector('[data-text]') === null) return;
      if (st.voiced && st.playing) {
        st.t += (TICK_MS / 1000) * SPEEDS[st.speed];
        if (st.t >= script.duration) {
          st.t = script.duration;
          setPlaying(false);
        }
        syncPlayer();
      } else if (!st.voiced && st.auto) {
        const text = root.querySelector('[data-text]');
        st.scroll = Math.max(st.scroll, text.scrollTop) + (SCROLL_PX_PER_SECOND * SPEEDS[st.speed] * TICK_MS) / 1000;
        text.scrollTop = st.scroll;
      }
    }, TICK_MS);

    wire();
    setPlaying(st.playing);
    // The review harness swaps the stylesheet as it mounts; re-seat the reading line once it applies.
    for (const ms of [250, 700]) {
      setTimeout(() => {
        spoken = -1;
        if (st.voiced) syncPlayer();
        else root.querySelector('[data-text]')?.dispatchEvent(new Event('scroll'));
      }, ms);
    }
  },
};
