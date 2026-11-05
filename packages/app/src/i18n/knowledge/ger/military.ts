import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const MILITARY: ArticleGroup = {
  group: 'Militär',
  items: [
    {
      id: 'damage',
      name: 'Schadensrechner',
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
            ],
            foot: 'Ein Schlag von vorne oder von der vorderen Flanke ändert den Schaden nicht. Stärke-, Treffer- und Verteidigungsamulett: [[article:draughts|Getränke und Amulette]].',
          },
        },
        {
          list: [
            'Erfahrung wirkt nicht bei Pfeilen und Steinen und nicht gegen Fahrzeuge und Palisaden.',
            'Schlagrichtung und Verteidigungsamulett zählen nur bei Menschen. Beim Pfeil richtet sich die Richtung nach dem Ort, von dem er abgeschossen wurde.',
            'Ein Katapult kann kein Amulett der Stärke tragen.',
            'Palisaden rechnen Schaden anders: [[article:walls|Palisaden und Tore]].',
            'Kinder lassen sich nicht verwunden.',
          ],
        },
        {
          h: 'Unterschiede der Stämme',
        },
        {
          p: 'Die Tabelle rechnet mit den Waffen des Stammes, dessen Wappen du oben im Fenster wählst. Der Drache, den die Zeile [[good:spear_wooden|Holzspeer]] bei den Byzantinern zeigt, hat {{dragon.hitpoints}} Gesundheit.',
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
          p: 'Die Zähler für das Heer und die Einberufung in die Kaserne beschreibt [[article:assistant|Assistent]].',
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
            foot: 'Ware, der du Vorrang gibst, holen die Träger der Kaserne selbst aus den Lagern: [[article:hauling|Träger und Lager]].',
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
          ],
        },
        {
          h: 'Wer bessere Waffen tragen darf',
        },
        {
          p: 'Jeder Soldat nimmt jede Waffe aus dem Lager, egal wie erfahren er ist. Die Grenze liegt bei der Herstellung: [[good:spear_iron|Eisenspeer]] und [[good:sword_long|Langschwert]] macht nur ein erfahrener [[job:smith|Schmied]], den [[good:bow_long|Langbogen]] nur ein erfahrener [[job:armorer|Waffenbauer]]. Wie viel Erfahrung nötig ist, steht auf der Karte jeder dieser Waffen.',
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
            head: ['Waffe', 'Normale Reichweite', 'Reichweite im Turm', 'Bleibt zum Schuss stehen auf'],
            rows: [
              [
                '[[good:bow_short|Kurzbogen]]',
                '{{shortBow.min}}-{{shortBow.max}}',
                '0-{{shortBow.towerMax}}',
                '{{shortBow.min}}-{{shortBow.standoff}}',
              ],
              [
                '[[good:bow_long|Langbogen]]',
                '{{longBow.min}}-{{longBow.max}}',
                '0-{{longBow.towerMax}}',
                '{{longBow.min}}-{{longBow.standoff}}',
              ],
              [
                '[[job:heroine_bow_xena|Cyra]]',
                '{{heroBow.min}}-{{heroBow.max}}',
                '-',
                '{{heroBow.min}}-{{heroBow.standoff}}',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Reichweite in Hexfeldern. Ein Bogenschütze, der auf ein Ziel zugeht, bleibt etwas näher stehen, als er reicht, damit ihm das Ziel nicht aus der Reichweite läuft. Auf Ziele näher als die untere Grenze der Reichweite schießt er nicht, außer er steht im Turm. Das Schusstempo, auch für Jägerbogen und Katapult, zeigt die Tabelle unter [[article:damage|Schadensrechner]].',
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
          p: 'Im Modus Ignorant lässt ein Soldat ein Ziel los, das sich mehr als {{stance.ignoreLeash}} Hexfelder von seinem Haltepunkt entfernt hat.',
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
              [
                'Feindlicher Soldat im Angriff oder in der Verteidigung, auf der Karte sichtbar',
                'bis {{alert.standTo}}',
                'Ebenso',
              ],
            ],
            foot: 'Essen geht er erst, wenn die Energie auf {{need.criticalPct}}% sinkt. Im Modus Ignorant ruht ein Soldat ganz normal.',
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
            head: ['Held', 'Waffe', 'Rüstung'],
            rows: [
              ['[[job:hero_spear_siegfried|Sigurd]]', 'Speer', '[[good:armor_plate|Plattenrüstung]]'],
              ['[[job:hero_sword_bjarni|Bjarni]]', 'Schwert', '[[good:armor_chain|Kettenhemd]]'],
              ['[[job:hero_saber_hatschi|Hatschi]]', 'Säbel', '[[good:armor_chain|Kettenhemd]]'],
              ['[[job:heroine_bow_xena|Cyra]]', 'Bogen', '[[good:armor_leather|Lederrüstung]]'],
            ],
            foot: 'Reichweite, Schlagtempo und Schaden zeigt die Tabelle unter [[article:damage|Schadensrechner]], wenn du dort die Helden einschaltest. Helden eines anderen Stammes kämpfen etwas anders: wähle oben im Fenster sein Wappen.',
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
            head: ['Gebäude', 'Plätze', 'Schüsse pro Sekunde'],
            rows: [
              ['[[building:headquarters|Hauptquartier]]', '{{shelter.hq}}', '{{shelter.hqShots}}'],
              ['[[building:tower_01|Wachturm 2]]', '{{shelter.tower2}}', '{{shelter.tower2Shots}}'],
              ['[[building:tower_00|Wachturm 1]]', '{{shelter.tower1}}', '{{shelter.tower1Shots}}'],
              ['[[building:barracks|Kaserne]]', '{{shelter.barracks}}', '{{shelter.barracksShots}}'],
            ],
            num: [1, 2],
            foot: 'Schüsse pro Sekunde bei vollem Gebäude. Die Posten der Bogenschützen, die die Karte des Turms zeigt, belegen keine Plätze zum Verstecken. Ein im Turm beschäftigter Bogenschütze schießt von selbst, ohne Verteidigungsmodus: [[article:aim|Treffen und Schießen]].',
          },
        },
        {
          h: 'Pfeile aus Gebäuden',
        },
        {
          p: 'Wie viel ein Pfeil abzieht, zeigt die Zeile „Pfeile aus Gebäuden“ in der Tabelle unter [[article:damage|Schadensrechner]].',
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
          h: 'Turmvorrat',
        },
        {
          table: {
            head: ['Turm', 'Fasst Met', 'Fasst Nahrung', 'Fasst je Waffenart'],
            rows: [
              ['[[building:tower_00|Wachturm 1]]', '{{tower1.mead}}', '{{tower1.food}}', '{{tower1.weapon}}'],
              ['[[building:tower_01|Wachturm 2]]', '{{tower2.mead}}', '{{tower2.food}}', '{{tower2.weapon}}'],
            ],
            num: [1, 2, 3],
            foot: 'Posten und Trägerplätze zeigt die Karte des Turms.',
          },
        },
        {
          h: 'Turmbesatzung',
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
            head: [
              'Waffe',
              'Gesundheit je Schlag',
              'Mit Stärkeamulett',
              'Schläge: Abschnitt',
              'Schläge: Tor',
              'Dauer: Abschnitt',
            ],
            rows: [
              [
                '[[building:catapult|Katapult]]',
                '{{wall.catapult.blow}}',
                '-',
                '{{wall.catapult.segmentHits}}',
                '{{wall.catapult.gateHits}}',
                '{{wall.catapult.segmentSeconds}}',
              ],
              [
                'Held im Nahkampf',
                '{{wall.hero.blow}}',
                '{{wall.hero.strongBlow}}',
                '{{wall.hero.segmentHits}}',
                '{{wall.hero.gateHits}}',
                '{{wall.hero.segmentSeconds}}',
              ],
              [
                '[[good:spear_iron|Eisenspeer]]',
                '{{wall.ironSpear.blow}}',
                '{{wall.ironSpear.strongBlow}}',
                '{{wall.ironSpear.segmentHits}}',
                '{{wall.ironSpear.gateHits}}',
                '{{wall.ironSpear.segmentSeconds}}',
              ],
              [
                '[[good:sword_long|Langschwert]]',
                '{{wall.longSword.blow}}',
                '{{wall.longSword.strongBlow}}',
                '{{wall.longSword.segmentHits}}',
                '{{wall.longSword.gateHits}}',
                '{{wall.longSword.segmentSeconds}}',
              ],
              [
                '[[good:sword_shord|Kurzschwert]]',
                '{{wall.shortSword.blow}}',
                '{{wall.shortSword.strongBlow}}',
                '{{wall.shortSword.segmentHits}}',
                '{{wall.shortSword.gateHits}}',
                '{{wall.shortSword.segmentSeconds}}',
              ],
              [
                '[[good:spear_wooden|Holzspeer]]',
                '{{wall.woodenSpear.blow}}',
                '{{wall.woodenSpear.strongBlow}}',
                '{{wall.woodenSpear.segmentHits}}',
                '{{wall.woodenSpear.gateHits}}',
                '{{wall.woodenSpear.segmentSeconds}}',
              ],
              [
                '[[good:bow_short|Kurzbogen]]',
                '{{wall.shortBow.blow}}',
                '{{wall.shortBow.strongBlow}}',
                '{{wall.shortBow.segmentHits}}',
                '{{wall.shortBow.gateHits}}',
                '{{wall.shortBow.segmentSeconds}}',
              ],
              [
                '[[good:bow_long|Langbogen]]',
                '{{wall.longBow.blow}}',
                '{{wall.longBow.strongBlow}}',
                '{{wall.longBow.segmentHits}}',
                '{{wall.longBow.gateHits}}',
                '{{wall.longBow.segmentSeconds}}',
              ],
              ['Fäuste, Pfeile aus Gebäuden', '0', '0', '-', '-', '-'],
            ],
            num: [1, 2, 3, 4, 5],
            foot: 'Dauer für einen Soldaten. Ein Katapult kann kein Amulett der Stärke tragen. Cyra nimmt der Palisade {{wall.heroBow.blow}} Gesundheit pro Schuss, die Cyra der Franken {{wall.frankHeroBow.blow}}.',
          },
        },
        {
          list: [
            'Kampferfahrung verstärkt Schläge gegen Palisaden nicht.',
            'Ein Soldat greift eine Palisade nicht von selbst an. Er schlägt sie auf Befehl oder wenn sie ihm den Weg zum Feind versperrt.',
            'Fällt ein Abschnitt, gehen die Soldaten durch die Bresche und lassen die Nachbarabschnitte stehen.',
          ],
        },
        {
          h: 'Mauer',
        },
        {
          p: 'Die [[building:work_pottery_02|Mauer]] ist ein normales Gebäude und bekommt Schaden aus der Spalte Gebäude. Ein Soldat behandelt sie wie eine Palisade.',
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
          p: 'Ein Katapult führt 1 Soldat oder Held, mit beliebiger Waffe. Ohne Kommandant bewegt es sich nicht und schießt nicht. Steine kosten nichts. Gesundheit, Reichweite, Schusstempo und Kosten zeigt die Karte des [[building:catapult|Katapults]].',
        },
        {
          h: 'Stein',
        },
        {
          p: 'Wie viel ein Stein Menschen, Fahrzeugen und Gebäuden abzieht, zeigt die Zeile Katapult in der Tabelle unter [[article:damage|Schadensrechner]]. Palisaden rechnen das anders: [[article:walls|Palisaden und Tore]].',
        },
        {
          table: {
            head: ['Gebäude', 'Gesundheit', 'Steine bis zur Zerstörung', 'Dauer für 1 Katapult'],
            rows: [
              [
                '[[building:tower_00|Wachturm 1]]',
                '{{hp.tower1}}',
                '{{stone.tower1}}',
                '{{stone.tower1Seconds}}',
              ],
              [
                '[[building:tower_01|Wachturm 2]]',
                '{{hp.tower2}}',
                '{{stone.tower2}}',
                '{{stone.tower2Seconds}}',
              ],
              [
                '[[building:headquarters|Hauptquartier]], Wikinger',
                '{{hp.hq}}',
                '{{stone.hq}}',
                '{{stone.hqSeconds}}',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Hauptquartier der Franken: {{hp.frankHq}} Gesundheit, {{stone.frankHq}} Steine, {{stone.frankHqSeconds}}.',
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
                'Ja, bis {{catapult.leash}} Hexfelder von der Position',
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
  ],
};
