import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const SETTLERS: ArticleGroup = {
  group: 'Siedler',
  items: [
    {
      id: 'needs',
      name: 'Bedürfnisse',
      lead: 'Bei {{need.drivePct}}% lässt ein Siedler die Arbeit liegen und kümmert sich um das Bedürfnis.',
      blocks: [
        {
          p: 'Die Lobby-Einstellung „Bedürfnisse der Siedler: Deaktiviert“ hält die Balken an und schaltet den Hunger ab. Dieser Artikel gilt dann nicht.',
        },
        {
          h: 'Balken',
        },
        {
          table: {
            head: ['Balken', 'Sinkt von selbst', 'Sinkt bei Arbeit', 'Füllt auf', 'Bei 0%'],
            rows: [
              [
                'Energie',
                '100% in {{need.drainMinutes}} Min.',
                'ja',
                '[[article:food|Mahlzeit]]',
                '[[article:health|stirbt in {{need.starveMinutes}} Min.]]',
              ],
              ['Kondition', '100% in {{need.drainMinutes}} Min.', 'ja', 'Schlaf', 'Gesundheit bleibt'],
              [
                'Soziale Motivation',
                '100% in {{need.drainMinutes}} Min.',
                'nein',
                'Gespräch',
                'keine Strafe',
              ],
              [
                'Religion',
                'nein',
                'nur bei Waffen und Rüstungen',
                '[[article:religion|Gebet]]',
                'beginnt keine Charge, die Religion kostet',
              ],
            ],
            foot: 'Beim Kartenstart steht jeder Balken zufällig auf {{need.startMinPct}}-100%. Ohne [[good:shoes|Schuhe]] kostet jeder Schritt je nach Boden {{need.barefootStepMinPct}}-{{need.barefootStepMaxPct}}% Energie, mit Last doppelt so viel.',
          },
        },
        {
          h: 'Schwellen',
        },
        {
          figure: {
            id: 'need-bar',
            caption: 'Was auf dem Balken passiert',
          },
        },
        {
          table: {
            head: ['Stand', 'Was passiert'],
            rows: [
              ['{{need.criticalPct}}%', 'Meldung zu Energie, Kondition oder Religion.'],
              [
                '{{need.drivePct}}%',
                'Beendet den Handgriff und lässt die Arbeit liegen. Bei Kondition dauert jeder Schritt {{step.tiredExtra}} s länger.',
              ],
              [
                '{{need.satedPct}}%',
                'Zu Hause füllt der Siedler erst Kondition, dann Energie bis zu diesem Stand auf und geht wieder.',
              ],
              [
                '{{need.overfillPct}}%',
                'Obergrenze. Eine Mahlzeit zu Hause und Schlaf auf Möbeln legen Vorrat über 100% an.',
              ],
            ],
            foot: 'Von selbst beten gehen nur [[job:armorer|Waffenbauer]] und [[job:smith|Schmiede]]. Der [[job:sewer|Näher]] verbraucht Religion, betet aber nur auf Befehl.',
          },
        },
        {
          h: 'Was ein Siedler zuerst tut',
        },
        {
          steps: [
            'Verteidigungsmodus: Schutz suchen.',
            '[[article:draughts|Getränke und Amulette]], an Ort und Stelle.',
            'Energie: essen.',
            'Kondition: schlafen.',
            'Religion: beten.',
            'Befehle des Spielers: Kaserne, Ausrüstung, Turm.',
            'Soziale Motivation: reden.',
            'Arbeit.',
          ],
        },
        {
          p: 'Gibt es nichts zu essen und keinen Ort zum Beten, geht der Siedler zurück an die Arbeit, und der Balken sinkt weiter. Ohne Wohnhaus im Umkreis von {{reach.walk}} Schritten schläft er im Freien.',
        },
        {
          p: 'Ein Soldat im Kampf isst nur, was er bei sich trägt, oder aus dem Turmvorrat. Der Befehl Iss unterbricht den Kampf.',
        },
        {
          h: 'Schlaf',
        },
        {
          table: {
            head: ['Wer', 'Schlafdauer', 'Außer Haus', 'Zu Hause', 'Mit Möbeln'],
            rows: [
              [
                'Mann mit Wohnhaus',
                '{{sleep.manSeconds}} s',
                '+{{sleep.manAwayPct}}%',
                '+{{sleep.manHomePct}}%',
                '+{{sleep.manFurnishedPct}}%',
              ],
              [
                '[[job:woman|Frau]]',
                '{{sleep.womanSeconds}} s',
                '+{{sleep.womanAwayPct}}%',
                '+{{sleep.womanHomePct}}%',
                '+{{sleep.womanFurnishedPct}}%',
              ],
              ['Händler, Kundschafter', '{{sleep.manSeconds}} s', '+{{sleep.manHomePct}}%', '-', '-'],
              ['Soldat', '{{sleep.soldierSeconds}} s', '+{{sleep.soldierPct}}%', '-', '-'],
            ],
            num: [1, 2, 3, 4],
          },
        },
        {
          h: 'Wer keine Balken hat',
        },
        {
          table: {
            head: ['Wer', 'Balken'],
            rows: [
              ['Baby, Kind', 'Keine. Erwachsene starten mit 100% auf jedem Balken.'],
              ['[[article:heroes|Held]]', 'Keine.'],
              ['Monster, Tiere', 'Keine.'],
              ['Soldat', 'Ohne Soziale Motivation.'],
              ['Mitfahrer im Karren', 'Balken und Gesundheit stehen still.'],
              [
                'Passagier auf dem Schiff',
                'Isst aus dem Frachtraum, schläft wie außer Haus, redet. Religion wartet bis zum Landgang.',
              ],
            ],
          },
        },
        {
          h: 'Befehle Iss, Schlaf, Rede, Bete',
        },
        {
          list: [
            'Der Befehl wirkt bei jedem Balkenstand. Er unterbricht Marsch, Angriff und Kampf.',
            'Lässt sich das Bedürfnis nicht stillen, wartet der Befehl. Stehen weitere Befehle an, verfällt er.',
            'Helden nehmen diese Befehle nicht an. „Bete“ wirkt nur in einem Beruf, der beten kann.',
          ],
        },
        {
          h: 'Schalter „Essen und Schlafen“',
        },
        {
          table: {
            head: ['Soldat', '„Erlaubt“', '„Verboten“'],
            rows: [
              ['Geht selbst essen, schlafen, beten', 'ja', 'nein'],
              ['Isst selbst aus der Hand oder dem Turmvorrat', 'ja', 'nein'],
              ['Hunger unterbricht lange Befehle', 'ja', 'nein'],
            ],
            foot: 'Getränke, Amulette und die Befehle Iss, Schlaf, Bete wirken in beiden Stellungen. Im Befehlsmenü heißen die Stellungen „Erlaube Soldaten Regeneration“ und „Verbiete Soldaten Regeneration“. Den Schalter hat nur der Soldat. Er steht anfangs auf „Erlaubt“ und springt nach einem Berufswechsel dorthin zurück.',
          },
        },
        {
          p: '„Verboten“ ohne Getränke endet im Hungertod. Da hilft der Befehl Iss oder die Rückkehr zu „Erlaubt“.',
        },
        {
          h: 'Hunger und lange Befehle',
        },
        {
          list: [
            'Bei {{need.criticalPct}}% Energie verlässt der Siedler Marsch, Erkundung oder Befehlsreihe. Status: „Hungrig, geht essen“.',
            'Er isst bis {{need.satedPct}}% und beginnt den Befehl dann von vorne.',
            'Findet er nichts, kehrt er zum Befehl zurück und sucht nach {{meal.breakRetrySeconds}} s erneut.',
            'Ein neuer Befehl an einen Hungrigen geht vor: Der Hunger lässt ihn {{meal.breakRetrySeconds}} s in Ruhe.',
            'Kondition wartet, bis die Befehle abgearbeitet sind.',
          ],
        },
        {
          h: 'In Alarmbereitschaft',
        },
        {
          p: 'Das ist der Zustand eines Soldaten im Modus [[article:stances|Angriff oder Verteidigung]] nahe am Kampf, nicht der [[article:defence|Verteidigungsmodus des Dorfes]], den der Spieler auslöst.',
        },
        {
          table: {
            head: ['Was in der Nähe ist', 'Schritte', 'Folge'],
            rows: [
              ['Kampf', 'bis {{alert.restClearance}}', 'Schläft, betet und redet nicht.'],
              ['Sichtbarer Feind, Modus Angriff oder Verteidigung', 'bis {{alert.standTo}}', 'Ebenso.'],
              ['Kampf neben einem, der im Freien schläft', 'bis {{alert.standTo}}', 'Steht auf.'],
            ],
            foot: 'Essen geht er erst bei {{need.criticalPct}}% Energie. Wildtiere zählen erst, wenn mit ihnen gekämpft wird. Im Modus Ignorant gilt die Regel nicht, und ein Bedürfnisbefehl geht vor.',
          },
        },
        {
          h: 'Religion und Soziale Motivation',
        },
        {
          table: {
            head: ['Tätigkeit', 'Dauer', 'Bringt'],
            rows: [
              [
                'Gebet',
                '{{pray.seconds}} s',
                '+{{pray.pct}}% Religion. Wiederholt bis 100%, außer Energie oder Kondition fallen auf {{need.drivePct}}%.',
              ],
              [
                'Gespräch',
                '{{talk.shortSeconds}}-{{talk.longSeconds}} s',
                'Bis +{{talk.pct}}% Soziale Motivation.',
              ],
              ['Balken zu Hause auffüllen, verheiratet', '-', 'Soziale Motivation 100%.'],
            ],
            num: [1],
          },
        },
      ],
      see: [
        'article:food',
        'article:health',
        'article:draughts',
        'article:religion',
        'article:walking',
        'article:stances',
      ],
    },
    {
      id: 'food',
      name: 'Essen',
      lead: 'Als Nahrung zählen Brot, Fleisch und Fisch. Zu Hause bringt dieselbe Mahlzeit doppelt so viel Energie.',
      blocks: [
        {
          h: 'Was eine Mahlzeit bringt',
        },
        {
          table: {
            head: ['Mahlzeit', 'Energie außer Haus', 'Energie zu Hause', 'Soziale Motivation'],
            rows: [
              ['[[good:bread|Nahrung]]', '+{{meal.plainPct}}%', '+{{meal.plainHomePct}}%', '-'],
              [
                '[[good:candy|Kuchen]]',
                '+{{meal.candyPct}}%',
                '+{{meal.candyHomePct}}%',
                '+{{meal.candyCompanyPct}}%',
              ],
              ['Reifer Beerenstrauch', '+{{meal.plainPct}}%', '-', '-'],
            ],
            num: [1, 2, 3],
            foot: 'Eine Mahlzeit dauert {{meal.seconds}} s und verbraucht 1 Stück. Soldaten essen nicht zu Hause, und Kuchen bringt ihnen so viel wie Nahrung: +{{meal.plainPct}}%.',
          },
        },
        {
          h: 'Woher das Essen kommt',
        },
        {
          table: {
            head: ['Ware', 'Woher', 'Zählt als'],
            rows: [
              [
                '[[good:bread|Brot]]',
                '[[building:work_bakery_00|Bäckerei 1]], [[building:work_bakery_01|Bäckerei 2]]',
                'Nahrung',
              ],
              ['[[good:candy|Kuchen]]', '[[building:work_bakery_01|Bäckerei 2]]', 'Kuchen'],
              [
                '[[good:meat|Fleisch]]',
                '[[building:work_animal_farm|Viehzüchterei]], [[job:hunter|Jäger]]',
                'Nahrung',
              ],
              ['[[good:fish|Fisch]]', '[[job:fisher|Fischer]]', 'Nahrung'],
            ],
            foot: 'Siedler essen auch aus dem Werkstattregal. Im Lager nehmen sie zuerst Nahrung, Kuchen nur, wenn keine Nahrung da ist. Einen reifen Strauch essen sie an Ort und Stelle leer.',
          },
        },
        {
          h: 'Wo ein Siedler isst',
        },
        {
          steps: [
            'Eigene Speisekammer, wenn die Haustür höchstens {{reach.walk}} Schritte entfernt ist.',
            'Nächstes Lager, nächste Werkstatt oder nächster Haufen im Umkreis von {{reach.goods}} Schritten, oder ein reifer Strauch näher als {{reach.bushAtHand}} Schritte.',
            'Nächster reifer Strauch im Umkreis von {{reach.goods}} Schritten.',
            'Nächstes Essen irgendwo in Gehreichweite, auch das ferne eigene Wohnhaus.',
          ],
        },
        {
          p: 'Speisekammern anderer Familien und Vorräte anderer Spieler sind tabu, Sträucher gehören niemandem. [[article:roads|Wegweiser]] erweitern diese Reichweiten. Was unter dem [[article:hauling|Lagerminimum]] liegt, isst niemand und trägt niemand nach Hause.',
        },
        {
          h: 'Lieferung in die Speisekammer',
        },
        {
          steps: [
            'Eine [[job:woman|Frau]] mit fertigem Wohnhaus sucht das nächste Essen außerhalb von Wohnhäusern.',
            'Sie trägt 1 Stück nach Hause, die Speisekammer nimmt es als Nahrung oder Kuchen an.',
            'Mit [[good:crockery|Geschirr]] im Haus wird aus 1 geliefertem Stück 2 Stück in der Speisekammer.',
          ],
        },
        {
          p: 'Eine Frau ohne andere Aufgabe liefert, bis die Speisekammer voll ist. Grenzen der Speisekammer: [[article:family|Familie und Wohnhaus]].',
        },
      ],
      see: ['article:needs', 'article:family', 'article:gathering', 'good:bread', 'good:candy'],
    },
    {
      id: 'health',
      name: 'Gesundheit und Heilung',
      lead: 'Ein Mensch hat {{health.human}} Gesundheit, und die volle Gesundheit kehrt von selbst in {{health.regenMinutes}} Minuten zurück.',
      blocks: [
        {
          h: 'Was die Gesundheit ändert',
        },
        {
          table: {
            head: ['Quelle', 'Änderung', 'Bedingung', '{{health.human}} Gesundheit in'],
            rows: [
              [
                'Regeneration',
                '+{{health.regenPerSecond}}/s',
                'Energie über 0%, auch im Kampf',
                '{{health.regenWholeMin}} Min. {{health.regenRestSec}} s',
              ],
              [
                '[[article:religion|Tempelaura]]',
                '+{{aura.perSecond}}/s',
                '{{aura.range}} Schritte vom [[building:work_temple|Tempel]]',
                '{{aura.wholeMin}} Min. {{aura.restSec}} s',
              ],
              [
                'Heiltrank',
                '+{{draught.healSip}} je Schluck',
                'Wunde senkt unter {{draught.healBelow}}',
                '-',
              ],
              [
                'Hunger',
                '-{{health.starvePerSecond}}/s',
                'Energie 0%',
                '{{health.starveWholeMin}} Min. {{health.starveRestSec}} s',
              ],
            ],
            num: [1, 3],
            foot: 'Regeneration und Aura addieren sich auf {{aura.totalPerSecond}} pro Sekunde. Regeneration endet bei {{health.human}}, die Aura heilt darüber hinaus bis {{aura.ceiling}}. Kinder und Helden haben ebenfalls {{health.human}} und regenerieren.',
          },
        },
        {
          p: 'Bei {{health.nearDeath}} Gesundheit meldet das Spiel, dass der Siedler im Sterben liegt.',
        },
        {
          h: 'Heiltränke',
        },
        {
          list: [
            'Der [[good:potion_heal_small|Kleine Heiltrank]] hat {{draught.smallUses}} Schlucke, zusammen {{draught.healSmallTotal}}. Der [[good:potion_heal_big|Große Heiltrank]] hat {{draught.bigUses}} Schlucke, zusammen {{draught.healBigTotal}}.',
            'Der Siedler trinkt Schluck für Schluck, bis ihm die Wunde mindestens {{draught.healBelow}} Gesundheit lässt.',
            'Ein tödlicher Schlag tötet nicht, wenn die Schlucke die Wunde abdecken.',
            'Auch Hunger löst das Trinken aus, sobald die Gesundheit unter {{draught.healBelow}} fällt.',
            'Zuerst die angebrochene Flasche, dann die kleine, dann die große.',
          ],
        },
      ],
      see: ['article:draughts', 'article:needs', 'article:religion', 'good:potion_heal_small'],
    },
    {
      id: 'life',
      name: 'Leben und Tod',
      lead: 'Ein Kind ist {{age.adultMinutes}} Minuten nach der Geburt erwachsen. Erwachsene leben, solange sie Gesundheit haben.',
      blocks: [
        {
          h: 'Lebensabschnitte',
        },
        {
          table: {
            head: ['Abschnitt', 'Alter', 'Seit Geburt', 'Hinweise'],
            rows: [
              [
                'Baby',
                '0-{{age.babyLastYear}} Jahre',
                '0-{{age.childWholeMin}} Min. {{age.childRestSec}} s',
                'Schritt doppelt so langsam.',
              ],
              [
                'Kind',
                '{{age.childYears}}-{{age.childLastYear}} Jahre',
                '{{age.childWholeMin}} Min. {{age.childRestSec}} s-{{age.adultMinutes}} Min.',
                'Schritt {{step.childExtra}} s langsamer. Läuft ums Haus.',
              ],
              [
                'Erwachsen',
                'ab {{age.adultYears}} Jahren',
                'ab {{age.adultMinutes}} Min.',
                'Ein Junge wird [[job:civilist|Zivilist]], ein Mädchen [[job:woman|Frau]].',
              ],
            ],
            foot: 'Ein Lebensjahr dauert {{age.yearSeconds}} s. Ein Zivilist ohne Beruf wartet auf eine Zuweisung.',
          },
        },
        {
          h: 'Was nach dem Tod bleibt',
        },
        {
          table: {
            head: ['Sache', 'Was damit passiert'],
            rows: [
              ['Getragene Ware', 'Fällt vollständig zu Boden.'],
              [
                '[[good:shoes|Schuhe]], Werkzeug',
                'Fallen als neu zu Boden, wenn höchstens zu {{death.newWearPct}}% abgenutzt. Sonst verloren.',
              ],
              ['Waffe', 'Fällt nur bei Soldaten zu Boden.'],
              ['Rüstung', 'Fällt immer zu Boden.'],
              ['Getränke, Amulette', 'Amulette und unangebrochene Flaschen fallen zu Boden.'],
              ['Karren des Trägers', 'Bleibt mit der Ladung stehen.'],
              ['Körper', 'Ein Mensch hinterlässt Knochen, ein Tier [[article:wildlife|Fleisch]].'],
            ],
          },
        },
        {
          p: 'Entdeckte [[article:trades|Berufe]] bleiben dem Dorf erhalten. Folgen für den Ehepartner: [[article:family|Familie und Wohnhaus]].',
        },
      ],
      see: ['article:family', 'article:health', 'article:trades'],
    },
    {
      id: 'family',
      name: 'Familie und Wohnhaus',
      lead: 'Ein Kind kostet {{family.childFood}} Stück Essen aus der Speisekammer, und ein Paar hat jeweils nur ein Kind.',
      blocks: [
        {
          h: 'Wohnhaus zuweisen',
        },
        {
          list: [
            'Ein Wohnhaus bekommt man nur mit dem Befehl „Wohnhaus zuweisen“. Niemand zieht von selbst ein, die Hochzeit bringt nur den Ehepartner mit.',
            'Ein Wohnhaus fasst so viele Familien, wie die Spalte Familien der Stufentabelle angibt. Bei vollem Haus wirkt der Befehl nicht.',
            'Eine neue Zuweisung zieht die ganze Familie um: Siedler, Ehepartner und heranwachsendes Kind.',
          ],
        },
        {
          h: 'Hochzeit',
        },
        {
          list: [
            'Geheiratet wird nur auf den Befehl Heirate. Von selbst finden sich keine Paare.',
            'Der Befehl verbindet den Siedler mit der nächsten erwachsenen Person des anderen Geschlechts, vom selben Stamm und Spieler.',
            'Der Partner muss in der [[article:roads|Wegweiser]]-Reichweite des Siedlers sein. Sonst verfällt der Befehl, und das Spiel meldet „Kein Partner“.',
            'Soldaten, Helden, Kundschafter und Siedler auf dem Weg in [[building:barracks|Kaserne]] oder [[building:school|Schule]] heiraten nicht.',
            'Das Paar wohnt im Haus der Frau. Hat sie keines, im Haus des Mannes.',
          ],
        },
        {
          h: 'Kind',
        },
        {
          steps: [
            'Der Spieler wählt: Bekomme einen Jungen oder Bekomme ein Mädchen.',
            'Die Frau holt Essen, wenn weniger als {{family.childFood}} Stück in der Speisekammer sind.',
            'Beide gehen ins Haus.',
            'Die Speisekammer verliert {{family.childFood}} Stück.',
            'Das Kind kommt bei Wikingern nach {{family.birthVikingSeconds}} s zur Welt, bei den übrigen Stämmen nach {{family.birthOtherSeconds}} s.',
          ],
        },
        {
          table: {
            head: ['Was das Kind verhindert', 'Lösung'],
            rows: [
              ['Die Frau hat kein Wohnhaus', 'Weise eines zu.'],
              ['Das Wohnhaus ist im Bau', 'Baue es fertig.'],
              [
                'Der Mann ist Soldat, [[job:trader|Händler]] oder [[job:scout|Kundschafter]]',
                'Wechsle seinen Beruf.',
              ],
              ['Die Eheleute wohnen getrennt', 'Weise ihnen dasselbe Wohnhaus zu.'],
              ['Kein Essen in Reichweite', 'Bringe Essen in ein nahes Lager.'],
            ],
          },
        },
        {
          p: 'Das nächste Kind ist möglich, wenn das vorige erwachsen ist, also nach {{age.adultMinutes}} Minuten. Ein Kind belegt keinen Familienplatz im Haus.',
        },
        {
          h: 'Stufen des Wohnhauses',
        },
        {
          figure: {
            id: 'home-levels',
            caption: 'Stufen des Wohnhauses',
          },
        },
        {
          data: 'homes',
        },
        {
          p: 'Die Speisekammer hat getrennte Grenzen für Nahrung und Kuchen: Wohnhaus 1 fasst {{home.larder}} + {{home.candyLarder}} Stück. Eine Familie sind ein Erwachsener, sein Ehepartner und ein heranwachsendes Kind. Das Wohnhaus kann zu jedem Stamm des Spielers gehören.',
        },
        {
          h: 'Hausausstattung',
        },
        {
          table: {
            head: ['Ware', 'Ab', 'Bringt', '1 Stück reicht für', 'Frau holt unter'],
            rows: [
              [
                '[[good:crockery|Geschirr]]',
                'Wohnhaus 1',
                'Essenslieferung bringt 2 Stück',
                '{{home.crockeryDeliveries}} Lieferungen',
                '{{home.crockeryFetchBelow}}',
              ],
              [
                '[[good:furniture|Möbel]]',
                'Wohnhaus 1',
                'Schlaf ×2',
                '{{home.furnitureManSleeps}} Schlafphasen Mann, {{home.furnitureWomanSleeps}} Frau',
                '{{home.furnitureFetchBelow}}',
              ],
              [
                '[[good:holy_oil|Öl]]',
                'Wohnhaus 3',
                '[[article:religion|Heiliges Feuer]]: Gebet vor dem Haus',
                '{{oil.wholeMin}} Min. {{oil.restSec}} s',
                '{{home.oilFetchBelow}}',
              ],
            ],
            num: [4],
            foot: 'Ein Wohnhaus fasst bis zu {{home.wareUnits}} Stück jeder dieser Waren. Öl brennt ohne Pause, auch wenn niemand betet.',
          },
        },
        {
          p: 'Im Wohnhaus-Panel schaltest du für das ganze Dorf Geschirr, Möbel und Öllieferungen ab. Schon eingelagertes Öl brennt weiter.',
        },
        {
          h: 'Wer sein Wohnhaus verliert',
        },
        {
          table: {
            head: ['Wer', 'Was passiert'],
            rows: [
              ['Witwer', 'Verliert es, wenn das Kind erwachsen oder gestorben ist.'],
              ['Witwe', 'Bleibt wohnen.'],
              ['Erwachsenes Kind', 'Verliert es, sobald es erwachsen ist.'],
              ['Alle Bewohner', 'Verlieren es beim Abriss.'],
              ['Ganze Familie', 'Verliert es durch den Befehl Ziehe aus Wohnhaus aus.'],
              [
                'Händler, Kundschafter, Soldat',
                'Das Wohnhaus bleibt der Familie, er selbst isst und schläft dort nicht.',
              ],
            ],
          },
        },
      ],
      see: [
        'article:life',
        'article:food',
        'article:religion',
        'article:assistant',
        'building:home_level_00',
        'good:crockery',
        'good:furniture',
      ],
    },
    {
      id: 'assistant',
      name: 'Assistent',
      lead: 'Zähler bestellen Kinder und Rekruten, Schalter verteilen Ausrüstung aus dem Lager.',
      blocks: [
        {
          h: 'Zähler',
        },
        {
          table: {
            head: ['Zähler', 'Bestellt', 'Wer es tut', 'Sinkt', 'Endlos'],
            rows: [
              ['Töchter', 'Mädchen', 'Ehefrau mit Wohnhaus', 'bei der Geburt', 'nein'],
              ['Söhne', 'Jungen', 'Ehefrau mit Wohnhaus', 'bei der Geburt', 'ja'],
              ['Unbewaffnete Soldaten', 'Rekrut', '[[job:civilist|Zivilist]]', 'nach der Ausbildung', 'ja'],
              [
                'Schwertkämpfer, Speerträger, Bogenschützen',
                'Bewaffnung, dann Rekrut',
                'unbewaffneter Soldat, dann Zivilist',
                'wenn er die Waffe nimmt',
                'ja',
              ],
            ],
            foot: 'Bereich 0-{{assistant.counterMax}}, anfangs 0. Ein Befehl an eine einzelne Person geht dem Assistenten vor. Reihenfolge der Waffen und Rüstungen: [[article:equip|Soldaten ausrüsten]].',
          },
        },
        {
          h: 'Schalter',
        },
        {
          table: {
            head: ['Schalter', 'Anfangs', 'Empfänger'],
            rows: [
              ['[[good:shoes|Schuhe]]', 'an', 'erwachsene Männer'],
              [
                'Eisenwerkzeug, Holzwerkzeug',
                'an',
                'Berufstätige, außer Soldat, [[job:scout|Kundschafter]] und Zivilist',
              ],
              ['[[good:mead|Met]]', 'an', 'Zivilisten, Soldaten'],
              ['Nahrungstränke, Wachtränke, Heiltränke', 'aus', 'Zivilisten, Soldaten'],
              [
                'Nahrungsamulett, Wachbleibamulett, Stärkeamulett, Verteidigungsamulett, Trefferamulett, Windamulett',
                'aus',
                'Zivilisten, Soldaten',
              ],
              [
                'Schulabgänger automatisch Werkstätten zuweisen',
                'aus',
                'Absolventen der [[building:school|Schule]]',
              ],
              ['Abbauer versetzen ihre Fahne automatisch', 'an', '[[job:collector|Abbauer]] mit Fahne'],
            ],
            foot: 'Bei Getränken und Amuletten wählen die Knöpfe „Zivilisten“ und „Soldaten“ die Empfänger, anfangs sind beide an. Abschalten nimmt nichts weg: Wer etwas hat, behält es.',
          },
        },
        {
          h: 'Geburten',
        },
        {
          list: [
            'Zuerst Töchter, dann Söhne. Töchter haben kein ∞, sonst kämen die Söhne nie an die Reihe.',
            'Zähler 3 bedeutet höchstens 3 Paare gleichzeitig.',
            'Ein Paar nimmt immer nur eine Bestellung an. Es gelten dieselben Hindernisse wie beim Befehl: [[article:family|Familie und Wohnhaus]].',
            'Einen Zähler zu senken nimmt einem Paar die laufende Bestellung nicht weg.',
          ],
        },
        {
          h: 'Einberufung in die Kaserne',
        },
        {
          list: [
            'Es geht nur ein erwachsener Zivilist ohne Arbeitsplatz und ohne Auftrag, Unverheiratete zuerst. Niemand wird von der Arbeit geholt.',
            'Ein Klassenzähler bewaffnet zuerst einen unbewaffneten Soldaten, wenn eine Waffe in seiner Reichweite liegt.',
          ],
        },
        {
          table: {
            head: ['Was die Einberufung stoppt', 'Was zu tun ist'],
            rows: [
              ['Keine fertige [[building:barracks|Kaserne]]', 'Baue die Kaserne fertig.'],
              ['Kein freier Zivilist', 'Schicke jemanden von Hand in die Kaserne.'],
              [
                'Ein unbewaffneter Soldat wartet auf eine Waffe dieser Klasse',
                'Liefere die Waffe. Bis dahin belegt er den Platz eines neuen Rekruten.',
              ],
            ],
            foot: 'Höchstens {{assistant.draftsPerSecond}} Personen pro Sekunde. Rekruten unterwegs zählen mit, ein verlorener Rekrut kehrt in die Warteschlange zurück.',
          },
        },
        {
          h: 'Verteilung',
        },
        {
          list: [
            'Übergeht Frauen, Kinder, [[article:heroes|Helden]] und die Turmbesatzung.',
            'Ein Gang zum Lager, dort nimmt der Siedler den Rest gleich mit.',
            'Für jedes Stück im Lager geht ein Siedler los. Vorrat unter dem [[article:hauling|Lagerminimum]] bleibt liegen.',
            'Füllt nur leere Plätze und tauscht nichts gegen Besseres. Eisenwerkzeug geht vor Holzwerkzeug, die große Flasche vor der kleinen.',
            'Wer einen kleinen Trank hat, holt keinen großen. Es gibt {{amulet.slots}} Plätze für Getränke und Amulette: [[article:draughts|Getränke und Amulette]].',
          ],
        },
        {
          h: 'Schulabgänger',
        },
        {
          list: [
            'Der Absolvent geht einmal zum nächsten freien Platz seines Berufs, auch auf die Baustelle einer Werkstatt. Eine Werkstatt mit dem Kursprodukt geht einer näheren vor.',
            'Ohne freien Platz wartet er an der Schule. [[job:collector|Abbauer]], [[job:hunter|Jäger]], [[job:fisher|Fischer]] und Soldaten sind ausgenommen.',
          ],
        },
        {
          p: 'Die Fahne folgt dem Rohstoff, {{assistant.flagMin}}-{{assistant.flagMax}} Schritte davon entfernt: [[article:work-flag|Arbeitsfahne]].',
        },
        {
          p: 'Das Fenster „Untertanen“ zählt, was fehlt: Wohnhaus, Arbeitsplatz, Werkzeug, Schuhe, Partner, Kinder, Waffen, Met.',
        },
      ],
      see: [
        'article:family',
        'article:equip',
        'article:draughts',
        'article:tools',
        'article:work-flag',
        'building:barracks',
      ],
    },
    {
      id: 'draughts',
      name: 'Getränke und Amulette',
      lead: 'Ein Siedler trinkt an Ort und Stelle und unterbricht dabei nichts. Ein Amulett nutzt sich nicht ab.',
      blocks: [
        {
          h: 'Getränke',
        },
        {
          table: {
            head: ['Getränk', 'Schlucke', 'Je Schluck', 'Trinkt, wenn'],
            rows: [
              [
                '[[good:mead|Met]]',
                '{{draught.meadUses}}',
                '+{{draught.meadPct}}% Energie und +{{draught.meadPct}}% Kondition',
                'Energie oder Kondition bei höchstens {{need.drivePct}}%',
              ],
              [
                '[[good:potion_food_small|Kleiner]] / [[good:potion_food_big|Großer Nahrungstrank]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '+{{draught.potionPct}}% Energie',
                'Energie bei höchstens {{need.drivePct}}%',
              ],
              [
                '[[good:potion_stamina_small|Kleiner]] / [[good:potion_stamina_big|Großer Wachtrank]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '+{{draught.potionPct}}% Kondition',
                'Kondition bei höchstens {{need.drivePct}}%',
              ],
              [
                '[[good:potion_heal_small|Kleiner]] / [[good:potion_heal_big|Großer Heiltrank]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '+{{draught.healSip}} Gesundheit',
                'Wunde senkt unter {{draught.healBelow}} Gesundheit',
              ],
            ],
            num: [1],
            foot: 'Ein Befehl zum Essen oder Schlafen hält das Trinken an.',
          },
        },
        {
          h: 'Amulette',
        },
        {
          table: {
            head: ['Amulett', 'Wirkung', 'Wann'],
            rows: [
              [
                '[[good:amulet_food|Nahrungsamulett]]',
                '+{{amulet.needPct}}% Energie',
                'jedes Mal, wenn die Energie auf höchstens {{need.drivePct}}% steht',
              ],
              [
                '[[good:amulet_stamina|Wachbleibamulett]]',
                '+{{amulet.needPct}}% Kondition',
                'jedes Mal, wenn die Kondition auf höchstens {{need.drivePct}}% steht',
              ],
              [
                '[[good:amulet_strength|Stärkeamulett]]',
                'verursachter Schaden ×{{amulet.strengthFactor}}',
                'jeder Schlag',
              ],
              [
                '[[good:amulet_crithit|Trefferamulett]]',
                '{{amulet.critChancePct}}% Chance auf Schaden ×{{amulet.critFactor}}',
                'jeder Schlag',
              ],
              [
                '[[good:amulet_defense|Verteidigungsamulett]]',
                'erlittener Schaden ×{{amulet.defenseFactor}}',
                'jeder erlittene Schlag',
              ],
              [
                '[[good:amulet_speed|Windamulett]]',
                'Schritt {{step.amuletSaved}} s schneller',
                'jeder Schritt',
              ],
            ],
          },
        },
        {
          h: 'Mehrere zugleich',
        },
        {
          list: [
            'Ein zweites gleiches Amulett bringt nichts.',
            'Verschiedene Amulette wirken zusammen: Stärke und Treffer ergeben bei erfolgreichem Wurf ×{{amulet.comboFactor}}.',
            'Reihenfolge beim Bedürfnis: angebrochene Flasche, Amulett, Flasche mit weniger Schlucken.',
            'Met, der wegen der Energie getrunken wird, füllt auch die Kondition.',
            'Mit Nahrungsamulett sucht der Siedler kein Essen, mit Wachbleibamulett geht er nicht schlafen.',
          ],
        },
        {
          h: 'Wer sie trägt',
        },
        {
          table: {
            head: ['Wer', 'Was er trägt'],
            rows: [
              ['Erwachsener Mann', '{{amulet.slots}} Plätze für Getränke und Amulette, in jedem Beruf.'],
              [
                '[[article:heroes|Held]]',
                'Heiltränke sowie Stärke-, Treffer-, Verteidigungs- und Windamulett.',
              ],
              ['Frau, Kind', 'Nichts.'],
            ],
          },
        },
      ],
      see: ['article:needs', 'article:health', 'article:damage', 'article:walking'],
    },
  ],
};
