// Selected-settler panel review states (ticket 08). Sample people stand in for the snapshot; nothing
// here reads game state. The production counters follow the original's human window: 0 stops a product,
// 1-10 is how many to make, ∞ never stops; the arrows wrap past both ends and Shift jumps to the end.
const host = document.querySelector('[data-selection-host]');

// Look ids the local review atlases cover.
const LOOK = { man: 6, woman: 5, boy: 4, girl: 3, soldier: 31 };
const INFINITE = 11;
const COUNTER_MAX = 10;

const svg = (id) => `<svg aria-hidden="true" class="icon"><use href="#${id}"/></svg>`;
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
    experience: [
      ['Zbieracz Drewna', 12, 6],
      ['Zbieracz Kamienia', 3, 2],
      ['Rolnik', 9, 5],
      ['Rybak', 1, null],
      ['Nosiciel', 20, 10],
    ],
    unlocks: [['Cieśla', 15, 30, 'Zbieracz Drewna']],
    equipment: [
      { label: 'Buty', slots: [null], reason: null },
      { label: 'Narzędzia', slots: [['tool_wooden', 64]] },
      { label: 'Ekwipunek', slots: [['bread', null], null, null, null] },
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
        { good: 'bow_short', locked: 'Wymaga doświadczenia: 8/20 (Kowal)', lockShort: '8 / 20' },
      ],
    },
    experience: [['Kowal', 8, 4]],
    unlocks: [['Płatnerz', 8, 20, 'Kowal']],
    equipment: [
      { label: 'Buty', slots: [['shoes', 88]] },
      { label: 'Narzędzia', slots: [['tool_iron', 12]] },
      { label: 'Ekwipunek', slots: [null, null, null, null] },
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
      ['Sytość', 30],
      ['Sen', 75],
      ['Towarzystwo', 60],
      ['Religia', 40],
    ],
    work: { place: null, home: 'Dom (poziom 2)', carrying: null },
    workControls: { assignHome: true, unassignHome: true },
    military: { stance: 'defend', regeneration: false },
    experience: [
      ['Walka - Miecz', 7, 9],
      ['Walka - Pięści', 2, 1],
    ],
    unlocks: [],
    equipment: [
      { label: 'Broń', slots: [['sword_shord', null]] },
      { label: 'Zbroja', slots: [null] },
      { label: 'Buty', slots: [['shoes', 41]] },
      { label: 'Ekwipunek', slots: [['mead', null], ['bread', null], null, null] },
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
    note: 'Dziecko mieszka z rodzicami i nie ma zawodu, dopóki nie dorośnie.',
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
    bars: [
      ['Zdrowie', 100],
      ['Sytość', 71],
      ['Sen', 90],
      ['Towarzystwo', 66],
      ['Religia', 80],
    ],
    work: { place: null, home: null, carrying: null },
    workControls: { assign: 'Najpierw wybierz zawód', assignHome: true },
    experience: [],
    unlocks: [],
    equipment: [
      { label: 'Buty', slots: [null] },
      { label: 'Narzędzia', slots: [null] },
      { label: 'Ekwipunek', slots: [null, null, null, null] },
    ],
    orders: ['profession'],
  },
  trader: {
    label: 'Kupiec',
    name: 'Knut Eriksson',
    look: LOOK.man,
    profession: 'Kupiec',
    meta: null,
    status: 'Idzie',
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
        ['2 × Drewno → 1 × Skóra', true],
        ['3 × Kamień → 1 × Żelazo', false],
      ],
      status: 'Wiezie 2 × Skóra do Magazyn · Wikingowie',
    },
    experience: [['Kupiec', 5, null]],
    unlocks: [],
    equipment: [
      { label: 'Buty', slots: [['shoes', 70]] },
      { label: 'Narzędzia', slots: [null] },
      { label: 'Ekwipunek', slots: [null, null, null, null] },
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
    foreign: 'Osadnik innego plemienia. Tylko podgląd, bez rozkazów.',
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
  return `${state.status} · niesie <b class="with-good">${good(carrying[0])}${carrying[1]}</b>`;
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
        return `<li class="prod-row locked" title="${row.locked}"><span class="prod-good">${good(row.good)}</span><span class="prod-name">${label}</span><span class="prod-lock">${svg('i-lock')}<small>${row.lockShort}</small></span></li>`;
      }
      const stopped = row.count === 0;
      return `<li class="prod-row${stopped ? ' stopped' : ''}" data-count="${row.count}"><button type="button" class="prod-good" title="Tylko ten produkt: pozostałe zatrzymaj" aria-label="Tylko ${label}">${good(row.good)}</button><span class="prod-name">${label}</span><span class="counter"><button type="button" class="counter-step" data-step="-1" title="Obniż produkcję · Shift: zatrzymaj" aria-label="Mniej: ${label}">${svg('i-minus')}</button><b class="counter-value" aria-live="polite">${counterText(row.count)}</b><button type="button" class="counter-step" data-step="1" title="Zwiększ produkcję · Shift: bez końca" aria-label="Więcej: ${label}">${svg('i-plus')}</button></span></li>`;
    })
    .join('');
  return `<div class="section-title">Produkcja</div><ul class="prod-list">${rows}</ul>`;
}

function controlButton(icon, label, enabled) {
  const reason = typeof enabled === 'string' ? enabled : null;
  const on = enabled === true;
  const title = reason ?? label;
  return `<button type="button" class="ledger-btn" ${on ? '' : 'aria-disabled="true"'} title="${title}" aria-label="${label}">${svg(icon)}</button>`;
}

function workMarkup(state) {
  const { work, workControls } = state;
  const rows = [];
  if (!state.foreign && state.profession !== 'Dziecko' && state.profession !== 'Kobieta' && !state.military) {
    const btns = state.foreign
      ? ''
      : `<span class="ledger-btns">${controlButton('i-target', 'Przydziel miejsce pracy', workControls.assign ?? 'Ta osoba nie ma zawodu')}${controlButton('i-close', 'Usuń miejsce pracy', workControls.unassign ?? (work.place === null ? 'Nie ma miejsca pracy' : false))}</span>`;
    rows.push(
      `<div class="kv kv-ctl"><span>Miejsce pracy</span>${work.place === null ? '<b class="muted">brak</b>' : `<button type="button" class="kv-link" title="Zaznacz budynek">${work.place}</button>`}${btns}</div>`,
    );
  } else if (work.place !== null) {
    rows.push(`<div class="kv"><span>Miejsce pracy</span><b>${work.place}</b></div>`);
  }
  if (!state.foreign) {
    const canHome = workControls.assignHome ?? 'Dziecko mieszka z rodzicami';
    const canLeave =
      workControls.unassignHome ?? (work.home === null ? 'Nie ma domu' : 'Dziecko mieszka z rodzicami');
    const btns =
      state.profession === 'Dziecko' || state.profession === 'Bohater'
        ? ''
        : `<span class="ledger-btns">${controlButton('i-target', 'Przydziel dom', canHome)}${controlButton('i-close', 'Wyprowadź z domu', canLeave)}</span>`;
    rows.push(
      `<div class="kv kv-ctl"><span>Dom</span>${work.home === null ? '<b class="muted">brak</b>' : `<button type="button" class="kv-link" title="Zaznacz budynek">${work.home}</button>`}${btns}</div>`,
    );
  }
  if (rows.length === 0) return '';
  return `<div class="section-title">Praca i dom</div>${rows.join('')}${state.note ? `<p class="hint">${state.note}</p>` : ''}${state.production ? productionMarkup(state.production) : ''}`;
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
            `<button type="button" class="import" aria-pressed="${on}" title="${on ? 'Przestań przywozić' : 'Przywoź'}: ${GOODS[id]}">${good(id)}<span>${GOODS[id]}</span></button>`,
        )
        .join('');
      return `<li class="stop${stop.foreign ? ' foreign' : ''}"><div class="kv kv-ctl"><span>${stop.foreign ? 'Obcy punkt' : 'Punkt'}</span><b>${stop.label}</b><span class="ledger-btns">${controlButton('i-close', 'Usuń punkt handlowy', true)}</span></div><div class="imports">${imports}</div></li>`;
    })
    .join('');
  const offers = trade.offers
    .map(([label, on]) => `<button type="button" class="offer" aria-pressed="${on}">${label}</button>`)
    .join('');
  return `<div class="section-title">Handel</div><ul class="stops">${stops}</ul><div class="orders orders-inline"><button type="button">${svg('i-target')}Dodaj punkt handlowy</button></div><div class="kv"><span>Umowa</span></div><div class="offers">${offers}</div><p class="hint">${trade.status}</p>`;
}

const EXPERIENCE_SHOWN = 3;

function experienceMarkup(state) {
  if (state.experience === null) return '';
  const trained = [...state.experience].sort((a, b) => b[1] - a[1]);
  const rows = trained.map(
    ([label, repeats, bonus], index) =>
      `<div class="kv${index >= EXPERIENCE_SHOWN ? ' more' : ''}"><span>${label}</span><b>${repeats}${bonus === null ? '' : ` <small>+${bonus}%</small>`}</b></div>`,
  );
  const hidden = trained.length - EXPERIENCE_SHOWN;
  if (hidden > 0)
    rows.push(
      `<button type="button" class="kv-more" aria-expanded="false" data-more="${hidden}">Pokaż ${hidden} więcej</button>`,
    );
  for (const [job, current, required, track] of state.unlocks ?? []) {
    rows.push(
      `<div class="kv unlock" title="Postęp do zawodu ${job} przez ${track}"><span>${job} <small>(${track})</small></span><b>${current} / ${required}</b></div><div class="meter mini" style="--value:${Math.round((current / required) * 100)}%"></div>`,
    );
  }
  if (rows.length === 0) rows.push('<p class="hint">Jeszcze bez doświadczenia.</p>');
  return `<div class="section-title">Doświadczenie</div><div class="experience">${rows.join('')}</div>`;
}

function socket(slot, fixed) {
  if (slot === null) {
    return fixed
      ? '<span class="socket empty fixed" aria-hidden="true"></span>'
      : `<button type="button" class="socket empty" title="Załóż przedmiot" aria-label="Załóż">${svg('i-plus')}</button>`;
  }
  const [id, condition] = slot;
  const wear = condition === null ? '' : `<i class="wear" style="--value:${condition}%"></i>`;
  const cls = condition !== null && condition < 25 ? ' worn' : '';
  if (fixed) return `<span class="socket${cls}" title="${GOODS[id]}">${good(id)}${wear}</span>`;
  return `<span class="socket-group"><button type="button" class="socket${cls}" title="${GOODS[id]}${condition === null ? '' : ` · ${condition}%`} · Wymień" aria-label="Wymień: ${GOODS[id]}">${good(id)}${wear}</button><button type="button" class="socket-off" title="Zdejmij: ${GOODS[id]}" aria-label="Zdejmij: ${GOODS[id]}">${svg('i-close')}</button></span>`;
}

function equipmentMarkup(state) {
  if (state.equipment === null) return '';
  const groups = state.equipment
    .map(
      (row) =>
        `<div class="equip-group${row.slots.length > 1 ? ' wide' : ''}"><span class="sockets">${row.slots.map((slot) => socket(slot, row.fixed === true)).join('')}</span><small>${row.label}</small></div>`,
    )
    .join('');
  return `<div class="equipment" aria-label="Ekwipunek">${groups}</div>`;
}

function ordersMarkup(state) {
  const buttons = {
    profession: `<button type="button">${svg('i-forge')}Zmień zawód</button>`,
  };
  const orders = state.orders.map((id) => buttons[id]);
  return orders.length === 0 ? '' : `<div class="orders">${orders.join('')}</div>`;
}

function panelMarkup(key, state) {
  const bars = state.bars
    .map(
      ([label, value]) =>
        `<div class="bar-row"><span>${label}</span><span class="meter" style="--value:${value}%" role="meter" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100" aria-label="${label}"></span><b>${value}%</b></div>`,
    )
    .join('');
  return `<aside class="selection panel" data-selection="${key}" hidden aria-label="Zaznaczenie: ${state.name}">
    <svg aria-hidden="true" class="frame-knot"><use href="#i-knot"/></svg>
    <svg aria-hidden="true" class="corner tl"><use href="#i-corner"/></svg><svg aria-hidden="true" class="corner tr"><use href="#i-corner"/></svg><svg aria-hidden="true" class="corner bl"><use href="#i-corner"/></svg><svg aria-hidden="true" class="corner br"><use href="#i-corner"/></svg>
    <header class="window-head"><div><p>${state.profession.toUpperCase()}</p><h2>${state.name}</h2>${state.meta ? `<div class="meta">${state.meta}</div>` : ''}</div><span class="head-btns">${state.foreign ? '' : `<button type="button" class="icon-button medallion" title="Rozkazy dla tej osoby" aria-label="Rozkazy"><svg aria-hidden="true" class="icon"><use href="#i-list"/></svg></button>`}<button type="button" class="icon-button medallion" aria-label="Usuń zaznaczenie"><svg aria-hidden="true" class="icon"><use href="#i-close"/></svg></button></span></header>
    <div class="selection-body">
      <div class="portrait${state.equipment ? '' : ' alone'}">
        <button type="button" class="portrait-box" title="Centruj widok na tej osobie"><span data-settler="${state.look}"></span></button>
        ${equipmentMarkup(state)}
      </div>
      <div class="status">${statusText(state)}</div>
      ${state.foreign ? `<p class="hint foreign-note">${state.foreign}</p>` : ''}
      <div class="section-title">Samopoczucie</div>
      <div class="bars">${bars}</div>
      ${workMarkup(state)}
      ${state.military ? militaryMarkup(state.military) : ''}
      ${state.trade ? tradeMarkup(state.trade) : ''}
      ${experienceMarkup(state)}
    </div>
    ${ordersMarkup(state)}
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
  else next = current === INFINITE ? 0 : current === COUNTER_MAX ? INFINITE : current + 1;
  row.dataset.count = next;
  row.classList.toggle('stopped', next === 0);
  row.querySelector('.counter-value').textContent = counterText(next);
});
host.addEventListener('click', (event) => {
  const only = event.target.closest('.prod-good');
  if (only === null) return;
  const list = only.closest('.prod-list');
  for (const row of list.querySelectorAll('.prod-row:not(.locked)')) {
    const mine = row.contains(only);
    row.dataset.count = mine ? INFINITE : 0;
    row.classList.toggle('stopped', !mine);
    row.querySelector('.counter-value').textContent = counterText(mine ? INFINITE : 0);
  }
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
  more.textContent = open ? 'Pokaż mniej' : `Pokaż ${more.dataset.more} więcej`;
  more.parentElement.classList.toggle('expanded', open);
});
host.addEventListener('click', (event) => {
  if (event.target.closest('[aria-disabled="true"]')) event.preventDefault();
  if (event.target.closest('.window-head .medallion')) show('empty');
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
