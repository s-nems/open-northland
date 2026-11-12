import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const SETTLERS: ArticleGroup = {
  group: 'Coloni',
  items: [
    {
      id: 'needs',
      name: 'Bisogni',
      lead: 'Quando una barra scende al {{need.drivePct}}%, il colono lascia il lavoro e va a ricaricarla.',
      blocks: [
        {
          p: "L'impostazione della lobby «Bisogni dei coloni: Disattivati» blocca le barre ed elimina la fame.",
        },
        {
          h: 'Barre',
        },
        {
          table: {
            head: ['Barra', 'Cala col tempo', 'Cala lavorando', 'Si ricarica con', 'Allo 0%'],
            rows: [
              [
                'Energia',
                '100% in {{need.drainMinutes}} min',
                'sì',
                '[[article:food|un pasto]]',
                '[[article:health|muore dopo {{health.starveTime}}]]',
              ],
              [
                'Resistenza',
                '100% in {{need.drainMinutes}} min',
                'sì',
                'il sonno',
                "nient'altro, il passo rallenta già dal {{need.drivePct}}%",
              ],
              [
                'Socialità',
                '100% in {{need.drainMinutes}} min',
                'no',
                'la conversazione',
                'nessuna penalità',
              ],
              [
                'Religione',
                'no',
                'solo con armi e armature',
                '[[article:religion|la preghiera]]',
                'non fabbrica armi né armature',
              ],
            ],
            foot: 'A inizio mappa ogni barra è casuale, {{need.startMinPct}}-100%. Senza [[good:shoes|Scarpe]], {{need.barefootSampleSteps}} passi costano il {{need.barefootRoadPct}}% di energia su strada, il {{need.barefootLandPct}}% su terreno aperto e fino al {{need.barefootMaxPct}}% sul terreno più difficile, il doppio sotto carico.',
          },
        },
        {
          h: 'Soglie',
        },
        {
          figure: {
            id: 'need-bar',
            caption: 'Cosa succede su una barra',
          },
        },
        {
          table: {
            head: ['Livello', 'Cosa succede'],
            rows: [
              ['{{need.criticalPct}}%', 'Avviso per energia, resistenza o religione.'],
              [
                '{{need.drivePct}}%',
                'Finisce il compito e lascia il lavoro. Con la resistenza bassa, ogni passo dura {{step.tiredExtra}} s in più.',
              ],
              [
                '{{need.satedPct}}%',
                'A casa ricarica resistenza, poi energia, fino a questo livello, ed esce.',
              ],
              [
                '{{need.overfillPct}}%',
                'Il massimo di una barra. Un pasto o un sonno a casa possono accumulare una riserva oltre il 100%.',
              ],
            ],
          },
        },
        {
          h: 'Sonno',
        },
        {
          table: {
            head: ['Chi', 'Durata del sonno', 'Resistenza per sonno: fuori casa', 'a casa'],
            rows: [
              ['Uomo', '{{sleep.manSeconds}} s', '+{{sleep.manAwayPct}}%', '+{{sleep.manHomePct}}%'],
              [
                '[[job:woman|Donna]]',
                '{{sleep.womanSeconds}} s',
                '+{{sleep.womanAwayPct}}%',
                '+{{sleep.womanHomePct}}%',
              ],
              [
                'Mercante, esploratore (sempre come a casa)',
                '{{sleep.manSeconds}} s',
                '+{{sleep.manHomePct}}%',
                '-',
              ],
              ['Soldato (ovunque dorma)', '{{sleep.soldierSeconds}} s', '+{{sleep.soldierPct}}%', '-'],
            ],
            num: [1, 2, 3],
          },
        },
        {
          h: 'Eccezioni',
        },
        {
          table: {
            head: ['Chi', 'Barre'],
            rows: [
              ['Neonato, bambino', 'Nessuna. Un adulto parte dal 100% su ogni barra.'],
              ['[[article:heroes|Eroe]]', 'Nessuna.'],
              ['Mostri, animali', 'Nessuna.'],
              ['Soldato', 'Niente socialità.'],
              ['Passeggero di un carro', 'Le barre non calano, la salute non cambia.'],
              [
                'Passeggero di una nave',
                'Mangia dalla stiva, dorme come fuori casa, conversa. Prega solo una volta a terra.',
              ],
            ],
          },
        },
        {
          h: 'Religione e socialità',
        },
        {
          p: 'Un colono prega finché la religione arriva al 100% o finché energia o resistenza scendono al {{need.drivePct}}%. Chi prega, dove e cosa ottiene: [[article:religion|Religione e tempio]].',
        },
        {
          table: {
            head: ['Attività', 'Tempo', 'Effetto'],
            rows: [
              [
                'Conversare',
                '{{talk.shortSeconds}}-{{talk.longSeconds}} s',
                'Fino a +{{talk.pct}}% di socialità.',
              ],
              ['Restare a casa, se il colono ha un coniuge', '-', 'Socialità al 100%.'],
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
      name: 'Cibo',
      lead: 'Il cibo è pane, carne e pesce. Un pasto consumato a casa dà {{home.factor}} volte più energia.',
      blocks: [
        {
          h: 'Cosa dà un pasto',
        },
        {
          table: {
            head: ['Pasto', 'Energia fuori casa', 'Energia a casa', 'Socialità'],
            rows: [
              ['[[good:bread|Cibo]]', '+{{meal.plainPct}}%', '+{{meal.plainHomePct}}%', '-'],
              [
                '[[good:candy|Torta]]',
                '+{{meal.candyPct}}%',
                '+{{meal.candyHomePct}}%',
                '+{{meal.candyCompanyPct}}%',
              ],
              ['Cespuglio maturo', '+{{meal.plainPct}}%', '-', '-'],
            ],
            num: [1, 2, 3],
            foot: 'Un pasto dura {{meal.seconds}} s e consuma 1 unità. I soldati non mangiano a casa, e la torta dà loro quanto il cibo: +{{meal.plainPct}}%.',
          },
        },
        {
          p: 'Un colono mangia anche dalle scorte di una bottega. In un magazzino prende prima il cibo, poi la torta.',
        },
        {
          h: 'Dove mangia un colono',
        },
        {
          steps: [
            "Nella dispensa di casa sua, se la porta dell'abitazione è al massimo a {{reach.walk}} esagoni.",
            'Nel magazzino, nella bottega o nel mucchio a terra più vicino entro {{reach.goods}} esagoni, oppure a un cespuglio maturo a meno di {{reach.bushAtHand}} esagoni.',
            'Al cespuglio maturo più vicino entro {{reach.goods}} esagoni.',
            'Al cibo più vicino ovunque possa arrivare a piedi, anche nella sua abitazione se è più lontana.',
          ],
        },
        {
          p: 'Le dispense delle altre famiglie e le scorte degli altri giocatori sono chiuse. Un cespuglio non è di nessuno. I [[article:roads|cartelli indicatori]] estendono queste distanze. Nessuno mangia o porta a casa scorte al di sotto della [[article:hauling|scorta minima]].',
        },
        {
          h: 'Rifornimento della dispensa',
        },
        {
          steps: [
            "Una [[job:woman|Donna]] con un'abitazione finita cerca il cibo più vicino fuori dalle abitazioni.",
            'Porta a casa {{haul.carry}} unità.',
            "Con il [[good:crockery|Vasellame]] nell'abitazione, ogni consegna mette {{haul.crockeryDelivery}} unità nella dispensa.",
          ],
        },
        {
          p: 'Una donna porta cibo finché la dispensa è piena. Limiti: [[article:family|Famiglia e casa]].',
        },
      ],
      see: ['article:needs', 'article:family', 'article:gathering', 'good:bread', 'good:candy'],
    },
    {
      id: 'health',
      name: 'Salute e guarigione',
      lead: 'Una persona ha {{health.human}} punti salute, e la salute piena torna da sola in {{health.regenMinutes}} minuti.',
      blocks: [
        {
          h: 'Cosa cambia la salute',
        },
        {
          table: {
            head: ['Fonte', 'Variazione', 'Condizione', 'Tempo per {{health.human}} di salute'],
            rows: [
              [
                'Rigenerazione',
                '+{{health.regenPerSecond}}/s',
                'Energia sopra lo 0%, anche in combattimento',
                '{{health.regenTime}}',
              ],
              [
                '[[article:religion|Aura del tempio]]',
                '+{{aura.perSecond}}/s',
                '{{aura.range}} esagoni da un [[building:work_temple|Tempio]]',
                '{{aura.time}}',
              ],
              ['Fame', '-{{health.starvePerSecond}}/s', 'Energia 0%', '{{health.starveTime}}'],
            ],
            num: [1, 3],
            foot: "Rigenerazione e aura si sommano fino a {{aura.totalPerSecond}} al secondo. La rigenerazione si ferma a {{health.human}}, ma l'aura cura oltre il normale, fino a {{aura.ceiling}}.",
          },
        },
        {
          p: 'A {{health.nearDeath}} di salute il gioco avvisa che il colono sta morendo.',
        },
        {
          h: 'Pozioni di guarigione',
        },
        {
          list: [
            'La [[good:potion_heal_small|Pozione di guarigione piccola]] ha {{draught.smallUses}} sorsi, {{draught.healSmallTotal}} di salute in tutto. La [[good:potion_heal_big|Pozione di guarigione grande]] ha {{draught.bigUses}} sorsi, {{draught.healBigTotal}} di salute in tutto.',
            "Quando un colpo porterebbe la sua salute sotto {{draught.healBelow}}, il colono beve un sorso dopo l'altro, subito, finché non torna ad almeno {{draught.healBelow}} o la pozione finisce.",
            'Nemmeno un colpo mortale uccide, se i sorsi coprono la ferita.',
            'Un colono beve anche quando la fame porta la sua salute sotto {{draught.healBelow}}.',
          ],
        },
      ],
      see: ['article:draughts', 'article:needs', 'article:religion', 'good:potion_heal_small'],
    },
    {
      id: 'family',
      name: 'Famiglia e casa',
      lead: 'Per nascere, un bambino ha bisogno di {{family.childFood}} unità di cibo.',
      blocks: [
        {
          h: "Assegnare un'abitazione",
        },
        {
          list: [
            "Solo l'ordine «Assegna casa» dà un'abitazione. Nessuno ci si trasferisce da solo, e un matrimonio sposta solo il coniuge.",
            "Un'abitazione ospita tante famiglie quante ne indica la colonna Famiglie della tabella dei livelli, di più con il [[good:furniture|mobilio]]. Su un'abitazione piena l'ordine fallisce.",
            'Una nuova assegnazione sposta tutta la famiglia: il colono, il coniuge e il figlio che cresce.',
          ],
        },
        {
          h: 'Matrimonio',
        },
        {
          list: [
            "Per un matrimonio serve l'ordine «Sposa».",
            "L'ordine unisce il colono all'adulto di sesso opposto più vicino, della stessa tribù e dello stesso giocatore.",
            "Il candidato deve trovarsi nel raggio dei [[article:roads|cartelli indicatori]] del colono. Senza candidati l'ordine va perso e il gioco mostra «Nessun partner».",
            'Soldati, eroi, esploratori e chiunque sia mandato in [[building:barracks|Caserma]] o a [[building:school|Scuola]] non si sposano.',
            "Una coppia vive nell'abitazione della moglie, o in quella del marito se lei non ne ha una.",
          ],
        },
        {
          h: 'Crescita',
        },
        {
          table: {
            head: ['Fase', 'Età', 'Dalla nascita'],
            rows: [
              ['Neonato', 'sotto i {{age.childYears}} anni', '0-{{age.childTime}}'],
              [
                'Bambino',
                '{{age.childYears}}-{{age.adultYears}} anni',
                '{{age.childTime}}-{{age.adultTime}}',
              ],
              ['Adulto', 'dai {{age.adultYears}} anni', 'da {{age.adultTime}}'],
            ],
            foot: "Un anno di vita dura {{age.yearSeconds}} s, e il pannello del colono mostra l'età in anni interi. Un bambino gira intorno all'abitazione. Da grande, un maschio diventa un [[job:civilist|Civile]] e una femmina una [[job:woman|Donna]]. Nessuno muore di vecchiaia.",
          },
        },
        {
          h: 'Livelli delle abitazioni',
        },
        {
          figure: {
            id: 'home-levels',
            caption: 'Livelli delle abitazioni',
          },
        },
        {
          data: 'homes',
        },
        {
          p: "La dispensa ha limiti separati per cibo e torta: l'Abitazione 1 contiene {{home.larder}} + {{home.candyLarder}} unità. Un colono può vivere in un'abitazione di un'altra tribù dello stesso giocatore.",
        },
        {
          h: "Arredi dell'abitazione",
        },
        {
          table: {
            head: ['Merce', 'Da', 'Effetto', '1 unità dura', 'La donna rifornisce sotto'],
            rows: [
              [
                '[[good:crockery|Vasellame]]',
                'Abitazione 1',
                'Una consegna di cibo dà {{haul.crockeryDelivery}} unità',
                '{{home.crockeryDeliveries}} consegne',
                '{{home.crockeryFetchBelow}}',
              ],
              [
                '[[good:furniture|Mobilio]]',
                'Abitazione 1',
                'Posto per altre famiglie',
                '{{home.furnitureChildren}} figli, {{home.furnitureSleeps}} sonni o {{home.furnitureMeals}} pasti',
                '{{home.furnitureFetchBelow}}',
              ],
              [
                '[[good:holy_oil|Olio]]',
                'Abitazione 3',
                "[[article:religion|Fuoco sacro]]: si prega senza uscire dall'abitazione",
                '{{oil.burnTime}}',
                '{{home.oilFetchBelow}}',
              ],
            ],
            num: [4],
            foot: "Un'abitazione contiene fino a {{home.wareUnits}} unità di vasellame e di olio, e {{home.furnitureUnits}} di mobilio. L'Abitazione 5 contiene {{home.largeFurnitureUnits}} unità di mobilio e le rifornisce sotto {{home.largeFurnitureFetchBelow}}. L'olio brucia senza sosta, anche quando nessuno prega.",
          },
        },
        {
          list: [
            "Con il mobilio un'abitazione ospita famiglie in più, come indica la colonna Con il Mobilio della tabella dei livelli. I posti in più durano finché c'è mobilio in casa e il giocatore ne consente l'uso.",
            "Il mobilio si consuma solo finché un'abitazione ospita più famiglie di quante ne ospiterebbe senza: ne usa un po' ogni figlio concepito lì, ogni sonno lì e ogni pasto dalla sua dispensa. Un'abitazione senza famiglie in più conserva il suo mobilio.",
          ],
        },
        {
          p: "Nel pannello dell'abitazione puoi disattivare per tutto l'insediamento l'uso di vasellame e mobilio e le consegne di olio. L'olio già immagazzinato continua a bruciare.",
        },
        {
          h: "Chi perde l'abitazione",
        },
        {
          table: {
            head: ['Chi', 'Cosa succede'],
            rows: [
              ['Vedovo', 'La perde quando il figlio è cresciuto o è morto.'],
              ['Vedova', "Resta nell'abitazione."],
              ['Figlio cresciuto', 'La perde quando diventa adulto.'],
              [
                'Famiglia oltre il numero di base',
                "Trasloca quando il mobilio finisce o viene vietato, per prima l'ultima arrivata, e il gioco mostra «Trasloco». Con «Fonda famiglie» attivo, l'[[article:assistant|Assistente]] la trasferisce in un posto libero.",
              ],
              [
                'Mercante, esploratore, soldato',
                "La famiglia tiene l'abitazione, ma lui non ci mangia né ci dorme.",
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
      name: 'Assistente',
      lead: "Con i contatori ordini quanti altri figli devono nascere e quante reclute addestrare. Un contatore scende man mano che l'ordine viene eseguito. Gli interruttori distribuiscono l'equipaggiamento dai magazzini.",
      blocks: [
        {
          h: 'Contatori',
        },
        {
          table: {
            head: ['Contatore', 'Dà', 'Chi lo esegue', 'Scende', 'Può valere ∞'],
            rows: [
              ['Figlie', 'una bambina', "donna sposata con un'abitazione", 'alla nascita', 'no'],
              ['Figli', 'un bambino', "donna sposata con un'abitazione", 'alla nascita', 'sì'],
              ['Soldati senza armi', 'una recluta', '[[job:civilist|Civile]]', "dopo l'addestramento", 'sì'],
              [
                'Spadaccini, lancieri, arcieri',
                "un'arma, poi una recluta",
                'soldato disarmato, poi un civile',
                "quando prende un'arma",
                'sì',
              ],
            ],
            foot: "Un contatore va da 0 a {{assistant.counterMax}}. Un ordine dato a una singola persona prevale sull'assistente. Ordine di armi e armature: [[article:equip|Equipaggiare i soldati]].",
          },
        },
        {
          h: 'Interruttori',
        },
        {
          table: {
            head: ['Interruttore', "All'inizio", 'Chi lo riceve'],
            rows: [
              ['[[good:shoes|Scarpe]]', 'spento', 'uomo adulto'],
              [
                'Attrezzi di ferro, Attrezzi di legno',
                'spento',
                'chiunque abbia un lavoro, tranne soldati, [[job:scout|esploratori]] e civili',
              ],
              [
                'Attrezzi di ferro: Sostituisci quelli di legno',
                'acceso',
                'un lavoratore con un attrezzo di legno, se «Attrezzi di ferro» è acceso',
              ],
              ['[[good:mead|Idromele]]', 'spento', 'civili, lavoratori, soldati'],
              [
                'Pozioni nutrienti, Pozioni di resistenza, Pozioni di guarigione',
                'spento',
                'civili, lavoratori, soldati',
              ],
              [
                'Amuleto: nutrimento, resistenza, forza, difesa, precisione, vento',
                'spento',
                'civili, lavoratori, soldati',
              ],
              [
                'Diplomati della scuola assegnati automaticamente alle botteghe',
                'spento',
                'diplomato della [[building:school|Scuola]]',
              ],
              [
                'Gli estrattori spostano la bandierina in automatico',
                'spento',
                '[[job:collector|Estrattore]] con bandierina',
              ],
            ],
            foot: "Per bevande e amuleti, i pulsanti «Civili» (senza mestiere), «Lavoratori» e «Soldati» scelgono chi li riceve; con tutti e tre spenti, l'interruttore è spento. Spegnerne uno non ritira nulla. Un avviso ti ricorda un interruttore spento quando il suo bene è in magazzino e a qualcuno manca, e quello della bandierina quando un estrattore esaurisce le risorse vicino alla sua bandierina.",
          },
        },
        {
          h: 'Nascite',
        },
        {
          list: [
            'Nascono prima le figlie, poi i figli. Per questo il contatore delle figlie non ha ∞, altrimenti i figli non nascerebbero mai.',
            'Con un contatore a 3, al massimo 3 coppie aspettano un figlio contemporaneamente.',
          ],
        },
        {
          h: 'Reclutamento in caserma',
        },
        {
          list: [
            "In caserma va solo un civile adulto senza lavoro e senza nulla da fare, prima gli uomini non sposati. L'assistente non toglie mai nessuno dal lavoro.",
            "Il contatore di spadaccini, lancieri o arcieri arma prima un soldato disarmato, se c'è un'arma alla sua portata.",
          ],
        },
        {
          table: {
            head: ['Cosa blocca il reclutamento', 'Cosa fare'],
            rows: [
              ['Nessuna [[building:barracks|Caserma]] finita', 'Finisci la caserma.'],
              ['Nessun civile libero', 'Manda qualcuno in caserma a mano.'],
              [
                "Un soldato disarmato aspetta un'arma di questo tipo",
                "Consegna l'arma. Fino ad allora occupa il posto della nuova recluta.",
              ],
            ],
            foot: 'Una recluta in cammino verso la caserma conta già per il contatore.',
          },
        },
        {
          h: 'Distribuzione',
        },
        {
          list: [
            "L'assistente non equipaggia donne, bambini, [[article:heroes|eroi]] o guarnigioni delle torri.",
            "L'assistente non distribuisce scorte al di sotto della [[article:hauling|scorta minima]].",
            "Riempie gli spazi vuoti, e gli attrezzi di ferro vengono prima di quelli di legno. Con «Sostituisci quelli di legno» manda anche un lavoratore con un attrezzo di legno a prenderne uno di ferro: [[article:tools|Attrezzi]]. Non sostituisce nient'altro con qualcosa di meglio.",
            'Un colono ha {{amulet.slots}} spazi per pozioni e amuleti: [[article:draughts|Pozioni e amuleti]].',
          ],
        },
        {
          h: 'Diplomati',
        },
        {
          list: [
            'Un diplomato va al posto libero più vicino della sua professione, anche in una bottega ancora in costruzione. Ha la precedenza una bottega che produce ciò che ha studiato, anche se è più lontana.',
            "Senza posti liberi aspetta alla scuola. L'assistente non assegna [[job:collector|estrattori]], [[job:hunter|cacciatori]], [[job:fisher|pescatori]] o soldati.",
          ],
        },
        {
          p: 'Come gli estrattori spostano da soli la bandierina: [[article:work-flag|Bandierina di lavoro]].',
        },
        {
          p: 'La finestra «Cittadini» mostra quanti coloni non hanno abitazione, lavoro, attrezzi, scarpe, partner, figli, armi o idromele.',
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
      name: 'Pozioni e amuleti',
      lead: "Le pozioni il colono le beve sul posto senza interrompere ciò che sta facendo. Per l'idromele si ferma lungo la strada, come per mangiare. Gli amuleti non si consumano mai.",
      blocks: [
        {
          h: 'Pozioni',
        },
        {
          table: {
            head: ['Pozione', 'Sorsi', 'Per sorso', 'Beve quando'],
            rows: [
              [
                '[[good:mead|Idromele]]',
                '{{draught.meadUses}}',
                '+{{draught.meadPct}}% di energia e +{{draught.meadPct}}% di resistenza',
                'energia o resistenza scendono al {{need.drivePct}}%',
              ],
              [
                '[[good:potion_food_small|Pozione nutriente piccola]] / [[good:potion_food_big|grande]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '+{{draught.potionPct}}% di energia',
                "l'energia scende al {{need.drivePct}}%",
              ],
              [
                '[[good:potion_stamina_small|Pozione di resistenza piccola]] / [[good:potion_stamina_big|grande]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '+{{draught.potionPct}}% di resistenza',
                'la resistenza scende al {{need.drivePct}}%',
              ],
            ],
            num: [1],
            foot: 'Pozioni di guarigione: [[article:health|Salute e guarigione]].',
          },
        },
        {
          h: 'Amuleti',
        },
        {
          table: {
            head: ['Amuleto', 'Effetto', 'Quando'],
            rows: [
              [
                '[[good:amulet_food|Amuleto del nutrimento]]',
                '+{{amulet.needPct}}% di energia',
                "ogni volta che l'energia scende al {{need.drivePct}}%",
              ],
              [
                '[[good:amulet_stamina|Amuleto della resistenza]]',
                '+{{amulet.needPct}}% di resistenza',
                'ogni volta che la resistenza scende al {{need.drivePct}}%',
              ],
              [
                '[[good:amulet_strength|Amuleto della forza]]',
                'danni inflitti ×{{amulet.strengthFactor}}',
                'ogni colpo',
              ],
              [
                '[[good:amulet_crithit|Amuleto della precisione]]',
                '{{amulet.critChancePct}}% di probabilità di danni ×{{amulet.critFactor}}',
                'ogni colpo',
              ],
              [
                '[[good:amulet_defense|Amuleto della difesa]]',
                'danni subiti ×{{amulet.defenseFactor}}',
                'ogni colpo subito',
              ],
              [
                '[[good:amulet_speed|Amuleto del vento]]',
                'passo più breve di {{step.amuletSaved}} s',
                'ogni passo',
              ],
            ],
          },
        },
        {
          h: 'Più amuleti insieme',
        },
        {
          list: [
            'Una seconda copia dello stesso amuleto non fa nulla.',
            'Amuleti diversi agiscono insieme: forza e precisione danno ×{{amulet.comboFactor}} con un colpo fortunato.',
            'Con un amuleto del nutrimento un colono non va mai a mangiare, e con un amuleto della resistenza non va mai a dormire.',
          ],
        },
        {
          h: 'Chi porta cosa',
        },
        {
          table: {
            head: ['Chi', 'Cosa porta'],
            rows: [
              ['Uomo adulto', '{{amulet.slots}} spazi per pozioni e amuleti, in qualsiasi professione.'],
              ['Donna, bambino', 'Niente.'],
            ],
            foot: 'Cosa porta un eroe: [[article:heroes|Eroi]].',
          },
        },
      ],
      see: ['article:needs', 'article:health', 'article:heroes', 'article:damage', 'article:walking'],
    },
  ],
};
