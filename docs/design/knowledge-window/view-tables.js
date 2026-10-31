import { buildingStatus, data, esc, goodById, goodIcon, number, seconds } from './model.js';

/** The target columns, keyed like a weapon's `damage` record. */
const COLUMNS = [
  { key: '0', name: 'Bez pancerza', person: true },
  { key: '1', name: 'Tunika', person: true, good: 'armor_wool' },
  { key: '2', name: 'Skórzana', person: true, good: 'armor_leather' },
  { key: '3', name: 'Kolczuga', person: true, good: 'armor_chain' },
  { key: '4', name: 'Płytowa', person: true, good: 'armor_plate' },
  { key: '6', name: 'Pojazd', person: false },
  { key: '7', name: 'Budynek', person: false },
];
const BYZANTINE = 3;
const HUMAN_HITPOINTS = 5000;
const BLOCKING_VALUE = 5;
const CAP_HITS = 100;
const RANGED_MAIN_TYPES = new Set([6, 7]);

const WEAPON_NAME = {
  fist: 'Pięści',
  woman_fist: 'Pięści kobiety',
  house_bow: 'Strzały z budynku',
  hunter_bow: 'Łuk myśliwego',
  catapult: 'Katapulta',
};
const SOLDIER_ORDER = [
  'fist',
  'wooden_spear',
  'iron_spear',
  'short_sword',
  'long_sword',
  'short_bow',
  'long_bow',
  'catapult',
];
const CIVILIAN_ORDER = ['woman_fist', 'hunter_bow', 'house_bow'];

/** The damage one blow lands under the chosen modifiers, in the sim's order: experience on a melee blow,
 *  then for a person direction, blocking and the amulets; a vehicle or building takes only the striker's. */
function landed(weapon, column, m) {
  const base = weapon.damage[column.key] ?? 0;
  const raised = RANGED_MAIN_TYPES.has(weapon.mainType)
    ? base
    : Math.trunc((base * 200) / (200 - Math.min(m.hits, CAP_HITS)));
  const strong = (value) => (m.strength ? Math.floor((value * 150) / 100) : value);
  if (!column.person) return Math.max(0, strong(raised));
  const directed = Math.trunc((raised * m.direction) / 100);
  const blocked = directed - (column.key === '0' ? 0 : BLOCKING_VALUE);
  const dealt = strong(blocked);
  return Math.max(0, m.defense ? Math.trunc(dealt / 2) : dealt);
}

function cellValue(weapon, column, m, metric) {
  const damage = landed(weapon, column, m);
  if (metric === 'damage') return { value: damage, text: number(damage) };
  if (metric === 'hits') {
    if (!column.person) return { value: null, text: '-' };
    const hits = damage === 0 ? null : Math.ceil(HUMAN_HITPOINTS / damage);
    return { value: hits === null ? null : 1 / hits, text: hits ?? '-' };
  }
  const perSecond = weapon.clipTicks === null ? 0 : damage / (weapon.clipTicks / 12);
  return { value: perSecond, text: number(Math.round(perSecond)) };
}

function segmented(name, options, value) {
  return `<div class="on-segmented">${options.map(([v, t]) => `<button aria-pressed="${String(v) === String(value)}" data-matrix="${name}:${v}">${t}</button>`).join('')}</div>`;
}

function matrixRows(rows, group, m, metric, peaks) {
  const cells = rows.map((weapon) => {
    const name = WEAPON_NAME[weapon.id] ?? weapon.goodName ?? weapon.jobName ?? weapon.id;
    const hero = weapon.id.startsWith('hero_');
    const label = hero ? weapon.jobName : name;
    const tds = COLUMNS.map((column) => {
      const { value, text } = cellValue(weapon, column, m, metric);
      const heat = value === null || peaks[column.key] === 0 ? 0 : value / peaks[column.key];
      return `<td class="kn-num kn-heat" style="--heat:${heat.toFixed(2)}">${text}</td>`;
    }).join('');
    return `<tr><th scope="row">${esc(label)}</th><td class="kn-num kn-dim">${weapon.minRange === weapon.maxRange ? weapon.maxRange : `${weapon.minRange}-${weapon.maxRange}`}</td><td class="kn-num kn-dim">${weapon.clipTicks === null ? '-' : `${seconds(weapon.clipTicks)} s`}</td>${tds}</tr>`;
  });
  return `<tr class="kn-table__group"><th colspan="${COLUMNS.length + 3}">${group}</th></tr>${cells.join('')}`;
}

function matrixTable(state) {
  const m = state.matrix;
  const weapons = data.weapons[state.tribe].filter((w) => w.usable);
  const pick = (ids) => ids.map((id) => weapons.find((w) => w.id === id)).filter(Boolean);
  const soldiers = pick(SOLDIER_ORDER);
  const civilians = pick(CIVILIAN_ORDER);
  const heroes = weapons.filter((w) => w.id.startsWith('hero_'));
  const shown = [...soldiers, ...civilians, ...(m.heroes ? heroes : [])];
  const peaks = {};
  for (const column of COLUMNS) {
    peaks[column.key] = Math.max(0, ...shown.map((w) => cellValue(w, column, m, m.metric).value ?? 0));
  }
  const heads = COLUMNS.map((c) => {
    const good = c.good === undefined ? null : goodById.get(c.good);
    return `<th class="kn-num">${good === null ? '' : goodIcon(good)}<span>${c.name}</span></th>`;
  }).join('');
  return `<h2 class="kn-title">Broń i pancerz</h2>
    <p class="kn-lead">Ile zabiera jeden cios. Człowiek ma ${number(HUMAN_HITPOINTS)} zdrowia. Zwierzę liczy się jak skórzana zbroja.</p>
    <div class="kn-controls">
      <label>Pokaż ${segmented(
        'metric',
        [
          ['damage', 'Obrażenia'],
          ['hits', 'Ciosy do śmierci'],
          ['dps', 'Na sekundę'],
        ],
        m.metric,
      )}</label>
      <label>Skąd cios ${segmented(
        'direction',
        [
          [100, 'Przód'],
          [125, 'Bok z tyłu ×1,25'],
          [150, 'Tył ×1,5'],
        ],
        m.direction,
      )}</label>
      <label>Trafienia ${segmented(
        'hits',
        [
          [0, '0'],
          [50, '50'],
          [100, '100+'],
        ],
        m.hits,
      )}</label>
      <label class="kn-check"><input type="checkbox" data-matrix-check="strength" ${m.strength ? 'checked' : ''}> Amulet Siły u atakującego</label>
      <label class="kn-check"><input type="checkbox" data-matrix-check="defense" ${m.defense ? 'checked' : ''}> Amulet Obrony u celu</label>
      <label class="kn-check"><input type="checkbox" data-matrix-check="heroes" ${m.heroes ? 'checked' : ''}> Bohaterowie</label>
    </div>
    <table class="kn-table kn-table--matrix">
      <thead><tr><th>Broń</th><th class="kn-num">Zasięg</th><th class="kn-num">Cios co</th>${heads}</tr></thead>
      <tbody>${matrixRows(soldiers, 'Wojsko', m, m.metric, peaks)}${matrixRows(civilians, 'Cywile i budynki', m, m.metric, peaks)}${m.heroes ? matrixRows(heroes, 'Bohaterowie', m, m.metric, peaks) : ''}</tbody>
    </table>
    <p class="kn-foot">Każdy pancerz odejmuje jeszcze ${BLOCKING_VALUE} od ciosu. Walka wręcz nie ma rzutu na trafienie, a Amulet Precyzji daje 20% szans na cios ×2. Doświadczenie podnosi tylko ciosy wręcz.</p>
    <p class="kn-foot">Wybór plemienia w pasku zmienia wiersze: broń różni się między plemionami.</p>
    ${state.tribe === BYZANTINE ? '<p class="kn-foot">Drewniana włócznia pokazuje tu smoka z mapy. Wyszkolony Bizantyjczyk walczy zwykłą drewnianą włócznią, okno rozróżni te dwie postacie.</p>' : ''}`;
}

function plainTable(title, lead, head, rows, foot = '') {
  return `<h2 class="kn-title">${title}</h2><p class="kn-lead">${lead}</p>
    <table class="kn-table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>${foot === '' ? '' : `<p class="kn-foot">${foot}</p>`}`;
}

const goodCell = (id) => {
  const good = goodById.get(id);
  return `<button class="kn-link" data-go="good:${id}">${goodIcon(good)}<span>${esc(good.name)}</span></button>`;
};

export const TABLES = [
  {
    group: 'Wojsko',
    items: [
      { id: 'matrix', name: 'Broń i pancerz' },
      { id: 'armour', name: 'Pancerze' },
      { id: 'towers', name: 'Wieże i schronienia' },
    ],
  },
  {
    group: 'Wyposażenie',
    items: [
      { id: 'tools', name: 'Narzędzia' },
      { id: 'draughts', name: 'Mikstury i miód' },
      { id: 'amulets', name: 'Amulety' },
    ],
  },
  {
    group: 'Ludzie',
    items: [
      { id: 'experience', name: 'Krzywa doświadczenia' },
      { id: 'jobs', name: 'Zawody i wymagania' },
      { id: 'food', name: 'Jedzenie i sen' },
      { id: 'walk', name: 'Szybkość chodu' },
    ],
  },
  {
    group: 'Świat',
    items: [
      { id: 'buildings', name: 'Budynki' },
      { id: 'homes', name: 'Domy' },
      { id: 'vehicles', name: 'Pojazdy' },
      { id: 'animals', name: 'Zwierzęta' },
      { id: 'vision', name: 'Zasięg widzenia' },
    ],
  },
];

const EXPERIENCE_POINTS = [1, 2, 3, 4, 5, 10, 25, 50, 100, 162];
function experiencePercent(points) {
  const inverse = Math.trunc(10000 / (20 * points + 100));
  return Math.min(100, Math.trunc((10000 - 100 * inverse) / 98));
}

function tableBody(state) {
  switch (state.table) {
    case 'matrix':
      return matrixTable(state);
    case 'armour':
      return plainTable(
        'Pancerze',
        'Pancerz nie zużywa się. Działa przez wybór kolumny obrażeń, a blokada jest niewielka.',
        ['Pancerz', 'Materiał', 'Blokada', 'Ciężar', 'Wolniejszy krok'],
        data.armor.map((a) => [
          goodCell(['armor_wool', 'armor_leather', 'armor_chain', 'armor_plate'][a.typeId - 1]),
          a.material,
          a.blockingValue,
          a.weight,
          `+${Math.floor(a.weight / 2)} tak.`,
        ]),
        'Ciężar broni i pancerza sumuje się. Krok wydłuża się o połowę sumy, zaokrągloną w dół.',
      );
    case 'towers':
      return plainTable(
        'Wieże i schronienia',
        'Kto chowa się na alarm i jak daleko sięga strzelec na posterunku.',
        ['Budynek', 'Miejsc w schronie', 'Zasięg strzał'],
        [
          ['Kwatera główna', 30, 29],
          ['Wieża obronna 2', 20, 29],
          ['Wieża obronna 1', 10, 29],
          ['Koszary', 10, 29],
        ],
        'Strzelec stojący na posterunku wieży strzela o 5 dalej: krótki łuk 20, długi 28. Każdy schowany daje 0,5 strzały na sekundę.',
      );
    case 'tools':
      return plainTable(
        'Narzędzia',
        'Bonus doliczany jest do bonusu z doświadczenia, nie mnożony przez niego.',
        ['Narzędzie', 'Szybkość pracy', 'Produkcja', 'Trwałość'],
        [
          [goodCell('tool_wooden'), '×1,25', '+0,2 sztuki na cykl', '100 użyć'],
          [goodCell('tool_iron'), '×1,75', '+0,7 sztuki na cykl', '100 użyć'],
        ],
        'Jedno użycie to cykl produkcji, cios przy zbieraniu, rzut sieci, cios młotkiem albo podlanie.',
      );
    case 'draughts':
      return plainTable(
        'Mikstury i miód',
        'Osadnik wypija je sam, gdy potrzeba spadnie, a mikstury lecznicze gdy rana zeszłaby poniżej 50% zdrowia.',
        ['Napój', 'Działanie', 'Łyki'],
        [
          'mead',
          'potion_food_small',
          'potion_food_big',
          'potion_stamina_small',
          'potion_stamina_big',
          'potion_heal_small',
          'potion_heal_big',
        ].map((id) => {
          const good = goodById.get(id);
          return [goodCell(id), esc(good.equip.effect), esc(good.equip.wears)];
        }),
      );
    case 'amulets':
      return plainTable(
        'Amulety',
        'Działają noszone w ekwipunku, nie zużywają się. Drugi taki sam nic nie dodaje.',
        ['Amulet', 'Działanie'],
        [
          'amulet_strength',
          'amulet_defense',
          'amulet_crithit',
          'amulet_speed',
          'amulet_food',
          'amulet_stamina',
        ].map((id) => [goodCell(id), esc(goodById.get(id).equip.effect)]),
      );
    case 'experience':
      return plainTable(
        'Krzywa doświadczenia',
        'Punkt to jedna praca na torze o współczynniku 100. Drewno liczy się 2,5 raza szybciej, budowa 20 razy wolniej.',
        ['Punkty', 'Doświadczenie', 'Oszczędzone ciosy', 'Dodatkowa produkcja'],
        EXPERIENCE_POINTS.map((p) => {
          const pct = experiencePercent(p);
          return [p, `${pct}%`, Math.trunc(pct / 20), `+${number(Math.trunc((pct * 15) / 100) / 10)} sztuki`];
        }),
      );
    case 'jobs':
      return plainTable(
        'Zawody i wymagania',
        'Doświadczenie, które odkrywa zawód dla całej osady.',
        ['Zawód', 'Praktyka', 'Szkoła'],
        data.jobs
          .filter((j) => j.requirements.length > 0)
          .map((j) => {
            const need = j.requirements.find((r) => r.route === 'need');
            const train = j.requirements.find((r) => r.route === 'train');
            return [
              `<button class="kn-link" data-go="job:${j.id}"><span>${esc(j.name)}</span></button>`,
              need === undefined ? '-' : `${need.amount} × ${esc(need.experience.join(' + '))}`,
              train === undefined ? '-' : `${train.amount} s`,
            ];
          }),
      );
    case 'food':
      return plainTable(
        'Jedzenie i sen',
        'Pasek ma 10000 punktów. Praca staje przy 2000, a dom dopełnia do 8000.',
        ['Co', 'Daje', 'Uwagi'],
        [
          ['Zwykły posiłek', '4000 jedzenia', '×2 w domu'],
          ['Ciastko', '6000 jedzenia, 4000 towarzystwa', '×2 w domu'],
          ['Sen w domu', '8000 odpoczynku', 'poza domem połowa, na meblach ×2'],
          ['Modlitwa', '4000 wiary', 'świątynia, kwatera albo święty ogień w domu'],
          ['Rozmowa', '4000 towarzystwa', 'szuka rozmówcy w promieniu 32'],
        ],
        'Samo życie zużywa pasek w około 15 minut. Praca dokłada 100 do 500 punktów za cykl.',
      );
    case 'walk':
      return plainTable(
        'Szybkość chodu',
        'Krok liczony jest w taktach, 12 taktów to sekunda. Niżej składniki, najkrótszy krok to 3 takty.',
        ['Składnik', 'Takty'],
        [
          ['Podłoże: droga', '+2'],
          ['Podłoże: ląd', '+4'],
          ['Podłoże: piasek, plaża', '+6'],
          ['Podłoże: góry', '+8'],
          ['Podłoże: śnieg', '+10'],
          ['Podstawa (Amulet Wiatru: 0)', '+2'],
          ['Bez butów', '+2'],
          ['Niesie towar', '+1'],
          ['Zmęczony', '+2'],
          ['Dziecko', '+2'],
          ['Niemowlę', '×2'],
          ['Broń i pancerz', '+ połowa ciężaru'],
        ],
        'Przykład: bosy dorosły na lądzie 8 taktów (0,67 s), w butach 6, w butach na drodze 4.',
      );
    case 'buildings':
      return plainTable(
        'Budynki',
        'Bez cudów i pojazdów.',
        ['Budynek', 'Rodzaj', 'Wytrzymałość', 'Pracownicy', 'Stan w osadzie'],
        data.buildings
          .filter((b) => !['vehicle', 'wonder'].includes(b.kind))
          .map((b) => [
            `<button class="kn-link" data-go="building:${b.id}"><span>${esc(b.name)}</span></button>`,
            b.kind,
            b.hitpoints === null ? '-' : number(b.hitpoints),
            b.workers.reduce((n, w) => n + w.count, 0),
            state.mode === 'game' ? esc(buildingStatus(b).text) : '-',
          ]),
      );
    case 'homes':
      return plainTable(
        'Domy',
        'Liczba rodzin, nie osób. Dziecko jest jedno naraz w rodzinie.',
        ['Poziom', 'Rodziny', 'Spiżarnia', 'Wytrzymałość', 'Święty ogień'],
        data.buildings
          .filter((b) => b.kind === 'home')
          .map((b, i) => [
            `<button class="kn-link" data-go="building:${b.id}"><span>${esc(b.name)}</span></button>`,
            b.homeSize,
            b.stock[0]?.capacity ?? '-',
            number(b.hitpoints),
            i >= 2 ? 'tak' : 'nie',
          ]),
      );
    case 'vehicles':
      return plainTable(
        'Pojazdy',
        'Pełny wózek traci 60% szybkości, zaprzęg 15%.',
        ['Pojazd', 'Ładownia', 'Pasażerowie', 'Wytrzymałość'],
        data.vehicles.map((v) => [
          esc(v.name === 'oxcart' ? 'Zaprzęg' : v.name),
          v.stockSlots,
          v.passengerSlots,
          number(v.hitpoints),
        ]),
      );
    case 'animals':
      return plainTable(
        'Zwierzęta',
        'Wszystkie biorą obrażenia z kolumny skórzanej zbroi.',
        ['Zwierzę', 'Zdrowie', 'Agresywne', 'Oswajalne', 'Stado'],
        data.animals
          .slice()
          .sort((a, b) => b.hitpoints - a.hitpoints)
          .map((a) => [
            esc(a.name),
            number(a.hitpoints),
            a.aggressive ? 'tak' : a.getAngry ? 'gdy zaatakowane' : 'nie',
            a.catchable ? 'tak' : 'nie',
            a.groupSize,
          ]),
      );
    case 'vision':
      return plainTable(
        'Zasięg widzenia',
        'Promień odkrywania mgły, w węzłach mapy.',
        ['Kto', 'Zasięg'],
        [
          ['Zwiadowca', 30],
          ['Kwatera główna', 30],
          ['Bohater', 25],
          ['Statek', 25],
          ['Żołnierz', 20],
          ['Budynek', 20],
          ['Wózek, katapulta', 20],
          ['Dorosły', 15],
          ['Dziecko', 10],
        ],
      );
    default:
      return '<p class="kn-empty">Wybierz tabelę.</p>';
  }
}

export function tablesView(state) {
  const rail = TABLES.map(
    (g) =>
      `<h4>${g.group}</h4>${g.items.map((t) => `<button class="kn-rail__item" aria-current="${state.table === t.id}" data-table="${t.id}"><span>${t.name}</span></button>`).join('')}`,
  ).join('');
  return `<div class="kn-book"><nav class="kn-rail">${rail}</nav><div class="on-parchment kn-page" data-keep-scroll="table">${tableBody(state)}</div></div>`;
}
