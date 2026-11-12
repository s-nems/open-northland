import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const EXPERIENCE: ArticleGroup = {
  group: 'Erfahrung',
  items: [
    {
      id: 'exp-work',
      name: 'Arbeitserfahrung',
      lead: 'Erfahrung wächst für jede Ware einzeln: 100% bei Holz beschleunigen den Stein nicht.',
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
          p: 'Die Tabelle gilt für normale Arbeit. Holz, Jagd, Fischfang und Bau wachsen in eigenem Tempo, siehe Tabelle unten. Beim [[article:gathering|Abbau]] senkt Erfahrung die Arbeitsschläge je Stück, in der Werkstatt und beim Schlachten bringt sie zusätzliche Stücke. Erfahrung zusammen mit Werkzeug: [[article:tools|Werkzeug]]. Bau: [[article:construction|Bau, Ausbau, Reparatur]].',
        },
        {
          p: 'Ein ausgewählter eigener Siedler hat einen Berufsstern. Er erscheint, sobald seine beste Fähigkeit im Beruf {{star.step}}% erreicht, und wächst alle {{star.step}}% bis {{star.full}}%. Träger haben keinen.',
        },
        {
          h: 'Wie viel Arbeit nötig ist',
        },
        {
          table: {
            head: ['Arbeit', 'Was zählt', 'Mal bis zur Hälfte ({{exp.quotedPct}}%)', 'Mal bis 100%'],
            rows: [
              ['Holz', 'gefällter Baum', '{{exp.wood.repeatsQuoted}}', '{{exp.wood.repeatsFull}}'],
              ['Jagd', 'Stück vom Kadaver', '{{exp.hunt.repeatsQuoted}}', '{{exp.hunt.repeatsFull}}'],
              ['Fischfang', 'Fisch', '{{exp.fish.repeatsQuoted}}', '{{exp.fish.repeatsFull}}'],
              [
                'Lehm, Bruchstein, Eisen, Gold, Pilze, Kräuter, Weizen, Schlachtung, Werkstatt',
                'Stück, beim Schlachten das Tier, in der Werkstatt die Charge',
                '{{exp.craft.repeatsQuoted}}',
                '{{exp.craft.repeatsFull}}',
              ],
              [
                'Bau, Reparatur',
                'Hammerschlag auf der Baustelle',
                '{{exp.build.repeatsQuoted}}',
                '{{exp.build.repeatsFull}}',
              ],
            ],
            num: [2, 3],
            foot: 'Die letzten Spalten zählen Bäume, Stücke, Chargen oder Arbeitsschläge. Ab {{build.bareGainPct}}% braucht ein [[job:builder|Bauarbeiter]] ohne Werkzeug nur noch halb so viele Arbeitsschläge je Stück Baustoff. Im Siedlerpanel steht auf der Seite Erfahrung jede Fähigkeit in einer eigenen Zeile, zum Beispiel Abbau - Eisen: {{exp.craft.repeatsQuoted}} Mal, Ertrag +{{exp.quotedPct}}%.',
          },
        },
        {
          p: 'Jeder Baum, jedes Stück und jede Charge zählt auch für die allgemeine Fähigkeit des Berufs, zum Beispiel Ackerbau. Einen neuen Beruf schaltet entweder diese allgemeine Fähigkeit frei oder die Fähigkeit für eine einzelne Ware: Ackerbau schaltet den [[job:miller|Müller]] frei, Abbau - Holz den [[job:joiner|Schreiner]]. Die Voraussetzungen stehen unter [[article:trades|Berufe und Schule]]. Bei einer Ware ohne eigene Fähigkeit zählt die allgemeine. Erfahrung bleibt beim Berufswechsel erhalten.',
        },
        {
          h: 'Erfahrung, die die Arbeit nicht beschleunigt',
        },
        {
          list: [
            'Der [[job:carrier|Träger]] sammelt Tragen. Das macht seine Arbeit nicht schneller, aber {{exp.carrierTrader}} Lieferungen schalten den [[job:trader|Händler]] frei.',
            'Der Händler sammelt Handeln für jedes entladene Stück, aber Handeln ändert nichts.',
            '[[job:scout|Kundschafter]], [[job:woman|Frauen]] und Kinder sammeln keine Erfahrung.',
            'Säen, Gießen, [[building:school|Schule]] und die Ausbildung in der [[building:barracks|Kaserne]] bringen keine Erfahrung. Das Exerzieren für Münzen bringt Kampferfahrung: [[article:exp-combat|Kampferfahrung]].',
          ],
        },
      ],
      see: ['article:tools', 'article:trades', 'article:exp-combat', 'article:construction'],
    },
    {
      id: 'exp-combat',
      name: 'Kampferfahrung',
      lead: 'Jeder Mensch hat eine Kampferfahrung von 0 bis {{combat.fightCapPoints}} Punkten, gemeinsam für jede Waffe.',
      blocks: [
        {
          h: 'Was Erfahrung bringt',
        },
        {
          p: 'Bei {{combat.fightCapPoints}} Punkten verursacht ein Nahkampfschlag {{combat.fightDealtPct}}% mehr Schaden, und jeder Schlag oder Pfeil, der den Kämpfer trifft, {{combat.fightTakenPct}}% weniger. Beides steigt mit jedem Punkt gleichmäßig.',
        },
        {
          table: {
            head: [
              'Punkte',
              'Nahkampf verursacht',
              'Aus einem Schlag {{combat.sampleBlow}} wird',
              'Erlitten',
            ],
            rows: [
              [0, '×1', '{{combat.sampleBlow}}', '×1'],
              [10, '×{{fight.factor.10}}', '{{fight.blow.10}}', '×{{fight.taken.10}}'],
              [25, '×{{fight.factor.25}}', '{{fight.blow.25}}', '×{{fight.taken.25}}'],
              [50, '×{{fight.factor.50}}', '{{fight.blow.50}}', '×{{fight.taken.50}}'],
              [75, '×{{fight.factor.75}}', '{{fight.blow.75}}', '×{{fight.taken.75}}'],
              [
                '{{combat.fightCapPoints}}',
                '×{{combat.fightCapFactor}}',
                '{{combat.fightCapBlow}}',
                '×{{combat.fightTakenFactor}}',
              ],
            ],
            num: [0, 1, 2, 3],
            foot: 'Über {{combat.fightCapPoints}} Punkte steigt nichts mehr.',
          },
        },
        {
          p: 'Der Bonus auf verursachten Schaden gilt für Nahkampfschläge gegen Menschen, Tiere und Gebäude. Er gilt nicht gegen [[article:walls|Palisaden]] und [[article:vehicles|Fahrzeuge]] und nicht für Pfeile und das [[article:catapult|Katapult]]. Einem Bogenschützen bringt Erfahrung Genauigkeit und weniger erlittenen Schaden, keine stärkeren Pfeile.',
        },
        {
          h: 'Mit Amuletten',
        },
        {
          p: 'Das [[good:amulet_strength|Stärkeamulett]] addiert seinen Bonus zum Erfahrungsbonus: Mit voller Erfahrung kommt ein Nahkampfschlag auf ×{{combat.fightStrengthFactor}}. Das [[good:amulet_defense|Verteidigungsamulett]] multipliziert sich mit der Erfahrung: Mit voller Erfahrung erleidet der Kämpfer ×{{combat.fightDefenseFactor}} Schaden. Amulette: [[article:draughts|Getränke und Amulette]].',
        },
        {
          p: 'Ohne Erfahrung trifft ein Bogenschütze {{aim.basePct}}% seiner Schüsse, ab {{aim.noSpreadPoints}} Punkten landet jeder Schuss im Ziel. Das [[article:catapult|Katapult]] zählt eigene Treffer. Details: [[article:aim|Treffen und Schießen]].',
        },
        {
          h: 'Wie man sie bekommt',
        },
        {
          list: [
            'Kampf: Ein Nahkampfschlag, der Schaden verursacht, bringt {{combat.fightMeleePerSecond}} Punkte je Sekunde seines Ausholens, ein Schuss {{combat.fightShotPerSecond}} Punkte je Sekunde des Spannens. Eine langsame Waffe lernt so schnell wie eine flinke, und ein Bogen bringt pro Sekunde weniger.',
            'Schläge und Schüsse auf Gebäude, [[article:walls|Palisaden]] und [[article:vehicles|Fahrzeuge]] bringen {{combat.fightStructurePct}}% davon.',
            'Erlittene Schläge: Wer verwundet wird, ob von einem Menschen, einem Tier, einem Turm oder einem Katapult, bekommt {{combat.fightTakenPerSecond}} Punkte je Sekunde des gegnerischen Schlags.',
            'Exerzieren: Ein Soldat, bewaffnet oder nicht, zahlt eine [[good:coin|Münze]] für {{coinDrill.termSeconds}} s in deiner [[building:barracks|Kaserne]] und bekommt am Ende {{coinDrill.points}} Punkte. Wähle die Soldaten und klicke mit rechts auf deine eigene Kaserne.',
          ],
        },
        {
          p: 'Faust und jede Waffe zählen gleich, die Schüsse des [[job:hunter|Jägers]] auch. Die Erfahrung bleibt nach einem Waffen- oder Berufswechsel. Wer {{coinDrill.limit}} Punkte oder mehr hat, exerziert nicht mehr und holt sich den Rest im Kampf. Unterbrechen ein Kampf oder ein neuer Befehl das Exerzieren, kommt die Münze zurück, Punkte gibt es keine. Es gehen nur so viele Soldaten, wie die Kaserne freie Münzen hat, die nächsten zuerst; die übrigen bleiben stehen.',
        },
        {
          p: 'Im Siedlerfenster ist das die Zeile Kämpfen: ihr Anteil am vollen Zähler in Prozent und im Tooltip die Boni: mehr verursachter Schaden mit einer Nahkampfwaffe oder bloßen Händen, die Treffsicherheit mit einem Bogen und wie viel weniger Schaden er erleidet. Einem Helden steigt die Erfahrung durch Kämpfen nicht, außer die Mission schaltet es ein.',
        },
        {
          p: 'Bessere Waffen schaltet die Herstellung frei, nicht der Kampf. Die Bedingung steht auf der Karte der Waffe, z. B. [[good:sword_long|Langschwert]]. Wer welche Waffe trägt: [[article:equip|Soldaten ausrüsten]].',
        },
      ],
      see: [
        'article:damage',
        'article:aim',
        'article:equip',
        'article:heroes',
        'article:exp-work',
        'article:trades',
        'building:barracks',
      ],
    },
    {
      id: 'trades',
      name: 'Berufe und Schule',
      lead: 'Ein entdeckter Beruf bleibt dem ganzen Dorf, auch wenn der Siedler stirbt, der ihn entdeckt hat.',
      blocks: [
        {
          p: 'Die Lobby-Einstellung „Berufsentwicklung: Alles von Anfang an freigeschaltet“ hebt die Voraussetzungen ziviler Berufe und Produkte auf. Soldatenberufe haben keine Voraussetzungen, Kartenverbote bleiben.',
        },
        {
          h: 'Was einen Beruf freischaltet',
        },
        {
          data: 'jobs',
        },
        {
          p: 'Nennt eine Voraussetzung zwei Fähigkeiten, zählt die Summe. [[job:builder|Bauarbeiter]], Abbauer, [[job:farmer|Farmer]], [[job:hunter|Jäger]], [[job:fisher|Fischer]], [[job:carrier|Träger]] und [[job:scout|Kundschafter]] sind von Anfang an offen.',
        },
        {
          p: 'Produkte entdeckst du genauso, [[good:furniture|Möbel]] zum Beispiel mit Schreinern: {{exp.furnitureNeed}} Mal.',
        },
        {
          p: 'Wer die Voraussetzung erfüllt, kann den Beruf sofort annehmen. Alle anderen müssen einen Kurs in der [[building:school|Schule]] machen oder dieselbe Voraussetzung durch Arbeit erreichen.',
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
              ['Wer', 'erwachsener Mann', 'erwachsener Mann'],
              [
                'Nach dem Kurs',
                'neuer Beruf, wartet an der Schule auf Zuweisung',
                'Unbewaffneter Soldat, der alte Beruf bleibt bekannt',
              ],
            ],
            foot: 'Sind alle Plätze belegt, warten weitere Schüler vor der Tür.',
          },
        },
        {
          list: [
            'Geht ein Schüler essen oder schlafen, behält er seinen Fortschritt. Wer vom Kurs abberufen wird, verliert ihn.',
            'Ein Schüler, der zur Schule im Bau geschickt wird, trägt Material hin und wartet, bis sie fertig ist.',
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
          p: 'Nach „Beruf wechseln“ verliert der Siedler seinen Arbeitsplatz und bekommt von selbst keinen neuen. Ausnahme sind Schulabgänger, wenn du ihren Schalter im [[article:assistant|Assistenten]] einschaltest.',
        },
        {
          table: {
            head: ['Beruf', 'Gebäude', 'Ohne Gebäude'],
            rows: [
              ['[[job:builder|Bauarbeiter]]', 'nicht nötig', 'Geht selbst zur Baustelle.'],
              ['[[job:scout|Kundschafter]]', 'nicht nötig', 'Folgt Befehlen.'],
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
            'Rechtsklick auf ein Gebäude („Hier arbeiten“) wechselt sofort den Beruf und gibt den Arbeitsplatz.',
            'Erfüllt der Siedler die Voraussetzung für diesen Beruf nicht, nimmt er im Gebäude einen freien Trägerplatz, falls es einen gibt.',
            'Ein Soldat nimmt nur einen Platz in seinem Beruf.',
            '„Arbeitsplatz aufheben“ und der Abriss des Gebäudes nehmen den Beruf nicht weg.',
            'Frauen, Kinder und Helden bekommen nie einen Beruf.',
          ],
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
