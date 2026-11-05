import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const SETTLERS: ArticleGroup = {
  group: 'Osadnicy',
  items: [
    {
      id: 'needs',
      name: 'Potrzeby',
      lead: 'Przy {{need.drivePct}}% paska osadnik rzuca pracę i idzie uzupełnić potrzebę.',
      blocks: [
        {
          p: 'Ustawienie lobby "Potrzeby osadników: Wyłączone" zatrzymuje paski i znosi głód.',
        },
        {
          h: 'Paski',
        },
        {
          table: {
            head: ['Pasek', 'Spada z czasem', 'Spada przy pracy', 'Uzupełnia', 'Przy 0%'],
            rows: [
              [
                'Energia',
                '100% w {{need.drainMinutes}} min',
                'tak',
                '[[article:food|posiłek]]',
                '[[article:health|umiera po {{health.starveTime}}]]',
              ],
              [
                'Wytrzymałość',
                '100% w {{need.drainMinutes}} min',
                'tak',
                'sen',
                'nic więcej, krok zwalnia już od {{need.drivePct}}%',
              ],
              ['Towarzystwo', '100% w {{need.drainMinutes}} min', 'nie', 'rozmowa', 'bez kary'],
              [
                'Religia',
                'nie',
                'tylko broń i zbroje',
                '[[article:religion|modlitwa]]',
                'nie wytwarza broni ani zbroi',
              ],
            ],
            foot: 'Na starcie mapy każdy pasek ma losowo {{need.startMinPct}}-100%. Bez [[good:shoes|Butów]] {{need.barefootSampleSteps}} kroków zabiera {{need.barefootRoadPct}}% Energii na drodze, {{need.barefootLandPct}}% na lądzie i do {{need.barefootMaxPct}}% na najtrudniejszym terenie, z ładunkiem dwa razy tyle.',
          },
        },
        {
          h: 'Progi',
        },
        {
          figure: {
            id: 'need-bar',
            caption: 'Co się dzieje na pasku',
          },
        },
        {
          table: {
            head: ['Poziom', 'Co się dzieje'],
            rows: [
              ['{{need.criticalPct}}%', 'Powiadomienie o Energii, Wytrzymałości lub Religii.'],
              [
                '{{need.drivePct}}%',
                'Kończy czynność i rzuca pracę. Przy Wytrzymałości krok jest wolniejszy o {{step.tiredExtra}} s.',
              ],
              [
                '{{need.satedPct}}%',
                'Osadnik w domu dopełnia Wytrzymałość, potem Energię do tego poziomu i wychodzi.',
              ],
              [
                '{{need.overfillPct}}%',
                'Tyle najwyżej mieści pasek. Posiłek w domu i sen w domu z meblami odkładają zapas ponad 100%.',
              ],
            ],
          },
        },
        {
          h: 'Sen',
        },
        {
          table: {
            head: ['Kto', 'Czas snu', 'Wytrzymałość za sen: poza domem', 'w domu', 'w domu z Meblami'],
            rows: [
              [
                'Mężczyzna',
                '{{sleep.manSeconds}} s',
                '+{{sleep.manAwayPct}}%',
                '+{{sleep.manHomePct}}%',
                '+{{sleep.manFurnishedPct}}%',
              ],
              [
                '[[job:woman|Kobieta]]',
                '{{sleep.womanSeconds}} s',
                '+{{sleep.womanAwayPct}}%',
                '+{{sleep.womanHomePct}}%',
                '+{{sleep.womanFurnishedPct}}%',
              ],
              [
                'Kupiec, Zwiadowca (zawsze jak w domu)',
                '{{sleep.manSeconds}} s',
                '+{{sleep.manHomePct}}%',
                '-',
                '-',
              ],
              [
                'Żołnierz (gdziekolwiek śpi)',
                '{{sleep.soldierSeconds}} s',
                '+{{sleep.soldierPct}}%',
                '-',
                '-',
              ],
            ],
            num: [1, 2, 3, 4],
          },
        },
        {
          h: 'Wyjątki',
        },
        {
          table: {
            head: ['Kto', 'Paski'],
            rows: [
              ['Niemowlę, dziecko', 'Brak. Dorosły zaczyna ze 100% na każdym pasku.'],
              ['[[article:heroes|Bohater]]', 'Brak.'],
              ['Potwory, zwierzęta', 'Brak.'],
              ['Żołnierz', 'Bez Towarzystwa.'],
              ['Pasażer wozu', 'Paski nie spadają, zdrowie się nie zmienia.'],
              ['Pasażer statku', 'Je z ładowni, śpi jak poza domem, rozmawia. Modli się dopiero na lądzie.'],
            ],
          },
        },
        {
          h: 'Religia i Towarzystwo',
        },
        {
          p: 'Osadnik modli się, aż Religia dojdzie do 100% albo Energia lub Wytrzymałość spadnie do {{need.drivePct}}%. Kto się modli, gdzie i ile to daje: [[article:religion|Religia i świątynia]].',
        },
        {
          table: {
            head: ['Czynność', 'Czas', 'Daje'],
            rows: [
              ['Rozmowa', '{{talk.shortSeconds}}-{{talk.longSeconds}} s', 'Do +{{talk.pct}}% Towarzystwa.'],
              ['Pobyt w domu, gdy osadnik ma małżonka', '-', 'Towarzystwo 100%.'],
            ],
            num: [1],
          },
        },
      ],
      see: [
        'article:food',
        'article:health',
        'article:draughts',
        'article:religion',
        'article:walking',
        'article:stances',
      ],
    },
    {
      id: 'food',
      name: 'Jedzenie',
      lead: 'Żywność to Chleb, Mięso i Ryby. Posiłek zjedzony w domu daje dwa razy więcej Energii.',
      blocks: [
        {
          h: 'Co daje posiłek',
        },
        {
          table: {
            head: ['Posiłek', 'Energia poza domem', 'Energia w domu', 'Towarzystwo'],
            rows: [
              ['[[good:bread|Żywność]]', '+{{meal.plainPct}}%', '+{{meal.plainHomePct}}%', '-'],
              [
                '[[good:candy|Ciastko]]',
                '+{{meal.candyPct}}%',
                '+{{meal.candyHomePct}}%',
                '+{{meal.candyCompanyPct}}%',
              ],
              ['Dojrzały krzew', '+{{meal.plainPct}}%', '-', '-'],
            ],
            num: [1, 2, 3],
            foot: 'Posiłek trwa {{meal.seconds}} s i zjada 1 sztukę. Żołnierz nie je w domu, a Ciastko daje mu tyle co Żywność: +{{meal.plainPct}}%.',
          },
        },
        {
          p: 'Osadnik je też z zapasu warsztatu. W magazynie bierze najpierw Żywność, a później Ciastka.',
        },
        {
          h: 'Gdzie je osadnik',
        },
        {
          steps: [
            'Własna spiżarnia, gdy drzwi domu są najwyżej {{reach.walk}} hexów dalej.',
            'Najbliższy magazyn, warsztat lub stos na ziemi w zasięgu {{reach.goods}} hexów, albo dojrzały krzew bliżej niż {{reach.bushAtHand}} hexów.',
            'Najbliższy dojrzały krzew w zasięgu {{reach.goods}} hexów.',
            'Najbliższe jedzenie, dokądkolwiek osadnik może dojść, także własny dom, jeśli jest dalej.',
          ],
        },
        {
          p: 'Spiżarnie innych rodzin i zapasy innych graczy są zamknięte, krzew jest niczyj. [[article:roads|Drogowskazy]] rozszerzają te zasięgi. Zapasu poniżej [[article:hauling|minimum magazynu]] nikt nie zje ani nie zaniesie do domu.',
        },
        {
          h: 'Dostawa do spiżarni',
        },
        {
          steps: [
            '[[job:woman|Kobieta]] z gotowym domem szuka najbliższego jedzenia poza domami.',
            'Niesie 1 sztukę do domu.',
            'Z [[good:crockery|Naczyniami]] w domu 1 dostarczona sztuka daje 2 sztuki w spiżarni.',
          ],
        },
        {
          p: 'Kobieta donosi jedzenie, dopóki spiżarnia nie jest pełna. Limity: [[article:family|Rodzina i dom]].',
        },
      ],
      see: ['article:needs', 'article:family', 'article:gathering', 'good:bread', 'good:candy'],
    },
    {
      id: 'health',
      name: 'Zdrowie i leczenie',
      lead: 'Człowiek ma {{health.human}} zdrowia, a pełne zdrowie wraca samo w {{health.regenMinutes}} minut.',
      blocks: [
        {
          h: 'Co zmienia zdrowie',
        },
        {
          table: {
            head: ['Źródło', 'Zmiana', 'Warunek', 'Czas na {{health.human}} zdrowia'],
            rows: [
              [
                'Regeneracja',
                '+{{health.regenPerSecond}}/s',
                'Energia powyżej 0%, także w walce',
                '{{health.regenTime}}',
              ],
              [
                '[[article:religion|Aura Świątyni]]',
                '+{{aura.perSecond}}/s',
                '{{aura.range}} hexów od [[building:work_temple|Świątyni]]',
                '{{aura.time}}',
              ],
              ['Głód', '-{{health.starvePerSecond}}/s', 'Energia 0%', '{{health.starveTime}}'],
            ],
            num: [1, 3],
            foot: 'Razem daje to {{aura.totalPerSecond}} na sekundę. Regeneracja kończy się na {{health.human}}, a aura leczy ponad normę, do {{aura.ceiling}}.',
          },
        },
        {
          p: 'Przy {{health.nearDeath}} zdrowia gra pokazuje powiadomienie, że osadnik umiera.',
        },
        {
          h: 'Mikstury lecznicze',
        },
        {
          list: [
            '[[good:potion_heal_small|Mała Lecznicza Mikstura]] ma {{draught.smallUses}} łyki, razem {{draught.healSmallTotal}} zdrowia. [[good:potion_heal_big|Duża Lecznicza Mikstura]] ma {{draught.bigUses}} łyków, razem {{draught.healBigTotal}} zdrowia.',
            'Gdy cios zbiłby zdrowie poniżej {{draught.healBelow}}, osadnik od razu pije łyk za łykiem, aż znów ma co najmniej {{draught.healBelow}} albo skończy mu się mikstura.',
            'Nawet śmiertelny cios nie zabije, jeśli łyki pokryją ranę.',
            'Osadnik pije też, gdy głód zbije zdrowie poniżej {{draught.healBelow}}.',
          ],
        },
      ],
      see: ['article:draughts', 'article:needs', 'article:religion', 'good:potion_heal_small'],
    },
    {
      id: 'family',
      name: 'Rodzina i dom',
      lead: 'Do narodzin dziecka potrzebne są {{family.childFood}} sztuki jedzenia.',
      blocks: [
        {
          h: 'Przydział domu',
        },
        {
          list: [
            'Dom dostaje się tylko rozkazem "Przydziel dom". Nikt nie wprowadza się sam, a ślub przenosi tylko współmałżonka.',
            'Dom mieści tyle rodzin, ile podaje kolumna Rodziny w tabeli poziomów. Do pełnego domu rozkaz nie działa.',
            'Ponowny przydział przenosi całą rodzinę: osadnika, małżonka i rosnące dziecko.',
          ],
        },
        {
          h: 'Ślub',
        },
        {
          list: [
            'Ślub wymaga rozkazu "Zawrzyj małżeństwo".',
            'Rozkaz łączy osadnika z najbliższą dorosłą osobą przeciwnej płci, z tego samego plemienia i od tego samego gracza.',
            'Kandydat musi być w zasięgu [[article:roads|drogowskazów]] osadnika. Bez kandydata rozkaz przepada, a gra pokazuje "Brak pary".',
            'Ślubu nie biorą żołnierze, bohaterowie, Zwiadowcy ani osadnik wysłany do [[building:barracks|Koszar]] lub [[building:school|Szkoły]].',
            'Para mieszka w domu żony, a gdy żona go nie ma, w domu męża.',
          ],
        },
        {
          h: 'Dorastanie',
        },
        {
          table: {
            head: ['Etap', 'Wiek', 'Od narodzin'],
            rows: [
              ['Niemowlę', '0-{{age.babyLastYear}} lata', '0-{{age.childTime}}'],
              [
                'Dziecko',
                '{{age.childYears}}-{{age.childLastYear}} lat',
                '{{age.childTime}}-{{age.adultTime}}',
              ],
              ['Dorosły', 'od {{age.adultYears}} lat', 'od {{age.adultTime}}'],
            ],
            foot: 'Rok życia trwa {{age.yearSeconds}} s. Dziecko chodzi wokół domu. Po dorośnięciu chłopiec zostaje [[job:civilist|Cywilem]], a dziewczynka [[job:woman|Kobietą]]. Nikt nie umiera ze starości.',
          },
        },
        {
          h: 'Poziomy domu',
        },
        {
          figure: {
            id: 'home-levels',
            caption: 'Poziomy domu',
          },
        },
        {
          data: 'homes',
        },
        {
          p: 'Spiżarnia to osobny limit na Żywność i na Ciastko: Dom 1 mieści {{home.larder}} + {{home.candyLarder}} sztuk. Osadnik może mieszkać w domu innego plemienia tego samego gracza.',
        },
        {
          h: 'Wyposażenie domu',
        },
        {
          table: {
            head: ['Towar', 'Od', 'Daje', '1 sztuka starcza na', 'Kobieta donosi poniżej'],
            rows: [
              [
                '[[good:crockery|Naczynia]]',
                'Dom 1',
                'Dostawa jedzenia daje 2 sztuki',
                '{{home.crockeryDeliveries}} dostaw',
                '{{home.crockeryFetchBelow}}',
              ],
              [
                '[[good:furniture|Meble]]',
                'Dom 1',
                'Sen ×2',
                '{{home.furnitureManSleeps}} snów mężczyzny, {{home.furnitureWomanSleeps}} snów kobiety',
                '{{home.furnitureFetchBelow}}',
              ],
              [
                '[[good:holy_oil|Oliwa]]',
                'Dom 3',
                '[[article:religion|Święty ogień]]: modlitwa przed domem',
                '{{oil.burnTime}}',
                '{{home.oilFetchBelow}}',
              ],
            ],
            num: [4],
            foot: 'Dom trzyma do {{home.wareUnits}} sztuk każdego z tych towarów. Oliwa pali się bez przerwy, także gdy nikt się nie modli.',
          },
        },
        {
          p: 'W panelu domu gracz wyłącza dla całej osady używanie Naczyń i Mebli oraz dostawy Oliwy. Oliwa już złożona pali się dalej.',
        },
        {
          h: 'Kto traci dom',
        },
        {
          table: {
            head: ['Kto', 'Co się dzieje'],
            rows: [
              ['Wdowiec', 'Traci dom, gdy dziecko dorosło lub zmarło.'],
              ['Wdowa', 'Zostaje w domu.'],
              ['Dorosłe dziecko', 'Traci dom w chwili dorosłości.'],
              [
                'Kupiec, Zwiadowca, żołnierz',
                'Dom zostaje przy rodzinie, ale on sam w nim nie je ani nie śpi.',
              ],
            ],
          },
        },
      ],
      see: [
        'article:food',
        'article:religion',
        'article:assistant',
        'building:home_level_00',
        'good:crockery',
        'good:furniture',
      ],
    },
    {
      id: 'assistant',
      name: 'Asystent',
      lead: 'Licznikami zamawiasz, ile dzieci ma się jeszcze urodzić i ilu rekrutów wyszkolić. Licznik spada, gdy zamówienie się spełni. Przełącznikami rozdajesz wyposażenie z magazynu.',
      blocks: [
        {
          h: 'Liczniki',
        },
        {
          table: {
            head: ['Licznik', 'Daje', 'Kto', 'Maleje', 'Można ustawić ∞'],
            rows: [
              ['Córki', 'dziewczynkę', 'mężatka z domem', 'przy narodzinach', 'nie'],
              ['Synowie', 'chłopca', 'mężatka z domem', 'przy narodzinach', 'tak'],
              ['Żołnierze bez broni', 'rekruta', '[[job:civilist|Cywil]]', 'po szkoleniu', 'tak'],
              [
                'Miecznicy, Włócznicy, Łucznicy',
                'uzbrojenie, potem rekruta',
                'żołnierz bez broni, potem Cywil',
                'gdy weźmie broń',
                'tak',
              ],
            ],
            foot: 'Licznik ustawia się od 0 do {{assistant.counterMax}}. Rozkaz wydany jednej osobie ma pierwszeństwo przed Asystentem. Kolejność broni i zbroi: [[article:equip|Wyposażanie żołnierzy]].',
          },
        },
        {
          h: 'Przełączniki',
        },
        {
          table: {
            head: ['Przełącznik', 'Na starcie', 'Kto dostaje'],
            rows: [
              ['[[good:shoes|Buty]]', 'włączony', 'dorosły mężczyzna'],
              [
                'Żelazne narzędzia, Drewniane narzędzia',
                'włączone',
                'każdy pracujący oprócz żołnierza, [[job:scout|Zwiadowcy]] i Cywila',
              ],
              [
                'Żelazne narzędzia: Wymieniaj drewniane',
                'włączony',
                'pracujący z Drewnianym Narzędziem, gdy Żelazne narzędzia są włączone',
              ],
              ['[[good:mead|Miód pitny]]', 'włączony', 'Osadnicy, Żołnierze'],
              [
                'Odżywcze mikstury, Mikstury wytrzymałości, Lecznicze mikstury',
                'wyłączone',
                'Osadnicy, Żołnierze',
              ],
              [
                'Amulet: Odżywczy, Wytrzymałości, Siły, Obrony, Precyzji, Wiatru',
                'wyłączone',
                'Osadnicy, Żołnierze',
              ],
              [
                'Absolwenci szkół automatycznie przydzielani do warsztatów',
                'wyłączony',
                'absolwent [[building:school|Szkoły]]',
              ],
              ['Zbieracze automatycznie przenoszą flagę', 'włączony', '[[job:collector|Zbieracz]] z flagą'],
            ],
            foot: 'Przy napojach i amuletach przyciski "Osadnicy" i "Żołnierze" wybierają odbiorców, na starcie oba włączone. Wyłączenie nie odbiera tego, co już wydano.',
          },
        },
        {
          h: 'Narodziny',
        },
        {
          list: [
            'Najpierw rodzą się córki, potem synowie. Dlatego licznik córek nie ma ∞, inaczej synowie nigdy by się nie urodzili.',
            'Przy liczniku 3 na dziecko czekają naraz najwyżej 3 pary.',
          ],
        },
        {
          h: 'Pobór do Koszar',
        },
        {
          list: [
            'Do Koszar idzie tylko dorosły Cywil bez pracy i bez zajęcia, najpierw kawalerowie. Asystent nikogo nie zabiera z pracy.',
            'Licznik Miecznicy, Włócznicy lub Łucznicy najpierw uzbraja żołnierza bez broni, jeśli broń jest w jego zasięgu.',
          ],
        },
        {
          table: {
            head: ['Co zatrzymuje pobór', 'Co zrobić'],
            rows: [
              ['Brak gotowych [[building:barracks|Koszar]]', 'Dokończ Koszary.'],
              ['Brak wolnego Cywila', 'Poślij kogoś do Koszar ręcznie.'],
              [
                'Żołnierz bez broni czeka na broń tego rodzaju',
                'Dostarcz broń. Do tego czasu zajmuje miejsce nowego rekruta.',
              ],
            ],
            foot: 'Rekrut w drodze do Koszar już liczy się do licznika.',
          },
        },
        {
          h: 'Rozdawanie',
        },
        {
          list: [
            'Asystent nie wyposaża kobiet, dzieci, [[article:heroes|bohaterów]] ani załogi wieży.',
            'Zapasu poniżej [[article:hauling|minimum magazynu]] Asystent nie rozdaje.',
            'Wypełnia puste miejsca, a Żelazne narzędzia mają pierwszeństwo przed drewnianymi. Z przełącznikiem "Wymieniaj drewniane" posyła też pracującego z Drewnianym Narzędziem po Żelazne: [[article:tools|Narzędzia]]. Innych rzeczy na lepsze nie wymienia.',
            'Osadnik ma {{amulet.slots}} miejsca na napoje i amulety: [[article:draughts|Napoje i amulety]].',
          ],
        },
        {
          h: 'Absolwenci',
        },
        {
          list: [
            'Absolwent idzie do najbliższego wolnego miejsca w swoim zawodzie, także do warsztatu w budowie. Warsztat robiący wyrób, którego się uczył, ma pierwszeństwo, nawet gdy jest dalej.',
            'Gdy wolnego miejsca nie ma, czeka przy Szkole. [[job:collector|Zbieracza]], [[job:hunter|Myśliwego]], [[job:fisher|Rybaka]] i żołnierzy Asystent nie przydziela.',
          ],
        },
        {
          p: 'Jak Zbieracze sami przenoszą flagę: [[article:work-flag|Flaga robocza]].',
        },
        {
          p: 'Okno "Poddani" pokazuje, ilu osadnikom brakuje domu, pracy, narzędzi, butów, pary, dzieci, broni lub miodu pitnego.',
        },
      ],
      see: [
        'article:family',
        'article:equip',
        'article:draughts',
        'article:tools',
        'article:work-flag',
        'building:barracks',
      ],
    },
    {
      id: 'draughts',
      name: 'Napoje i amulety',
      lead: 'Osadnik pije w miejscu i nie przerywa tego, co robi. Amulet się nie zużywa.',
      blocks: [
        {
          h: 'Napoje',
        },
        {
          table: {
            head: ['Napój', 'Łyki', 'Za łyk', 'Pije, gdy'],
            rows: [
              [
                '[[good:mead|Miód Pitny]]',
                '{{draught.meadUses}}',
                '+{{draught.meadPct}}% Energii i +{{draught.meadPct}}% Wytrzymałości',
                'Energia lub Wytrzymałość spadnie do {{need.drivePct}}%',
              ],
              [
                '[[good:potion_food_small|Mała]] / [[good:potion_food_big|Duża Odżywcza Mikstura]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '+{{draught.potionPct}}% Energii',
                'Energia spadnie do {{need.drivePct}}%',
              ],
              [
                '[[good:potion_stamina_small|Mała]] / [[good:potion_stamina_big|Duża Mikstura Wytrzymałości]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '+{{draught.potionPct}}% Wytrzymałości',
                'Wytrzymałość spadnie do {{need.drivePct}}%',
              ],
            ],
            num: [1],
            foot: 'Mikstury lecznicze: [[article:health|Zdrowie i leczenie]].',
          },
        },
        {
          h: 'Amulety',
        },
        {
          table: {
            head: ['Amulet', 'Działanie', 'Kiedy'],
            rows: [
              [
                '[[good:amulet_food|Odżywczy Amulet]]',
                '+{{amulet.needPct}}% Energii',
                'za każdym razem, gdy Energia spadnie do {{need.drivePct}}%',
              ],
              [
                '[[good:amulet_stamina|Amulet Wytrzymałości]]',
                '+{{amulet.needPct}}% Wytrzymałości',
                'za każdym razem, gdy Wytrzymałość spadnie do {{need.drivePct}}%',
              ],
              [
                '[[good:amulet_strength|Amulet Siły]]',
                'zadawane obrażenia ×{{amulet.strengthFactor}}',
                'każdy cios',
              ],
              [
                '[[good:amulet_crithit|Amulet Precyzji]]',
                '{{amulet.critChancePct}}% szans na obrażenia ×{{amulet.critFactor}}',
                'każdy cios',
              ],
              [
                '[[good:amulet_defense|Amulet Obrony]]',
                'otrzymywane obrażenia ×{{amulet.defenseFactor}}',
                'każdy otrzymany cios',
              ],
              ['[[good:amulet_speed|Amulet Wiatru]]', 'krok szybszy o {{step.amuletSaved}} s', 'każdy krok'],
            ],
          },
        },
        {
          h: 'Kilka naraz',
        },
        {
          list: [
            'Drugi taki sam amulet nic nie daje.',
            'Różne amulety działają razem: Siła i Precyzja dają ×{{amulet.comboFactor}} przy udanym losowaniu.',
            'Z Odżywczym Amuletem osadnik nie chodzi jeść, a z Amuletem Wytrzymałości nie chodzi spać.',
          ],
        },
        {
          h: 'Kto nosi',
        },
        {
          table: {
            head: ['Kto', 'Co nosi'],
            rows: [
              ['Dorosły mężczyzna', '{{amulet.slots}} miejsca na napoje i amulety, w każdym zawodzie.'],
              ['Kobieta, dziecko', 'Nic.'],
            ],
            foot: 'Co nosi bohater: [[article:heroes|Bohaterowie]].',
          },
        },
      ],
      see: ['article:needs', 'article:health', 'article:heroes', 'article:damage', 'article:walking'],
    },
  ],
};
