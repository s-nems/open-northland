// Selected-vehicle panel review states. Sample vehicles stand in for the snapshot; nothing here reads game
// state. The page loads the runtime stylesheet and reads the runtime glyph and symbol sources as text, so
// every existing primitive (window, ledger, meter, status strip, trade stops) looks as it does in game.
const hud = document.querySelector('[data-hud]');
const stage = document.querySelector('[data-stage]');
const chip = document.querySelector('[data-chip]');

const source = async (path) => (await fetch(path)).text();
const [iconsTs, symbolsTs] = await Promise.all([source('/hud/dom/icons.ts'), source('/hud/dom/symbols.ts')]);
const GLYPH = Object.fromEntries(
  [...iconsTs.matchAll(/(\w+):\s*'(<svg[^']*)'/g)].map((match) => [match[1], match[2]]),
);
const TAB_GLYPHS = [...iconsTs.slice(iconsTs.indexOf('STOCK_TAB_GLYPHS')).matchAll(/'(<svg[^']*)'/g)]
  .slice(0, 8)
  .map((match) => match[1]);
const symbols = symbolsTs.match(/HUD_SYMBOLS = `([\s\S]*?)`;/)?.[1] ?? '';
const ORNAMENTS = `<svg aria-hidden="true" class="on-window__knot"><use href="#on-knot"/></svg>${[
  'tl',
  'tr',
  'bl',
  'br',
]
  .map(
    (c) =>
      `<svg aria-hidden="true" class="on-window__corner on-window__corner--${c}"><use href="#on-corner"/></svg>`,
  )
  .join('')}`;

// The order glyphs, from the runtime table.
const ORDER_GLYPH = {
  goTo: GLYPH.pin,
  stop: GLYPH.stop,
  dock: GLYPH.anchor,
  boardShip: GLYPH.boardShip,
  leaveShip: GLYPH.leaveShip,
  attackPeople: GLYPH.swords,
  attackBuilding: GLYPH.siegeHouse,
  attackVehicle: GLYPH.wheel,
  attackPosition: GLYPH.crosshair,
  addPerson: GLYPH.addPerson,
};

// Category of each sample good, the runtime's `goodCategoryTab`.
const CATEGORY = {
  bread: 0,
  fish: 0,
  meat: 0,
  wheat: 0,
  flour: 0,
  food_simple: 0,
  water: 1,
  mead: 1,
  wood: 2,
  stone: 2,
  mud: 2,
  iron: 2,
  gold: 2,
  leather: 2,
  wool: 2,
  brick: 3,
  tile: 3,
  pillar: 3,
  tool_wooden: 4,
  tool_iron: 4,
  crockery: 5,
  furniture: 5,
  shoes: 5,
  sword_shord: 6,
  spear_iron: 6,
  bow_short: 6,
  armor_leather: 6,
  coin: 7,
};
const GOOD_NAME = {
  bread: 'Chleb',
  fish: 'Ryba',
  meat: 'Mięso',
  wheat: 'Zboże',
  flour: 'Mąka',
  food_simple: 'Żywność',
  water: 'Woda',
  mead: 'Miód pitny',
  wood: 'Drewno',
  stone: 'Kamień',
  mud: 'Glina',
  iron: 'Żelazo',
  gold: 'Złoto',
  leather: 'Skóra',
  wool: 'Wełna',
  brick: 'Cegła',
  tile: 'Dachówka',
  pillar: 'Kolumna',
  tool_wooden: 'Drewniane narzędzie',
  tool_iron: 'Żelazne narzędzie',
  crockery: 'Naczynia',
  furniture: 'Meble',
  shoes: 'Buty',
  sword_shord: 'Krótki miecz',
  spear_iron: 'Żelazna włócznia',
  bow_short: 'Krótki łuk',
  armor_leather: 'Skórzana zbroja',
  coin: 'Moneta',
};
const TAB_LABELS = ['Żywność', 'Napoje', 'Surowce', 'Budulec', 'Narzędzia', 'Wyroby', 'Wojsko', 'Inne'];

// Good icons: the runtime's `goodIconSource` + `goodIconStyle` against the served content.
const GOOD_BOX_PX = 25;
const GOOD_MASS_PX = 19.5;
const GOOD_MARGIN_PX = 1;
const manifest = await fetch('/goods/manifest.json')
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
const atlases = new Map();
async function iconStyle(goodId, box) {
  const icon = manifest?.icons[goodId];
  if (icon === undefined) return null;
  const stem = manifest.previewStem.replace(/\.[^.]+$/, `.${icon.palette}`);
  if (!atlases.has(stem))
    atlases.set(
      stem,
      fetch(`/bobs/${stem}.atlas.json`).then((r) => r.json()),
    );
  const atlas = await atlases.get(stem);
  const rect = atlas.frames.find((f) => f.bobId === icon.frame)?.rect;
  if (rect === undefined) return null;
  const k = box / GOOD_BOX_PX;
  const s = Math.min(
    (GOOD_MASS_PX * k) / Math.sqrt(rect.width * rect.height),
    (box - GOOD_MARGIN_PX * k) / Math.max(rect.width, rect.height),
  );
  const px = (n) => `${n.toFixed(2)}px`;
  return `width:${px(rect.width * s)};height:${px(rect.height * s)};background-image:url("/bobs/${stem}.png");background-size:${px(atlas.width * s)} ${px(atlas.height * s)};background-position:${px(-rect.x * s)} ${px(-rect.y * s)};`;
}
const good = (id, box = 20) =>
  `<span class="on-good" aria-hidden="true" style="width:${box}px;height:${box}px"><i class="on-good__frame" data-good="${id}" data-box="${box}"></i></span>`;
async function paintGoods(root) {
  for (const frame of root.querySelectorAll('[data-good]')) {
    const style = await iconStyle(frame.dataset.good, Number(frame.dataset.box));
    if (style !== null) frame.style.cssText = style;
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const tip = (text) => (text ? ` data-tip="${esc(text)}"` : '');
const section = (title, control = '') => `<div class="on-section"><span>${title}</span>${control}</div>`;
const link = (text, tooltip = '', extra = '') =>
  `<button class="on-ledger__link${extra}" type="button"${tip(tooltip)}>${text}</button>`;
const round = (glyph, tooltip, disabled = false) =>
  `<button class="on-round" type="button" aria-label="${esc(tooltip)}"${tip(tooltip)}${disabled ? ' aria-disabled="true"' : ''}>${glyph}</button>`;
const ledger = (label, value, buttons = []) =>
  `<div class="on-ledger${buttons.length ? ' on-ledger--ctl' : ''}"><span><span>${label}</span></span><b class="on-ledger__value">${value}</b>${
    buttons.length ? `<span class="on-ledger__btns">${buttons.join('')}</span>` : ''
  }</div>`;
// ---------------------------------------------------------------- sections

function head(v) {
  const browse = v.browse
    ? `<button class="on-browse" type="button"${tip(`Poprzedni ${v.browse.of} · Shift+Tab`)}>${GLYPH.back}</button><span${tip(`Dwuklik: zaznacz wszystkie (${v.browse.count})`)}><span>${v.kicker}</span> <small>${v.browse.index} / ${v.browse.count}</small></span><button class="on-browse" type="button"${tip(`Następny ${v.browse.of} · Tab`)}>${GLYPH.next}</button>`
    : `<span><span>${v.kicker}</span></span>`;
  return `<header class="on-window__head">
    <button class="on-medallion on-medallion--gold on-selection__medallion on-medallion--void" type="button"></button>
    <div class="on-selection__heading">
      <p class="on-kicker">${browse}</p>
      <h2 class="on-selection__title"><span>${v.title}</span></h2>
      ${v.meta ? `<div class="on-selection__meta">${v.meta}</div>` : ''}
    </div>
    <button class="on-medallion on-selection__medallion" type="button"${tip('Usuń zaznaczenie')}>${GLYPH.close}</button>
  </header>`;
}

function portrait(v) {
  const orders = (v.orders ?? [])
    .map((o) =>
      o === null
        ? '<span></span>'
        : `<button class="on-order${o.attack ? ' on-order--attack' : ''}${o.armed ? ' on-order--armed' : ''}" type="button" aria-label="${esc(o.label)}"${tip(o.tip ?? o.label)}${o.disabled ? ' aria-disabled="true"' : ''}>${ORDER_GLYPH[o.glyph]}</button>`,
    )
    .join('');
  const tone =
    v.status.tone === 'trouble'
      ? ' on-status-strip--trouble'
      : v.status.tone === 'neutral'
        ? ' on-status-strip--neutral'
        : '';
  return `<div class="on-portrait">
    <div class="on-vehicle-shot">
      <button class="on-portrait__frame vx-shot" type="button" style="${v.shot}"${tip('Centruj widok na pojeździe')}></button>
      <span class="on-hp${v.hp < 34 && v.hp >= 17 ? ' on-hp--low' : ''}${v.hp < 17 ? ' on-hp--critical' : ''}" role="meter" style="--value:${v.hp}%"${tip(`Wytrzymałość ${Math.round((v.hp * v.hpMax) / 100)} / ${v.hpMax}`)}></span>
    </div>
    <div class="on-portrait__beside">
      <div class="on-orders">${orders}</div>
      <div class="on-status-strip${tone}"><i class="on-status-strip__dot"></i><span>${v.status.text}</span></div>
    </div>
  </div>`;
}

function military(v) {
  if (!v.stance) return '';
  const seg = [
    ['attack', 'Atak', 'Szuka celów wokół miejsca, w którym stoi, i ściga je'],
    ['defence', 'Obrona', 'Pilnuje tego miejsca: ściga pobliskie cele i wraca'],
    ['hold', 'Pozycja', 'Nie rusza się: strzela tylko do celów w zasięgu'],
  ]
    .map(([k, l, t]) => `<button type="button" aria-pressed="${k === v.stance}"${tip(t)}>${l}</button>`)
    .join('');
  return `<div>${section('Wojsko')}<div class="on-ledger on-ledger--ctl"><span>Postawa</span><span class="on-segmented" role="group">${seg}</span></div></div>`;
}

const FIGURE = { man: GLYPH.man, woman: GLYPH.woman };
function crew(v) {
  const c = v.crew;
  if (!c) return '';
  const count = c.seats
    ? `<span class="on-section__count"${tip('Miejsca zajęte / wszystkie')}>${c.count} / ${c.capacity}</span>`
    : '';
  const rows = [];
  const lead = c.commander;
  if (lead === null) {
    rows.push(
      ledger(
        c.role,
        link(
          `Przydziel ${c.roleWho}`,
          'Wskaż swojego osadnika na mapie · Esc anuluje',
          ' on-ledger--missing',
        ),
        [round(ORDER_GLYPH.addPerson, `Przydziel ${c.roleWho}`)],
      ),
    );
  } else if (lead) {
    const who = `${link(lead.name, `${lead.job} · kliknij: zaznacz`)}${lead.walking ? ' <small class="on-ledger--muted">idzie</small>' : ''}`;
    rows.push(ledger(c.role, who, v.foreign ? [] : [round(GLYPH.close, `Wysiądź: ${lead.name}`)]));
  }
  if (c.seats) {
    const wells = c.seats
      .map((s) => {
        if (s === null) return '<span class="on-seat-well on-seat-well--empty"></span>';
        if (s === 'add')
          return `<button class="on-seat-well on-seat-well--empty on-seat-well--add" type="button"${tip('Wsadź osadnika na pokład · Esc anuluje')}>${ORDER_GLYPH.addPerson}</button>`;
        const cls = `${s.walking ? ' on-seat-well--walking' : ''}${s.look === 'woman' ? ' on-seat-well--woman' : ''}${s.soldier ? ' on-seat-well--soldier' : ''}`;
        const note = s.walking ? ' · idzie na pokład' : '';
        return `<button class="on-seat-well${cls}" type="button"${tip(v.foreign ? `${s.job}` : `${s.name} · ${s.job}${note} · kliknij: zaznacz`)}>${FIGURE[s.look]}</button>`;
      })
      .join('');
    rows.push(`<div class="on-seats">${wells}</div>`);
  }
  if (c.deck !== undefined) {
    rows.push(
      ledger(
        'Pojazd',
        c.deck === null
          ? '<span class="on-ledger--muted">brak pojazdu</span>'
          : link(c.deck, 'Kliknij: zaznacz wóz'),
        c.deck === null
          ? [round(ORDER_GLYPH.boardShip, 'Wprowadź wóz na pokład · Wskaż swój wóz na mapie · Esc anuluje')]
          : [round(ORDER_GLYPH.leaveShip, `Zjedź na ląd: ${c.deck}`, !v.moored)],
      ),
    );
  }
  const unload = c.unload
    ? `<button class="on-more on-section__control" type="button"${tip(c.unload.tip)}${c.unload.disabled ? ' aria-disabled="true" style="opacity:.45"' : ''}>${c.unload.label}</button>`
    : '';
  return `<div>${section(`Załoga`, `<span class="on-section__group on-section__control">${count}${unload}</span>`)}${rows.join('')}</div>`;
}

function trade(v) {
  const t = v.trade;
  if (!t) return '';
  const stop = (badge, name, heading) =>
    `<li class="on-stop${heading ? ' on-stop--heading' : ''}"><span class="on-stop__badge">${badge}</span>${link(name, '', ' on-stop__name')}<span class="on-stop__heading"${tip('Kupiec jedzie teraz tutaj')}>${GLYPH.arrow}</span>${round(GLYPH.close, 'Zdejmij ten dom z trasy')}</li>`;
  const lines = t.lines
    .map(
      (l) =>
        `<li class="on-trade-line"><span class="on-good-well">${good(l.good, 18)}</span><span class="on-trade-line__name">${GOOD_NAME[l.good]}</span><b class="on-trade-line__summary">${l.summary}</b></li>`,
    )
    .join('');
  return `<div>${section('Handel')}
    <div class="on-trade-route"><ul class="on-stops">${stop('A', t.a, t.heading === 'A')}${stop('B', t.b, t.heading === 'B')}</ul>
    <div class="on-trade-joint"><button class="on-medallion on-trade-configure" type="button"${tip('Konfiguruj handel')}>${GLYPH.scales}</button></div></div>
    <ul class="on-trade-lines">${lines}</ul></div>`;
}

function hold(v) {
  const h = v.hold;
  if (!h) return '';
  const aboard = h.rows.reduce((n, r) => n + r.now, 0);
  const coming = h.rows.reduce((n, r) => n + Math.max(0, r.coming ?? 0), 0);
  const target = h.rows.reduce((n, r) => n + (r.want ?? r.now), 0);
  const pct = (n) => `${Math.min(100, (n / h.slots) * 100).toFixed(1)}%`;
  const gauge = `<div class="on-load"${tip(`Na pokładzie ${aboard}${coming ? `, w drodze ${coming}` : ''}${h.static ? '' : `, cel ${target}`} · miejsc ${h.slots}`)}>
    <div class="on-load__bar"><span class="on-load__aboard" style="width:${pct(aboard)}"></span><span class="on-load__coming" style="left:${pct(aboard)};width:${pct(coming)}"></span>${h.static ? '' : `<span class="on-load__target" style="left:calc(${pct(target)} - 1px)"></span>`}</div>
    <b>${aboard}<small> / ${h.slots}</small></b></div>`;
  const rows = h.rows
    .map((r) => {
      const fill = r.want ? Math.min(100, (r.now / Math.max(r.want, 1)) * 100) : r.now > 0 ? 100 : 0;
      const leaving = !h.static && r.want < r.now;
      const now = `<span class="on-cargo-row__now"${tip(`Na pokładzie ${r.now}${r.coming ? `, w drodze ${r.coming}` : ''}${h.static ? '' : ` · cel ${r.want}`}${leaving ? ' · nadmiar zejdzie do magazynu' : ''}`)}>${r.now}${r.coming ? `<small> +${r.coming}</small>` : ''}${h.static ? '' : '<em>→</em>'}</span>`;
      const counter = h.static
        ? ''
        : `<span class="on-counter"><button class="on-counter__step" type="button" aria-label="Mniej"${tip('Mniej · Shift: 0 · Ctrl: −10')}>${GLYPH.minus}</button><b class="on-counter__value">${r.want}</b><button class="on-counter__step" type="button" aria-label="Więcej"${tip(h.room > 0 ? 'Więcej · Shift: do pełna · Ctrl: +10' : 'Ładownia jest już w całości rozdzielona')}${h.room > 0 ? '' : ' aria-disabled="true"'}>${GLYPH.plus}</button></span>`;
      return `<li class="on-cargo-row${h.static ? ' on-cargo-row--static' : ''}${leaving ? ' on-cargo-row--leaving' : ''}" style="--fill:${fill}%"><span class="on-good-well">${good(r.good, 18)}</span><span class="on-cargo-row__name">${GOOD_NAME[r.good]}</span>${now}${counter}</li>`;
    })
    .join('');
  const more = h.more
    ? `<li class="on-cargo-add"><button class="on-more" type="button"${tip('Pokaż wszystkie towary na liście')}>jeszcze ${h.more} towary</button></li>`
    : '';
  const add = h.static
    ? ''
    : `<li class="on-cargo-add">${round(GLYPH.plus, 'Dodaj towar do listy załadunku')}<button class="on-more" type="button"${tip('Wybierz towar, który ma być załadowany')}>Dodaj towar</button></li>`;
  const empty =
    h.rows.length === 0
      ? `<li class="on-cargo-add"><span class="on-ledger--muted">${h.static ? 'Pusty' : 'Nic nie załadowano'}</span></li>`
      : '';
  const flag = h.flag ? `<span class="on-flag"${tip(h.flag.tip)}>${h.flag.text}</span>` : '';
  const control = h.static
    ? `<span class="on-section__count"${tip('Ładunek prowadzi trasa handlowa')}>według trasy</span>`
    : `<button class="on-more on-section__control" type="button"${tip('Wszystko wraca do magazynu · cele na 0')}>Rozładuj wszystko</button>`;
  return `<div>${section('Ładownia', `<span class="on-section__group on-section__control">${flag}${control}</span>`)}${gauge}<ul class="on-manifest">${rows}${empty}${more}${v.picker ? '' : add}</ul>${v.picker ? picker(h) : ''}</div>`;
}

function picker(h) {
  const listed = new Set(h.rows.map((r) => r.good));
  const tabs = TAB_GLYPHS.map(
    (g, i) =>
      `<button class="on-tab on-tab--icon" type="button" role="tab" aria-selected="${i === 2}"${tip(TAB_LABELS[i])}>${g}<i class="on-tab__dot"></i></button>`,
  ).join('');
  const goods = Object.keys(CATEGORY).filter((g) => CATEGORY[g] === 2);
  const cells = goods
    .map(
      (g) =>
        `<button type="button" aria-pressed="${listed.has(g)}"${tip(listed.has(g) ? `${GOOD_NAME[g]} · już na liście` : `${GOOD_NAME[g]} · dodaj do listy`)}>${good(g, 24)}</button>`,
    )
    .join('');
  return `<div class="on-cargo-picker"><div class="on-cargo-picker__title"><span>Dodaj towar · Surowce</span><button class="on-round" type="button"${tip('Zamknij · Esc')}>${GLYPH.close}</button></div><div class="on-tabs on-tabs--icons" role="tablist">${tabs}</div><div class="on-cargo-picker__grid">${cells}</div></div>`;
}

// ---------------------------------------------------------------- sample vehicles

const shot = (file, x, y, zoom = 1) =>
  `background-image:url(/vehicle-review/${file}.png);background-size:${1280 * zoom}px ${720 * zoom}px;background-position:${-x * zoom}px ${-y * zoom}px`;
const man = (name, job, extra = {}) => ({ name, job, look: 'man', ...extra });
const woman = (name, job, extra = {}) => ({ name, job, look: 'woman', ...extra });
const CART_ORDERS = (o = {}) => [
  { glyph: 'goTo', label: 'Jedź do…', tip: o.goTip ?? 'Jedź do… · lub PPM na mapie', disabled: o.noDriver },
  { glyph: 'stop', label: 'Zatrzymaj', disabled: o.noDriver },
  {
    glyph: 'boardShip',
    label: 'Wjedź na statek…',
    tip: 'Wjedź na statek… · lub PPM na zacumowany statek',
    disabled: o.noDriver,
  },
];

const STATES = {
  handcart: {
    bg: 'carts',
    kicker: 'Wóz',
    browse: { index: 1, count: 3, of: 'wóz' },
    title: 'Wózek ręczny',
    shot: shot('carts', 671, 170, 1),
    orders: CART_ORDERS(),
    status: { text: `Jedzie · do Magazyn (poziom 1)` },
    hp: 100,
    hpMax: 1000,
    crew: { role: 'Woźnica', roleWho: 'woźnicę', commander: man('Kettil Sigvatsson', 'Kupiec') },
    trade: {
      trader: 'kupiec: Kettil',
      a: 'Magazyn (poziom 1)',
      b: 'Magazyn przy kopalni',
      heading: 'B',
      lines: [
        { good: 'iron', summary: 'B → A · zostaw 5' },
        { good: 'bread', summary: 'A → B · do 20' },
        { good: 'wood', summary: 'A ⇄ B' },
      ],
    },
    hold: {
      slots: 15,
      static: true,
      rows: [
        { good: 'bread', now: 6 },
        { good: 'wood', now: 3 },
      ],
    },
  },
  oxcart: {
    bg: 'carts',
    kicker: 'Wóz',
    browse: { index: 2, count: 3, of: 'wóz' },
    title: 'Wóz wołowy',
    shot: shot('carts', 668, 433, 1),
    orders: CART_ORDERS(),
    status: { text: 'Ładuje · tragarz niesie drewno' },
    hp: 72,
    hpMax: 1000,
    crew: { role: 'Woźnica', roleWho: 'woźnicę', commander: man('Eindride Kolbeinsson', 'Tragarz') },
    hold: {
      slots: 30,
      room: 4,
      rows: [
        { good: 'wood', now: 8, coming: 1, want: 12 },
        { good: 'stone', now: 4, want: 4 },
        { good: 'iron', now: 0, coming: 1, want: 6 },
        { good: 'bread', now: 3, want: 0 },
      ],
    },
  },
  'oxcart-empty': {
    bg: 'carts',
    kicker: 'Wóz',
    browse: { index: 3, count: 3, of: 'wóz' },
    title: 'Wóz wołowy',
    shot: shot('carts', 668, 433, 1),
    orders: CART_ORDERS({ noDriver: true, goTip: 'Wóz nie ma woźnicy' }),
    status: { text: 'Czeka na woźnicę', tone: 'trouble' },
    hp: 100,
    hpMax: 1000,
    crew: { role: 'Woźnica', roleWho: 'woźnicę', commander: null },
    hold: {
      slots: 30,
      room: 20,
      flag: {
        text: 'bez tragarza',
        tip: 'Nikt nie załaduje ani nie rozładuje wozu. Przydziel woźnicę: kupca lub tragarza.',
      },
      rows: [{ good: 'stone', now: 10, want: 10 }],
    },
  },
  'ship-moored': {
    bg: 'ships',
    kicker: 'Statek',
    browse: { index: 1, count: 2, of: 'statek' },
    title: 'Mały statek',
    shot: shot('ships', 793, 153, 0.32),
    orders: [
      { glyph: 'goTo', label: 'Płyń do…', tip: 'Płyń do… · lub PPM na wodzie' },
      { glyph: 'stop', label: 'Zatrzymaj' },
      {
        glyph: 'dock',
        label: 'Zacumuj przy brzegu…',
        tip: 'Zacumuj przy brzegu… · lub PPM na brzegu',
        armed: false,
      },
    ],
    moored: true,
    status: { text: 'Zacumowany · przystań zachodnia', tone: 'neutral' },
    hp: 94,
    hpMax: 5000,
    crew: {
      role: 'Kapitan',
      roleWho: 'kapitana',
      commander: man('Ragnar Ulfsson', 'Tragarz'),
      count: 7,
      capacity: 19,
      seats: [
        man('Bjorn Haraldsson', 'Kowal'),
        man('Leif Eriksson', 'Drwal'),
        woman('Astrid', 'Kobieta'),
        woman('Sigrid', 'Kobieta'),
        man('Toke Gormsson', 'Żołnierz', { soldier: true }),
        man('Halfdan', 'Rybak', { walking: true }),
        'add',
        ...Array(12).fill(null),
      ],
      deck: 'Wóz wołowy',
      unload: { label: 'Wysadź wszystkich', tip: 'Wszyscy pasażerowie i wóz schodzą na ląd' },
    },
    hold: {
      slots: 50,
      room: 12,
      rows: [
        { good: 'wood', now: 20, want: 20 },
        { good: 'stone', now: 6, coming: 2, want: 10 },
        { good: 'bread', now: 4, want: 8 },
      ],
    },
  },
  'ship-sea': {
    bg: 'ships',
    kicker: 'Statek',
    browse: { index: 2, count: 2, of: 'statek' },
    title: 'Duży statek',
    shot: shot('ships', 793, 153, 0.32),
    orders: [
      { glyph: 'goTo', label: 'Płyń do…', tip: 'Płyń do… · lub PPM na wodzie', armed: true },
      { glyph: 'stop', label: 'Zatrzymaj' },
      { glyph: 'dock', label: 'Zacumuj przy brzegu…', tip: 'Zacumuj przy brzegu… · lub PPM na brzegu' },
    ],
    moored: false,
    status: { text: 'Płynie · do przystani wschodniej' },
    hp: 28,
    hpMax: 5000,
    crew: {
      role: 'Kapitan',
      roleWho: 'kapitana',
      commander: man('Ragnar Ulfsson', 'Tragarz'),
      count: 9,
      capacity: 10,
      seats: [
        man('Toke Gormsson', 'Żołnierz', { soldier: true }),
        man('Gorm', 'Żołnierz', { soldier: true }),
        man('Ulf', 'Żołnierz', { soldier: true }),
        man('Sven', 'Łucznik', { soldier: true }),
        man('Arne', 'Łucznik', { soldier: true }),
        man('Knut', 'Kapłan'),
        woman('Ingrid', 'Zielarka'),
        man('Harald', 'Budowniczy'),
        null,
      ],
      unload: { label: 'Wysadź wszystkich', tip: 'Najpierw zacumuj przy brzegu', disabled: true },
    },
    hold: {
      slots: 200,
      room: 0,
      rows: [
        { good: 'wood', now: 60, want: 60 },
        { good: 'stone', now: 40, want: 40 },
        { good: 'bread', now: 24, want: 30 },
        { good: 'mead', now: 10, want: 10 },
        { good: 'sword_shord', now: 12, want: 12 },
        { good: 'tool_iron', now: 8, want: 8 },
      ],
      more: 3,
    },
  },
  aboard: {
    bg: 'ships',
    kicker: 'Wóz',
    browse: { index: 2, count: 3, of: 'wóz' },
    title: 'Wóz wołowy',
    shot: shot('carts', 668, 433, 1),
    orders: [
      { glyph: 'goTo', label: 'Jedź do…', tip: 'Wóz stoi na statku', disabled: true },
      { glyph: 'stop', label: 'Zatrzymaj', disabled: true, tip: 'Wóz stoi na statku' },
      { glyph: 'leaveShip', label: 'Zjedź ze statku', tip: 'Zjedź ze statku na ląd' },
    ],
    status: {
      text: `Na statku · ${'<button class="on-ledger__link" type="button" data-tip="Kliknij: zaznacz statek">Mały statek</button>'}`,
      tone: 'neutral',
    },
    hp: 72,
    hpMax: 1000,
    crew: { role: 'Woźnica', roleWho: 'woźnicę', commander: man('Eindride Kolbeinsson', 'Tragarz') },
    hold: { slots: 30, room: 18, rows: [{ good: 'wood', now: 12, want: 12 }] },
  },
  catapult: {
    bg: 'catapult',
    kicker: 'Machina oblężnicza',
    browse: null,
    title: 'Katapulta',
    shot: shot('catapult', 270, 276, 0.8),
    orders: [
      { glyph: 'goTo', label: 'Jedź do…', tip: 'Jedź do… · lub PPM na mapie' },
      { glyph: 'stop', label: 'Zatrzymaj' },
      {
        glyph: 'boardShip',
        label: 'Wjedź na statek…',
        tip: 'Wjedź na statek… · lub PPM na zacumowany statek',
      },
      null,
      null,
      {
        glyph: 'attackPeople',
        label: 'Atakuj ludzi…',
        attack: true,
        tip: 'Atakuj ludzi… · lub PPM na wrogu',
      },
      {
        glyph: 'attackBuilding',
        label: 'Atakuj budynek…',
        attack: true,
        armed: true,
        tip: 'Atakuj budynek… · lub PPM na wrogim budynku',
      },
      { glyph: 'attackVehicle', label: 'Atakuj pojazd…', attack: true },
      { glyph: 'attackPosition', label: 'Ostrzelaj miejsce…', attack: true },
    ],
    status: { text: 'Atakuje · Dom mieszkalny' },
    hp: 81,
    hpMax: 3000,
    stance: 'defence',
    crew: { role: 'Obsługa', roleWho: 'obsługę', commander: man('Hakon Grimsson', 'Żołnierz') },
  },
  foreign: {
    bg: 'ships',
    kicker: 'Statek',
    browse: null,
    title: 'Mały statek',
    meta: 'Gracz 2 · Rzymianie · <span style="color:var(--danger)">wróg</span>',
    foreign: true,
    shot: shot('ships', 793, 153, 0.32),
    orders: [],
    status: { text: 'Płynie' },
    hp: 60,
    hpMax: 5000,
    crew: {
      role: 'Kapitan',
      commander: undefined,
      count: 12,
      capacity: 20,
      seats: [
        ...Array(8)
          .fill(0)
          .map(() => man('?', 'Żołnierz', { soldier: true })),
        ...Array(3)
          .fill(0)
          .map(() => man('?', 'Łucznik', { soldier: true })),
        man('?', 'Tragarz'),
        ...Array(7).fill(null),
      ],
    },
  },
};
STATES.picker = { ...STATES.oxcart, picker: true };

// ---------------------------------------------------------------- render

function render(key) {
  const v = STATES[key];
  stage.dataset.bg = v.bg;
  const foreign = v.foreign === true;
  const body = foreign ? [portrait(v), crew(v)] : [portrait(v), military(v), crew(v), trade(v), hold(v)];
  hud.innerHTML = `${symbols}<aside class="on-window on-selection" style="width:318px;bottom:0" aria-label="${esc(v.title)}"><div class="on-selection__fill"></div>${ORNAMENTS}${head(v)}<div class="on-selection__body">${body.join('')}</div></aside>`;
  paintGoods(hud);
  for (const b of document.querySelectorAll('[data-state]'))
    b.setAttribute('aria-pressed', String(b.dataset.state === key));
}

let tipTimer = 0;
hud.addEventListener('pointerover', (event) => {
  const target = event.target.closest?.('[data-tip]');
  clearTimeout(tipTimer);
  chip.hidden = true;
  if (!target) return;
  tipTimer = setTimeout(() => {
    chip.textContent = target.dataset.tip;
    chip.hidden = false;
    chip.style.left = `${event.clientX + 12}px`;
    chip.style.top = `${event.clientY + 18}px`;
  }, 450);
});
hud.addEventListener('pointerleave', () => {
  clearTimeout(tipTimer);
  chip.hidden = true;
});
for (const b of document.querySelectorAll('[data-state]'))
  b.addEventListener('click', () => render(b.dataset.state));
render(new URLSearchParams(location.search).get('state') ?? 'handcart');
