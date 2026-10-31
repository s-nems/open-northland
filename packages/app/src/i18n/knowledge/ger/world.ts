import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const WORLD: ArticleGroup = {
  group: 'Welt',
  items: [
    {
      id: 'goals',
      name: 'Missionsziele und Spielende',
      lead: 'Ein Spieler scheidet aus, wenn er keinen lebenden erwachsenen Mann mehr hat. Es zählen erwachsene Männer und Helden. Frauen, Cyra und Kinder zählen nicht.',
      blocks: [
        {
          h: 'Was entscheidet',
        },
        {
          table: {
            head: ['Karte', 'Sieg', 'Niederlage'],
            rows: [
              [
                'Mehrspielerkarte, auch allein gespielt',
                'Ziel aus der Kartenliste',
                'Kein erwachsener Mann, Niederlage-Ziel aus dem Skript',
              ],
              ['Kampagnenmission', 'Kartenskript', 'Kartenskript, kein erwachsener Mann'],
              ['Karte ohne Skript', 'Letzter auf der Karte', 'Kein erwachsener Mann'],
            ],
          },
        },
        {
          h: 'Ziele auf Mehrspielerkarten',
        },
        {
          table: {
            head: ['Ziel', 'Was zählt', 'Ergebnis'],
            rows: [
              [
                'Waren',
                'Vorrat in den Regalen der Gebäude. Haufen am Boden, Frachträume und Ware in den Händen zählen nicht',
                'Sieg, wenn alle Mengen erreicht sind',
              ],
              ['„Einwohner“', 'Jeder Mensch des Spielers, auch Kinder', 'Sieg bei der geforderten Zahl'],
              [
                '„Soldaten“',
                'Erwachsene Männer im Soldatenberuf, ohne Helden',
                'Sieg bei der geforderten Zahl',
              ],
              ['Sieg aus dem Skript', 'Ein Missionsereignis nennt den Spieler', 'Sieg'],
              ['Niederlage aus dem Skript', 'Ein Missionsereignis nennt den Spieler', 'Niederlage'],
              [
                'Letzter auf der Karte',
                'Mindestens ein Rivale ist ausgeschieden, und die Übrigen sind gegenseitig befreundet: [[article:diplomacy|Diplomatie]]',
                'Sieg aller Übrigen',
              ],
            ],
            foot: 'Den Fortschritt bei Waren, „Einwohnern“ und „Soldaten“ zeigt das Spiel als aktuell/gefordert. Letzter auf der Karte gilt, wenn die Karte kein Ziel für Waren oder Leute und kein Skriptergebnis hat.',
          },
        },
        {
          list: [
            'Zuerst prüft das Spiel, ob noch erwachsene Männer leben, dann die Liste in der Reihenfolge der Karte.',
            'Die erste erfüllte Bedingung entscheidet endgültig über den Spieler. Ein Sieger, der danach seine Leute verliert, bleibt Sieger.',
            'Der Sieg eines Spielers beendet das Spiel für die anderen nicht.',
            'Eine Karte kann einen bestimmten Spieler von der Regel mit dem erwachsenen Mann ausnehmen.',
          ],
        },
        {
          h: 'Was vom Besiegten bleibt',
        },
        {
          steps: [
            'Kein erwachsener Mann: Fahrzeuge verschwinden sofort.',
            'Die Niederlage folgt bei der nächsten Zielprüfung.',
            'Bei der folgenden verschwinden Gebäude, Leute, Fahrzeuge und Wegweiser.',
            'Die Tiere des Spielers verwildern, wo sie stehen.',
          ],
        },
        {
          p: 'So läuft es auf Mehrspielerkarten. In Kampagnenmissionen und auf Karten ohne Skript verschwinden nur die Fahrzeuge, und der Computer hört auf zu spielen. Gebäude und Leute bleiben.',
        },
      ],
      see: ['article:diplomacy', 'article:family', 'article:heroes'],
    },
    {
      id: 'vehicles',
      name: 'Fahrzeuge und Schiffe',
      lead: 'Ohne Kommandant steht ein Fahrzeug. Ein Schiff nimmt {{vehicle.shipSeats}} Personen mit, ein Großes Schiff {{vehicle.bigShipSeats}}, den Kommandanten eingerechnet.',
      blocks: [
        {
          data: 'vehicles',
        },
        {
          table: {
            head: ['Fahrzeug', 'Wer einsteigt', 'Plätze mit Kommandant'],
            rows: [
              [
                '[[good:handcart|Handkarren]], [[good:oxcart|Ochsenkarren]]',
                '[[job:carrier|Träger]], [[job:trader|Händler]]',
                '1',
              ],
              ['[[good:ship_small|Schiff]]', 'jeder Erwachsene', '{{vehicle.shipSeats}}'],
              ['[[good:ship_big|Großes Schiff]]', 'jeder Erwachsene', '{{vehicle.bigShipSeats}}'],
              ['[[good:catapult|Katapult]]', 'Soldat, Held', '1'],
            ],
            num: [2],
          },
        },
        {
          list: [
            'Der zuerst Zugewiesene wird Kommandant. Geht er, übernimmt der nächste Passagier.',
            'Wer einsteigt, verliert seinen Arbeitsplatz. Träger mit Arbeitsplatz und Händler nehmen einen freien Karren als Werkzeug und behalten den Arbeitsplatz.',
            'Den Frachtraum bedient der Kommandant oder jeder erwachsene Mann an Bord, außer Soldaten, Helden, [[job:scout|Kundschaftern]] und [[job:druid|Druiden]]. Ohne sie erscheint „Kein Träger“.',
          ],
        },
        {
          h: 'Tempo mit Ladung',
        },
        {
          table: {
            head: ['Fahrzeug', 'Verlust, voll', 'Straße: leer', 'Straße: voll', 'Land: leer', 'Land: voll'],
            rows: [
              [
                '[[good:handcart|Handkarren]]',
                '{{vehicle.handcartLossPct}}%',
                '{{pace.cartRoad}}',
                '{{pace.handcartRoadFull}}',
                '{{pace.cartLand}}',
                '{{pace.handcartLandFull}}',
              ],
              [
                '[[good:oxcart|Ochsenkarren]]',
                '{{vehicle.oxcartLossPct}}%',
                '{{pace.cartRoad}}',
                '{{pace.oxcartRoadFull}}',
                '{{pace.cartLand}}',
                '{{pace.oxcartLandFull}}',
              ],
              ['[[good:catapult|Katapult]]', '-', '{{pace.catapultRoad}}', '-', '{{pace.catapultLand}}', '-'],
            ],
            num: [1, 2, 3, 4, 5],
            foot: 'Schritte pro Sekunde. Voll heißt {{haul.handcart}} von {{haul.handcart}} auf dem Handkarren und {{haul.oxcart}} von {{haul.oxcart}} auf dem Ochsenkarren. Gerechnet für einen Fahrer ohne Schuhe, mit Schuhen geht es schneller. Ein Schiff wird durch Ladung nicht langsamer und fährt etwa {{pace.ship}} Schritte/s. Ein Träger, der einen Karren zieht, verliert denselben Prozentsatz von seinem Gehtempo. Welcher Karren für eine Route: [[article:trade|Handel]].',
          },
        },
        {
          h: 'Bau',
        },
        {
          table: {
            head: ['Fahrzeug', 'Werkstatt', 'Kosten'],
            rows: [
              [
                '[[good:handcart|Handkarren]]',
                '[[building:work_joinery_02|Schreinerei 3]], 4',
                '{{cost.handcartWood}} [[good:wood|Holz]]',
              ],
              [
                '[[good:oxcart|Ochsenkarren]]',
                '[[building:work_joinery_02|Schreinerei 3]], 4',
                '{{cost.oxcartWood}} [[good:wood|Holz]]',
              ],
              [
                '[[good:ship_small|Schiff]]',
                '[[building:work_joinery_03|Schreinerei 4]]',
                '{{cost.shipWood}} [[good:wood|Holz]], {{cost.shipLeather}} [[good:leather|Leder]]',
              ],
              [
                '[[good:ship_big|Großes Schiff]]',
                '[[building:work_joinery_03|Schreinerei 4]]',
                '{{cost.bigShipWood}} [[good:wood|Holz]], {{cost.bigShipLeather}} [[good:leather|Leder]]',
              ],
              [
                '[[good:catapult|Katapult]]',
                '[[building:work_joinery_03|Schreinerei 4]]',
                '{{catapult.wood}} [[good:wood|Holz]], {{catapult.iron}} [[good:iron|Eisen]]',
              ],
            ],
            foot: 'Der [[job:joiner|Schreiner]] baut ein Fahrzeug auf einer Baustelle neben der Werkstatt, ein Schiff auf dem Wasser am Ufer.',
          },
        },
        {
          h: 'Ochse für den Ochsenkarren',
        },
        {
          steps: [
            'Ein fertiger Ochsenkarren hat den Status „Wartet auf sein Zugtier“.',
            'Er nimmt den nächsten erwachsenen [[good:cattle|Ochsen]] des Spielers auf derselben Landmasse, frei und nicht im Inneren einer Viehzüchterei.',
            'Jede Viehzüchterei behält ihre ersten {{livestock.pair}} erwachsenen Tiere. Ochsen ohne Viehzüchterei behalten ebenfalls {{livestock.pair}}.',
            'Der Ochse geht zum Karren und verschwindet, erst dann fährt der Ochsenkarren.',
          ],
        },
        {
          h: 'Schiffe',
        },
        {
          list: [
            'Der Frachtraum ist für alle Waren gemeinsam.',
            'Ein Schiff transportiert 1 Fahrzeug: Handkarren, Ochsenkarren oder Katapult. Dessen Besatzung muss an Bord passen. Ein Großes Schiff transportiert keine Fahrzeuge.',
            'Bei „Andocken“ wählst du ein Ufer. Das Schiff hält {{vehicle.mooringDistance}} Schritte vom gewählten Ort, ein Hafengebäude ist nicht nötig.',
            'Auf See steigt niemand ein oder aus.',
            'Ctrl/Cmd + Klick dockt an und setzt die Besatzung ab.',
          ],
        },
        {
          h: 'Frachtraum',
        },
        {
          list: [
            '„Zielmenge“: Wie viele Stück im Frachtraum sein sollen. Die Summe der Zielmengen übersteigt die Kapazität nicht.',
            '„durch den Träger“: Ein Träger mit Arbeitsplatz zieht den Karren und fährt, was er auf jeder Fahrt aufhebt. Die Zielmengen sind gesperrt.',
            'Wer lädt, steigt aus, wenn der Karren steht oder das Schiff angedockt ist. Auf See arbeitet niemand.',
            'Geladen wird je 1 Stück: Haufen, Gebäude bis {{vehicle.cargoSearch}} Schritte, dann weiter weg.',
            'Die Quelle muss auf derselben Landmasse liegen wie die Tür. Essen aus Wohnhäusern bleibt dort.',
            'Zielmenge 0 oder unter dem Inhalt: Der Überschuss geht ins nächste Lagerhaus oder Hauptquartier mit Platz, bis {{vehicle.cargoSearch}} Schritte von der Tür. Sonst landet er am Boden.',
            'Ist der Kommandant Soldat, Held, [[job:scout|Kundschafter]] oder [[job:druid|Druide]] und lädt sonst niemand, senkt er die Zielmenge, wenn es die Ware nirgends gibt. Lädt jemand anderes mit, bleibt sie.',
            'Ein Fahrbefehl ruft die Besatzung vor der Abfahrt an Bord.',
          ],
        },
        {
          h: 'Verlust eines Fahrzeugs',
        },
        {
          table: {
            head: ['Lage', 'Besatzung an Bord', 'Transportiertes Fahrzeug', 'Ladung'],
            rows: [
              [
                'Karren, [[good:catapult|Katapult]]',
                'Steigt an der Tür aus',
                '-',
                'Verstreut bis {{vehicle.spill}} Schritte ringsum',
              ],
              ['Schiff angedockt', 'Geht an Land', 'Steht an der Tür', 'Verloren'],
              ['Schiff auf See', 'Ertrinkt', 'Sinkt samt Besatzung', 'Verloren'],
            ],
            foot: 'Solange der Rumpf steht, ist die Besatzung an Bord nicht zu treffen. Wer außerhalb steht, verliert nur die Zuweisung.',
          },
        },
      ],
      see: ['article:hauling', 'article:trade', 'article:catapult', 'article:livestock', 'good:handcart'],
    },
    {
      id: 'diplomacy',
      name: 'Diplomatie',
      lead: 'Das Verhältnis gilt in eine Richtung: deines zu ihnen und ihres zu dir sind zwei getrennte Einstellungen.',
      blocks: [
        {
          h: 'Was das Verhältnis bewirkt',
        },
        {
          table: {
            head: ['Aktion', 'Feindlich', 'Neutral', 'Freundlich'],
            rows: [
              ['Du greifst ihre Leute und Gebäude an', 'ja', 'nein', 'nein'],
              ['[[job:scout|Kundschafter]] nimmt ihre Ochsen und Schafe', 'ja', 'nein', 'nein'],
              [
                'Handel des [[job:trader|Händlers]] in ihrem Gebäude mit Angebot',
                'nein',
                'nein',
                'ja, beiderseits',
              ],
              ['Gemeinsame Kartenansicht', 'nein', 'nein', 'ja, beiderseits'],
              ['Gemeinsamer Sieg der Letzten auf der Karte', 'nein', 'nein', 'ja, beiderseits'],
            ],
            foot: 'Die gemeinsame Ansicht braucht außerdem die Einstellung „Gemeinsame Karte der Verbündeten“ in den Spieleinstellungen.',
          },
        },
        {
          h: 'Was das Verhältnis ändert',
        },
        {
          table: {
            head: ['Ereignis', 'Folge'],
            rows: [
              ['Kartenstart', 'Die Karte legt die Verhältnisse fest, ein Paar ohne Eintrag beginnt neutral'],
              ['Schlag von einem Fremden', 'Das Verhältnis des Opfers zum Angreifer wird feindlich'],
              ['Computer neutral, du feindlich zu ihm', 'Der Computer wird feindlich'],
              [
                'Du senkst dein Verhältnis zu einem freundlichen Computer',
                'Auch der Computer senkt seines, auf deine Stufe',
              ],
              ['Computer feindlich', 'Kehrt nicht von selbst zum Frieden zurück'],
              ['Gezahlter Tribut, Missionsereignis', 'Können ihr Verhältnis ändern'],
              ['„Verhältnis durch das Szenario vorgegeben“', 'Im Fenster Diplomatie nicht änderbar'],
            ],
          },
        },
        {
          h: 'Friedenszeit',
        },
        {
          list: [
            'Kampf zwischen Spielern im Frieden ist gesperrt.',
            'Du betrittst nichts und baust nichts bis {{peace.keepOut}} Schritte vom Gebäude des Partners, außer dein eigenes ist näher.',
            'Warnungen kommen {{peace.noticeFirstMinutes}} Min. und {{peace.noticeLastMinutes}} Min. vor dem Ende.',
          ],
        },
        {
          h: 'Erstkontakt',
        },
        {
          p: 'Unter Nebel kommt ein Stamm ins Fenster Diplomatie, wenn du einen seiner Menschen, ein Gebäude, Fahrzeug oder eine Palisade siehst oder wenn er dich angreift. Der Kontakt erlischt nicht.',
        },
        {
          h: 'Tribut',
        },
        {
          p: 'Einen Tribut eröffnet nur das Kartenskript. „Zahlen“ im Fenster Diplomatie nimmt die Ware sofort weg, niemand trägt sie. Reihenfolge der Quellen:',
        },
        {
          steps: [
            'Erstes [[building:headquarters|Hauptquartier]].',
            'Übrige Hauptquartiere und Lagerhäuser.',
            'Werkstätten, nur eigene Produkte, ohne Rohstoffe.',
          ],
        },
        {
          list: [
            'Wohnhäuser, Türme, [[building:barracks|Kaserne]], [[building:school|Schule]] und Haufen am Boden zahlen nicht.',
            'Eine Forderung nach Essen nimmt jedes Gericht derselben Klasse an.',
            'Das „Lagerminimum“ schützt Ware nicht vor Tribut.',
          ],
        },
      ],
      see: ['article:trade', 'article:fog', 'article:walls'],
    },
    {
      id: 'fog',
      name: 'Nebel und Sicht',
      lead: 'Du siehst nur, was in Sichtweite deiner Leute und Gebäude liegt.',
      blocks: [
        {
          h: 'Kartenmodi',
        },
        {
          table: {
            head: ['Einstellung', 'Start', 'Gelände außer Sicht'],
            rows: [
              ['Aufgedeckt', 'alles sichtbar', 'kein Nebel'],
              ['Klassisch', 'schwarze Karte', 'einmal erkundet, bleibt es sichtbar'],
              ['Klassisch + Kriegsnebel', 'schwarze Karte', 'graues Gelände, ohne Einheiten'],
              ['Erkundet', 'graues Gelände, ohne Einheiten', 'einmal erkundet, bleibt es sichtbar'],
              ['Erkundet + Kriegsnebel', 'graues Gelände, ohne Einheiten', 'graues Gelände, ohne Einheiten'],
            ],
          },
        },
        {
          p: 'Graues Gelände zeigt Gebäude, Palisaden, Fahrzeuge, Kisten, Rohstoffe, Stämme und Warenhaufen im zuletzt gesehenen Zustand. Menschen und Tiere zeigt es nicht. Diese Erinnerung gilt auch für die Minimap und den Spielstand.',
        },
        {
          h: 'Sichtweite',
        },
        {
          figure: {
            id: 'vision',
            caption: 'Wer was sieht',
          },
        },
        {
          table: {
            head: ['Wer', 'Sichtweite, Schritte'],
            rows: [
              ['[[job:scout|Kundschafter]], [[building:headquarters|Hauptquartier]]', '{{vision.scout}}'],
              ['Held, [[good:ship_small|Schiff]], [[good:ship_big|Großes Schiff]]', '{{vision.hero}}'],
              ['Soldat, Gebäude, auch Turm und Wohnhaus', '{{vision.soldier}}'],
              [
                '[[good:handcart|Handkarren]], [[good:oxcart|Ochsenkarren]], [[good:catapult|Katapult]]',
                '{{vision.cart}}',
              ],
              ['Erwachsener Zivilist, Frau, eigenes Tier', '{{vision.adult}}'],
              ['Kind', '{{vision.child}}'],
              ['Baustelle', '0'],
            ],
            num: [1],
            foot: 'Schritte waagerecht gezählt. Palisaden, Straßen und Wegweiser sehen nichts.',
          },
        },
        {
          h: 'Kampf im Nebel',
        },
        {
          p: 'Soldaten greifen auch im Nebel an, das [[good:catapult|Katapult]] von selbst nicht. Der [[job:hunter|Jäger]] jagt unabhängig vom Nebel.',
        },
      ],
      see: ['article:scout', 'article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'scout',
      name: 'Kundschafter',
      lead: 'Ein Kundschafter hat keinen Arbeitsplatz. Ohne Befehl steht er und wartet.',
      blocks: [
        {
          h: 'Was er tut',
        },
        {
          table: {
            head: ['Aufgabe', 'Wie', 'Mehr'],
            rows: [
              [
                'Wegweiser',
                'Befehl „Baue Wegweiser“, ohne Material',
                '[[article:roads|Straßen und Wegweiser]]',
              ],
              ['Land erkunden', 'Befehl „Kläre Gegend auf“', 'Unten'],
              [
                'Tiere',
                'Übernimmt wilde Ochsen und Schafe im Vorbeigehen',
                '[[article:livestock|Viehzucht]]',
              ],
              [
                'Sicht',
                '{{vision.scout}} Schritte, die größte unter Menschen',
                '[[article:fog|Nebel und Sicht]]',
              ],
            ],
            foot: 'Die Wegweiser-Reichweite gilt für ihn nicht, er geht über die ganze Karte.',
          },
        },
        {
          h: '„Kläre Gegend auf“',
        },
        {
          list: [
            'Der Befehl wirkt nur auf Kundschafter, auch auf mehrere ausgewählte zugleich.',
            'Er geht in Ringen vom Befehlsort aus, immer zum nächsten unerkundeten Land.',
            'Er bleibt auf einer Landmasse. Auf eine andere bringt ihn nur ein [[article:vehicles|Schiff]].',
            'Er lässt schmale Streifen an Ufern und Kartenrändern aus, kleine Flecken bleiben also unerkundet.',
            'Unterwegs isst und schläft er und geht dann von seinem Standort aus weiter.',
          ],
        },
        {
          h: 'Wann er aufhört',
        },
        {
          table: {
            head: ['Ereignis', 'Folge'],
            rows: [
              ['Kein Land mehr zu erkunden', 'Meldung „Land erkundet“, der Kundschafter wartet'],
              [
                'Mehr als {{explore.maxFailedLegs}} gescheiterte Ziele in Folge',
                'Der Rest gilt als unerreichbar, „Land erkundet“',
              ],
              ['Kartenmodus „Aufgedeckt“', '„Land erkundet“ sofort'],
              ['Neuer Befehl', 'Die Erkundung verfällt'],
              ['Befehl mit Shift', 'Wartet bis zum Ende der Erkundung'],
              ['Berufswechsel', 'Die Erkundung verfällt'],
            ],
          },
        },
      ],
      see: ['article:roads', 'article:livestock', 'article:fog', 'job:scout'],
    },
    {
      id: 'wildlife',
      name: 'Wildtiere und Jagd',
      lead: 'Eine aggressive Herde stürzt sich auf Menschen im Umkreis von {{wild.aggro}} Schritten um ihren Platz und kehrt nach {{wild.giveUp}} Schritten um.',
      blocks: [
        {
          data: 'animals',
        },
        {
          h: 'Aggression',
        },
        {
          table: {
            head: ['Gruppe', 'Tiere', 'Verhalten'],
            rows: [
              ['Aggressiv', 'Wolf, Löwe, Löwin, Eisbär', 'Greifen von selbst an'],
              [
                'Wütend nach einem Schlag',
                'Bär, Elefant',
                'Die Wut hält {{wild.angrySeconds}} s ab dem letzten Schlag an, ein begonnener Angriff dauert bis zum Tod des Ziels oder bis es Schutz findet',
              ],
              [
                'Scheu',
                'Alle übrigen',
                'Ein getroffenes Leittier flieht bis {{wild.flight}} Schritte, die Herde hinterher',
              ],
            ],
            foot: 'Die Wildziege greift weder an, noch flieht sie.',
          },
        },
        {
          list: [
            'Ein Schlag alarmiert Tiere derselben Art bis {{wild.kinAlarm}} Schritte um das getroffene.',
            'Gebäude und Fahrzeuge greifen Tiere nicht an.',
          ],
        },
        {
          h: 'Herdenwachstum',
        },
        {
          p: 'Eine Wildherde mit mehr als 1 Tier und weniger Tieren als in der Spalte „Herde“ gewinnt alle {{wild.growthMinutes}} Min. 1 erwachsenes Tier dazu, aber nur etwa 1 von 5 Herden wächst.',
        },
        {
          h: 'Was der Jäger jagt',
        },
        {
          list: [
            'Das Jagdgebiet reicht {{flag.hunter}} Schritte um Arbeitsfahne oder Arbeitsplatz. Die Verfolgung geht {{wild.huntChase}} Schritte darüber hinaus.',
            'Er wählt nahe und schwache Tiere.',
            'Er jagt je 1 Beute und nimmt die nächste erst, wenn er die Beute eingesammelt hat.',
            'Der Jägerbogen nimmt {{wild.hunterShot}} je Schuss, Reichweite {{hunterBow.min}}-{{hunterBow.max}} Schritte.',
            'Erwachsene Wildziegen jagt er nicht von selbst, ihre Jungtiere schon.',
            'Er übergeht Tiere mit Besitzer, wütende Tiere und Tiere auf einer anderen Landmasse.',
          ],
        },
        {
          h: 'Beute',
        },
        {
          table: {
            head: ['Tier', 'Vom Jäger erlegt', 'Von anderen getötet'],
            rows: [
              [
                'Ausgewachsen',
                '2 [[good:leather|Leder]], 2 [[good:meat|Fleisch]]',
                '1 [[good:meat|Fleisch]]',
              ],
              ['Jungtier', '1 [[good:leather|Leder]], 1 [[good:meat|Fleisch]]', 'nichts'],
              [
                'Pferd, ausgewachsen',
                '1 [[good:leather|Leder]], 1 [[good:meat|Fleisch]]',
                '1 [[good:meat|Fleisch]]',
              ],
              ['Fohlen', '1 [[good:leather|Leder]]', 'nichts'],
            ],
          },
        },
      ],
      see: ['article:damage', 'article:gathering', 'article:livestock', 'job:hunter'],
    },
    {
      id: 'livestock',
      name: 'Viehzucht',
      lead: 'Der Viehzüchter züchtet nur bei genau {{livestock.pair}} erwachsenen Tieren einer Art. Das dritte ausgewachsene Tier wird geschlachtet.',
      blocks: [
        {
          figure: {
            id: 'livestock-cycle',
            caption: 'Der Zuchtkreislauf',
          },
        },
        {
          h: 'Woher die Tiere kommen',
        },
        {
          table: {
            head: ['Wer', 'Was er tut', 'Reichweite, Schritte'],
            rows: [
              [
                '[[job:scout|Kundschafter]]',
                'Jeder seiner Schritte übernimmt wilde Ochsen und Schafe sowie die Herde eines Spielers, zu dem dein Verhältnis feindlich ist. Eine übrige feindliche Herde in der Nähe läuft auseinander',
                '{{livestock.captureRange}}, Auseinanderlaufen {{livestock.scatterRange}}',
              ],
              [
                '[[job:breeder|Viehzüchter]]',
                'Holt dein nächstes Tier ohne Viehzüchterei in seine Viehzüchterei',
                'gleiches Land',
              ],
              [
                '[[job:breeder|Viehzüchter]]',
                'Unter einem Paar holt er ein Tier aus deiner anderen Viehzüchterei, die mehr als ein Paar hat',
                'gleiches Land',
              ],
            ],
            foot: 'Ein stehender Kundschafter übernimmt nichts.',
          },
        },
        {
          h: 'Jungtiere und Schlachtung',
        },
        {
          table: {
            head: ['Tier', 'Jungtier kostet', 'Schlachtung bringt'],
            rows: [
              [
                '[[good:sheep|Schaf]]',
                '{{livestock.calfWater}} [[good:water|Wasser]], {{livestock.calfWheat}} [[good:wheat|Weizen]]',
                '{{livestock.sheepWool}} [[good:wool|Wolle]], {{livestock.sheepMeat}} [[good:meat|Fleisch]]',
              ],
              [
                '[[good:cattle|Ochse]]',
                '{{livestock.calfWater}} [[good:water|Wasser]], {{livestock.calfWheat}} [[good:wheat|Weizen]]',
                '{{livestock.cattleLeather}} [[good:leather|Leder]], {{livestock.cattleMeat}} [[good:meat|Fleisch]]',
              ],
            ],
            foot: 'Jungtier und Schlachtung dauern je 8 s. Die Produktwahl des Viehzüchters bestimmt, um welche Art er sich kümmert. In der Viehzüchterei lagern je {{livestock.farmShelf}} Stück Fleisch, Wolle und Leder.',
          },
        },
        {
          list: [
            'Die [[building:work_animal_farm|Viehzüchterei]] fasst insgesamt {{livestock.farmHerd}} Tiere, beide Arten und Jungtiere unterwegs eingerechnet.',
            'Ein Jungtier wächst {{livestock.growSeconds}} s ({{livestock.growMinutes}} Min.) und zählt nicht zum Paar.',
            'Das Elterntier muss bei der Geburt bis {{livestock.birthRange}} Schritte von der Tür der Viehzüchterei sein. Weiter weg: Rohstoff verloren, kein Jungtier.',
            'Besatzung der Viehzüchterei: {{livestock.breeders}} [[job:breeder|Viehzüchter]] und {{livestock.carriers}} [[job:carrier|Träger]].',
          ],
        },
        {
          h: 'Status der Viehzüchterei',
        },
        {
          table: {
            head: ['Meldung', 'Bedeutung'],
            rows: [
              ['„Keine Tiere“', 'Kein Tier dieser Art, ein Kundschafter muss her'],
              ['„Nur ein Tier“', 'Ein zweites Tier wird gebraucht'],
              ['„Jungtiere wachsen heran“', 'Die Zucht geht weiter, wenn das Paar ausgewachsen ist'],
              ['„Herde voll“', 'Der Viehzüchter wartet auf ausgewachsene Jungtiere'],
            ],
          },
        },
      ],
      see: ['article:vehicles', 'article:wildlife', 'article:food', 'building:work_animal_farm'],
    },
    {
      id: 'religion',
      name: 'Religion und Tempel',
      lead: 'Der Religionsbalken sinkt nur, wenn Waffen und Rüstungen entstehen. Bei 0% beginnt ein Handwerker keine Charge, die Religion kostet.',
      blocks: [
        {
          h: 'Kosten je Charge',
        },
        {
          table: {
            head: ['Beruf', '15%', '30%'],
            rows: [
              [
                '[[job:armorer|Waffenbauer]]',
                '[[good:bow_short|Kurzbogen]], [[good:spear_wooden|Holzspeer]]',
                '[[good:bow_long|Langbogen]]',
              ],
              [
                '[[job:smith|Schmied]]',
                '[[good:spear_iron|Eisenspeer]], [[good:sword_shord|Kurzschwert]]',
                '[[good:sword_long|Langschwert]], [[good:armor_chain|Kettenhemd]], [[good:armor_plate|Plattenrüstung]]',
              ],
              [
                '[[job:sewer|Näher]]',
                '[[good:armor_wool|Waffenrock]], [[good:armor_leather|Lederrüstung]]',
                '-',
              ],
            ],
            foot: 'Bei allen Stämmen gleich. Andere Waren dieser Berufe verbrauchen keine Religion.',
          },
        },
        {
          list: [
            'Unter {{need.drivePct}}% gehen Waffenbauer und Schmied beten. Ohne Ort zum Beten kommt bei {{need.criticalPct}}% die Meldung „Will beten“.',
            'Der Näher geht nicht von selbst, er braucht den Befehl „Bete“.',
            'Bei 0% beendet der Handwerker eine schon bezahlte Charge noch.',
          ],
        },
        {
          h: 'Wo man betet',
        },
        {
          table: {
            head: ['Ort', 'Bedingung'],
            rows: [
              ['Wohnhaus', 'Darin brennt Heiliges Feuer, immer erste Wahl'],
              ['[[building:work_temple|Tempel]]', 'Fertig, deiner'],
              ['[[building:headquarters|Hauptquartier]]', 'Fertig, deines'],
            ],
            foot: 'Ein Gebet dauert {{pray.seconds}} s und bringt +{{pray.pct}}% Religion. Wohnhäuser ohne Feuer und fremde Gebäude zählen nicht.',
          },
        },
        {
          h: 'Heiliges Feuer',
        },
        {
          p: 'Geht ab Wohnhaus 3. 1 [[good:holy_oil|Öl]] brennt {{oil.burnMinutes}} Min., das volle Feuer {{oil.fullBurnMinutes}} Min.',
        },
        {
          h: 'Tempelaura',
        },
        {
          table: {
            head: ['Wirkung', 'Wert'],
            rows: [
              ['Reichweite', '{{aura.range}} Schritte'],
              ['Gesundheit', '+{{aura.perSecond}} pro Sekunde, bis {{aura.ceiling}}'],
              ['Religion', '+{{aura.pietyPct}}% pro Sekunde, wenn der Balken bis {{need.satedPct}}% steht'],
              ['Wer', 'Alle Leute des Tempelbesitzers. Kinder bekommen Gesundheit'],
              ['Bedingung', 'Tempel fertig und unbeschädigt'],
              ['Mehrere Tempel', 'Es wirkt eine Aura, die Werte addieren sich nicht'],
            ],
            foot: 'Gesundheit über {{health.human}} bleibt, bis Wunden sie nehmen.',
          },
        },
      ],
      see: ['article:needs', 'article:health', 'building:work_temple', 'good:holy_oil'],
    },
    {
      id: 'chests',
      name: 'Kisten und Briefe',
      lead: 'Briefe aus Kisten setzen ein Gebäude sofort, ohne Bau, Material und nötige Entdeckungen.',
      blocks: [
        {
          h: 'Wer öffnet',
        },
        {
          table: {
            head: ['Kiste', 'Wer'],
            rows: [
              ['Kiste', 'jeder Erwachsene'],
              ['Magische Kiste', '[[job:druid|Druide]], Held'],
            ],
            foot: 'Befehl „Kiste öffnen“. Für Siedler gilt ihre Gehreichweite. Waren fallen neben die Kiste.',
          },
        },
        {
          h: 'Inhalt',
        },
        {
          table: {
            head: ['Belohnung', 'Kiste', 'Magische'],
            rows: [
              ['Trank oder Amulett', '{{chest.singleWooden}}', '{{chest.singleMagical}}'],
              ['Große Tränke, 1 Art', '{{chest.bulkWooden}}', '{{chest.bulkMagical}}'],
              [
                '[[good:armor_chain|Kettenhemd]], [[good:armor_plate|Plattenrüstung]] oder [[good:shoes|Schuhe]]',
                '{{chest.wearWooden}}',
                '{{chest.wearMagical}}',
              ],
              ['[[good:bread|Nahrung]]', '{{chest.foodWooden}}', '{{chest.foodMagical}}'],
              ['[[good:catapult|Katapult]]', '1', '1'],
              [
                '{{chest.settlers}} Zivilisten, {{chest.settlers}} Frauen, {{chest.settlers}} Langschwertträger oder {{chest.settlers}} Langbogenschützen',
                '{{chest.settlers}}',
                '{{chest.settlers}}',
              ],
              [
                '{{chest.wolves}} Wölfe oder {{chest.lions}} Löwen, wilde Herde',
                '{{chest.wolves}} oder {{chest.lions}}',
                '{{chest.wolves}} oder {{chest.lions}}',
              ],
            ],
            num: [1, 2],
            foot: 'Die Karte wählt den Inhalt jeder Kiste.',
          },
        },
        {
          h: 'Briefe',
        },
        {
          table: {
            head: ['Brief', 'Wirkung'],
            rows: [
              ['Ein Haus deiner Wahl setzen', 'Beliebiges Gebäude aus dem Katalog, steht sofort'],
              ["'Name' setzen", 'Das genannte Gebäude, steht sofort'],
              ["'Name' setzen und dessen Lager füllen", 'Das genannte Gebäude mit randvollem Lager'],
            ],
            foot: 'Ein Brief verschwindet nach Gebrauch, ein abgelehnter Platz verbraucht ihn nicht. Die Liste steht im Baufenster unter „Briefe“.',
          },
        },
        {
          p: 'Gebäude auf Briefen: [[building:home_level_01|Wohnhaus 2]], [[building:home_level_04|Wohnhaus 5]], [[building:stock_02|Lagerhaus 3]], [[building:headquarters|Hauptquartier]], [[building:work_well_00|Brunnen]], [[building:work_farm_00|Farm]], [[building:work_mill_00|Mühle]], [[building:work_bakery_00|Bäckerei 1]], [[building:work_temple|Tempel]], [[building:school|Schule]], [[building:barracks|Kaserne]], [[building:tower_01|Wachturm 2]].',
        },
        {
          h: 'Briefe mit Werkstatt',
        },
        {
          table: {
            head: ['Gebäude mit Lager', 'Siedler', 'Entdeckt dauerhaft'],
            rows: [
              [
                '[[building:work_smithy_01|Schmiede 2]]',
                '1 [[job:smith|Schmied]]',
                '[[good:sword_long|Langschwert]]',
              ],
              [
                '[[building:work_armory_00|Waffenhütte 1]]',
                '1 [[job:armorer|Waffenbauer]]',
                '[[good:bow_short|Kurzbogen]]',
              ],
              [
                '[[building:work_coin_mint|Münzpräge]]',
                '1 [[job:coin_maker|Münzmacher]]',
                '[[good:coin|Münze]]',
              ],
              [
                '[[building:work_druid_00|Alchemistenhütte 1]]',
                '1 [[job:druid|Druide]]',
                '[[good:holy_oil|Öl]]',
              ],
              [
                '[[building:work_druid_01|Alchemistenhütte 2]]',
                '1 [[job:druid|Druide]]',
                '[[good:holy_oil|Öl]], kleine Tränke',
              ],
            ],
            foot: 'So eine Kiste gibt einen Brief, einen Siedler in diesem Beruf und den Zugang zum Beruf.',
          },
        },
      ],
      see: ['article:construction', 'article:trades', 'article:draughts'],
    },
  ],
};
