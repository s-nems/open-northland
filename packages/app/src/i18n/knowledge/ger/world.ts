import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const WORLD: ArticleGroup = {
  group: 'Welt',
  items: [
    {
      id: 'goals',
      name: 'Missionsziele und Spielende',
      lead: 'Du verlierst, wenn du keinen erwachsenen Mann mehr hast. Ein Held zählt mit. Frauen, Cyra und Kinder nicht.',
      blocks: [
        {
          h: 'Wie eine Karte endet',
        },
        {
          table: {
            head: ['Karte', 'Sieg', 'Niederlage'],
            rows: [
              [
                'Mehrspielerkarte, auch allein gespielt',
                'Ziele der Karte, Tabelle unten',
                'Kein erwachsener Mann oder eine von der Mission verkündete Niederlage',
              ],
              [
                'Kampagnenmission',
                'Verkündet die Mission',
                'Verkündet die Mission, oder kein erwachsener Mann',
              ],
              ['Karte ohne Mission', 'Letzter auf der Karte', 'Kein erwachsener Mann'],
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
                'Vorrat in Gebäuden. Haufen am Boden, Frachträume und Ware in den Händen zählen nicht',
                'Sieg, wenn du alle Mengen hast',
              ],
              ['„Einwohner“', 'Jeder Mensch des Spielers, auch Kinder', 'Sieg bei der geforderten Zahl'],
              [
                '„Soldaten“',
                'Erwachsene Männer im Soldatenberuf, ohne Helden',
                'Sieg bei der geforderten Zahl',
              ],
              [
                'Verkündung der Mission',
                'Die Mission verkündet Sieg oder Niederlage des Spielers',
                'Sieg oder Niederlage',
              ],
              [
                'Letzter auf der Karte',
                'Mindestens ein Spieler ist ausgeschieden, und die Übrigen sind gegenseitig freundlich: [[article:diplomacy|Diplomatie]]',
                'Sieg aller Übrigen',
              ],
            ],
            foot: 'Den Fortschritt bei Waren, „Einwohnern“ und „Soldaten“ zeigt das Spiel als aktuell/gefordert. Letzter auf der Karte gilt nur, wenn die Karte keine Ziele für Waren oder Leute hat und die Mission kein Ergebnis verkündet.',
          },
        },
        {
          list: [
            'Das Spiel prüft zuerst die Männer, dann der Reihe nach die Ziele der Karte. Männer zählt es erst nach {{match.graceSeconds}} s Spielzeit.',
            'Die erste erfüllte Bedingung entscheidet endgültig über den Spieler.',
            'Der Sieg eines Spielers beendet das Spiel für die anderen nicht, und ein Sieger, der danach seine Leute verliert, bleibt Sieger.',
            'Eine Karte kann einen bestimmten Spieler von der Regel mit dem erwachsenen Mann ausnehmen.',
          ],
        },
        {
          h: 'Was vom Besiegten bleibt',
        },
        {
          steps: [
            'Kein erwachsener Mann: Fahrzeuge verschwinden sofort.',
            'Die Niederlage folgt bei der nächsten Zielprüfung, alle {{match.checkSeconds}} s.',
            'Bei der folgenden Prüfung verschwinden Gebäude, Fahrzeuge und Wegweiser, und an der Stelle jedes Menschen an Land bleibt ein wildes Huhn.',
            'Die Tiere des Spielers verwildern, wo sie stehen.',
          ],
        },
        {
          p: 'So läuft es auf Mehrspielerkarten. In Kampagnenmissionen und auf Karten ohne Mission verschwinden nur die Fahrzeuge, und der Computer hört auf zu spielen.',
        },
      ],
      see: ['article:diplomacy', 'article:family', 'article:heroes'],
    },
    {
      id: 'vehicles',
      name: 'Fahrzeuge und Schiffe',
      lead: 'Ohne Kommandant steht ein Fahrzeug. Ein Schiff nimmt mehr Leute mit, ein Großes Schiff mehr Ware.',
      blocks: [
        {
          data: 'vehicles',
        },
        {
          table: {
            head: ['Fahrzeug', 'Wer einsteigt'],
            rows: [
              [
                '[[good:handcart|Handkarren]], [[good:oxcart|Ochsenkarren]]',
                '[[job:carrier|Träger]], [[job:trader|Händler]]',
              ],
              ['[[good:ship_small|Schiff]], [[good:ship_big|Großes Schiff]]', 'jeder Erwachsene'],
              ['[[good:catapult|Katapult]]', 'Soldat, Held'],
            ],
          },
        },
        {
          list: [
            'Die Spalte „Passagiere“ zählt den Kommandanten nicht mit. Der zuerst Zugewiesene wird Kommandant. Geht er, übernimmt der nächste Passagier.',
            'Wer einsteigt, verliert seinen Arbeitsplatz. Ausnahme: Träger mit Arbeitsplatz und Händler ziehen den Karren selbst und behalten die Arbeit.',
            'Den Frachtraum bedienen der Kommandant und jeder erwachsene Mann an Bord. Soldaten, Helden, [[job:scout|Kundschafter]] und [[job:druid|Druiden]] laden nur als Kommandant. Ist niemand da, erscheint „Kein Träger“.',
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
            foot: 'Hexfelder pro Sekunde. Voll heißt {{haul.handcart}} Stück auf dem Handkarren und {{haul.oxcart}} auf dem Ochsenkarren. Der Verlust wächst mit der Ladung: ein halber Karren, halber Verlust. Welcher Karren für eine Route: [[article:trade|Handel]].',
          },
        },
        {
          list: [
            'So fährt ein Karren mit Kommandant, Schuhe ändern hier nichts.',
            'Träger und Händler, die den Karren selbst ziehen, gehen in ihrem eigenen Schritt. Mit Schuhen sind sie schneller und verlieren denselben Prozentsatz.',
            'Ein Schiff wird durch Ladung nicht langsamer und fährt etwa {{pace.ship}} Hexfelder/s.',
          ],
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
                '[[building:work_joinery_02|Schreinerei 3]] und [[building:work_joinery_03|4]]',
                '{{cost.handcartWood}} [[good:wood|Holz]]',
              ],
              [
                '[[good:oxcart|Ochsenkarren]]',
                '[[building:work_joinery_02|Schreinerei 3]] und [[building:work_joinery_03|4]]',
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
            'Er nimmt den nächsten erwachsenen [[good:cattle|Ochsen]] auf derselben Landmasse. Ein Ochse im Inneren einer Viehzüchterei zählt nicht.',
            'Jede Viehzüchterei behält {{livestock.pair}} erwachsene Ochsen. Ebenso viele bleiben von einer Herde ohne Viehzüchterei.',
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
            '„Andocken“: Wähle ein Ufer, das Schiff hält {{vehicle.mooringDistance}} Hexfelder davon entfernt. Ein Hafen ist nicht nötig.',
            'Auf See steigt niemand ein oder aus.',
            'Ctrl/Cmd + Rechtsklick dockt an und setzt die Besatzung ab.',
          ],
        },
        {
          h: 'Frachtraum',
        },
        {
          list: [
            '„Zielmenge“: Wie viele Stück im Frachtraum sein sollen. Die Summe der Zielmengen übersteigt die Kapazität nicht.',
            '„durch den Träger“: Ein Träger zieht den Karren und entscheidet auf jeder Fahrt selbst, was er auflädt. Zielmengen kannst du nicht einstellen.',
            'Wer lädt, steigt aus, wenn der Karren steht oder das Schiff angedockt ist.',
            'Wer lädt, trägt je 1 Stück. Er sucht zuerst Haufen bis {{vehicle.cargoSearch}} Hexfelder vom Karren, dann Gebäude in derselben Reichweite und zuletzt überall, wohin Wegweiser reichen.',
            'Die Ware muss auf derselben Landmasse liegen wie der Karren oder das Schiff. Essen aus Wohnhäusern nimmt niemand.',
            'Senkst du die Zielmenge, kommt der Überschuss ins nächste Lagerhaus oder Hauptquartier mit Platz, bis {{vehicle.cargoSearch}} Hexfelder vom Karren. Gibt es keines, landet er am Boden.',
            'Lädt ein Kommandant selbst, der Soldat oder Held ist, und gibt es die Ware nirgends, sinkt die Zielmenge von selbst. Dasselbe gilt für [[job:scout|Kundschafter]] und [[job:druid|Druiden]].',
            'Ein Fahrbefehl ruft die Besatzung vor der Abfahrt an Bord.',
          ],
        },
        {
          h: 'Verlust eines Fahrzeugs',
        },
        {
          table: {
            head: ['Fahrzeug', 'Besatzung an Bord', 'Transportiertes Fahrzeug', 'Ladung'],
            rows: [
              [
                'Karren, [[good:catapult|Katapult]]',
                'Steigt daneben aus',
                '-',
                'Verstreut bis {{vehicle.spill}} Hexfelder ringsum',
              ],
              ['Schiff angedockt', 'Geht an Land', 'Steht am Ufer', 'Verloren'],
              ['Schiff auf See', 'Ertrinkt', 'Sinkt samt Besatzung', 'Verloren'],
            ],
            foot: 'Die Besatzung im Fahrzeug lässt sich nicht treffen, solange das Fahrzeug ganz ist. Wer daneben steht, gehört einfach nicht mehr zur Besatzung.',
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
              ['Gemeinsamer Sieg „Letzter auf der Karte“', 'nein', 'nein', 'ja, beiderseits'],
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
              [
                'Kartenstart',
                'Die Karte legt die Verhältnisse fest. Wo sie nichts angibt, beginnt ihr neutral',
              ],
              ['Ein anderer Spieler schlägt dich', 'Dein Verhältnis zu ihm wird von selbst feindlich'],
              ['Du stellst feindlich gegenüber einem neutralen Computer', 'Der Computer wird auch feindlich'],
              ['Neutraler Computer auf einer Inselkarte', 'Wird von selbst feindlich gegenüber den Spielern'],
              [
                'Du senkst dein Verhältnis zu einem freundlichen Computer',
                'Auch der Computer senkt seines, auf deine Stufe',
              ],
              ['Computer feindlich', 'Kehrt nicht von selbst zum Frieden zurück'],
              ['Mission', 'Kann das Verhältnis ändern, auch nach gezahltem Tribut'],
              ['„Verhältnis durch das Szenario vorgegeben“', 'Im Fenster Diplomatie nicht änderbar'],
            ],
          },
        },
        {
          h: 'Friedenszeit',
        },
        {
          list: [
            'Die „Friedenszeit“ stellst du vor dem Spiel ein. Spieler, für die sie gilt, können nicht gegeneinander kämpfen.',
            'Du schickst niemanden hin und baust nichts bis {{peace.keepOut}} Hexfelder von seinem Gebäude, außer der Ort liegt näher an deinem eigenen Gebäude.',
            'Warnungen kommen {{peace.noticeFirstMinutes}} Min. und {{peace.noticeLastMinutes}} Min. vor dem Ende.',
          ],
        },
        {
          h: 'Erstkontakt',
        },
        {
          p: 'Unter Nebel kommt ein Stamm ins Fenster Diplomatie, wenn du einen seiner Menschen, ein Gebäude, Fahrzeug oder eine Palisade siehst oder wenn er dich angreift. Er bleibt dann dort.',
        },
        {
          h: 'Tribut',
        },
        {
          p: 'Tribut fordert nur eine Mission. „Zahlen“ im Fenster Diplomatie nimmt die Ware sofort weg, niemand trägt sie. Das Spiel nimmt sie aus:',
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
            'Fordert die Mission Essen, zahlst du mit jedem Gericht derselben Art.',
            'Das „Lagerminimum“ schützt Ware nicht vor Tribut.',
          ],
        },
      ],
      see: ['article:trade', 'article:fog', 'article:walls'],
    },
    {
      id: 'fog',
      name: 'Nebel und Sicht',
      lead: 'Am weitesten sehen Kundschafter und Hauptquartier, {{vision.scout}} Hexfelder. Eine Baustelle sieht nichts.',
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
              ['Klassisch + Kriegsnebel', 'schwarze Karte', 'graues Gelände, ohne Menschen und Tiere'],
              ['Erkundet', 'graues Gelände, ohne Menschen und Tiere', 'einmal erkundet, bleibt es sichtbar'],
              [
                'Erkundet + Kriegsnebel',
                'graues Gelände, ohne Menschen und Tiere',
                'graues Gelände, ohne Menschen und Tiere',
              ],
            ],
          },
        },
        {
          p: 'Graues Gelände zeigt Gebäude, Palisaden, Fahrzeuge, Kisten, Rohstoffe, Stämme und Warenhaufen im zuletzt gesehenen Zustand. Menschen und Tiere zeigt es nicht.',
        },
        {
          h: 'Sichtweite',
        },
        {
          figure: {
            id: 'vision',
            caption: 'Sichtweite',
          },
        },
        {
          table: {
            head: ['Wer', 'Sichtweite, Hexfelder'],
            rows: [
              ['[[job:scout|Kundschafter]], [[building:headquarters|Hauptquartier]]', '{{vision.scout}}'],
              ['Held, [[good:ship_small|Schiff]], [[good:ship_big|Großes Schiff]]', '{{vision.hero}}'],
              ['Soldat, Gebäude, auch Turm und Wohnhaus', '{{vision.soldier}}'],
              [
                '[[good:handcart|Handkarren]], [[good:oxcart|Ochsenkarren]], [[good:catapult|Katapult]]',
                '{{vision.cart}}',
              ],
              ['Übrige Erwachsene, eigenes Tier', '{{vision.adult}}'],
              ['Kind', '{{vision.child}}'],
              ['Baustelle', '0'],
            ],
            num: [1],
            foot: 'Palisaden, Straßen und Wegweiser sehen nichts. Soldaten und [[job:hunter|Jäger]] finden ihr Ziel auch im Nebel. Das [[good:catapult|Katapult]] wählt von selbst nur Ziele, die es sieht.',
          },
        },
      ],
      see: ['article:scout', 'article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'scout',
      name: 'Kundschafter',
      lead: 'Ein Kundschafter hat keinen Arbeitsplatz. Ohne Befehl steht er.',
      blocks: [
        {
          p: 'Er setzt [[article:roads|Wegweiser]] ohne Material und übernimmt wilde Ochsen und Schafe im Vorbeigehen: [[article:livestock|Viehzucht]]. Wegweiser schränken ihn nicht ein, er geht über die ganze Karte.',
        },
        {
          h: '„Kläre Gegend auf“',
        },
        {
          list: [
            'Du kannst mehrere zugleich schicken.',
            'Er erkundet das Land in Ringen um den Ort des Befehls.',
            'Er verlässt seine Landmasse nicht. Auf eine andere muss ihn ein [[article:vehicles|Schiff]] bringen.',
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
                'Mehr als {{explore.maxFailedLegs}} Mal in Folge kam er nicht ans Ziel',
                'Der Rest gilt als unerreichbar, „Land erkundet“',
              ],
              ['Kartenmodus „Aufgedeckt“', '„Land erkundet“ sofort'],
              ['Neuer Befehl, Berufswechsel', 'Die Erkundung verfällt'],
              ['Befehl mit Shift', 'Führt er nach dem Ende der Erkundung aus'],
            ],
          },
        },
      ],
      see: ['article:roads', 'article:livestock', 'article:fog', 'job:scout'],
    },
    {
      id: 'wildlife',
      name: 'Wildtiere und Jagd',
      lead: 'Eine aggressive Herde stürzt sich auf Menschen bis {{wild.aggro}} Hexfelder um ihren Weideplatz. Sie jagt höchstens {{wild.giveUp}} Hexfelder weit und kehrt dann um.',
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
                'Greifen an, wenn sie getroffen werden',
                'Bär, Elefant',
                'Gefährlich für {{wild.angrySeconds}} s ab dem letzten Treffer. Ein begonnener Angriff dauert, bis das Ziel tot ist oder sich versteckt',
              ],
              [
                'Scheu',
                'Alle übrigen',
                'Ein getroffenes Leittier flieht bis {{wild.flight}} Hexfelder, die Herde hinterher',
              ],
            ],
            foot: 'Die Wildziege greift weder an, noch flieht sie.',
          },
        },
        {
          list: [
            'Triffst du ein Tier, reagieren auch andere derselben Art bis {{wild.kinAlarm}} Hexfelder.',
            'Gebäude und Fahrzeuge greifen Tiere nicht an.',
          ],
        },
        {
          h: 'Herdenwachstum',
        },
        {
          p: 'Nur etwa 1 von {{wild.breedingShare}} Herden wächst überhaupt. So eine Herde gewinnt alle {{wild.growthMinutes}} Min. 1 erwachsenes Tier, wenn sie mindestens 2 Tiere und weniger hat, als die Spalte „Herde“ angibt. Ein einzelnes Tier vermehrt sich nicht.',
        },
        {
          h: 'Was der Jäger jagt',
        },
        {
          list: [
            'Das Jagdgebiet reicht {{flag.hunter}} Hexfelder um Arbeitsfahne oder Arbeitsplatz. Die Verfolgung geht {{wild.huntChase}} Hexfelder darüber hinaus.',
            'Er wählt das Tier mit der kleinsten Summe aus Gesundheit und Entfernung. Gesundheit zählt in Hunderten und Tausenden, also gewinnt das schwächste, auch wenn es weit weg ist.',
            'Er jagt je 1 Tier und nimmt das nächste erst, wenn er die Beute eingesammelt hat.',
            'Ein Schuss des Jägers nimmt dem Tier {{wild.hunterShot}} Gesundheit, Reichweite {{hunterBow.min}}-{{hunterBow.max}} Hexfelder.',
            'Erwachsene Wildziegen jagt er nicht von selbst, ihre Jungtiere schon.',
            'Er übergeht Tiere mit Besitzer und Tiere auf einer anderen Landmasse.',
            'Spalte „Jäger“: „von selbst“ ist Wild, das er selbst jagt, „auf Befehl“ greift er nur auf deinen Befehl an.',
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
      lead: 'Der Viehzüchter züchtet nur bei genau {{livestock.pair}} erwachsenen Tieren einer Art. Ein drittes schlachtet er zuerst.',
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
            head: ['Wer', 'Was er tut', 'Reichweite, Hexfelder'],
            rows: [
              [
                '[[job:scout|Kundschafter]]',
                'Mit jedem Schritt übernimmt er wilde Ochsen und Schafe und die Tiere eines feindlichen Spielers. Die weiter entfernten laufen auseinander',
                'Übernahme {{livestock.captureRange}}, Auseinanderlaufen {{livestock.scatterRange}}',
              ],
              [
                '[[job:breeder|Viehzüchter]]',
                'Holt dein nächstes Tier ohne Viehzüchterei in seine Viehzüchterei. Unter einem Paar nimmt er auch ein Tier aus deiner anderen Viehzüchterei, die mehr als ein Paar hat',
                'gleiche Landmasse',
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
            foot: 'Jungtier und Schlachtung dauern etwa {{livestock.cycleSeconds}} s. Die Art wählst du in der Produktion des Viehzüchters. In der Viehzüchterei lagern je {{livestock.farmShelf}} Stück Fleisch, Wolle und Leder.',
          },
        },
        {
          list: [
            'Die [[building:work_animal_farm|Viehzüchterei]] fasst insgesamt {{livestock.farmHerd}} Tiere, beide Arten und Jungtiere unterwegs eingerechnet.',
            'Ein Jungtier wächst {{livestock.growMinutes}} Min. und zählt bis dahin nicht zum Paar.',
            'Ist das Elterntier bei der Geburt weiter als {{livestock.birthRange}} Hexfelder von der Viehzüchterei entfernt, sind die Rohstoffe verloren, und es gibt kein Jungtier.',
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
              ['„Jungtiere wachsen heran“', 'Die Zucht geht weiter, wenn das Paar erwachsen ist'],
              ['„Herde voll“', 'Der Viehzüchter wartet auf erwachsene Jungtiere'],
            ],
          },
        },
      ],
      see: ['article:vehicles', 'article:wildlife', 'article:food', 'building:work_animal_farm'],
    },
    {
      id: 'religion',
      name: 'Religion und Tempel',
      lead: 'Der Religionsbalken sinkt nur bei der Herstellung von Waffen und Rüstungen. Bei 0% beginnt ein Handwerker keine Charge, die Religion kostet.',
      blocks: [
        {
          h: 'Kosten je Charge',
        },
        {
          table: {
            head: ['Beruf', '{{piety.lowPct}}%', '{{piety.highPct}}%'],
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
            'Unter {{need.drivePct}}% gehen [[job:joiner|Schreiner]], Waffenbauer, Schmied und Näher von selbst beten. Ohne Ort zum Beten kommt bei {{need.criticalPct}}% die Meldung „Will beten“.',
            'Eine begonnene Charge beenden sie auch bei 0%.',
          ],
        },
        {
          h: 'Wo man betet',
        },
        {
          table: {
            head: ['Ort', 'Bedingung'],
            rows: [
              ['Wohnhaus', 'Wenn darin Heiliges Feuer brennt. Der Siedler geht zuerst dorthin'],
              [
                '[[building:work_temple|Tempel]], [[building:headquarters|Hauptquartier]]',
                'Nur fertig und deine eigenen',
              ],
            ],
            foot: 'Ein Gebet dauert {{pray.seconds}} s und bringt +{{pray.pct}}% Religion.',
          },
        },
        {
          h: 'Heiliges Feuer',
        },
        {
          p: 'Du entzündest es ab Wohnhaus 3. 1 [[good:holy_oil|Öl]] brennt {{oil.burnMinutes}} Min., der volle Vorrat im Haus {{oil.fullBurnMinutes}} Min. Es brennt auch, wenn niemand betet.',
        },
        {
          h: 'Tempelaura',
        },
        {
          table: {
            head: ['Wirkung', 'Wert'],
            rows: [
              ['Reichweite', '{{aura.range}} Hexfelder'],
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
          p: 'Eine Kiste öffnet jeder Erwachsene, eine Magische Kiste nur [[job:druid|Druide]] und Held. Der Befehl heißt „Kiste öffnen“. Der Siedler muss sie in seiner Gehreichweite erreichen.',
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
                'Zivilisten, Frauen, Langschwertkämpfer oder Langbogenschützen',
                '{{chest.settlers}}',
                '{{chest.settlers}}',
              ],
              [
                'Wölfe oder Löwen. Sie kommen wild heraus und greifen sofort an',
                '{{chest.wolves}} oder {{chest.lions}}',
                '{{chest.wolves}} oder {{chest.lions}}',
              ],
            ],
            num: [1, 2],
            foot: 'Den Inhalt jeder Kiste legt die Karte fest, nicht der Zufall.',
          },
        },
        {
          h: 'Briefe',
        },
        {
          table: {
            head: ['Brief', 'Wirkung'],
            rows: [
              ['Ein Haus deiner Wahl setzen', 'Beliebiges Gebäude aus der Bauliste, steht sofort'],
              ["'Name' setzen", 'Das genannte Gebäude, steht sofort'],
              ["'Name' setzen und dessen Lager füllen", 'Das genannte Gebäude mit vollem Vorrat'],
            ],
            foot: 'Ein Brief verschwindet nach Gebrauch. Passt der Ort nicht, bleibt er. Deine Briefe stehen im Baufenster unter „Briefe“.',
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
            head: ['Gebäude mit Vorrat', 'Siedler', 'Entdeckt dauerhaft'],
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
            foot: 'So eine Kiste gibt auch einen Siedler in diesem Beruf und den Zugang zum Beruf.',
          },
        },
      ],
      see: ['article:construction', 'article:trades', 'article:draughts'],
    },
  ],
};
