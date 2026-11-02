import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: 'Wirtschaft',
  items: [
    {
      id: 'construction',
      name: 'Bau, Ausbau, Reparatur',
      lead: 'Allein die Arbeitsschläge an Wohnhaus 1 dauern für einen Bauarbeiter {{build.noviceSeconds}} s, mit Eisenwerkzeug {{build.noviceIronSeconds}} s. Das Tragen des Materials kommt noch dazu.',
      blocks: [
        {
          h: 'Wo du bauen kannst',
        },
        {
          table: {
            head: ['Was', 'Was passiert'],
            rows: [
              [
                'Gelände',
                'Du baust auf Land, Sand, Strand und Steinwüste. Gebirge, Schnee, Wasser und Sumpf scheiden aus.',
              ],
              [
                '[[building:work_well_00|Brunnen]], [[building:work_hive_00|Bienenstock]]',
                'Wenigstens der Rand des Gebäudes muss auf Gras stehen.',
              ],
              [
                'Platz',
                'Ein Gebäude reserviert sofort den Platz für seine höchste Stufe und einen schmalen Streifen darum. Diese Streifen zweier Gebäude dürfen sich nicht überlappen.',
              ],
              [
                'Baum, Fels, Lagerstätte, Palisade',
                'Blockieren. Sie müssen außerhalb des Platzes für die höchste Stufe stehen.',
              ],
              [
                'Feindlicher Soldat',
                'Du baust nicht bis {{contest.radius}} Hexfelder von ihm, schräg etwa {{contest.diagonal}}. Es zählt nur ein Soldat, den du siehst. Die Besatzung auf Turmposten zählt nicht.',
              ],
              [
                'Gebäude eines Spielers, mit dem Frieden herrscht',
                'Du baust nicht bis {{peace.keepOut}} Hexfelder von seinem Gebäude oder seiner Baustelle, außer dein eigenes Gebäude steht dort näher als seines.',
              ],
              ['Gelände unter Nebel', 'Blockiert. Der Platz muss gerade sichtbar sein.'],
              ['Siedler, Fahrzeug, Arbeitsfahne, Wegweiser, Haufen, Kadaver', 'Werden zur Seite gerückt.'],
              ['Strauch, Feld, Baumstumpf, offene Kiste', 'Verschwinden, wenn die Baustelle entsteht.'],
              ['Straßenbaustelle', 'Wird aufgehoben, gelieferter Bruchstein landet daneben.'],
              [
                'Straße, Palisade auf dem Platz für den Ausbau',
                'Die gezogene Linie umgeht diesen Platz. Standardmäßig legt sie die Taste G trotzdem dorthin, aber der Ausbau entfernt sie dann ohne Rückgabe.',
              ],
              ['Feindliche Zivilisten, Tiere', 'Stören nicht. Die Baustelle entsteht neben ihnen.'],
              ['Fertige Straße', 'Bleibt unter dem Gebäude.'],
              [
                'Wegweiser-Reichweite',
                'Gilt nicht. Die Baustelle entsteht auch außerhalb des Netzes, der Bauarbeiter kommt, sobald das Netz dorthin reicht.',
              ],
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
          h: 'Wie lange der Bau dauert',
        },
        {
          table: {
            head: ['[[building:home_level_00|Wohnhaus 1]], 1 Bauarbeiter', 'Arbeitsschläge', 'Dauer'],
            rows: [
              ['Ohne Erfahrung und Werkzeug', '{{build.noviceSwings}}', '{{build.noviceSeconds}} s'],
              [
                'Ohne Erfahrung, [[good:tool_iron|Eisenwerkzeug]]',
                '{{build.noviceIronSwings}}',
                '{{build.noviceIronSeconds}} s',
              ],
              [
                'Meister, [[good:tool_iron|Eisenwerkzeug]]',
                '{{build.masterIronSwings}}',
                '{{build.masterIronSeconds}} s',
              ],
            ],
            num: [1, 2],
            foot: 'Wohnhaus 1 kostet {{build.homeUnits}} Stück Baustoff. Reine Zeit der Arbeitsschläge, 1 Arbeitsschlag dauert {{build.swingSeconds}} s.',
          },
        },
        {
          table: {
            head: ['Erfahrung', 'Ohne Werkzeug', 'Holz', 'Eisen'],
            rows: [
              ['0-9%', '{{build.perUnit.0.bare}}', '{{build.perUnit.0.wooden}}', '{{build.perUnit.0.iron}}'],
              [
                '10-21%',
                '{{build.perUnit.10.bare}}',
                '{{build.perUnit.10.wooden}}',
                '{{build.perUnit.10.iron}}',
              ],
              [
                '22-49%',
                '{{build.perUnit.22.bare}}',
                '{{build.perUnit.22.wooden}}',
                '{{build.perUnit.22.iron}}',
              ],
              [
                '50-78%',
                '{{build.perUnit.50.bare}}',
                '{{build.perUnit.50.wooden}}',
                '{{build.perUnit.50.iron}}',
              ],
              [
                '79-89%',
                '{{build.perUnit.79.bare}}',
                '{{build.perUnit.79.wooden}}',
                '{{build.perUnit.79.iron}}',
              ],
              [
                '90-100%',
                '{{build.perUnit.90.bare}}',
                '{{build.perUnit.90.wooden}}',
                '{{build.perUnit.90.iron}}',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Arbeitsschläge je 1 Stück Baustoff. Ein [[job:builder|Bauarbeiter]] hat 100% nach {{exp.build.repeatsFull}} Arbeitsschlägen. Es zählen nur die, die etwas hinzugefügt haben.',
          },
        },
        {
          list: [
            'Ein Gebäude ohne Kosten braucht 1 Arbeitsschlag.',
            'Einen Palisadenabschnitt oder ein Straßenstück setzt 1 Bauarbeiter mit 1 Arbeitsschlag, wenn das Material da ist.',
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
          p: 'Ein Bauarbeiter, den der Spieler einer Baustelle zuweist, bleibt dort, auch wenn es anderswo Arbeit gibt.',
        },
        {
          h: 'Ausbau',
        },
        {
          list: [
            'Kostet das Material der angehobenen Stufen. Mehrere Stufen auf einmal gehen, wenn jede freigeschaltet ist.',
            'Waren aus den Kosten, die das Gebäude auf Vorrat hat, gehen sofort auf die Baustelle. Die übrigen Vorräte kehren nach dem Ausbau zurück.',
            'Arbeiter und Bewohner gehen hinaus, behalten ihren Platz und kehren nach dem Ausbau zurück.',
            'Während des Ausbaus steigt die Gesundheit nicht. Danach hat das Gebäude die volle Gesundheit der neuen Stufe.',
            'Mit dem Ausbau endet der Verteidigungsmodus.',
            'Ein Abbruch gibt die Vorräte und die daraus genommenen Waren zurück, geliefertes Material geht verloren.',
          ],
        },
        {
          h: 'Reparatur',
        },
        {
          table: {
            head: ['Ziel', 'Gesundheit je Arbeitsschlag', 'Bauarbeiter zugleich'],
            rows: [
              ['Gebäude', '{{repair.minPerSwing}}-{{repair.maxPerSwing}}', '{{repair.crew}}'],
              ['Palisadenabschnitt', '{{wall.segmentRepair}}', '{{repair.wallCrew}}'],
              ['Tor', '{{wall.gateRepair}}', '{{repair.wallCrew}}'],
            ],
            num: [1, 2],
            foot: 'Reparatur kostet kein Material. Bei Palisade und Tor ändern Erfahrung und Werkzeug nichts.',
          },
        },
        {
          list: [
            'Von selbst repariert ein Bauarbeiter {{repair.calmSeconds}} s lang nach dem letzten Treffer nicht, und auch nicht, solange bis {{alert.standTo}} Hexfelder entfernt gekämpft wird. Dein Befehl übergeht beides.',
            'Baustellen und Palisaden im Bau werden nicht repariert, ihre Gesundheit wächst mit dem Bau.',
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
              ['Abriss oder Zerstörung eines Gebäudes', 'Inhalt plus halbe Kosten, jede Ware aufgerundet'],
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
      lead: 'Der Zähler beim Produkt sagt, wie viele Chargen ein Arbeiter machen soll: 0 heißt Stopp, ∞ endlos. Eine Charge ist ein Durchlauf des Rezepts.',
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
            foot: 'Die Werkstatt zählt Chargen, der Abbauer Stücke. Erfahrung und Werkzeug bringen mehr Stücke je Charge: [[article:tools|Werkzeug]].',
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
                'Absolvent, den der Assistent zuweist, wenn die Schule in diesem Beruf mehrere Produkte lehrt',
                'In der Schule gelernte Produkte ∞, Rest 0',
              ],
              ['[[job:collector|Abbauer]]', 'Jede Ware ∞'],
            ],
          },
        },
        {
          h: 'Was mit den Zählern passiert',
        },
        {
          p: 'Sie verfallen beim Wechsel von Arbeitsplatz oder Beruf, auch nach dem Abriss des Gebäudes. Ein Ausbau lässt sie stehen, neue Produkte der höheren Stufe beginnen bei 0. Jeder Arbeiter hat eigene Zähler: 2 Leute in einer Werkstatt können 2 verschiedene Produkte herstellen.',
        },
        {
          h: 'Mehrere Produkte zugleich',
        },
        {
          p: 'Der Arbeiter macht Produkte mit Zähler über 0 abwechselnd, je 1 Charge, in der Reihenfolge im Panel.',
        },
        {
          table: {
            head: ['Situation', 'Folge'],
            rows: [
              [
                'Regal des Produkts voll',
                'Der Arbeiter nimmt das nächste Produkt. Laufende Chargen zählen als belegter Platz.',
              ],
              ['Keine Zutat im Gebäude', 'Der Arbeiter nimmt das nächste Produkt'],
              [
                'Nur ein Teil der Zutat im Gebäude',
                'Wartet auf den Rest. Gibt es den Rest nirgends, nimmt er das nächste Produkt.',
              ],
              ['Produkt ohne nötige Erfahrung', 'Hinweis „gesperrt“ statt Zähler, wird übergangen'],
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
            'Ein Fahrzeug entsteht außerhalb der Werkstatt: Der Handwerker legt daneben eine Baustelle an, trägt selbst das Material und baut.',
            'Der Fahrzeugzähler sinkt, wenn das Fahrzeug fertig ist, nicht beim Start.',
            'Ist neben der Werkstatt kein Platz für die Baustelle, nimmt der Arbeiter das nächste Produkt.',
          ],
        },
        {
          h: 'Abbauer',
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
              [
                'Zähler auf 0, aber die Ware liegt da',
                'Der Zähler gilt nur für den Abbau. Stämme und Haufen trägt der Abbauer weiter.',
              ],
            ],
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
      lead: 'Ein Baum gibt {{gather.treeYield}} Stück Holz nach {{gather.strokes}} Arbeitsschlägen. Ein Fels braucht dieselben Arbeitsschläge für 1 Stück, Holz geht also etwa {{gather.treeYield}} Mal schneller.',
      blocks: [
        {
          h: 'Was ein Vorkommen liefert',
        },
        {
          table: {
            head: ['Vorkommen', 'Wer', 'Liefert', 'Arbeitsschläge ohne Erfahrung', 'Dauer', 'Werkzeug'],
            rows: [
              [
                'Baum',
                '[[job:collector|Abbauer]]',
                '{{gather.treeYield}} [[good:wood|Holz]]',
                '{{gather.strokes}} je Baum',
                '{{gather.treeSeconds}} s',
                'ja',
              ],
              [
                'Fels',
                '[[job:collector|Abbauer]]',
                '4-5 [[good:stone|Bruchstein]]',
                '{{gather.strokes}} je Stück',
                '{{gather.stoneSeconds}} s',
                'ja',
              ],
              [
                'Lagerstätte',
                '[[job:collector|Abbauer]]',
                '5 [[good:mud|Lehm]], [[good:iron|Eisen]] oder [[good:gold|Gold]]',
                '{{gather.strokes}} je Stück',
                '{{gather.oreSeconds}} s',
                'ja',
              ],
              [
                'Pilz',
                '[[job:collector|Abbauer]]',
                '1 [[good:mushroom|Pilz]]',
                '1 Aufheben',
                '{{gather.mushroomSeconds}} s',
                'nein',
              ],
              [
                'Getreidefeld',
                '[[job:farmer|Farmer]]',
                '1 [[good:wheat|Weizen]]',
                '{{gather.wheatStrokes}} je Feld',
                '{{gather.wheatSeconds}} s',
                'ja',
              ],
              [
                'Kräuterfeld',
                '[[job:herb_mush_guy|Kräutergärtner]]',
                '1 [[good:herb|Kraut]]',
                '{{gather.herbStrokes}} je Feld',
                '{{gather.herbSeconds}} s',
                'ja',
              ],
              [
                'Fischschwarm',
                '[[job:fisher|Fischer]]',
                '1 [[good:fish|Fisch]]',
                '{{gather.casts}} Würfe',
                '{{gather.fishSeconds}} s',
                'ja',
              ],
            ],
            foot: 'Reine Arbeitszeit, ohne Erfahrung und Werkzeug, ohne Laufwege.',
          },
        },
        {
          list: [
            'Ein gefällter Baum liegt als Stamm mit {{gather.treeYield}} Stück da. Der Abbauer trägt sie einzeln weg.',
            'Ein Stück aus Fels oder Lagerstätte fällt daneben zu Boden.',
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
            foot: 'Jeder Siedler muss die Bedingung selbst erfüllen, getrennt für [[good:iron|Eisen]] und [[good:gold|Gold]]. Bis dahin zeigt das Panel „gesperrt“.',
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
          p: 'Ein Feld wächst nur durch Gießen, Zeit spielt keine Rolle. Jedes Gießen bringt 1 Stufe für dieses Feld und 6 Nachbarfelder, ein Feld braucht also höchstens {{field.waterings}} Mal Gießen. Nach der Ernte liegt 1 Stück da, und der Platz ist wieder frei für neue Saat.',
        },
        {
          p: 'Säen und Gießen kosten nichts, Wasser ist nicht nötig.',
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
            foot: 'Schräg beträgt der Radius etwa {{field.diagonal}} Hexfelder. Die Feldgrenze gilt fürs Gebäude, nicht für den Arbeiter. Mehr Leute ernten schneller.',
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
          p: 'Auf Sand und auf der Straße kannst du nicht säen. Wilde Felder der Karte im Radius des Gebäudes zählen zu seiner Grenze.',
        },
        {
          p: 'Ein Feld, das {{field.reclaimSeconds}} s lang von der Tür seines Gebäudes abgeschnitten ist, verschwindet und gibt seinen Platz in der Grenze frei.',
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
      lead: 'Werkzeug spart Arbeitsschläge, bringt in der Werkstatt mehr Stücke und hält {{tool.uses}} Einsätze.',
      blocks: [
        {
          h: 'Woher ein Siedler Werkzeug bekommt',
        },
        {
          p: 'Werkzeug verteilt der [[article:assistant|Assistent]], der von Anfang an an ist, oder dein Befehl. Ein Siedler holt es nur aus dem Lager, wenn sein Werkzeugplatz leer ist, Eisen vor Holz. Besseres holt er nicht von selbst.',
        },
        {
          h: 'Wer es nutzt',
        },
        {
          table: {
            head: ['Wer', 'Was er gewinnt'],
            rows: [
              ['Handwerker in der Werkstatt', 'Mehr Stücke je Charge'],
              ['[[job:collector|Abbauer]]', 'Weniger Arbeitsschläge, außer bei Pilzen'],
              [
                '[[job:farmer|Farmer]], [[job:herb_mush_guy|Kräutergärtner]]',
                'Weniger Arbeitsschläge bei der Ernte',
              ],
              ['[[job:fisher|Fischer]]', 'Weniger Würfe'],
              ['[[job:builder|Bauarbeiter]]', 'Weniger Arbeitsschläge je Stück Baustoff'],
              ['[[job:hunter|Jäger]], [[job:carrier|Träger]]', 'Nichts'],
              ['Soldaten, Helden', 'Tragen kein Werkzeug'],
            ],
          },
        },
        {
          h: 'Arbeitsschläge beim Abbau',
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
            foot: 'Baum, Fels, Lagerstätte, Kräuterfeld.',
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
            foot: 'Würfe je 1 Fisch.',
          },
        },
        {
          p: 'Ein Feld [[good:wheat|Weizen]] zu ernten kostet ohne Werkzeug {{gather.wheatStrokes}} Arbeitsschläge, mit Werkzeug oder ab 20% Erfahrung 1.',
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
            foot: 'Für ein Rezept mit 1 Stück, bei einem Rezept mit 2 Stück verdoppelt sich der Bonus. Zutaten und Dauer ändern sich nicht. Erfahrung wirkt auch beim Schlachten.',
          },
        },
        {
          p: 'Bruchteile sammeln sich in der Werkstatt. Ein volles Stück kommt in den Vorrat, auch über die Kapazität hinaus.',
        },
        {
          h: 'Verschleiß',
        },
        {
          table: {
            head: ['Arbeit', 'Werkzeugeinsatz'],
            rows: [
              ['Charge in der Werkstatt', '1 je fertige Charge'],
              ['Arbeitsschlag beim Abbau', '1 je Arbeitsschlag, auch ohne Wirkung'],
              ['Angelwurf', '1 je Wurf, auch ohne Fang'],
              [
                'Arbeitsschlag des Bauarbeiters',
                '1 je Arbeitsschlag, auch bei Reparatur und wenn er nichts hinzufügt',
              ],
              ['Gießen', '1 je Gießen'],
              ['Säen, Pilze aufheben', '0'],
            ],
            foot: 'Nach {{tool.uses}} Einsätzen ist das Werkzeug weg, und der Siedler arbeitet mit bloßen Händen, bis er neues bekommt. Eisenwerkzeug reicht einem Siedler ohne Erfahrung für {{tool.ironTrees}} Bäume.',
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
      lead: 'Ein Träger ohne Karren trägt {{haul.carry}} Stück. An einer Stelle am Boden liegen bis zu {{haul.groundStack}} Stück einer Ware.',
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
          h: 'Vorrang',
        },
        {
          p: 'Vorrang stellst du in einem Gebäude ein: Lagerhaus, Hauptquartier, Kaserne oder Turm. Seine Träger holen die Ware aus anderen Lagern, Werkstätten und Haufen, solange Platz ist.',
        },
        {
          h: 'Minimum',
        },
        {
          p: 'Das Minimum zählt alle Lagerhäuser und das Hauptquartier zusammen, bis {{haul.minimumMax}} Stück einer Ware. Solange die Summe darunter liegt, holen die Träger von Lagerhäusern, Hauptquartier, Brunnen und Bienenstöcken die Ware aus Werkstätten, Brunnen, Bienenstöcken und Haufen, und niemand nimmt sie aus dem Lager.',
        },
        {
          p: 'Das gilt auch fürs Essen: Liegt alles Essen innerhalb des Minimums, isst niemand aus dem Lager. Ein Lager gibt einem Lager mit Vorrang nur Ware über dem Minimum ab.',
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
            head: ['Träger', 'Stück je Fahrt', 'Langsamer, wenn voll'],
            rows: [
              ['Ohne Karren', '{{haul.carry}}', '-'],
              ['Mit [[good:handcart|Handkarren]]', '{{haul.handcart}}', '{{haul.handcartLossPct}}%'],
              ['Mit [[good:oxcart|Ochsenkarren]]', '{{haul.oxcart}}', '{{haul.oxcartLossPct}}%'],
            ],
            num: [1, 2],
            foot: 'Je kleiner die Ladung, desto weniger bremst sie. Die Karren des [[job:trader|Händlers]] haben dieselben Werte.',
          },
        },
        {
          list: [
            'Einen Karren nehmen nur Träger mit Arbeitsplatz und [[job:trader|Händler]]. Der Träger behält seinen Arbeitsplatz.',
            'Der Karren muss dir gehören und frei sein: ohne Besatzung, ohne anderen Kommandanten, auf derselben Landmasse.',
            'Ist auf dem Karren noch Platz, nimmt ein Lagerträger dieselbe Ware von Haufen und aus Werkstätten bis {{haul.cartTopUp}} Hexfelder um sich mit und fährt dann zurück.',
            'Verliert er den Arbeitsplatz, bleibt der Karren stehen.',
          ],
        },
        {
          h: 'Haufen am Boden',
        },
        {
          list: [
            'Ein Haufen gehört niemandem, jeder darf ihn nehmen.',
            'Ein Träger ohne Arbeitsfahne sammelt bis {{flag.radius}} Hexfelder um sein Gebäude auf, mit Fahne bis {{flag.radius}} Hexfelder um die Fahne.',
          ],
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
      lead: 'Die Arbeitsfahne (auf den Knöpfen auch kurz Fahne) legt den Arbeitsbereich fest und lagert nichts. Ein Abbauer ohne Arbeitsplatz lässt die Ware am Boden liegen.',
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
          },
        },
        {
          h: 'Arbeitsbereich',
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
            foot: 'In Hexfeldern. Ein Beruf, der von Wegweisern abhängt, arbeitet nur in ihrer Reichweite.',
          },
        },
        {
          p: 'Keine Arbeitsfahne nehmen die Träger von Farm, Kräuterhütte, Brunnen, Bienenstock, Turm und Kaserne an.',
        },
        {
          h: 'Haufen an der Fahne',
        },
        {
          list: [
            'Einen Haufen an der Fahne holt nur ein Träger mit Arbeitsplatz ab.',
            'Weiter als {{flag.radius}} Hexfelder vom Lager gib dem Träger eine eigene Fahne neben der des Abbauers.',
            'Ein Träger mit Fahne nimmt Haufen und fertige Produkte um sie herum und bringt sie in sein Gebäude.',
            'Das Versetzen der Fahne bewegt die Haufen nicht.',
          ],
        },
        {
          h: 'Fahne setzen',
        },
        {
          p: '„Arbeitsfahne setzen“ stellt die Fahne an den gewählten Ort oder versetzt sie dorthin. Ist der Ort belegt, sucht sie bis {{flag.snap}} Hexfelder weit einen freien, sonst verfällt der Befehl. Dasselbe macht Ctrl und Rechtsklick.',
        },
        {
          p: 'Mit dem Schalter im [[article:assistant|Assistenten]] versetzt ein Abbauer seine Fahne selbst: Er setzt sie {{assistant.flagMin}}-{{assistant.flagMax}} Hexfelder vom Vorkommen. Ist der Bereich erschöpft, geht er zum Vorkommen, das seinem Gebäude am nächsten liegt. Für Jäger und Fischer gilt das nicht.',
        },
        {
          p: 'Du darfst die Fahne außerhalb der Reichweite setzen, aber der Arbeiter steht dann, bis das Netz dorthin reicht: [[article:roads|Straßen und Wegweiser]].',
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
          p: 'Wegweiser setzt der [[job:scout|Kundschafter]], ohne Material.',
        },
        {
          figure: {
            id: 'reach',
            caption: 'Reichweite des Netzes',
          },
        },
        {
          p: 'Ein Siedler geht von selbst zu einem Ziel bis {{reach.walk}} Hexfelder weit, ein [[job:carrier|Träger]] bis {{reach.carrier}}. Weiter führt ein Wegweiser: Steht er näher als diese Reichweite, öffnet er das ganze verbundene Netz, und das Ziel muss in derselben Reichweite von einem Wegweiser dieses Netzes liegen.',
        },
        {
          list: [
            'Zwei Wegweiser verbinden sich näher als {{reach.link}} Hexfelder, der Weg zwischen ihnen darf bis {{reach.linkRoute}} Hexfelder lang sein.',
            'Ein eigener Wegweiser steht mindestens {{reach.spacing}} Hexfelder vom nächsten entfernt.',
            'Ware sucht ein Siedler näher als {{reach.goods}} Hexfelder, auch ab Wegweisern in dieser Reichweite.',
            'Ein Gebäude auf einem Wegweiser rückt ihn bis {{reach.displace}} Hexfelder beiseite, weiter nicht, dann ist er weg.',
          ],
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
            foot: 'Je schlechter das Gelände, desto näher sucht ein Siedler Ware.',
          },
        },
        {
          p: 'Die Reichweite gilt nicht für Kundschafter, Soldaten, Helden, [[job:hunter|Jäger]] und [[job:druid|Druiden]].',
        },
        {
          p: 'Liegt der Arbeitsplatz oder die Fahne eines Arbeiters außerhalb der Reichweite, bekommt er den Status „Verirrt“ und steht, bis das Netz dorthin reicht. Getragene Ware bringt er noch weg.',
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
              [
                '„Abreißen“',
                'Der Wegweiser verschwindet sofort, ohne Rückfrage und ohne Kundschafter. War er das einzige Bindeglied, zerfällt das Netz in Teile.',
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
            'Ein Straßenstück kostet 1 [[good:stone|Bruchstein]] und 1 Arbeitsschlag des [[job:builder|Bauarbeiters]].',
            'Derselbe Bruchstein pflastert auch bis zu 6 Nachbarstücke, wenn kein Bauarbeiter sie übernommen hat und kein Bruchstein darauf liegt.',
            'Aufgehobenes Straßenstück: Gelieferter Bruchstein landet daneben.',
            'Siedler nehmen die Straße von selbst, wenn sie so schneller ankommen.',
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
              ['Waffe und Rüstung wiegen zusammen 2-3', '+{{step.weightLowExtra}} s'],
              ['Waffe und Rüstung wiegen zusammen 4-5', '+{{step.weightHighExtra}} s'],
              ['[[good:amulet_speed|Windamulett]]', '-{{step.amuletSaved}} s'],
              ['Voller [[good:handcart|Handkarren]]', '{{haul.handcartLossPct}}% langsamer'],
              ['Voller [[good:oxcart|Ochsenkarren]]', '{{haul.oxcartLossPct}}% langsamer'],
            ],
            foot: 'Der schnellste Schritt dauert {{step.shortest}} s. Je kleiner die Ladung, desto weniger bremst der Karren. Helden bremst das Gewicht nicht.',
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
            head: ['Womit er fährt', 'Laden oder Entladen je Stück'],
            rows: [
              ['Hände', '{{trade.handsSeconds}} s'],
              ['[[good:handcart|Handkarren]]', '{{trade.handcartSeconds}} s'],
              ['[[good:oxcart|Ochsenkarren]]', '{{trade.oxcartSeconds}} s'],
            ],
            num: [1],
            foot: 'Kapazität und Tempoverlust: [[article:hauling|Träger und Lager]].',
          },
        },
        {
          p: 'Mit Schuhen, wenn der Karren voll hinfährt und leer zurück, bringen beide Karren gleich viel auf einer Strecke von etwa {{trade.cartParLand}} Hexfeldern über Land oder {{trade.cartParRoad}} Hexfeldern auf der Straße. Auf kürzeren gewinnt der Handkarren, auf längeren der Ochsenkarren.',
        },
        {
          h: 'Route',
        },
        {
          list: [
            'Eine Route verbindet {{trade.stops}} fertige Gebäude mit Vorräten. Fremd darf höchstens 1 sein.',
            'Wird ein Gebäude ausgebaut, wartet der [[job:trader|Händler]] das Ende ab.',
            'Aus einem Wohnhaus nimmt der Händler kein Essen.',
          ],
        },
        {
          h: 'Eigene Gebäude',
        },
        {
          p: 'A und B sind die beiden Gebäude der Route.',
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
                'Lädt aus dem ganzen Dorf: erst aus diesem Lager, dann aus Lagern und Werkstätten in seinem Wegweisernetz',
              ],
            ],
            foot: 'Die Option Siedlung gilt nur für Lagerhaus oder Hauptquartier, nur an einem der beiden Gebäude. Auch das Lagerminimum begrenzt das Laden.',
          },
        },
        {
          h: 'Handel mit dem Computer',
        },
        {
          list: [
            'Handeln kannst du nur mit einem fertigen Gebäude eines Computerspielers, das ein Angebot von der Karte hat.',
            'Um das Gebäude in die Route einzutragen, müssen beide Seiten freundlich sein. Danach reicht es, wenn der Stamm des Händlers freundlich ist: [[article:diplomacy|Diplomatie]].',
            'Ein Angebot lautet N Stück einer Ware gegen M Stück einer anderen, die Zahlen legt die Karte fest. Eine Route handelt ein Angebot zur Zeit.',
            'Alle {{trade.refillSeconds}} s füllt sich das Computerlager auf {{trade.refillLevel}} Stück jeder Angebotsware auf.',
            'Der Händler lädt so viele volle Tausche, wie auf den Karren passen, Platz für die Bezahlung eingerechnet. Auf einem kleinen Karren verteilt sich ein Tausch auf mehrere Fahrten.',
            'Er gibt die Ware ab, nimmt die Bezahlung und wiederholt das, solange er Ware hat. Ohne Bezahlung im Gebäude wartet er und gibt nichts ab.',
            '„behalten N“ lässt N Stück Verkaufsware im Gebäude. Rückgrenze N: Der Händler hört auf, wenn das Gebäude N Stück Bezahlung hat.',
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
