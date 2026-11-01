import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const EXPERIENCE: ArticleGroup = {
  group: 'Erfahrung',
  items: [
    {
      id: 'exp-work',
      name: 'Arbeitserfahrung',
      lead: 'Jede Ware hat ihren eigenen Erfahrungszweig: 100% bei Holz beschleunigen den Stein nicht.',
      blocks: [
        {
          h: 'Was Erfahrung bringt',
        },
        {
          figure: {
            id: 'exp-curve',
            caption: 'Die ersten Stücke bringen am meisten',
          },
        },
        {
          data: 'experience',
        },
        {
          p: 'Ein Bruchteil eines Punkts bringt nichts. Beim [[article:gathering|Abbau]] spart Erfahrung Schläge, in der Werkstatt und beim Schlachten bringt sie zusätzliche Stücke. Tabellen mit Werkzeug: [[article:tools|Werkzeug]]. Baupunkte: [[article:construction|Bau, Ausbau, Reparatur]].',
        },
        {
          h: 'Wie viel Arbeit nötig ist',
        },
        {
          table: {
            head: ['Arbeit', 'Was zählt', 'Punkte je Stück', 'Stück bis 51%', 'Stück bis 100%'],
            rows: [
              [
                'Holz',
                'gefällter Baum',
                '{{exp.wood.points}}',
                '{{exp.wood.repeatsQuoted}}',
                '{{exp.wood.repeatsFull}}',
              ],
              [
                'Jagd',
                'Stück vom Kadaver',
                '{{exp.hunt.points}}',
                '{{exp.hunt.repeatsQuoted}}',
                '{{exp.hunt.repeatsFull}}',
              ],
              [
                'Fischfang',
                'Fisch',
                '{{exp.fish.points}}',
                '{{exp.fish.repeatsQuoted}}',
                '{{exp.fish.repeatsFull}}',
              ],
              [
                'Lehm, Bruchstein, Eisen, Gold, Pilze, Weizen, Schlachtung, Werkstatt',
                'Stück, beim Schlachten das Tier, in der Werkstatt die Charge',
                '{{exp.craft.points}}',
                '{{exp.craft.repeatsQuoted}}',
                '{{exp.craft.repeatsFull}}',
              ],
              [
                'Bau, Reparatur',
                'Schlag, der etwas hinzugefügt hat',
                '{{exp.build.points}}',
                '{{exp.build.repeatsQuoted}}',
                '{{exp.build.repeatsFull}}',
              ],
            ],
            num: [2, 3, 4],
            foot: 'Die letzten Spalten zählen Bäume, Stücke, Chargen oder Schläge. Ein Zweig heißt wie Arbeit und Ware, zum Beispiel Abbau - Eisen oder Backen - Brote. Die Zweige sind bei allen Stämmen gleich.',
          },
        },
        {
          p: 'Jeder Baum, jedes Stück und jede Charge gibt außerdem einen Punkt auf den allgemeinen Zweig des Berufs, zum Beispiel Abbau. Der allgemeine Zweig schaltet weitere [[article:trades|Berufe]] frei und gilt für Waren ohne eigenen Zweig. Punkte bleiben beim Berufswechsel erhalten.',
        },
        {
          h: 'Wer nichts davon hat',
        },
        {
          list: [
            'Der [[job:carrier|Träger]] sammelt Tragen, das die Arbeit nicht beschleunigt. {{exp.carrierTrader}} Lieferungen schalten den [[job:trader|Händler]] frei.',
            'Der Händler sammelt Handeln, {{exp.tradePointPerUnit}} Punkt je entladenes Stück. Handeln ändert nichts.',
            'Der [[job:scout|Kundschafter]] sammelt keine Punkte. [[job:woman|Frauen]] und Kinder haben keine Zweige.',
            'Säen, Gießen, [[building:school|Schule]] und [[building:barracks|Kaserne]] bringen keine Punkte.',
          ],
        },
      ],
      see: ['article:tools', 'article:trades', 'article:exp-combat', 'article:construction'],
    },
    {
      id: 'exp-combat',
      name: 'Kampferfahrung',
      lead: 'Hundert Treffer mit einer Waffenklasse verdoppeln den Nahkampfschaden.',
      blocks: [
        {
          h: 'Nahkampfschaden',
        },
        {
          table: {
            head: ['Treffer', 'Faktor', 'Aus Schlag {{combat.sampleBlow}} wird'],
            rows: [
              [0, '×1', '{{combat.sampleBlow}}'],
              [10, '×{{fight.factor.10}}', '{{fight.blow.10}}'],
              [25, '×{{fight.factor.25}}', '{{fight.blow.25}}'],
              [50, '×{{fight.factor.50}}', '{{fight.blow.50}}'],
              [75, '×{{fight.factor.75}}', '{{fight.blow.75}}'],
              ['{{combat.fightCapHits}}', '×{{combat.fightCapFactor}}', '{{combat.fightCapBlow}}'],
            ],
            num: [0, 1, 2],
            foot: 'Über {{combat.fightCapHits}} Treffern steigt der Faktor nicht weiter.',
          },
        },
        {
          p: 'Der Faktor wirkt bei Nahkampfschlägen gegen Menschen, Tiere und Gebäude. Er wirkt nicht gegen [[article:walls|Palisaden]] und [[article:vehicles|Fahrzeuge]] und nicht bei Pfeilen und [[article:catapult|Katapulten]].',
        },
        {
          h: 'Treffsicherheit',
        },
        {
          p: 'Bogen und Katapult: {{aim.basePct}}% Volltreffer bei 0 Treffern, 100% bei {{aim.sureHits}}. Tabelle: [[article:aim|Treffen und Schießen]].',
        },
        {
          h: 'Was als Treffer zählt',
        },
        {
          p: 'Ein Schlag oder Schuss mit Schaden gibt 1 Punkt auf die Waffenklasse: Faust, Speer, Schwert, Bogen oder Katapult. Der Bogen des [[job:hunter|Jägers]] ist ebenfalls Bogen. Ein Schuss auf mehrere Ziele zählt einmal.',
        },
        {
          p: 'Der Zweig einer Klasse heißt Kämpfen - Klasse. Treffer einer Klasse gelten nicht für eine andere und bleiben beim Berufswechsel erhalten.',
        },
        {
          h: 'Waffen entdecken',
        },
        {
          table: {
            head: ['Waffe', 'Handwerker', 'Voraussetzung'],
            rows: [
              ['[[good:spear_wooden|Holzspeer]]', '[[job:armorer|Waffenbauer]]', 'keine'],
              [
                '[[good:spear_iron|Eisenspeer]]',
                '[[job:smith|Schmied]]',
                '{{exp.ironSpearNeed}} × Schmieden',
              ],
              ['[[good:sword_shord|Kurzschwert]]', '[[job:smith|Schmied]]', 'keine'],
              [
                '[[good:sword_long|Langschwert]]',
                '[[job:smith|Schmied]]',
                '{{exp.longSwordNeed}} × Schmieden',
              ],
              ['[[good:bow_short|Kurzbogen]]', '[[job:armorer|Waffenbauer]]', 'keine'],
              [
                '[[good:bow_long|Langbogen]]',
                '[[job:armorer|Waffenbauer]]',
                '{{exp.longBowNeed}} × Waffenbau',
              ],
            ],
            foot: 'Bei allen fünf Stämmen gleich.',
          },
        },
        {
          p: 'Treffer sperren keine Waffen. Ein Soldat nimmt jede Waffe aus einem Lager in Reichweite, auch ohne Treffer, und gehört sofort zur Klasse dieser Waffe. Die Schwelle von {{exp.classLowNeed}} oder {{exp.classHighNeed}} Treffern aus [[article:trades|Berufe und Schule]] vermerkt nur die Entdeckung der Klasse fürs Dorf und öffnet ihre Wahl unter „Beruf wechseln“.',
        },
        {
          h: 'Stern',
        },
        {
          p: 'Ein Soldat trägt ab 25 Treffern mit seiner aktuellen Waffe einen Stern. Er wächst alle 25 Treffer und ist bei 100 am größten.',
        },
        {
          h: 'Helden',
        },
        {
          p: 'Bei Helden zählen Treffer nicht, ihr Schaden steigt nicht.',
        },
      ],
      see: [
        'article:damage',
        'article:aim',
        'article:heroes',
        'article:exp-work',
        'article:trades',
        'building:barracks',
      ],
    },
    {
      id: 'trades',
      name: 'Berufe und Schule',
      lead: 'Eine Entdeckung gehört dem Spieler und bleibt auch nach dem Tod des Arbeiters, der sie gemacht hat.',
      blocks: [
        {
          p: 'Die Lobby-Einstellung „Berufsentwicklung: Alles von Anfang an freigeschaltet“ hebt die Voraussetzungen ziviler Berufe und Produkte auf. Voraussetzungen der Soldatenberufe und Kartenverbote bleiben.',
        },
        {
          h: 'Was einen Beruf freischaltet',
        },
        {
          data: 'jobs',
        },
        {
          p: 'Bei einer Voraussetzung mit zwei Zweigen zählt die Summe. [[job:builder|Bauarbeiter]], Abbauer, [[job:farmer|Farmer]], [[job:hunter|Jäger]], [[job:fisher|Fischer]], [[job:carrier|Träger]] und [[job:scout|Kundschafter]] sind von Anfang an offen.',
        },
        {
          p: 'Produkte werden genauso entdeckt, zum Beispiel [[good:furniture|Möbel]] bei {{exp.furnitureNeed}} × Schreinern. Die Voraussetzungen sind bei allen Stämmen gleich.',
        },
        {
          h: 'So läuft eine Entdeckung ab',
        },
        {
          steps: [
            'Ein Siedler arbeitet im Vorgängerberuf, zum Beispiel als [[job:collector|Abbauer]] am Holz.',
            'Nach {{exp.joinerNeed}} gefällten Bäumen erfüllt er die Voraussetzung für den [[job:joiner|Schreiner]], und das Spiel meldet die Entdeckung.',
            'Der Beruf ist fürs ganze Dorf entdeckt, und dieser Siedler kann ihn sofort annehmen.',
            'Alle anderen gehen in die [[building:school|Schule]] oder erarbeiten sich dieselbe Voraussetzung.',
          ],
        },
        {
          h: 'Schule und Kaserne',
        },
        {
          table: {
            head: ['Eigenschaft', 'Schule', 'Kaserne'],
            rows: [
              ['Plätze', '{{school.seats}}', '{{barracks.seats}}'],
              ['Lehrt', 'zivilen Beruf oder Produkt', 'Beruf Soldat'],
              ['Dauer', 'siehe Tabelle unten', '{{barracks.drillSeconds}} s'],
              ['Wer', 'erwachsener Mann', 'erwachsener Mann, auch mit Beruf'],
              ['Erfahrungspunkte', '0', '0'],
              [
                'Nach dem Kurs',
                'neuer Beruf, wartet an der Schule auf Zuweisung',
                'Unbewaffneter Soldat, der alte Beruf bleibt bekannt',
              ],
            ],
            foot: 'Über die Platzzahl hinaus warten Schüler in der Reihenfolge der Anmeldung vor der Tür.',
          },
        },
        {
          list: [
            'Bedürfnisse unterbrechen den Kurs ohne Fortschrittsverlust. Ein Abbruch löscht den Fortschritt.',
            'Ein Schüler, der zur Schule im Bau geschickt wird, trägt Material hin und wartet.',
            'Ein abgeschlossener Kurs bleibt für immer, auch nach einem Berufswechsel.',
          ],
        },
        {
          h: 'Kursdauer',
        },
        {
          table: {
            head: ['Kurse', 'Dauer'],
            rows: [
              [
                '[[good:armor_leather|Lederrüstung]], [[good:potion_food_small|Kleiner Nahrungstrank]], [[good:potion_stamina_small|Kleiner Wachtrank]]',
                '{{course.shortSeconds}} s',
              ],
              ['Berufe und die meisten Produkte', '{{course.commonSeconds}} s'],
              ['[[good:potion_heal_big|Großer Heiltrank]]', '{{course.healSeconds}} s'],
              ['[[good:handcart|Handkarren]]', '{{course.handcartSeconds}} s'],
              ['[[good:oxcart|Ochsenkarren]]', '{{course.oxcartSeconds}} s'],
              [
                '[[good:ship_small|Schiff]], [[good:ship_big|Großes Schiff]], [[good:catapult|Katapult]]',
                '{{course.shipSeconds}} s',
              ],
            ],
            num: [1],
          },
        },
        {
          h: 'Beruf und Arbeitsplatz',
        },
        {
          p: 'Beruf und Arbeitsplatz sind zwei getrennte Entscheidungen. „Beruf wechseln“ löscht den Arbeitsplatz, und niemand teilt von selbst einen neuen zu. Ausnahme sind Schulabgänger, wenn du ihren Schalter im [[article:assistant|Assistenten]] einschaltest.',
        },
        {
          table: {
            head: ['Beruf', 'Gebäude', 'Ohne Gebäude'],
            rows: [
              ['[[job:builder|Bauarbeiter]]', 'nicht nötig', 'Geht selbst zur Baustelle.'],
              ['[[job:scout|Kundschafter]]', 'nicht nötig', 'Handelt auf Befehl.'],
              ['[[job:trader|Händler]]', 'nicht nötig', 'Fährt seine [[article:trade|Route]].'],
              ['[[job:civilist|Zivilist]]', 'nicht nötig', 'Arbeitet nicht, wartet auf Zuweisung.'],
              [
                '[[job:collector|Abbauer]], [[job:hunter|Jäger]], [[job:fisher|Fischer]]',
                'wahlweise',
                'Arbeitet von der [[article:work-flag|Arbeitsfahne]] aus, die ihm beim Berufsantritt vor die Füße gesetzt wird.',
              ],
              ['[[job:farmer|Farmer]], [[job:herb_mush_guy|Kräutergärtner]]', 'nötig', 'Bestellt kein Feld.'],
              ['[[job:carrier|Träger]]', 'nötig', 'Trägt nichts.'],
              ['Übrige zivile Berufe', 'nötig', 'Steht untätig herum.'],
            ],
          },
        },
        {
          list: [
            'Rechtsklick auf ein Gebäude („Hier arbeiten“) wechselt den Beruf und gibt den Arbeitsplatz mit einem Befehl.',
            'Erfüllt der Siedler die Voraussetzung für den Beruf des Gebäudes nicht, nimmt er dort einen freien Trägerplatz, falls es einen gibt.',
            'Ein Soldat nimmt nur einen Platz in seinem Beruf.',
            '„Arbeitsplatz aufheben“ lässt Beruf und getragene Ware. Produktionszähler und Karren des Trägers gehen verloren.',
            'Auch der Abriss des Gebäudes lässt den Beruf.',
            'Frauen, Kinder und Helden bekommen nie einen Beruf.',
          ],
        },
        {
          h: 'Was ein Berufswechsel kostet',
        },
        {
          table: {
            head: ['Sache', 'Was damit passiert'],
            rows: [
              ['Arbeitsplatz', 'Geht verloren.'],
              ['Produktionszähler', 'Gehen verloren.'],
              ['Getragene Ware', 'Fällt zu Boden.'],
              [
                'Werkzeug',
                'Bleibt. Beim Eintritt ins Militär fällt neues zu Boden, gebrauchtes geht verloren.',
              ],
              [
                'Waffe und Rüstung',
                'Beim Austritt aus dem Militär landet Unbenutztes in den Händen oder am Boden. Benutztes geht verloren.',
              ],
              [
                'Befehle',
                'Aktueller Befehl und Befehlsreihe verfallen. „Essen und Schlafen“ springt auf „Erlaubt“.',
              ],
              ['Erlernte Berufe', 'Bleiben, auch der vorige Beruf. Erfahrungspunkte ebenso.'],
            ],
            foot: 'Schule und Kaserne wechseln den Beruf genauso, nur die Befehlsreihe bleibt. Der Träger lässt seinen Karren stehen.',
          },
        },
      ],
      see: [
        'article:exp-work',
        'article:exp-combat',
        'article:assistant',
        'article:work-flag',
        'building:school',
        'building:barracks',
      ],
    },
  ],
};
