import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const MILITARY: ArticleGroup = {
  group: 'Militär',
  items: [
    {
      id: 'damage',
      name: 'Waffen, Rüstung und Schaden',
      lead: 'Ein Mensch hat {{health.human}} Gesundheit. Ein Schlag zieht den Tabellenwert ab, die Faktoren unten ändern ihn.',
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
          h: 'Was den Schlag ändert',
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
            foot: 'Sie wirken in dieser Reihenfolge. Vorne und vordere Flanke zählen ×1. Pfeile und Steine werden durch Treffer nicht stärker, ihre Richtung zählt vom Abschussort aus. Richtung und Verteidigungsamulett wirken nur bei Menschen. Gegen Fahrzeuge und Palisaden zählen Treffer nicht. Der Stein des Katapults bekommt keine Amulette des Kommandanten. Palisaden berechnen Schaden eigens: [[article:walls|Palisaden und Tore]].',
          },
        },
        {
          list: [
            'Ein Ergebnis von 0 oder weniger verwundet nicht und bringt keine Erfahrung.',
            'Kinder lassen sich nicht verwunden.',
            'Waffen und Rüstungen nutzen sich nicht ab.',
            'Waffen und Rüstungen tragen nur erwachsene Männer.',
          ],
        },
        {
          h: 'Unterschiede der Stämme',
        },
        {
          list: [
            'Sarazene: Der [[good:bow_short|Kurzbogen]] macht gegen Waffenrock {{saracen.bowOnWool}} statt {{viking.bowOnWool}}, gegen Kettenhemd und Plattenrüstung {{saracen.bowOnChain}} statt {{viking.bowOnChain}}.',
            'Byzantiner: Die Zeile [[good:spear_wooden|Holzspeer]] zeigt den Drachen der Karte: {{dragon.hitpoints}} Gesundheit, Reichweite {{dragon.min}}-{{dragon.max}}, Serie aus {{dragon.blows}} Schlägen alle {{dragon.seconds}} s, ohne Rüstung {{dragon.bare}}. Ein ausgebildeter Speerträger kämpft wie bei den anderen Stämmen.',
            'Alle übrigen Soldatenwaffen sind bei den fünf Stämmen gleich.',
          ],
        },
        {
          h: 'Rüstungen',
        },
        {
          data: 'armour',
        },
        {
          p: 'Die Gewichte von Waffe und Rüstung addieren sich: [[article:walking|Gehtempo]].',
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
      lead: 'Die Klassenzähler im Fenster Assistent bewaffnen das Heer. Einzelne Leute änderst du in ihrem Panel.',
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
                'Bewaffnet zuerst einen unbewaffneten Soldaten, bildet dann neue aus',
                'Wenn der Kämpfer die Waffe nimmt',
              ],
            ],
            foot: 'Wen er in die Kaserne schickt: [[article:assistant|Assistent]].',
          },
        },
        {
          list: [
            'Solange ein unbewaffneter Soldat wartet, zieht der Zähler niemanden an seiner Stelle ein, selbst wenn gerade keine Waffe da ist.',
            'Ein unbewaffneter Soldat holt sich eine Waffe, wenn eine seiner Klasse in Reichweite liegt und keine anderen darauf warten.',
            'Einen Zähler zu senken holt die zurück, die noch auf eine Waffe warten.',
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
            foot: 'Liegt ein höherer Eintrag der Leiste in einem Lager in Reichweite, holt der Rekrut ihn dort und lässt das Schlechtere in der Kaserne. Danach kehrt er zur Kaserne zurück, ebenso ein vom Zähler bewaffneter Soldat.',
          },
        },
        {
          h: 'Waffen- und Rüstungsleisten',
        },
        {
          p: 'Jede Klasse hat eigene Leisten. Ein Soldat nimmt von links den ersten Eintrag aus dem Lager und übergeht durchgestrichene. Anfangs steht das Stärkste vorn. Ein Klick streicht durch, Halten und Ziehen ändert die Reihenfolge.',
        },
        {
          list: [
            'Keine Waffe verfügbar: Er wartet, das Fenster zeigt „wartet auf eine Waffe“.',
            'Keine Rüstung verfügbar: Er geht ohne. Später legt er sie nur auf Befehl an.',
          ],
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
            foot: 'Ware für die Kaserne hat Vorrang, dazu {{barracks.carriers}} Trägerplätze: [[article:hauling|Träger und Lager]].',
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
            'Findet er unterwegs keine Quelle, kommt er mit leeren Händen zurück.',
            'Eine Waffe ändert sofort die Klasse des Soldaten. Ohne Waffe bleibt er [[job:soldier_unarmed|Soldat]].',
            'Getauschte und abgelegte Schuhe, Werkzeuge und angebrochene Flaschen gehen verloren.',
            'Waffen, Rüstungen und Amulette nutzen sich nicht ab und kehren daher ins Lager zurück.',
            'Ein Befehl an eine einzelne Person geht dem Assistenten vor.',
          ],
        },
        {
          h: 'Treffer und bessere Waffen',
        },
        {
          p: 'Treffer sperren keine besseren Waffen. Ein Soldat nimmt jede Waffe aus dem Lager. Die Sperre liegt bei der Herstellung: [[good:spear_iron|Eisenspeer]] und [[good:sword_long|Langschwert]] verlangen Erfahrung des [[job:smith|Schmieds]], der [[good:bow_long|Langbogen]] die des [[job:armorer|Waffenbauers]]. Tabelle: [[article:exp-combat|Kampferfahrung]].',
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
      lead: 'Ein Nahkampfschlag geht nur daneben, wenn das Ziel beim Schlag außer Waffenreichweite steht. Die Treffsicherheit des Bogenschützen steigt mit Bogentreffern.',
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
            foot: 'Reichweite in Schritten. Unter der Untergrenze schießt der Bogenschütze nicht. Cyra bei den Franken: Reichweite {{frankHeroBow.min}}-{{frankHeroBow.max}}, Schuss alle {{frankHeroBow.seconds}} s.',
          },
        },
        {
          h: 'Treffsicherheit',
        },
        {
          table: {
            head: ['Treffer', 'Volltreffer'],
            rows: [
              ['0', '{{aim.basePct}}%'],
              ['50', '{{aim.samplePct}}%'],
              ['{{aim.sureHits}}+', '100%'],
            ],
            num: [0, 1],
            foot: 'Jeder Treffer bringt +1%. Kurz- und Langbogen teilen sich einen Trefferzähler, das [[article:catapult|Katapult]] hat einen eigenen nach derselben Tabelle. Helden treffen immer.',
          },
        },
        {
          h: 'Streuung von Fehlschüssen',
        },
        {
          list: [
            'Ein Fehlschuss landet bis 3 Schritte neben dem Ziel. Ab 75 Treffern weicht er nicht mehr ab.',
            'Ein Fehlschuss trifft den ersten Feind am Einschlagpunkt: Mensch, Tier oder Fahrzeug, dann Gebäude, dann Palisade.',
            'Pfeile fliegen über Eigene, Verbündete und Neutrale hinweg.',
            'Soldaten halten bei laufenden Zielen vor. Gebäude zielen dorthin, wo das Ziel steht.',
          ],
        },
        {
          h: 'Turmposten',
        },
        {
          list: [
            'Der Reichweitenbonus gilt, wenn der Bogenschütze auf dem Posten steht, nicht auf dem Weg dorthin.',
            'Feinde können nicht auf den Schützen auf dem Posten zielen, nur auf den Turm.',
          ],
        },
      ],
      see: ['article:exp-combat', 'article:defence', 'building:tower_00', 'building:tower_01'],
    },
    {
      id: 'stances',
      name: 'Soldatenmodi',
      lead: 'Soldaten und Helden beginnen im Modus Verteidigung.',
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
                'Antwortet',
              ],
              [
                'Verteidigung',
                'Um den Haltepunkt',
                '{{stance.search}}',
                'Ziel über {{stance.defendLeash}} vom Haltepunkt',
                'Antwortet',
              ],
              [
                'Ignorant',
                'Nur in Waffenreichweite, geht nicht heran',
                'Waffenreichweite',
                'Ziel über {{stance.ignoreLeash}} vom Haltepunkt',
                'Antwortet nicht',
              ],
            ],
            foot: 'Radien in Schritten. Der Haltepunkt ist der Ort, an dem der Soldat beim Moduswechsel stand. Bewegungs- und Angriffsbefehle verschieben ihn.',
          },
        },
        {
          list: [
            'Ein Soldat im Modus Angriff kehrt zum Haltepunkt zurück, wenn er mehr als {{stance.attackReturn}} Schritte davon entfernt zu kämpfen aufhört.',
            'Die Feindsuche hängt nicht vom [[article:fog|Nebel]] ab.',
            'Ein Angriffsbefehl wirkt in jedem Modus.',
            'Ein Bogenschütze auf dem Posten schießt in jedem Modus auf alles in Reichweite.',
            'Ein normaler Bewegungsbefehl hält den Soldaten auf der Route, auch unter Schlägen. Bei „Unterwegs angreifen“ dreht er sich zum Angreifer um.',
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
          p: 'Palisaden und die Mauer wählt ein Soldat nie von selbst: [[article:walls|Palisaden und Tore]].',
        },
        {
          h: 'Wer auf Schläge reagiert',
        },
        {
          table: {
            head: ['Wer', 'Vom Verwundeten, Schritte', 'Reaktion'],
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
                'Fliehen {{stance.fleeMin}}-{{stance.fleeMax}} Schritte und kehren zur Arbeit zurück',
              ],
              ['Leute in Gebäuden', '-', 'Reagieren nicht, außer dem Bogenschützen auf dem Posten'],
              ['Zivilist, der im Freien schläft', '-', 'Schläft, flieht nur, wenn er selbst getroffen wird'],
            ],
            num: [1],
            foot: 'Die Reaktion löst nur ein Schlag gegen einen Menschen aus.',
          },
        },
        {
          h: 'Zivilisten',
        },
        {
          list: [
            'Zivilisten sind im Modus Ignorant und kämpfen nicht. Den Modus stellst du nur bei Soldaten und Helden ein.',
            'Ein Zivilist flieht nur vor Schlägen. Der Anblick eines Feindes lässt ihn kalt.',
            'Wer flieht, wirft getragene Ware ab. Der Träger lässt seinen Karren stehen.',
          ],
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
              ['Sichtweite', '{{vision.soldier}}', '{{vision.hero}}'],
              ['Treffsicherheit mit dem Bogen', 'Steigt mit Treffern', 'Trifft immer'],
              ['Kampferfahrung', 'Steigt', 'Steigt nicht'],
              ['Essen und Schlaf', 'Braucht er', 'Braucht er nicht'],
              ['Schuhe', 'Muss er bekommen, nutzen sich ab', 'Hat er von Anfang an, nutzen sich nicht ab'],
              ['Waffe, Rüstung, Schuhe', 'Austauschbar', 'Fest'],
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
              ['[[job:hero_axe|Axtheld]]', 'Axt', '[[good:armor_chain|Kettenhemd]]', '{{hero.axeReach}}'],
              [
                '[[job:heroine_bow_xena|Cyra]]',
                'Bogen',
                '[[good:armor_leather|Lederrüstung]]',
                '{{heroBow.min}}-{{heroBow.max}}',
              ],
              [
                '[[job:hero_unarmed|Unbewaffneter Held]]',
                'Fäuste',
                '[[good:armor_wool|Waffenrock]]',
                '{{hero.fistReach}}',
              ],
            ],
            num: [3],
            foot: 'Schlag alle {{hero.blowSeconds}} s. Schaden: Option Helden in der Tabelle unter [[article:damage|Waffen, Rüstung und Schaden]].',
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
                'Axtheld',
                'Wikinger',
                'Plattenrüstung {{hero.axeVikingPlate}}, Schlag alle {{hero.axeVikingSeconds}} s',
              ],
              [
                'Cyra',
                'Franke',
                'Reichweite {{frankHeroBow.min}}-{{frankHeroBow.max}}, Schuss alle {{frankHeroBow.seconds}} s, ohne Rüstung {{hero.frankBowBare}}, Waffenrock und Lederrüstung {{hero.frankBowWool}}, Kettenhemd und Plattenrüstung {{hero.frankBowChain}}, Gebäude und Fahrzeug {{hero.frankBowVehicle}}',
              ],
              [
                'Unbewaffneter Held',
                'Byzantiner, Ägypter',
                'Serie aus {{hero.fistEasternBlows}} Schlägen alle {{hero.fistEasternSeconds}} s',
              ],
            ],
          },
        },
        {
          h: 'Rucksack',
        },
        {
          list: [
            'Nimmt: [[good:amulet_strength|Stärkeamulett]], [[good:amulet_defense|Verteidigungsamulett]], [[good:amulet_crithit|Trefferamulett]], [[good:amulet_speed|Windamulett]], [[good:potion_heal_small|Kleiner Heiltrank]], [[good:potion_heal_big|Großer Heiltrank]].',
            'Nimmt nichts für Bedürfnisse: Met, Nahrungstränke, Wachtränke, [[good:amulet_food|Nahrungsamulett]], [[good:amulet_stamina|Wachbleibamulett]].',
          ],
        },
        {
          h: 'Tod',
        },
        {
          p: 'Die Waffe verschwindet. Rüstung, Schuhe und Unbenutztes aus dem Rucksack bleiben am Boden.',
        },
      ],
      see: ['article:damage', 'article:chests', 'article:fog', 'article:exp-combat'],
    },
    {
      id: 'defence',
      name: 'Türme, Verteidigungsmodus, Schutz',
      lead: 'Ein Gebäude im Verteidigungsmodus schießt von selbst. Jeder Schutzsuchende bringt ihm {{shelter.shotsPerSeat}} Schuss pro Sekunde.',
      blocks: [
        {
          h: 'Verteidigungsmodus',
        },
        {
          list: [
            '„Verteidigungsmodus starten“ wirkt auf ein Gebäude, „Ganzes Dorf“ auf alle Verteidigungsgebäude.',
            'Den Modus startet nur der Spieler. Ein Schlag gegen einen Siedler löst ihn nicht aus.',
            'Ein Gebäude im Bau startet ihn nicht.',
            'Er läuft bis „Verteidigungsmodus stoppen“ oder bis zur Zerstörung des Gebäudes.',
          ],
        },
        {
          h: 'Wer Schutz sucht',
        },
        {
          list: [
            'Zivilisten, Frauen und Kinder laufen zum nächsten Gebäude mit freiem Platz in Gehreichweite.',
            'Soldaten, Helden und [[job:scout|Kundschafter]] bleiben draußen.',
            'Wer keinen Platz findet, arbeitet weiter.',
            'Der Verteidigungsmodus geht vor Hunger und Schlaf. Schutzsuchende essen nur, was sie bei sich tragen, und arbeiten nicht.',
            'Schutzsuchende lassen sich nicht angreifen.',
            'Wird das Gebäude zerstört, kommen die Schutzsuchenden heraus.',
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
            foot: 'Schüsse pro Sekunde bei voller Belegung. Ein Posten nimmt keinen Schutzplatz weg. Ein im Turm beschäftigter Bogenschütze schießt von selbst, ohne Verteidigungsmodus: [[article:aim|Treffen und Schießen]].',
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
            foot: 'Rüstung mit Block {{combat.armourBlock}} gerechnet, wie in [[article:damage|Waffen, Rüstung und Schaden]]. Bei jedem Stamm gleich, vor den Faktoren.',
          },
        },
        {
          list: [
            'Die Reichweite beträgt {{shelter.range}} Schritte ab der nächsten Gebäudewand, ohne Untergrenze.',
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
            head: ['Turm', 'Träger', 'Met', 'Nahrung', 'Jede Soldatenwaffe'],
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
            foot: 'Trägerplätze und Lagerkapazität.',
          },
        },
        {
          list: [
            'Ein Posten nimmt nur seine Klasse: [[job:soldier_bow_short|Kurzbogenschütze]] oder [[job:soldier_bow_long|Langbogenschütze]]. Er wird wie ein Arbeitsplatz zugewiesen.',
            'Eine andere Waffe ändert die Klasse und kostet den Posten.',
            'Die Besatzung isst aus dem Turmvorrat, ohne herunterzukommen, und schläft auf dem Posten. Ein leerer Vorrat schickt sie zum Essen fort.',
            'Der Assistent holt niemanden vom Turm, auch nicht für Ausrüstung.',
            '„Garnison abziehen“: Die Bogenschützen verlassen den Turm und bleiben für den nächsten Befehl ausgewählt. Auch ein Bewegungsbefehl holt einen Bogenschützen vom Posten.',
            'Status „Bemannt“: Der Turm hat einen zugewiesenen Bogenschützen. „Keine Garnison“: Er hat keinen.',
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
      lead: 'Ein Schlag nimmt einer Palisade 1 Gesundheit je volle {{wall.damagePerPoint}} Schaden gegen Gebäude. Unter {{wall.damagePerPoint}} passiert nichts.',
      blocks: [
        {
          table: {
            head: ['Element', 'Gesundheit', 'Reparatur je Schlag', 'Kosten'],
            rows: [
              ['Palisadenabschnitt', '150', '5', '1 [[good:wood|Holz]]'],
              ['Tor', '500', '5', 'Kostenlos, entsteht aus Abschnitten'],
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
            caption: 'Tor auf fünf Abschnitten',
          },
        },
        {
          list: [
            'Ein Tor steht auf fünf eigenen, fertigen Abschnitten in gerader Linie.',
            'Jeder Abschnitt hat mindestens 75% Gesundheit und steht auf ebenem Boden.',
            'Im Durchgang steht niemand.',
            'Das Tor entsteht sofort, geschlossen und mit voller Gesundheit, auch auf einem beschädigten Abschnitt.',
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
                'Offen. Schließt, wenn ein Feind bis {{wall.gateEnemyNear}} Schritte ans Tor kommt, und öffnet danach wieder',
              ],
            ],
            foot: 'Im Automatikmodus zählen lebende Menschen und Fahrzeuge eines Spielers im Krieg, Zivilisten ebenso. Tiere und Gebäude zählen nicht.',
          },
        },
        {
          list: [
            'Das Tor schließt erst, wenn niemand im Durchgang steht.',
            'Der Computer stellt seine Tore auf Automatisch.',
          ],
        },
        {
          h: 'Schläge gegen Palisaden',
        },
        {
          table: {
            head: ['Waffe', 'Punkte je Schlag', 'Schläge: Abschnitt', 'Schläge: Tor', 'Dauer: Abschnitt'],
            rows: [
              ['[[building:catapult|Katapult]]', '36', '5', '14', '20 s'],
              ['Held im Nahkampf', '5', '30', '100', '30 s'],
              ['[[good:spear_iron|Eisenspeer]]', '5', '30', '100', '68 s'],
              ['[[good:sword_long|Langschwert]]', '5', '30', '100', '73 s'],
              ['[[good:sword_shord|Kurzschwert]]', '2', '75', '250', '75 s'],
              ['[[good:spear_wooden|Holzspeer]]', '4', '38', '125', '86 s'],
              ['[[good:bow_short|Kurzbogen]]', '1', '150', '500', '150 s'],
              ['[[good:bow_long|Langbogen]]', '2', '75', '250', '175 s'],
              ['Fäuste, Pfeile aus Gebäuden', '0', '-', '-', '-'],
            ],
            num: [1, 2, 3, 4],
            foot: 'Dauer für einen Soldaten. Cyra 2 Punkte, bei den Franken 0.',
          },
        },
        {
          list: [
            'Kampferfahrung erhöht den Schlag gegen Palisaden nicht.',
            'Das Stärkeamulett wirkt auf die Punkte: 5 wird 7, 2 wird 3, 1 bleibt 1.',
            'Ein Soldat wählt keine Palisade von selbst. Er schlägt sie auf Befehl oder wenn sie ihm den Weg zum Feind versperrt.',
            'Fällt ein Abschnitt, gehen die Soldaten durch die Bresche und lassen die Nachbarn in Ruhe.',
          ],
        },
        {
          h: 'Mauer',
        },
        {
          p: 'Die [[building:work_pottery_02|Mauer]] ist ein Gebäude: {{wall.defenceHp}} Gesundheit, Schaden aus der Spalte Gebäude. Ein Soldat schlägt sie nur auf Befehl oder wenn sie den Weg zum Feind versperrt.',
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
      lead: 'Der Stein verletzt alles am Einschlagpunkt und auf den sechs Punkten ringsum, auch Eigene.',
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
              ['Reichweite', '{{catapult.min}}-{{catapult.max}} Schritte'],
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
              ['Palisadenabschnitt', '36 Punkte', '5'],
              ['Tor', '36 Punkte', '14'],
            ],
            num: [2],
            foot: 'Mensch ohne Schlagrichtung und Amulette. Treffer mit dem Katapult erhöhen den Schaden nicht.',
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
          h: 'Treffsicherheit',
        },
        {
          p: 'Tabelle: [[article:aim|Treffen und Schießen]]. Auf {{catapult.max}} Schritten weicht ein Fehlschuss bei 0 Treffern bis 3 Schritte ab, bei 25 um 2, bei 50 um 1, ab 75 um 0. Die Erfahrung sammelt der Kommandant, 1 Punkt je Stein, der jemanden verletzt hat.',
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
            'Ziel näher als {{catapult.min}} Schritte: Das Katapult fährt weg. Ziel weiter als {{catapult.max}}: Es rückt auf {{catapult.bandMin}}-{{catapult.max}} Schritte heran.',
            'Es schießt nur im Stand und nur, wenn es kein anderes Fahrzeug berührt.',
            'Ein Befehl kann einen Punkt am Boden wählen. Palisaden beschießt es nur auf Befehl.',
          ],
        },
        {
          h: 'Was ein Katapult zerstört',
        },
        {
          table: {
            head: ['Waffe', 'Schaden', 'Schläge aufs Katapult'],
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
            foot: 'Kampferfahrung erhöht Schläge gegen Fahrzeuge nicht. Amulette des Angreifers wirken.',
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
            foot: 'Zeiten sind Spielzeit: Bei ×3 vergehen sie dreimal so schnell. Keine Welle zieht vor Ende der „Friedenszeit“ los. Leicht und Mittel rekrutieren nicht über die Armeegrenze hinaus.',
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
            foot: 'Die Wellen starten zum späteren von zwei Zeitpunkten: „Erste Welle“ oder Friedensende. Die Größe wird aus dem Bereich ausgewürfelt.',
          },
        },
        {
          list: [
            'Es marschiert immer nur eine Welle. Die nächste sammelt sich an der [[building:barracks|Kaserne]].',
            'Das Sammeln dauert bis zu {{ai.gatherMinutes}} Minuten. Danach ziehen so viele los, wie die Untergrenze des Bereichs verlangt. Sind es weniger, gehen alle, die hinkommen.',
          ],
        },
        {
          h: 'Wann die Welle losgeht',
        },
        {
          list: [
            'Die Welle wartet, wenn du mehr Punkte hast: Soldat und Held 1, Bogenschütze im Turm 3. Der Computer zählt jeden seiner Leute mit 1.',
            'Waffen, Rüstung, Amulette, Tränke und Erfahrung zählen nicht.',
            'Sie wartet an der Kaserne, auch nach dem Sammeln.',
            'Hat die Computerarmee ihre Grenze erreicht, zieht die Welle trotzdem los.',
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
            'Der Computer zielt auch durch den Nebel.',
          ],
        },
        {
          h: 'Wasser',
        },
        {
          list: [
            'Ein Ziel muss auf derselben Landmasse stehen wie die Computerkaserne. Wellen steigen nicht auf Schiffe.',
            'Steht das Hauptquartier des Rivalen auf einer anderen Landmasse, errichtet der Computer am Ufer eine [[building:work_joinery_03|Schreinerei 4]] und baut [[good:ship_small|Schiffe]], transportiert damit aber keine Truppen.',
            'Deine Gebäude und Leute auf der Landmasse des Computers werden zum Ziel.',
            'Landungen von See sind ein Kartenmodus, zum Beispiel Ragnarök.',
          ],
        },
        {
          h: 'Wiederaufbau',
        },
        {
          p: 'Die „Karten-KI“ baut Gebäude wieder auf, wenn im Umkreis von {{ai.rebuildNear}} Schritten kein Feind steht. Das Hauptquartier nicht.',
        },
      ],
      see: ['article:defence', 'article:walls', 'article:catapult', 'article:fog', 'article:diplomacy'],
    },
  ],
};
