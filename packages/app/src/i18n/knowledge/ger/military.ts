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
            'Richtung und Verteidigungsamulett wirken nur bei Menschen. Beim Pfeil zählt der Ort, von dem er abgeschossen wurde.',
            'Amulette des Kommandanten wirken nicht auf den Stein des Katapults.',
            'Palisaden rechnen Schaden anders: [[article:walls|Palisaden und Tore]].',
            'Ein Schlag für 0 verwundet nicht und bringt keine Erfahrung.',
            'Kinder lassen sich nicht verwunden.',
          ],
        },
        {
          h: 'Unterschiede der Stämme',
        },
        {
          list: [
            'Sarazene: Der [[good:bow_short|Kurzbogen]] macht gegen Waffenrock {{saracen.bowOnWool}} statt {{viking.bowOnWool}}, gegen Kettenhemd und Plattenrüstung {{saracen.bowOnChain}} statt {{viking.bowOnChain}}.',
            'Byzantiner: Der Drache der Karte kämpft mit einem eigenen [[good:spear_wooden|Holzspeer]]: {{dragon.hitpoints}} Gesundheit, Reichweite {{dragon.min}}-{{dragon.max}}, {{dragon.blows}} Schläge alle {{dragon.seconds}} s, {{dragon.bare}} Schaden ohne Rüstung. Die Tabelle zeigt ihn in dieser Zeile. Ein ausgebildeter Speerträger kämpft wie bei den anderen Stämmen.',
            'Alle übrigen Waffen sind bei allen Stämmen gleich.',
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
      lead: 'Das Heer bewaffnest du mit den Zählern im Fenster Assistent. Einzelne Leute änderst du in ihrem Panel.',
      blocks: [
        {
          h: 'Zähler',
        },
        {
          table: {
            head: ['Zähler', 'Was er tut', 'Sinkt'],
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
            'Solange ein unbewaffneter Soldat wartet, bildet der Zähler niemand Neuen aus, auch wenn gerade keine Waffe da ist.',
            'Ein unbewaffneter Soldat holt sich eine Waffe, wenn eine dieser Art in Reichweite liegt und niemand sonst darauf wartet.',
            'Senkst du den Zähler, hören die Wartenden auf zu warten.',
          ],
        },
        {
          h: 'Waffen- und Rüstungsleisten',
        },
        {
          p: 'Jede Soldatenart hat eigene Leisten. Ein Soldat nimmt von links den ersten Gegenstand, den das Lager hat, und übergeht durchgestrichene. Anfangs steht das Stärkste links. Ein Klick streicht durch, Halten und Ziehen ändert die Reihenfolge.',
        },
        {
          list: [
            'Keine Waffe zu haben: Er wartet, das Fenster zeigt „wartet auf eine Waffe“.',
            'Keine Rüstung zu haben: Er geht ohne. Später legt er sie nur auf Befehl an.',
          ],
        },
        {
          h: 'Rekrut nach der Ausbildung',
        },
        {
          table: {
            head: ['Die Kaserne hat', 'Rekrut'],
            rows: [
              ['Waffe und Rüstung', 'Kommt ausgerüstet heraus'],
              ['Nur eines von beiden', 'Nimmt es und holt den Rest'],
              ['Nichts', 'Holt erst die Waffe, dann die Rüstung'],
            ],
            foot: 'Liegt etwas Besseres von der Leiste in einem Lager in Reichweite, holt der Rekrut es dort und nimmt das Schlechtere aus der Kaserne nicht. Danach kehrt er zur Kaserne zurück. Das gilt auch für einen vom Zähler bewaffneten Soldaten.',
          },
        },
        {
          h: 'Was die Kaserne lagert',
        },
        {
          table: {
            head: ['Ware', 'Stück'],
            rows: [
              [
                'Jede Waffe, Rüstung, [[good:shoes|Schuhe]], [[good:mead|Met]], jeder Trank und jedes Amulett',
                '{{barracks.gearStock}}',
              ],
              ['Nahrung', '{{barracks.foodStock}}'],
              ['[[good:coin|Münze]]', '{{barracks.coinStock}}'],
            ],
            num: [1],
            foot: 'Die Kaserne hat {{barracks.carriers}} Trägerplätze. Ware mit Vorrang holen diese Träger selbst aus den Lagern: [[article:hauling|Träger und Lager]].',
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
            'Der Siedler holt den Gegenstand und kehrt an den Ort des Befehls zurück.',
            'Findet er ihn nirgends, kommt er mit leeren Händen zurück.',
            'Eine Waffe ändert sofort die Soldatenart. Legt er sie ab, bleibt er [[job:soldier_unarmed|Soldat]].',
            'Gebrauchte Schuhe, Werkzeuge und angebrochene Flaschen gehen beim Tauschen und Ablegen verloren. Unbenutzte kehren ins Lager zurück.',
            'Waffen, Rüstungen und Amulette nutzen sich nicht ab und kehren daher ins Lager zurück.',
            'Ein Befehl an eine einzelne Person geht dem Assistenten vor.',
          ],
        },
        {
          h: 'Wer bessere Waffen tragen darf',
        },
        {
          p: 'Jeder Soldat nimmt jede Waffe aus dem Lager, Treffer spielen dabei keine Rolle. Die Grenze liegt bei der Herstellung: [[good:spear_iron|Eisenspeer]] und [[good:sword_long|Langschwert]] macht nur ein erfahrener [[job:smith|Schmied]], den [[good:bow_long|Langbogen]] ein erfahrener [[job:armorer|Waffenbauer]]. Tabelle: [[article:exp-combat|Kampferfahrung]].',
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
      lead: 'Ein Nahkampfschlag geht nur daneben, wenn das Ziel beim Schlag außer Waffenreichweite steht. Die Genauigkeit des Bogenschützen steigt mit Bogentreffern.',
      blocks: [
        {
          h: 'Fernwaffen',
        },
        {
          table: {
            head: ['Waffe', 'Reichweite', 'Reichweite im Turm', 'Geht heran auf', 'Schuss alle'],
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
            foot: 'Reichweite in Hexfeldern. Näher als die untere Zahl schießt der Bogenschütze nicht. Geht heran auf: ab welcher Entfernung er schießt, wenn er selbst zum Ziel geht.',
          },
        },
        {
          h: 'Genauigkeit',
        },
        {
          table: {
            head: ['Treffer', 'Genauer Schuss'],
            rows: [
              ['0', '{{aim.basePct}}%'],
              ['50', '{{aim.samplePct}}%'],
              ['{{aim.noSpreadHits}}+', 'Immer im Ziel'],
            ],
            num: [0, 1],
            foot: 'Jeder Treffer bringt +1%. Ab {{aim.noSpreadHits}} Treffern landet auch ein ungenauer Pfeil im Ziel. Kurz- und Langbogen teilen sich einen Trefferzähler, das [[article:catapult|Katapult]] hat einen eigenen nach derselben Tabelle. Helden schießen immer genau.',
          },
        },
        {
          h: 'Streuung ungenauer Pfeile',
        },
        {
          list: [
            'Ein ungenauer Pfeil landet nah am Ziel: vom [[good:bow_short|Kurzbogen]] bis {{aim.spreadShort}} Hexfelder daneben, vom [[good:bow_long|Langbogen]] bis {{aim.spreadLong}}, vom Langbogen im Turm bis {{aim.spreadTower}}. Die Streuung wächst mit der Entfernung.',
            'Ein ungenauer Pfeil verletzt den ersten Feind am Einschlagort: zuerst Mensch, Tier oder Fahrzeug, dann Gebäude, zuletzt Palisade.',
            'Pfeile fliegen über Eigene, Verbündete und Neutrale hinweg.',
            'Ein Bogenschütze zielt vor einen laufenden Feind. Ein Gebäude schießt dorthin, wo der Feind gerade steht.',
          ],
        },
        {
          h: 'Turmposten',
        },
        {
          list: [
            'Die größere Reichweite hat der Bogenschütze erst auf dem Posten, nicht auf dem Weg dorthin.',
            'Feinde können nicht auf den Schützen auf dem Posten schießen, nur auf den Turm.',
          ],
        },
      ],
      see: ['article:exp-combat', 'article:defence', 'building:tower_00', 'building:tower_01'],
    },
    {
      id: 'stances',
      name: 'Soldatenmodi',
      lead: 'Der Modus sagt, ob ein Soldat selbst Feinde sucht und wie weit er ihnen folgt. Soldaten und Helden beginnen im Modus Verteidigung.',
      blocks: [
        {
          figure: {
            id: 'leash',
            caption: 'Wie weit er verfolgt',
          },
        },
        {
          table: {
            head: ['Modus', 'Sucht Feinde', 'Radius', 'Gibt auf, wenn', 'Auf Schläge'],
            rows: [
              [
                'Angriff',
                'Um sich herum',
                '{{stance.search}}',
                'Ziel fällt oder ist unerreichbar',
                'Geht auf den Angreifer los',
              ],
              [
                'Verteidigung',
                'Um den Haltepunkt',
                '{{stance.search}}',
                'Ziel über {{stance.defendLeash}} vom Haltepunkt',
                'Geht auf den Angreifer los',
              ],
              [
                'Ignorant',
                'Nur in Waffenreichweite, geht nicht heran',
                'Waffenreichweite',
                'Ziel über {{stance.ignoreLeash}} vom Haltepunkt',
                'Bleibt stehen',
              ],
            ],
            foot: 'Radien in Hexfeldern. Der Haltepunkt ist der Ort, an dem der Soldat beim Moduswechsel stand. Nach einem Bewegungs- oder Angriffsbefehl gilt ein neuer.',
          },
        },
        {
          list: [
            'Ein Soldat im Modus Angriff kehrt zum Haltepunkt zurück, wenn er mehr als {{stance.attackReturn}} Hexfelder davon entfernt zu kämpfen aufhört.',
            'Ein Soldat findet Feinde auch im [[article:fog|Nebel]].',
            'Ein Angriffsbefehl wirkt in jedem Modus.',
            'Ein Bogenschütze auf dem Posten schießt in jedem Modus auf alles in Reichweite.',
            'Nach einem normalen Bewegungsbefehl geht der Soldat weiter, auch wenn er geschlagen wird. Bei „Unterwegs angreifen“ dreht er sich zum Angreifer um.',
          ],
        },
        {
          h: 'Wen er zuerst angreift',
        },
        {
          steps: [
            'Soldaten, Helden, Katapulte, Türme und schießende Gebäude.',
            'Den Rest: Zivilisten, übrige Gebäude, unbewaffnete Fahrzeuge.',
          ],
        },
        {
          p: 'Palisaden und die Mauer wählt ein Soldat nicht von selbst: [[article:walls|Palisaden und Tore]].',
        },
        {
          h: 'Wer auf Schläge reagiert',
        },
        {
          table: {
            head: ['Wer', 'Vom Verwundeten, Hexfelder', 'Reaktion'],
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
              ['Leute in Gebäuden', '-', 'Reagieren nicht, außer dem Bogenschützen auf dem Posten'],
              ['Zivilist, der im Freien schläft', '-', 'Schläft, flieht nur, wenn er selbst getroffen wird'],
            ],
            num: [1],
            foot: 'Es zählt nur ein Schlag gegen einen Menschen. Ein getroffenes Gebäude oder Tier alarmiert niemanden.',
          },
        },
        {
          h: 'Zivilisten',
        },
        {
          list: [
            'Zivilisten kämpfen nicht. Den Modus stellst du nur bei Soldaten und Helden ein.',
            'Der Anblick eines Feindes lässt einen Zivilisten kalt.',
            'Wer flieht, wirft getragene Ware ab. Der Träger lässt seinen Karren stehen.',
          ],
        },
        {
          h: 'Schalter „Essen und Schlafen“',
        },
        {
          p: 'Bei „Verboten“ geht ein Soldat nicht von selbst essen, schlafen oder beten, isst nicht aus der Hand oder dem Turmvorrat, und Hunger unterbricht keine langen Befehle. Ohne Getränke endet das im Hungertod. Da hilft der Befehl Iss oder die Rückkehr zu „Erlaubt“.',
        },
        {
          p: 'Getränke, Amulette und die Befehle Iss, Schlaf, Bete wirken in beiden Stellungen. Im Befehlsmenü heißen die Stellungen „Erlaube Soldaten Regeneration“ und „Verbiete Soldaten Regeneration“. Den Schalter hat nur der Soldat. Er steht anfangs auf „Erlaubt“ und springt nach einem Berufswechsel dorthin zurück.',
        },
        {
          h: 'In Alarmbereitschaft',
        },
        {
          p: 'Das ist der Zustand eines Soldaten im Modus Angriff oder Verteidigung nahe am Kampf, nicht der [[article:defence|Verteidigungsmodus des Dorfes]], den der Spieler auslöst.',
        },
        {
          table: {
            head: ['Was in der Nähe ist', 'Hexfelder', 'Folge'],
            rows: [
              ['Kampf', 'bis {{alert.restClearance}}', 'Schläft, betet und redet nicht.'],
              ['Sichtbarer Feind, Modus Angriff oder Verteidigung', 'bis {{alert.standTo}}', 'Ebenso.'],
              ['Kampf neben einem, der im Freien schläft', 'bis {{alert.standTo}}', 'Steht auf.'],
            ],
            foot: 'Essen geht er erst bei {{need.criticalPct}}% Energie. Wildtiere zählen erst, wenn mit ihnen gekämpft wird. Im Modus Ignorant gilt die Regel nicht, und ein Bedürfnisbefehl geht vor.',
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
              ['Sichtweite, Hexfelder', '{{vision.soldier}}', '{{vision.hero}}'],
              ['Genauigkeit mit dem Bogen', 'Steigt mit Treffern', 'Immer genau'],
              ['Kampferfahrung', 'Steigt', 'Steigt nicht, außer die Mission erlaubt es'],
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
            foot: 'Schlag alle {{hero.blowSeconds}} s. Schaden: Schalte die Helden in der Tabelle unter [[article:damage|Waffen, Rüstung und Schaden]] ein.',
          },
        },
        {
          h: 'Unterschiede der Stämme',
        },
        {
          table: {
            head: ['Held', 'Stamm', 'Unterschied'],
            rows: [
              ['Sigurd', 'Ägypter', 'Kettenhemd {{hero.sigurdEgyptChain}}'],
              [
                'Hatschi',
                'Sarazene',
                '{{hero.hatchieSaracenBlows}} Schläge alle {{hero.hatchieSaracenSeconds}} s',
              ],
              [
                'Cyra',
                'Franke',
                'Reichweite {{frankHeroBow.min}}-{{frankHeroBow.max}}, Schuss alle {{frankHeroBow.seconds}} s, ohne Rüstung {{hero.frankBowBare}}, Waffenrock und Lederrüstung {{hero.frankBowWool}}, Kettenhemd und Plattenrüstung {{hero.frankBowChain}}, Gebäude und Fahrzeug {{hero.frankBowVehicle}}',
              ],
            ],
          },
        },
        {
          h: 'Rucksack',
        },
        {
          list: [
            'Nimmt nur: [[good:amulet_strength|Stärkeamulett]], [[good:amulet_defense|Verteidigungsamulett]], [[good:amulet_crithit|Trefferamulett]], [[good:amulet_speed|Windamulett]], [[good:potion_heal_small|Kleiner Heiltrank]], [[good:potion_heal_big|Großer Heiltrank]].',
          ],
        },
        {
          h: 'Nach dem Tod',
        },
        {
          p: 'Die Waffe verschwindet. Rüstung, Schuhe und Unbenutztes aus dem Rucksack bleiben am Boden.',
        },
      ],
      see: ['article:damage', 'article:chests', 'article:fog', 'article:exp-combat'],
    },
    {
      id: 'defence',
      name: 'Türme und Verteidigungsmodus',
      lead: 'Ein Gebäude im Verteidigungsmodus schießt von selbst. Jede Person drinnen bringt {{shelter.shotsPerSeat}} Schuss pro Sekunde.',
      blocks: [
        {
          h: 'Verteidigungsmodus',
        },
        {
          list: [
            '„Verteidigungsmodus starten“ wirkt auf ein Gebäude, „Ganzes Dorf“ auf alle Verteidigungsgebäude.',
            'Den Modus startest du selbst. Ein Angriff auf das Dorf löst ihn nicht aus.',
            'Ein Gebäude im Bau startet ihn nicht.',
            'Er endet nicht von selbst. Er läuft bis „Verteidigungsmodus stoppen“ oder bis das Gebäude zerstört ist.',
          ],
        },
        {
          h: 'Wer sich versteckt',
        },
        {
          list: [
            'Zivilisten, Frauen und Kinder laufen zum nächsten Gebäude mit freiem Platz. Das Gebäude muss in Gehreichweite liegen.',
            'Soldaten, Helden und [[job:scout|Kundschafter]] bleiben draußen.',
            'Wer keinen Platz findet, arbeitet weiter.',
            'Im Verteidigungsmodus lässt ein Siedler Essen und Schlaf liegen. Drinnen arbeitet er nicht und isst nur, was er bei sich hat.',
            'Wer drinnen ist, lässt sich nicht angreifen.',
            'Fällt das Gebäude, kommen alle heraus, die drinnen sind.',
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
            foot: 'Schüsse pro Sekunde bei vollem Gebäude. Ein Posten nimmt keinen Platz im Gebäude weg. Ein im Turm beschäftigter Bogenschütze schießt von selbst, ohne Verteidigungsmodus: [[article:aim|Treffen und Schießen]].',
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
            'Reihenfolge der Ziele: Soldaten und Helden, Wildtiere, Gebäude, übrige Menschen.',
          ],
        },
        {
          h: 'Turmbesatzung',
        },
        {
          table: {
            head: ['Turm', 'Trägerplätze', 'Met', 'Nahrung', 'Waffen, je Art'],
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
            'Ein Posten nimmt nur seinen Bogenschützen: [[job:soldier_bow_short|Kurzbogenschütze]] oder [[job:soldier_bow_long|Langbogenschütze]]. Er wird wie ein Arbeitsplatz zugewiesen.',
            'Nimmt ein Bogenschütze eine andere Waffe, verliert er den Posten.',
            'Die Besatzung isst aus dem Turmvorrat und schläft auf dem Posten, ohne herunterzukommen. Ist der Vorrat leer, geht sie essen.',
            'Der Assistent holt niemanden vom Turm, auch nicht für Ausrüstung.',
            '„Garnison abziehen“: Die Bogenschützen verlassen den Turm und bleiben für den nächsten Befehl ausgewählt. Auch ein Bewegungsbefehl holt einen Bogenschützen vom Posten.',
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
            foot: 'Reparatur kostet nichts. Eine Palisade repariert nur ein Bauarbeiter zur Zeit.',
          },
        },
        {
          h: 'Bau eines Tors',
        },
        {
          figure: {
            id: 'gate',
            caption: 'Wo das Tor entsteht',
          },
        },
        {
          list: [
            'Ein Tor belegt {{wall.gateSegments}} deiner fertigen Abschnitte in gerader Linie. Jeder braucht mindestens {{wall.gateMinHealthPct}}% Gesundheit und ebenen Boden, und im Durchgang darf niemand stehen.',
            'Das Tor entsteht sofort und ist geschlossen. Es hat volle Gesundheit, auch wenn ein Abschnitt beschädigt war.',
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
                'Offen. Schließt, wenn ein Feind bis {{wall.gateEnemyNear}} Hexfelder ans Tor kommt, und öffnet danach wieder',
              ],
            ],
            foot: 'Das Tor schließt bei jedem Menschen oder Fahrzeug eines Spielers, mit dem du Krieg hast, auch bei Zivilisten. Tiere schließen es nicht.',
          },
        },
        {
          list: [
            'Das Tor schließt erst, wenn niemand im Durchgang steht.',
            'Der Computer stellt seine Tore auf Automatisch.',
          ],
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
            'Kampferfahrung erhöht den Schlag gegen Palisaden nicht.',
            'Das Stärkeamulett erhöht diese Zahl: {{wall.ironSpear.blow}} wird {{wall.ironSpear.strongBlow}}, {{wall.shortSword.blow}} wird {{wall.shortSword.strongBlow}}, {{wall.shortBow.blow}} bleibt {{wall.shortBow.strongBlow}}.',
            'Ein Soldat wählt keine Palisade von selbst. Er schlägt sie auf Befehl oder wenn sie ihm den Weg zum Feind versperrt.',
            'Fällt ein Abschnitt, gehen die Soldaten durch die Bresche und lassen die Nachbarn in Ruhe.',
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
            foot: 'Ohne Kommandant fährt und schießt das Katapult nicht. Steine kosten nichts.',
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
            foot: 'Schaden am Menschen von vorne, ohne Amulette. Palisade: [[article:walls|Palisaden und Tore]].',
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
              ['Spieler im Frieden aus der Lobby', 'Verschont'],
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
          p: 'Die Genauigkeit steigt wie beim Bogenschützen: [[article:aim|Treffen und Schießen]]. Auf {{catapult.max}} Hexfeldern landet ein ungenauer Stein bei 0 Treffern bis {{stone.spread.0}} Hexfelder neben dem Ziel, bei 25 bis {{stone.spread.25}}, bei 50 bis {{stone.spread.50}}. Ab {{aim.noSpreadHits}} Treffern landet er im Ziel. Die Erfahrung sammelt der Kommandant: 1 Treffer je Stein, der etwas beschädigt hat, auch ein Gebäude. Ein Stein, der mehrere Ziele trifft, zählt einmal.',
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
            foot: 'Ein neues Katapult steht im Modus Ignorant. Von selbst wählt es nur Ziele, die es sieht. Ein Angriffsbefehl wirkt in jedem Modus.',
          },
        },
        {
          list: [
            'Ziel näher als {{catapult.min}} Hexfelder: Das Katapult fährt weg. Ziel weiter als {{catapult.max}}: Es rückt auf {{catapult.bandMin}}-{{catapult.max}} Hexfelder heran.',
            'Es schießt nur im Stand und nur, wenn es kein anderes Fahrzeug berührt.',
            'Du kannst es auf eine Stelle am Boden schießen lassen. Palisaden beschießt es nur auf Befehl.',
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
      lead: 'Die Stufe stellst du in der Lobby ein. Schwer kann die erste Welle gleich nach Friedensende schicken.',
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
            head: ['Zeit seit Wellenstart', 'Leute je Welle'],
            rows: [
              ['0', '{{ai.wave.0.min}}-{{ai.wave.0.max}}'],
              ['1 Std.', '{{ai.wave.1.min}}-{{ai.wave.1.max}}'],
              ['2 Std.', '{{ai.wave.2.min}}-{{ai.wave.2.max}}'],
              ['3 Std. und später', '{{ai.wave.3.min}}-{{ai.wave.3.max}}'],
            ],
            num: [1],
            foot: 'Die Zeit läuft ab dem späteren von zwei Zeitpunkten: „Erste Welle“ oder Friedensende. Die Größe der Welle wird aus diesem Bereich ausgewürfelt.',
          },
        },
        {
          list: [
            'Es marschiert immer nur eine Welle. Die nächste sammelt sich an der [[building:barracks|Kaserne]].',
            'Das Sammeln dauert bis zu {{ai.gatherMinutes}} Minuten. Danach ziehen so viele los, wie die untere Zahl der Tabelle sagt. Sind es weniger, gehen alle, die hinkommen.',
          ],
        },
        {
          h: 'Wann die Welle losgeht',
        },
        {
          list: [
            'Der Computer vergleicht die Stärke seiner Armee mit deiner. Er zählt Waffen, Rüstung, Amulette, Gesundheit und Heiltränke, aber keine Erfahrung.',
            'Dein Bogenschütze im Turm zählt {{ai.towerPostWeight}}.',
            'Jeder Computer lost am Anfang einen Plan aus. Ein aggressiver zieht los, wenn er {{ai.planAggressivePct}}% deiner Stärke hat, ein defensiver erst bei {{ai.planDefensivePct}}%, die übrigen bei {{ai.planBalancedPct}}%.',
            'Im Nebel zählt er, was er gesehen hat. Weiß er nichts über dich, hält er dich für gleich stark.',
            'Solange die Stärke fehlt, wartet die Welle an der Kaserne, auch nach dem Sammeln.',
            'Hat die Computerarmee ihre Grenze erreicht, zieht die Welle trotzdem los.',
            'Greifst du sein Dorf an oder bist du {{ai.defendRatio}} Mal stärker als er, hält er das Heer zu Hause, und eine Welle unterwegs kehrt um.',
          ],
        },
        {
          h: 'Überfälle',
        },
        {
          list: [
            'Ein kleiner Trupp von {{ai.raidMen}} Leuten geht auf deine Abbauer und Wirtschaftsgebäude los. Er meidet die Reichweite der Türme. Gibt es keinen Weg ohne Türme, zieht er nicht los.',
            'Ein schwerer Computer macht das in {{ai.raidChancePct}}% der Spiele, außer er startet auf einer Insel. Der Plan Störangriffe macht es immer, auf jeder Stufe.',
            'Der erste Überfall kommt {{ai.raidMinMinutes}}-{{ai.raidMaxMinutes}} Minuten nach Friedensende, die nächsten in ähnlichen Abständen.',
          ],
        },
        {
          h: 'Ziele',
        },
        {
          steps: [
            'Nächstes [[building:headquarters|Hauptquartier]].',
            'Türme.',
            'Übrige Gebäude, auch Baustellen.',
            'Menschen.',
          ],
        },
        {
          list: [
            'Palisade und [[building:work_pottery_02|Mauer]] sind keine Ziele: [[article:walls|Palisaden und Tore]].',
            'Im Nebel kennt der Computer die Gebäude vom Kartenstart und die, die er schon gesehen hat. Von neuen erfährt er, wenn er sie sieht.',
          ],
        },
        {
          h: 'Wasser',
        },
        {
          list: [
            'Eine Welle zu Fuß geht nur über die Landmasse, auf der die Kaserne des Computers steht. Dein Gebäude oder Mensch auf dieser Landmasse wird zum Ziel.',
            'Steht das Hauptquartier des Rivalen auf einer anderen Landmasse, errichtet der Computer am Ufer eine [[building:work_joinery_03|Schreinerei 4]], baut [[good:ship_small|Schiffe]] und bringt damit Truppen hinüber.',
            'Eine Landung legt ab, wenn {{ai.landingShips}} Schiffe am Ufer liegen, bei einem schwächeren Computer weniger, und das Heer {{ai.landingEdge}} Mal stärker ist als die Verteidiger. Ein Schiff trägt {{vehicle.shipSeats}} Soldaten.',
            'Sie landet außerhalb der Reichweite deiner Türme und deiner Gebäude im Verteidigungsmodus, so nah wie möglich am Hauptquartier, und geht darauf los.',
            'Verliert sie an Land {{ai.landingRetreatPct}}% der Leute, kehrt der Rest auf die Schiffe zurück. Die nächste Landung kommt frühestens nach {{ai.landingCooldownMinutes}} Minuten.',
          ],
        },
        {
          h: 'Wiederaufbau',
        },
        {
          p: 'Ein Spieler, der in der Lobby auf „Karten-KI“ steht, baut Gebäude wieder auf, wenn bis {{ai.rebuildNear}} Hexfelder kein Feind, aber einer seiner Zivilisten ist. Das Hauptquartier baut er nicht wieder auf.',
        },
      ],
      see: ['article:defence', 'article:walls', 'article:catapult', 'article:fog', 'article:diplomacy'],
    },
  ],
};
