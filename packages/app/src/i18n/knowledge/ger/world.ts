import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const WORLD: ArticleGroup = {
  group: 'Welt',
  items: [
    {
      id: 'goals',
      name: 'Missionsziele und Spielende',
      lead: 'Du verlierst, wenn du keinen erwachsenen Mann mehr hast. Ein Held zählt mit, Frauen, Cyra und Kinder nicht.',
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
            'In den ersten {{match.graceSeconds}} s Spielzeit bedeutet es keine Niederlage, wenn du keine Männer hast.',
            'Das Ergebnis steht einmal und endgültig fest. Wer gewonnen hat, verliert nicht mehr, auch wenn er danach seine Leute verliert.',
            'Der Sieg eines Spielers beendet das Spiel für die anderen nicht.',
          ],
        },
        {
          h: 'Was vom Besiegten bleibt',
        },
        {
          p: 'Auf einer Mehrspielerkarte verschwinden Gebäude, Fahrzeuge und Wegweiser des Besiegten, seine Leute an Land werden zu wilden Hühnern, und seine Tiere verwildern. In Kampagnenmissionen und auf Karten ohne Mission verschwinden nur die Fahrzeuge, und der Computer hört auf zu spielen.',
        },
      ],
      see: ['article:diplomacy', 'article:family', 'article:heroes'],
    },
    {
      id: 'vehicles',
      name: 'Fahrzeuge und Schiffe',
      lead: 'Ohne Kommandant fährt ein Fahrzeug nirgendwohin. Ein Schiff nimmt mehr Leute mit, ein Großes Schiff mehr Ware.',
      blocks: [
        {
          p: 'Laderaum, Passagierplätze, Gesundheit und Kosten jedes Fahrzeugs stehen auf seiner Karte: [[vehicle:handcart|Handkarren]], [[vehicle:oxcart|Ochsenkarren]], [[vehicle:ship_small|Schiff]], [[vehicle:ship_big|Großes Schiff]], [[vehicle:catapult|Katapult]]. Welche Werkstatt was baut, steht auf den Karten von [[building:work_joinery_02|Schreinerei 3]] und [[building:work_joinery_03|4]].',
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
            'Die Passagierzahl auf der Karte zählt den Kommandanten nicht mit. Der zuerst Zugewiesene wird Kommandant. Geht er, übernimmt der nächste Passagier.',
            'Der [[job:joiner|Schreiner]] baut ein Fahrzeug auf einer Baustelle neben der Werkstatt, ein Schiff auf dem Wasser am Ufer.',
            'Wer einsteigt, verliert seinen Arbeitsplatz. Nur Träger mit Arbeitsplatz und Händler ziehen den Karren selbst und behalten die Arbeit.',
            'Die Ware laden der Kommandant und jeder erwachsene Mann an Bord, Soldaten, Helden, [[job:scout|Kundschafter]] und [[job:druid|Druiden]] aber nur, wenn sie das Kommando haben. Lädt niemand, erscheint „Kein Träger“.',
          ],
        },
        {
          h: 'Tempo mit Ladung',
        },
        {
          table: {
            head: ['Fahrzeug', 'Straße: leer', 'Straße: voll'],
            rows: [
              ['[[good:handcart|Handkarren]]', '{{pace.cartRoad}}', '{{pace.handcartRoadFull}}'],
              ['[[good:oxcart|Ochsenkarren]]', '{{pace.cartRoad}}', '{{pace.oxcartRoadFull}}'],
              ['[[good:catapult|Katapult]]', '{{pace.catapultRoad}}', '-'],
            ],
            num: [1, 2],
            foot: 'Hexfelder pro Sekunde. Voll heißt {{haul.handcart}} Stück auf dem Handkarren und {{haul.oxcart}} auf dem Ochsenkarren. Auf Land: Tabelle unten. Welcher Karren für eine Route: [[article:trade|Handel]].',
          },
        },
        {
          h: 'Wie stark Ladung bremst',
        },
        {
          table: {
            head: [
              'Ladung',
              'Handkarren: langsamer',
              'Handkarren: Land',
              'Ochsenkarren: langsamer',
              'Ochsenkarren: Land',
            ],
            rows: [
              [
                '{{vehicle.fill.0}}%',
                '{{vehicle.handcartLoss.0}}%',
                '{{pace.handcartLand.0}}',
                '{{vehicle.oxcartLoss.0}}%',
                '{{pace.oxcartLand.0}}',
              ],
              [
                '{{vehicle.fill.25}}%',
                '{{vehicle.handcartLoss.25}}%',
                '{{pace.handcartLand.25}}',
                '{{vehicle.oxcartLoss.25}}%',
                '{{pace.oxcartLand.25}}',
              ],
              [
                '{{vehicle.fill.50}}%',
                '{{vehicle.handcartLoss.50}}%',
                '{{pace.handcartLand.50}}',
                '{{vehicle.oxcartLoss.50}}%',
                '{{pace.oxcartLand.50}}',
              ],
              [
                '{{vehicle.fill.75}}%',
                '{{vehicle.handcartLoss.75}}%',
                '{{pace.handcartLand.75}}',
                '{{vehicle.oxcartLoss.75}}%',
                '{{pace.oxcartLand.75}}',
              ],
              [
                '{{vehicle.fill.100}}%',
                '{{vehicle.handcartLoss.100}}%',
                '{{pace.handcartLand.100}}',
                '{{vehicle.oxcartLoss.100}}%',
                '{{pace.oxcartLand.100}}',
              ],
            ],
            num: [0, 1, 2, 3, 4],
            foot: 'Ladung ist der belegte Anteil des Laderaums. Der Tempoverlust wächst gleichmäßig mit der Ladung: ein voller Karren verliert ihn ganz, ein halb voller zur Hälfte. Tempo in Hexfeldern pro Sekunde auf normalem Land.',
          },
        },
        {
          list: [
            'So fährt ein Karren mit Kommandant. Schuhe ändern hier nichts.',
            'Träger und Händler, die den Karren selbst ziehen, gehen ihr eigenes Tempo, mit Schuhen schneller. Die Ladung bremst sie um denselben Prozentsatz: Ein Händler mit Schuhen und vollem Handkarren braucht für einen Schritt auf Land {{step.traderFullCart}} s.',
            'Das [[good:catapult|Katapult]] fährt auf Land {{pace.catapultLand}} Hexfelder/s.',
            'Ein beladenes Schiff wird nicht langsamer und fährt etwa {{pace.ship}} Hexfelder/s.',
          ],
        },
        {
          h: 'Ochse für den Ochsenkarren',
        },
        {
          p: 'Ein fertiger Ochsenkarren wartet auf sein Zugtier und nimmt den nächsten erwachsenen [[good:cattle|Ochsen]] auf derselben Landmasse. Jede Viehzüchterei behält {{livestock.pair}} erwachsene Ochsen für sich, ebenso viele bleiben von einer Herde ohne Viehzüchterei. Der Karren bekommt also erst einen Ochsen darüber hinaus.',
        },
        {
          h: 'Schiffe',
        },
        {
          list: [
            'Ein Schiff nimmt 1 Fahrzeug mit: Handkarren, Ochsenkarren oder Katapult, wenn dessen Besatzung an Bord passt. Ein Großes Schiff transportiert keine Fahrzeuge.',
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
            '„Zielmenge“ ist die Stückzahl, die du im Frachtraum haben willst. Die Summe der Zielmengen übersteigt die Kapazität nicht.',
            '„durch den Träger“: Ein Träger zieht den Karren und sucht die Ladung auf jeder Fahrt selbst aus. Zielmengen kannst du dann nicht einstellen.',
            'Wer lädt, trägt je 1 Stück. Er sucht zuerst Ware bis {{vehicle.cargoSearch}} Hexfelder vom Karren, dann überall, wohin Wegweiser reichen.',
            'Die Ware muss auf derselben Landmasse liegen wie der Karren oder das Schiff. Essen aus Wohnhäusern nimmt niemand.',
            'Senkst du die Zielmenge, kommt der Überschuss ins nächste Lagerhaus oder Hauptquartier mit Platz, bis {{vehicle.cargoSearch}} Hexfelder vom Karren. Gibt es keines, landet er am Boden.',
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
            foot: 'Solange das Fahrzeug ganz ist, kann niemand die Besatzung darin treffen.',
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
              ['Jemand greift dich an', 'Dein Verhältnis zu ihm wird von selbst feindlich'],
              ['Du stellst feindlich gegenüber einem neutralen Computer', 'Der Computer wird auch feindlich'],
              ['Neutraler Computer auf einer Inselkarte', 'Wird von selbst feindlich gegenüber den Spielern'],
              [
                'Du senkst dein Verhältnis zu einem freundlichen Computer',
                'Auch der Computer senkt seines, auf deine Stufe',
              ],
              ['Feindlicher Computer', 'Schließt von selbst keinen Frieden'],
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
            'Du schickst niemanden hin und baust nichts bis {{peace.keepOut}} Hexfelder von einem Gebäude dieses Spielers, außer der Ort liegt näher an deinem eigenen Gebäude.',
            'Warnungen kommen {{peace.noticeFirstMinutes}} Min. und {{peace.noticeLastMinutes}} Min. vor dem Ende.',
          ],
        },
        {
          h: 'Erstkontakt',
        },
        {
          p: 'Unter Nebel kommt ein Stamm ins Fenster Diplomatie, wenn du einen seiner Menschen, ein Gebäude, Fahrzeug oder eine Palisade siehst oder wenn er dich angreift. Danach bleibt er dort.',
        },
        {
          h: 'Tribut',
        },
        {
          p: 'Tribut fordert nur eine Mission. „Zahlen“ im Fenster Diplomatie nimmt die Ware sofort weg, niemand trägt sie, und das „Lagerminimum“ schützt sie nicht.',
        },
        {
          p: 'Die Ware kommt aus [[building:headquarters|Hauptquartieren]], Lagerhäusern und Werkstätten, aus einer Werkstatt nur ihre eigenen Produkte. Wohnhäuser, Türme, [[building:barracks|Kaserne]], [[building:school|Schule]] und Haufen am Boden zahlen nicht.',
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
          p: 'Graues Gelände zeigt Gebäude, Waren, Rohstoffe und Fahrzeuge so, wie du sie zuletzt gesehen hast. Menschen und Tiere sieht man dort nicht.',
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
              ['Soldat, jedes Gebäude', '{{vision.soldier}}'],
              [
                '[[good:handcart|Handkarren]], [[good:oxcart|Ochsenkarren]], [[good:catapult|Katapult]]',
                '{{vision.cart}}',
              ],
              ['Übrige Erwachsene, deine Tiere', '{{vision.adult}}'],
              ['Kind', '{{vision.child}}'],
              ['Baustelle', '0'],
            ],
            num: [1],
            foot: 'Palisaden, Straßen und Wegweiser decken nichts auf. Soldaten und [[job:hunter|Jäger]] finden ihr Ziel auch im Nebel, das [[good:catapult|Katapult]] schießt von selbst aber nur auf das, was es sieht.',
          },
        },
      ],
      see: ['article:scout', 'article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'scout',
      name: 'Kundschafter',
      lead: 'Ein Kundschafter hat keinen Arbeitsplatz und tut ohne Befehl nichts.',
      blocks: [
        {
          p: 'Er setzt [[article:roads|Wegweiser]] ohne Material und übernimmt wilde Ochsen und Schafe im Vorbeigehen: [[article:livestock|Viehzucht]]. Er kann über die ganze Karte gehen, Wegweiser schränken ihn nicht ein.',
        },
        {
          h: '„Kläre Gegend auf“',
        },
        {
          list: [
            'Er erkundet das Land immer weiter um den Ort, den du zeigst.',
            'Er verlässt seine Landmasse nicht. Auf eine andere muss ihn ein [[article:vehicles|Schiff]] bringen.',
            'Er lässt schmale Streifen an Ufern und Kartenrändern aus, kleine Flecken können also unerkundet bleiben.',
          ],
        },
        {
          h: 'Wann er aufhört',
        },
        {
          table: {
            head: ['Ereignis', 'Folge'],
            rows: [
              ['Nichts mehr zu erkunden', 'Meldung „Land erkundet“, der Kundschafter wartet'],
              [
                'Mehr als {{explore.maxFailedLegs}} Mal in Folge kam er nicht ans Ziel',
                'Der Rest gilt als unerreichbar, „Land erkundet“',
              ],
              ['Neuer Befehl oder Berufswechsel', 'Die Erkundung endet'],
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
          p: 'Gesundheit, Herdengröße und ob sich ein Tier zähmen lässt, stehen auf seiner Karte in der Enzyklopädie.',
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
                'Wehren sich, wenn sie getroffen werden',
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
          p: 'Nur etwa 1 von {{wild.breedingShare}} Herden wächst. So eine Herde gewinnt alle {{wild.growthMinutes}} Min. 1 erwachsenes Tier, wenn sie mindestens 2 Tiere und weniger hat, als „Herde“ auf der Karte des Tiers angibt.',
        },
        {
          h: 'Was der Jäger jagt',
        },
        {
          list: [
            'Das Jagdgebiet reicht {{flag.hunter}} Hexfelder um Arbeitsfahne oder Arbeitsplatz. Bei der Verfolgung geht der Jäger höchstens {{wild.huntChase}} Hexfelder darüber hinaus.',
            'Er jagt zuerst das schwächste Tier, auch wenn es weit weg ist.',
            'Ein Schuss des Jägers nimmt dem Tier {{wild.hunterShot}} Gesundheit und reicht {{hunterBow.min}} bis {{hunterBow.max}} Hexfelder weit.',
            'Erwachsene Wildziegen jagt er nicht von selbst, ihre Jungtiere schon.',
            'Tiere, die jemandem gehören, und Tiere auf einer anderen Landmasse jagt er nicht.',
            '„Jäger: von selbst“ auf der Karte des Tiers heißt Wild, das er von sich aus jagt, und „auf Befehl“ Wild, das er nur auf deinen Befehl angreift.',
          ],
        },
        {
          h: 'Beute',
        },
        {
          p: 'Was ein erwachsenes Tier hinterlässt, steht auf seiner Karte. Ein vom Jäger erlegtes Jungtier bringt die Hälfte davon, ein Fohlen nur 1 [[good:leather|Leder]]. Ein Jungtier, das jemand anderes tötet, hinterlässt nichts.',
        },
      ],
      see: ['article:damage', 'article:gathering', 'article:livestock', 'job:hunter'],
    },
    {
      id: 'livestock',
      name: 'Viehzucht',
      lead: 'Der Viehzüchter züchtet nur, wenn er genau {{livestock.pair}} erwachsene Tiere einer Art hat. Ein drittes schlachtet er zuerst.',
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
                'Im Vorbeigehen übernimmt er wilde Ochsen und Schafe und die Tiere eines Feindes. Die etwas weiter entfernten laufen auseinander',
                'Übernahme {{livestock.captureRange}}, Auseinanderlaufen {{livestock.scatterRange}}',
              ],
              [
                '[[job:breeder|Viehzüchter]]',
                'Holt dein nächstes Tier, das in keiner Viehzüchterei steht, zu sich. Fehlt ihm ein Paar, nimmt er auch den Überschuss aus einer anderen deiner Viehzüchtereien',
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
            head: ['Tier', 'Schlachtung bringt'],
            rows: [
              [
                '[[good:sheep|Schaf]]',
                '{{livestock.sheepWool}} [[good:wool|Wolle]], {{livestock.sheepMeat}} [[good:meat|Fleisch]]',
              ],
              [
                '[[good:cattle|Ochse]]',
                '{{livestock.cattleLeather}} [[good:leather|Leder]], {{livestock.cattleMeat}} [[good:meat|Fleisch]]',
              ],
            ],
            foot: 'Die Art wählst du in der Produktion des Viehzüchters. Was ein Jungtier kostet, wie lange es dauert und wie viel Ware die Viehzüchterei fasst, steht auf der Karte der [[building:work_animal_farm|Viehzüchterei]].',
          },
        },
        {
          list: [
            'Die [[building:work_animal_farm|Viehzüchterei]] fasst insgesamt {{livestock.farmHerd}} Tiere, beide Arten und Jungtiere unterwegs eingerechnet.',
            'Ein Jungtier wächst {{livestock.growMinutes}} Min. und zählt bis dahin nicht zum Paar.',
          ],
        },
        {
          h: 'Status der Viehzüchterei',
        },
        {
          table: {
            head: ['Meldung', 'Bedeutung'],
            rows: [
              ['„Keine Tiere“', 'Kein einziges Tier, ein Kundschafter muss her'],
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
      lead: 'Religion sinkt nur bei der Herstellung von Waffen und Rüstungen. Bei 0% stellt ein Handwerker keine Waffen und Rüstungen her.',
      blocks: [
        {
          h: 'Was ein Stück an Religion kostet',
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
            foot: 'Bei allen Stämmen gleich. Andere Produkte dieser Berufe kosten keine Religion.',
          },
        },
        {
          list: [
            'Unter {{need.drivePct}}% gehen Waffenbauer, Schmied und Näher von selbst beten. Finden sie keinen Ort dafür, kommt bei {{need.criticalPct}}% die Meldung „Will beten“.',
            'Ein begonnenes Stück beenden sie auch bei 0%.',
          ],
        },
        {
          h: 'Wo man betet',
        },
        {
          table: {
            head: ['Ort', 'Bedingung'],
            rows: [
              ['Wohnhaus', 'Wenn darin Heiliges Feuer brennt. Dann betet der Siedler zuerst zu Hause'],
              [
                '[[building:work_temple|Tempel]], [[building:headquarters|Hauptquartier]]',
                'Fertig und deine eigenen',
              ],
            ],
            foot: 'Ein Gebet dauert {{pray.seconds}} s und bringt +{{pray.pct}}% Religion.',
          },
        },
        {
          h: 'Heiliges Feuer',
        },
        {
          p: 'Du entzündest es ab Wohnhaus 3. 1 [[good:holy_oil|Öl]] reicht für {{oil.burnMinutes}} Min., der volle Vorrat im Haus für {{oil.fullBurnMinutes}} Min. Das Feuer brennt auch, wenn niemand betet.',
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
              ['Für wen', 'Alle deine Leute, Kinder nur Gesundheit'],
              ['Bedingung', 'Tempel fertig und unbeschädigt'],
              ['Mehrere Tempel', 'Auren addieren sich nicht'],
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
          p: 'Eine Kiste öffnet jeder Erwachsene, eine Magische Kiste nur [[job:druid|Druide]] und Held. Der Befehl heißt „Kiste öffnen“. Der Siedler muss zu ihr hingehen können.',
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
            foot: 'Ein Brief verschwindet nach Gebrauch, außer der Ort passt nicht. Deine Briefe findest du im Baufenster unter „Briefe“.',
          },
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
            foot: 'So eine Kiste gibt auch einen Siedler in diesem Beruf und schaltet den Beruf frei.',
          },
        },
      ],
      see: ['article:construction', 'article:trades', 'article:draughts'],
    },
  ],
};
