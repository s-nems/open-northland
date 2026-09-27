// D · Rozmowa: the briefing as a conversation. Speakers stand at the sides as large portraits (the
// page's sepia picture, or a bronze medallion with the initial), their lines form a thread of bubbles
// on alternating sides, narration runs as full-width parchment captions between them. The mission's
// hero (the speaker heard most across the mission) always stands on the right.

const HINT_SPEAKERS = new Set(['Wskazówka', 'Porada', 'Hint', 'Tip']);
const SMALL_PICTURE = 200; // px: a picture this narrow is a head portrait, wider ones are scenes
const HERO_SIDE = 'right';
const OTHER_SIDE = 'left';
const QUOTE_KEY = 'quote';
const CAST_SHOWN = 4;
const LONG_TITLE = 26; // characters: a longer chapter title gets the smaller heading size

const PLAY = '<svg aria-hidden="true" class="on-glyph dn-solid" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
const PAUSE = '<svg aria-hidden="true" class="on-glyph dn-solid" viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
const REPLAY = '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"/></svg>';
const CHECK = '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const BUBBLE = '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 5h16v11H10l-4 4v-4H4z"/></svg>';

const heroCache = new Map();

const keyOf = (s) => s.speaker ?? s.portrait ?? QUOTE_KEY;

/** A "Name: text" match only counts as a speaker when every word of the name is capitalised, so a
 *  narration opening like "Było nas trzech: ..." stays narration. */
const isRealSpeaker = (s) =>
  s.kind === 'speech' && (s.speaker === null || (!HINT_SPEAKERS.has(s.speaker) && s.speaker.split(/\s+/).every((w) => /^\p{Lu}/u.test(w))));

/** Reads the analysed segments into conversation beats. A narrated paragraph that opens with a
 *  quotation keeps its caption but gets the quote style. */
function beatsOf(page, hero) {
  const beats = [];
  for (const s of page.segments) {
    if (s.kind === 'speech' && isRealSpeaker(s)) {
      const key = keyOf(s);
      beats.push({ type: 'line', key, name: s.speaker, portrait: s.portrait ?? null, text: s.text, side: key === hero ? HERO_SIDE : OTHER_SIDE });
    } else if (s.kind === 'speech' && HINT_SPEAKERS.has(s.speaker)) {
      beats.push({ type: 'caption', kicker: s.speaker, text: s.text });
    } else if (s.kind === 'speech') {
      beats.push({ type: 'caption', kicker: null, text: `${s.speaker}: ${s.text}` });
    } else if (s.kind === 'para' || s.kind === 'heading') {
      const quote = s.kind === 'para' && /^-?\s*["„]/.test(s.text);
      beats.push({ type: 'caption', kicker: s.kind === 'heading' ? s.text : null, text: s.kind === 'para' ? s.text.replace(/^-\s*/, '') : '', quote });
    } else if (s.kind === 'picture') {
      beats.push({ type: 'scene', src: s.src, width: s.width, height: s.height });
    } else if (s.kind === 'mapview') {
      beats.push({ type: 'map', icon: s.icon });
    } else if (s.kind === 'signature') {
      const last = beats.at(-1);
      if (last?.type === 'signature') last.lines.push(s.text);
      else beats.push({ type: 'signature', lines: [s.text] });
    }
  }
  return beats;
}

/** The mission's hero: the speaker with the most lines over every briefing page. */
function heroOf(lib, mission) {
  const cached = heroCache.get(mission);
  if (cached !== undefined) return cached;
  const counts = new Map();
  for (const raw of mission.pages) {
    for (const s of lib.analysePage(raw).segments) {
      if (isRealSpeaker(s)) counts.set(keyOf(s), (counts.get(keyOf(s)) ?? 0) + 1);
    }
  }
  const hero = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  heroCache.set(mission, hero);
  return hero;
}

/** Everyone who speaks on the page, per side, most lines first. */
function castOf(beats) {
  const cast = new Map();
  for (const b of beats) {
    if (b.type !== 'line') continue;
    const c = cast.get(b.key) ?? { key: b.key, name: b.name, portrait: b.portrait, side: b.side, lines: 0 };
    c.lines += 1;
    cast.set(b.key, c);
  }
  return [...cast.values()].sort((a, b) => b.lines - a.lines);
}

const initial = (name) => (name ? [...name.trim()][0].toUpperCase() : '„');

/** Stands in for the hero on a mission told without dialogue: the chronicler's quill. */
const narrator = (lib) => ({ name: null, portrait: null, glyph: lib.GLYPH.pen });

function avatar(lib, who, cls = '') {
  if (who.glyph) return `<span class="dn-avatar dn-avatar--seal dn-avatar--glyph ${cls}" aria-hidden="true">${who.glyph}</span>`;
  return who.portrait
    ? `<span class="dn-avatar dn-avatar--pic ${cls}"><img src="${who.portrait}" alt=""></span>`
    : `<span class="dn-avatar dn-avatar--seal ${cls}" aria-hidden="true">${lib.esc(initial(who.name))}</span>`;
}

function stand(lib, who, side, active) {
  if (!who) return `<div class="dn-stand dn-stand--${side} dn-stand--empty"></div>`;
  const figure = who.glyph
    ? `<div class="dn-stand__frame dn-stand__frame--seal dn-stand__frame--glyph" aria-hidden="true"><span class="dn-stand__face">${who.glyph}</span></div>`
    : who.portrait
    ? `<div class="dn-stand__frame dn-stand__frame--pic"><span class="dn-stand__face"><img src="${who.portrait}" alt=""></span></div>`
    : `<div class="dn-stand__frame dn-stand__frame--seal" aria-hidden="true"><span class="dn-stand__face"><span>${lib.esc(initial(who.name))}</span></span></div>`;
  return `<div class="dn-stand dn-stand--${side}${active ? ' is-speaking' : ''}" data-stand="${side}">${figure}${
    who.name ? `<p class="dn-stand__name">${lib.esc(who.name)}</p>` : ''
  }</div>`;
}

const textHtml = (lib, text) => lib.esc(text).replace(/\n/g, '<br>');

function beatHtml(lib, map, beat, i, state) {
  const cls = `dn-beat${state ? ` is-${state}` : ''}`;
  switch (beat.type) {
    case 'line':
      return `<article class="${cls} dn-line dn-line--${beat.side}" data-beat="${i}">${avatar(lib, beat)}<div class="dn-bubble">${
        beat.name ? `<p class="dn-bubble__name">${lib.esc(beat.name)}</p>` : ''
      }<p class="dn-bubble__text">${textHtml(lib, beat.text)}</p></div></article>`;
    case 'caption':
      return `<div class="${cls} dn-caption${beat.kicker && beat.text ? ' dn-caption--hint' : ''}${beat.quote ? ' dn-caption--quote' : ''}" data-beat="${i}">${
        beat.kicker ? `<p class="dn-caption__kicker">${lib.esc(beat.kicker)}</p>` : ''
      }${beat.text ? `<p class="dn-caption__text">${textHtml(lib, beat.text)}</p>` : ''}</div>`;
    case 'scene': {
      const w = Math.min(beat.width * (beat.width <= SMALL_PICTURE ? 1.2 : 0.7), 250);
      return `<figure class="${cls} dn-scene" data-beat="${i}"><img src="${beat.src}" alt="" style="width:${Math.round(w)}px"></figure>`;
    }
    case 'map':
      return `<figure class="${cls} dn-map" data-beat="${i}"><button type="button" class="dn-map__view" style="${lib.mapViewStyle(map, beat.icon, 300, 132)}" aria-label="Pokaż na mapie"></button><figcaption>${
        lib.GLYPH.pin
      }<span>Pokaż na mapie</span></figcaption></figure>`;
    case 'signature':
      return `<p class="${cls} dn-signature" data-beat="${i}">${beat.lines.map((l) => lib.esc(l)).join(' · ')}</p>`;
    default:
      return '';
  }
}

/** Beats shown at one reveal step: a picture, world view or signature travels with the next line. */
function revealEnds(beats) {
  const ends = [];
  beats.forEach((b, i) => {
    if (b.type === 'line' || b.type === 'caption') ends.push(i);
  });
  if (ends.length === 0 || ends.at(-1) !== beats.length - 1) ends.push(beats.length - 1);
  return ends.filter((e) => e >= 0);
}

function narration(voiced) {
  return voiced
    ? `<div class="dn-voice" data-voice><button type="button" class="on-medallion dn-voice__play" data-voice-toggle aria-label="Odtwórz narrację">${PLAY}</button><button type="button" class="dn-voice__replay" data-voice-replay aria-label="Od początku">${REPLAY}</button><span class="dn-voice__label">Narracja</span></div>`
    : '';
}

// ---------- arrival: the story moment ----------

function arrivalHtml(ctx, s) {
  const { lib, map, mission, page, pageIndex } = ctx;
  const hero = heroOf(lib, mission);
  const beats = beatsOf(page, hero);
  const ends = revealEnds(beats);
  const step = Math.min(s.step, ends.length - 1);
  const shownTo = ends[step] ?? -1;
  const cast = castOf(beats);
  const talky = cast.length > 0;
  const lastLine = beats.slice(0, shownTo + 1).filter((b) => b.type === 'line').at(-1);
  const current = beats[shownTo];
  const speakerOn = (side) => {
    const seen = beats.slice(0, shownTo + 1).filter((b) => b.type === 'line' && b.side === side).at(-1);
    return seen ?? cast.find((c) => c.side === side) ?? null;
  };
  const thread = beats
    .slice(0, shownTo + 1)
    .map((b, i) => beatHtml(lib, map, b, i, i === shownTo || (i > ends[step - 1] && i <= shownTo) ? 'new' : 'old'))
    .join('');
  const last = step >= ends.length - 1;
  const dots = ends.length <= 24 ? ends.map((_, i) => `<i class="${i <= step ? 'is-on' : ''}"></i>`).join('') : '';
  return `<div class="dn-app dn-arrival${talky ? '' : ' dn-arrival--narration'}">
    <div class="dn-veil"></div>
    <header class="dn-arrival__head">
      <p class="dn-kicker">Nowy rozdział · ${pageIndex + 1} · ${lib.esc(lib.missionName(mission))}</p>
      <h2 class="dn-arrival__title${page.title.length > LONG_TITLE ? ' is-long' : ''}">${lib.esc(page.title)}</h2>
    </header>
    <p class="dn-paused">${PAUSE}<span>Gra wstrzymana</span></p>
    ${talky ? stand(lib, speakerOn(OTHER_SIDE), OTHER_SIDE, current?.type === 'line' && lastLine?.side === OTHER_SIDE) : ''}
    ${talky ? stand(lib, speakerOn(HERO_SIDE), HERO_SIDE, current?.type === 'line' && lastLine?.side === HERO_SIDE) : ''}
    <div class="dn-thread dn-thread--arrival" data-thread>${thread}</div>
    <footer class="dn-arrival__controls">
      ${narration(s.voiced)}
      <div class="dn-progress"><span class="dn-progress__dots">${dots}</span><span class="dn-progress__count">${step + 1} / ${ends.length}</span></div>
      ${last ? '' : '<button type="button" class="dn-skip" data-skip>Pokaż całość</button>'}
      <button type="button" class="on-button dn-next" data-next>${last ? `${PLAY}<span>Wróć do gry</span>` : `<span>Dalej</span>${lib.GLYPH.next}`}</button>
    </footer>
  </div>`;
}

// ---------- the window: conversation, goals, journal ----------

function goalsDone(goals) {
  return goals.filter((g) => g.state === 'done').length;
}

function tabsHtml(ctx, tab) {
  const done = goalsDone(ctx.goals);
  const tabs = [
    ['talk', 'Rozmowa', ''],
    ['goals', 'Cele', `<span class="on-tab__count">${done} / ${ctx.goals.length}</span>`],
    ['history', 'Dziennik', `<span class="on-tab__count">${ctx.pages.length}</span>`],
  ];
  return `<div class="on-tabs dn-tabs" role="tablist">${tabs
    .map(([id, label, count]) => `<button type="button" class="on-tab" role="tab" data-tab="${id}" aria-selected="${tab === id}">${label}${count}</button>`)
    .join('')}<p class="dn-running"><i></i>Gra toczy się dalej</p></div>`;
}

function castColumn(lib, cast, side, leadKey = null, speaking = false) {
  const list = cast.filter((c) => c.side === side).sort((a, b) => (b.key === leadKey) - (a.key === leadKey));
  if (list.length === 0) return `<aside class="dn-cast dn-cast--${side}"></aside>`;
  const [lead, ...rest] = list;
  return `<aside class="dn-cast dn-cast--${side}${speaking ? ' is-speaking' : ''}" data-cast="${side}">${stand(lib, lead, side, speaking)}${
    rest.length
      ? `<div class="dn-cast__more">${rest
          .slice(0, CAST_SHOWN)
          .map((c) => `<span class="dn-cast__who">${avatar(lib, c, 'dn-avatar--sm')}<span>${lib.esc(c.name ?? '')}</span></span>`)
          .join('')}</div>`
      : ''
  }</aside>`;
}

function talkHtml(ctx, s) {
  const { lib, map, mission, pages } = ctx;
  const pi = s.page;
  const page = pages[pi];
  const hero = heroOf(lib, mission);
  const beats = beatsOf(page, hero);
  const cast = castOf(beats);
  const talky = cast.length > 0;
  return `<div class="dn-chapter">
      <button type="button" class="on-medallion dn-chapter__step" data-page="${pi - 1}" ${pi === 0 ? 'disabled' : ''} aria-label="Poprzedni rozdział">${lib.GLYPH.back}</button>
      <div class="dn-chapter__label"><p class="dn-kicker">Rozdział ${pi + 1} z ${pages.length} · otrzymany ${lib.receivedAt(pi)}</p><h3>${lib.esc(page.title)}</h3></div>
      <button type="button" class="on-medallion dn-chapter__step" data-page="${pi + 1}" ${pi >= pages.length - 1 ? 'disabled' : ''} aria-label="Następny rozdział">${lib.GLYPH.next}</button>
      ${narration(s.voiced)}
    </div>
    <div class="dn-stage${talky ? '' : ' dn-stage--narration'}">
      ${talky ? castColumn(lib, cast, OTHER_SIDE) : ''}
      <div class="dn-thread" data-thread>${beats.map((b, i) => beatHtml(lib, map, b, i, '')).join('')}</div>
      ${talky ? castColumn(lib, cast, HERO_SIDE) : ''}
    </div>`;
}

function goalsHtml(ctx) {
  const { lib, goals, mission } = ctx;
  const done = goalsDone(goals);
  const heroKey = heroOf(lib, mission);
  const heroBeat = ctx.pages.flatMap((p) => beatsOf(p, heroKey)).find((b) => b.type === 'line' && b.key === heroKey);
  const open = goals.filter((g) => g.state === 'open');
  const group = (state, label) => {
    const list = goals.filter((g) => g.state === state);
    if (list.length === 0) return '';
    return `<p class="on-parchment__note">${label}<span class="on-parchment__count">${list.length}</span></p><ul class="dn-goals">${list
      .map(
        (g) => `<li class="dn-goal dn-goal--${g.state}${g.emphasis ? ' dn-goal--main' : ''}"><span class="on-seal dn-goal__seal" role="img" aria-label="${
          { done: 'Wykonany', open: 'Aktywny', idle: 'Jeszcze nieaktywny' }[g.state]
        }">${g.state === 'done' ? CHECK : ''}</span><span class="dn-goal__text">${g.emphasis ? '<b class="dn-goal__main">Cel główny</b>' : ''}${lib.esc(lib.goalText(g))}</span></li>`,
      )
      .join('')}</ul>`;
  };
  const seals = goals.map((g) => `<i class="dn-meter__seg dn-meter__seg--${g.state}"></i>`).join('');
  const speaker = heroBeat ?? narrator(lib);
  return `<div class="dn-goalview">
    <div class="on-parchment dn-goalbook">
      <div class="dn-meter"><p class="dn-meter__count"><b>${done}</b> / ${goals.length}</p><div><p class="dn-meter__label">Postęp misji</p><div class="dn-meter__bar">${seals}</div></div></div>
      ${group('open', 'Do zrobienia')}${group('done', 'Wykonane')}${group('idle', 'Wkrótce')}
    </div>
    <aside class="dn-goalhero">
      <div class="dn-line dn-line--right dn-line--solo"><div class="dn-bubble"><p class="dn-bubble__name">Teraz najważniejsze</p><p class="dn-bubble__text">${
        open[0] ? lib.esc(lib.goalText(open.find((g) => g.emphasis) ?? open[0])) : 'Wszystkie cele wykonane.'
      }</p></div></div>
      ${stand(lib, speaker, HERO_SIDE, true)}
    </aside>
  </div>`;
}

function historyHtml(ctx, s) {
  const { lib, mission, pages } = ctx;
  const hero = heroOf(lib, mission);
  const rows = pages
    .map((page, i) => {
      const beats = beatsOf(page, hero);
      const cast = castOf(beats);
      const lines = beats.filter((b) => b.type === 'line').length;
      const first = beats.find((b) => b.type === 'line' || (b.type === 'caption' && b.text));
      const faces = cast.length
        ? cast.slice(0, CAST_SHOWN).map((c) => avatar(lib, c, 'dn-avatar--sm')).join('')
        : `<span class="dn-avatar dn-avatar--sm dn-avatar--seal dn-avatar--scroll" aria-hidden="true">${BUBBLE}</span>`;
      return `<li class="dn-entry${i === pages.length - 1 ? ' is-latest' : ''}${i === s.page ? ' is-open' : ''}">
        <span class="dn-entry__faces">${faces}</span>
        <div class="dn-entry__body"><p class="dn-entry__meta">Rozdział ${i + 1} · ${lib.receivedAt(i)} · ${
          lines ? `${lines} wypowiedzi` : 'opowieść'
        }${i === pages.length - 1 ? ' · <b>najnowszy</b>' : ''}</p><h4>${lib.esc(page.title)}</h4><p class="dn-entry__preview">${
          first ? `${first.name ? `<b>${lib.esc(first.name)}:</b> ` : ''}${lib.esc(first.text)}` : ''
        }</p></div>
        <button type="button" class="on-button on-button--rounded dn-entry__open" data-open="${i}">${BUBBLE}<span>Otwórz</span></button>
      </li>`;
    })
    .reverse()
    .join('');
  return `<div class="on-parchment dn-journal"><p class="on-parchment__note">Dziennik rozmów<span class="on-parchment__count">${pages.length}</span></p><ol class="dn-entries">${rows}</ol>
    <p class="dn-tables">Tablice historyczne (siedem cudów, mitologia) są teraz w <button type="button" class="dn-link">Wiedzy ${ctx.lib.GLYPH.next}</button></p></div>`;
}

function windowHtml(ctx, s) {
  const { lib, mission } = ctx;
  const body = `${tabsHtml(ctx, s.tab)}<div class="dn-pane dn-pane--${s.tab}">${
    s.tab === 'talk' ? talkHtml(ctx, s) : s.tab === 'goals' ? goalsHtml(ctx) : historyHtml(ctx, s)
  }</div>`;
  return `<div class="dn-app">${lib.hudWindow({
    title: 'Misja',
    kicker: lib.missionName(mission),
    art: `<span class="dn-headseal" aria-hidden="true">${BUBBLE}</span>`,
    width: lib.CENTRAL.w,
    cls: 'dn-window',
    style: `left:${lib.CENTRAL.x}px;top:${lib.CENTRAL.y}px;height:${lib.CENTRAL.h}px`,
    body,
  })}</div>`;
}

// ---------- update: the window is closed, a goal changed ----------

function updateHtml(ctx) {
  const { lib, goals, mission, pages } = ctx;
  const done = goals.filter((g) => g.state === 'done');
  const justDone = done.at(-1);
  const open = goals.filter((g) => g.state === 'open');
  const fresh = open.at(-1);
  const hero = heroOf(lib, mission);
  const heroBeat = pages.flatMap((p) => beatsOf(p, hero)).find((b) => b.type === 'line' && b.key === hero) ?? narrator(lib);
  const rows = [...(justDone ? [justDone] : []), ...open]
    .map((g) => {
      const state = g === justDone ? 'done' : g === fresh ? 'new' : 'open';
      return `<li class="dn-track__row dn-track__row--${state}"><span class="on-seal dn-goal__seal" role="img" aria-label="${
        state === 'done' ? 'Wykonany' : 'Aktywny'
      }">${state === 'done' ? CHECK : ''}</span><span>${lib.esc(lib.goalText(g))}</span>${state === 'new' ? '<b class="dn-track__tag">Nowy</b>' : ''}</li>`;
    })
    .join('');
  return `<div class="dn-app dn-update"><div class="dn-update__col">
    <section class="dn-track" aria-label="Cele">
      <header class="dn-track__head"><span>Cele</span><b>${done.length} / ${goals.length}</b><button type="button" class="dn-track__fold" aria-label="Zwiń">${lib.GLYPH.down}</button></header>
      <ul>${rows}</ul>
    </section>
    <aside class="dn-remark" role="status">
      ${avatar(lib, heroBeat, 'dn-avatar--lg')}
      <div class="dn-bubble">
        <p class="dn-bubble__name">${justDone ? 'Cel wykonany' : 'Nowy cel'}</p>
        ${justDone ? `<p class="dn-remark__done">${CHECK}<s>${lib.esc(lib.goalText(justDone))}</s></p>` : ''}
        ${fresh ? `<p class="dn-bubble__text"><span class="dn-remark__new">Dalej:</span> ${lib.esc(lib.goalText(fresh))}</p>` : ''}
        <div class="dn-remark__actions"><button type="button" class="on-button on-button--rounded" data-open-mission>${BUBBLE}<span>Otwórz misję</span></button><button type="button" class="dn-skip">Później</button></div>
      </div>
    </aside></div>
    <span class="dn-beambadge" aria-label="Nowy cel w misji">1</span>
  </div>`;
}

// ---------- module ----------

const initialState = (ctx) => ({
  view: ctx.view,
  tab: { goals: 'goals', history: 'history' }[ctx.view] ?? 'talk',
  page: ctx.pages.length - 1,
  step: 0,
  voiced: ctx.pageIndex % 2 === 0,
  playing: false,
});

function renderState(ctx, s) {
  if (s.view === 'arrival') return arrivalHtml(ctx, s);
  if (s.view === 'update') return updateHtml(ctx);
  return windowHtml(ctx, s);
}

let active = null;

export default {
  id: 'd',
  name: 'Rozmowa',
  blurb:
    'Briefing jako rozmowa: mówiący stoją po bokach w dużych portretach (bohater misji zawsze po prawej), kwestie układają się w wątek dymków, narracja w pasach pergaminu. Nowy rozdział odsłania się kwestia po kwestii przyciskiem „Dalej”, a z belki cała rozmowa jest do przewinięcia; długie dialogi czyta się jak czat, a nie ścianę wyśrodkowanego tekstu.',
  css: 'd-dialog.css',
  views: ['arrival', 'task', 'goals', 'history', 'update'],
  render(ctx) {
    return renderState(ctx, initialState(ctx));
  },
  mount(root, ctx) {
    const s = initialState(ctx);
    active = s;
    /** Task view: the stands follow the thread, the speaker of the line at the reading height steps
     *  forward on its side. */
    const followSpeaker = (thread) => {
      const beats = beatsOf(ctx.pages[s.page], heroOf(ctx.lib, ctx.mission));
      const cast = castOf(beats);
      let shown = '';
      const update = () => {
        const mid = thread.getBoundingClientRect().top + thread.clientHeight * 0.4;
        let best = null;
        let bestDist = Infinity;
        for (const el of thread.querySelectorAll('.dn-line[data-beat]')) {
          const r = el.getBoundingClientRect();
          const d = Math.abs((r.top + r.bottom) / 2 - mid);
          if (d < bestDist) {
            bestDist = d;
            best = beats[Number(el.dataset.beat)];
          }
        }
        if (best === null || shown === best.key) return;
        shown = best.key;
        for (const side of [OTHER_SIDE, HERO_SIDE]) {
          const col = root.querySelector(`[data-cast="${side}"]`);
          if (col === null) continue;
          const lead = side === best.side ? best.key : (cast.find((c) => c.side === side)?.key ?? null);
          col.outerHTML = castColumn(ctx.lib, cast, side, lead, side === best.side);
        }
        thread.querySelectorAll('.dn-line').forEach((el) => el.classList.toggle('is-focus', beats[Number(el.dataset.beat)]?.key === best.key));
      };
      thread.addEventListener('scroll', update, { passive: true });
      update();
    };
    const draw = () => {
      if (active !== s) return;
      const app = root.querySelector('.dn-app');
      if (app === null) return;
      app.outerHTML = renderState(ctx, s);
      wire();
    };
    const wire = () => {
      const thread = root.querySelector('[data-thread]');
      if (thread !== null && s.view === 'arrival') thread.scrollTop = thread.scrollHeight;
      if (thread !== null && s.view !== 'arrival' && root.querySelector('[data-cast]') !== null) followSpeaker(thread);
      root.querySelector('[data-next]')?.addEventListener('click', () => {
        const ends = revealEnds(beatsOf(ctx.page, heroOf(ctx.lib, ctx.mission)));
        if (s.step >= ends.length - 1) {
          s.view = 'closed';
          root.querySelector('.dn-app').outerHTML = '<div class="dn-app"></div>';
          return;
        }
        s.step += 1;
        draw();
      });
      root.querySelector('[data-skip]')?.addEventListener('click', () => {
        s.step = Number.MAX_SAFE_INTEGER;
        draw();
      });
      root.querySelectorAll('[data-tab]').forEach((b) =>
        b.addEventListener('click', () => {
          s.tab = b.dataset.tab;
          draw();
        }),
      );
      root.querySelectorAll('[data-page]').forEach((b) =>
        b.addEventListener('click', () => {
          s.page = Math.max(0, Math.min(ctx.pages.length - 1, Number(b.dataset.page)));
          s.voiced = s.page % 2 === 0;
          draw();
        }),
      );
      root.querySelectorAll('[data-open]').forEach((b) =>
        b.addEventListener('click', () => {
          s.page = Number(b.dataset.open);
          s.tab = 'talk';
          draw();
        }),
      );
      root.querySelector('[data-open-mission]')?.addEventListener('click', () => {
        s.view = 'task';
        s.tab = 'goals';
        draw();
      });
      const toggle = root.querySelector('[data-voice-toggle]');
      toggle?.addEventListener('click', () => {
        s.playing = !s.playing;
        toggle.innerHTML = s.playing ? PAUSE : PLAY;
        toggle.setAttribute('aria-label', s.playing ? 'Wstrzymaj narrację' : 'Odtwórz narrację');
        toggle.closest('[data-voice]').classList.toggle('is-playing', s.playing);
      });
      root.querySelector('[data-voice-replay]')?.addEventListener('click', () => {
        s.playing = true;
        if (toggle) toggle.innerHTML = PAUSE;
        toggle?.closest('[data-voice]').classList.add('is-playing');
      });
      root.querySelectorAll('.dn-close, .on-window__close').forEach((b) =>
        b.addEventListener('click', () => {
          s.view = 'update';
          draw();
        }),
      );
    };
    wire();
    // The review harness swaps the stylesheet as it mounts; scroll the arrival thread once it applies.
    setTimeout(() => {
      const thread = root.querySelector('[data-thread]');
      if (thread !== null && s.view === 'arrival') thread.scrollTop = thread.scrollHeight;
    }, 300);
  },
};
