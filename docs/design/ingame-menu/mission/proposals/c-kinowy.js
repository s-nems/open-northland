// Proposal C, Kinowy: a scripted briefing plays as a letterboxed scene over the darkened world, one
// subtitle at a time, and its world views move the camera. Voluntary reading is a compact framed
// window that can replay any briefing as the same scene.

/** A picture wider than this is a painted still, not a speaker's portrait (portraits are 164 px). */
const PORTRAIT_MAX_W = 200;
/** Longest subtitle in characters, so a beat stays within four lines of the lower bar. */
const SUBTITLE_MAX = 210;
/** Camera magnification of the world capture when a beat frames a world view. */
const CAMERA_ZOOM = 1.7;
/** The world strip between the letterbox bars on the 1365 × 768 plane. */
const SCENE = { top: 84, bottom: 200, w: 1365 };
const VIEW_W = 280;
const GOALS_IN_CAPTION = 3;
const VIEW_H = 220;

const SVG = {
  play: '<svg aria-hidden="true" class="on-glyph on-glyph--solid" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg aria-hidden="true" class="on-glyph on-glyph--solid" viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  replay: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"/></svg>',
  film: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 9h18M3 15h18M7 5v4M12 5v4M17 5v4M7 15v4M12 15v4M17 15v4"/></svg>',
  text: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M5 5h14M5 9.5h14M5 14h14M5 18.5h9"/></svg>',
  skip: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m5 6 7 6-7 6zM12 6l7 6-7 6z"/></svg>',
  check: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m5.5 12.5 4 4 9-9"/></svg>',
  camera: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3"/><circle cx="12" cy="12" r="2.5"/></svg>',
};

/** analysePage's title for a page without one. */
const UNTITLED = '\u2014';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const roman = (i) => ROMAN[i] ?? String(i + 1);

const hashParam = (name) => new URLSearchParams(location.hash.slice(1)).get(name);

/** Original titles are often all caps; Cinzel draws lower case as small caps, so sentence case reads better. */
function niceTitle(title) {
  if (title !== title.toUpperCase()) return title;
  const lower = title.toLowerCase();
  return lower.replace(/(^|:\s+)(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
}

function chapterTitle(page) {
  if (page.title !== UNTITLED) return niceTitle(page.title);
  const first = page.segments.find((s) => s.kind === 'para' || s.kind === 'speech');
  const words = (first?.text ?? '').replace(/^[-"„\s]+/, '').split(/\s+/).slice(0, 5).join(' ');
  return words ? `${words}…` : 'Wieść';
}

/** Splits narration into subtitles at sentence ends, packing sentences up to the subtitle length. */
function subtitles(text) {
  const sentences = text
    .split(/\n+|(?<=[.!?…]["”]?)\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + ' ' + s).length > SUBTITLE_MAX) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

/** The scene's beats: one subtitle each, carrying its speaker, portrait, still and camera framing. */
function beatsOf(page) {
  const beats = [];
  const signatures = [];
  let portrait = null;
  let still = null;
  let heading = null;
  for (const s of page.segments) {
    if (s.kind === 'picture') {
      if (s.width > PORTRAIT_MAX_W) still = s;
      else portrait = s.src;
    } else if (s.kind === 'heading') {
      heading = s.text;
    } else if (s.kind === 'para' || s.kind === 'speech') {
      const face = s.kind === 'speech' ? (s.portrait ?? null) : portrait;
      subtitles(s.text).forEach((text, i) =>
        beats.push({ text, speaker: s.speaker ?? null, face, heading: i === 0 ? heading : null, still, camera: null }),
      );
      heading = null;
      still = null;
    } else if (s.kind === 'mapview') {
      const last = beats.at(-1);
      if (last && last.camera === null && last.still === null) last.camera = s.icon;
      else beats.push({ text: null, speaker: null, face: null, heading: null, still: null, camera: s.icon });
    } else if (s.kind === 'signature') {
      signatures.push(s.text);
    }
  }
  if (still !== null || beats.length === 0) beats.push({ text: null, speaker: null, face: null, heading: null, still, camera: null });
  return { beats, signatures };
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

const st = { key: '', beat: 0, mode: 'scene', tab: 'task', chapter: 0, scene: null, playing: false, done: false, entered: false, shown: null };
let current = null;

function sync(ctx) {
  const key = `${ctx.map}|${ctx.pageIndex}|${ctx.view}`;
  if (st.key === key) return;
  const last = ctx.pages.length - 1;
  Object.assign(st, {
    key,
    beat: Number(hashParam('cb') ?? 0),
    mode: ctx.view === 'arrival' ? (hashParam('cm') === 'full' ? 'full' : 'scene') : 'window',
    tab: ctx.view === 'goals' || ctx.view === 'history' ? ctx.view : 'task',
    chapter: last,
    scene: hashParam('cs') === null ? null : Math.min(Number(hashParam('cs')), last),
    playing: false,
    done: false,
    entered: false,
    shown: null,
  });
}

// ---------- the scene ----------

function cameraStyle(ctx, icon) {
  const match = ctx.lib.mapViewStyle(ctx.map, icon, VIEW_W, VIEW_H).match(/\) -(\d+)px -(\d+)px/);
  const cx = Number(match?.[1] ?? 400) + VIEW_W / 2;
  const cy = Number(match?.[2] ?? 200) + VIEW_H / 2;
  const h = 768 - SCENE.top - SCENE.bottom;
  const bw = ctx.lib.STAGE.w * CAMERA_ZOOM;
  const bh = ctx.lib.STAGE.h * CAMERA_ZOOM;
  const x = Math.max(0, Math.min(bw - SCENE.w, cx * CAMERA_ZOOM - SCENE.w / 2));
  const y = Math.max(0, Math.min(bh - h, cy * CAMERA_ZOOM - h / 2));
  return `background-image:url(${ctx.lib.worldUrl(ctx.map)});background-size:${bw}px ${bh}px;background-position:-${x}px -${y}px`;
}

function voiceHtml(esc) {
  const label = st.playing ? 'Wstrzymaj lektora' : 'Odtwórz lektora';
  return `<div class="mpc-voice${st.playing ? ' is-playing' : ''}">
    <button type="button" class="on-medallion mpc-voice__btn" data-act="voice" aria-label="${esc(label)}" title="${esc(label)}">${st.playing ? SVG.pause : SVG.play}</button>
    <button type="button" class="on-medallion mpc-voice__btn" data-act="voice-replay" aria-label="Od początku" title="Od początku">${SVG.replay}</button>
    <span class="mpc-voice__label">Lektor<span class="mpc-voice__wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span></span>
  </div>`;
}

function faceHtml(beat, esc) {
  if (beat.face) return `<img class="mpc-face-big" src="${beat.face}" alt="">`;
  if (beat.speaker) return `<span class="mpc-initial" aria-hidden="true">${esc(beat.speaker[0])}</span>`;
  return '';
}

/** The scene's closing caption: the goals in play when the briefing ends. */
function goalsCaption(ctx) {
  const open = ctx.goals.filter((g) => g.state === 'open').slice(0, GOALS_IN_CAPTION);
  if (open.length === 0) return '';
  return `<aside class="mpc-endgoals"><p class="mpc-endgoals__kicker">Cele</p><ul>${open
    .map((g) => `<li><span class="mpc-seal mpc-seal--open"></span>${ctx.lib.esc(ctx.lib.goalText(g))}</li>`)
    .join('')}</ul></aside>`;
}

function sceneHtml(ctx, pageIndex, paused) {
  const { esc } = ctx.lib;
  const page = ctx.pages[pageIndex];
  const { beats, signatures } = beatsOf(page);
  const i = Math.max(0, Math.min(st.beat, beats.length - 1));
  const beat = beats[i];
  const last = i === beats.length - 1;
  const title = chapterTitle(page);
  const chapter = `Rozdział ${roman(pageIndex)}`;
  const layers = [
    beat.camera
      ? `<div class="mpc-camera" style="${cameraStyle(ctx, beat.camera)}">
          <span class="mpc-reticle mpc-reticle--tl"></span><span class="mpc-reticle mpc-reticle--tr"></span><span class="mpc-reticle mpc-reticle--bl"></span><span class="mpc-reticle mpc-reticle--br"></span>
          <p class="mpc-camera__tag">${SVG.camera}Kamera pokazuje miejsce z opowieści</p>
        </div>`
      : '',
    beat.still ? `<figure class="mpc-still"><img src="${beat.still.src}" alt=""></figure>` : '',
    i === 0
      ? `<div class="mpc-title"><p class="mpc-title__kicker"><span></span>${esc(chapter)}<span></span></p><h1 class="mpc-title__name">${esc(title)}</h1>${
          title.toLowerCase() === ctx.lib.missionName(ctx.mission).toLowerCase() ? '' : `<p class="mpc-title__mission">${esc(ctx.lib.missionName(ctx.mission))}</p>`
        }</div>`
      : '',
    last ? goalsCaption(ctx) : '',
  ].join('');
  const state = paused
    ? `<span class="mpc-state">${SVG.pause}Gra wstrzymana</span>`
    : `<span class="mpc-state mpc-state--live"><i></i>Gra toczy się dalej</span>`;
  const sub = beat.text
    ? `${beat.heading ? `<p class="mpc-sub__heading">${esc(beat.heading)}</p>` : ''}${beat.speaker ? `<p class="mpc-sub__who">${esc(beat.speaker)}</p>` : ''}<p class="mpc-sub__text${beat.face || beat.speaker ? ' is-spoken' : ''}">${esc(beat.text)}</p>`
    : `<p class="mpc-sub__hint">${beat.camera ? 'Rozejrzyj się. Dalej wraca do opowieści.' : ''}</p>`;
  const progress = ((i + 1) / beats.length) * 100;
  return `<div class="mpc-scene${st.entered ? '' : ' is-enter'}${beat.camera ? ' is-camera' : ''}" role="dialog" aria-label="${esc(`${chapter}: ${title}`)}">
    <div class="mpc-dim"></div>
    ${layers}
    <header class="mpc-bar mpc-bar--top">
      <div class="mpc-bar__left">${state}${voiceHtml(esc)}</div>
      <p class="mpc-bar__title"${i === 0 ? ' hidden' : ''}>${esc(chapter)}<span>·</span>${esc(title)}</p>
      <div class="mpc-bar__right">
        <button type="button" class="mpc-link" data-act="full">${SVG.text}Czytaj całość</button>
        <button type="button" class="mpc-link" data-act="skip">${SVG.skip}Pomiń</button>
      </div>
    </header>
    <footer class="mpc-bar mpc-bar--bottom">
      <span class="mpc-meter" style="--p:${progress}%"></span>
      <div class="mpc-speaker">${faceHtml(beat, esc)}</div>
      <div class="mpc-sub" data-beat="${i}">${sub}${last && signatures.length ? `<p class="mpc-sub__sign">${signatures.map(esc).join(' · ')}</p>` : ''}</div>
      <div class="mpc-controls">
        <button type="button" class="on-medallion mpc-back" data-act="back" aria-label="Wstecz" ${i === 0 ? 'disabled' : ''}>${ctx.lib.GLYPH.back}</button>
        <div class="mpc-next-wrap">
          <button type="button" class="mpc-next${last ? ' is-last' : ''}" data-act="next">${last ? (paused ? `${SVG.play}Do gry` : 'Zakończ') : `Dalej${ctx.lib.GLYPH.next}`}</button>
          <p class="mpc-count"><kbd class="on-key">Spacja</kbd>${i + 1} / ${beats.length}</p>
        </div>
      </div>
    </footer>
  </div>`;
}

// ---------- the window ----------

function segmentHtml(ctx, s) {
  const { esc } = ctx.lib;
  switch (s.kind) {
    case 'heading':
      return `<h4 class="mpc-h">${esc(s.text)}</h4>`;
    case 'para':
      return `<p class="mpc-p">${esc(s.text).replace(/\n/g, '<br>')}</p>`;
    case 'speech': {
      const face = s.portrait
        ? `<img class="mpc-face" src="${s.portrait}" alt="">`
        : `<span class="mpc-face mpc-face--initial" aria-hidden="true">${esc((s.speaker ?? '?')[0])}</span>`;
      return `<div class="mpc-line">${face}<div>${s.speaker ? `<b class="mpc-who">${esc(s.speaker)}</b>` : ''}<p>${esc(s.text)}</p></div></div>`;
    }
    case 'picture':
      return s.width > PORTRAIT_MAX_W
        ? `<img class="mpc-pic mpc-pic--still" src="${s.src}" alt="">`
        : `<img class="mpc-pic" src="${s.src}" alt="">`;
    case 'mapview':
      return `<button type="button" class="mpc-shot" data-act="show" style="${ctx.lib.mapViewStyle(ctx.map, s.icon, 300, 150)}"><span>${ctx.lib.GLYPH.pin}Pokaż na mapie</span></button>`;
    case 'signature':
      return `<p class="mpc-sign">${esc(s.text)}</p>`;
    default:
      return '';
  }
}

function taskPane(ctx) {
  const { esc } = ctx.lib;
  const page = ctx.pages[st.chapter];
  return `<div class="mpc-pane mpc-pane--task">
    <header class="mpc-chapter">
      <div><p class="mpc-chapter__kicker">Rozdział ${roman(st.chapter)} · otrzymano ${ctx.lib.receivedAt(st.chapter)}</p>
      <h3 class="mpc-chapter__title">${esc(chapterTitle(page))}</h3></div>
      ${voiceHtml(esc)}
    </header>
    <div class="mpc-read">${page.segments.map((s) => segmentHtml(ctx, s)).join('')}</div>
  </div>`;
}

function goalRow(ctx, g) {
  const { esc } = ctx.lib;
  const seal = g.state === 'done' ? `<span class="mpc-seal mpc-seal--done">${SVG.check}</span>` : `<span class="mpc-seal mpc-seal--${g.state}"></span>`;
  return `<li class="mpc-goal is-${g.state}">${seal}<span class="mpc-goal__text">${esc(ctx.lib.goalText(g))}</span>${g.emphasis ? '<span class="mpc-tag">Główny</span>' : ''}${g.state === 'done' ? '<span class="mpc-goal__state">Wykonano</span>' : ''}</li>`;
}

function goalsPane(ctx) {
  const done = ctx.goals.filter((g) => g.state === 'done');
  const open = ctx.goals.filter((g) => g.state === 'open');
  const idle = ctx.goals.filter((g) => g.state === 'idle');
  const group = (label, list, note = '') =>
    list.length ? `<section class="mpc-group"><h4 class="mpc-group__title">${label}<span>${list.length}</span></h4>${note}<ul>${list.map((g) => goalRow(ctx, g)).join('')}</ul></section>` : '';
  const shown = ctx.goals.length;
  return `<div class="mpc-pane mpc-pane--goals">
    <header class="mpc-sum">
      <p class="mpc-sum__big"><b>${done.length}</b> / ${shown}</p>
      <div class="mpc-sum__main"><p>celów wykonanych</p><span class="mpc-sum__bar">${[...done, ...open, ...idle].map((g) => `<i class="is-${g.state}"></i>`).join('')}</span></div>
    </header>
    <div class="mpc-read mpc-read--goals">
      ${group('W toku', open)}
      ${group('Wykonane', done)}
      ${group('Wkrótce', idle, '<p class="mpc-group__note">Te cele otworzy dalszy ciąg opowieści.</p>')}
    </div>
  </div>`;
}

function excerpt(page) {
  const first = page.segments.find((s) => s.kind === 'para' || s.kind === 'speech');
  return first ? first.text.replace(/\s+/g, ' ') : '';
}

function historyPane(ctx) {
  const { esc } = ctx.lib;
  const rows = ctx.pages
    .map((page, i) => ({ page, i }))
    .reverse()
    .map(
      ({ page, i }) => `<li class="mpc-entry${i === ctx.pages.length - 1 ? ' is-new' : ''}">
        <span class="mpc-entry__num">${roman(i)}</span>
        <div class="mpc-entry__main">
          <p class="mpc-entry__title">${esc(chapterTitle(page))}${i === ctx.pages.length - 1 ? '<span class="mpc-tag">Najnowszy</span>' : ''}</p>
          <p class="mpc-entry__meta"><time>${ctx.lib.receivedAt(i)}</time>${esc(excerpt(page))}</p>
        </div>
        <button type="button" class="on-button mpc-entry__read" data-act="read" data-i="${i}">Czytaj</button>
        <button type="button" class="on-medallion mpc-entry__play" data-act="scene" data-i="${i}" aria-label="Odtwórz scenę" title="Odtwórz scenę">${SVG.play}</button>
      </li>`,
    )
    .join('');
  return `<div class="mpc-pane mpc-pane--history">
    <p class="mpc-intro">Każdy rozdział, który przyniosła ta misja. Otwórz go jako tekst albo obejrzyj jeszcze raz jako scenę.</p>
    <ol class="mpc-read mpc-journal">${rows}</ol>
    <button type="button" class="mpc-wiki" data-act="wiki">Tablice historyczne<span>→</span>Wiedza</button>
  </div>`;
}

function windowHtml(ctx, paused) {
  const { esc } = ctx.lib;
  const done = ctx.goals.filter((g) => g.state === 'done').length;
  const shown = ctx.goals.length;
  const tabs = [
    ['task', 'Zadanie', ''],
    ['goals', 'Cele', `${done}/${shown}`],
    ['history', 'Dziennik', String(ctx.pages.length)],
  ]
    .map(
      ([id, label, count]) =>
        `<button type="button" role="tab" class="on-tab" data-act="tab" data-i="${id}" aria-selected="${st.tab === id}">${label}${count ? `<span class="on-tab__count">${count}</span>` : ''}</button>`,
    )
    .join('');
  const pane = st.tab === 'goals' ? goalsPane(ctx) : st.tab === 'history' ? historyPane(ctx) : taskPane(ctx);
  const last = ctx.pages.length - 1;
  const nav =
    st.tab === 'task'
      ? `<div class="mpc-nav">
          <button type="button" class="on-button" data-act="prev" ${st.chapter === 0 ? 'disabled' : ''}>${ctx.lib.GLYPH.back}Poprzedni</button>
          <span class="mpc-nav__at">${roman(st.chapter)} z ${roman(last)}</span>
          <button type="button" class="on-button" data-act="nextch" ${st.chapter === last ? 'disabled' : ''}>Następny${ctx.lib.GLYPH.next}</button>
        </div>`
      : '<span></span>';
  const foot = paused
    ? `<footer class="mpc-foot"><span class="mpc-state">${SVG.pause}Gra wstrzymana</span>${nav}<button type="button" class="on-button mpc-resume" data-act="resume">${SVG.play}Wznów grę</button></footer>`
    : `<footer class="mpc-foot"><span class="mpc-state mpc-state--live"><i></i>Gra toczy się dalej</span>${nav}<span class="mpc-foot__hint"><kbd class="on-key">M</kbd> zamyka</span></footer>`;
  const body = `<nav class="on-tabs mpc-tabs" role="tablist">${tabs}<button type="button" class="on-button mpc-replay" data-act="scene" data-i="${st.tab === 'task' ? st.chapter : last}">${SVG.film}Odtwórz jako scenę</button></nav>${pane}${foot}`;
  return ctx.lib.hudWindow({
    title: 'Misja',
    kicker: ctx.lib.missionName(ctx.mission),
    width: 700,
    body,
    cls: `mpc-win${paused ? ' mpc-win--paused' : ''}`,
    style: 'left:332px;top:78px;height:600px',
  });
}

// ---------- update: a lower third, clear of the notices, the minimap and the beam ----------

function updateHtml(ctx) {
  const { esc } = ctx.lib;
  const done = ctx.goals.filter((g) => g.state === 'done').at(-1);
  const fresh = ctx.goals.find((g) => g.state === 'open');
  return `<aside class="mpc-lower" aria-live="polite">
    <p class="mpc-lower__kicker">${esc(ctx.lib.missionName(ctx.mission))}</p>
    ${done ? `<p class="mpc-lower__row is-done"><span class="mpc-seal mpc-seal--done">${SVG.check}</span><span><b>Cel wykonany</b><s>${esc(ctx.lib.goalText(done))}</s></span></p>` : ''}
    ${fresh ? `<p class="mpc-lower__row is-new"><span class="mpc-seal mpc-seal--open"></span><span><b>Nowy cel</b>${esc(ctx.lib.goalText(fresh))}</span></p>` : ''}
    <button type="button" class="mpc-lower__open" data-act="noop">Misja<kbd class="on-key">M</kbd></button>
  </aside>`;
}

// ---------- module ----------

function render(ctx) {
  sync(ctx);
  normalise(ctx);
  if (ctx.view === 'update') return updateHtml(ctx);
  if (ctx.view === 'arrival') {
    if (st.done) return `<p class="mpc-resumed">${SVG.play}Gra wznowiona</p>`;
    if (st.mode === 'full') return `<div class="mpc-veil"></div>${windowHtml(ctx, true)}`;
    return sceneHtml(ctx, ctx.pages.length - 1, true);
  }
  if (st.scene !== null) return sceneHtml(ctx, st.scene, false);
  return windowHtml(ctx, false);
}

function refresh(keepScroll) {
  if (current === null) return;
  const { root, ctx } = current;
  const scroll = root.querySelector('.mpc-read')?.scrollTop ?? 0;
  root.innerHTML = ctx.lib.SYMBOLS + render(ctx);
  mount(root, ctx);
  const pane = root.querySelector('.mpc-read');
  if (pane && keepScroll) pane.scrollTop = scroll;
}

function sceneLength(ctx) {
  const index = ctx.view === 'arrival' ? ctx.pages.length - 1 : st.scene;
  return beatsOf(ctx.pages[index]).beats.length;
}

function act(ctx, action, arg) {
  const inScene = (ctx.view === 'arrival' && st.mode === 'scene' && !st.done) || (ctx.view !== 'arrival' && st.scene !== null);
  switch (action) {
    case 'next':
      if (!inScene) return;
      if (st.beat < sceneLength(ctx) - 1) st.beat += 1;
      else if (ctx.view === 'arrival') st.done = true;
      else st.scene = null;
      break;
    case 'back':
      if (!inScene) return;
      st.beat = Math.max(0, st.beat - 1);
      break;
    case 'skip':
      if (!inScene) return;
      if (ctx.view === 'arrival') st.done = true;
      else st.scene = null;
      break;
    case 'resume':
      st.done = true;
      break;
    case 'full':
      if (ctx.view === 'arrival') st.mode = 'full';
      else {
        st.chapter = st.scene ?? st.chapter;
        st.scene = null;
        st.tab = 'task';
      }
      break;
    case 'scene':
      st.beat = 0;
      if (ctx.view === 'arrival') {
        st.mode = 'scene';
      } else {
        st.scene = Number(arg);
        st.entered = false;
      }
      break;
    case 'tab':
      st.tab = arg;
      break;
    case 'read':
      st.tab = 'task';
      st.chapter = Number(arg);
      break;
    case 'prev':
      st.chapter = Math.max(0, st.chapter - 1);
      break;
    case 'nextch':
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
  refresh(action === 'voice' || action === 'voice-replay');
}

let keysBound = false;

function mount(root, ctx) {
  current = { root, ctx };
  st.entered = true;
  root.onclick = (event) => {
    const target = event.target.closest('[data-act]');
    if (target === null || target.disabled) return;
    act(ctx, target.dataset.act, target.dataset.i);
  };
  if (!keysBound) {
    keysBound = true;
    document.addEventListener('keydown', (event) => {
      if (current === null || !current.root.classList.contains('mp-c') || current.root.querySelector('.mpc-scene') === null) return;
      const key = { ' ': 'next', Enter: 'next', ArrowRight: 'next', ArrowLeft: 'back', Backspace: 'back', Escape: 'skip' }[event.key];
      if (key === undefined) return;
      event.preventDefault();
      act(current.ctx, key);
    });
  }
}

export default {
  id: 'c',
  name: 'Kinowy',
  blurb:
    'Nowy rozdział z mapy gra się jak scena filmowa: świat ciemnieje, wjeżdżają czarne pasy, tytuł rozdziału, a potem tekst podawany kawałkami jak napisy, z portretem mówiącego i kamerą pokazującą miejsca z opowieści. Spacja prowadzi dalej, "Czytaj całość" daje zwykły tekst; misję otwartą z belki czyta się w zwartym oknie, z którego każdy rozdział można obejrzeć jeszcze raz.',
  css: 'c-kinowy.css',
  views: ['arrival', 'task', 'goals', 'history', 'update'],
  render,
  mount,
};
