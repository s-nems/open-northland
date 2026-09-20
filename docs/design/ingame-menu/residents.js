// Residents window review states (ticket 07). A sample settlement stands in for the snapshot; nothing
// here reads game state. Filter semantics follow the original subjects window; see FOUNDATION.md.
const win = document.querySelector('[data-residents-window]');
const nav = document.querySelectorAll('.nav > button')[1];
const list = win.querySelector('[data-res-list]');
const whoBar = win.querySelector('[data-res-who]');
const lackBar = win.querySelector('[data-res-lacks]');
const jobSelect = win.querySelector('[data-res-job]');
const canSelect = win.querySelector('[data-res-can]');
const query = win.querySelector('[data-res-query]');
const summary = win.querySelector('[data-res-summary]');
const shownCount = win.querySelector('[data-res-shown]');
const picked = win.querySelector('[data-res-picked]');
const selectAll = win.querySelector('[data-res-all]');

// Look ids the local review atlases cover: civilian body for every trade without its own look.
const LOOK = { man: 6, woman: 5, boy: 4, girl: 3, soldier: 31 };
const MEN = [
  'Arne',
  'Bjorn',
  'Egil',
  'Erik',
  'Gunnar',
  'Hakon',
  'Halfdan',
  'Harald',
  'Ivar',
  'Knut',
  'Leif',
  'Njal',
  'Olaf',
  'Ragnar',
  'Rolf',
  'Sigurd',
  'Snorri',
  'Sven',
  'Torsten',
  'Ulf',
];
const WOMEN = [
  'Asa',
  'Astrid',
  'Freya',
  'Gudrun',
  'Gunnhild',
  'Helga',
  'Hilda',
  'Ingrid',
  'Liv',
  'Ragnhild',
  'Sigrid',
  'Solveig',
  'Thora',
  'Thyra',
  'Yrsa',
];
// [job, label, head count, workplace]; a trade without a workplace works in the open.
const TRADES = [
  ['collector', 'Zbieracz', 9, 'Chata zbieracza'],
  ['carrier', 'Tragarz', 6, 'Magazyn'],
  ['builder', 'Budowniczy', 4, ''],
  ['farmer', 'Rolnik', 4, 'Gospodarstwo'],
  ['joiner', 'Cieśla', 2, 'Stolarnia'],
  ['mason', 'Murarz', 2, 'Kamieniarnia'],
  ['potter', 'Garncarz', 2, 'Garncarnia'],
  ['miller', 'Młynarz', 1, 'Młyn'],
  ['baker', 'Piekarz', 2, 'Piekarnia'],
  ['hunter', 'Myśliwy', 2, 'Chata myśliwego'],
  ['fisher', 'Rybak', 2, 'Chata rybaka'],
  ['smith', 'Kowal', 1, 'Kuźnia'],
  ['tailor', 'Krawiec', 1, 'Szwalnia'],
  ['scout', 'Zwiadowca', 1, ''],
  ['druid', 'Druid', 1, 'Chata druida'],
  ['idle', 'Cywil', 5, ''],
];
const SOLDIERS = [
  ['soldier', 'Żołnierz', 4],
  ['archer_short', 'Łucznik', 2],
  ['archer_long', 'Łucznik z długim łukiem', 1],
];
const GARRISONS = ['Wieża strażnicza', 'Koszary', ''];
const WHO = [
  ['all', 'Wszyscy'],
  ['men', 'Mężczyźni'],
  ['women', 'Kobiety'],
  ['children', 'Dzieci'],
  ['workers', 'Pracownicy'],
  ['civil', 'Cywile'],
  ['soldiers', 'Żołnierze'],
  ['heroes', 'Bohaterowie'],
];
const LACKS = [
  ['home', 'domu', 'M3 11 12 4l9 7M5 10v10h14V10M9 20v-6h6v6'],
  ['post', 'miejsca pracy', 'M4 20h16M7 20v-7h10v7M9 13V9h6v4M12 9V4M9 4h6'],
  ['tool', 'narzędzi', 'M14 4l6 6-3 3-6-6ZM12.5 8.5 4 17l3 3 8.5-8.5'],
  ['shoes', 'butów', 'M6 4h5v9l7 3q2 1 2 4H6Z M6 16h8'],
  ['partner', 'pary', 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z'],
  ['childless', 'dzieci', 'M5 9h14v4a7 7 0 0 1-14 0ZM3 20q9-5 18 0M12 9V5'],
  ['weapon', 'broni', 'M19 3 8 14M6 12l6 6M4 20l4-4M19 3h-4M19 3v4'],
  [
    'mead',
    'miodu',
    'M6 9h10v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2ZM16 11h2a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2M9 5v1M12 4v2M15 5v1',
  ],
];

// A small deterministic generator keeps the sample stable between reloads.
const SEED = 7;
let seed = SEED;
const next = (n) => {
  // mulberry32: the low bits of a plain LCG repeat, which pairs the same first and father names.
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) % n;
};
const chance = (percent) => next(100) < percent;
const fullName = (male) =>
  `${(male ? MEN : WOMEN)[next((male ? MEN : WOMEN).length)]} ${MEN[next(MEN.length)]}${male ? 'sson' : 'sdóttir'}`;

function settlement(scale, pool) {
  seed = SEED;
  const people = [];
  const add = (p) => people.push({ id: `${pool}-${people.length + 1}`, ...p });
  for (const [job, label, count, workplace] of TRADES)
    for (let i = 0; i < count * scale; i++) {
      const idle = job === 'idle';
      const posted = idle || !chance(12);
      add({
        name: fullName(true),
        male: true,
        adult: true,
        job,
        label,
        look: LOOK[job] ?? LOOK.man,
        place: posted ? workplace : '',
        home: !chance(8),
        posted,
        mead: !idle && chance(30),
        tool: idle || chance(70),
        shoes: chance(60),
        spouse: chance(65),
      });
    }
  for (const [job, label, count] of SOLDIERS)
    for (let i = 0; i < count * scale; i++)
      add({
        name: fullName(true),
        male: true,
        adult: true,
        soldier: true,
        job,
        label,
        look: LOOK.soldier,
        place: GARRISONS[next(GARRISONS.length)],
        mead: chance(45),
        home: false,
        posted: true,
        tool: true,
        shoes: chance(70),
        spouse: false,
        weapon: !chance(15),
      });
  for (let i = 0; i < 31 * scale; i++) {
    const spouse = chance(70);
    add({
      name: fullName(false),
      male: false,
      adult: true,
      job: 'woman',
      label: 'Kobieta',
      look: LOOK.woman,
      place: '',
      home: !chance(6),
      posted: true,
      tool: true,
      mead: chance(25),
      shoes: chance(55),
      spouse,
      child: spouse && chance(60),
    });
  }
  for (let i = 0; i < 18 * scale; i++) {
    const male = chance(50);
    add({
      name: fullName(male),
      male,
      adult: false,
      job: male ? 'child_male' : 'child_female',
      label: `${male ? 'Chłopiec' : 'Dziewczynka'} · ${2 + next(11)} lat`,
      look: male ? LOOK.boy : LOOK.girl,
      place: '',
      home: true,
      posted: true,
      tool: true,
      shoes: true,
      spouse: false,
    });
  }
  if (scale > 0) {
    add({
      name: 'Bjarni',
      male: true,
      adult: true,
      hero: true,
      job: 'hero',
      label: 'Bohater',
      look: LOOK.man,
      place: '',
      mead: true,
      home: false,
      posted: true,
      tool: true,
      shoes: true,
      spouse: false,
      weapon: true,
    });
    add({
      name: 'Hatschi',
      male: true,
      adult: true,
      hero: true,
      job: 'hero',
      label: 'Bohater',
      look: LOOK.man,
      place: '',
      mead: false,
      home: false,
      posted: true,
      tool: true,
      shoes: true,
      spouse: false,
      weapon: true,
    });
  }
  // A trade a man may take: his own, the unschooled ones always, a schooled one only sometimes.
  for (const p of people)
    p.can = new Set(
      p.adult && p.male && !p.hero
        ? TRADES.filter(
            ([job]) =>
              job === p.job || ['collector', 'carrier', 'builder', 'idle'].includes(job) || chance(25),
          ).map(([job]) => job)
        : [],
    );
  return people;
}

// The original's tests, one per filter; a worker is an adult man who is neither fighter nor civilian.
const fighter = (p) => p.soldier === true || p.hero === true;
const worker = (p) => p.adult && p.male && !fighter(p) && p.job !== 'idle';
const WHO_TEST = {
  all: () => true,
  men: (p) => p.adult && p.male,
  women: (p) => p.adult && !p.male && !p.hero,
  children: (p) => !p.adult,
  workers: worker,
  civil: (p) => p.adult && p.male && !fighter(p) && p.job === 'idle',
  soldiers: (p) => p.soldier === true,
  heroes: (p) => p.hero === true,
};
const LACK_TEST = {
  home: (p) => !p.home && !fighter(p),
  post: (p) => worker(p) && !p.posted,
  tool: (p) => worker(p) && !p.tool,
  // Only a grown man who is no hero wears anything, so a woman lacks no worn good.
  shoes: (p) => p.adult && p.male && !p.hero && !p.shoes,
  partner: (p) => p.adult && !fighter(p) && !p.spouse,
  childless: (p) => p.adult && !p.male && !p.hero && !p.child,
  weapon: (p) => p.adult && p.soldier === true && !p.weapon,
  // The assistant's mead grant reaches every such man, one bottle each.
  mead: (p) => p.adult && p.male && !p.hero && !p.mead,
};

const glyph = (path) => `<svg aria-hidden="true" class="icon" viewBox="0 0 24 24"><path d="${path}"/></svg>`;
const filters = { who: 'all', lacks: new Set(), job: '', can: '', query: '' };
// Heroes lead under every order, as the original list keeps them; ties fall back to the name.
const SORT_KEY = {
  name: (p) => p.name,
  job: (p) => p.label,
  place: (p) => p.place || '\uffff',
};
const sort = { key: 'job', descending: false };
const lackCount = (p) => LACKS.filter(([id]) => LACK_TEST[id](p)).length;
const selection = new Set();
let people = [];

function rowMarkup(p) {
  const lacks = LACKS.filter(([id]) => LACK_TEST[id](p))
    .map(([, label, path]) => `<i title="Bez ${label}">${glyph(path)}</i>`)
    .join('');
  return `<li data-id="${p.id}"><button type="button" class="res-row" aria-pressed="false"><span class="res-fig"><span data-settler="${p.look}" data-still></span></span><strong title="${p.name}">${p.name}</strong><span title="${p.label}">${p.label}</span><span title="${p.place}">${p.place || '-'}</span><span class="res-lacks">${lacks}</span></button></li>`;
}

// `over` swaps single filters, which is how a chip counts what its own pick would list.
function matches(p, over = {}) {
  const f = { ...filters, ...over };
  if (!WHO_TEST[f.who](p)) return false;
  for (const id of f.lacks) if (!LACK_TEST[id](p)) return false;
  if (f.job && p.job !== f.job) return false;
  if (f.can && !p.can.has(f.can)) return false;
  const needle = f.query.trim().toLocaleLowerCase('pl');
  return [p.name, p.label, p.place].some((text) => text.toLocaleLowerCase('pl').includes(needle));
}

function order() {
  const text = SORT_KEY[sort.key];
  const sign = sort.descending ? -1 : 1;
  const sorted = [...people].sort(
    (a, b) =>
      Number(b.hero ?? false) - Number(a.hero ?? false) ||
      sign * (text ? text(a).localeCompare(text(b), 'pl') : lackCount(b) - lackCount(a)) ||
      a.name.localeCompare(b.name, 'pl'),
  );
  const rows = new Map([...list.children].map((item) => [item.dataset.id, item]));
  for (const p of sorted) list.append(rows.get(p.id));
  // The lack column opens with the neediest on top, which reads as a descending order.
  const arrowDown = sort.descending !== (sort.key === 'lacks');
  for (const head of win.querySelectorAll('[data-res-sort]'))
    head.setAttribute(
      'aria-sort',
      head.dataset.resSort !== sort.key ? 'none' : arrowDown ? 'descending' : 'ascending',
    );
}

function refresh() {
  const byId = new Map(people.map((p) => [p.id, p]));
  let shown = 0;
  for (const item of list.children) {
    const p = byId.get(item.dataset.id);
    item.hidden = p === undefined || !matches(p);
    if (!item.hidden) shown++;
    item.firstElementChild.setAttribute('aria-pressed', String(selection.has(item.dataset.id)));
  }
  // Every count narrows to the other filters: a group cell swaps the group, a lack cell adds its lack.
  const tally = (over, test = () => true) => people.filter((p) => matches(p, over) && test(p)).length;
  for (const chip of whoBar.children) {
    const n = tally({ who: chip.dataset.who });
    chip.setAttribute('aria-checked', String(chip.dataset.who === filters.who));
    chip.querySelector('.count').textContent = n;
    chip.classList.toggle('zero', n === 0);
  }
  for (const chip of lackBar.children) {
    const id = chip.dataset.lack;
    const n = tally({}, LACK_TEST[id]);
    chip.setAttribute('aria-pressed', String(filters.lacks.has(id)));
    chip.setAttribute('aria-label', `${chip.title}: ${n}`);
    chip.querySelector('.count').lastChild.textContent = n;
    chip.classList.toggle('zero', n === 0);
  }
  for (const option of jobSelect.options) {
    if (option.value === '') continue;
    const n = tally({ job: option.value });
    option.textContent = `${option.dataset.label} (${n})`;
    option.hidden = n === 0 && option.value !== filters.job;
  }
  const active = [
    filters.who !== 'all' && WHO.find(([id]) => id === filters.who)[1],
    ...LACKS.filter(([id]) => filters.lacks.has(id)).map(([, label]) => `bez ${label}`),
    filters.job && `zawód: ${jobSelect.selectedOptions[0].dataset.label}`,
    filters.can && `może zostać: ${canSelect.selectedOptions[0].dataset.label}`,
    filters.query.trim() && `„${filters.query.trim()}”`,
  ].filter(Boolean);
  summary.textContent = active.length
    ? `Pokazano ${shown} z ${people.length} · ${active.join(' · ')}`
    : `Wszyscy mieszkańcy · ${people.length}`;
  for (const button of win.querySelectorAll('[data-res-clear]')) button.hidden = active.length === 0;
  const none = people.length === 0;
  win.querySelector('[data-res-none]').hidden = !none;
  win.querySelector('[data-res-nomatch]').hidden = none || shown > 0;
  win.querySelector('.res-head').hidden = shown === 0;
  win.querySelector('.res-summary').hidden = none;
  list.hidden = shown === 0;
  shownCount.textContent = shown;
  selectAll.disabled = shown === 0;
  picked.hidden = selection.size === 0;
  picked.textContent = `W zaznaczeniu: ${selection.size}`;
}

function buildControls() {
  const count = (test) => people.filter(test).length;
  whoBar.innerHTML = WHO.map(
    ([id, label]) =>
      `<button type="button" role="radio" data-who="${id}"><span class="count">${count(WHO_TEST[id])}</span><span class="label">${label}</span></button>`,
  ).join('');
  lackBar.innerHTML = LACKS.map(([id, label, path]) => {
    const n = count(LACK_TEST[id]);
    return `<button type="button" data-lack="${id}" title="Bez ${label}" aria-label="Bez ${label}: ${n}"${n === 0 ? ' class="zero"' : ''}><span class="count">${glyph(path)}${n}</span><span class="label">${label.replace(/(^| )(\p{L})/gu, (_, gap, first) => gap + first.toLocaleUpperCase('pl'))}</span></button>`;
  }).join('');
  const options = (rows, empty, tally) =>
    `<option value="">${empty}</option>${rows
      .map(
        ([job, label]) =>
          `<option value="${job}" data-label="${label}">${label}${tally ? ` (${count((p) => p.job === job)})` : ''}</option>`,
      )
      .join('')}`;
  jobSelect.innerHTML = options(
    [...TRADES, ...SOLDIERS].filter(([job]) => count((p) => p.job === job) > 0),
    'Każdy',
    true,
  );
  canSelect.innerHTML = options(
    TRADES.filter(([job]) => job !== 'idle'),
    'Dowolny',
    false,
  );
}

function clearFilters() {
  filters.who = 'all';
  filters.lacks.clear();
  filters.job = filters.can = filters.query = '';
  jobSelect.value = canSelect.value = query.value = '';
}

function show(state) {
  const open = state !== 'closed';
  win.hidden = !open;
  nav.setAttribute('aria-pressed', String(open));
  for (const button of document.querySelectorAll('[data-residents]'))
    button.setAttribute('aria-pressed', String(button.dataset.residents === state));
  if (!open) return;
  document.querySelector('[data-build="closed"]').click();
  people = POOLS[state === 'long' || state === 'none' ? state : 'normal'];
  selection.clear();
  buildControls();
  clearFilters();
  sort.key = 'job';
  sort.descending = false;
  order();
  if (state === 'filtered') {
    filters.who = 'workers';
    filters.lacks.add('shoes');
  }
  if (state === 'can') {
    filters.can = 'baker';
    canSelect.value = 'baker';
  }
  if (state === 'nomatch') {
    filters.who = 'soldiers';
    filters.lacks.add('home').add('partner');
    filters.query = query.value = 'piekarz';
  }
  refresh();
  list.scrollTop = 0;
}

// Every pool is laid out once so the still figures mount with the page; a state only swaps pools.
const LONG_SCALE = 3;
const POOLS = { normal: settlement(1, 'normal'), long: settlement(LONG_SCALE, 'long'), none: [] };
list.innerHTML = Object.values(POOLS)
  .map((pool) => pool.map(rowMarkup).join(''))
  .join('');

// As a file list: Ctrl (or Cmd) puts a row in the group or takes it out, Shift picks the rows from
// the last row pressed without it, both together add that range.
const togglesRow = (event) => event.ctrlKey || event.metaKey;
let anchor = null;
const shownIds = () => [...list.children].filter((item) => !item.hidden).map((item) => item.dataset.id);
win.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.who) filters.who = button.dataset.who;
  if (button.dataset.lack)
    filters.lacks.has(button.dataset.lack)
      ? filters.lacks.delete(button.dataset.lack)
      : filters.lacks.add(button.dataset.lack);
  if (button.dataset.resClear !== undefined) clearFilters();
  if (button.dataset.resSort) {
    sort.descending = sort.key === button.dataset.resSort && !sort.descending;
    sort.key = button.dataset.resSort;
    order();
  }
  if (button.dataset.resClose !== undefined) return show('closed');
  if (button.matches('.res-row')) {
    const id = button.parentElement.dataset.id;
    if (!event.shiftKey) anchor = id;
    // A plain click picks one and shows them; a modifier builds a group without leaving the list.
    if (!event.shiftKey && !togglesRow(event)) return show('closed');
    if (event.shiftKey) {
      const shown = shownIds();
      const from = Math.max(0, shown.indexOf(anchor));
      const to = shown.indexOf(id);
      if (!togglesRow(event)) selection.clear();
      for (const other of shown.slice(Math.min(from, to), Math.max(from, to) + 1)) selection.add(other);
    } else if (selection.has(id)) selection.delete(id);
    else selection.add(id);
  }
  if (button === selectAll) {
    if (!event.shiftKey && !togglesRow(event)) return show('closed');
    for (const id of shownIds()) selection.add(id);
  }
  refresh();
});
jobSelect.addEventListener('change', () => {
  filters.job = jobSelect.value;
  refresh();
});
canSelect.addEventListener('change', () => {
  filters.can = canSelect.value;
  refresh();
});
query.addEventListener('input', () => {
  filters.query = query.value;
  refresh();
});
document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.residents) show(button.dataset.residents);
  else if (button === nav) show(win.hidden ? 'list' : 'closed');
  else if (
    (button.dataset.build && button.dataset.build !== 'closed') ||
    button === document.querySelector('.nav > button')
  )
    show('closed');
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !win.hidden) show('closed');
  // The original's subjects-window key.
  if (event.key === 'F7') {
    event.preventDefault();
    show(win.hidden ? 'list' : 'closed');
  }
});
if (location.hash === '#residents') show('list');
