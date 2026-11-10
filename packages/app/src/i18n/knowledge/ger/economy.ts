import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: 'Wirtschaft',
  items: [
    {
      id: 'construction',
      name: 'Bau, Ausbau, Reparatur',
      lead: 'Ein Bauarbeiter baut Wohnhaus 1 in {{build.noviceSeconds}} s, mit Eisenwerkzeug in {{build.noviceIronSeconds}} s. Das Tragen des Materials kommt noch dazu.',
      blocks: [
        {
          h: 'Wo du bauen kannst',
        },
        {
          table: {
            head: ['Was', 'Regel'],
            rows: [
              [
                'Gelände',
                'Du baust auf Land, Sand, Strand und Steinwüste. Auf Gebirge, Schnee, Wasser und Sumpf geht es nicht.',
              ],
              [
                '[[building:work_well_00|Brunnen]], [[building:work_hive_00|Bienenstock]]',
                'Wenigstens der Rand des Gebäudes muss auf Gras stehen.',
              ],
              [
                'Platz',
                'Ein Gebäude belegt sofort den Platz, den seine höchste Stufe braucht, und einen schmalen Streifen darum. Die Streifen zweier Gebäude dürfen sich nicht überlappen.',
              ],
              [
                'Baum, Fels, Lagerstätte, Palisade',
                'Sie müssen außerhalb des Platzes für die höchste Stufe des Gebäudes stehen.',
              ],
              [
                'Feindlicher Soldat',
                'Im Umkreis von {{contest.radius}} Hexfeldern um ihn baust du nicht, schräg etwa {{contest.diagonal}}. Es zählen nur Soldaten, die du siehst, die Turmbesatzung nicht.',
              ],
              [
                'Gebäude eines Spielers, mit dem du Frieden hast',
                'Im Umkreis von {{peace.keepOut}} Hexfeldern um sein Gebäude oder seine Baustelle baust du nicht, außer dein eigenes Gebäude steht dort näher als seines.',
              ],
              ['Gelände unter Nebel', 'Dort baust du nicht. Der Platz muss gerade sichtbar sein.'],
              [
                'Wegweiser-Reichweite',
                'Spielt keine Rolle. Du kannst die Baustelle auch außerhalb des Netzes setzen, aber der Bauarbeiter kommt erst, wenn das Netz dorthin reicht.',
              ],
            ],
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
            foot: 'Wohnhaus 1 kostet {{build.homeUnits}} Stück Baustoff. Gezählt wird nur die Zeit der Arbeitsschläge, 1 Arbeitsschlag dauert {{build.swingSeconds}} s.',
          },
        },
        {
          h: 'Arbeitsschläge je 1 Stück Baustoff',
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
            foot: 'Erfahrung bekommt ein [[job:builder|Bauarbeiter]] nur für Arbeitsschläge, die den Bau vorangebracht haben: [[article:exp-work|Arbeitserfahrung]].',
          },
        },
        {
          p: 'Das Material bringen Bauarbeiter und der Baustelle zugewiesene Arbeiter hin, je 1 Stück.',
        },
        {
          h: 'Was ein Bauarbeiter zuerst tut',
        },
        {
          p: 'Ein Bauarbeiter repariert zuerst, baut dann Gebäude und lässt Palisaden und Straßen für den Schluss. Weist du ihn einer Baustelle zu, bleibt er dort, auch wenn anderswo Arbeit wartet.',
        },
        {
          h: 'Ausbau',
        },
        {
          list: [
            'Kostet das Material der neuen Stufen. Du kannst mehrere Stufen auf einmal überspringen, wenn alle freigeschaltet sind.',
            'Waren, die der Ausbau braucht und die das Gebäude schon auf Vorrat hat, gehen sofort in den Bau.',
            'Arbeiter und Bewohner gehen während des Ausbaus hinaus und kehren danach auf ihre Plätze zurück.',
            'Nach dem Ausbau hat das Gebäude die volle Gesundheit der neuen Stufe.',
            'Brichst du den Ausbau ab, bekommt das Gebäude seine Vorräte zurück, aber geliefertes Material geht verloren.',
          ],
        },
        {
          h: 'Reparatur',
        },
        {
          p: 'Ein Bauarbeiter gibt einem Gebäude {{repair.minPerSwing}}-{{repair.maxPerSwing}} Gesundheit je Arbeitsschlag zurück, an einem Gebäude reparieren höchstens {{repair.crew}} Bauarbeiter zugleich. Reparatur kostet kein Material. Palisade und Tor werden anders repariert, Erfahrung und Werkzeug ändern dort nichts: [[article:walls|Palisaden und Tore]].',
        },
        {
          p: 'Von selbst repariert ein Bauarbeiter {{repair.calmSeconds}} s lang nach dem letzten Treffer nicht, und auch nicht, solange im Umkreis von {{alert.standTo}} Hexfeldern gekämpft wird. Auf deinen Befehl geht er sofort.',
        },
        {
          h: 'Was verloren geht und was zurückkommt',
        },
        {
          table: {
            head: ['Situation', 'Was bleibt'],
            rows: [
              ['Abriss einer Baustelle', 'Geliefertes Material bleibt am Boden'],
              ['Abriss oder Zerstörung eines Gebäudes', 'Inhalt plus halbe Kosten, aufgerundet'],
            ],
            foot: 'Die Waren landen bis zu {{reach.spill}} Hexfelder vom Gebäude entfernt am Boden. Was nicht passt, geht verloren.',
          },
        },
      ],
      see: ['article:tools', 'article:walls', 'article:roads', 'article:exp-work', 'job:builder'],
    },
    {
      id: 'workshops',
      name: 'Werkstätten und Produktwahl',
      lead: 'Der Zähler beim Produkt sagt, wie viele Chargen ein Arbeiter macht: 0 heißt Stopp, ∞ endlos. Eine Charge ist ein Durchlauf des Rezepts.',
      blocks: [
        {
          h: 'Zählerwerte',
        },
        {
          table: {
            head: ['Zähler', 'Werkstatt', 'Abbauer'],
            rows: [
              ['0', 'Stellt dieses Produkt nicht her', 'Baut diese Ware nicht ab'],
              [
                '1-{{workshop.counterMax}}',
                'So viele Chargen, der Zähler sinkt beim Start jeder Charge um 1',
                'So viele Stück, der Zähler sinkt je gewonnenes Stück um 1',
              ],
              ['∞', 'Endlos, Zähler sinkt nicht', 'Endlos, Zähler sinkt nicht'],
            ],
            foot: 'Erfahrung und Werkzeug bringen mehr Stücke je Charge: [[article:tools|Werkzeug]].',
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
                'Schaltet diese Ware zwischen 0 und ∞ um, Rest bleibt',
              ],
              ['Weniger', '-1. Springt von 0 auf ∞, von ∞ auf {{workshop.counterMax}}', '-10', 'Auf 0'],
              ['Mehr', '+1. Springt von {{workshop.counterMax}} auf ∞, von ∞ auf 0', '+10', 'Auf ∞'],
            ],
          },
        },
        {
          h: 'Was mit den Zählern passiert',
        },
        {
          p: 'Jeder Arbeiter hat eigene Zähler, also können 2 Leute in einer Werkstatt 2 verschiedene Produkte herstellen. Die Zähler verfallen, wenn ein Arbeiter Arbeitsplatz oder Beruf wechselt, auch nach dem Abriss des Gebäudes. Ein Ausbau lässt sie stehen, Produkte der neuen Stufe beginnen bei 0.',
        },
        {
          h: 'Mehrere Produkte zugleich',
        },
        {
          p: 'Der Arbeiter macht alle Produkte mit Zähler über 0 abwechselnd, je 1 Charge, in der Reihenfolge im Panel.',
        },
        {
          table: {
            head: ['Wann', 'Was der Arbeiter tut'],
            rows: [
              ['Das Regal des Produkts ist voll', 'Nimmt das nächste Produkt'],
              ['Eine Zutat fehlt', 'Nimmt das nächste Produkt'],
              [
                'Nur ein Teil der Zutaten ist da',
                'Wartet auf den Rest. Gibt es ihn nirgends, nimmt er das nächste Produkt.',
              ],
              [
                'Zu wenig Erfahrung für ein Produkt',
                'Das Panel zeigt „gesperrt“ statt des Zählers, und der Arbeiter übergeht dieses Produkt',
              ],
              [
                'Alle Produkte mit Zähler sind gesperrt',
                'Macht, was er schon kann, auch Produkte mit Zähler 0',
              ],
            ],
          },
        },
        {
          h: 'Fahrzeuge',
        },
        {
          p: 'Ein Fahrzeug entsteht nicht in der Werkstatt. Der Handwerker legt daneben eine Baustelle an, trägt selbst das Material hin und baut. Ist neben der Werkstatt kein Platz für die Baustelle, nimmt er das nächste Produkt.',
        },
        {
          h: 'Abbauer',
        },
        {
          table: {
            head: ['Situation', 'Folge'],
            rows: [
              ['„Nur diese Ware“', 'Diese Ware ∞, Rest 0'],
              [
                'Rechtsklick auf Vorkommen',
                'Befehl „Sammeln“: diese Ware ∞, Rest 0. Die Arbeitsfahne bleibt, wo sie ist.',
              ],
              ['Ctrl und Rechtsklick auf Vorkommen', 'Dasselbe, aber die Fahne wandert auf das Vorkommen'],
              ['Alle Zähler auf 0', 'Der Abbauer hat den Status „Alles auf 0 gestellt“ und baut nichts ab'],
              [
                'Die Ware liegt schon am Boden',
                'Der Zähler gilt nur für den Abbau. Stämme und Haufen trägt der Abbauer weiter, auch bei 0.',
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
      lead: 'Ein Baum gibt {{gather.treeYield}} Stück Holz nach {{gather.strokes}} Arbeitsschlägen. Ein Fels braucht so viele Arbeitsschläge für jedes Stück, Holz geht also etwa {{gather.treeYield}} Mal schneller als Bruchstein.',
      blocks: [
        {
          h: 'Was ein Vorkommen liefert',
        },
        {
          table: {
            head: [
              'Vorkommen',
              'Wer',
              'Liefert',
              'Arbeitsschläge ohne Erfahrung',
              'Dauer je Baum, Stück oder Feld',
              'Werkzeug hilft',
            ],
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
            foot: 'Reine Arbeitszeit ohne Erfahrung und Werkzeug, ohne Laufwege.',
          },
        },
        {
          p: 'Ein gefällter Baum bleibt als Stamm mit {{gather.treeYield}} Stück liegen, und der Abbauer trägt sie einzeln weg. Jedes Stück aus Fels oder Lagerstätte fällt daneben zu Boden.',
        },
        {
          h: 'Eisen und Gold',
        },
        {
          p: '[[good:iron|Eisen]] und [[good:gold|Gold]] entdeckt ein Abbauer, der selbst insgesamt {{gather.oreNeed}} Stück [[good:mud|Lehm]] und [[good:stone|Bruchstein]] abbaut, in beliebiger Mischung. Dieselbe Voraussetzung schaltet beide Waren frei. Der Erste, dem das gelingt, entdeckt sie fürs ganze Dorf, danach kann man sie auch in der [[building:school|Schule]] lernen. Bis dahin zeigt das Panel „gesperrt“.',
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
          p: 'Ein Feld wächst nur, wenn jemand es gießt, von allein mit der Zeit wächst es nicht. Jedes Gießen hebt dieses Feld und 6 Nachbarfelder um 1 Stufe, ein Feld braucht also höchstens {{field.waterings}} Mal Gießen. Nach der Ernte bleibt 1 Stück liegen, und auf dem Platz kann wieder gesät werden.',
        },
        {
          p: 'Säen und Gießen kosten nichts, nicht einmal Wasser.',
        },
        {
          table: {
            head: ['Gebäude', 'Felder', 'Radius'],
            rows: [
              ['[[building:work_farm_00|Farm]]', '{{field.max}}', '{{field.radius}} Hexfelder'],
              ['[[building:work_herb_hut|Kräuterhütte]]', '{{field.max}}', '{{field.radius}} Hexfelder'],
            ],
            num: [1],
            foot: 'Schräg beträgt der Radius etwa {{field.diagonal}} Hexfelder. Die Feldgrenze gilt fürs Gebäude, nicht für den Arbeiter, also ernten mehr Leute schneller, haben aber nicht mehr Felder. Besatzung und Vorrat stehen auf der Karte des Gebäudes.',
          },
        },
        {
          p: 'Auf Sand und auf der Straße kannst du nicht säen. Wilde Felder der Karte im Radius des Gebäudes zählen zu seiner Grenze. Ein Feld, das {{field.reclaimSeconds}} s lang von der Tür seines Gebäudes aus nicht erreichbar ist, verschwindet und gibt seinen Platz in der Grenze frei.',
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
              [
                'Baum',
                'Ein gefällter Baum sät in {{regrow.inTen}} von 10 Fällen nach {{regrow.minMinutes}}-{{regrow.maxMinutes}} Min. einen Setzling in der Nähe, auf einem freien Platz mit mindestens {{regrow.forestTrees}} Bäumen ringsum. Der Setzling wächst alle {{tree.growMinutes}} Min. eine Stufe',
                '1 Setzling je gefälltem Baum, fällbar erst ausgewachsen',
              ],
              [
                'Pilz',
                'Ein gesammelter Pilz wächst in {{regrow.inTen}} von 10 Fällen nach {{regrow.minMinutes}}-{{regrow.maxMinutes}} Min. in der Nähe nach, auf einem freien Platz mit mindestens {{regrow.forestTrees}} Bäumen ringsum',
                '1 Pilz je gesammeltem, nur im Wald',
              ],
              ['Fels, Lagerstätte', 'Wachsen nicht nach', '-'],
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
          p: 'Werkzeug verteilt der [[article:assistant|Assistent]], der von Spielbeginn an eingeschaltet ist, oder du per Befehl. Ein Siedler ohne Werkzeug holt sich selbst eines aus dem Lager und nimmt Eisenwerkzeug oder, wenn keins da ist, Holzwerkzeug. Holzwerkzeug gegen Eisenwerkzeug tauscht der Assistent, wenn seine Schalter „Eisenwerkzeug“ und „Holzwerkzeug ersetzen“ an sind und ein Lager freies Eisenwerkzeug hat. Angebrauchtes Holzwerkzeug geht beim Tausch verloren, unbenutztes kommt zurück ins Lager.',
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
              [
                '[[job:builder|Bauarbeiter]]',
                'Weniger Arbeitsschläge je Stück Baustoff: [[article:construction|Bau]]',
              ],
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
            head: ['Siedler ohne Erfahrung', 'Ohne Werkzeug', 'Holz', 'Eisen'],
            rows: [
              [
                'Arbeitsschläge je Baum oder je Stück Stein, Lehm oder Erz',
                '{{tool.strokes.bare}}',
                '{{tool.strokes.wooden}}',
                '{{tool.strokes.iron}}',
              ],
              ['Würfe je 1 Fisch', '{{tool.casts.bare}}', '{{tool.casts.wooden}}', '{{tool.casts.iron}}'],
            ],
            num: [1, 2, 3],
            foot: 'Arbeitsschläge an Baum, Fels, Lagerstätte und Kräuterfeld. Erfahrung zieht davon ihre Arbeitsschläge ab, aber mindestens 1 bleibt immer: [[article:exp-work|Arbeitserfahrung]].',
          },
        },
        {
          p: 'Ein Feld [[good:wheat|Weizen]] braucht ohne Werkzeug {{gather.wheatStrokes}} Arbeitsschläge, mit Werkzeug oder ab {{exp.savedStrokePct}}% Erfahrung reicht 1.',
        },
        {
          h: 'Stücke je Charge in der Werkstatt',
        },
        {
          p: 'Werkzeug gibt jeder Charge einen festen Bonus: Holzwerkzeug +{{tool.bonus.wooden}}, Eisenwerkzeug +{{tool.bonus.iron}} Stück. Er kommt zum Bonus aus der Erfahrung hinzu, den [[article:exp-work|Arbeitserfahrung]] zeigt. Bei einem Rezept mit 2 Stück verdoppelt sich der Bonus. Zutaten und Arbeitszeit bleiben gleich.',
        },
        {
          p: 'Bruchteile von Stücken summieren sich. Sobald ein volles Stück zusammen ist, kommt es in den Vorrat, auch über die Kapazität hinaus.',
        },
        {
          h: 'Verschleiß',
        },
        {
          p: 'Jeder Arbeitsschlag, jeder Angelwurf, jedes Gießen und jede fertige Charge kostet einen Einsatz, auch wenn sie nichts bringen. Säen und Pilze aufheben kosten nichts. Nach {{tool.uses}} Einsätzen ist das Werkzeug weg, und der Siedler arbeitet mit bloßen Händen, bis er neues bekommt. Eisenwerkzeug reicht einem Siedler ohne Erfahrung für {{tool.ironTrees}} Bäume.',
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
      lead: 'Ein Träger ohne Karren trägt {{haul.carry}} Stück auf einmal. An einer Stelle am Boden passen bis zu {{haul.groundStack}} Stück einer Ware.',
      blocks: [
        {
          p: 'Wie viel ein Lager fasst und wie viele Leute darin arbeiten, steht auf den Karten von [[building:stock_00|Lagerhaus 1]], [[building:stock_01|2]], [[building:stock_02|3]] und [[building:headquarters|Hauptquartier]].',
        },
        {
          h: 'Vorrang',
        },
        {
          p: 'Vorrang stellst du in einem Lagerhaus, Hauptquartier, einer Kaserne oder einem Turm ein. Die Träger dieses Gebäudes holen die Ware dann aus anderen Lagern, Werkstätten und Haufen, solange Platz für sie ist.',
        },
        {
          h: 'Minimum',
        },
        {
          p: 'Das Minimum, bis {{haul.minimumMax}} Stück einer Ware, zählt alle Lagerhäuser und das Hauptquartier zusammen. Solange die Summe darunter liegt, holen die Träger die Ware aus Werkstätten, Brunnen, Bienenstöcken und Haufen, und niemand nimmt sie aus dem Lager.',
        },
        {
          p: 'Das gilt auch fürs Essen: Liegt alles Essen innerhalb des Minimums, isst niemand davon aus dem Lager. Ein Lager mit Vorrang bekommt aus einem anderen Lager nur, was über dem Minimum liegt.',
        },
        {
          h: 'Karren',
        },
        {
          p: 'Mit Karren nimmt ein Träger je Fahrt so viel mit, wie der Karren fasst: [[vehicle:handcart|Handkarren]], [[vehicle:oxcart|Ochsenkarren]]. Wie stark Ladung den Karren bremst: [[article:vehicles|Fahrzeuge und Schiffe]].',
        },
        {
          list: [
            'Einen Karren nehmen nur ein Träger mit Arbeitsplatz und der [[job:trader|Händler]].',
            'Der Karren muss dir gehören, frei sein und auf derselben Landmasse stehen.',
            'Ist auf dem Karren noch Platz, nimmt ein Lagerträger dieselbe Ware von Haufen und aus Werkstätten im Umkreis von {{haul.cartTopUp}} Hexfeldern mit, bevor er zurückfährt.',
          ],
        },
        {
          h: 'Haufen am Boden',
        },
        {
          p: 'Ein Haufen am Boden gehört niemandem, jeder darf ihn nehmen. Wo ein Träger Haufen aufsammelt: [[article:work-flag|Arbeitsfahne]].',
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
      lead: 'Die Arbeitsfahne (auf den Knöpfen kurz Fahne) legt fest, wo ein Arbeiter arbeitet. Sie lagert nichts, also lässt ein Abbauer ohne Arbeitsplatz die Ware am Boden liegen.',
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
                'Woher die Fahne kommt',
                'Steht von selbst vor seinen Füßen, wenn er den Beruf antritt',
                'Nur über den Befehl „Arbeitsfahne setzen“',
              ],
              ['Wo er arbeitet', 'Um die Fahne', 'Um die Fahne, ohne Fahne wie in der Tabelle unten'],
              ['Welche Waren', 'Alles, was sein Beruf abbaut', 'Nur die, die das Gebäude lagert'],
              ['Wohin die Ladung geht', 'Auf einen Haufen bei der Fahne', 'In sein Gebäude'],
              ['Fahne entfernen', 'Geht nicht, sie lässt sich nur versetzen', '„Fahne entfernen“'],
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
              ['Lagerträger', 'Haufen bis {{flag.radius}} Hexfelder ums Gebäude'],
              ['Jäger', 'Rund um den Arbeitsplatz'],
              ['Fischer', 'Fischt von seinem Standort aus'],
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
            foot: 'In Hexfeldern. Wer Wegweiser braucht, arbeitet nur in ihrer Reichweite.',
          },
        },
        {
          p: 'Den Trägern von Farm, Kräuterhütte, Brunnen, Bienenstock, Turm und Kaserne kannst du keine Arbeitsfahne setzen.',
        },
        {
          h: 'Haufen an der Fahne',
        },
        {
          list: [
            'Einen Haufen an der Fahne holt nur ein Träger mit Arbeitsplatz ab.',
            'Steht die Fahne des Abbauers weiter als {{flag.radius}} Hexfelder vom Lager entfernt, setz dem Lagerträger eine Fahne daneben.',
            'Versetzt du die Fahne, bleiben die Haufen, wo sie waren.',
          ],
        },
        {
          h: 'Fahne setzen',
        },
        {
          p: '„Arbeitsfahne setzen“ stellt die Fahne an den gewählten Ort oder versetzt sie dorthin, genau wie Ctrl und Rechtsklick. Ist der Ort belegt, kommt die Fahne auf einen freien bis {{flag.snap}} Hexfelder daneben, und gibt es keinen, verfällt der Befehl.',
        },
        {
          p: 'Im [[article:assistant|Assistenten]] kannst du Abbauern erlauben, ihre Fahne selbst zu versetzen. Ein Abbauer setzt sie dann {{assistant.flagMin}}-{{assistant.flagMax}} Hexfelder vom Vorkommen, und ist in der Gegend alles erschöpft, zieht er zum Vorkommen, das seinem Gebäude am nächsten liegt. Jäger und Fischer tun das nicht.',
        },
        {
          p: 'Du kannst die Fahne außerhalb des Netzes setzen, aber der Arbeiter steht dann, bis das Netz dorthin reicht: [[article:roads|Straßen und Wegweiser]].',
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
          p: 'Wegweiser setzt der [[job:scout|Kundschafter]], und sie kosten kein Material.',
        },
        {
          figure: {
            id: 'reach',
            caption: 'Reichweite des Netzes',
          },
        },
        {
          p: 'Ohne Wegweiser erreicht ein Siedler ein Ziel höchstens {{reach.walk}} Hexfelder weit, ein [[job:carrier|Träger]] {{reach.carrier}}. Weiter führen Wegweiser: Steht einer in dieser Reichweite, kann der Siedler das ganze damit verbundene Netz nutzen, und das Ziel muss in derselben Reichweite von einem seiner Wegweiser liegen.',
        },
        {
          list: [
            'Zwei Wegweiser verbinden sich, wenn sie näher als {{reach.link}} Hexfelder stehen und der Fußweg zwischen ihnen höchstens {{reach.linkRoute}} Hexfelder lang ist.',
            'Dein neuer Wegweiser muss mindestens {{reach.spacing}} Hexfelder vom nächsten entfernt stehen.',
            'Ware sucht ein Siedler näher als {{reach.goods}} Hexfelder von sich oder von Wegweisern in dieser Reichweite.',
            'Ein Gebäude auf einem Wegweiser rückt ihn bis zu {{reach.displace}} Hexfelder beiseite, und geht das nicht, ist der Wegweiser weg.',
          ],
        },
        {
          table: {
            head: ['Gelände', 'Reichweite der Warensuche, Hexfelder'],
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
          p: 'Kundschafter, Soldaten, Helden, [[job:hunter|Jäger]] und [[job:druid|Druiden]] gehen überallhin, mit oder ohne Wegweiser.',
        },
        {
          p: 'Liegt der Arbeitsplatz oder die Fahne eines Arbeiters außerhalb der Reichweite, bekommt er den Status „Verirrt“ und wartet, bis das Netz dorthin reicht. Ware, die er trägt, bringt er noch weg.',
        },
        {
          h: 'Wegweiser-Panel',
        },
        {
          table: {
            head: ['Im Panel', 'Bedeutung'],
            rows: [
              [
                '„Waren im Wegweisernetz“',
                'Alle Waren in Reichweite des verbundenen Netzes: in Gebäuden, auf Haufen, Karren und in Händen.',
              ],
              [
                '„Abreißen“',
                'Der Wegweiser verschwindet sofort, ohne Rückfrage. Hat er zwei Teile des Netzes verbunden, zerfällt das Netz.',
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
            head: ['Gelände unter der Straße', 'Schritt auf der Straße kürzer um'],
            rows: [
              ['Land', '{{step.roadSavedOnLandPct}}%'],
              ['Sand', '{{step.roadSavedOnSandPct}}%'],
              ['Gebirge', '{{step.roadSavedOnMountainPct}}%'],
              ['Schnee', '{{step.roadSavedOnSnowPct}}%'],
            ],
            num: [1],
            foot: 'Siedler mit Schuhen, ohne Last. Den Schritt auf jedem Gelände zeigt [[article:walking|Gehtempo]]. Auf der Straße nutzen sich Schuhe {{shoes.roadWear}} Mal langsamer ab als auf Land.',
          },
        },
        {
          list: [
            'Ein Straßenstück kostet 1 [[good:stone|Bruchstein]] und 1 Arbeitsschlag des [[job:builder|Bauarbeiters]].',
            'Ein Bruchstein pflastert auch bis zu 6 Nachbarstücke, sofern kein Bauarbeiter sie schon übernommen hat und kein Bruchstein darauf liegt.',
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
          p: 'Ein Hexfeld ist die kleinste Einheit der Bewegung: Ein Siedler geht 1 Hexfeld in 1 Schritt.',
        },
        {
          h: 'Schritt je Gelände',
        },
        {
          table: {
            head: ['Gelände', 'Schritt mit Schuhen', 'Schritt barfuß', 'Schritte je Paar Schuhe'],
            rows: [
              ['Straße, Pflaster', '{{step.road}} s', '{{step.roadBare}} s', '{{shoes.road}}'],
              ['Land', '{{step.land}} s', '{{step.landBare}} s', '{{shoes.land}}'],
              ['Sand, Strand, Steinwüste', '{{step.sand}} s', '{{step.sandBare}} s', '{{shoes.sand}}'],
              ['Gebirge', '{{step.mountain}} s', '{{step.mountainBare}} s', '{{shoes.mountain}}'],
              ['Schnee', '{{step.snow}} s', '{{step.snowBare}} s', '{{shoes.snow}}'],
            ],
            num: [1, 2, 3],
            foot: 'Mit Last in den Händen nutzen sich Schuhe {{shoes.carryWear}} Mal schneller ab. Wie viel Energie Barfußgehen kostet: [[article:needs|Bedürfnisse]]. Was eine Straße bringt: [[article:roads|Straßen und Wegweiser]].',
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
              ['Kondition höchstens {{need.drivePct}}%', '+{{step.tiredExtra}} s'],
              ['Kind', '+{{step.childExtra}} s'],
              ['Baby', 'Schritt × 2'],
              [
                'Waffe und Rüstung wiegen zusammen {{step.weightLowFrom}}-{{step.weightLowTo}}',
                '+{{step.weightLowExtra}} s',
              ],
              [
                'Waffe und Rüstung wiegen zusammen {{step.weightHighFrom}}-{{step.weightHighTo}}',
                '+{{step.weightHighExtra}} s',
              ],
              ['[[good:amulet_speed|Windamulett]]', '-{{step.amuletSaved}} s'],
            ],
            foot: 'Ein Schritt dauert nie weniger als {{step.shortest}} s. Helden bremst das Gewicht nicht. Wie stark ein Karren bremst: [[article:vehicles|Fahrzeuge und Schiffe]].',
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
            foot: 'Bei allen Stämmen gleich. Rechne das Waffengewicht zum Rüstungsgewicht aus der Tabelle Rüstungen hinzu: [[article:damage|Schadensrechner]].',
          },
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
            ],
            num: [2],
          },
        },
      ],
      see: [
        'good:shoes',
        'good:amulet_speed',
        'article:roads',
        'article:needs',
        'article:vehicles',
        'article:damage',
      ],
    },
    {
      id: 'trade',
      name: 'Handel',
      lead: 'Ein Händler pendelt zwischen {{trade.stops}} Gebäuden und nimmt ohne Karren {{haul.carry}} Stück auf einmal.',
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
            foot: 'Wie viel ein Karren fasst, steht auf seiner Karte, wie stark er bremst, unter [[article:vehicles|Fahrzeuge und Schiffe]].',
          },
        },
        {
          p: 'Fährt der Karren voll hin und leer zurück, bringen beide Karren gleich viel auf einer Strecke von etwa {{trade.cartParLand}} Hexfeldern über Land oder {{trade.cartParRoad}} Hexfeldern auf der Straße. Auf kürzeren Strecken ist der Handkarren besser, auf längeren der Ochsenkarren.',
        },
        {
          h: 'Route',
        },
        {
          list: [
            'Eine Route verbindet {{trade.stops}} fertige Gebäude mit Vorräten. Höchstens 1 davon darf jemand anderem gehören.',
            'Wird ein Gebäude ausgebaut, wartet der [[job:trader|Händler]], bis der Ausbau fertig ist.',
            'Aus einem Wohnhaus nimmt der Händler kein Essen.',
          ],
        },
        {
          h: 'Über das Meer',
        },
        {
          list: [
            'Liegen die Gebäude der Route an verschiedenen Ufern, zeigt die Route „über das Meer“. Klicke „Schiff zuweisen“ und wähle ein eigenes [[good:ship_small|Schiff]] oder [[good:ship_big|Großes Schiff]] am Ufer des Händlers, ohne Besatzung und ohne Fahrzeug an Bord. Der Händler fährt damit seine Route.',
            'Ein [[job:carrier|Träger]], der auf diesem Schiff sitzt, hilft dem Händler am Ufer beim Be- und Entladen, wenn beide Gebäude der Route dir gehören.',
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
              ['Ware in Gebäude B markiert', 'Holt sie aus A und bringt sie nach B'],
              ['Ware in beiden Gebäuden markiert', 'Gleicht die Vorräte zwischen ihnen aus'],
              ['In keinem Gebäude ist etwas markiert', 'Der Händler transportiert nichts'],
              ['bis N', 'Hört mit dem Liefern auf, sobald das Zielgebäude samt Ladung N Stück hat'],
              ['behalten N', 'Im Quellgebäude bleiben N Stück'],
              [
                'Siedlung',
                'Holt Ware aus dem ganzen Dorf: erst aus diesem Lager, dann aus anderen Lagern und Werkstätten in seinem Wegweisernetz. Ist dieses Lager voll, liefert er in ein anderes Lager des Dorfs',
              ],
            ],
            foot: 'Die Option Siedlung schaltest du nur in einem Lagerhaus oder Hauptquartier ein. In beiden Gebäuden der Route zugleich nur, wenn ihre Siedlungen kein Gebäude teilen, etwa auf zwei Inseln. Ware unter dem Lagerminimum nimmt der Händler nicht mit.',
          },
        },
        {
          h: 'Handel mit dem Computer',
        },
        {
          list: [
            'Handeln kannst du nur mit einem fertigen Gebäude eines Computerspielers, das ein von der Karte festgelegtes Angebot hat.',
            'Um das Gebäude in die Route einzutragen, müssen beide Seiten einander freundlich gesinnt sein. Danach reicht es, wenn der Stamm des Händlers freundlich ist: [[article:diplomacy|Diplomatie]].',
            'Ein Angebot lautet N Stück einer Ware gegen M Stück einer anderen, die Zahlen legt die Karte fest. Eine Route bedient ein Angebot zur Zeit.',
            'Alle {{trade.refillSeconds}} s füllt der Computer die Angebotsware in seinem Lager auf {{trade.refillLevel}} Stück auf.',
            'Hat das Gebäude des Computers keine Bezahlung, wartet der Händler und gibt nichts ab.',
            '„behalten N“ lässt N Stück Verkaufsware in deinem Gebäude. Die Rückgrenze N beendet den Handel, sobald dein Gebäude N Stück Bezahlung hat.',
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
