import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: 'Wirtschaft',
  items: [
    {
      id: 'construction',
      name: 'Bau, Ausbau, Reparatur',
      lead: 'Wohnhaus 1 baut ein Bauarbeiter allein in {{build.noviceSeconds}} s, mit Eisenwerkzeug in {{build.noviceIronSeconds}} s.',
      blocks: [
        {
          h: 'Wo du bauen kannst',
        },
        {
          table: {
            head: ['Bauverbot', 'Regel'],
            rows: [
              ['Gelände', 'Land, Sand, Strand, Steinwüste. Gebirge, Schnee, Wasser und Sumpf scheiden aus.'],
              [
                '[[building:work_well_00|Brunnen]], [[building:work_hive_00|Bienenstock]]',
                'Mindestens 1 Punkt unter dem Gebäude auf Gras',
              ],
              [
                'Platz',
                'Ein Gebäude belegt sofort den Grundriss seiner letzten Stufe und einen Rand darum. Die Ränder zweier Gebäude dürfen sich nicht überlappen.',
              ],
              ['Baum, Fels, Lagerstätte, Palisade', 'Müssen außerhalb des Grundrisses stehen'],
              [
                'Feindlicher Soldat',
                'Abgelehnt bis {{contest.radius}} Hexfelder, schräg etwa {{contest.diagonal}}. Es zählt nur ein sichtbarer, ohne die Besatzung auf Turmposten.',
              ],
              [
                'Gebäude eines Spielers, mit dem Frieden herrscht',
                'Abgelehnt bis {{peace.keepOut}} Hexfelder davon, auch von einer Baustelle, außer dein eigenes Gebäude steht näher.',
              ],
              [
                'Platz für den Ausbau',
                'Der Grundriss höherer Stufen eines stehenden Gebäudes ist belegt. Andere Gebäude können dort nicht stehen.',
              ],
              ['Gelände unter Nebel', 'Der Platz muss gerade sichtbar sein'],
            ],
          },
        },
        {
          figure: {
            id: 'step-diamond',
            caption: 'Warum es schräg weniger sind',
          },
        },
        {
          table: {
            head: ['Weicht aus', 'Regel'],
            rows: [
              ['Siedler, Fahrzeug, Arbeitsfahne, Wegweiser, Haufen, Kadaver', 'Werden zur Seite gerückt'],
              ['Strauch, Feld, Baumstumpf, offene Kiste', 'Werden beim Setzen der Baustelle zerstört'],
              ['Straßenbaustelle', 'Aufgehoben, gelieferter Bruchstein landet daneben'],
              [
                'Straße, Palisade auf dem Platz für den Ausbau',
                'Umgehen ihn. Eine Taste beim Ziehen der Linie schaltet „auch auf Platz für den Gebäudeausbau“ ein und legt sie dort hin, der Ausbau entfernt sie dann ohne Rückgabe.',
              ],
            ],
          },
        },
        {
          table: {
            head: ['Stört nicht', 'Regel'],
            rows: [
              ['Feindliche Zivilisten, Tiere', 'Die Baustelle entsteht neben ihnen'],
              ['Fertige Straße', 'Bleibt unter dem Gebäude'],
              [
                'Wegweiser-Reichweite',
                'Gilt nicht. Die Baustelle entsteht auch außerhalb des Netzes, der Bauarbeiter kommt, sobald das Netz dorthin reicht.',
              ],
            ],
          },
        },
        {
          h: 'Wie lange der Bau dauert',
        },
        {
          table: {
            head: [
              '[[building:home_level_00|Wohnhaus 1]], 1 Bauarbeiter',
              'Punkte je Schlag',
              'Schläge',
              'Dauer',
            ],
            rows: [
              [
                'Neuling, ohne Werkzeug',
                '{{build.novicePoints}}',
                '{{build.noviceSwings}}',
                '{{build.noviceSeconds}} s',
              ],
              [
                'Neuling, [[good:tool_iron|Eisenwerkzeug]]',
                '{{build.noviceIronPoints}}',
                '{{build.noviceIronSwings}}',
                '{{build.noviceIronSeconds}} s',
              ],
              [
                'Meister, [[good:tool_iron|Eisenwerkzeug]]',
                '{{build.masterIronPoints}}',
                '{{build.masterIronSwings}}',
                '{{build.masterIronSeconds}} s',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Ein Stück Baustoff sind {{build.pointsPerUnit}} Baupunkte, Wohnhaus 1 sind {{build.homeUnits}} Stück oder {{build.homePoints}} Punkte. Reine Schlagzeit ohne Materialtransport. 1 Schlag dauert {{build.swingSeconds}} s.',
          },
        },
        {
          table: {
            head: ['Erfahrung', 'Ohne Werkzeug', 'Holz', 'Eisen'],
            rows: [
              ['0-9%', 1, 1, 2],
              ['10-21%', 1, 2, 2],
              ['22-49%', 1, 2, 3],
              ['50-78%', 2, 2, 3],
              ['79-89%', 2, 2, 4],
              ['90-100%', 2, 3, 4],
            ],
            num: [1, 2, 3],
            foot: 'Baupunkte je Schlag. Ein [[job:builder|Bauarbeiter]] hat 100% nach {{exp.build.repeatsFull}} Schlägen, die etwas hinzugefügt haben.',
          },
        },
        {
          list: [
            'Ein Gebäude ohne Kosten braucht 1 Schlag.',
            'Ein Palisadenabschnitt und ein Straßenstück brauchen nach der Materiallieferung 1 Schlag von 1 Bauarbeiter.',
            'Material tragen der Bauarbeiter und Arbeiter, die der Baustelle zugewiesen sind, je 1 Stück.',
          ],
        },
        {
          h: 'Arbeitsreihenfolge des Bauarbeiters',
        },
        {
          steps: [
            'Straße oder Palisade, die der Spieler diesem Bauarbeiter gerade aufgetragen hat.',
            'Reparatur: Tore, dann Gebäude, dann Palisaden.',
            'Gebäude-Baustellen, zuerst versorgte und fast fertige.',
            'Neue Palisadenabschnitte.',
            'Straßen.',
          ],
        },
        {
          p: 'Weist der Spieler einer Baustelle einen Bauarbeiter zu, bleibt er dort, auch wenn es anderswo Arbeit gibt.',
        },
        {
          h: 'Ausbau',
        },
        {
          list: [
            'Kostet das Material der angehobenen Stufen. Mehrere Stufen auf einmal gehen, wenn jede freigeschaltet ist.',
            'Waren aus den Kosten, die das Gebäude auf Vorrat hat, gehen sofort auf die Baustelle. Die übrigen Vorräte kehren nach dem Ausbau zurück.',
            'Arbeiter und Bewohner gehen hinaus, behalten ihren Platz und kehren nach dem Ausbau zurück.',
            'Die Gesundheit steht währenddessen still und ist danach für die neue Stufe voll.',
            'Mit dem Ausbau endet der Verteidigungsmodus.',
            'Palisaden und Straßen unter dem neuen Gebäude verschwinden ohne Rückgabe.',
            'Ein Abbruch gibt die Vorräte und die daraus genommenen Waren zurück, geliefertes Material geht verloren.',
          ],
        },
        {
          h: 'Reparatur',
        },
        {
          table: {
            head: ['Ziel', 'Gesundheit je Schlag', 'Bauarbeiter zugleich'],
            rows: [
              ['Gebäude', '{{repair.minPerSwing}}-{{repair.maxPerSwing}}', '{{repair.crew}}'],
              ['Palisadenabschnitt', 5, '{{repair.wallCrew}}'],
              ['Tor', 5, '{{repair.wallCrew}}'],
            ],
            num: [1, 2],
            foot: 'Reparatur kostet kein Material. Ein Gebäude erhält {{repair.perPoint}} Gesundheit je Baupunkt. Bei Palisade und Tor ändern Erfahrung und Werkzeug nichts.',
          },
        },
        {
          list: [
            'Nach einem feindlichen Schlag wartet die Reparatur {{repair.calmSeconds}} s, und im Umkreis von {{alert.standTo}} Hexfeldern darf niemand kämpfen. Ein Befehl des Spielers übergeht beides.',
            'Baustellen und Palisadenabschnitte im Bau werden nicht repariert, ihre Gesundheit wächst mit dem Bau.',
            'Beschädigtes Gebäude im Ausbau: erst Reparatur, dann Ausbau.',
          ],
        },
        {
          h: 'Was verloren geht und was zurückkommt',
        },
        {
          table: {
            head: ['Situation', 'Folge'],
            rows: [
              ['Abriss einer Baustelle', 'Geliefertes Material landet am Boden'],
              ['Abriss oder Zerstörung eines Gebäudes', 'Inhalt plus halbe Kosten, jeder Posten aufgerundet'],
              [
                'Abriss eines Gebäudes im Ausbau',
                'Dasselbe für die aktuelle Stufe, plus eingelagerte Vorräte und Ausbaumaterial',
              ],
            ],
            foot: 'Die Waren verteilen sich bis zu {{reach.spill}} Hexfelder weit am Boden, auf derselben Landmasse. Was nicht passt, geht verloren.',
          },
        },
      ],
      see: ['article:tools', 'article:walls', 'article:roads', 'article:exp-work', 'job:builder'],
    },
    {
      id: 'workshops',
      name: 'Werkstätten und Produktwahl',
      lead: 'Der Zähler sagt, wie viele Chargen ein Arbeiter herstellen soll: 0 heißt Stopp, ∞ endlos. Eine Charge ist ein Durchlauf des Rezepts.',
      blocks: [
        {
          h: 'Zählerwerte',
        },
        {
          table: {
            head: ['Zähler', 'Werkstatt', 'Abbauer'],
            rows: [
              ['0', 'Produkt ruht', 'Ware wird übergangen'],
              [
                '1-{{workshop.counterMax}}',
                'So viele Chargen, -1 beim Start einer Charge',
                'So viele Stück, -1 je gewonnenes Stück',
              ],
              ['∞', 'Endlos, Zähler sinkt nicht', 'Endlos, Zähler sinkt nicht'],
            ],
            foot: 'Die Werkstatt zählt Chargen, nicht Stücke. Eine Charge bringt mit Erfahrung und Werkzeug mehr Stücke: [[article:tools|Werkzeug]].',
          },
        },
        {
          h: 'Knöpfe',
        },
        {
          table: {
            head: ['Knopf', 'Klick', 'Shift', 'Ctrl'],
            rows: [
              [
                'Warensymbol, „Nur dieses Produkt“',
                'Diese Ware ∞, Rest 0',
                '-',
                'Diese Ware: von 0 auf ∞, von jedem anderen Wert auf 0. Rest bleibt.',
              ],
              ['Weniger', '-1. Springt von 0 auf ∞, von ∞ auf {{workshop.counterMax}}', '-10', 'Auf 0'],
              ['Mehr', '+1. Springt von {{workshop.counterMax}} auf ∞, von ∞ auf 0', '+10', 'Auf ∞'],
            ],
          },
        },
        {
          h: 'Startwerte neuer Arbeiter',
        },
        {
          table: {
            head: ['Wer', 'Startzähler'],
            rows: [
              ['Handwerker', 'Erstes Produkt der Werkstatt ∞, Rest 0'],
              [
                '[[job:breeder|Viehzüchter]] in der [[building:work_animal_farm|Viehzüchterei]]',
                'Ochse ∞, Schaf 0',
              ],
              [
                'Absolvent eines Berufs mit mehreren Kursen, vom Assistenten zugewiesen',
                'In der Schule gelernte Produkte ∞, Rest 0',
              ],
              ['Werkstatt mit 1 Produkt', 'Dieses Produkt ∞'],
              ['[[job:collector|Abbauer]]', 'Jede Ware ∞'],
            ],
          },
        },
        {
          h: 'Was mit den Zählern passiert',
        },
        {
          p: 'Sie verfallen bei jedem Wechsel von Arbeitsplatz oder Beruf, auch nach dem Abriss des Gebäudes. Ein Ausbau lässt sie stehen, neue Produkte der Stufe beginnen bei 0. Jeder Arbeiter hat eigene Zähler: 2 Leute in einer Werkstatt können 2 verschiedene Produkte herstellen.',
        },
        {
          h: 'Mehrere Produkte zugleich',
        },
        {
          p: 'Produkte mit Zähler über 0 kommen abwechselnd dran, je 1 Charge, in der Reihenfolge im Panel.',
        },
        {
          table: {
            head: ['Situation', 'Folge'],
            rows: [
              [
                'Volles Regal des Produkts',
                'Das nächste Produkt ist dran. Laufende Chargen zählen als belegter Platz.',
              ],
              ['Keine Zutat im Gebäude', 'Das nächste Produkt ist dran'],
              [
                'Zu wenig von einer Zutat im Gebäude',
                'Wartet auf den Rest. Gibt die Reihe ab, wenn es den Rest nirgends gibt.',
              ],
              ['Alle Zähler auf 0', 'Der Arbeiter beginnt nichts'],
              [
                'Produkt ohne nötige Erfahrung',
                'Hinweis „gesperrt“ statt Zähler, wird in der Reihe übergangen',
              ],
              [
                'Alle Produkte mit Zähler gesperrt',
                'Der Arbeiter macht, was er schon kann, auch Produkte auf 0',
              ],
            ],
          },
        },
        {
          h: 'Fahrzeuge',
        },
        {
          list: [
            'Ein Fahrzeug ist keine Charge. Der Handwerker legt neben der Werkstatt eine Baustelle an, trägt selbst das Material und baut.',
            'Der Fahrzeugzähler sinkt, wenn das Fahrzeug fertig ist, nicht beim Start.',
            'Ist neben der Werkstatt kein Platz für die Baustelle, kommt das nächste Produkt dran.',
          ],
        },
        {
          h: 'Abbauer',
        },
        {
          p: 'Der Abbauer nutzt dasselbe Panel. Der Warenknopf heißt hier „Nur diese Ware“.',
        },
        {
          table: {
            head: ['Aktion', 'Folge'],
            rows: [
              ['„Nur diese Ware“', 'Diese Ware ∞, Rest 0'],
              [
                'Rechtsklick auf Vorkommen',
                '„Sammeln“: diese Ware ∞, Rest 0, die Arbeitsfahne bleibt, wo sie war',
              ],
              ['Ctrl und Rechtsklick auf Vorkommen', 'Dasselbe, und die Fahne wandert auf das Vorkommen'],
              ['Alle Zähler auf 0', 'Status „Alles auf 0 gestellt“'],
              ['Abbauer mit Arbeitsplatz', 'Zur Wahl stehen nur Waren, die das Gebäude lagert'],
              [
                'Zähler auf 0, aber die Ware liegt da',
                'Der Zähler gilt für den Abbau. Stämme und Haufen trägt der Abbauer weiter.',
              ],
            ],
            foot: '[[job:hunter|Jäger]], [[job:scout|Kundschafter]] und Soldaten haben keine Zähler.',
          },
        },
      ],
      see: [
        'article:work-flag',
        'article:tools',
        'article:gathering',
        'article:exp-work',
        'article:vehicles',
      ],
    },
    {
      id: 'gathering',
      name: 'Abbau und Anbau',
      lead: 'Ein Baum liefert {{gather.treeYield}} Stück Holz nach {{gather.strokes}} Schlägen eines Neulings.',
      blocks: [
        {
          h: 'Was ein Vorkommen liefert',
        },
        {
          table: {
            head: ['Vorkommen', 'Wer', 'Liefert', 'Schläge Neuling', 'Werkzeug'],
            rows: [
              [
                'Baum',
                '[[job:collector|Abbauer]]',
                '{{gather.treeYield}} [[good:wood|Holz]]',
                '{{gather.strokes}} je Baum',
                'ja',
              ],
              [
                'Fels',
                '[[job:collector|Abbauer]]',
                '4-5 [[good:stone|Bruchstein]]',
                '{{gather.strokes}} je Stück',
                'ja',
              ],
              [
                'Lagerstätte',
                '[[job:collector|Abbauer]]',
                '5 [[good:mud|Lehm]], [[good:iron|Eisen]] oder [[good:gold|Gold]]',
                '{{gather.strokes}} je Stück',
                'ja',
              ],
              ['Pilz', '[[job:collector|Abbauer]]', '1 [[good:mushroom|Pilz]]', '1 Aufheben', 'nein'],
              [
                'Getreidefeld',
                '[[job:farmer|Farmer]]',
                '1 [[good:wheat|Weizen]]',
                '{{gather.wheatStrokes}} je Feld',
                'ja',
              ],
              [
                'Kräuterfeld',
                '[[job:herb_mush_guy|Kräutergärtner]]',
                '1 [[good:herb|Kraut]]',
                '{{gather.herbStrokes}} je Feld',
                'ja',
              ],
              [
                'Fischschwarm',
                '[[job:fisher|Fischer]]',
                '1 [[good:fish|Fisch]]',
                '{{gather.casts}} Würfe',
                'ja',
              ],
              ['Beerenstrauch', 'Hungriger Siedler', '1 Mahlzeit an Ort und Stelle', '1 Mal essen', 'nein'],
            ],
          },
        },
        {
          list: [
            'Ein Baum fällt als Ganzes. Die {{gather.treeYield}} Stück liegen als Stamm da, und der Abbauer trägt sie einzeln weg.',
            'Ein Stück aus Fels oder Lagerstätte fällt neben der Lagerstätte zu Boden.',
          ],
        },
        {
          h: 'Eisen und Gold',
        },
        {
          table: {
            head: ['Weg', 'Bedingung', 'Für wen'],
            rows: [
              [
                'Arbeit',
                '{{gather.oreNeed}} Stück [[good:mud|Lehm]] und [[good:stone|Bruchstein]] zusammen',
                'Diesen Siedler. Der Erste entdeckt die Ware fürs Dorf.',
              ],
              ['[[building:school|Schule]]', 'Kurs, sobald die Ware entdeckt ist', 'Den Absolventen'],
            ],
            foot: 'Die Bedingung gilt getrennt für [[good:iron|Eisen]] und [[good:gold|Gold]] und für jeden Siedler einzeln. Bis dahin steht die Ware im Panel auf „gesperrt“.',
          },
        },
        {
          h: 'Feld',
        },
        {
          figure: {
            id: 'field-stages',
            caption: 'Von der Saat bis zur Ernte',
          },
        },
        {
          table: {
            head: ['Stufe', 'Was passiert'],
            rows: [
              ['1', 'Gesät'],
              ['2-{{field.lastSeedStage}}', 'Jedes Gießen bringt 1 Stufe für das Feld und 6 Nachbarfelder'],
              ['{{field.ripeStage}}', 'Reif, wartet auf die Ernte'],
              ['Nach der Ernte', '1 Stück liegt am Boden, der Platz ist frei für neue Saat'],
            ],
            foot: 'Ein Feld wächst nur durch Gießen, Zeit spielt keine Rolle.',
          },
        },
        {
          table: {
            head: ['Gebäude', 'Felder', 'Radius', 'Besatzung', 'Vorrat'],
            rows: [
              [
                '[[building:work_farm_00|Farm]]',
                '{{field.max}}',
                '{{field.radius}} Hexfelder',
                '{{farm.farmers}} Farmer, {{farm.carriers}} Träger',
                '{{farm.stock}}',
              ],
              [
                '[[building:work_herb_hut|Kräuterhütte]]',
                '{{field.max}}',
                '{{field.radius}} Hexfelder',
                '{{herbHut.herbalists}} Kräutergärtner, {{herbHut.carriers}} Träger',
                '{{herbHut.stock}}',
              ],
            ],
            num: [1, 4],
            foot: 'Schräg beträgt der Radius etwa {{field.diagonal}} Hexfelder. Die Feldgrenze gilt fürs Gebäude, mehr Leute bestellen die Felder nur schneller.',
          },
        },
        {
          h: 'Arbeitsreihenfolge von Farmer und Kräutergärtner',
        },
        {
          steps: [
            'Bringt das geerntete Stück ins Gebäude.',
            'Sät, wenn das Gebäude weniger als {{field.max}} Felder hat.',
            'Erntet das nächste reife Feld.',
            'Gießt das Feld mit der niedrigsten Stufe.',
            'Wartet im Gebäude.',
          ],
        },
        {
          p: 'Ein Feld braucht Ackerboden: Sand und Straße scheiden aus. Wilde Felder der Karte im Radius des Gebäudes zählen zu seiner Grenze.',
        },
        {
          p: 'Ein Feld, das {{field.reclaimSeconds}} s lang nicht von der Tür seines Gebäudes erreichbar ist, verschwindet und gibt seinen Platz frei.',
        },
        {
          h: 'Was nachwächst',
        },
        {
          table: {
            head: ['Quelle', 'Tempo', 'Grenze'],
            rows: [
              [
                '[[building:work_well_00|Brunnen]]',
                '+1 [[good:water|Wasser]] pro Sekunde, ohne Arbeiter',
                '{{well.stock}} Stück im Gebäude',
              ],
              [
                '[[building:work_hive_00|Bienenstock]]',
                '+1 [[good:honey|Honig]] pro Sekunde, ohne Arbeiter',
                '{{hive.stock}} Stück im Gebäude',
              ],
              [
                'Beerenstrauch',
                '{{bush.regrowSeconds}} s: {{bush.stageSeconds}} s bis zur Blüte, {{bush.stageSeconds}} s bis zu den Früchten',
                '1 Mahlzeit',
              ],
              ['Fischschwarm', '+1 Fisch alle {{fish.regrowSeconds}} s', '{{fish.swarmMax}} Fische'],
              ['Baum, Fels, Lagerstätte, Pilz', 'Wachsen nicht nach', '-'],
            ],
          },
        },
      ],
      see: [
        'article:tools',
        'article:hauling',
        'article:workshops',
        'article:work-flag',
        'article:exp-work',
        'job:collector',
        'job:farmer',
        'job:fisher',
      ],
    },
    {
      id: 'tools',
      name: 'Werkzeug',
      lead: 'Werkzeug spart Schläge und bringt in der Werkstatt mehr Stücke. Es hält {{tool.uses}} Einsätze.',
      blocks: [
        {
          h: 'Wer es nutzt',
        },
        {
          table: {
            head: ['Wer', 'Was er gewinnt'],
            rows: [
              ['Handwerker in der Werkstatt', 'Mehr Stücke je Charge'],
              ['[[job:collector|Abbauer]]', 'Weniger Schläge, außer bei Pilzen'],
              [
                '[[job:farmer|Farmer]], [[job:herb_mush_guy|Kräutergärtner]]',
                'Weniger Schläge bei der Ernte',
              ],
              ['[[job:fisher|Fischer]]', 'Weniger Würfe'],
              ['[[job:builder|Bauarbeiter]]', 'Mehr Baupunkte je Schlag'],
              ['[[job:hunter|Jäger]], [[job:carrier|Träger]]', 'Nichts'],
              ['Soldaten, Helden', 'Tragen kein Werkzeug'],
            ],
          },
        },
        {
          h: 'Schläge beim Abbau',
        },
        {
          table: {
            head: ['Erfahrung', 'Ohne Werkzeug', 'Holz', 'Eisen'],
            rows: [
              ['0%', '{{tool.strokes.0.bare}}', '{{tool.strokes.0.wooden}}', '{{tool.strokes.0.iron}}'],
              ['20%', '{{tool.strokes.20.bare}}', '{{tool.strokes.20.wooden}}', '{{tool.strokes.20.iron}}'],
              ['40%', '{{tool.strokes.40.bare}}', '{{tool.strokes.40.wooden}}', '{{tool.strokes.40.iron}}'],
              ['60%', '{{tool.strokes.60.bare}}', '{{tool.strokes.60.wooden}}', '{{tool.strokes.60.iron}}'],
              ['80%', '{{tool.strokes.80.bare}}', '{{tool.strokes.80.wooden}}', '{{tool.strokes.80.iron}}'],
              [
                '100%',
                '{{tool.strokes.100.bare}}',
                '{{tool.strokes.100.wooden}}',
                '{{tool.strokes.100.iron}}',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Vorkommen mit {{gather.strokes}} Schlägen: Baum, Fels, Lagerstätte, Kräuterfeld.',
          },
        },
        {
          table: {
            head: ['Erfahrung', 'Ohne Werkzeug', 'Holz', 'Eisen'],
            rows: [
              ['0%', '{{tool.casts.0.bare}}', '{{tool.casts.0.wooden}}', '{{tool.casts.0.iron}}'],
              ['20%', '{{tool.casts.20.bare}}', '{{tool.casts.20.wooden}}', '{{tool.casts.20.iron}}'],
              ['40%', '{{tool.casts.40.bare}}', '{{tool.casts.40.wooden}}', '{{tool.casts.40.iron}}'],
              ['60%', '{{tool.casts.60.bare}}', '{{tool.casts.60.wooden}}', '{{tool.casts.60.iron}}'],
              ['80-100%', '{{tool.casts.80.bare}}', '{{tool.casts.80.wooden}}', '{{tool.casts.80.iron}}'],
            ],
            num: [1, 2, 3],
            foot: 'Fischfang, {{gather.casts}} Würfe je Fisch.',
          },
        },
        {
          p: '[[good:wheat|Weizen]] kostet ohne Werkzeug {{gather.wheatStrokes}} Schläge je Feld, mit Werkzeug oder ab 20% Erfahrung 1 Schlag.',
        },
        {
          h: 'Stücke je Charge in der Werkstatt',
        },
        {
          table: {
            head: ['Erfahrung', 'Ohne Werkzeug', 'Holz', 'Eisen'],
            rows: [
              ['0%', '{{tool.output.0.bare}}', '{{tool.output.0.wooden}}', '{{tool.output.0.iron}}'],
              ['20%', '{{tool.output.20.bare}}', '{{tool.output.20.wooden}}', '{{tool.output.20.iron}}'],
              ['40%', '{{tool.output.40.bare}}', '{{tool.output.40.wooden}}', '{{tool.output.40.iron}}'],
              ['60%', '{{tool.output.60.bare}}', '{{tool.output.60.wooden}}', '{{tool.output.60.iron}}'],
              ['80%', '{{tool.output.80.bare}}', '{{tool.output.80.wooden}}', '{{tool.output.80.iron}}'],
              ['100%', '{{tool.output.100.bare}}', '{{tool.output.100.wooden}}', '{{tool.output.100.iron}}'],
            ],
            num: [1, 2, 3],
            foot: 'Für ein Rezept mit 1 Stück. Rezept mit 2 Stück: Bonus ×2. Zutaten und Dauer der Charge bleiben gleich. Erfahrung wirkt auch auf Waren aus der Schlachtung.',
          },
        },
        {
          p: 'Bruchteile sammeln sich in der Werkstatt. Ein volles Stück kommt ins Regal, auch über die Kapazität hinaus.',
        },
        {
          h: 'Verschleiß',
        },
        {
          table: {
            head: ['Arbeit', 'Werkzeugeinsatz'],
            rows: [
              ['Charge in der Werkstatt', '1 je fertige Charge'],
              ['Schlag beim Abbau', '1 je Schlag, auch ohne fertiges Stück'],
              ['Angelwurf', '1 je Wurf, auch ohne Fang'],
              [
                'Schlag des Bauarbeiters',
                '1 je Schlag, auch bei Reparatur und wenn der Schlag nichts hinzufügt',
              ],
              ['Gießen', '1 je Gießen'],
              ['Säen, Pilze aufheben', '0'],
            ],
            foot: 'Nach {{tool.uses}} Einsätzen ist das Werkzeug weg, und der Siedler arbeitet mit bloßen Händen, bis er neues hat.',
          },
        },
      ],
      see: [
        'good:tool_wooden',
        'good:tool_iron',
        'article:exp-work',
        'article:construction',
        'article:gathering',
      ],
    },
    {
      id: 'hauling',
      name: 'Träger und Lager',
      lead: 'Ein Träger ohne Karren trägt {{haul.carry}} Stück, und am Boden liegen bis zu {{haul.groundStack}} Stück einer Ware auf einem Punkt.',
      blocks: [
        {
          h: 'Kapazität',
        },
        {
          table: {
            head: ['Gebäude', 'Stück je Ware'],
            rows: [
              ['[[building:stock_00|Lagerhaus 1]]', '{{haul.store1}}'],
              ['[[building:stock_01|Lagerhaus 2]]', '{{haul.store2}}'],
              ['[[building:stock_02|Lagerhaus 3]]', '{{haul.store3}}'],
              ['[[building:headquarters|Hauptquartier]]', '{{haul.hq}}'],
            ],
            num: [1],
            foot: 'Jedes dieser Gebäude nimmt je {{haul.storeSeats}} [[job:carrier|Träger]], Abbauer, Fischer und Jäger auf.',
          },
        },
        {
          h: 'Vorrang und Minimum',
        },
        {
          table: {
            head: ['Eigenschaft', 'Vorrang', 'Lagerminimum'],
            rows: [
              [
                'Gilt für',
                'Ein Gebäude: Lagerhaus, Hauptquartier, Kaserne, Turm',
                'Alle Lagerhäuser des Spielers und das Hauptquartier zusammen',
              ],
              [
                'Wer holt',
                'Träger dieses Gebäudes',
                'Träger von Lagerhäusern, Hauptquartier, Brunnen und Bienenstöcken',
              ],
              [
                'Woher',
                'Andere Lager, Werkstattprodukte, Haufen',
                'Werkstattprodukte, Brunnen, Bienenstöcke, Haufen',
              ],
              ['Bis wann', 'Solange das Gebäude Platz hat', 'Solange die Summe unter dem Minimum liegt'],
              ['Grenze', 'Kapazität des Gebäudes', '{{haul.minimumMax}} Stück einer Ware'],
              ['Sperre', 'Keine', 'Niemand nimmt Ware unter dem Minimum aus dem Lager'],
            ],
            foot: 'Ein Lager gibt einem Lager mit Vorrang nur Ware über dem Minimum ab.',
          },
        },
        {
          p: 'Das Minimum gilt auch fürs Essen. Liegt alles Essen innerhalb des Minimums, isst niemand aus dem Lager.',
        },
        {
          h: 'Arbeitsreihenfolge des Trägers im Lager',
        },
        {
          steps: [
            'Bringt weg, was er in den Händen hat.',
            'Holt Ware, die in seinem Gebäude Vorrang hat.',
            'In Lagerhaus und Hauptquartier: holt Ware unter dem Minimum.',
            'Hebt den nächsten Haufen mit Ware für sein Gebäude auf.',
            'Holt fertige Produkte aus Werkstätten in sein Gebäude.',
          ],
        },
        {
          table: {
            head: ['Träger arbeitet in', 'Was er tut'],
            rows: [
              [
                '[[building:work_farm_00|Farm]], [[building:work_herb_hut|Kräuterhütte]]',
                'Bringt erst die Ernte ins Lager, dann Haufen',
              ],
              ['Werkstatt', 'Bringt erst Zutaten, dann holt er Produkte ab'],
              [
                '[[building:work_well_00|Brunnen]], [[building:work_hive_00|Bienenstock]]',
                'Bringt den Inhalt weg',
              ],
            ],
          },
        },
        {
          h: 'Karren',
        },
        {
          table: {
            head: ['Träger', 'Stück je Fahrt', 'Tempoverlust, voll'],
            rows: [
              ['Ohne Karren', '{{haul.carry}}', '-'],
              ['Mit [[good:handcart|Handkarren]]', '{{haul.handcart}}', '{{haul.handcartLossPct}}%'],
              ['Mit [[good:oxcart|Ochsenkarren]]', '{{haul.oxcart}}', '{{haul.oxcartLossPct}}%'],
            ],
            num: [1, 2],
            foot: 'Der Tempoverlust wächst mit der Ladung. Die Karren des [[job:trader|Händlers]] haben dieselben Werte.',
          },
        },
        {
          list: [
            'Einen Karren nehmen nur Träger mit Arbeitsplatz und [[job:trader|Händler]]. Der Träger behält seinen Arbeitsplatz und nutzt den Karren wie ein Werkzeug.',
            'Der Karren muss dir gehören und frei sein: ohne Besatzung, ohne anderen Fahrer, auf derselben Landmasse.',
            'Ein Lagerträger mit Platz auf dem Karren nimmt dieselbe Ware von Haufen und fertigen Produkten bis {{haul.cartTopUp}} Hexfelder um sich mit und fährt dann zurück.',
            'Verliert er den Arbeitsplatz, bleibt der Karren stehen.',
          ],
        },
        {
          h: 'Haufen am Boden',
        },
        {
          list: [
            'Auf einem Punkt liegt 1 Ware, bis {{haul.groundStack}} Stück.',
            'Ein Haufen gehört niemandem, jeder darf ihn nehmen.',
            'Ein Träger ohne Arbeitsfahne sammelt bis {{flag.radius}} Hexfelder um sein Gebäude auf, mit Fahne bis {{flag.radius}} Hexfelder um die Fahne.',
          ],
        },
        {
          h: 'Arbeitsreichweite',
        },
        {
          table: {
            head: ['Wer', 'Gemessen ab', 'Waagerecht, senkrecht', 'Schräg'],
            rows: [
              ['[[job:collector|Abbauer]]', 'Arbeitsfahne', '{{flag.radius}}', 'etwa {{flag.diagonal}}'],
              ['Träger', 'Arbeitsfahne oder Gebäude', '{{flag.radius}}', 'etwa {{flag.diagonal}}'],
              ['[[job:hunter|Jäger]]', 'Arbeitsfahne', '{{flag.hunter}}', '{{flag.hunter}}'],
              ['[[job:fisher|Fischer]]', 'Arbeitsfahne', '{{flag.fisher}}', 'etwa {{flag.fisherDiagonal}}'],
              [
                '[[job:farmer|Farmer]], [[job:herb_mush_guy|Kräutergärtner]]',
                'Gebäude',
                '{{field.radius}}',
                'etwa {{field.diagonal}}',
              ],
            ],
            num: [2, 3],
            foot: 'In Hexfeldern. Der Arbeitsbereich endet an der Wegweiser-Reichweite, wenn der Beruf ihr unterliegt.',
          },
        },
        {
          p: 'Keine Arbeitsfahne nehmen die Träger von Farm, Kräuterhütte, Brunnen, Bienenstock, Turm und Kaserne an.',
        },
      ],
      see: [
        'article:work-flag',
        'article:roads',
        'article:vehicles',
        'article:construction',
        'job:carrier',
        'building:stock_00',
      ],
    },
    {
      id: 'work-flag',
      name: 'Arbeitsfahne',
      lead: 'Die Fahne legt den Arbeitsbereich fest und lagert nichts. Ein Abbauer ohne Arbeitsplatz lässt die Ware am Boden liegen.',
      blocks: [
        {
          figure: {
            id: 'flag-flow',
            caption: 'Der Weg der Ware von der Fahne',
          },
        },
        {
          h: 'Ohne und mit Arbeitsplatz',
        },
        {
          table: {
            head: ['Eigenschaft', 'Ohne Arbeitsplatz', 'Mit Arbeitsplatz'],
            rows: [
              [
                'Wer',
                '[[job:collector|Abbauer]], [[job:fisher|Fischer]], [[job:hunter|Jäger]]',
                'Dieselben, dazu [[job:carrier|Träger]] von Lagerhaus, Hauptquartier oder Werkstatt',
              ],
              [
                'Woher die Fahne',
                'Steht beim Berufsantritt von selbst vor seinen Füßen',
                'Nur über „Arbeitsfahne setzen“',
              ],
              ['Wo er arbeitet', 'Um die Fahne', 'Um die Fahne, ohne Fahne nach der Tabelle unten'],
              ['Welche Waren', 'Alle, die der Beruf abbaut', 'Nur die, die das Gebäude lagert'],
              ['Wohin die Ladung geht', 'Haufen am Boden bei der Fahne', 'Ins Gebäude des Arbeiters'],
              ['Fahne entfernen', 'Geht nicht, nur versetzen', '„Fahne entfernen“'],
              [
                'Arbeitsplatz verloren',
                '-',
                'Abbauer, Fischer und Jäger arbeiten an ihrer Fahne weiter. Ohne Fahne bekommen sie eine neue vor die Füße. Der Träger verliert seine Fahne.',
              ],
            ],
          },
        },
        {
          h: 'Nach dem Entfernen der Fahne',
        },
        {
          table: {
            head: ['Wer', 'Ohne Fahne'],
            rows: [
              ['Abbauer', 'Ganze Wegweiser-Reichweite'],
              ['Träger', 'Lagerhaus: Haufen bis {{flag.radius}} Hexfelder ums Gebäude'],
              ['Jäger', 'Rund um den Arbeitsplatz'],
              ['Fischer', 'Sucht das Ufer von seinem Standort aus'],
            ],
            foot: 'Bereich mit Fahne: Tabelle „Arbeitsreichweite“ in [[article:hauling|Träger und Lager]].',
          },
        },
        {
          h: 'Haufen an der Fahne',
        },
        {
          list: [
            'Ware von der Fahne kommt nicht von selbst ins Lager. Dafür braucht es einen Träger mit Arbeitsplatz.',
            'Ein Lagerträger reicht bis {{flag.radius}} Hexfelder ums Gebäude. Weiter weg gib ihm eine eigene Fahne neben der des Abbauers.',
            'Ein Träger mit Fahne nimmt Haufen und fertige Produkte um sie herum und bringt sie in sein Gebäude.',
            'Das Versetzen der Fahne bewegt die Haufen nicht, sie bleiben liegen.',
          ],
        },
        {
          h: 'Knöpfe',
        },
        {
          table: {
            head: ['Knopf', 'Folge'],
            rows: [
              [
                '„Arbeitsfahne setzen“',
                'Setzt die Fahne an den gewählten Ort oder versetzt sie dorthin. Auf belegtem Hexfeld sucht sie Platz bis {{flag.snap}} Hexfelder, darüber hinaus verfällt der Befehl.',
              ],
              ['„Fahne entfernen“', 'Nur mit Arbeitsplatz, entfernt die Fahne'],
              ['„Zeige Arbeitsbereich“', 'Blendet den Kreis des Bereichs ein. Geht, wenn die Fahne steht.'],
              ['„Fahne anzeigen“', 'Zentriert die Ansicht auf die Fahne'],
            ],
            foot: 'Auch Ctrl und Rechtsklick versetzt die Fahne des gewählten Arbeiters.',
          },
        },
        {
          p: 'Ein Abbauer versetzt seine Fahne selbst, wenn der Schalter im [[article:assistant|Assistenten]] an ist: {{assistant.flagMin}}-{{assistant.flagMax}} Hexfelder vom Vorkommen, und ist der Bereich erschöpft, zum Vorkommen am nächsten am eigenen Gebäude. Fahnen von Jäger und Fischer bleiben stehen.',
        },
        {
          h: 'Fahne außerhalb der Wegweiser-Reichweite',
        },
        {
          p: 'Die Fahne darf außerhalb der Reichweite stehen. Der Arbeiter bekommt sofort den Status „Verirrt“ und bleibt stehen, bis das Netz dorthin reicht. Beim Jäger gilt das nicht: [[article:roads|Straßen und Wegweiser]].',
        },
      ],
      see: ['article:hauling', 'article:workshops', 'article:roads', 'article:assistant', 'job:collector'],
    },
    {
      id: 'roads',
      name: 'Straßen und Wegweiser',
      lead: 'Eine Straße kostet 1 Bruchstein und verkürzt den Schritt mit Schuhen auf Land von {{step.landBrief}} s auf {{step.road}} s.',
      blocks: [
        {
          h: 'Wegweiser',
        },
        {
          p: 'Wegweiser setzt der [[job:scout|Kundschafter]], ohne Material. Ein Wegweisernetz gehört einem Spieler.',
        },
        {
          figure: {
            id: 'reach',
            caption: 'Reichweite des Netzes',
          },
        },
        {
          table: {
            head: ['Reichweite, Hexfelder', 'Siedler', '[[job:carrier|Träger]]', 'Hinweise'],
            rows: [
              ['Gehen', '{{reach.walk}}', '{{reach.carrier}}', 'Ab seinem Standort'],
              [
                'Vom Siedler zum Wegweiser',
                'unter {{reach.walk}}',
                'unter {{reach.carrier}}',
                'Öffnet das ganze verbundene Netz',
              ],
              [
                'Vom Wegweiser zum Ziel',
                'unter {{reach.walk}}',
                'unter {{reach.carrier}}',
                'Ab jedem Wegweiser dieses Netzes',
              ],
              [
                'Verbindung zweier Wegweiser',
                'unter {{reach.link}}',
                'unter {{reach.link}}',
                'Weg zwischen ihnen bis {{reach.linkRoute}} Hexfelder',
              ],
              [
                'Abstand zum eigenen Wegweiser',
                'mindestens {{reach.spacing}}',
                'mindestens {{reach.spacing}}',
                'Näher geht nicht',
              ],
              [
                'Warensuche',
                'unter {{reach.goods}}',
                'unter {{reach.goods}}',
                'Auch ab Wegweisern in dieser Reichweite',
              ],
              [
                'Gebäude auf Wegweiser',
                '{{reach.displace}}',
                '{{reach.displace}}',
                'Der Wegweiser rückt beiseite, geht das nicht, ist er weg',
              ],
            ],
            num: [1, 2],
          },
        },
        {
          table: {
            head: ['Gelände', 'Warensuche, Hexfelder'],
            rows: [
              ['Straße, Land', 'unter {{reach.goods}}'],
              ['Sand', 'etwa {{reach.goodsSand}}'],
              ['Gebirge', 'etwa {{reach.goodsMountain}}'],
              ['Schnee', 'etwa {{reach.goodsSnow}}'],
            ],
            num: [1],
          },
        },
        {
          p: 'Die Reichweite gilt nicht für Kundschafter, Soldaten, Helden, [[job:hunter|Jäger]] und [[job:druid|Druiden]].',
        },
        {
          p: 'Ein Arbeiter, dessen Arbeitsplatz oder Arbeitsfahne außerhalb der Reichweite liegt, steht untätig herum, bis das Netz dorthin reicht. Getragene Ware bringt er trotzdem weg.',
        },
        {
          h: 'Wegweiser-Panel',
        },
        {
          table: {
            head: ['Element', 'Bedeutung'],
            rows: [
              [
                '„Waren im Wegweisernetz“',
                'Ware in Reichweite des ganzen verbundenen Netzes: Gebäude, Haufen, Karren, Hände. Jedes Stück zählt einmal.',
              ],
              ['„Wegweiser: N“', 'Zahl der verbundenen Wegweiser, dieser eingeschlossen'],
              ['„Abreißen“', 'Der Wegweiser verschwindet sofort, ohne Rückfrage und ohne Kundschafter'],
              ['Benachbarte Wegweiser', 'Verlieren die Verbindung zum abgerissenen'],
              ['Netz', 'Zerfällt in Teile, wenn der abgerissene Wegweiser das einzige Bindeglied war'],
              [
                'Arbeiter außerhalb der neuen Reichweite',
                'Status „Verirrt“, bleiben stehen, bis das Netz zurückkehrt',
              ],
            ],
            foot: 'Die Kartenansicht „Wegweiser“ zeigt die Netze.',
          },
        },
        {
          h: 'Straße',
        },
        {
          table: {
            head: ['Gelände unter der Straße', 'Schritt ohne Straße', 'Schritt auf Straße', 'Ersparnis'],
            rows: [
              ['Land', '{{step.land}} s', '{{step.road}} s', '{{step.roadSavedOnLandPct}}%'],
              ['Sand', '{{step.sand}} s', '{{step.road}} s', '{{step.roadSavedOnSandPct}}%'],
              ['Gebirge', '{{step.mountain}} s', '{{step.road}} s', '{{step.roadSavedOnMountainPct}}%'],
              ['Schnee', '{{step.snow}} s', '{{step.road}} s', '{{step.roadSavedOnSnowPct}}%'],
            ],
            num: [1, 2, 3],
            foot: 'Siedler mit Schuhen, ohne Last. Auf der Straße nutzen sich Schuhe {{shoes.roadWear}} Mal langsamer ab als auf Land.',
          },
        },
        {
          list: [
            'Ein Straßenstück kostet 1 [[good:stone|Bruchstein]] und 1 Schlag des [[job:builder|Bauarbeiters]], nach Gebäuden und Palisaden.',
            'Der Bruchstein pflastert auch bis zu 6 Nachbarstücke, zu denen niemand unterwegs ist und auf denen kein Stein liegt.',
            'Aufgehobenes Straßenstück: Gelieferter Bruchstein landet daneben.',
            'Ausbau eines Gebäudes auf der Straße: Die Straße verschwindet, der Bruchstein kommt nicht zurück.',
            'Siedler nehmen die Straße von selbst, wenn es sich lohnt.',
          ],
        },
      ],
      see: [
        'article:walking',
        'article:hauling',
        'article:work-flag',
        'article:construction',
        'job:scout',
        'good:stone',
      ],
    },
    {
      id: 'walking',
      name: 'Gehtempo',
      lead: 'Ein Schritt auf Land dauert {{step.landBrief}} s mit Schuhen und {{step.landBare}} s barfuß.',
      blocks: [
        {
          h: 'Schritt je Gelände',
        },
        {
          table: {
            head: ['Gelände', 'Mit Schuhen', 'Barfuß', 'Schritte je Paar Schuhe'],
            rows: [
              ['Straße, Pflaster', '{{step.road}} s', '{{step.roadBare}} s', '{{shoes.road}}'],
              ['Land', '{{step.land}} s', '{{step.landBare}} s', '{{shoes.land}}'],
              ['Sand, Strand, Steinwüste', '{{step.sand}} s', '{{step.sandBare}} s', '{{shoes.sand}}'],
              ['Gebirge', '{{step.mountain}} s', '{{step.mountainBare}} s', '{{shoes.mountain}}'],
              ['Schnee', '{{step.snow}} s', '{{step.snowBare}} s', '{{shoes.snow}}'],
            ],
            num: [1, 2, 3],
            foot: 'Mit Last in den Händen nutzen sich Schuhe {{shoes.carryWear}} Mal schneller ab. Energie je Barfußschritt: [[article:needs|Bedürfnisse]].',
          },
        },
        {
          h: 'Was den Schritt ändert',
        },
        {
          table: {
            head: ['Zustand', 'Änderung'],
            rows: [
              ['Last in den Händen', '+{{step.carryExtra}} s'],
              ['Kondition bis {{need.drivePct}}%', '+{{step.tiredExtra}} s'],
              ['Kind', '+{{step.childExtra}} s'],
              ['Baby', 'Schritt × 2'],
              ['Gewicht von Waffe und Rüstung 2-3, außer Helden', '+{{step.weightLowExtra}} s'],
              ['Gewicht von Waffe und Rüstung 4-5, außer Helden', '+{{step.weightHighExtra}} s'],
              ['[[good:amulet_speed|Windamulett]]', '-{{step.amuletSaved}} s'],
              ['Voller [[good:handcart|Handkarren]]', '{{haul.handcartLossPct}}% langsamer'],
              ['Voller [[good:oxcart|Ochsenkarren]]', '{{haul.oxcartLossPct}}% langsamer'],
            ],
            foot: 'Der schnellste Schritt dauert {{step.shortest}} s. Die Bremse durch Karren wächst mit der Ladung.',
          },
        },
        {
          h: 'Gewicht von Waffe und Rüstung',
        },
        {
          table: {
            head: ['Waffe', 'Gewicht'],
            rows: [
              ['[[good:sword_shord|Kurzschwert]], [[good:bow_short|Kurzbogen]]', '{{weight.shortSword}}'],
              ['[[good:spear_wooden|Holzspeer]], [[good:bow_long|Langbogen]]', '{{weight.woodenSpear}}'],
              ['[[good:spear_iron|Eisenspeer]], [[good:sword_long|Langschwert]]', '{{weight.ironSpear}}'],
            ],
            num: [1],
            foot: 'Bei allen Stämmen gleich. Das Waffengewicht kommt zum Rüstungsgewicht aus der Tabelle unten hinzu.',
          },
        },
        {
          data: 'armour',
        },
        {
          h: 'Beispiele',
        },
        {
          table: {
            head: ['Wer', 'Gelände', 'Schritt'],
            rows: [
              ['Träger, mit Schuhen, mit Ware', 'Straße', '{{step.carrierOnRoad}} s'],
              ['Soldat, Langschwert, Plattenrüstung, mit Schuhen', 'Land', '{{step.plateSoldierOnLand}} s'],
              ['Händler, mit Schuhen, voller Handkarren', 'Land', '{{step.traderFullCart}} s'],
            ],
            num: [2],
          },
        },
      ],
      see: ['good:shoes', 'good:amulet_speed', 'article:roads', 'article:needs', 'article:vehicles'],
    },
    {
      id: 'trade',
      name: 'Handel',
      lead: 'Ein Händler pendelt zwischen {{trade.stops}} Gebäuden und nimmt ohne Karren {{haul.carry}} Stück je Fahrt.',
      blocks: [
        {
          h: 'Womit er fährt',
        },
        {
          table: {
            head: ['Frachtraum', 'Stück aufheben'],
            rows: [
              ['Hände', '{{trade.handsSeconds}} s'],
              ['[[good:handcart|Handkarren]]', '{{trade.handcartSeconds}} s'],
              ['[[good:oxcart|Ochsenkarren]]', '{{trade.oxcartSeconds}} s'],
            ],
            num: [1],
            foot: 'Die Zeit zum Aufheben gilt auch fürs Entladen. Kapazität und Tempoverlust: [[article:hauling|Träger und Lager]].',
          },
        },
        {
          p: 'Bei 20-30 Hexfeldern pro Richtung bringen beide Karren gleich viel Ware in derselben Zeit. Auf kürzeren Strecken gewinnt der Handkarren, auf längeren der Ochsenkarren.',
        },
        {
          h: 'Route',
        },
        {
          list: [
            'Eine Route hat {{trade.stops}} fertige Gebäude. Eigene dürfen alle mit Vorrat sein, fremde höchstens 1.',
            'Wird ein Gebäude ausgebaut, wartet der [[job:trader|Händler]] das Ende ab.',
            'Aus einem Wohnhaus nimmt der Händler kein Essen.',
          ],
        },
        {
          h: 'Eigene Gebäude',
        },
        {
          table: {
            head: ['Einstellung', 'Folge'],
            rows: [
              ['Ware in Gebäude B markiert', 'Lädt in A, entlädt in B'],
              ['Ware in beiden Gebäuden markiert', 'Gleicht die Vorräte zwischen ihnen aus'],
              ['Kein Gebäude markiert etwas', 'Der Händler steht'],
              ['bis N', 'Stoppt die Lieferung, wenn das Zielgebäude samt Ladung N hat'],
              ['behalten N', 'Im Quellgebäude bleiben N Stück'],
              [
                'Siedlung',
                'Lädt aus dem ganzen Dorf: Lager, dann Lager und Werkstätten in Reichweite seines Wegweisernetzes',
              ],
            ],
            foot: 'A und B sind die beiden Gebäude der Route. Die Option Siedlung gilt nur für Lagerhaus oder Hauptquartier, an einem Halt der Route. Auch das Lagerminimum begrenzt das Laden.',
          },
        },
        {
          h: 'Handel mit dem Computer',
        },
        {
          list: [
            'Das fremde Gebäude gehört einem Computerspieler, ist fertig und hat ein von der Karte festgelegtes Angebot.',
            'Um es in die Route einzutragen, muss das Verhältnis beiderseits freundlich sein, für jede Fahrt nur beim Stamm des Händlers: [[article:diplomacy|Diplomatie]].',
            'Ein Angebot lautet N Stück einer Ware gegen M Stück einer anderen, die Zahlen legt die Karte fest. Eine Route handelt ein Angebot zur Zeit. Das Computerlager füllt sich alle {{trade.refillSeconds}} s auf {{trade.refillLevel}} Stück jeder Angebotsware auf.',
            'Der Händler nimmt so viele volle Chargen, wie in den Frachtraum passen, Platz für die Rückware eingerechnet. Bei kleinem Frachtraum verteilt sich eine Charge auf mehrere Fahrten.',
            'Er gibt die Charge ab, nimmt die Bezahlung und wiederholt das, solange er Ware hat. Ohne Bezahlung im Gebäude wartet er und gibt nichts ab. „behalten“ N lässt N Stück Verkaufsware im Gebäude. Rückgrenze N: Stopp, wenn das Gebäude N Stück Bezahlung hat.',
          ],
        },
      ],
      see: [
        'article:diplomacy',
        'article:vehicles',
        'article:hauling',
        'article:roads',
        'job:trader',
        'good:handcart',
      ],
    },
  ],
};
