import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const PROBLEMS: ArticleGroup = {
  group: 'Probleme',
  items: [
    {
      id: 'why',
      name: 'Häufige Probleme',
      lead: 'Wähle das Gebäude oder den Siedler aus und lies seine Statuszeile.',
      blocks: [
        {
          h: 'Arbeit und Produktion',
        },
        {
          faq: [
            [
              'Die Werkstatt steht leer',
              'Status „Keine Arbeiter“ heißt, dass dort niemand arbeitet: Weise einen Siedler mit passendem Beruf zu. Lehnt er ab, sagt die Meldung warum: „Falscher Beruf“, „Stellen belegt“ oder „Zu unerfahren“. Status „Untätig“ nennt den fehlenden Rohstoff. Der Arbeiter geht ihn selbst holen, wenn er höchstens {{reach.goods}} Hexfelder von einem Wegweiser entfernt liegt.',
            ],
            [
              'Waffenbauer, Schmied oder Näher arbeitet nicht',
              'Wahrscheinlich steht seine Religion unter „Wohlbefinden“ auf 0%, denn Waffen und Rüstungen kosten Religion. „Will beten“ heißt, dass ein Ort zum Beten fehlt: Nötig sind ein [[building:work_temple|Tempel]], das [[building:headquarters|Hauptquartier]] oder Heiliges Feuer im Wohnhaus. Was jedes Stück kostet: [[article:religion|Religion und Tempel]].',
            ],
            [
              'Träger tragen nichts',
              'Ein Träger arbeitet nur, wenn er einen Arbeitsplatz in einem Gebäude hat. Status „Nichts zum Tragen in Reichweite“ heißt, dass bis {{flag.radius}} Hexfelder um das Gebäude oder die Arbeitsfahne keine Ware liegt, und „Kein Ziel nimmt diese Ware an“, dass die Lager voll sind.',
            ],
            [
              'Die Zucht steht',
              'Der Viehzüchter züchtet nur, wenn er genau {{livestock.pair}} erwachsene Tiere hat. Was der Status der Viehzüchterei bedeutet: [[article:livestock|Viehzucht]].',
            ],
            [
              'Der Jäger bringt nichts',
              'Status „Kein verfügbares Wild im Jagdgebiet“ heißt, dass es bis {{flag.hunter}} Hexfelder um Fahne oder Arbeitsplatz nichts zu jagen gibt. Nicht jedes Tier jagt er von selbst, siehe Spalte „Auto-Jagd“: [[article:wildlife|Wildtiere und Jagd]]. Versetze die Arbeitsfahne dorthin, wo Wild weidet.',
            ],
          ],
        },
        {
          h: 'Leute',
        },
        {
          faq: [
            [
              'Es werden keine Kinder geboren',
              'Ein Paar braucht ein gemeinsames Wohnhaus und {{family.childFood}} Stück Essen in der Speisekammer. Die Meldung sagt, was fehlt: „Kein Familienheim“, „Haus nicht fertig“, „Getrennte Haushalte“, „Keine Nahrung vorrätig“. „Ehemann abwesend“ heißt, dass der Mann Händler, Kundschafter, Soldat oder Held ist und nicht nach Hause kommt. Kinder kannst du auch mit den Zählern „Töchter“ und „Söhne“ im [[article:assistant|Assistenten]] bestellen. Mehr: [[article:family|Familie und Wohnhaus]].',
            ],
            [
              'Hunger trotz vollem Lager',
              'Prüfe das „Lagerminimum“: Unter dieser Menge nimmt niemand Ware heraus, auch nicht zum Essen. Senke das Minimum bei Essen. Vielleicht ist es auch zu weit: Das Lager muss bis {{reach.goods}} Hexfelder vom Siedler oder von einem Wegweiser in seinem Netz entfernt sein.',
            ],
            [
              'Der Beruf fehlt auf der Schulliste',
              'Die Liste zeigt nur Kurse, die entdeckt und in dieser Mission erlaubt sind. Eine Zeile, die sich nicht wählen lässt, nennt den Grund: „Bereits erlernt“ oder „Diese Siedler können an dieser Schule nicht lernen“. Kurse entdeckst du durch [[article:exp-work|Arbeitserfahrung]].',
            ],
          ],
        },
        {
          h: 'Bau und Felder',
        },
        {
          faq: [
            [
              'Das Gebäude ist gesperrt',
              'Es steht im Baufenster im Abschnitt „Gesperrt“. Der Hinweis „Benötigte Entdeckungen:“ sagt, welche Berufe und Waren nötig sind und wie viel Erfahrung dir fehlt. „In dieser Mission nicht verfügbar“: Auf dieser Karte kannst du es nicht bauen. Ein Brief aus einer Kiste setzt das Gebäude auch ohne Entdeckung: [[article:chests|Kisten und Briefe]].',
            ],
            [
              'Der Bau steht',
              'Der Baustatus sagt, was fehlt: „Material fehlt“, „Lieferung unterwegs“ oder „Kein Bauarbeiter“. „Baustelle: [Ware] fehlt“ heißt, dass die Ware in keinem Lager in Wegweiser-Reichweite der Baustelle liegt, {{reach.goods}} Hexfelder von einem Wegweiser. Der Bauarbeiter trägt das Material selbst.',
            ],
            [
              'Das Feld wächst nicht',
              'Es wächst nur, wenn es gegossen wird. Das tut ein [[job:farmer|Farmer]] auf der [[building:work_farm_00|Farm]] oder ein [[job:herb_mush_guy|Kräutergärtner]] in der [[building:work_herb_hut|Kräuterhütte]], wenn er dort seinen Arbeitsplatz hat. Er sät zuerst und gießt erst bei {{field.max}} Feldern oder wenn er nirgends mehr säen kann. Ein Feld reift nach {{field.waterings}} Mal Gießen, und einmal Gießen erfasst auch 6 Nachbarfelder. Auf Sand und auf Straßen sät er kein Feld, und er sät bis {{field.radius}} Hexfelder vom Gebäude.',
            ],
            [
              'Ändern Regen, Schnee oder Nacht etwas?',
              'Nein. Wetter, die Einstellung „Winter“ und die Tageszeit betreffen nur Bild und Ton. Langsamer geht es nur auf Sand, im Gebirge und auf Schnee, der von Anfang an auf der Karte liegt.',
            ],
          ],
        },
        {
          h: 'Militär und Fahrzeuge',
        },
        {
          faq: [
            [
              'Der Soldat greift nicht an',
              'Prüfe den Modus: [[article:stances|Soldatenmodi]]. Im Modus Ignorant geht er nicht auf den Feind zu und schlägt nur, was in Waffenreichweite ist. Er greift nur Stämme an, zu denen dein Verhältnis „Feindlich“ ist, und nur außerhalb der „Friedenszeit“.',
            ],
            [
              'Das Schiff legt nicht ab',
              'Status „Wartet auf einen Kommandanten“: Weise einen zu, das kann jeder Erwachsene sein. „Wartet auf seine Besatzung“: Jemand aus der Besatzung ist noch auf dem Weg zum Schiff. „Kein Weg“: Das Ziel liegt nicht auf diesem Wasser. Auf See steigt niemand ein, also erst „Andocken“.',
            ],
            [
              'Der Ochsenkarren steht',
              'Status „Wartet auf sein Zugtier“ heißt, dass ein Ochse fehlt. Er nimmt nur einen [[good:cattle|Ochsen]], der nicht zum Paar gehört, also brauchst du {{draught.keptPlusOne}} erwachsene Tiere in einer Viehzüchterei oder {{draught.keptPlusOne}} außerhalb: [[article:vehicles|Fahrzeuge und Schiffe]].',
            ],
          ],
        },
      ],
      see: [
        'article:notices',
        'article:walking',
        'article:hauling',
        'article:stances',
        'article:religion',
        'article:livestock',
      ],
    },
    {
      id: 'notices',
      name: 'Meldungen',
      lead: 'Eine Meldung sagt dir, was stockt. Hier findest du die Ursache und was du tun kannst.',
      blocks: [
        {
          table: {
            filter: 'Meldung suchen',
            head: ['Meldung', 'Stufe', 'Ursache', 'Was tun'],
            rows: [
              [
                '„Dorf angegriffen“',
                'Wichtig',
                'Jemand greift dein Gebäude oder deine Palisade an oder kämpft bis {{notice.settlementReach}} Hexfelder davon',
                'Schicke Soldaten',
              ],
              [
                '„Unter Angriff“',
                'Bemerkenswert',
                'Angriff weiter als {{notice.settlementReach}} Hexfelder vom Dorf entfernt',
                'Schicke Soldaten oder ziehe die Leute ab',
              ],
              [
                '„Kein Durchgang“',
                'Bemerkenswert',
                'Das Vorkommen liegt im Bereich, aber kein Weg führt hin',
                'Öffne einen Durchgang oder versetze die Fahne',
              ],
              [
                '„Kein Kommandant“',
                'Bemerkenswert',
                'Ein Fahrzeug ohne Kommandant bekam einen Fahrbefehl',
                'Weise einen Kommandanten zu',
              ],
              [
                '„Kein Handel“',
                'Bemerkenswert',
                'Das Ziel des Händlers verlangt ein beiderseits freundliches Verhältnis',
                'Prüfe die [[article:diplomacy|Diplomatie]]',
              ],
              [
                '„Kein Lager“',
                'Normal, Werkstatt: Bemerkenswert',
                'Kein Lager nimmt die Ware an',
                'Baue ein Lager oder schaffe dort Platz',
              ],
              [
                '„Stellen belegt“',
                'Bemerkenswert',
                'Das Gebäude hat keine freien Arbeitsplätze',
                'Mache einen Platz frei oder baue ein zweites solches Gebäude',
              ],
              [
                '„Kein Partner“',
                'Normal',
                'Nach dem Befehl „Heirate“ war in der Nähe niemand frei',
                'Versuch es wieder, wenn jemand frei ist',
              ],
              [
                '„Paar benötigt: [Ware]“',
                'Bemerkenswert',
                'In der [[article:livestock|Viehzüchterei]] ist nur ein Tier',
                'Schicke einen Kundschafter nach dem zweiten',
              ],
              [
                '„Kein Bauplatz“, „Bauplatz blockiert“',
                'Bemerkenswert',
                'Neben der Werkstatt ist kein freier Boden fürs Fahrzeug, beim Schiff kein Wasser in Reichweite, oder dort steht ein anderes Fahrzeug',
                'Schaffe Platz, die Werkstatt versucht es nach {{notice.yardRetrySeconds}} s wieder. Stelle eine Schiffswerkstatt dorthin, wo das Baufenster nicht vor fehlendem Wasser warnt',
              ],
              [
                '„Keine Fische“',
                'Bemerkenswert',
                'Im nahen Wasser gibt es keine Fische mehr',
                'Setze die Fahne an Wasser mit Fischen',
              ],
              [
                '„Kein Träger“',
                'Bemerkenswert',
                'An Bord ist niemand für die Ladung',
                'Schicke einen Träger oder anderen Zivilisten an Bord',
              ],
              [
                '„Kein Weg“',
                'Wichtig',
                'Das Fahrzeug hat keinen Weg zum Ziel. Das Ziel eines Schiffs liegt nicht auf diesem Wasser',
                'Wähle ein anderes Ziel',
              ],
              [
                '„Nichts im Arbeitsbereich“',
                'Bemerkenswert',
                'Im Arbeitsbereich gibt es dieses Vorkommen nicht',
                'Versetze die Arbeitsfahne oder erweitere das Wegweisernetz',
              ],
              [
                '„Keine Garnison“',
                '-',
                'Der Turm ist nicht bemannt',
                'Weise Bogenschützen zu: [[article:defence|Türme und Verteidigungsmodus]]',
              ],
              [
                '„Keine Rohstoffe“',
                'Bemerkenswert',
                'Auf der ganzen Karte gibt es nichts abzubauen',
                'Wechsle seinen Beruf',
              ],
              [
                '„Keine Tiere: [Ware]“',
                'Bemerkenswert',
                'In der [[article:livestock|Viehzüchterei]] gibt es diese Art nicht',
                'Schicke einen Kundschafter zu den Wildtieren',
              ],
              [
                '„Kein Zugtier“',
                'Bemerkenswert',
                'Dem Ochsenkarren fehlt der Ochse',
                'Halte {{draught.keptPlusOne}} erwachsene Tiere: [[article:vehicles|Fahrzeuge und Schiffe]]',
              ],
              [
                '„Kein Wild“',
                'Bemerkenswert',
                'Im Jagdgebiet gibt es kein freies Wild',
                'Versetze die Fahne dorthin, wo Wild weidet',
              ],
              [
                '„Kein Holz“ (je nach Ware), „[Ware]: nicht vorhanden“',
                'Normal, Werkstatt: Bemerkenswert',
                'Baustellen warten auf Ware, die in den Lagern in der Nähe fehlt, oder der Werkstatt fehlt ein Rohstoff, den niemand herstellt',
                'Stelle ihn her, liefere ihn oder besetze die Werkstatt',
              ],
              [
                '„Baustelle: [Ware] fehlt“',
                'Wichtig',
                'Die Ware liegt in keinem Lager in Wegweiser-Reichweite der Baustelle',
                'Stelle sie her, liefere sie oder verbinde ein Lager über Wegweiser',
              ],
              [
                '„Will beten“',
                'Bemerkenswert',
                'Religion ist auf {{need.criticalPct}}% gefallen, und es gibt keinen Ort zum Beten',
                'Baue einen [[building:work_temple|Tempel]] oder entzünde ein Heiliges Feuer',
              ],
              [
                '„Am Verhungern“',
                'Wichtig',
                'Der Siedler verliert durch Hunger Gesundheit',
                'Bringe schnell Essen in ein Lager in seiner Reichweite',
              ],
              [
                '„Hungrig“',
                'Normal',
                'Die Energie ist auf {{need.criticalPct}}% gefallen',
                'Bringe Essen in ein Lager in seiner Reichweite',
              ],
              [
                '„Land erkundet“',
                'Bemerkenswert',
                'Der Kundschafter hat alles erreichbare Land erkundet und wartet',
                'Gib einen neuen Befehl: [[article:scout|Kundschafter]]',
              ],
              [
                '„Lager zu weit weg“',
                'Normal, Werkstatt: Bemerkenswert',
                'Die Lager, die die Ware annehmen, liegen außerhalb der Wegweiser-Reichweite',
                'Verbinde sie über Wegweiser oder baue ein Lager näher dran',
              ],
              [
                '„Nichts zu bauen“',
                'Normal',
                'Der Bauarbeiter hat keine Baustelle',
                'Setze ein Gebäude oder wechsle seinen Beruf',
              ],
              [
                '„Nichts zu tun“',
                'Normal',
                'Ein Siedler mit Arbeitsplatz tut seit {{notice.idleSeconds}} s nichts, und der Grund ist unklar',
                'Prüfe das Gebäude oder wechsle seinen Beruf',
              ],
              [
                '„Nichts bei der Fahne“',
                'Normal',
                'Der Träger findet an seiner Fahne nichts zum Aufheben',
                'Versetze die Fahne oder entferne sie',
              ],
              [
                '„Kein Weg zum Schiff“',
                'Bemerkenswert',
                'Das Schiff liegt an einer anderen Landmasse als das Fahrzeug',
                'Lege an einem Ufer an, das das Fahrzeug erreicht',
              ],
              [
                '„Falscher Beruf“',
                'Bemerkenswert',
                'Der Siedler hat nicht den Beruf, den das Gebäude braucht',
                'Wechsle seinen Beruf',
              ],
              [
                '„Zutritt gesperrt“, „Bauen gesperrt“',
                'Bemerkenswert',
                'Es ist Friedenszeit, und der Ort liegt zu nah am Dorf eines anderen Spielers',
                'Wähle einen Ort weiter weg: [[article:diplomacy|Diplomatie]]',
              ],
              [
                '„Einsteigen nicht möglich“, „An Bord gefangen“',
                'Bemerkenswert',
                'Das Schiff ist auf See, oder der Beruf passt nicht zum Fahrzeug',
                'Lege am Ufer an oder wähle ein anderes Fahrzeug',
              ],
              [
                '„Niemand baut ab: [Ware]“, „Niemand jagt für: [Ware]“, „Niemand fischt nach: [Ware]“',
                'Bemerkenswert',
                'Die Werkstatt steht seit {{notice.noGathererSeconds}} s ohne Rohstoff, und niemand beschafft ihn',
                'Weise einen Siedler zu oder schalte die Ware bei den vorhandenen ein',
              ],
              [
                '„Schiff abgelehnt“',
                'Bemerkenswert',
                'Das Schiff transportiert dieses Fahrzeug nicht, oder sein Platz ist belegt',
                'Nimm ein Schiff oder mache den Platz frei: [[article:vehicles|Fahrzeuge und Schiffe]]',
              ],
              [
                '„Lager voll: [Ware]“',
                'Normal',
                'Das Regal des Herstellers und jedes Lager mit dieser Ware sind seit {{notice.storageFullSeconds}} s voll',
                'Baue ein Lager oder verbrauche den Vorrat',
              ],
              [
                '„Kein Platz an Bord“',
                'Bemerkenswert',
                'Alle Plätze sind belegt',
                'Mache einen Platz frei oder nimm ein anderes Fahrzeug',
              ],
              [
                '„Arbeit gesperrt“',
                'Bemerkenswert',
                'Beruf oder Gebäude sind deinem Stamm noch nicht zugänglich, oder die Mission verbietet sie',
                'Mache die Entdeckung oder wechsle den Beruf: [[article:exp-work|Arbeitserfahrung]]',
              ],
              [
                '„In Alarmbereitschaft“',
                '-',
                'Ein Soldat im Modus Angriff oder Verteidigung ruht nicht, solange bis {{alert.restClearance}} Hexfelder gekämpft wird oder bis {{alert.standTo}} Hexfelder ein feindlicher Soldat steht',
                'Gib ihm den Befehl „Iss“ oder „Schlaf“',
              ],
              [
                '„Rohstoff zu weit weg“',
                'Bemerkenswert',
                'Den Rohstoff haben nur Gebäude außerhalb der Wegweiser-Reichweite',
                'Verbinde sie über Wegweiser oder baue ein Lager näher dran',
              ],
              [
                '„Alles auf 0 gestellt“',
                'Normal',
                'Alle Zähler des Siedlers stehen auf 0',
                'Wähle im Panel, was er tun soll',
              ],
              [
                '„Liegt im Sterben“',
                'Wichtig',
                'Die Gesundheit ist unter {{health.nearDeath}} gefallen, durch Wunden oder Hunger',
                'Hol ihn aus dem Kampf oder gib ihm zu essen',
              ],
              [
                '„Kein Arbeitsplatz“',
                'Bemerkenswert',
                'Das Gebäude ist weg oder er wurde entlassen, und er steht seit {{notice.idleSeconds}} s ohne Fahne. Der Beruf bleibt',
                'Weise einen Arbeitsplatz zu oder wechsle den Beruf',
              ],
              [
                '„Neustart nötig“',
                'Wichtig',
                'Die geänderte Einstellung wirkt erst nach einem Neustart',
                '„Mission neu starten“ im Esc-Menü',
              ],
              [
                '„Produkt gesperrt“',
                'Bemerkenswert',
                'Das gewählte Produkt ist noch nicht verfügbar',
                'Wähle ein anderes Produkt',
              ],
              [
                '„Zu unerfahren“',
                'Bemerkenswert',
                'Der Siedler hat zu wenig Erfahrung für diesen Beruf',
                'Schicke jemand Erfahreneren: [[article:exp-work|Arbeitserfahrung]]',
              ],
              [
                '„Verirrt“',
                'Wichtig',
                'Kein Weg zum Ziel, oder Arbeitsplatz, Arbeitsfahne oder Baustelle liegen außerhalb der Wegweiser-Reichweite. Bleibt stehen, bis du etwas änderst',
                '„Ziel anzeigen“ zeigt den Ort. Setze einen [[article:roads|Wegweiser]] oder gib einen anderen Befehl',
              ],
              [
                '„Erschöpft“',
                'Normal',
                'Die Kondition ist auf {{need.criticalPct}}% gefallen',
                'Gib ihm jetzt keine Befehle, er geht von selbst schlafen',
              ],
              [
                '„Wild unerreichbar“',
                'Bemerkenswert',
                'Das Wild steht hinter Wasser oder einer Palisade',
                'Öffne einen Durchgang oder versetze die Fahne',
              ],
            ],
            foot: 'Der Filter „Bemerkenswerte und wichtige“ blendet Normal aus, „Nur wichtige“ auch Bemerkenswert. Stufe „-“ ist eine Anzeige im Panel ohne Meldung.',
          },
        },
      ],
      see: ['article:why'],
    },
  ],
};
