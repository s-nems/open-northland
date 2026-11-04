import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const MILITARY: ArticleGroup = {
  group: 'Militär',
  items: [
    {
      id: 'damage',
      name: 'Waffen, Rüstung und Schaden',
      lead: 'Ein Mensch hat {{health.human}} Gesundheit. Die Tabelle zeigt, was ein Schlag davon abzieht.',
      blocks: [
        {
          data: 'matrix',
        },
        {
          figure: {
            id: 'direction',
            caption: 'Woher der Schlag kommt',
          },
        },
        {
          h: 'Was den Schaden ändert',
        },
        {
          table: {
            head: ['Faktor', 'Wert'],
            rows: [
              [
                '[[article:exp-combat|Erfahrung mit dieser Waffe]] (nur Nahkampf)',
                'bis ×{{combat.fightCapFactor}}',
              ],
              ['Schlag von der hinteren Flanke', '×{{combat.backSideFactor}}'],
              ['Schlag von hinten', '×{{combat.behindFactor}}'],
              ['[[good:amulet_strength|Stärkeamulett]] des Angreifers', '×{{amulet.strengthFactor}}'],
              [
                '[[good:amulet_crithit|Trefferamulett]] des Angreifers',
                '{{amulet.critChancePct}}% Chance auf ×{{amulet.critFactor}}',
              ],
              ['[[good:amulet_defense|Verteidigungsamulett]] des Ziels', '×{{amulet.defenseFactor}}'],
            ],
            foot: 'Ein Schlag von vorne oder von der vorderen Flanke ändert den Schaden nicht.',
          },
        },
        {
          list: [
            'Erfahrung wirkt nicht bei Pfeilen und Steinen und nicht gegen Fahrzeuge und Palisaden.',
            'Schlagrichtung und Verteidigungsamulett zählen nur bei Menschen. Beim Pfeil richtet sich die Richtung nach dem Ort, von dem er abgeschossen wurde.',
            'Die Amulette des Katapultkommandanten verstärken die Steine nicht.',
            'Palisaden rechnen Schaden anders: [[article:walls|Palisaden und Tore]].',
            'Kinder lassen sich nicht verwunden.',
          ],
        },
        {
          h: 'Unterschiede der Stämme',
        },
        {
          list: [
            'Bei den Sarazenen macht der [[good:bow_short|Kurzbogen]] gegen Waffenrock {{saracen.bowOnWool}} statt {{viking.bowOnWool}}, gegen Kettenhemd und Plattenrüstung {{saracen.bowOnChain}} statt {{viking.bowOnChain}}.',
            'Bei den Byzantinern zeigt die Tabelle in der Zeile [[good:spear_wooden|Holzspeer]] den Drachen der Karte. Er hat {{dragon.hitpoints}} Gesundheit, Reichweite {{dragon.min}}-{{dragon.max}} und macht {{dragon.blows}} Schläge alle {{dragon.seconds}} s, je {{dragon.bare}} Schaden ohne Rüstung. Ein ausgebildeter Speerträger kämpft wie bei den anderen Stämmen.',
            'Alle übrigen Waffen wirken bei allen Stämmen gleich.',
          ],
        },
        {
          h: 'Rüstungen',
        },
        {
          data: 'armour',
        },
        {
          p: 'Schwere Waffen und Rüstungen machen langsamer: [[article:walking|Gehtempo]].',
        },
      ],
      see: [
        'article:exp-combat',
        'article:aim',
        'article:walking',
        'good:spear_iron',
        'good:sword_long',
        'good:armor_chain',
        'good:armor_plate',
      ],
    },
    {
      id: 'equip',
      name: 'Soldaten ausrüsten',
      lead: 'Das Heer bewaffnest du mit den Zählern im Fenster Assistent. Die Ausrüstung eines einzelnen Siedlers änderst du in seinem Panel.',
      blocks: [
        {
          h: 'Zähler',
        },
        {
          table: {
            head: ['Zähler', 'Was er tut', 'Wann er sinkt'],
            rows: [
              [
                '„Unbewaffnete Soldaten“',
                'Bildet in der Kaserne aus, gibt keine Waffe aus',
                'Nach der Ausbildung',
              ],
              [
                '„Schwertkämpfer“, „Speerträger“, „Bogenschützen“',
                'Bewaffnet zuerst einen unbewaffneten Soldaten, bildet dann einen neuen aus',
                'Wenn der Kämpfer die Waffe nimmt',
              ],
            ],
            foot: 'Wen er in die Kaserne schickt: [[article:assistant|Assistent]].',
          },
        },
        {
          list: [
            'Solange ein unbewaffneter Soldat auf eine Waffe wartet, bildet der Zähler niemand Neuen aus, auch wenn lange keine Waffe kommt.',
            'Ein unbewaffneter Soldat holt sich eine Waffe, wenn eine dieser Art in Reichweite liegt und niemand sonst darauf wartet.',
          ],
        },
        {
          h: 'Waffen- und Rüstungsleisten',
        },
        {
          p: 'Jede Soldatenart hat eigene Leisten. Ein Soldat nimmt von links den ersten Gegenstand, den das Lager hat, und übergeht durchgestrichene. Anfangs stehen die stärksten Gegenstände links. Ein Klick streicht einen Gegenstand durch, Ziehen ändert die Reihenfolge.',
        },
        {
          list: [
            'Gibt es keine Waffe, wartet er, und das Fenster zeigt „wartet auf eine Waffe“.',
            'Gibt es keine Rüstung, geht er ohne und legt sie später nur auf deinen Befehl an.',
          ],
        },
        {
          h: 'Rekrut nach der Ausbildung',
        },
        {
          table: {
            head: ['Die Kaserne hat', 'Rekrut'],
            rows: [
              ['Waffe und Rüstung', 'Kommt voll ausgerüstet heraus'],
              ['Nur Waffe oder nur Rüstung', 'Nimmt, was da ist, und holt den Rest aus einem Lager'],
              ['Nichts', 'Holt erst die Waffe, dann die Rüstung'],
            ],
            foot: 'Liegt etwas Besseres von der Leiste in einem Lager in Reichweite, holt der Rekrut es dort, statt das Schlechtere aus der Kaserne zu nehmen.',
          },
        },
        {
          h: 'Was die Kaserne lagert',
        },
        {
          table: {
            head: ['Ware', 'Wie viele'],
            rows: [
              [
                'Jede Waffe, Rüstung, [[good:shoes|Schuhe]], [[good:mead|Met]], jeder Trank und jedes Amulett',
                '{{barracks.gearStock}}',
              ],
              ['Nahrung', '{{barracks.foodStock}}'],
              ['[[good:coin|Münze]]', '{{barracks.coinStock}}'],
            ],
            num: [1],
            foot: 'Die Kaserne hat {{barracks.carriers}} Trägerplätze. Ware, der du Vorrang gibst, holen diese Träger selbst aus den Lagern: [[article:hauling|Träger und Lager]].',
          },
        },
        {
          h: 'Von Hand ändern',
        },
        {
          table: {
            head: ['Wer', 'Kann wechseln'],
            rows: [
              ['Soldat', 'Waffe, Rüstung, Schuhe, Ausrüstung'],
              ['Mann mit Beruf', 'Werkzeug, Schuhe, Ausrüstung'],
              ['Held', 'Nur Rucksack: [[article:heroes|Helden]]'],
              ['Frau, Kind', 'Nichts'],
            ],
          },
        },
        {
          list: [
            'Eine neue Waffe ändert sofort die Soldatenart. Legt er die Waffe ab, wird er ein einfacher [[job:soldier_unarmed|Soldat]].',
            'Beim Tauschen oder Ablegen gehen abgetragene Schuhe, gebrauchte Werkzeuge und angebrochene Flaschen verloren. Unbenutzte kehren ins Lager zurück.',
            'Waffen, Rüstungen und Amulette nutzen sich nicht ab und kehren immer ins Lager zurück.',
            'Dein Befehl an eine einzelne Person geht den Einstellungen des Assistenten vor.',
          ],
        },
        {
          h: 'Wer bessere Waffen tragen darf',
        },
        {
          p: 'Jeder Soldat nimmt jede Waffe aus dem Lager, egal wie erfahren er ist. Die Grenze liegt bei der Herstellung: [[good:spear_iron|Eisenspeer]] und [[good:sword_long|Langschwert]] macht nur ein erfahrener [[job:smith|Schmied]], den [[good:bow_long|Langbogen]] nur ein erfahrener [[job:armorer|Waffenbauer]]. Wie viel Erfahrung nötig ist: [[article:exp-combat|Kampferfahrung]].',
        },
      ],
      see: [
        'article:damage',
        'article:assistant',
        'article:exp-combat',
        'article:hauling',
        'building:barracks',
      ],
    },
    {
      id: 'aim',
      name: 'Treffen und Schießen',
      lead: 'Ein Nahkampfschlag geht nur daneben, wenn das Ziel schon aus der Waffenreichweite heraus ist. Je öfter ein Bogenschütze getroffen hat, desto genauer schießt er.',
      blocks: [
        {
          h: 'Fernwaffen',
        },
        {
          table: {
            head: ['Waffe', 'Reichweite', 'Reichweite im Turm', 'Geht ans Ziel heran auf', 'Schuss alle'],
            rows: [
              [
                '[[good:bow_short|Kurzbogen]]',
                '{{shortBow.min}}-{{shortBow.max}}',
                '0-{{shortBow.towerMax}}',
                '{{shortBow.standoff}}',
                '{{shortBow.seconds}} s',
              ],
              [
                '[[good:bow_long|Langbogen]]',
                '{{longBow.min}}-{{longBow.max}}',
                '0-{{longBow.towerMax}}',
                '{{longBow.standoff}}',
                '{{longBow.seconds}} s',
              ],
              [
                '[[job:hunter|Jäger]]',
                '{{hunterBow.min}}-{{hunterBow.max}}',
                '-',
                '-',
                '{{hunterBow.seconds}} s',
              ],
              [
                '[[job:heroine_bow_xena|Cyra]]',
                '{{heroBow.min}}-{{heroBow.max}}',
                '-',
                '{{heroBow.standoff}}',
                '{{heroBow.seconds}} s',
              ],
              [
                '[[building:catapult|Katapult]]',
                '{{catapult.min}}-{{catapult.max}}',
                '-',
                '{{catapult.bandMin}}-{{catapult.max}}',
                '{{catapult.seconds}} s',
              ],
            ],
            num: [1, 2, 3, 4],
            foot: 'Reichweite in Hexfeldern. Auf Ziele näher als die untere Grenze der Reichweite schießt der Bogenschütze nicht.',
          },
        },
        {
          h: 'Genauigkeit',
        },
        {
          table: {
            head: ['Treffer', 'Chance auf genauen Schuss'],
            rows: [
              ['0', '{{aim.basePct}}%'],
              ['50', '{{aim.samplePct}}%'],
              ['{{aim.noSpreadHits}}+', 'Immer im Ziel'],
            ],
            num: [0, 1],
            foot: 'Jeder Treffer bringt 1% mehr. Ab {{aim.noSpreadHits}} Treffern landet auch ein ungenauer Pfeil im Ziel. Kurz- und Langbogen zählen Treffer gemeinsam, das [[article:catapult|Katapult]] getrennt, aber nach derselben Tabelle. Helden treffen immer.',
          },
        },
        {
          h: 'Streuung ungenauer Pfeile',
        },
        {
          list: [
            'Ein ungenauer Pfeil landet nah am Ziel: vom [[good:bow_short|Kurzbogen]] bis {{aim.spreadShort}} Hexfelder daneben, vom [[good:bow_long|Langbogen]] bis {{aim.spreadLong}}, vom Langbogen im Turm bis {{aim.spreadTower}}. Die Streuung wächst mit der Entfernung.',
            'Ein ungenauer Pfeil kann einen anderen Feind dort verletzen, wo er einschlägt.',
            'Pfeile verletzen weder Eigene noch Verbündete oder Neutrale.',
            'Ein Bogenschütze hält vor einen laufenden Feind, ein Gebäude schießt dorthin, wo der Feind beim Schuss gerade ist.',
          ],
        },
        {
          h: 'Turmposten',
        },
        {
          list: [
            'Einen Bogenschützen auf dem Posten kann niemand treffen. Feinde können nur auf den Turm schießen.',
          ],
        },
      ],
      see: ['article:exp-combat', 'article:defence', 'building:tower_00', 'building:tower_01'],
    },
    {
      id: 'stances',
      name: 'Soldatenmodi',
      lead: 'Der Modus sagt, ob ein Soldat selbst Feinde sucht und wie weit er ihnen folgt. Neue Soldaten und Helden stehen im Modus Verteidigung.',
      blocks: [
        {
          figure: {
            id: 'leash',
            caption: 'Wie weit er verfolgt',
          },
        },
        {
          table: {
            head: ['Modus', 'Sucht Feinde', 'Radius', 'Gibt auf, wenn', 'Wenn er getroffen wird'],
            rows: [
              [
                'Angriff',
                'Um sich herum',
                '{{stance.search}}',
                'Ziel stirbt oder ist unerreichbar',
                'Geht auf den Angreifer los',
              ],
              [
                'Verteidigung',
                'Um den Haltepunkt',
                '{{stance.search}}',
                'Ziel entfernt sich mehr als {{stance.defendLeash}} vom Haltepunkt',
                'Geht auf den Angreifer los',
              ],
              [
                'Ignorant',
                'Nur in Waffenreichweite, geht nicht heran',
                'Waffenreichweite',
                'Ziel entfernt sich mehr als {{stance.ignoreLeash}} vom Haltepunkt',
                'Bleibt stehen',
              ],
            ],
            foot: 'Entfernungen in Hexfeldern. Der Haltepunkt ist der Ort, an dem der Soldat stand, als du den Modus gewechselt hast. Ein Bewegungs- oder Angriffsbefehl setzt ihn neu.',
          },
        },
        {
          list: [
            'Ein Soldat im Modus Angriff kehrt zum Haltepunkt zurück, wenn er mehr als {{stance.attackReturn}} Hexfelder davon entfernt zu kämpfen aufhört.',
            'Ein Soldat entdeckt Feinde auch im [[article:fog|Nebel]].',
            'Ein Angriffsbefehl wirkt in jedem Modus.',
            'Ein Bogenschütze auf dem Posten schießt in jedem Modus auf alles in Reichweite.',
            'Nach einem normalen Bewegungsbefehl geht der Soldat weiter, auch wenn ihn jemand schlägt. Bei „Unterwegs angreifen“ stellt er sich dem Angreifer.',
          ],
        },
        {
          h: 'Wen er zuerst angreift',
        },
        {
          p: 'Ein Soldat schlägt zuerst die, die sich wehren können: Soldaten, Helden, Katapulte, Türme und schießende Gebäude. Zivilisten, übrige Gebäude und unbewaffnete Fahrzeuge kommen später dran.',
        },
        {
          p: 'Palisaden und die Mauer greift ein Soldat nicht von selbst an: [[article:walls|Palisaden und Tore]].',
        },
        {
          h: 'Wer auf Schläge reagiert',
        },
        {
          table: {
            head: ['Wer', 'Entfernung zum Verwundeten', 'Was er tut'],
            rows: [
              [
                'Soldaten und Helden im Modus Angriff oder Verteidigung',
                '{{stance.soldierAlarm}}',
                'Gehen auf den Angreifer los',
              ],
              ['Soldaten und Helden im Modus Ignorant', '-', 'Schlagen nur, was in Waffenreichweite ist'],
              [
                'Zivilisten und Kundschafter',
                '{{stance.peopleAlarm}}',
                'Fliehen {{stance.fleeMin}}-{{stance.fleeMax}} Hexfelder und kehren zur Arbeit zurück',
              ],
            ],
            num: [1],
            foot: 'Entfernung in Hexfeldern. Nur ein Schlag gegen einen Menschen alarmiert, nicht gegen ein Gebäude oder Tier.',
          },
        },
        {
          h: 'Zivilisten',
        },
        {
          list: [
            'Zivilisten kämpfen nicht. Den Modus stellst du nur bei Soldaten und Helden ein.',
            'Ein Zivilist flieht nicht schon beim Anblick eines Feindes.',
            'Auf der Flucht wirft ein Zivilist getragene Ware ab, und der Träger lässt seinen Karren stehen.',
          ],
        },
        {
          h: 'Schalter „Essen und Schlafen“',
        },
        {
          p: 'Bei „Verboten“ geht ein Soldat nicht von selbst essen, schlafen oder beten. Er isst nicht einmal, was er trägt, oder aus dem Turmvorrat, und Hunger unterbricht keinen langen Befehl. Ohne Getränke verhungert er am Ende. Da hilft der Befehl Iss oder das Zurückschalten auf „Erlaubt“.',
        },
        {
          p: 'Getränke, Amulette und die Befehle Iss, Schlaf, Bete wirken in beiden Stellungen. Im Befehlsmenü heißen die Stellungen „Erlaube Soldaten Regeneration“ und „Verbiete Soldaten Regeneration“.',
        },
        {
          h: 'Ruhe nahe am Kampf',
        },
        {
          table: {
            head: ['Was in der Nähe ist', 'Hexfelder', 'Der Soldat'],
            rows: [
              ['Kampf', 'bis {{alert.restClearance}}', 'Schläft, betet und redet nicht'],
              ['Feind in Sicht', 'bis {{alert.standTo}}', 'Ebenso'],
            ],
            foot: 'Essen geht er erst, wenn die Energie auf {{need.criticalPct}}% sinkt. Im Modus Ignorant gilt das nicht.',
          },
        },
      ],
      see: ['article:defence', 'article:aim', 'article:fog', 'article:needs'],
    },
    {
      id: 'heroes',
      name: 'Helden',
      lead: 'Helden kommen von der Karte. Man kann sie weder ausbilden noch ihren Beruf wechseln.',
      blocks: [
        {
          table: {
            head: ['Eigenschaft', 'Soldat', 'Held'],
            rows: [
              ['Sichtweite in Hexfeldern', '{{vision.soldier}}', '{{vision.hero}}'],
              ['Genauigkeit mit dem Bogen', 'Steigt mit Treffern', 'Immer genau'],
              ['Kampferfahrung', 'Steigt', 'Steigt nur, wenn die Mission es erlaubt'],
              ['Essen und Schlaf', 'Braucht er', 'Braucht er nicht'],
              [
                'Waffe, Rüstung, Schuhe',
                'Austauschbar, Schuhe nutzen sich ab',
                'Fest, Schuhe nutzen sich nicht ab',
              ],
              ['Gewicht der Ausrüstung', 'Bremst', 'Bremst nicht'],
              ['Wohnhaus und Arbeitsplatz', 'Möglich', 'Keine'],
              ['Magische Kiste', 'Öffnet er nicht', 'Öffnet er'],
            ],
          },
        },
        {
          h: 'Heldenwaffen',
        },
        {
          table: {
            head: ['Held', 'Waffe', 'Rüstung', 'Reichweite'],
            rows: [
              [
                '[[job:hero_spear_siegfried|Sigurd]]',
                'Speer',
                '[[good:armor_plate|Plattenrüstung]]',
                '{{hero.spearMin}}-{{hero.spearMax}}',
              ],
              [
                '[[job:hero_sword_bjarni|Bjarni]]',
                'Schwert',
                '[[good:armor_chain|Kettenhemd]]',
                '{{hero.swordReach}}',
              ],
              [
                '[[job:hero_saber_hatschi|Hatschi]]',
                'Säbel',
                '[[good:armor_chain|Kettenhemd]]',
                '{{hero.saberReach}}',
              ],
              [
                '[[job:heroine_bow_xena|Cyra]]',
                'Bogen',
                '[[good:armor_leather|Lederrüstung]]',
                '{{heroBow.min}}-{{heroBow.max}}',
              ],
            ],
            num: [3],
            foot: 'Ein Held schlägt alle {{hero.blowSeconds}} s zu. Den Schaden zeigt die Tabelle unter [[article:damage|Waffen, Rüstung und Schaden]], wenn du dort die Helden einschaltest.',
          },
        },
        {
          h: 'Unterschiede der Stämme',
        },
        {
          table: {
            head: ['Held', 'Stamm', 'Unterschied'],
            rows: [
              ['Sigurd', 'Ägypter', 'Macht gegen Kettenhemd {{hero.sigurdEgyptChain}}'],
              [
                'Hatschi',
                'Sarazene',
                '{{hero.hatchieSaracenBlows}} Schläge alle {{hero.hatchieSaracenSeconds}} s',
              ],
              [
                'Cyra',
                'Franke',
                'Reichweite {{frankHeroBow.min}}-{{frankHeroBow.max}}, Schuss alle {{frankHeroBow.seconds}} s. Schaden: ohne Rüstung {{hero.frankBowBare}}, Waffenrock und Lederrüstung {{hero.frankBowWool}}, Kettenhemd und Plattenrüstung {{hero.frankBowChain}}, Gebäude und Fahrzeug {{hero.frankBowVehicle}}',
              ],
            ],
          },
        },
        {
          h: 'Rucksack',
        },
        {
          list: [
            'In den Rucksack nimmt ein Held nur: [[good:amulet_strength|Stärkeamulett]], [[good:amulet_defense|Verteidigungsamulett]], [[good:amulet_crithit|Trefferamulett]], [[good:amulet_speed|Windamulett]], [[good:potion_heal_small|Kleiner Heiltrank]], [[good:potion_heal_big|Großer Heiltrank]].',
          ],
        },
      ],
      see: ['article:damage', 'article:chests', 'article:fog', 'article:exp-combat'],
    },
    {
      id: 'defence',
      name: 'Türme und Verteidigungsmodus',
      lead: 'Ein Gebäude im Verteidigungsmodus schießt von selbst auf Feinde. Jede Person, die sich drinnen versteckt, bringt {{shelter.shotsPerSeat}} Schuss pro Sekunde.',
      blocks: [
        {
          h: 'Verteidigungsmodus',
        },
        {
          list: [
            '„Verteidigungsmodus starten“ wirkt auf ein Gebäude, „Ganzes Dorf“ auf alle Verteidigungsgebäude.',
            'Den Modus startest du selbst. Ein Angriff auf das Dorf löst ihn nicht aus.',
            'Er endet nicht von selbst, sondern läuft, bis du „Verteidigungsmodus stoppen“ klickst oder das Gebäude zerstört ist.',
          ],
        },
        {
          h: 'Wer sich versteckt',
        },
        {
          list: [
            'Zivilisten, Frauen und Kinder laufen zum nächsten Gebäude mit freiem Platz, das sie zu Fuß erreichen.',
            'Soldaten, Helden und [[job:scout|Kundschafter]] bleiben draußen.',
            'Wer keinen Platz findet, arbeitet weiter.',
            'Im Verteidigungsmodus bricht ein Siedler Essen und Schlaf ab. Drinnen arbeitet er nicht und isst nur, was er bei sich hat.',
            'Wer drinnen ist, lässt sich nicht angreifen.',
            'Wird das Gebäude zerstört, kommen alle heraus, die sich drinnen versteckt haben.',
          ],
        },
        {
          h: 'Verteidigungsgebäude',
        },
        {
          table: {
            head: ['Gebäude', 'Plätze', 'Schüsse pro Sekunde', 'Posten'],
            rows: [
              ['[[building:headquarters|Hauptquartier]]', '{{shelter.hq}}', '{{shelter.hqShots}}', '-'],
              [
                '[[building:tower_01|Wachturm 2]]',
                '{{shelter.tower2}}',
                '{{shelter.tower2Shots}}',
                '{{tower2.posts}} Kurzbogen, {{tower2.longPosts}} Langbogen',
              ],
              [
                '[[building:tower_00|Wachturm 1]]',
                '{{shelter.tower1}}',
                '{{shelter.tower1Shots}}',
                '{{tower1.posts}} Kurzbogen, {{tower1.longPosts}} Langbogen',
              ],
              ['[[building:barracks|Kaserne]]', '{{shelter.barracks}}', '{{shelter.barracksShots}}', '-'],
            ],
            num: [1, 2],
            foot: 'Schüsse pro Sekunde bei vollem Gebäude. Posten belegen keine Plätze zum Verstecken. Ein im Turm beschäftigter Bogenschütze schießt von selbst, ohne Verteidigungsmodus: [[article:aim|Treffen und Schießen]].',
          },
        },
        {
          h: 'Pfeile aus Gebäuden',
        },
        {
          table: {
            head: ['Ziel', 'Pfeil'],
            rows: [
              ['Ohne Rüstung', '{{arrow.bare}}'],
              ['Waffenrock', '{{arrow.wool}}'],
              ['Lederrüstung', '{{arrow.leather}}'],
              ['Kettenhemd, Plattenrüstung', '{{arrow.chain}}'],
              ['Fahrzeug', '{{arrow.vehicle}}'],
              ['Gebäude', '{{arrow.building}}'],
            ],
            num: [1],
            foot: 'Bei jedem Stamm gleich. Schlagrichtung und Verteidigungsamulett können das ändern: [[article:damage|Waffen, Rüstung und Schaden]].',
          },
        },
        {
          list: [
            'Ein Gebäude schießt {{shelter.range}} Hexfelder weit ab der nächsten Wand, auch auf Feinde direkt an den Mauern.',
            'Ein Gebäude schießt auch auf Feinde im Nebel.',
            'Die Pfeile kosten nichts und bringen keine Erfahrung.',
            'Es schießt zuerst auf Soldaten und Helden, auf Zivilisten erst ganz zuletzt.',
          ],
        },
        {
          h: 'Turmbesatzung',
        },
        {
          table: {
            head: ['Turm', 'Trägerplätze', 'Met', 'Nahrung', 'Je Waffenart'],
            rows: [
              [
                '[[building:tower_00|Wachturm 1]]',
                '{{tower1.carriers}}',
                '{{tower1.mead}}',
                '{{tower1.food}}',
                '{{tower1.weapon}}',
              ],
              [
                '[[building:tower_01|Wachturm 2]]',
                '{{tower2.carriers}}',
                '{{tower2.mead}}',
                '{{tower2.food}}',
                '{{tower2.weapon}}',
              ],
            ],
            num: [1, 2, 3, 4],
          },
        },
        {
          list: [
            'Auf einen Posten kommt nur der passende Bogenschütze: [[job:soldier_bow_short|Kurzbogenschütze]] oder [[job:soldier_bow_long|Langbogenschütze]]. Du teilst ihn zu wie einem Arbeitsplatz.',
            'Nimmt ein Bogenschütze eine andere Waffe, verliert er den Posten.',
            'Die Besatzung isst aus dem Turmvorrat und schläft auf dem Posten. Zum Essen kommt sie erst herunter, wenn der Vorrat leer ist.',
            'Der Assistent holt niemanden vom Turm, auch nicht für neue Ausrüstung.',
            '„Garnison abziehen“ holt die Bogenschützen aus dem Turm und wählt sie aus, damit du ihnen gleich einen Befehl geben kannst. Auch ein Bewegungsbefehl holt einen Bogenschützen vom Posten.',
          ],
        },
      ],
      see: [
        'article:aim',
        'article:stances',
        'building:tower_00',
        'building:tower_01',
        'building:headquarters',
        'building:barracks',
        'article:equip',
      ],
    },
    {
      id: 'walls',
      name: 'Palisaden und Tore',
      lead: 'Eine Palisade verliert 1 Gesundheit je volle {{wall.damagePerPoint}} Schaden aus der Spalte Gebäude. Ein schwächerer Schlag macht ihr nichts.',
      blocks: [
        {
          table: {
            head: ['Element', 'Gesundheit', 'Reparatur je Arbeitsschlag', 'Kosten'],
            rows: [
              ['Palisadenabschnitt', '{{wall.segmentHp}}', '{{wall.segmentRepair}}', '1 [[good:wood|Holz]]'],
              ['Tor', '{{wall.gateHp}}', '{{wall.gateRepair}}', 'Kostenlos, entsteht aus Abschnitten'],
            ],
            num: [1, 2],
            foot: 'Reparatur kostet nichts. Einen Abschnitt repariert immer nur ein Bauarbeiter zur Zeit.',
          },
        },
        {
          h: 'Bau eines Tors',
        },
        {
          list: [
            'Ein Tor belegt {{wall.gateSegments}} deiner fertigen Abschnitte in gerader Linie. Jeder braucht mindestens {{wall.gateMinHealthPct}}% Gesundheit und ebenen Boden, und im Durchgang darf niemand stehen.',
            'Das Tor entsteht sofort, geschlossen und mit voller Gesundheit, auch wenn die Abschnitte beschädigt waren.',
          ],
        },
        {
          h: 'Tormodi',
        },
        {
          table: {
            head: ['Modus', 'Wirkung'],
            rows: [
              ['Öffnen', 'Alle kommen durch, auch Feinde'],
              ['Schließen', 'Niemand kommt durch, auch Eigene nicht'],
              [
                'Automatisch',
                'Offen. Schließt, wenn ein Feind auf {{wall.gateEnemyNear}} Hexfelder herankommt, und öffnet, wenn er wieder weg ist',
              ],
            ],
            foot: 'Das Tor schließt bei jedem Menschen oder Fahrzeug eines Spielers, mit dem du Krieg hast, auch bei Zivilisten. Tiere schließen es nicht.',
          },
        },
        {
          list: ['Das Tor schließt erst, wenn niemand im Durchgang steht.'],
        },
        {
          h: 'Wie schnell eine Palisade fällt',
        },
        {
          table: {
            head: ['Waffe', 'Gesundheit je Schlag', 'Schläge: Abschnitt', 'Schläge: Tor', 'Dauer: Abschnitt'],
            rows: [
              [
                '[[building:catapult|Katapult]]',
                '{{wall.catapult.blow}}',
                '{{wall.catapult.segmentHits}}',
                '{{wall.catapult.gateHits}}',
                '{{wall.catapult.segmentSeconds}} s',
              ],
              [
                'Held im Nahkampf',
                '{{wall.hero.blow}}',
                '{{wall.hero.segmentHits}}',
                '{{wall.hero.gateHits}}',
                '{{wall.hero.segmentSeconds}} s',
              ],
              [
                '[[good:spear_iron|Eisenspeer]]',
                '{{wall.ironSpear.blow}}',
                '{{wall.ironSpear.segmentHits}}',
                '{{wall.ironSpear.gateHits}}',
                '{{wall.ironSpear.segmentSeconds}} s',
              ],
              [
                '[[good:sword_long|Langschwert]]',
                '{{wall.longSword.blow}}',
                '{{wall.longSword.segmentHits}}',
                '{{wall.longSword.gateHits}}',
                '{{wall.longSword.segmentSeconds}} s',
              ],
              [
                '[[good:sword_shord|Kurzschwert]]',
                '{{wall.shortSword.blow}}',
                '{{wall.shortSword.segmentHits}}',
                '{{wall.shortSword.gateHits}}',
                '{{wall.shortSword.segmentSeconds}} s',
              ],
              [
                '[[good:spear_wooden|Holzspeer]]',
                '{{wall.woodenSpear.blow}}',
                '{{wall.woodenSpear.segmentHits}}',
                '{{wall.woodenSpear.gateHits}}',
                '{{wall.woodenSpear.segmentSeconds}} s',
              ],
              [
                '[[good:bow_short|Kurzbogen]]',
                '{{wall.shortBow.blow}}',
                '{{wall.shortBow.segmentHits}}',
                '{{wall.shortBow.gateHits}}',
                '{{wall.shortBow.segmentSeconds}} s',
              ],
              [
                '[[good:bow_long|Langbogen]]',
                '{{wall.longBow.blow}}',
                '{{wall.longBow.segmentHits}}',
                '{{wall.longBow.gateHits}}',
                '{{wall.longBow.segmentSeconds}} s',
              ],
              ['Fäuste, Pfeile aus Gebäuden', '0', '-', '-', '-'],
            ],
            num: [1, 2, 3, 4],
            foot: 'Dauer für einen Soldaten. Cyra nimmt {{wall.heroBow.blow}}, bei den Franken {{wall.frankHeroBow.blow}}.',
          },
        },
        {
          list: [
            'Kampferfahrung verstärkt Schläge gegen Palisaden nicht.',
            'Das Stärkeamulett verstärkt den Schlag: {{wall.ironSpear.blow}} wird {{wall.ironSpear.strongBlow}}, {{wall.shortSword.blow}} wird {{wall.shortSword.strongBlow}}, und {{wall.shortBow.blow}} bleibt {{wall.shortBow.strongBlow}}.',
            'Ein Soldat greift eine Palisade nicht von selbst an. Er schlägt sie auf Befehl oder wenn sie ihm den Weg zum Feind versperrt.',
            'Fällt ein Abschnitt, gehen die Soldaten durch die Bresche und lassen die Nachbarabschnitte stehen.',
          ],
        },
        {
          h: 'Mauer',
        },
        {
          p: 'Die [[building:work_pottery_02|Mauer]] ist ein normales Gebäude: {{wall.defenceHp}} Gesundheit, Schaden aus der Spalte Gebäude. Ein Soldat behandelt sie wie eine Palisade.',
        },
      ],
      see: [
        'article:damage',
        'article:catapult',
        'article:construction',
        'building:work_pottery_02',
        'good:wood',
      ],
    },
    {
      id: 'catapult',
      name: 'Katapulte',
      lead: 'Der Stein verletzt alles auf dem Hexfeld des Einschlags und auf den sechs Hexfeldern ringsum, auch deine Leute.',
      blocks: [
        {
          figure: {
            id: 'catapult-splash',
            caption: 'Wo der Stein einschlägt',
          },
        },
        {
          table: {
            head: ['Eigenschaft', 'Wert'],
            rows: [
              ['Reichweite', '{{catapult.min}}-{{catapult.max}} Hexfelder'],
              ['Schuss alle', '{{catapult.seconds}} s'],
              ['Gesundheit', '{{catapult.hitpoints}}'],
              ['Besatzung', '1 Soldat oder Held, mit beliebiger Waffe'],
              [
                'Kosten',
                '[[building:catapult|Katapult]]: {{catapult.wood}} [[good:wood|Holz]], {{catapult.iron}} [[good:iron|Eisen]]',
              ],
            ],
            foot: 'Ohne Kommandant bewegt sich das Katapult nicht und schießt nicht. Steine kosten nichts.',
          },
        },
        {
          h: 'Stein',
        },
        {
          table: {
            head: ['Ziel', 'Schaden', 'Steine zum Zerstören'],
            rows: [
              ['Ohne Rüstung', '{{stone.bare}}', '{{stone.bareKills}}'],
              ['Lederrüstung', '{{stone.leather}}', '{{stone.leatherKills}}'],
              ['Waffenrock', '{{stone.wool}}', '{{stone.woolKills}}'],
              ['Kettenhemd, Plattenrüstung', '{{stone.chain}}', '{{stone.chainKills}}'],
              ['Katapult', '{{stone.vehicle}}', '{{stone.vehicleKills}}'],
              ['Gebäude', '{{stone.building}}', '{{stone.tower1}}-{{stone.frankHq}}'],
            ],
            num: [2],
            foot: 'Schaden an einem von vorne getroffenen Menschen, ohne Amulette. Palisade: [[article:walls|Palisaden und Tore]].',
          },
        },
        {
          table: {
            head: ['Gebäude', 'Gesundheit', 'Steine', 'Dauer'],
            rows: [
              [
                '[[building:tower_00|Wachturm 1]]',
                '{{hp.tower1}}',
                '{{stone.tower1}}',
                '{{stone.tower1Seconds}} s',
              ],
              [
                '[[building:tower_01|Wachturm 2]]',
                '{{hp.tower2}}',
                '{{stone.tower2}}',
                '{{stone.tower2Seconds}} s',
              ],
              [
                '[[building:headquarters|Hauptquartier]], Wikinger',
                '{{hp.hq}}',
                '{{stone.hq}}',
                '{{stone.hqSeconds}} s',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Hauptquartier der Franken: {{hp.frankHq}} Gesundheit, {{stone.frankHq}} Steine, {{stone.frankHqSeconds}} s.',
          },
        },
        {
          h: 'Wer etwas abbekommt',
        },
        {
          table: {
            head: ['Unter dem Stein', 'Stein'],
            rows: [
              ['Feind', 'Verletzt'],
              ['Eigene Leute, Fahrzeuge, Gebäude, Palisaden', 'Verletzt'],
              ['Neutrale und Verbündete', 'Verletzt, trübt das Verhältnis nicht'],
              ['Spieler, mit dem in der Lobby Frieden eingestellt ist', 'Verschont'],
              ['Kinder', 'Verschont'],
              ['Leute in Gebäuden', 'Verschont'],
              ['Bäume', 'Wirft um'],
            ],
          },
        },
        {
          h: 'Genauigkeit',
        },
        {
          p: 'Die Genauigkeit steigt wie beim Bogenschützen: [[article:aim|Treffen und Schießen]]. Auf {{catapult.max}} Hexfeldern landet ein ungenauer Stein bei 0 Treffern bis {{stone.spread.0}} Hexfelder neben dem Ziel, bei 25 bis {{stone.spread.25}}, bei 50 bis {{stone.spread.50}}. Ab {{aim.noSpreadHits}} Treffern landet er im Ziel. Die Treffer sammelt der Kommandant: Es zählt jeder Stein, der etwas beschädigt hat, auch ein Gebäude, aber nur einmal, auch wenn er mehrere Ziele trifft.',
        },
        {
          h: 'Katapultmodi',
        },
        {
          table: {
            head: ['Modus', 'Sucht Feinde', 'Radius', 'Bewegt sich'],
            rows: [
              ['Angriff', 'Um sich herum', '{{catapult.searchRadius}}', 'Ja'],
              [
                'Verteidigung',
                'Um seine Position',
                '{{catapult.searchRadius}}',
                'Ja, bis {{catapult.leash}} von der Position',
              ],
              ['Ignorant', 'Um seine Position', '{{catapult.min}}-{{catapult.max}}', 'Nein'],
            ],
            foot: 'Ein neues Katapult steht im Modus Ignorant. Von selbst greift es nur Ziele an, die es sieht. Ein Angriffsbefehl wirkt in jedem Modus.',
          },
        },
        {
          list: [
            'Ist das Ziel näher als {{catapult.min}} Hexfelder, fährt das Katapult weg. Ist es weiter als {{catapult.max}}, rückt es auf {{catapult.bandMin}}-{{catapult.max}} Hexfelder heran.',
            'Es schießt nur im Stand und nur, wenn es kein anderes Fahrzeug berührt.',
            'Du kannst es auf eine beliebige Stelle am Boden schießen lassen. Palisaden beschießt es nur auf Befehl.',
          ],
        },
        {
          h: 'Was ein Katapult zerstört',
        },
        {
          table: {
            head: ['Waffe', 'Schaden', 'Treffer zum Zerstören'],
            rows: [
              ['Zweites Katapult', '{{stone.vehicle}}', '{{stone.vehicleKills}}'],
              [
                'Speere, [[good:sword_long|Langschwert]], [[good:bow_long|Langbogen]]',
                '{{vs.catapult.spear}}',
                '{{vs.catapult.spearHits}}',
              ],
              [
                '[[good:sword_shord|Kurzschwert]], [[good:bow_short|Kurzbogen]]',
                '{{vs.catapult.shortSword}}',
                '{{vs.catapult.shortSwordHits}}',
              ],
              ['Fäuste', '{{vs.catapult.fist}}', '{{vs.catapult.fistHits}}'],
              ['Pfeil aus Gebäude', '{{arrow.vehicle}}', '{{vs.catapult.arrowHits}}'],
            ],
            num: [1, 2],
            foot: 'Erfahrung wirkt nicht gegen Fahrzeuge, Amulette des Angreifers schon.',
          },
        },
      ],
      see: ['article:vehicles', 'article:walls', 'article:aim', 'article:exp-combat', 'building:catapult'],
    },
    {
      id: 'computer',
      name: 'Computergegner',
      lead: 'Die Stufe des Computers wählst du in der Lobby. Schwer kann gleich nach Ende der Friedenszeit angreifen.',
      blocks: [
        {
          table: {
            head: ['Eigenschaft', 'Leicht', 'Mittel', 'Schwer'],
            rows: [
              [
                'Erste Welle',
                '{{ai.easy.firstWaveMinutes}} Min.',
                '{{ai.medium.firstWaveMinutes}} Min.',
                'Sofort',
              ],
              ['Armeegrenze', '{{ai.easy.armyCap}}', '{{ai.medium.armyCap}}', '{{ai.hard.armyCap}}'],
              [
                'Katapulte',
                '{{ai.easy.catapults}}',
                'bis {{ai.medium.catapults}}',
                'bis {{ai.hard.catapults}}',
              ],
              ['Dichter Turmring', 'Nein', 'Ja', 'Ja'],
              [
                'Baustellen zugleich',
                '{{ai.easy.sites}}',
                '{{ai.medium.sites}}, ab {{ai.medium.grownMinutes}} Min. {{ai.medium.grownSites}}',
                '{{ai.hard.sites}}, ab {{ai.hard.midMinutes}} Min. {{ai.hard.midSites}}, ab {{ai.hard.lateMinutes}} Min. {{ai.hard.lateSites}}',
              ],
            ],
            foot: 'Zeiten sind Spielzeit: Bei ×3 vergehen sie dreimal so schnell. Keine Welle zieht vor Ende der „Friedenszeit“ los. Leicht und Mittel bilden nicht über die Armeegrenze hinaus aus.',
          },
        },
        {
          h: 'Wellen',
        },
        {
          table: {
            head: ['Zeit seit der ersten Welle', 'Leute je Welle'],
            rows: [
              ['0', '{{ai.wave.0.min}}-{{ai.wave.0.max}}'],
              ['1 Std.', '{{ai.wave.1.min}}-{{ai.wave.1.max}}'],
              ['2 Std.', '{{ai.wave.2.min}}-{{ai.wave.2.max}}'],
              ['3 Std. und später', '{{ai.wave.3.min}}-{{ai.wave.3.max}}'],
            ],
            num: [1],
            foot: 'Die Größe der Welle wird aus diesem Bereich ausgewürfelt.',
          },
        },
        {
          list: [
            'Es greift immer nur eine Welle an, die nächste sammelt sich derweil an der [[building:barracks|Kaserne]].',
            'Das Sammeln dauert bis zu {{ai.gatherMinutes}} Minuten. Danach ziehen so viele los, wie die untere Zahl der Tabelle sagt. Sind es weniger, gehen alle, die hinkommen.',
          ],
        },
        {
          h: 'Wann die Welle losgeht',
        },
        {
          list: [
            'Der Computer vergleicht die Stärke seiner Armee mit deiner. Er zählt Waffen, Rüstung, Amulette, Gesundheit und Heiltränke, aber keine Erfahrung.',
            'Dein Bogenschütze auf einem Turmposten zählt {{ai.towerPostWeight}}-mal so viel wie im Feld.',
            'Zu Spielbeginn lost jeder Computer einen Plan aus. Ein aggressiver zieht los, wenn er {{ai.planAggressivePct}}% deiner Stärke hat, ein defensiver erst bei {{ai.planDefensivePct}}%, die übrigen bei {{ai.planBalancedPct}}%.',
            'Dein Heer im Nebel zählt er so, wie er es zuletzt gesehen hat. Weiß er nichts über dich, hält er dich für gleich stark.',
            'Solange der Computer nicht stark genug ist, wartet die Welle an der Kaserne, auch nach dem Sammeln.',
            'Hat die Computerarmee ihre Grenze erreicht, zieht die Welle ungeachtet der Stärke los.',
            'Greifst du sein Dorf an oder bist du {{ai.defendRatio}} Mal stärker als er, hält der Computer sein Heer zu Hause, und eine Welle unterwegs kehrt um.',
          ],
        },
        {
          h: 'Überfälle',
        },
        {
          list: [
            'Ein Überfall ist ein kleiner Trupp von {{ai.raidMen}} Leuten. Er geht auf deine Abbauer und Wirtschaftsgebäude los. Er meidet die Reichweite der Türme. Gibt es keinen Weg ohne Türme, zieht er nicht los.',
            'Ein schwerer Computer überfällt in {{ai.raidChancePct}}% der Spiele, außer er startet auf einer Insel. Ein Computer mit dem Plan Störangriffe überfällt immer, auf jeder Stufe.',
            'Der erste Überfall kommt {{ai.raidMinMinutes}}-{{ai.raidMaxMinutes}} Minuten nach Friedensende, die nächsten in ähnlichen Abständen.',
          ],
        },
        {
          h: 'Ziele',
        },
        {
          p: 'Eine Welle geht zuerst auf das nächste [[building:headquarters|Hauptquartier]] los, dann auf Türme und übrige Gebäude, auch Baustellen, und zuletzt auf Menschen.',
        },
        {
          list: [
            'Palisade und [[building:work_pottery_02|Mauer]] sind keine Ziele einer Welle: [[article:walls|Palisaden und Tore]].',
            'Im Nebel kennt der Computer die Gebäude vom Kartenstart und die, die er schon gesehen hat. Von neuen erfährt er, wenn er sie sieht.',
          ],
        },
        {
          h: 'Wasser',
        },
        {
          list: [
            'Eine Welle zu Fuß geht nur über die Landmasse, auf der die Kaserne des Computers steht. Jedes deiner Gebäude und jeder deiner Leute auf dieser Landmasse kann zum Ziel werden.',
            'Steht das Hauptquartier des Rivalen auf einer anderen Landmasse, errichtet der Computer am Ufer eine [[building:work_joinery_03|Schreinerei 4]], baut [[good:ship_small|Schiffe]] und bringt damit Truppen hinüber.',
            'Eine Landung legt ab, wenn {{ai.landingShips}} Schiffe am Ufer liegen, bei einem schwächeren Computer weniger, und das Heer {{ai.landingEdge}} Mal stärker ist als die Verteidiger. Ein Schiff trägt {{vehicle.shipSeats}} Soldaten.',
            'Eine Landung geht so nah wie möglich an deinem Hauptquartier an Land, aber außerhalb der Reichweite deiner Türme und Gebäude im Verteidigungsmodus, und greift das Hauptquartier an.',
            'Verliert sie an Land {{ai.landingRetreatPct}}% der Leute, kehrt der Rest auf die Schiffe zurück. Die nächste Landung kommt frühestens nach {{ai.landingCooldownMinutes}} Minuten.',
          ],
        },
        {
          h: 'Wiederaufbau',
        },
        {
          p: 'Ein Spieler, der in der Lobby auf „Karten-KI“ steht, baut zerstörte Gebäude wieder auf, wenn im Umkreis von {{ai.rebuildNear}} Hexfeldern kein Feind, aber einer seiner Zivilisten ist. Das Hauptquartier baut er nicht wieder auf.',
        },
      ],
      see: ['article:defence', 'article:walls', 'article:catapult', 'article:fog', 'article:diplomacy'],
    },
  ],
};
