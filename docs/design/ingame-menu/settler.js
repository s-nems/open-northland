// Selected-settler panel review states (ticket 08). Sample people stand in for the snapshot; nothing
// here reads game state. The production counters follow the original's human window: 0 stops a product,
// 1-10 is how many to make, ∞ never stops; the arrows wrap past both ends and Shift jumps to the end.
const host = document.querySelector('[data-selection-host]');

// Look ids the local review atlases cover.
const LOOK = { man: 6, woman: 5, boy: 4, girl: 3, soldier: 31 };
const INFINITE = 11;
const COUNTER_MAX = 10;
// Need percentages under these turn the bar amber, then red.
const NEED_LOW = 34;
const NEED_CRITICAL = 17;

const svg = (id) => `<svg aria-hidden="true" class="icon"><use href="#${id}"/></svg>`;
// Worn slots in their fixed order and the ghost glyph an empty one shows.
const WORN_SLOTS = [
  ['Broń', 'i-sword'],
  ['Zbroja', 'i-armor'],
  ['Narzędzia', 'i-tool'],
  ['Buty', 'i-boot'],
];
const BAG_LABEL = 'Torba';
const good = (id) => `<span data-good="${id}"></span>`;

// [good id, label]
const GOODS = {
  wood: 'Drewno',
  stone: 'Kamień',
  mud: 'Glina',
  iron: 'Żelazo',
  sword_shord: 'Krótki miecz',
  sword_long: 'Długi miecz',
  spear_iron: 'Żelazna włócznia',
  bow_short: 'Krótki łuk',
  shoes: 'Buty',
  tool_wooden: 'Drewniane narzędzie',
  tool_iron: 'Żelazne narzędzie',
  bread: 'Chleb',
  food_simple: 'Żywność',
  crockery: 'Naczynia',
  leather: 'Skóra',
  armor_leather: 'Skórzana zbroja',
  mead: 'Miód pitny',
};

const STATES = {
  collector: {
    label: 'Zbieracz',
    name: 'Ulf Skarsson',
    look: LOOK.man,
    profession: 'Zbieracz',
    meta: null,
    status: 'Pracuje',
    bars: [
      ['Zdrowie', 84],
      ['Sytość', 62],
      ['Sen', 40],
      ['Towarzystwo', 71],
      ['Religia', 55],
    ],
    work: { place: 'Chata zbieracza', home: 'Dom (poziom 2)', carrying: ['wood', 'Drewno ×1'] },
    workControls: { assign: true, unassign: true, assignHome: true, unassignHome: true },
    production: {
      kind: 'gather',
      rows: [
        { good: 'wood', count: INFINITE },
        { good: 'stone', count: 3 },
        { good: 'mud', count: 0 },
      ],
    },
    family: { partner: 'Astrid Ulfsdottir', child: 'Tove' },
    ownTracks: ['Zbieracz Drewna', 'Zbieracz Kamienia'],
    experience: [
      ['Zbieracz Drewna', 12, 6],
      ['Zbieracz Kamienia', 3, 2],
      ['Rolnik', 9, 5],
      ['Rybak', 1, null],
      ['Nosiciel', 20, 10],
      ['Myśliwy', 2, 1],
    ],
    unlocks: [['Cieśla', 15, 30, 'Zbieracz Drewna']],
    equipment: [
      { label: 'Narzędzia', slots: [['tool_wooden', 64]] },
      { label: 'Buty', slots: [null] },
      { label: 'Torba', slots: [['bread', null], null, null, null] },
    ],
    orders: [],
  },
  smith: {
    label: 'Kowal',
    name: 'Halvar Bjornsson',
    look: LOOK.man,
    profession: 'Kowal',
    meta: null,
    status: 'Pracuje',
    bars: [
      ['Zdrowie', 96],
      ['Sytość', 88],
      ['Sen', 66],
      ['Towarzystwo', 48],
      ['Religia', 91],
    ],
    work: { place: 'Kuźnia', home: 'Dom (poziom 1)', carrying: null },
    workControls: { assign: true, unassign: true, assignHome: true, unassignHome: true },
    production: {
      kind: 'craft',
      rows: [
        { good: 'sword_shord', count: INFINITE },
        { good: 'spear_iron', count: 5 },
        { good: 'sword_long', count: 0 },
        { good: 'bow_short', locked: 'Wymaga doświadczenia: 8/20 (Kowal)' },
      ],
    },
    family: { partner: null, child: null },
    ownTracks: ['Kowal'],
    experience: [['Kowal', 8, 4]],
    unlocks: [['Płatnerz', 8, 20, 'Kowal']],
    equipment: [
      { label: 'Narzędzia', slots: [['tool_iron', 12]] },
      { label: 'Buty', slots: [['shoes', 88]] },
      { label: 'Torba', slots: [null, null, null, null] },
    ],
    orders: [],
  },
  soldier: {
    label: 'Żołnierz',
    name: 'Sigurd Haraldsson',
    look: LOOK.soldier,
    profession: 'Wojownik z mieczem',
    meta: null,
    status: 'Stoi na alarmie',
    bars: [
      ['Zdrowie', 58],
      ['Sytość', 12],
      ['Sen', 75],
      ['Towarzystwo', 60],
      ['Religia', 40],
    ],
    work: { place: null, home: 'Dom (poziom 2)', carrying: null },
    workControls: { assignHome: true, unassignHome: true },
    military: { stance: 'defend', regeneration: false },
    family: { partner: 'Ingrid Sigurdsdottir', child: null },
    ownTracks: ['Walka - Miecz'],
    experience: [
      ['Walka - Miecz', 7, 9],
      ['Walka - Pięści', 2, 1],
    ],
    unlocks: [],
    equipment: [
      { label: 'Broń', slots: [['sword_shord', null]] },
      { label: 'Zbroja', slots: [null] },
      { label: 'Buty', slots: [['shoes', 41]] },
      { label: 'Torba', slots: [['mead', null], ['bread', null], null, null] },
    ],
    orders: [],
  },
  hero: {
    label: 'Bohater',
    name: 'Ragnar Lodbrok',
    look: LOOK.soldier,
    profession: 'Bohater',
    meta: null,
    status: 'Bezczynny',
    bars: [['Zdrowie', 100]],
    work: { place: null, home: null, carrying: null },
    workControls: {},
    military: { stance: 'attack', regeneration: true },
    ownTracks: ['Walka - Topór'],
    experience: [['Walka - Topór', 40, 22]],
    unlocks: [],
    equipment: [
      { label: 'Broń', slots: [['sword_long', null]], fixed: true },
      { label: 'Zbroja', slots: [['armor_leather', null]], fixed: true },
    ],
    orders: [],
  },
  child: {
    label: 'Dziecko',
    name: 'Tove',
    look: LOOK.girl,
    profession: 'Dziecko',
    meta: '3 lata',
    status: 'Idzie',
    bars: [['Zdrowie', 100]],
    work: { place: null, home: 'Dom rodziców (poziom 2)', carrying: null },
    workControls: {},
    experience: null,
    equipment: null,
    orders: [],
  },
  woman: {
    label: 'Kobieta',
    name: 'Astrid Ulfsdottir',
    look: LOOK.woman,
    profession: 'Kobieta',
    meta: null,
    status: 'Idzie do domu',
    bars: [
      ['Zdrowie', 92],
      ['Sytość', 54],
      ['Sen', 82],
      ['Towarzystwo', 25],
      ['Religia', 70],
    ],
    work: { place: null, home: 'Dom (poziom 1)', carrying: ['food_simple', 'Żywność ×1'] },
    workControls: { assignHome: true, unassignHome: true },
    family: { partner: 'Ulf Skarsson', child: 'Tove' },
    experience: null,
    equipment: null,
    orders: [],
  },
  idle: {
    label: 'Bez zawodu',
    name: 'Arne Torstensson',
    look: LOOK.man,
    profession: 'Cywil',
    meta: null,
    status: 'Bezczynny',
    trouble: true,
    bars: [
      ['Zdrowie', 100],
      ['Sytość', 71],
      ['Sen', 90],
      ['Towarzystwo', 66],
      ['Religia', 80],
    ],
    work: { place: null, home: null, carrying: null },
    workControls: { assignHome: true },
    family: { partner: null, child: null },
    experience: [],
    unlocks: [],
    equipment: [
      { label: 'Narzędzia', slots: [null] },
      { label: 'Buty', slots: [null] },
      { label: 'Torba', slots: [null, null, null, null] },
    ],
    orders: ['profession'],
  },
  trader: {
    label: 'Kupiec',
    name: 'Knut Eriksson',
    look: LOOK.man,
    profession: 'Kupiec',
    meta: null,
    status: 'Idzie do Magazyn · Wikingowie',
    bars: [
      ['Zdrowie', 77],
      ['Sytość', 60],
      ['Sen', 58],
      ['Towarzystwo', 80],
      ['Religia', 64],
    ],
    work: { place: 'Punkt handlowy', home: 'Dom (poziom 3)', carrying: ['leather', 'Skóra ×2'] },
    workControls: { assign: true, unassign: true, assignHome: true, unassignHome: true },
    trade: {
      stops: [
        {
          label: 'Magazyn · Wikingowie',
          foreign: false,
          imports: [
            ['wood', true],
            ['stone', false],
            ['iron', true],
          ],
        },
        {
          label: 'Magazyn · Plemię Ragnara',
          foreign: true,
          imports: [
            ['leather', true],
            ['bread', false],
          ],
        },
      ],
      offers: [
        [2, 'wood', 1, 'leather', true],
        [3, 'stone', 1, 'iron', false],
      ],
    },
    family: { partner: null, child: null },
    ownTracks: ['Kupiec'],
    experience: [['Kupiec', 5, null]],
    unlocks: [],
    equipment: [
      { label: 'Narzędzia', slots: [null] },
      { label: 'Buty', slots: [['shoes', 70]] },
      { label: 'Torba', slots: [null, null, null, null] },
    ],
    orders: [],
  },
  foreign: {
    label: 'Obcy',
    name: 'Gudrun',
    look: LOOK.woman,
    profession: 'Piekarka',
    meta: 'Gracz 3 · Plemię Ragnara · nastawienie: neutralne',
    status: 'Pracuje',
    foreign: true,
    bars: [['Zdrowie', 90]],
    work: { place: 'Piekarnia', home: null, carrying: null },
    workControls: {},
    experience: null,
    equipment: null,
    orders: [],
  },
};

const STANCES = [
  ['attack', 'Atak'],
  ['defend', 'Obrona'],
  ['ignore', 'Ignoruj'],
];

function statusText(state) {
  const carrying = state.work.carrying;
  if (carrying === null) return state.status;
  return `${state.status} · niesie <b class="with-good"><span class="good-well">${good(carrying[0])}</span>${carrying[1]}</b>`;
}

function counterText(count) {
  if (count === INFINITE) return '∞';
  return String(count);
}

function productionMarkup(production) {
  const rows = production.rows
    .map((row) => {
      const label = GOODS[row.good];
      if (row.locked !== undefined) {
        return `<li class="prod-row locked" title="${row.locked}"><span class="prod-good">${good(row.good)}</span><span class="prod-name">${label}</span><span class="prod-lock">${svg('i-lock')}</span></li>`;
      }
      const stopped = row.count === 0;
      return `<li class="prod-row${stopped ? ' stopped' : ''}" data-count="${row.count}"><button type="button" class="prod-good" title="Tylko ten produkt: pozostałe zatrzymaj" aria-label="Tylko ${label}">${good(row.good)}</button><span class="prod-name">${label}</span><span class="counter"><button type="button" class="counter-step" data-step="-1" title="Obniż produkcję · Shift: zatrzymaj" aria-label="Mniej: ${label}">${svg('i-minus')}</button><b class="counter-value" aria-live="polite">${counterText(row.count)}</b><button type="button" class="counter-step" data-step="1" ${row.count === INFINITE ? 'aria-disabled="true"' : ''} title="Zwiększ produkcję · Shift: bez końca" aria-label="Więcej: ${label}">${svg('i-plus')}</button></span></li>`;
    })
    .join('');
  return `<div class="section-title">Produkcja</div><ul class="prod-list">${rows}</ul>`;
}

const BLANK_CONTROL = '<span class="ledger-btn blank" aria-hidden="true"></span>';

function controlButton(icon, label, enabled) {
  if (enabled === null) return BLANK_CONTROL;
  const reason = typeof enabled === 'string' ? enabled : null;
  const on = enabled === true;
  const title = reason ?? label;
  return `<button type="button" class="ledger-btn" ${on ? '' : 'aria-disabled="true"'} title="${title}" aria-label="${label}">${svg(icon)}</button>`;
}

function workMarkup(state) {
  const { work, workControls, family } = state;
  const rows = [];
  const missing = (assignable) => `<b class="${assignable ? 'missing' : 'muted'}">brak</b>`;
  const tradesman = !state.foreign && !state.military && workControls.assign !== undefined;
  if (tradesman) {
    const btns = `<span class="ledger-btns">${controlButton('i-target', 'Przydziel miejsce pracy', workControls.assign)}${controlButton('i-close', 'Usuń miejsce pracy', work.place === null ? null : workControls.unassign)}</span>`;
    rows.push(
      `<div class="kv kv-ctl"><span>Miejsce pracy</span>${work.place === null ? missing(true) : `<button type="button" class="kv-link" title="Zaznacz budynek">${work.place}</button>`}${btns}</div>`,
    );
  } else if (work.place !== null) {
    rows.push(`<div class="kv"><span>Miejsce pracy</span><b>${work.place}</b></div>`);
  }
  if (!state.foreign && state.profession !== 'Bohater') {
    const child = state.profession === 'Dziecko';
    const btns = child
      ? ''
      : `<span class="ledger-btns">${controlButton('i-target', 'Przydziel dom', workControls.assignHome ?? false)}${controlButton('i-close', 'Wyprowadź z domu', work.home === null ? null : (workControls.unassignHome ?? false))}</span>`;
    rows.push(
      `<div class="kv kv-ctl"><span>Dom</span>${work.home === null ? missing(!child) : `<button type="button" class="kv-link" title="Zaznacz budynek">${work.home}</button>`}${btns}</div>`,
    );
  }
  if (family) {
    const person = (name, role) =>
      `<button type="button" class="kv-link" title="${role}: zaznacz">${name}</button>`;
    const members =
      family.partner === null
        ? '<b class="missing" title="Ślub: rozkaz w pierścieniu">bez pary</b>'
        : `<b class="people">${person(family.partner, 'Partner')}${family.child === null ? '' : ` · ${person(family.child, 'Dziecko')}`}</b>`;
    rows.push(`<div class="kv"><span>Rodzina</span>${members}</div>`);
  }
  if (rows.length === 0) return '';
  return `<div class="section-title">${family ? 'Praca i rodzina' : 'Praca i dom'}</div>${rows.join('')}${state.production ? productionMarkup(state.production) : ''}`;
}

function militaryMarkup(military) {
  const stances = STANCES.map(
    ([id, label]) => `<button type="button" aria-pressed="${military.stance === id}">${label}</button>`,
  ).join('');
  return `<div class="section-title">Wojsko</div><div class="kv"><span>Postawa</span><span class="segmented" role="group" aria-label="Postawa">${stances}</span></div><div class="kv"><span>Jedzenie i sen</span><span class="segmented" role="group" aria-label="Regeneracja"><button type="button" aria-pressed="${military.regeneration}">Dozwolone</button><button type="button" aria-pressed="${!military.regeneration}">Zabronione</button></span></div>`;
}

function tradeMarkup(trade) {
  const stops = trade.stops
    .map((stop) => {
      const imports = stop.imports
        .map(
          ([id, on]) =>
            `<button type="button" class="import" aria-pressed="${on}" title="${on ? 'Przestań przywozić' : 'Przywoź'}: ${GOODS[id]}" aria-label="${GOODS[id]}">${good(id)}</button>`,
        )
        .join('');
      return `<li class="stop${stop.foreign ? ' foreign' : ''}"><div class="kv kv-ctl"><b class="stop-name" title="${stop.foreign ? 'Obcy punkt handlowy' : 'Punkt handlowy'}: ${stop.label}">${stop.label}</b><span class="imports">${imports}</span><span class="ledger-btns">${controlButton('i-close', 'Usuń punkt handlowy', true)}</span></div></li>`;
    })
    .join('');
  const offers = trade.offers
    .map(
      ([give, giveId, take, takeId, on]) =>
        `<button type="button" class="offer" aria-pressed="${on}" title="Umowa: ${give} × ${GOODS[giveId]} za ${take} × ${GOODS[takeId]}">${give}${good(giveId)}${svg('i-arrow')}${take}${good(takeId)}</button>`,
    )
    .join('');
  return `<div class="section-title">Handel<button type="button" class="ledger-btn title-btn" title="Dodaj punkt handlowy" aria-label="Dodaj punkt handlowy">${svg('i-target')}</button></div><ul class="stops">${stops}</ul><div class="kv"><span>Umowa</span><span class="offers">${offers}</span></div>`;
}

const EXPERIENCE_SHOWN = 3;

function experienceMarkup(state) {
  if (state.experience === null || (state.experience.length === 0 && (state.unlocks ?? []).length === 0))
    return '';
  const own = state.ownTracks ?? [];
  const rank = (row) => (own.includes(row[0]) ? 1 : 0);
  const trained = [...state.experience].sort((a, b) => rank(b) - rank(a) || b[1] - a[1]);
  const shown = Math.min(EXPERIENCE_SHOWN, Math.max(1, trained.filter((row) => rank(row) === 1).length));
  const hidden = trained.length - shown;
  const rows = trained.map(
    ([label, repeats, bonus], index) =>
      `<div class="kv${index >= shown ? ' more' : ''}"><span>${label}</span><b title="${repeats} razy${bonus === null ? '' : `, wydajność +${bonus}%`}">${repeats}${bonus === null ? '' : ` <small>+${bonus}%</small>`}</b></div>`,
  );
  for (const [job, current, required, track] of state.unlocks ?? []) {
    rows.push(
      `<div class="kv unlock" title="Postęp do zawodu ${job} przez ${track}"><span>${svg('i-lock')}${job} <small>(${track})</small></span><b>${current} / ${required}</b></div><div class="meter mini" style="--value:${Math.round((current / required) * 100)}%"></div>`,
    );
  }
  const toggle =
    hidden > 0
      ? `<button type="button" class="kv-more" aria-expanded="false" data-more="${hidden}">${hidden} więcej</button>`
      : '';
  return `<div class="section-title">Doświadczenie${toggle}</div><div class="experience">${rows.join('')}</div>`;
}

function socket(slot, label, ghost, fixed) {
  if (slot === null) {
    if (fixed) return `<span class="socket empty fixed" title="${label}"></span>`;
    return `<button type="button" class="socket empty" title="${label}: załóż" aria-label="Załóż: ${label}">${ghost ? svg(ghost) : ''}</button>`;
  }
  const [id, condition] = slot;
  const wear = condition === null ? '' : `<i class="wear" style="--value:${condition}%"></i>`;
  const cls = condition !== null && condition < 25 ? ' worn' : '';
  if (fixed)
    return `<span class="socket fixed${cls}" title="${label}: ${GOODS[id]}">${good(id)}${wear}</span>`;
  return `<span class="socket-group"><button type="button" class="socket${cls}" title="${label}: ${GOODS[id]}${condition === null ? '' : ` · ${condition}%`} · Wymień" aria-label="Wymień: ${GOODS[id]}">${good(id)}${wear}</button><button type="button" class="socket-off" title="Zdejmij: ${GOODS[id]}" aria-label="Zdejmij: ${GOODS[id]}">${svg('i-close')}</button></span>`;
}

// Two rows beside the portrait: the worn slots the person has, in WORN_SLOTS order, then the bag.
function equipmentMarkup(state) {
  if (state.equipment === null) return '';
  const byLabel = new Map(state.equipment.map((row) => [row.label, row]));
  const worn = WORN_SLOTS.filter(([label]) => byLabel.has(label))
    .map(([label, ghost]) => {
      const row = byLabel.get(label);
      return socket(row.slots[0], label, ghost, row.fixed === true);
    })
    .join('');
  const bag = byLabel.get(BAG_LABEL);
  const bagCells =
    bag === undefined ? '' : bag.slots.map((slot) => socket(slot, BAG_LABEL, null, false)).join('');
  return `<div class="equipment" aria-label="Ekwipunek"><div class="equip-row">${worn}</div>${bagCells ? `<div class="equip-row bag">${bagCells}</div>` : ''}</div>`;
}

function ordersMarkup(state) {
  const buttons = {
    profession: `<button type="button" title="Zmień zawód · C">${svg('i-forge')}Zmień zawód</button>`,
  };
  const orders = state.orders.map((id) => buttons[id]);
  return orders.length === 0 ? '' : `<div class="orders orders-inline">${orders.join('')}</div>`;
}

function panelMarkup(key, state) {
  const bars = state.bars
    .map(
      ([label, value]) =>
        `<div class="bar-row${value < NEED_CRITICAL ? ' critical' : value < NEED_LOW ? ' low' : ''}" title="${label}: ${value}%"><span>${label}</span><span class="meter" style="--value:${value}%" role="meter" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100" aria-label="${label}"></span></div>`,
    )
    .join('');
  return `<aside class="selection panel" data-selection="${key}" hidden aria-label="Zaznaczenie: ${state.name}">
    <svg aria-hidden="true" class="frame-knot"><use href="#i-knot"/></svg>
    <svg aria-hidden="true" class="corner tl"><use href="#i-corner"/></svg><svg aria-hidden="true" class="corner tr"><use href="#i-corner"/></svg><svg aria-hidden="true" class="corner bl"><use href="#i-corner"/></svg><svg aria-hidden="true" class="corner br"><use href="#i-corner"/></svg>
    <header class="window-head"><div><p>${state.profession.toUpperCase()}</p><h2>${state.name}</h2>${state.meta ? `<div class="meta">${state.meta}</div>` : ''}</div><span class="head-btns">${state.foreign ? '' : `<button type="button" class="icon-button medallion" title="Rozkazy · Spacja" aria-label="Rozkazy"><svg aria-hidden="true" class="icon"><use href="#i-list"/></svg></button>`}<button type="button" class="icon-button medallion" aria-label="Usuń zaznaczenie"><svg aria-hidden="true" class="icon"><use href="#i-close"/></svg></button></span></header>
    <div class="selection-body">
      <div class="portrait">
        <button type="button" class="portrait-box" title="Centruj widok na tej osobie"><span data-settler="${state.look}"></span></button>
        <div class="beside">${equipmentMarkup(state)}<div class="status${state.trouble ? ' trouble' : ''}">${statusText(state)}</div></div>
      </div>
      ${ordersMarkup(state)}
      <div class="section-title">Samopoczucie</div>
      <div class="bars">${bars}</div>
      ${workMarkup(state)}
      ${state.military ? militaryMarkup(state.military) : ''}
      ${state.trade ? tradeMarkup(state.trade) : ''}
      ${experienceMarkup(state)}
    </div>
  </aside>`;
}

host.innerHTML = Object.entries(STATES)
  .map(([key, state]) => panelMarkup(key, state))
  .join('');

// The counters behave as the original's: the arrows wrap past both ends, Shift jumps to the end.
host.addEventListener('click', (event) => {
  const step = event.target.closest('.counter-step');
  if (step === null) return;
  const row = step.closest('.prod-row');
  const delta = Number(step.dataset.step);
  const current = Number(row.dataset.count);
  let next;
  if (event.shiftKey) next = delta > 0 ? INFINITE : 0;
  else if (delta < 0) next = current === 0 ? INFINITE : current - 1;
  else next = current === INFINITE ? INFINITE : current === COUNTER_MAX ? INFINITE : current + 1;
  setCount(row, next);
});

function setCount(row, count) {
  row.dataset.count = count;
  row.classList.toggle('stopped', count === 0);
  row.querySelector('.counter-value').textContent = counterText(count);
  const plus = row.querySelector('.counter-step[data-step="1"]');
  if (count === INFINITE) plus.setAttribute('aria-disabled', 'true');
  else plus.removeAttribute('aria-disabled');
}
host.addEventListener('click', (event) => {
  const only = event.target.closest('.prod-good');
  if (only === null) return;
  const list = only.closest('.prod-list');
  for (const row of list.querySelectorAll('.prod-row:not(.locked)'))
    setCount(row, row.contains(only) ? INFINITE : 0);
});
host.addEventListener('click', (event) => {
  const button = event.target.closest('.segmented > button');
  if (button === null) return;
  for (const each of button.parentElement.children)
    each.setAttribute('aria-pressed', String(each === button));
});
host.addEventListener('click', (event) => {
  const toggle = event.target.closest('.import, .offer');
  if (toggle === null) return;
  const on = toggle.getAttribute('aria-pressed') !== 'true';
  if (toggle.classList.contains('offer'))
    for (const each of toggle.parentElement.children) each.setAttribute('aria-pressed', 'false');
  toggle.setAttribute('aria-pressed', String(on));
});
host.addEventListener('click', (event) => {
  const more = event.target.closest('.kv-more');
  if (more === null) return;
  const open = more.getAttribute('aria-expanded') !== 'true';
  more.setAttribute('aria-expanded', String(open));
  more.textContent = open ? 'mniej' : `${more.dataset.more} więcej`;
  more.parentElement.nextElementSibling.classList.toggle('expanded', open);
});
host.addEventListener('click', (event) => {
  if (event.target.closest('[aria-disabled="true"]')) event.preventDefault();
  if (event.target.closest('[aria-label="Usuń zaznaczenie"]')) show('empty');
});

function show(state) {
  for (const panel of host.querySelectorAll('[data-selection]'))
    panel.hidden = panel.dataset.selection !== state;
  for (const button of document.querySelectorAll('[data-settler-state]'))
    button.setAttribute('aria-pressed', String(button.dataset.settlerState === state));
}
document.querySelector('.controls').addEventListener('click', (event) => {
  const button = event.target.closest('[data-settler-state]');
  if (button) show(button.dataset.settlerState);
});
show('collector');
