import { esc } from './model.js';

/** A short worked article keeps numbers beside the rule that uses them. The window fills such numbers
 *  from content and sim constants; they are written out here only for the review. */
const toolsArticle = `
  <p class="kn-lead">Narzędzie to najtańszy sposób na więcej towaru z tych samych ludzi. Działa w dwóch miejscach naraz: przyspiesza ciosy i dokłada produkcji.</p>
  <h3 class="kn-h">Szybsza praca</h3>
  <p>Zbieracz, rybak i budowniczy pracują ciosami. Liczba ciosów na sztukę to podstawa podzielona przez narzędzie, minus jeden cios za każde 20% doświadczenia. Nigdy mniej niż jeden.</p>
  <table class="kn-table kn-table--plain"><thead><tr><th>Drzewo, 10 ciosów na sztukę</th><th class="kn-num">Bez narzędzia</th><th class="kn-num">Drewniane</th><th class="kn-num">Żelazne</th></tr></thead><tbody>
    <tr><th>Nowicjusz, 0%</th><td class="kn-num">10</td><td class="kn-num">8</td><td class="kn-num">5</td></tr>
    <tr><th>Wprawiony, 51%</th><td class="kn-num">8</td><td class="kn-num">6</td><td class="kn-num">3</td></tr>
    <tr><th>Mistrz, 100%</th><td class="kn-num">5</td><td class="kn-num">3</td><td class="kn-num">1</td></tr>
  </tbody></table>
  <h3 class="kn-h">Więcej z jednego cyklu</h3>
  <p>W warsztacie każdy cykl daje recepturę plus bonus liczony w dziesiątych częściach sztuki. Doświadczenie daje do +1,5, drewniane narzędzie +0,2, żelazne +0,7. Bonusy się sumują. Mistrz z żelaznym narzędziem robi 3,2 sztuki z jednego kompletu składników.</p>
  <h3 class="kn-h">Zużycie</h3>
  <p>Narzędzie wytrzymuje 100 użyć. Liczy się każdy cios i każdy cykl, także nieudany. Kiedy się zniszczy, osadnik pracuje gołymi rękami, dopóki nie dostanie nowego. Tragarzom narzędzie nic nie daje.</p>
  <div class="kn-callout"><b>W praktyce:</b> pierwsze narzędzia daj drwalom. Drewno liczy doświadczenie 2,5 raza szybciej, więc to oni najszybciej dochodzą do mistrzostwa.</div>
  <p class="kn-seealso">Zobacz też: <button class="kn-link" data-go="good:tool_wooden"><span>Drewniane narzędzie</span></button> <button class="kn-link" data-go="good:tool_iron"><span>Żelazne Narzędzie</span></button> <button class="kn-link" data-table="tools"><span>Tabela narzędzi</span></button> <button class="kn-link" data-table="experience"><span>Krzywa doświadczenia</span></button></p>`;

const damageArticle = `
  <p class="kn-lead">Każdy cios przechodzi przez te same kroki, zawsze w tej kolejności. Liczy się przede wszystkim dopasowanie broni do pancerza.</p>
  <ol class="kn-formula">
    <li><b>Kolumna broni</b> według pancerza celu <small>tabela Broń i pancerz</small></li>
    <li><b>Doświadczenie bojowe</b>, tylko wręcz: do ×2 po 100 trafieniach</li>
    <li><b>Skąd cios:</b> z boku od tyłu ×1,25, od tyłu ×1,5 <small>tylko ludzie</small></li>
    <li><b>Blokada pancerza:</b> -5 <small>tylko ludzie</small></li>
    <li><b>Amulet Siły:</b> ×1,5</li>
    <li><b>Amulet Precyzji:</b> 20% szans na ×2</li>
    <li><b>Amulet Obrony celu:</b> ×0,5 <small>tylko ludzie</small></li>
  </ol>
  <h3 class="kn-h">Co z tego wynika</h3>
  <ul class="kn-steps">
    <li>Włócznia żelazna przebija zbroję płytową, długi miecz kolczugę. W drugą stronę obrażenia spadają ponad dwa razy.</li>
    <li>Krótki miecz bije co sekundę, długi co 2,4 s. Przeciw nieopancerzonym dają prawie te same obrażenia na sekundę.</li>
    <li>Tunika zatrzymuje więcej niż skórzana zbroja, ale waży więcej i kosztuje wełnę.</li>
  </ul>
  <p>Wręcz nie ma rzutu na trafienie: cios chybia tylko, gdy cel zdążył odejść. Łucznik trafia celnie tym częściej, im więcej trafień ma na koncie.</p>
  <p class="kn-seealso">Zobacz też: <button class="kn-link" data-table="matrix"><span>Tabela broń i pancerz</span></button></p>`;

/** Each outline lists what its article must carry; the sentences are working text from the code sweep. */
const outline = (points) =>
  `<p class="kn-todo">Szkic treści. Liczby sprawdzone w kodzie, tekst do dopisania.</p><ul class="kn-steps">${points.map((p) => `<li>${p}</li>`).join('')}</ul>`;

export const ARTICLES = [
  {
    group: 'Osadnicy',
    items: [
      {
        id: 'needs',
        name: 'Potrzeby',
        body: outline([
          'Cztery paski: jedzenie, odpoczynek, wiara, towarzystwo. Praca staje przy 2000 z 10000.',
          'Głód i zmęczenie spadają same, pełny pasek starcza na około 15 minut. Wiara spada tylko przez prace, które jej wymagają.',
          'Kolejność: napoje, jedzenie, sen, modlitwa. Niespełniona potrzeba nie blokuje pracy.',
          'Pusty głód zabiera 2 zdrowia na takt, pełne zdrowie schodzi w około 3,5 minuty.',
          'Zmęczony krok jest dłuższy o 2 takty. Zmęczenie nie zabija.',
          'Dzieci, bohaterowie i potwory nie mają pasków.',
        ]),
      },
      {
        id: 'health',
        name: 'Zdrowie i leczenie',
        body: outline([
          'Człowiek ma 5000 zdrowia i odzyskuje 1 na takt, także w walce. Pełne zdrowie wraca w około 7 minut.',
          'Świątynia: co sekundę +50 zdrowia w promieniu 50, aż do 150% normy, dopóki sama nie jest ranna.',
          'Mikstura lecznicza działa sama, gdy rana zeszłaby poniżej 50%.',
        ]),
      },
      {
        id: 'life',
        name: 'Życie i śmierć',
        body: outline([
          'Niemowlę po 80 s staje się dzieckiem, dziecko po 240 s dorosłym.',
          'Nie ma starości. Dorosły ginie tylko od utraty zdrowia.',
          'Po śmierci zostaje to, co niósł: towar, buty i narzędzie w dobrym stanie, nieużyte wyposażenie.',
        ]),
      },
      {
        id: 'family',
        name: 'Rodzina i dom',
        body: outline([
          'Ślub zarządza gracz. Para zamieszkuje w domu żony, jeśli go ma.',
          'Dziecko kosztuje 2 jedzenia ze spiżarni, oboje muszą być w domu, jedno dziecko naraz.',
          'Domy 1-5 mieszczą 1-5 rodzin. Spiżarnia 5, 10, 15.',
          'Meble podwajają sen, naczynia dają dodatkowy posiłek z dostawy, święta oliwa pozwala modlić się w domu (od domu 3).',
          'Wdowiec traci dom, wdowa zostaje.',
        ]),
      },
      {
        id: 'experience',
        name: 'Doświadczenie i nauka zawodu',
        body: outline([
          'Każdy tor doświadczenia rośnie z pracą: szybko na początku, 51% po 5 punktach, 100% po 162.',
          'Doświadczenie skraca ciosy i podnosi produkcję. Tragarzy nie przyspiesza.',
          'Zawód odkrywa się praktyką poprzednika. Odkrycie należy do całej osady i zostaje po śmierci pracownika.',
          'Szkoła uczy odkrytego zawodu, 1 s za punkt wymagania, 5 miejsc. Koszary 25 miejsc, 15 s.',
        ]),
      },
    ],
  },
  {
    group: 'Gospodarka',
    items: [
      {
        id: 'construction',
        name: 'Budowa, rozbudowa, naprawa',
        body: outline([
          '30 kroków budowy na sztukę materiału. Kroki ponad dostarczony materiał przepadają.',
          'Rozbudowa zachowuje stan budynku, anulowanie zwraca tylko jej własne materiały.',
          'Naprawa jest darmowa: 100 zdrowia na krok, ekipa do 5, czeka 10 s po ostatnim ciosie.',
        ]),
      },
      {
        id: 'gathering',
        name: 'Zbieranie i uprawa',
        body: outline([
          'Drzewo daje 3 drewna.',
          'Pole rośnie przez 5 etapów, jeden na podlanie, sąsiednie pola rosną razem. Do 25 pól w promieniu 16 od farmy.',
          'Studnia i ul napełniają się same, +1 na sekundę.',
          'Krzew jagodowy odrasta w 100 s, ławica ryb odnawia się co 180 s.',
        ]),
      },
      { id: 'tools', name: 'Narzędzia', body: toolsArticle },
      {
        id: 'hauling',
        name: 'Tragarze i magazyny',
        body: outline([
          'Tragarz najpierw opróżnia swój warsztat, potem zbiera towary priorytetowe magazynu.',
          'Minimum magazynowe obowiązuje też przy jedzeniu, więc wysokie minimum potrafi zagłodzić osadę.',
          'Na ziemi leży do 5 sztuk na kopcu. Zburzony budynek wysypuje zawartość.',
          'Flaga pracy sięga 32 węzły, myśliwego 50.',
        ]),
      },
      {
        id: 'roads',
        name: 'Drogi i drogowskazy',
        body: outline([
          'Droga kosztuje 1 kamień na plac i skraca krok z 4 do 2 taktów podłoża.',
          'Drogowskazy działają tylko tam, gdzie mapa je włącza: zasięg chodu 50, tragarz 63, łączą się do 40.',
          'Żołnierzy, zwiadowców, myśliwych i druidów zasięg nie ogranicza.',
        ]),
      },
      {
        id: 'walking',
        name: 'Szybkość chodu',
        body: outline([
          'Krok sumuje podłoże, buty, ładunek, zmęczenie i ciężar wyposażenia.',
          'Egipcjanie mają krok krótszy o 2 takty.',
          'Bosy chód kosztuje jedzenie, buty zużywają się z każdym krokiem.',
        ]),
      },
    ],
  },
  {
    group: 'Wojsko',
    items: [
      { id: 'damage', name: 'Jak liczone są obrażenia', body: damageArticle },
      {
        id: 'aim',
        name: 'Trafienie i strzelanie',
        body: outline([
          'Wręcz chybia tylko, gdy cel odszedł.',
          'Strzał jest celny z szansą 10% plus 1% za każde trafienie łukiem, po 90 trafieniach zawsze. Bohaterowie strzelają celnie.',
          'Niecelna strzała rozrzuca do 1/4 zasięgu.',
        ]),
      },
      {
        id: 'stances',
        name: 'Postawy',
        body: outline([
          'Atak: szuka wroga w promieniu 18 wokół siebie.',
          'Obrona: szuka w promieniu 18 wokół swojego miejsca, odchodzi do 40.',
          'Ignoruj: bije tylko w zasięgu broni. Cywile nie walczą.',
          'Żołnierze odpowiadają na cios w promieniu 40, cywile w promieniu 20 uciekają.',
        ]),
      },
      {
        id: 'ranks',
        name: 'Stopnie żołnierzy',
        body: outline([
          'Stopień to klasa broni. Włócznia żelazna, długi miecz i długi łuk wymagają 10 trafień bronią niższą.',
          'Trafienie to 1 punkt doświadczenia bojowego, obrażenia rosną do ×2 przy 100.',
          'Koszary: 15 s, wychodzi nieuzbrojony żołnierz.',
        ]),
      },
      {
        id: 'defence',
        name: 'Wieże, alarm, schronienie',
        body: outline([
          'Na alarm chowają się wszyscy poza żołnierzami i zwiadowcami.',
          'Pojemność: kwatera 30, duża wieża 20, reszta 10. Każdy schowany strzela 0,5 razy na sekundę.',
          'Posterunek na wieży daje łucznikom +5 zasięgu.',
        ]),
      },
      {
        id: 'walls',
        name: 'Mury i bramy',
        body: outline([
          'Mur ma 100 punktów. Cios zabiera 1 punkt za każde pełne 100 obrażeń przeciw budynkom, poniżej tego nic.',
          'Brama wymaga pięciu prostych, własnych segmentów.',
          'Brama automatyczna zamyka się, gdy wróg jest w promieniu 12.',
        ]),
      },
      {
        id: 'catapult',
        name: 'Katapulty',
        body: outline([
          'Zasięg 8-24, 3000 zdrowia, obsługuje ją żołnierz.',
          'Strzał rani wszystko w miejscu upadku i na sześciu polach dookoła, także swoich.',
        ]),
      },
    ],
  },
  {
    group: 'Świat',
    items: [
      {
        id: 'vehicles',
        name: 'Pojazdy i statki',
        body: outline([
          'Ładownia: wózek 15, zaprzęg 30, statek 50, statek handlowy 200.',
          'Pełny wózek traci 60% szybkości, zaprzęg 15%. Na krótkie trasy lepszy wózek, na długie zaprzęg.',
          'Zaprzęg bierze wołu ze stada, dwa zostają do rozmnażania.',
          'Na statku pasażerowie jedzą i śpią z ładowni.',
        ]),
      },
      {
        id: 'trade',
        name: 'Handel i dyplomacja',
        body: outline([
          'Kupiec wozi tylko to, co zaznaczysz. Bez wózka jedna sztuka na kurs.',
          'Obcy dom wchodzi do trasy tylko przy wzajemnej przyjaźni.',
          'Stosunki: przyjaciel, neutralny, wróg, osobno w każdą stronę.',
        ]),
      },
      {
        id: 'fog',
        name: 'Mgła i widzenie',
        body: outline([
          'Promienie od 10 (dziecko) do 30 (zwiadowca, kwatera).',
          'Jednostki we mgle nie są atakowane z automatu.',
        ]),
      },
      {
        id: 'wildlife',
        name: 'Dzikie zwierzęta i polowanie',
        body: outline([
          'Drapieżniki reagują w promieniu 20 od swojego miejsca.',
          'Myśliwy wybiera po odległości i zdrowiu, a zdobycz z 10000 zdrowia i więcej pomija.',
        ]),
      },
      {
        id: 'livestock',
        name: 'Hodowla',
        body: outline([
          'Zwiadowca przejmuje bydło i owce, przechodząc obok.',
          'Rozmnażanie wymaga dokładnie 2 dorosłych, trzecie idzie na mięso.',
          'Młode dorasta po 300 s, wspólny limit stada to 20.',
        ]),
      },
      {
        id: 'religion',
        name: 'Wiara i świątynia',
        body: outline([
          'Wiary potrzebują rzemieślnicy broni i zbroi: 1500 albo 3000 punktów na partię.',
          'Modlitwa w świątyni, kwaterze albo przy świętym ogniu daje 4000.',
          'Bez wiary nie zacznie kolejnej partii, rozpoczętą dokończy.',
        ]),
      },
      {
        id: 'chests',
        name: 'Skrzynie i papiery',
        body: outline([
          'Zwykłą skrzynię otworzy każdy dorosły, magiczną druid albo bohater.',
          'Papiery pozwalają postawić budynek od ręki.',
        ]),
      },
    ],
  },
];

const HOWTO = [
  {
    id: 'start',
    name: 'Pierwsze kroki',
    body: `<ol class="kn-steps">
      <li><b>Jedzenie przed wszystkim.</b> Farma, młyn, studnia i piekarnia. Pełny żołądek starcza na kilkanaście minut.</li>
      <li><b>Domy i pary.</b> Dom 1 na start, ślub rozkazem. Dzieci to jedyne źródło nowych ludzi.</li>
      <li><b>Praktyka otwiera zawody.</b> Zbieracz odkrywa cieślę, kamieniarza i kowala. Farmer młynarza.</li>
      <li><b>Magazyn i tragarze</b> skracają drogi. Daleki warsztat bez tragarza stoi.</li>
      <li><b>Wojsko.</b> Koszary, potem broń. Dobierz broń do pancerza wroga.</li>
    </ol>`,
  },
  {
    id: 'keys',
    name: 'Sterowanie',
    body: `<p class="kn-lead">Klawisze czytane z ustawień gracza. Zmienia się je w Ustawieniach.</p>
      <table class="kn-table kn-table--plain"><tbody>
      ${[
        ['Spacja', 'Pierścień rozkazów'],
        ['F1', 'Misja'],
        ['F2', 'Poddani'],
        ['F3 / F4', 'Wczytaj / Zapisz'],
        ['F5', 'Dyplomacja'],
        ['F6', 'Statystyki'],
        ['F7', 'Wiedza'],
        ['B', 'Budowanie'],
        ['E', 'Asystent'],
        ['S', 'Droga'],
        ['D', 'Palisada'],
        ['Q', 'Przydziel miejsce pracy'],
        ['W', 'Przydziel dom'],
        ['A', 'Atak z marszem'],
        ['C', 'Wybór zawodu'],
        ['I', 'Ekwipunek'],
        ['P / L', 'Pauza / Tempo'],
        ['1-0', 'Grupy kontrolne'],
      ]
        .map(([k, v]) => `<tr><th><kbd>${k}</kbd></th><td>${v}</td></tr>`)
        .join('')}
      </tbody></table>`,
  },
  {
    id: 'why',
    name: 'Dlaczego to nie działa?',
    body: `<p class="kn-lead">Najczęstsze zacięcia. Tu trafia też gracz z powiadomienia o problemie.</p>
      ${[
        [
          'Warsztat stoi pusty',
          'Nikt nie zna tego zawodu albo nikogo nie przydzielono. Otwórz budynek i sprawdź Pracowników. Zawód odkrywa praktyka poprzednika.',
        ],
        [
          'Nie rodzą się dzieci',
          'Potrzebne 2 jedzenia w spiżarni i oboje małżonkowie w domu. Rodzina ma jedno dziecko naraz. Mąż w zawodzie bez domu (żołnierz, kupiec, zwiadowca) dzieci nie będzie miał.',
        ],
        [
          'Ludzie głodują przy pełnym magazynie',
          'Minimum magazynowe blokuje też posiłki. Obniż je przy jedzeniu.',
        ],
        [
          'Budynek jest zablokowany',
          'Sprawdź hasło budynku: pokaże brakujący zawód albo towar. Czasem to mapa go nie pozwala.',
        ],
        [
          'Płatnerz nie pracuje',
          'Skończyła się wiara. Potrzebna świątynia, kwatera w zasięgu albo święty ogień w domu.',
        ],
        [
          'Tragarze nic nie noszą',
          'Sprawdź flagę pracy i priorytety magazynu. Tragarz bez flagi zbiera w promieniu 32.',
        ],
      ]
        .map(([q, a]) => `<details class="kn-faq" open><summary>${q}</summary><p>${a}</p></details>`)
        .join('')}`,
  },
];

export function mechanicsView(state) {
  const rail = ARTICLES.map(
    (g) =>
      `<h4>${g.group}</h4>${g.items.map((a) => `<button class="kn-rail__item" aria-current="${state.article === a.id}" data-article="${a.id}"><span>${a.name}</span></button>`).join('')}`,
  ).join('');
  const article = ARTICLES.flatMap((g) => g.items).find((a) => a.id === state.article);
  return `<div class="kn-book"><nav class="kn-rail" data-keep-scroll="art-rail">${rail}</nav>
    <div class="on-parchment kn-page" data-keep-scroll="article"><article class="kn-article"><h2 class="kn-title">${esc(article.name)}</h2>${article.body}</article></div></div>`;
}

export function howtoView(state) {
  const rail = HOWTO.map(
    (h) =>
      `<button class="kn-rail__item" aria-current="${state.howto === h.id}" data-howto="${h.id}"><span>${h.name}</span></button>`,
  ).join('');
  const page = HOWTO.find((h) => h.id === state.howto);
  return `<div class="kn-book"><nav class="kn-rail">${rail}</nav><div class="on-parchment kn-page" data-keep-scroll="howto"><article class="kn-article"><h2 class="kn-title">${esc(page.name)}</h2>${page.body}</article></div></div>`;
}
