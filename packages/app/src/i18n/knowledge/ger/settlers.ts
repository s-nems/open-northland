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
          p: 'Die Lobby-Einstellung „Bedürfnisse der Siedler: Deaktiviert“ hält die Balken an und schaltet den Hunger ab.',
        },
        {
          h: 'Balken',
        },
        {
          table: {
            head: ['Balken', 'Sinkt mit der Zeit', 'Sinkt bei Arbeit', 'Füllt auf', 'Bei 0%'],
            rows: [
              [
                'Energie',
                '100% in {{need.drainMinutes}} Min.',
                'ja',
                '[[article:food|Mahlzeit]]',
                '[[article:health|stirbt nach {{health.starveTime}}]]',
              ],
              [
                'Kondition',
                '100% in {{need.drainMinutes}} Min.',
                'ja',
                'Schlaf',
                'nichts weiter, der Schritt wird schon ab {{need.drivePct}}% langsamer',
              ],
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
                'stellt keine Waffen und Rüstungen her',
              ],
            ],
            foot: 'Beim Kartenstart steht jeder Balken zufällig auf {{need.startMinPct}}-100%. Ohne [[good:shoes|Schuhe]] kosten {{need.barefootSampleSteps}} Schritte {{need.barefootRoadPct}}% Energie auf der Straße, {{need.barefootLandPct}}% auf Land und bis zu {{need.barefootMaxPct}}% auf dem schwierigsten Gelände, mit Last doppelt so viel.',
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
                'Obergrenze. Eine Mahlzeit oder Schlaf zu Hause kann Vorrat über 100% anlegen.',
              ],
            ],
          },
        },
        {
          h: 'Schlaf',
        },
        {
          table: {
            head: ['Wer', 'Schlafdauer', 'Kondition je Schlaf: außer Haus', 'zu Hause'],
            rows: [
              ['Mann', '{{sleep.manSeconds}} s', '+{{sleep.manAwayPct}}%', '+{{sleep.manHomePct}}%'],
              [
                '[[job:woman|Frau]]',
                '{{sleep.womanSeconds}} s',
                '+{{sleep.womanAwayPct}}%',
                '+{{sleep.womanHomePct}}%',
              ],
              [
                'Händler, Kundschafter (immer wie zu Hause)',
                '{{sleep.manSeconds}} s',
                '+{{sleep.manHomePct}}%',
                '-',
              ],
              ['Soldat (wo immer er schläft)', '{{sleep.soldierSeconds}} s', '+{{sleep.soldierPct}}%', '-'],
            ],
            num: [1, 2, 3],
          },
        },
        {
          h: 'Ausnahmen',
        },
        {
          table: {
            head: ['Wer', 'Balken'],
            rows: [
              ['Baby, Kind', 'Keine. Erwachsene starten mit 100% auf jedem Balken.'],
              ['[[article:heroes|Held]]', 'Keine.'],
              ['Monster, Tiere', 'Keine.'],
              ['Soldat', 'Ohne Soziale Motivation.'],
              ['Mitfahrer im Karren', 'Balken sinken nicht, Gesundheit bleibt gleich.'],
              [
                'Passagier auf dem Schiff',
                'Trinkt zuerst, was er bei sich hat. Ist das Schiff angedockt, geht er zum Essen an Land, auf See isst er aus dem Frachtraum. Schläft wie außer Haus, redet. Betet erst wieder an Land.',
              ],
            ],
          },
        },
        {
          h: 'Religion und Soziale Motivation',
        },
        {
          p: 'Ein Siedler betet, bis die Religion 100% erreicht oder Energie oder Kondition auf {{need.drivePct}}% fallen. Wer betet, wo und was es bringt: [[article:religion|Religion und Tempel]].',
        },
        {
          table: {
            head: ['Tätigkeit', 'Dauer', 'Bringt'],
            rows: [
              [
                'Gespräch',
                '{{talk.shortSeconds}}-{{talk.longSeconds}} s',
                'Bis +{{talk.pct}}% Soziale Motivation.',
              ],
              ['Aufenthalt zu Hause, wenn der Siedler verheiratet ist', '-', 'Soziale Motivation 100%.'],
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
      lead: 'Nahrung sind Brot, Fleisch und Fisch. Eine zu Hause gegessene Mahlzeit bringt {{home.factor}}-mal so viel Energie.',
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
          p: 'Ein Siedler isst auch aus dem Vorrat einer Werkstatt. Im Lager nimmt er zuerst Nahrung, danach Kuchen.',
        },
        {
          h: 'Wo ein Siedler isst',
        },
        {
          steps: [
            'Eigene Speisekammer, wenn die Haustür höchstens {{reach.walk}} Hexfelder entfernt ist.',
            'Nächstes Lager, nächste Werkstatt oder nächster Haufen im Umkreis von {{reach.goods}} Hexfeldern, oder ein reifer Strauch näher als {{reach.bushAtHand}} Hexfelder.',
            'Nächster reifer Strauch im Umkreis von {{reach.goods}} Hexfeldern.',
            'Nächstes Essen, wohin der Siedler auch gehen kann, auch das eigene Wohnhaus, wenn es weiter weg ist.',
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
            'Eine [[job:woman|Frau]] mit fertigem Wohnhaus holt zuerst das nächste [[good:meat|Fleisch]], etwa aus einer [[building:work_animal_farm|Viehzüchterei]], sonst das nächste Essen außerhalb von Wohnhäusern.',
            'Sie trägt {{haul.carry}} Stück nach Hause.',
            'Mit [[good:crockery|Geschirr]] im Haus bringt jede Lieferung {{haul.crockeryDelivery}} Stück in die Speisekammer.',
          ],
        },
        {
          p: 'Die Frau bringt Essen, bis die Speisekammer voll ist. Grenzen: [[article:family|Familie und Wohnhaus]].',
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
            head: ['Quelle', 'Änderung', 'Bedingung', 'Zeit für {{health.human}} Gesundheit'],
            rows: [
              [
                'Regeneration',
                '+{{health.regenPerSecond}}/s',
                'Energie über 0%, auch im Kampf',
                '{{health.regenTime}}',
              ],
              [
                '[[article:religion|Tempelaura]]',
                '+{{aura.perSecond}}/s',
                '{{aura.range}} Hexfelder vom [[building:work_temple|Tempel]]',
                '{{aura.time}}',
              ],
              ['Hunger', '-{{health.starvePerSecond}}/s', 'Energie 0%', '{{health.starveTime}}'],
            ],
            num: [1, 3],
            foot: 'Zusammen ergibt das {{aura.totalPerSecond}} pro Sekunde. Regeneration endet bei {{health.human}}, die Aura heilt aber darüber hinaus bis {{aura.ceiling}}.',
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
            'Der [[good:potion_heal_small|Kleine Heiltrank]] hat {{draught.smallUses}} Schlucke, zusammen {{draught.healSmallTotal}} Gesundheit. Der [[good:potion_heal_big|Große Heiltrank]] hat {{draught.bigUses}} Schlucke, zusammen {{draught.healBigTotal}} Gesundheit.',
            'Würde ein Treffer die Gesundheit unter {{draught.healBelow}} drücken, trinkt der Siedler sofort Schluck für Schluck, bis er wieder mindestens {{draught.healBelow}} hat oder der Trank leer ist.',
            'Ein tödlicher Schlag tötet nicht, wenn die Schlucke die Wunde abdecken.',
            'Auch Hunger löst das Trinken aus, sobald die Gesundheit unter {{draught.healBelow}} fällt.',
          ],
        },
      ],
      see: ['article:draughts', 'article:needs', 'article:religion', 'good:potion_heal_small'],
    },
    {
      id: 'family',
      name: 'Familie und Wohnhaus',
      lead: 'Für die Geburt eines Kindes braucht es {{family.childFood}} Stück Essen.',
      blocks: [
        {
          h: 'Wohnhaus zuweisen',
        },
        {
          list: [
            'Ein Wohnhaus bekommt man nur mit dem Befehl „Wohnhaus zuweisen“. Niemand zieht von selbst ein, die Hochzeit bringt nur den Ehepartner mit.',
            'Ein Wohnhaus fasst so viele Familien, wie die Spalte Familien der Stufentabelle angibt, mit [[good:furniture|Möbeln]] mehr. Bei vollem Haus wirkt der Befehl nicht.',
            'Eine neue Zuweisung zieht die ganze Familie um: Siedler, Ehepartner und heranwachsendes Kind.',
          ],
        },
        {
          h: 'Hochzeit',
        },
        {
          list: [
            'Geheiratet wird nur auf den Befehl „Heirate“.',
            'Der Befehl verbindet den Siedler mit der nächsten erwachsenen Person des anderen Geschlechts, vom selben Stamm und Spieler. Eine Frau nimmt einen Mann mit Beruf vor einem Zivilisten.',
            'Der Partner muss in der [[article:roads|Wegweiser]]-Reichweite des Siedlers sein. Sonst verfällt der Befehl, und das Spiel meldet „Kein Partner“.',
            'Soldaten, Helden, Kundschafter und Siedler auf dem Weg in [[building:barracks|Kaserne]] oder [[building:school|Schule]] heiraten nicht.',
            'Das Paar wohnt im Haus der Frau. Hat sie keines, im Haus des Mannes.',
          ],
        },
        {
          h: 'Aufwachsen',
        },
        {
          table: {
            head: ['Abschnitt', 'Alter', 'Seit Geburt'],
            rows: [
              ['Baby', 'unter {{age.childYears}} Jahren', '0-{{age.childTime}}'],
              ['Kind', '{{age.childYears}}-{{age.adultYears}} Jahre', '{{age.childTime}}-{{age.adultTime}}'],
              ['Erwachsen', 'ab {{age.adultYears}} Jahren', 'ab {{age.adultTime}}'],
            ],
            foot: 'Ein Lebensjahr dauert {{age.yearSeconds}} s, das Siedlerpanel zeigt das Alter in vollen Jahren. Ein Kind läuft ums Haus. Erwachsen wird ein Junge [[job:civilist|Zivilist]], ein Mädchen [[job:woman|Frau]]. Niemand stirbt an Altersschwäche.',
          },
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
          p: 'Die Speisekammer hat getrennte Grenzen für Nahrung und Kuchen: Wohnhaus 1 fasst {{home.larder}} + {{home.candyLarder}} Stück. Ein Siedler kann im Wohnhaus eines anderen Stammes desselben Spielers wohnen.',
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
                'Essenslieferung bringt {{haul.crockeryDelivery}} Stück',
                '{{home.crockeryDeliveries}} Lieferungen',
                '{{home.crockeryFetchBelow}}',
              ],
              [
                '[[good:furniture|Möbel]]',
                'Wohnhaus 1',
                'Platz für weitere Familien',
                '{{home.furnitureChildren}} Kinder, {{home.furnitureSleeps}} Schlafphasen oder {{home.furnitureMeals}} Mahlzeiten',
                'wenn ein Stück Vorrat fehlt',
              ],
              [
                '[[good:holy_oil|Öl]]',
                'Wohnhaus 3',
                '[[article:religion|Heiliges Feuer]]: Gebet vor dem Haus',
                '{{oil.burnTime}}',
                '{{home.oilFetchBelow}}',
              ],
            ],
            num: [4],
            foot: 'Ein Wohnhaus fasst bis zu {{home.wareUnits}} Stück Geschirr und ebenso viel Öl. An Möbeln hält es je weitere Familie, die es aufnehmen kann, ein Stück Vorrat. Öl brennt ohne Pause, auch wenn niemand betet.',
          },
        },
        {
          list: [
            'Ein Stück Möbel gibt Platz für eine weitere Familie, höchstens so viele, wie die Spalte Mit Möbeln der Stufentabelle angibt. Weitere Familien sind die zuletzt eingezogenen. Die Plätze bleiben, solange der Spieler Möbel erlaubt.',
            'Jede weitere Familie nutzt ihr eigenes Stück ab: wenn sie ein Kind zeugt, im Haus schläft oder aus der Speisekammer isst. Die übrigen Familien nutzen keine Möbel ab. Ist ein Stück aufgebraucht, nimmt die Familie das nächste aus dem Vorrat des Hauses.',
          ],
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
              [
                'Familie über der Grundzahl',
                'Zieht aus, wenn ihre Möbel aufgebraucht sind und das Haus keinen Vorrat hat oder wenn der Spieler Möbel verbietet, und das Spiel meldet „Ausgezogen“. Ist „Familien gründen“ an, bringt der [[article:assistant|Assistent]] sie in ein Haus mit freiem Platz.',
              ],
              [
                'Händler, Kundschafter, Soldat',
                'Das Wohnhaus bleibt der Familie, er selbst isst und schläft dort nicht.',
              ],
            ],
          },
        },
      ],
      see: [
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
      lead: 'Mit Zählern bestellst du, wie viele Kinder noch geboren und wie viele Rekruten ausgebildet werden sollen. Ein Zähler sinkt, sobald die Bestellung erfüllt ist. Schalter verteilen Ausrüstung aus dem Lager.',
      blocks: [
        {
          h: 'Zähler',
        },
        {
          table: {
            head: ['Zähler', 'Bringt', 'Wer es tut', 'Sinkt', 'Auf ∞ stellbar'],
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
            foot: 'Ein Zähler reicht von 0 bis {{assistant.counterMax}}. Ein Befehl an eine einzelne Person geht dem Assistenten vor. Reihenfolge der Waffen und Rüstungen: [[article:equip|Soldaten ausrüsten]].',
          },
        },
        {
          h: 'Schalter',
        },
        {
          table: {
            head: ['Schalter', 'Anfangs', 'Empfänger'],
            rows: [
              ['[[good:shoes|Schuhe]]', 'aus', 'erwachsene Männer'],
              [
                'Eisenwerkzeug, Holzwerkzeug',
                'aus',
                'alle Berufstätigen außer Soldat, [[job:scout|Kundschafter]] und Zivilist',
              ],
              [
                'Eisenwerkzeug: Holzwerkzeug ersetzen',
                'an',
                'Berufstätige mit Holzwerkzeug, solange Eisenwerkzeug an ist',
              ],
              ['[[good:mead|Met]]', 'aus', 'Zivilisten, Arbeiter, Soldaten'],
              ['Nahrungstränke, Wachtränke, Heiltränke', 'aus', 'Zivilisten, Arbeiter, Soldaten'],
              [
                'Nahrungsamulett, Wachbleibamulett, Stärkeamulett, Verteidigungsamulett, Trefferamulett, Windamulett',
                'aus',
                'Zivilisten, Arbeiter, Soldaten',
              ],
              [
                'Schulabgänger automatisch Werkstätten zuweisen',
                'aus',
                'Absolventen der [[building:school|Schule]]',
              ],
              ['Abbauer versetzen ihre Fahne automatisch', 'aus', '[[job:collector|Abbauer]] mit Fahne'],
              ['Familien gründen', 'aus', 'obdachlose Frau, Frau mit Wohnhaus, ausgezogene Familie'],
            ],
            foot: 'Bei Getränken und Amuletten wählen die Knöpfe „Zivilisten“ (ohne Beruf), „Arbeiter“ und „Soldaten“ die Empfänger; sind alle drei aus, ist der Schalter aus. Abschalten nimmt nichts weg, was schon ausgegeben ist. Liegt die Ware eines abgeschalteten Schalters im Lager und fehlt sie jemandem, erinnert dich eine Meldung daran, an den Fahnenschalter dann, wenn ein Abbauer an seiner Fahne nichts mehr findet.',
          },
        },
        {
          h: 'Geburten',
        },
        {
          list: [
            'Zuerst kommen Töchter zur Welt, dann Söhne. Deshalb hat der Töchterzähler kein ∞, sonst würden nie Söhne geboren.',
            'Bei Zähler 3 warten höchstens 3 Paare gleichzeitig auf ein Kind.',
          ],
        },
        {
          h: 'Familien',
        },
        {
          list: [
            'Ist „Familien gründen“ an, zieht eine obdachlose erwachsene [[job:woman|Frau]] in das nächste Wohnhaus mit freiem Platz, das sie erreichen kann.',
            'Eine Frau mit Wohnhaus bekommt den Befehl „Heirate“, sobald ein Mann frei ist. Eine obdachlose Frau heiratet nicht.',
            'Eine Familie, die mangels [[good:furniture|Möbeln]] ausziehen musste, zieht ebenfalls auf einen freien Platz, auch einen möblierten: [[article:family|Familie und Wohnhaus]].',
          ],
        },
        {
          h: 'Einberufung in die Kaserne',
        },
        {
          list: [
            'In die Kaserne geht nur ein erwachsener, unverheirateter Zivilist ohne Arbeit und ohne Beschäftigung. Der Assistent holt niemanden von der Arbeit weg.',
            'Die Zähler Schwertkämpfer, Speerträger oder Bogenschützen bewaffnen zuerst einen unbewaffneten Soldaten, wenn eine Waffe in seiner Reichweite liegt. Danach sammelt er sich an der nächsten Kaserne.',
            'Einen neuen Rekruten beruft ein solcher Zähler nur ein, solange ein Lager in Reichweite der Kaserne eine Waffe dieser Art für ihn hat. Ein Rekrut, dessen Waffe ausgegangen ist, wechselt zu einem anderen Zähler, dessen Waffe er holen kann.',
          ],
        },
        {
          table: {
            head: ['Was die Einberufung stoppt', 'Was zu tun ist'],
            rows: [
              ['Keine fertige [[building:barracks|Kaserne]]', 'Baue die Kaserne fertig.'],
              ['Kein freier Zivilist', 'Schicke jemanden von Hand in die Kaserne.'],
              [
                'Ein unbewaffneter Soldat wartet auf eine Waffe dieser Art',
                'Liefere die Waffe. Bis dahin belegt er den Platz eines neuen Rekruten.',
              ],
              [
                'Keine Waffe dieser Art in einem Lager in Reichweite der Kaserne',
                'Stelle die Waffe her oder bring sie näher heran.',
              ],
            ],
            foot: 'Ein Rekrut auf dem Weg zur Kaserne zählt schon zum Zähler.',
          },
        },
        {
          h: 'Verteilung',
        },
        {
          list: [
            'Der Assistent rüstet Frauen, Kinder, [[article:heroes|Helden]] und die Turmbesatzung nicht aus.',
            'Vorrat unter dem [[article:hauling|Lagerminimum]] verteilt der Assistent nicht.',
            'Er füllt leere Plätze, Eisenwerkzeug geht vor Holzwerkzeug. Mit „Holzwerkzeug ersetzen“ schickt er außerdem Berufstätige mit Holzwerkzeug nach Eisenwerkzeug: [[article:tools|Werkzeug]]. Sonst tauscht er nichts gegen Besseres.',
            'Ein Siedler hat {{amulet.slots}} Plätze für Getränke und Amulette: [[article:draughts|Getränke und Amulette]].',
          ],
        },
        {
          h: 'Schulabgänger',
        },
        {
          list: [
            'Der Absolvent geht auf einen freien Platz seines Berufs, auch in eine Werkstatt im Bau. Eine fertige Werkstatt geht einer Baustelle vor, eine ohne jemanden seines Berufs einer besetzten, dann eine, die das gelernte Produkt herstellt, und unter gleichen die nächste.',
            'Ohne freien Platz wartet er an der Schule. [[job:collector|Abbauer]], [[job:hunter|Jäger]], [[job:fisher|Fischer]] und Soldaten teilt der Assistent nicht zu.',
          ],
        },
        {
          p: 'Wie Abbauer ihre Fahne selbst versetzen: [[article:work-flag|Arbeitsfahne]].',
        },
        {
          p: 'Das Fenster „Untertanen“ zeigt, wie vielen Siedlern ein Wohnhaus, Arbeit, Werkzeug, Schuhe, ein Partner, Kinder, Waffen oder Met fehlen.',
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
      lead: 'Tränke trinkt ein Siedler an Ort und Stelle und unterbricht dabei nichts. Für Met hält er unterwegs an, wie zum Essen. Ein Amulett nutzt sich nicht ab.',
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
                'Energie oder Kondition fällt auf {{need.drivePct}}%',
              ],
              [
                '[[good:potion_food_small|Kleiner]] / [[good:potion_food_big|Großer Nahrungstrank]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '+{{draught.potionPct}}% Energie',
                'Energie fällt auf {{need.drivePct}}%',
              ],
              [
                '[[good:potion_stamina_small|Kleiner]] / [[good:potion_stamina_big|Großer Wachtrank]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '+{{draught.potionPct}}% Kondition',
                'Kondition fällt auf {{need.drivePct}}%',
              ],
            ],
            num: [1],
            foot: 'Heiltränke: [[article:health|Gesundheit und Heilung]].',
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
                'jedes Mal, wenn die Energie auf {{need.drivePct}}% fällt',
              ],
              [
                '[[good:amulet_stamina|Wachbleibamulett]]',
                '+{{amulet.needPct}}% Kondition',
                'jedes Mal, wenn die Kondition auf {{need.drivePct}}% fällt',
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
            'Mit Nahrungsamulett geht der Siedler nie essen, mit Wachbleibamulett nie schlafen.',
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
              ['Frau, Kind', 'Nichts.'],
            ],
            foot: 'Was ein Held trägt: [[article:heroes|Helden]].',
          },
        },
      ],
      see: ['article:needs', 'article:health', 'article:heroes', 'article:damage', 'article:walking'],
    },
  ],
};
