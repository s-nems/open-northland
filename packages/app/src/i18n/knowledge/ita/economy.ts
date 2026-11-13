import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: 'Economia',
  items: [
    {
      id: 'construction',
      name: 'Costruzione, miglioramenti e riparazioni',
      lead: "Un costruttore tira su un'abitazione 1 in {{build.noviceSeconds}} s, o in {{build.noviceIronSeconds}} s con un attrezzo di ferro. Il trasporto dei materiali va aggiunto a questo tempo.",
      blocks: [
        {
          h: 'Dove puoi costruire',
        },
        {
          table: {
            head: ['Cosa', 'Regola'],
            rows: [
              [
                'Terreno',
                'Puoi costruire su terra, sabbia, spiaggia e deserto pietroso. Montagne, neve, acqua e palude non vanno bene.',
              ],
              [
                '[[building:work_well_00|Pozzo]], [[building:work_hive_00|alveare]]',
                "Almeno il bordo dell'edificio deve stare sull'erba.",
              ],
              [
                'Spazio',
                'Un edificio occupa subito lo spazio che servirà al suo livello più alto, più uno stretto margine intorno. I margini di due edifici non possono sovrapporsi.',
              ],
              [
                'Albero, roccia, giacimento, palizzata',
                "Devono stare fuori dallo spazio per il livello più alto dell'edificio.",
              ],
              [
                'Soldato, carro o nave nemici',
                'Non puoi costruire entro {{contest.radius}} esagoni da uno di loro, circa {{contest.diagonal}} in diagonale. Contano solo quelli che vedi, e la guarnigione di una torre no.',
              ],
              [
                'Catapulta nemica',
                'Non puoi costruire entro {{contest.siegeRadius}} esagoni da essa, la distanza a cui cerca un bersaglio, con o senza equipaggio. Contano solo le catapulte che vedi.',
              ],
              [
                'Edificio di un giocatore con cui sei in pace',
                'Non puoi costruire entro {{peace.keepOut}} esagoni dal suo edificio o cantiere, a meno che un tuo edificio non sia più vicino al punto del suo.',
              ],
              [
                'Terreno sotto la nebbia',
                'Non puoi costruirci. Il punto deve essere visibile in quel momento.',
              ],
              [
                'Portata dei cartelli',
                'Non conta. Puoi piazzare un cantiere fuori dalla rete, ma il costruttore arriva solo quando la rete lo raggiunge.',
              ],
            ],
          },
        },
        {
          h: 'Quanto dura la costruzione',
        },
        {
          table: {
            head: ['[[building:home_level_00|Abitazione 1]], 1 costruttore', 'Colpi', 'Tempo'],
            rows: [
              ['Senza esperienza, senza attrezzo', '{{build.noviceSwings}}', '{{build.noviceSeconds}} s'],
              [
                'Senza esperienza, [[good:tool_iron|attrezzo di ferro]]',
                '{{build.noviceIronSwings}}',
                '{{build.noviceIronSeconds}} s',
              ],
              [
                'Maestro, [[good:tool_iron|attrezzo di ferro]]',
                '{{build.masterIronSwings}}',
                '{{build.masterIronSeconds}} s',
              ],
            ],
            num: [1, 2],
            foot: "L'abitazione 1 costa {{build.homeUnits}} pezzi di materiale. I tempi includono solo i colpi, e 1 colpo dura {{build.swingSeconds}} s.",
          },
        },
        {
          h: 'Colpi per 1 pezzo di materiale',
        },
        {
          table: {
            head: ['Esperienza', 'Senza attrezzo', 'Di legno', 'Di ferro'],
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
            foot: "L'esperienza di un [[job:builder|costruttore]] cresce solo con i colpi che fanno avanzare il lavoro: [[article:exp-work|Esperienza di lavoro]].",
          },
        },
        {
          p: 'I costruttori e i lavoratori assegnati al cantiere ci portano il materiale, 1 pezzo alla volta.',
        },
        {
          h: 'Cosa fa prima un costruttore',
        },
        {
          p: "Un costruttore prima ripara, poi costruisce edifici, e lascia per ultime palizzate e strade. Se lo assegni a un cantiere, resta lì anche quando c'è lavoro altrove. Un cantiere a cui dai la priorità nel suo pannello viene prima di ogni cantiere senza priorità e ne richiama perfino l'ultimo costruttore.",
        },
        {
          h: 'Miglioramenti',
        },
        {
          list: [
            'Costa i materiali dei livelli guadagnati. Puoi saltare più livelli insieme, se sono tutti sbloccati.',
            "I beni necessari al miglioramento che l'edificio ha già in magazzino finiscono direttamente nel lavoro.",
            'Lavoratori e residenti escono durante il miglioramento e poi tornano ai loro posti.',
            "Alla fine l'edificio ha la salute piena del nuovo livello.",
            "Se annulli il miglioramento, l'edificio recupera le sue scorte, ma il materiale consegnato è perso.",
          ],
        },
        {
          h: 'Riparazioni',
        },
        {
          p: 'Un costruttore restituisce a un edificio {{repair.minPerSwing}}-{{repair.maxPerSwing}} punti di salute per colpo, e al massimo {{repair.crew}} costruttori riparano lo stesso edificio contemporaneamente. Le riparazioni non costano materiale. Palizzate e cancelli si riparano in un altro modo, e lì esperienza e attrezzi non cambiano nulla: [[article:walls|Palizzate e cancelli]]. Allo stesso modo ripara una tua nave danneggiata mentre è attraccata: [[article:vehicles|Veicoli e navi]].',
        },
        {
          p: "Un costruttore non ripara di sua iniziativa per {{repair.calmSeconds}} s dopo l'ultimo colpo subito, né mentre c'è un combattimento entro {{alert.standTo}} esagoni. Su tuo ordine va subito.",
        },
        {
          h: 'Cosa si perde e cosa torna',
        },
        {
          table: {
            head: ['Situazione', 'Cosa resta'],
            rows: [
              ['Demolizione di un cantiere', 'Il materiale consegnato resta a terra'],
              [
                'Demolizione o distruzione di un edificio',
                'Il contenuto più metà del costo, arrotondata per eccesso',
              ],
            ],
            foot: "I beni finiscono a terra fino a {{reach.spill}} esagoni dall'edificio. Quello che non ci sta va perso.",
          },
        },
      ],
      see: ['article:tools', 'article:walls', 'article:roads', 'article:exp-work', 'job:builder'],
    },
    {
      id: 'workshops',
      name: 'Botteghe e scelta dei prodotti',
      lead: "Il contatore accanto a un prodotto dice quanti cicli farà il lavoratore: 0 è fermo, ∞ è senza limite. Un ciclo è un'esecuzione della ricetta.",
      blocks: [
        {
          h: 'Valori del contatore',
        },
        {
          table: {
            head: ['Contatore', 'Bottega', 'Estrattore'],
            rows: [
              ['0', 'Non fa questo prodotto', 'Non raccoglie questo bene'],
              [
                '1-{{workshop.counterMax}}',
                'Altrettanti cicli, il contatore scende di 1 a ogni inizio',
                'Altrettanti pezzi, il contatore scende di 1 per ogni pezzo raccolto',
              ],
              [
                '∞',
                'Nessun limite, il contatore non scende mai',
                'Nessun limite, il contatore non scende mai',
              ],
            ],
            foot: 'Esperienza e attrezzi danno più pezzi per ciclo: [[article:tools|Attrezzi]].',
          },
        },
        {
          h: 'Pulsanti',
        },
        {
          table: {
            head: ['Pulsante', 'Clic', 'Maiusc', 'Ctrl'],
            rows: [
              [
                'Icona del bene, «Solo questo prodotto»',
                'Questo bene ∞, il resto 0',
                '-',
                'Alterna questo bene tra 0 e ∞, il resto non cambia',
              ],
              ['Meno', '-1. Da 0 passa a ∞, da ∞ a {{workshop.counterMax}}', '-10', 'A 0'],
              ['Più', '+1. Da {{workshop.counterMax}} passa a ∞, da ∞ a 0', '+10', 'A ∞'],
            ],
          },
        },
        {
          h: 'Cosa succede ai contatori',
        },
        {
          p: "Ogni lavoratore ha i suoi contatori, così 2 uomini nella stessa bottega possono fare 2 prodotti diversi. I contatori spariscono quando un lavoratore cambia luogo di lavoro o professione, anche quando l'edificio viene demolito. Un miglioramento non li tocca, e i prodotti del nuovo livello partono da 0.",
        },
        {
          h: 'Più prodotti insieme',
        },
        {
          p: "Un lavoratore passa a turno su tutti i prodotti con un contatore sopra 0, 1 ciclo ciascuno, nell'ordine del pannello.",
        },
        {
          table: {
            head: ['Quando', 'Cosa fa il lavoratore'],
            rows: [
              ['Le scorte del prodotto sono piene', 'Passa al prodotto successivo'],
              ['Manca un ingrediente', 'Passa al prodotto successivo'],
              [
                "C'è solo una parte degli ingredienti",
                "Aspetta il resto. Se non c'è modo di procurarselo, passa al prodotto successivo.",
              ],
              [
                'Poca esperienza per un prodotto',
                'Il pannello mostra «bloccato» al posto del contatore e il lavoratore salta quel prodotto',
              ],
              [
                'Tutti i prodotti con un contatore sono bloccati',
                'Fa quello che sa già fare, anche prodotti con il contatore a 0',
              ],
            ],
          },
        },
        {
          h: 'Veicoli',
        },
        {
          p: "Un veicolo non si fabbrica dentro la bottega. L'artigiano piazza un cantiere lì accanto, ci porta da solo il materiale e costruisce. Se accanto alla bottega non c'è spazio per un cantiere, passa al prodotto successivo.",
        },
        {
          h: 'Estrattori',
        },
        {
          table: {
            head: ['Situazione', 'Risultato'],
            rows: [
              ['«Solo questa merce»', 'Questo bene ∞, il resto 0'],
              [
                'Clic destro su una risorsa',
                "L'ordine «Raccogli»: questo bene ∞, il resto 0, e la bandierina di lavoro si sposta sulla risorsa. Senza bandierina cambia solo il bene.",
              ],
              [
                'Ctrl + clic destro',
                'La bandierina si sposta in quel punto, e su una risorsa cambia anche il bene come sopra',
              ],
              ['Tutti i contatori a 0', "L'estrattore mostra «Tutto a 0» e non raccoglie niente"],
              [
                'Ci sono già beni a terra',
                "Il contatore riguarda solo l'estrazione. L'estrattore continua a portare via tronchi e mucchi, anche a 0.",
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
      name: 'Raccolta e coltivazione',
      lead: 'Un albero dà {{gather.treeYield}} pezzi di legno dopo {{gather.strokes}} colpi. Una roccia richiede altrettanti colpi per ogni pezzo, quindi il legno arriva circa {{gather.treeYield}} volte più in fretta della pietra grezza.',
      blocks: [
        {
          h: 'Cosa dà una risorsa',
        },
        {
          table: {
            head: [
              'Risorsa',
              'Chi',
              'Dà',
              'Colpi senza esperienza',
              'Tempo per albero, pezzo o campo',
              "L'attrezzo aiuta",
            ],
            rows: [
              [
                'Albero',
                '[[job:collector|Estrattore]]',
                '{{gather.treeYield}} [[good:wood|legno]]',
                '{{gather.strokes}} per albero',
                '{{gather.treeSeconds}} s',
                'sì',
              ],
              [
                'Roccia',
                '[[job:collector|Estrattore]]',
                '4-5 [[good:stone|pietra grezza]]',
                '{{gather.strokes}} per pezzo',
                '{{gather.stoneSeconds}} s',
                'sì',
              ],
              [
                'Giacimento',
                '[[job:collector|Estrattore]]',
                '5 [[good:mud|argilla]], [[good:iron|ferro]] o [[good:gold|oro]]',
                '{{gather.strokes}} per pezzo',
                '{{gather.oreSeconds}} s',
                'sì',
              ],
              [
                'Fungo',
                '[[job:collector|Estrattore]]',
                '1 [[good:mushroom|fungo]]',
                '1 raccolta',
                '{{gather.mushroomSeconds}} s',
                'no',
              ],
              [
                'Campo di grano',
                '[[job:farmer|Contadino]]',
                '1 [[good:wheat|grano]]',
                '{{gather.wheatStrokes}} per campo',
                '{{gather.wheatSeconds}} s',
                'sì',
              ],
              [
                'Campo di erbe',
                '[[job:herb_mush_guy|Erborista]]',
                '1 [[good:herb|erba]]',
                '{{gather.herbStrokes}} per campo',
                '{{gather.herbSeconds}} s',
                'sì',
              ],
              [
                'Banco di pesci',
                '[[job:fisher|Pescatore]]',
                '1 [[good:fish|pesce]]',
                '{{gather.casts}} lanci',
                '{{gather.fishSeconds}} s',
                'sì',
              ],
            ],
            foot: 'Solo il tempo di lavoro, senza esperienza e senza attrezzo, escluso il cammino.',
          },
        },
        {
          p: "Un albero abbattuto resta a terra come tronco con {{gather.treeYield}} pezzi, e l'estrattore li porta via 1 alla volta. Ogni pezzo di una roccia o di un giacimento cade a terra lì accanto.",
        },
        {
          h: 'Ferro e oro',
        },
        {
          p: "Un estrattore scopre il [[good:iron|ferro]] e l'[[good:gold|oro]] estraendo di persona {{gather.oreNeed}} pezzi di [[good:mud|argilla]] e [[good:stone|pietra grezza]], contati insieme in qualsiasi proporzione. Lo stesso requisito sblocca entrambi i beni. Il primo che ci riesce li scopre per tutto l'insediamento, e da quel momento si possono imparare anche alla [[building:school|scuola]]. Fino ad allora il pannello mostra «bloccato».",
        },
        {
          h: 'Campo',
        },
        {
          figure: {
            id: 'field-stages',
            caption: 'Dalla semina al raccolto',
          },
        },
        {
          p: 'Ogni annaffiatura fa salire di 1 stadio quel campo e i 6 campi vicini, quindi un campo ha bisogno al massimo di {{field.waterings}} annaffiature. Senza acqua un campo cresce anche da solo, ma lentamente: 1 stadio ogni {{field.stageSeconds}} s. Dopo il raccolto resta 1 pezzo di raccolto, e il punto si può seminare di nuovo.',
        },
        {
          p: "Semina e annaffiatura non costano niente, nemmeno l'acqua.",
        },
        {
          table: {
            head: ['Edificio', 'Campi', 'Raggio'],
            rows: [
              ['[[building:work_farm_00|Fattoria]]', '{{field.max}}', '{{field.radius}} esagoni'],
              ['[[building:work_herb_hut|Capanna delle erbe]]', '{{field.max}}', '{{field.radius}} esagoni'],
            ],
            num: [1],
            foot: "In diagonale il raggio è di circa {{field.diagonal}} esagoni. Il limite di campi appartiene all'appezzamento, non a ogni lavoratore, quindi più persone danno raccolti più veloci ma non più campi. Un lavoratore con una bandierina di lavoro semina il proprio appezzamento intorno a essa. La scheda dell'edificio indica i lavoratori e le scorte.",
          },
        },
        {
          p: "Non puoi seminare un campo sulla sabbia o su una strada. I campi selvatici della mappa nel raggio dell'appezzamento contano nel suo limite. Un campo che nessuno può raggiungere dalla porta dell'edificio per {{field.reclaimSeconds}} s sparisce e libera un posto nel limite.",
        },
        {
          h: 'Cosa ricresce',
        },
        {
          table: {
            head: ['Fonte', 'Ritmo', 'Limite'],
            rows: [
              [
                '[[building:work_well_00|Pozzo]]',
                '+1 [[good:water|acqua]] al secondo, senza lavoratori',
                "{{well.stock}} nell'edificio",
              ],
              [
                '[[building:work_hive_00|Alveare]]',
                '+1 [[good:honey|miele]] al secondo, senza lavoratori',
                "{{hive.stock}} nell'edificio",
              ],
              [
                'Cespuglio da frutto',
                'Uno stadio ogni {{bush.stageSeconds}} s, prima i fiori e poi i frutti: fino a {{bush.regrowSeconds}} s',
                '1 pasto',
              ],
              ['Banco di pesci', '+1 pesce ogni {{fish.regrowSeconds}} s', '{{fish.swarmMax}} pesci'],
              [
                'Albero',
                "Un albero abbattuto, {{regrow.inTen}} volte su 10, fa nascere un alberello lì vicino dopo {{regrow.minMinutes}}-{{regrow.maxMinutes}} min, in un punto libero con almeno {{regrow.forestTrees}} alberi intorno. L'alberello cresce di uno stadio ogni {{tree.growMinutes}} min",
                '1 alberello per albero abbattuto, si può abbattere solo da adulto',
              ],
              [
                'Fungo',
                'Un fungo raccolto, {{regrow.inTen}} volte su 10, ricresce lì vicino dopo {{regrow.mushroomMinMinutes}}-{{regrow.mushroomMaxMinutes}} min, in un punto libero con almeno {{regrow.forestTrees}} alberi intorno',
                '1 fungo per ogni fungo raccolto, solo in un bosco',
              ],
              ['Roccia, giacimento', 'Non ricrescono mai', '-'],
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
      name: 'Attrezzi',
      lead: 'Un attrezzo riduce i colpi, dà più pezzi in bottega e dura {{tool.uses}} utilizzi.',
      blocks: [
        {
          h: 'Dove un colono prende un attrezzo',
        },
        {
          p: "Gli attrezzi vengono distribuiti dall'[[article:assistant|Assistente]] quando attivi le sue righe degli attrezzi, oppure su tuo ordine. Un colono senza attrezzo va allora da solo a prenderne uno in un magazzino e sceglie quello di ferro, o quello di legno se non ce n'è di ferro. L'Assistente sostituisce un attrezzo di legno con uno di ferro quando le opzioni «Attrezzi di ferro» e «Sostituisci quelli di legno» sono attive e un magazzino ha un attrezzo di ferro libero. Un attrezzo di legno già usato in parte va perso nello scambio, uno mai usato torna in magazzino.",
        },
        {
          h: 'Chi ne trae vantaggio',
        },
        {
          table: {
            head: ['Chi', 'Cosa ci guadagna'],
            rows: [
              ['Artigiano di bottega', 'Più pezzi per ciclo'],
              ['[[job:collector|Estrattore]]', 'Meno colpi, tranne per i funghi'],
              ['[[job:farmer|Contadino]], [[job:herb_mush_guy|erborista]]', 'Meno colpi per il raccolto'],
              ['[[job:fisher|Pescatore]]', 'Meno lanci'],
              [
                '[[job:builder|Costruttore]]',
                'Meno colpi per pezzo di materiale: [[article:construction|Costruzione]]',
              ],
              ['[[job:hunter|Cacciatore]], [[job:carrier|trasportatore]]', 'Niente'],
              ['Soldati, eroi', 'Non portano attrezzi'],
            ],
          },
        },
        {
          h: 'Colpi nella raccolta',
        },
        {
          table: {
            head: ['Colono senza esperienza', 'Senza attrezzo', 'Di legno', 'Di ferro'],
            rows: [
              [
                'Colpi per albero, o per pezzo di pietra, argilla o minerale',
                '{{tool.strokes.bare}}',
                '{{tool.strokes.wooden}}',
                '{{tool.strokes.iron}}',
              ],
              ['Lanci per 1 pesce', '{{tool.casts.bare}}', '{{tool.casts.wooden}}', '{{tool.casts.iron}}'],
            ],
            num: [1, 2, 3],
            foot: "Colpi su un albero, una roccia, un giacimento o un campo di erbe. L'esperienza toglie a questi valori i propri colpi, ma ne resta sempre almeno 1: [[article:exp-work|Esperienza di lavoro]].",
          },
        },
        {
          p: 'Un campo di [[good:wheat|grano]] richiede {{gather.wheatStrokes}} colpi senza attrezzo, e con un attrezzo o dal {{exp.savedStrokePct}}% di esperienza ne basta 1.',
        },
        {
          h: 'Pezzi per ciclo di bottega',
        },
        {
          p: 'Un attrezzo aggiunge un bonus fisso a ogni ciclo: di legno +{{tool.bonus.wooden}}, di ferro +{{tool.bonus.iron}} pezzi. Si somma al bonus di esperienza, descritto in [[article:exp-work|Esperienza di lavoro]]. Una ricetta da 2 pezzi riceve il doppio del bonus. Ingredienti e tempo di lavoro restano uguali.',
        },
        {
          p: "Le frazioni di pezzo si sommano. Appena c'è un pezzo intero, va nelle scorte, anche oltre la capacità.",
        },
        {
          h: 'Usura',
        },
        {
          p: "Ogni colpo, lancio di lenza, annaffiatura e ciclo di bottega completato usa l'attrezzo una volta, anche quelli falliti. Seminare e raccogliere funghi non usano niente. Dopo {{tool.uses}} utilizzi l'attrezzo sparisce e il colono lavora a mani nude finché non ne riceve uno nuovo. A un colono senza esperienza un attrezzo di ferro dura {{tool.ironTrees}} alberi.",
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
      name: 'Trasportatori e magazzini',
      lead: 'Un trasportatore senza carretto porta {{haul.carry}} pezzo alla volta. Un punto a terra contiene fino a {{haul.groundStack}} pezzi di un bene.',
      blocks: [
        {
          p: 'Quanto contiene un magazzino e quante persone ci lavorano è scritto nelle schede di [[building:stock_00|Magazzino 1]], [[building:stock_01|2]], [[building:stock_02|3]] e [[building:headquarters|Quartier generale]].',
        },
        {
          h: 'Priorità',
        },
        {
          p: "Imposti la priorità in un magazzino, nel quartier generale, in una caserma o in una torre. I trasportatori di quell'edificio portano allora il bene da altri magazzini, botteghe e mucchi finché c'è spazio. Una caserma appena costruita ha subito la priorità sulle [[good:coin|Monete]]; se la togli in una qualsiasi delle tue caserme, quelle costruite dopo partono senza fino alla fine della partita.",
        },
        {
          h: 'Scorta minima',
        },
        {
          p: 'Il minimo, fino a {{haul.minimumMax}} pezzi di un bene, conta tutti i magazzini e il quartier generale insieme. Finché il totale è più basso, i trasportatori portano il bene da botteghe, pozzi, alveari e mucchi, e nessuno lo preleva da un magazzino.',
        },
        {
          p: 'Questo vale anche per il cibo: se tutto il tuo cibo rientra nel minimo, nessuno lo mangia dal magazzino. Un magazzino con priorità riceve da un altro magazzino solo quello che supera il minimo.',
        },
        {
          h: 'Carretto',
        },
        {
          p: 'Con un carretto un trasportatore porta a ogni viaggio quanto contiene il carretto: [[vehicle:handcart|carretto a mano]], [[vehicle:oxcart|carro di buoi]]. Quanto un carico rallenta un carretto: [[article:vehicles|Veicoli e navi]].',
        },
        {
          list: [
            'Solo un trasportatore con un luogo di lavoro e un [[job:trader|mercante]] prendono un carretto.',
            'Il carretto deve essere tuo, libero e sulla stessa terra emersa.',
            'Se sul carretto resta spazio, un trasportatore di magazzino continua a raccogliere, anche altri beni: i mucchi della sua zona di raccolta, dal più vicino, poi mucchi e botteghe entro {{haul.cartTopUp}} esagoni. Prende solo ciò per cui il suo magazzino ha posto.',
            'Un trasportatore di bottega con un carretto porta via i prodotti finiti e riporta i materiali mancanti in un solo giro, più tipi insieme. Se una fonte ne ha troppo pochi, prosegue fino alla successiva. Se la bottega è ferma in attesa del carico, lo consegna prima.',
          ],
        },
        {
          h: 'Mucchi a terra',
        },
        {
          p: 'Un mucchio a terra non è di nessuno, e chiunque può prenderlo. Dove un trasportatore raccoglie i mucchi: [[article:work-flag|Bandierina di lavoro]].',
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
      name: 'Bandierina di lavoro',
      lead: 'La bandierina di lavoro (solo «bandierina» sui pulsanti) indica dove opera un lavoratore. Non immagazzina nulla, quindi un estrattore senza luogo di lavoro lascia i beni a terra.',
      blocks: [
        {
          figure: {
            id: 'flag-flow',
            caption: 'Dove vanno i beni di una bandierina',
          },
        },
        {
          h: 'Con e senza luogo di lavoro',
        },
        {
          table: {
            head: ['Caratteristica', 'Senza luogo di lavoro', 'Con un luogo di lavoro'],
            rows: [
              [
                'Chi',
                '[[job:collector|Estrattore]], [[job:fisher|pescatore]], [[job:hunter|cacciatore]]',
                'Gli stessi, più un [[job:carrier|trasportatore]] di un magazzino, del quartier generale o di una bottega, e un [[job:farmer|contadino]] o un [[job:herb_mush_guy|erborista]]',
              ],
              [
                'Da dove viene la bandierina',
                'Compare ai suoi piedi quando prende la professione',
                "Solo dall'ordine «Pianta una bandierina»",
              ],
              [
                'Dove lavora',
                'Intorno alla bandierina',
                'Intorno alla bandierina; senza bandierina, come nella tabella sotto',
              ],
              [
                'Quali beni',
                'Tutto quello che raccoglie la sua professione',
                "Solo quelli che l'edificio immagazzina",
              ],
              ['Dove va il carico', 'Su un mucchio accanto alla bandierina', 'Al suo edificio'],
              ['Togliere la bandierina', 'Non si può, si può solo spostare', '«Togli la bandierina»'],
            ],
          },
        },
        {
          h: 'Dopo aver tolto la bandierina',
        },
        {
          table: {
            head: ['Chi', 'Senza bandierina'],
            rows: [
              ['Estrattore', 'Tutta la portata dei cartelli'],
              ['Trasportatore di magazzino', "Mucchi entro {{flag.radius}} esagoni dall'edificio"],
              ['Cacciatore', 'Intorno al luogo di lavoro'],
              ['Contadino, erborista', 'Intorno al luogo di lavoro'],
              ['Pescatore', 'Pesca da dove si trova'],
            ],
          },
        },
        {
          h: 'Area di lavoro',
        },
        {
          table: {
            head: ['Chi', 'Misurata da', 'In orizzontale e verticale', 'In diagonale'],
            rows: [
              [
                '[[job:collector|Estrattore]]',
                'Bandierina di lavoro',
                '{{flag.radius}}',
                'circa {{flag.diagonal}}',
              ],
              [
                'Trasportatore',
                'Bandierina di lavoro o edificio',
                '{{flag.radius}}',
                'circa {{flag.diagonal}}',
              ],
              ['[[job:hunter|Cacciatore]]', 'Bandierina di lavoro', '{{flag.hunter}}', '{{flag.hunter}}'],
              [
                '[[job:fisher|Pescatore]]',
                'Bandierina di lavoro',
                '{{flag.fisher}}',
                'circa {{flag.fisherDiagonal}}',
              ],
              [
                '[[job:farmer|Contadino]], [[job:herb_mush_guy|erborista]]',
                'Bandierina di lavoro o edificio',
                '{{field.radius}}',
                'circa {{field.diagonal}}',
              ],
            ],
            num: [2, 3],
            foot: 'In esagoni. Chi ha bisogno dei cartelli lavora solo entro la loro portata.',
          },
        },
        {
          p: 'Non puoi piantare una bandierina di lavoro per i trasportatori in una fattoria, una capanna delle erbe, un pozzo, un alveare, una torre o una caserma.',
        },
        {
          h: 'Il mucchio accanto alla bandierina',
        },
        {
          list: [
            'Solo un trasportatore con un luogo di lavoro prende un mucchio da sotto una bandierina.',
            "Quando la bandierina dell'estrattore è a più di {{flag.radius}} esagoni da un magazzino, pianta lì accanto una bandierina per il trasportatore del magazzino.",
            'Quando sposti la bandierina, i mucchi restano dove erano.',
          ],
        },
        {
          h: 'Piantare una bandierina',
        },
        {
          p: "«Pianta una bandierina» mette la bandierina nel punto che scegli o la sposta lì, proprio come Ctrl + clic destro. Se il punto è occupato, la bandierina va in un punto libero entro {{flag.snap}} esagoni, e se non ce n'è nessuno, l'ordine va perso.",
        },
        {
          p: "Nell'[[article:assistant|Assistente]] puoi lasciare che gli estrattori spostino da soli le loro bandierine. Un estrattore la pianta allora a {{assistant.flagMin}}-{{assistant.flagMax}} esagoni dalla risorsa, e quando tutto quello che c'è intorno è esaurito, si sposta alla risorsa più vicina al suo edificio. Cacciatori e pescatori non lo fanno.",
        },
        {
          p: 'Puoi piantare una bandierina fuori dalla rete, ma il lavoratore resterà fermo finché la rete non arriva lì: [[article:roads|Strade e cartelli]].',
        },
      ],
      see: ['article:hauling', 'article:workshops', 'article:roads', 'article:assistant', 'job:collector'],
    },
    {
      id: 'roads',
      name: 'Strade e cartelli',
      lead: 'Una strada costa 1 pietra grezza e riduce la durata di un passo con le scarpe sulla terra da {{step.landBrief}} s a {{step.road}} s.',
      blocks: [
        {
          h: 'Cartello indicatore',
        },
        {
          p: 'I cartelli indicatori li piazza un [[job:scout|esploratore]] e non costano materiale.',
        },
        {
          figure: {
            id: 'reach',
            caption: 'Portata della rete',
          },
        },
        {
          p: "Senza cartelli un colono raggiunge un obiettivo al massimo a {{reach.walk}} esagoni, un [[job:carrier|trasportatore]] a {{reach.carrier}}. Più lontano la strada la indicano i cartelli: se uno si trova entro quella portata, il colono può usare tutta la sua rete collegata, e l'obiettivo deve trovarsi entro la stessa portata da uno dei suoi cartelli.",
        },
        {
          list: [
            'Due cartelli si collegano quando sono a meno di {{reach.link}} esagoni e il cammino tra loro è al massimo di {{reach.linkRoute}} esagoni.',
            'Un tuo nuovo cartello deve stare ad almeno {{reach.spacing}} esagoni da un altro.',
            'Un colono cerca i beni a meno di {{reach.goods}} esagoni da sé o dai cartelli entro quella portata.',
            'Un edificio piazzato su un cartello lo sposta di lato fino a {{reach.displace}} esagoni, e se non è possibile, il cartello sparisce.',
            'Un nuovo cartello sposta di lato una bandierina di lavoro e toglie dal suo posto funghi, argilla, raccolti, erbe, cespugli, ceppi e casse aperte.',
          ],
        },
        {
          table: {
            head: ['Terreno', 'Raggio di ricerca dei beni, esagoni'],
            rows: [
              ['Strada, terra', 'meno di {{reach.goods}}'],
              ['Sabbia', 'circa {{reach.goodsSand}}'],
              ['Montagne', 'circa {{reach.goodsMountain}}'],
              ['Neve', 'circa {{reach.goodsSnow}}'],
            ],
            num: [1],
            foot: 'Peggiore è il terreno, più vicino un colono cerca i beni.',
          },
        },
        {
          p: 'Esploratori, soldati, eroi, [[job:hunter|cacciatori]] e [[job:druid|druidi]] vanno ovunque, con o senza cartelli.',
        },
        {
          p: 'Un lavoratore il cui luogo di lavoro o la cui bandierina finisce fuori portata riceve lo stato «Smarrito» e aspetta che la rete arrivi lì. Consegna comunque quello che sta portando.',
        },
        {
          h: 'Pannello del cartello',
        },
        {
          table: {
            head: ['Nel pannello', 'Significato'],
            rows: [
              [
                '«Merci della rete»',
                'Tutti i beni entro la portata della rete collegata: negli edifici, sui mucchi, sui carretti e in mano.',
              ],
              [
                '«Demolisci»',
                'Il cartello sparisce subito, senza conferma. Se collegava due parti della rete, la rete si divide.',
              ],
            ],
            foot: 'La sovrapposizione «Cartelli» sulla mappa mostra le reti.',
          },
        },
        {
          h: 'Strada',
        },
        {
          table: {
            head: ['Terreno sotto la strada', 'Passo su strada più corto del'],
            rows: [
              ['Terra', '{{step.roadSavedOnLandPct}}%'],
              ['Sabbia', '{{step.roadSavedOnSandPct}}%'],
              ['Montagne', '{{step.roadSavedOnMountainPct}}%'],
              ['Neve', '{{step.roadSavedOnSnowPct}}%'],
            ],
            num: [1],
            foot: 'Un colono con le scarpe e senza carico. Il passo su ogni terreno: [[article:walking|Velocità di cammino]]. Le scarpe si consumano {{shoes.roadWear}} volte più lentamente su strada che sulla terra.',
          },
        },
        {
          list: [
            'Un tratto costa 1 [[good:stone|pietra grezza]] e 1 colpo di un [[job:builder|costruttore]].',
            'Una pietra grezza lastrica anche fino a 6 tratti vicini, purché nessun costruttore li abbia già presi e non ci sia sopra pietra grezza.',
            'I coloni prendono la strada da soli quando li porta prima a destinazione.',
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
      name: 'Velocità di cammino',
      lead: 'Un passo sulla terra dura {{step.landBrief}} s con le scarpe e {{step.landBare}} s a piedi nudi.',
      blocks: [
        {
          p: 'Un esagono è la cella più piccola del movimento: un colono attraversa 1 esagono in 1 passo.',
        },
        {
          h: 'Passo per terreno',
        },
        {
          table: {
            head: ['Terreno', 'Passo con le scarpe', 'Passo a piedi nudi', 'Passi per paio di scarpe'],
            rows: [
              ['Strada, lastricato', '{{step.road}} s', '{{step.roadBare}} s', '{{shoes.road}}'],
              ['Terra', '{{step.land}} s', '{{step.landBare}} s', '{{shoes.land}}'],
              [
                'Sabbia, spiaggia, deserto pietroso',
                '{{step.sand}} s',
                '{{step.sandBare}} s',
                '{{shoes.sand}}',
              ],
              ['Montagne', '{{step.mountain}} s', '{{step.mountainBare}} s', '{{shoes.mountain}}'],
              ['Neve', '{{step.snow}} s', '{{step.snowBare}} s', '{{shoes.snow}}'],
            ],
            num: [1, 2, 3],
            foot: 'Con un carico in mano le scarpe si consumano {{shoes.carryWear}} volte più in fretta. Quanta energia costa camminare a piedi nudi: [[article:needs|Bisogni]]. Cosa dà una strada: [[article:roads|Strade e cartelli]].',
          },
        },
        {
          h: 'Cosa cambia un passo',
        },
        {
          table: {
            head: ['Stato', 'Variazione'],
            rows: [
              ['Carico in mano', '+{{step.carryExtra}} s'],
              ['Resistenza al {{need.drivePct}}% o meno', '+{{step.tiredExtra}} s'],
              ['Bambino', '+{{step.childExtra}} s'],
              ['Neonato', 'passo × 2'],
              [
                'Arma e armatura pesano insieme {{step.weightLowFrom}}-{{step.weightLowTo}}',
                '+{{step.weightLowExtra}} s',
              ],
              [
                'Arma e armatura pesano insieme {{step.weightHighFrom}}-{{step.weightHighTo}}',
                '+{{step.weightHighExtra}} s',
              ],
              ['[[good:amulet_speed|Amuleto del vento]]', '-{{step.amuletSaved}} s'],
            ],
            foot: 'Un passo non dura mai meno di {{step.shortest}} s. Il peso non rallenta gli eroi. Quanto rallenta un carretto: [[article:vehicles|Veicoli e navi]].',
          },
        },
        {
          h: 'Peso di armi e armature',
        },
        {
          table: {
            head: ['Arma', 'Peso'],
            rows: [
              ['[[good:sword_shord|Spada corta]], [[good:bow_short|arco corto]]', '{{weight.shortSword}}'],
              [
                '[[good:spear_wooden|Lancia di legno]], [[good:bow_long|arco lungo]]',
                '{{weight.woodenSpear}}',
              ],
              [
                '[[good:spear_iron|Lancia di ferro]], [[good:sword_long|spada lunga]]',
                '{{weight.ironSpear}}',
              ],
            ],
            num: [1],
            foot: "Uguale per tutte le tribù. Somma il peso dell'arma a quello dell'armatura dalla tabella Armature: [[article:damage|Calcolatore dei danni]].",
          },
        },
        {
          h: 'Esempi',
        },
        {
          table: {
            head: ['Chi', 'Terreno', 'Passo'],
            rows: [
              ['Trasportatore, con le scarpe, con beni', 'Strada', '{{step.carrierOnRoad}} s'],
              [
                'Soldato, spada lunga, armatura di piastre, con le scarpe',
                'Terra',
                '{{step.plateSoldierOnLand}} s',
              ],
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
      name: 'Commercio',
      lead: 'Un mercante fa la spola tra {{trade.stops}} edifici, e senza carretto porta {{haul.carry}} pezzo alla volta.',
      blocks: [
        {
          h: 'Trasportato con',
        },
        {
          table: {
            head: ['Trasportato con', 'Carico o scarico di un pezzo'],
            rows: [
              ['Mani', '{{trade.handsSeconds}} s'],
              ['[[good:handcart|Carretto a mano]]', '{{trade.handcartSeconds}} s'],
              ['[[good:oxcart|Carro di buoi]]', '{{trade.oxcartSeconds}} s'],
            ],
            num: [1],
            foot: 'La capacità di un carretto è indicata nella sua scheda, il suo rallentamento in [[article:vehicles|Veicoli e navi]].',
          },
        },
        {
          p: "Con il carretto pieno all'andata e vuoto al ritorno, i due carretti trasportano la stessa quantità su un percorso di circa {{trade.cartParLand}} esagoni sulla terra o {{trade.cartParRoad}} esagoni su strada. Su un percorso più corto conviene il carretto a mano, su uno più lungo il carro di buoi.",
        },
        {
          h: 'Percorso',
        },
        {
          list: [
            'Un percorso collega {{trade.stops}} edifici finiti con delle scorte. Al massimo 1 di loro può appartenere a qualcun altro.',
            'Mentre un edificio viene migliorato, il [[job:trader|mercante]] aspetta che il lavoro sia finito.',
            "Un mercante non prende cibo da un'abitazione.",
          ],
        },
        {
          h: 'Oltremare',
        },
        {
          list: [
            'Quando gli edifici del percorso sono su sponde diverse, il percorso mostra «oltre il mare». Clicca «Fissa una nave» e scegli una tua [[good:ship_small|nave]] o [[good:ship_big|grande nave]] sulla sponda del mercante, senza equipaggio e senza veicoli a bordo. Il mercante percorre la sua rotta con quella nave.',
            'Un [[job:carrier|trasportatore]] a bordo di quella nave aiuta il mercante a caricare e scaricare sulla riva, se entrambi gli edifici del percorso sono tuoi.',
          ],
        },
        {
          h: 'I tuoi edifici',
        },
        {
          p: 'A e B sono i due edifici del percorso.',
        },
        {
          table: {
            head: ['Impostazione', 'Risultato'],
            rows: [
              ["Bene segnato nell'edificio B", 'Lo prende da A e lo porta a B'],
              ['Bene segnato in entrambi gli edifici', 'Pareggia le scorte tra i due'],
              ['Niente segnato in nessuno dei due edifici', 'Il mercante non trasporta nulla'],
              ['fino a N', 'Smette di consegnare quando la destinazione avrà N pezzi, carico compreso'],
              ['tieni N', "N pezzi restano nell'edificio di partenza"],
              [
                'insediamento',
                "Prende i beni da tutto l'insediamento: prima da questo magazzino, poi dagli altri magazzini e dalle botteghe nella sua rete di cartelli. Quando questo magazzino è pieno, consegna in un altro magazzino dell'insediamento",
              ],
            ],
            foot: "Puoi attivare l'opzione insediamento solo in un magazzino o nel quartier generale. Entrambi gli edifici del percorso possono averla insieme solo quando i loro insediamenti non hanno edifici in comune, per esempio su due isole. Il mercante non prende beni al di sotto della scorta minima.",
          },
        },
        {
          h: 'Commercio con il computer',
        },
        {
          list: [
            "Puoi commerciare solo con un edificio finito di un giocatore del computer che ha un'offerta stabilita dalla mappa.",
            "Per aggiungere l'edificio a un percorso, entrambe le parti devono essere amichevoli l'una con l'altra. Dopo basta che sia amichevole la tribù del mercante: [[article:diplomacy|Diplomazia]].",
            "Un'offerta è N pezzi di un bene in cambio di M di un altro, con numeri stabiliti dalla mappa. Un percorso tratta un'offerta alla volta.",
            "Ogni {{trade.refillSeconds}} s il computer riporta il bene dell'offerta nel suo magazzino a {{trade.refillLevel}} pezzi.",
            "Quando l'edificio del computer non ha il pagamento, il mercante aspetta e non consegna niente.",
            '«tieni N» lascia N pezzi del bene in vendita nel tuo edificio. Il limite di ritorno N chiude lo scambio quando il tuo edificio ha N pezzi del pagamento.',
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
