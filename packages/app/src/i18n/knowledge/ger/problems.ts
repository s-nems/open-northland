import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const PROBLEMS: ArticleGroup = {
  group: 'Probleme',
  items: [
    {
      id: 'why',
      name: 'Warum geht das nicht?',
      lead: 'Wähle das Gebäude oder den Siedler aus und lies seine Statuszeile.',
      blocks: [
        {
          h: 'Meldungen',
        },
        {
          table: {
            filter: 'Meldung suchen',
            head: ['Meldung', 'Stufe', 'Ursache', 'Was tun'],
            rows: [
              [
                '„Dorf angegriffen“',
                'Wichtig',
                'Schlag gegen Gebäude oder Palisade oder bis {{notice.settlementReach}} Schritte davon. Schläge bis {{notice.fightRadius}} Schritte voneinander ergeben eine Karte, sie verschwindet nach {{notice.fightQuietSeconds}} s ohne Schlag',
                'Schicke Soldaten',
              ],
              [
                '„Unter Angriff“',
                'Bemerkenswert',
                'Schlag weiter als {{notice.settlementReach}} Schritte vom Dorf entfernt',
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
                'Nach „Heirate“ war in Reichweite niemand frei. Der Befehl verfällt',
                'Gib den Befehl, wenn jemand frei ist',
              ],
              [
                '„Paar benötigt: Ware“',
                'Bemerkenswert',
                'In der [[article:livestock|Viehzüchterei]] ist nur ein Tier',
                'Schicke einen Kundschafter nach dem zweiten',
              ],
              [
                '„Kein Bauplatz“',
                'Bemerkenswert',
                'Neben der Werkstatt ist kein freier Boden fürs Fahrzeug',
                'Schaffe Platz, nach {{notice.yardRetrySeconds}} s folgt ein neuer Versuch',
              ],
              [
                '„Keine Fische“',
                'Bemerkenswert',
                'In Reichweite des Ufers gibt es keine Fische mehr',
                'Setze die Fahne an Wasser mit Fischen',
              ],
              [
                '„Kein Träger“',
                'Bemerkenswert',
                'An Bord ist niemand für die Ladung',
                'Weise dem Fahrzeug einen Träger zu',
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
                'Weise Bogenschützen zu: [[article:defence|Türme, Verteidigungsmodus, Schutz]]',
              ],
              [
                '„Keine Rohstoffe“',
                'Bemerkenswert',
                'Auf der ganzen Karte gibt es nichts abzubauen',
                'Wechsle seinen Beruf',
              ],
              [
                '„Keine Tiere: Ware“',
                'Bemerkenswert',
                'In der [[article:livestock|Viehzüchterei]] gibt es diese Art nicht',
                'Schicke einen Kundschafter zu den Wildtieren',
              ],
              [
                '„Kein Zugtier“',
                'Bemerkenswert',
                'Dem Ochsenkarren fehlt der Ochse',
                'Halte {{livestock.pairPlusOne}} erwachsene Tiere: [[article:vehicles|Fahrzeuge und Schiffe]]',
              ],
              [
                '„Kein Wild“',
                'Bemerkenswert',
                'Im Jagdgebiet gibt es kein verfügbares Wild',
                'Versetze die Fahne dorthin, wo Wild weidet',
              ],
              [
                '„Kein Holz“ (je nach Ware), „Ware: nicht vorhanden“',
                'Normal, Werkstatt: Bemerkenswert',
                'Bauarbeiter: Baustellen warten auf Ware, die in den Lagern ihrer Reichweite fehlt. Werkstatt: Der Rohstoff fehlt in den Lagern, und niemand stellt ihn her',
                'Stelle ihn her, liefere ihn oder besetze die Werkstatt',
              ],
              [
                '„Baustelle: Ware fehlt“',
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
                '„Wartet auf die Werkstatt“',
                '-',
                'Der Arbeitsplatz ist noch eine Baustelle',
                'Baue sie fertig',
              ],
              [
                '„Wartet auf den Bau“',
                '-',
                'Schule oder Kaserne sind noch eine Baustelle',
                'Baue sie fertig',
              ],
              [
                '„Wartet auf einen freien Platz“',
                '-',
                'Alle Schulplätze sind belegt',
                'Warte oder schicke ihn woandershin',
              ],
              [
                '„wilde Tiere“',
                '-',
                'Der Feind auf der Angriffskarte sind Wildtiere',
                '[[article:wildlife|Wildtiere und Jagd]]',
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
                'Der Siedler hat Hunger',
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
                'Die Lager, die annehmen würden, liegen außerhalb der Wegweiser-Reichweite',
                'Verbinde sie über Wegweiser oder baue ein Lager näher dran',
              ],
              [
                '„Diese Person ist durch eine Mission an ihre Aufgabe gebunden“',
                '-',
                'Die Figur wird vom Kartenskript gesteuert',
                'Warte, sie nimmt keine Befehle an',
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
                'Ein Siedler mit Arbeitsplatz steht 10 s ohne benannten Grund. Gilt nicht für Soldaten, Siedler im Modus Verteidigung und Träger ohne Fahne',
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
                'Die Tür des Schiffs liegt an anderem Land',
                'Lege an einem erreichbaren Ufer an',
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
                'Es herrscht Frieden, und der Befehl reicht bis zum Dorf des Partners',
                'Wähle einen Ort weiter weg: [[article:diplomacy|Diplomatie]]',
              ],
              [
                '„Einsteigen nicht möglich“',
                'Bemerkenswert',
                'Der Beruf passt nicht zum Fahrzeug, oder das Schiff ist auf See',
                'Lege am Ufer an oder wähle ein anderes Fahrzeug',
              ],
              ['„An Bord gefangen“', 'Bemerkenswert', 'Das Schiff ist auf See', 'Lege am Ufer an'],
              [
                '„Niemand baut ab: Ware“, „Niemand jagt für: Ware“, „Niemand fischt nach: Ware“',
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
                '„Lager voll: Ware“',
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
                '„Bauplatz blockiert“',
                'Bemerkenswert',
                'Auf dem Platz steht ein anderes Fahrzeug',
                'Fahre es weg',
              ],
              [
                '„Arbeit gesperrt“',
                'Bemerkenswert',
                'Beruf oder Gebäude sind deinem Stamm noch nicht zugänglich, oder die Mission verbietet sie',
                'Mache die Entdeckung: [[article:exp-work|Arbeitserfahrung]]',
              ],
              [
                '„In Alarmbereitschaft“',
                '-',
                'Ein Soldat im Modus Angriff oder Verteidigung ruht nicht bei Kampf bis {{alert.restClearance}} Schritte oder bei sichtbarem feindlichem Soldaten bis {{alert.standTo}} Schritte. Ein Wildtier zählt erst im Kampf',
                'Der Befehl „Iss“ oder „Schlaf“ gibt ihn frei',
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
                'Der Siedler ist dem Tod nahe',
                'Bringe ihn aus der Gefahr und gib ihm zu essen',
              ],
              [
                '„Kein Arbeitsplatz“',
                'Bemerkenswert',
                'Er hat den Arbeitsplatz verloren und steht 10 s ohne ihn und ohne Fahne. Das Gebäude ist weg, oder er wurde entlassen. Der Beruf bleibt',
                'Weise einen Arbeitsplatz zu oder wechsle den Beruf',
              ],
              [
                '„Neustart nötig“',
                'Wichtig',
                'Die geänderte Einstellung wirkt erst bei einem neuen Start',
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
              ['„Erschöpft“', 'Normal', 'Der Siedler muss ausschlafen', 'Lass ihn ruhen'],
              [
                '„Wild unerreichbar“',
                'Bemerkenswert',
                'Das Wild steht hinter Wasser oder einer Palisade',
                'Öffne einen Durchgang oder versetze die Fahne',
              ],
            ],
            foot: 'Der Filter „Bemerkenswerte und wichtige“ blendet Normal aus, „Nur wichtige“ auch Bemerkenswert. Ein neues Spiel filtert mit „Alle“. Stufe „-“ ist eine Anzeige im Panel ohne Meldung.',
          },
        },
        {
          h: 'Arbeit und Produktion',
        },
        {
          faq: [
            [
              'Die Werkstatt steht leer',
              'Status „Keine Arbeiter“: Niemand hat dort einen Arbeitsplatz. Ein Siedler kommt nur mit passendem Beruf und freiem Platz hinein, sonst heißt es „Falscher Beruf“, „Stellen belegt“ oder „Zu unerfahren“. Status „Untätig“ nennt den fehlenden Rohstoff. Der Arbeiter holt ihn selbst, wenn er bis {{reach.goods}} Schritte von einem Wegweiser liegt.',
            ],
            [
              'Waffenbauer, Schmied oder Näher arbeitet nicht',
              'Religion steht unter „Wohlbefinden“ auf 0%. Eine Charge Waffen oder Rüstungen kostet 15% oder 30%, ein Gebet bringt {{pray.pct}}%. „Will beten“ heißt, dass ein Ort zum Beten fehlt: nötig sind ein [[building:work_temple|Tempel]], das [[building:headquarters|Hauptquartier]] oder Heiliges Feuer im Wohnhaus. Der Näher betet nicht von selbst, gib ihm den Befehl „Bete“.',
            ],
            [
              'Träger tragen nichts',
              'Ein Träger trägt nur mit Arbeitsplatz in einem Gebäude. Status „Nichts zum Tragen in Reichweite“: Bis {{flag.radius}} Schritte vom Gebäude, mit Arbeitsfahne von der Fahne, liegt nichts zum Abholen. „Kein Ziel nimmt diese Ware an“ heißt, die Lager sind voll.',
            ],
            [
              'Die Zucht steht',
              'Der Viehzüchter vermehrt bei genau {{livestock.pair}} erwachsenen Tieren einer Art. Der Status der Viehzüchterei lautet „Keine Tiere“, „Nur ein Tier“, „Jungtiere wachsen heran“ oder „Herde voll“: [[article:livestock|Viehzucht]].',
            ],
            [
              'Der Jäger bringt nichts',
              'Status „Kein verfügbares Wild im Jagdgebiet“: Bis {{flag.hunter}} Schritte von Arbeitsfahne oder Arbeitsplatz ist kein Wild. Wolf, Löwe, Bär, Elefant, Hund und Huhn jagt er nicht. Versetze die Arbeitsfahne dorthin, wo Wild weidet.',
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
              'Ein Paar braucht ein gemeinsames Wohnhaus und {{family.childFood}} Stück Essen in der Speisekammer. Meldungen: „Ehemann abwesend“ (er ist Händler, Kundschafter, Soldat oder Held), „Kein Familienheim“, „Haus nicht fertig“, „Getrennte Haushalte“, „Keine Nahrung vorrätig“. Der Zähler „Geburten“ im Assistenten gibt Bestellungen auf. Mehr: [[article:family|Familie und Wohnhaus]].',
            ],
            [
              'Hunger trotz vollem Lager',
              'Prüfe das „Lagerminimum“: Unter dieser Summe nimmt niemand Ware heraus, auch nicht zum Essen. Senke das Minimum bei Essen. Zweite Ursache ist die Entfernung: Das Lager muss in Gehreichweite des Siedlers liegen, {{reach.walk}} Schritte oder das Wegweisernetz.',
            ],
            [
              'Der Beruf fehlt auf der Schulliste',
              'Die Liste zeigt nur Kurse, die entdeckt und in dieser Mission erlaubt sind. Eine Zeile ohne Auswahl nennt den Grund: „Bereits erlernt“ oder „Diese Siedler können an dieser Schule nicht lernen“. Kurse entdeckst du durch [[article:exp-work|Arbeitserfahrung]].',
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
              'Im Baufenster landet es im Abschnitt „Gesperrt“. Der Hinweis „Benötigte Entdeckungen:“ nennt Berufe und Waren, bei Waren die Erfahrung als aktuell/gefordert. „In dieser Mission nicht verfügbar“ ist ein Kartenverbot. Ein Brief aus einer Kiste setzt das Gebäude auch ohne Entdeckung: [[article:chests|Kisten und Briefe]].',
            ],
            [
              'Der Bau steht',
              'Der Baustatus sagt, was fehlt: „Material fehlt“, „Lieferung unterwegs“ oder „Kein Bauarbeiter“. „Baustelle: Ware fehlt“ heißt, dass die Ware in keinem Lager in Wegweiser-Reichweite der Baustelle liegt, {{reach.goods}} Schritte von einem Wegweiser. Der Bauarbeiter trägt das Material selbst.',
            ],
            [
              'Das Feld wächst nicht',
              'Es wächst nur durch Gießen eines [[job:farmer|Farmers]] mit Arbeitsplatz auf der [[building:work_farm_00|Farm]]. Der Farmer sät zuerst und gießt erst bei {{field.max}} Feldern oder wenn er nirgends mehr säen kann. Ein Feld reift nach {{field.waterings}} Mal Gießen, und einmal Gießen erfasst auch 6 Nachbarfelder. Gesät wird nur auf Gras, abseits von Straßen, bis {{field.radius}} Schritte von der Farm.',
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
              'Prüfe den Modus: [[article:stances|Soldatenmodi]]. Als Ignorant rührt er sich nicht und schlägt nur in Waffenreichweite. Angriff und Befehl wirken nur gegen Stämme, zu denen dein Verhältnis „Feindlich“ ist, und nur außerhalb der „Friedenszeit“.',
            ],
            [
              'Das Schiff legt nicht ab',
              'Status „Wartet auf einen Kommandanten“: Weise einen zu, das kann jeder Erwachsene sein. „Wartet auf seine Besatzung“: Jemand Zugewiesenes läuft noch zur Tür, und ein Siedler von anderem Land fällt aus der Besatzung. „Kein Weg“ heißt, das Ziel liegt nicht auf diesem Wasser. Auf See nimmt das Schiff niemanden auf, also erst „Andocken“.',
            ],
            [
              'Der Ochsenkarren steht',
              'Status „Wartet auf sein Zugtier“. Der Karren nimmt einen [[good:cattle|Ochsen]] aus deiner Herde auf demselben Land, aber jede Viehzüchterei behält {{livestock.pair}} erwachsene Tiere. Nötig sind {{livestock.pairPlusOne}} erwachsene Tiere in einer Viehzüchterei oder {{livestock.pairPlusOne}} außerhalb. Erst dann lässt sich ein Kommandant zuweisen.',
            ],
          ],
        },
        {
          h: 'Wetter',
        },
        {
          faq: [
            [
              'Ändern Regen, Schnee oder Nacht etwas?',
              'Nein. Wetter, die Einstellung „Winter“ und die Tageszeit sind nur Bild und Ton. Leute, Arbeit, Felder und Kampf laufen gleich. Langsamer geht es nur auf dem Gelände der Karte: Sand, Gebirge und Schnee, der dort von Anfang an liegt.',
            ],
          ],
        },
      ],
      see: ['article:walking', 'article:hauling', 'article:stances', 'article:religion', 'article:livestock'],
    },
  ],
};
