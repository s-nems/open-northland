import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const WORLD: ArticleGroup = {
  group: 'Mondo',
  items: [
    {
      id: 'goals',
      name: 'Obiettivi e fine partita',
      lead: 'Perdi quando non ti resta nessun uomo adulto. Un eroe conta, le donne, Cyra e i bambini no.',
      blocks: [
        {
          h: 'Come finisce una mappa',
        },
        {
          table: {
            head: ['Mappa', 'Vittoria', 'Sconfitta'],
            rows: [
              [
                'Mappa multiplayer, anche in partita da soli',
                'Obiettivi della mappa, vedi la tabella sotto',
                'Nessun uomo adulto, o una sconfitta annunciata dalla missione',
              ],
              [
                'Missione della storia',
                'Annunciata dalla missione',
                'Annunciata dalla missione, o nessun uomo adulto',
              ],
              ['Mappa senza missione', 'Ultimo superstite', 'Nessun uomo adulto'],
            ],
          },
        },
        {
          h: 'Obiettivi delle mappe multiplayer',
        },
        {
          table: {
            head: ['Obiettivo', 'Cosa conta', 'Risultato'],
            rows: [
              [
                'Beni',
                'Le scorte negli edifici. Mucchi a terra, stive delle navi e beni in mano non contano',
                'Vittoria quando hai tutte le quantità richieste',
              ],
              [
                '«Abitanti»',
                'Tutta la popolazione del giocatore, bambini compresi',
                'Vittoria al numero richiesto',
              ],
              [
                '«Soldati»',
                'Uomini adulti con una professione da soldato, eroi esclusi',
                'Vittoria al numero richiesto',
              ],
              [
                'Annuncio della missione',
                'La missione annuncia la vittoria o la sconfitta del giocatore',
                'Vittoria o sconfitta',
              ],
              [
                'Ultimo superstite',
                'Almeno un giocatore è stato eliminato e tutti gli altri sono amichevoli tra loro: [[article:diplomacy|Diplomazia]]',
                'Vittoria per tutti quelli rimasti',
              ],
            ],
            foot: "Il gioco mostra l'avanzamento di beni, «Abitanti» e «Soldati» come attuale/richiesto. «Ultimo superstite» vale solo se la mappa non ha obiettivi di beni o di popolazione e la missione non annuncia alcun risultato.",
          },
        },
        {
          list: [
            'Nei primi {{match.graceSeconds}} s di gioco, restare senza uomini non significa sconfitta.',
            'Il risultato si decide una volta per tutte. Chi ha vinto resta vincitore anche se poi perde la sua gente.',
            'La vittoria di un giocatore non chiude la partita per gli altri.',
          ],
        },
        {
          h: 'Cosa resta di un giocatore sconfitto',
        },
        {
          p: 'Su una mappa multiplayer spariscono gli edifici, i veicoli e i cartelli indicatori del giocatore sconfitto, la sua gente a terra si trasforma in galline selvatiche e i suoi animali tornano selvatici. Nelle missioni della storia e sulle mappe senza missione spariscono solo i veicoli, e il computer smette di giocare.',
        },
      ],
      see: ['article:diplomacy', 'article:family', 'article:heroes'],
    },
    {
      id: 'vehicles',
      name: 'Veicoli e navi',
      lead: 'Un veicolo senza comandante non va da nessuna parte. La nave porta più persone, la grande nave più beni.',
      blocks: [
        {
          p: 'La scheda di ogni veicolo indica stiva, posti passeggeri, salute e costo: [[vehicle:handcart|Carretto a mano]], [[vehicle:oxcart|Carro di buoi]], [[vehicle:ship_small|Nave]], [[vehicle:ship_big|Grande nave]], [[vehicle:catapult|Catapulta]]. Quale bottega produce cosa è indicato sulle schede della [[building:work_joinery_02|Bottega del carpentiere 3]] e [[building:work_joinery_03|4]].',
        },
        {
          table: {
            head: ['Veicolo', 'Chi sale a bordo'],
            rows: [
              [
                '[[good:handcart|Carretto a mano]], [[good:oxcart|Carro di buoi]]',
                '[[job:carrier|Trasportatore]], [[job:trader|Mercante]]',
              ],
              ['[[good:ship_small|Nave]], [[good:ship_big|Grande nave]]', 'qualsiasi adulto'],
              ['[[good:catapult|Catapulta]]', 'soldato, eroe'],
            ],
          },
        },
        {
          list: [
            'Il numero di passeggeri sulla scheda non include il comandante. Il primo assegnato diventa comandante, e quando scende il passeggero successivo prende il suo posto.',
            "Il [[job:joiner|Carpentiere]] costruisce un veicolo su un'area di montaggio accanto alla bottega, e una nave sull'acqua nel raggio della bottega. Senza quell'acqua, la finestra di costruzione avvisa «Nessuna acqua navigabile nel raggio».",
            'Chi sale a bordo perde il suo luogo di lavoro. Solo un trasportatore con un luogo di lavoro e un mercante tirano il carro da soli e tengono il loro lavoro.',
            'Il comandante e ogni uomo adulto a bordo caricano i beni, ma soldati, eroi, [[job:scout|esploratori]] e [[job:druid|druidi]] solo quando sono al comando. Senza nessuno che carichi compare «Senza trasportatore».',
          ],
        },
        {
          h: 'Quale carro scegliere',
        },
        {
          list: [
            'Il [[good:handcart|Carretto a mano]] è adatto ai percorsi brevi, il [[good:oxcart|Carro di buoi]] a quelli lunghi: porta {{haul.oxcart}} unità e rallenta appena quando è carico.',
            'Dai ai [[job:carrier|trasportatori]] i carretti a mano: nei brevi tragitti tra gli edifici spostano più beni nello stesso tempo.',
            'Dai ai [[job:trader|mercanti]] i carri di buoi: sulle lunghe rotte commerciali trasportano di più. Dove sta il confine: [[article:trade|Commercio]].',
          ],
        },
        {
          h: 'Velocità con un carico',
        },
        {
          table: {
            head: ['Veicolo', 'Strada: vuoto', 'Strada: pieno'],
            rows: [
              ['[[good:handcart|Carretto a mano]]', '{{pace.cartRoad}}', '{{pace.handcartRoadFull}}'],
              ['[[good:oxcart|Carro di buoi]]', '{{pace.cartRoad}}', '{{pace.oxcartRoadFull}}'],
              ['[[good:catapult|Catapulta]]', '{{pace.catapultRoad}}', '-'],
            ],
            num: [1, 2],
            foot: 'Esagoni al secondo. Pieno significa {{haul.handcart}} unità sul carretto a mano e {{haul.oxcart}} sul carro di buoi. Fuori strada: la tabella sotto. Scegliere un carro per un percorso: [[article:trade|Commercio]].',
          },
        },
        {
          h: 'Quanto un carico rallenta un carro',
        },
        {
          table: {
            head: [
              'Carico',
              'Carretto a mano: perdita di velocità',
              'Carretto a mano: esagoni/s fuori strada',
              'Carro di buoi: perdita di velocità',
              'Carro di buoi: esagoni/s fuori strada',
            ],
            rows: [
              [
                '{{vehicle.fill.0}}%',
                '{{vehicle.handcartLoss.0}}%',
                '{{pace.handcartLand.0}}',
                '{{vehicle.oxcartLoss.0}}%',
                '{{pace.oxcartLand.0}}',
              ],
              [
                '{{vehicle.fill.25}}%',
                '{{vehicle.handcartLoss.25}}%',
                '{{pace.handcartLand.25}}',
                '{{vehicle.oxcartLoss.25}}%',
                '{{pace.oxcartLand.25}}',
              ],
              [
                '{{vehicle.fill.50}}%',
                '{{vehicle.handcartLoss.50}}%',
                '{{pace.handcartLand.50}}',
                '{{vehicle.oxcartLoss.50}}%',
                '{{pace.oxcartLand.50}}',
              ],
              [
                '{{vehicle.fill.75}}%',
                '{{vehicle.handcartLoss.75}}%',
                '{{pace.handcartLand.75}}',
                '{{vehicle.oxcartLoss.75}}%',
                '{{pace.oxcartLand.75}}',
              ],
              [
                '{{vehicle.fill.100}}%',
                '{{vehicle.handcartLoss.100}}%',
                '{{pace.handcartLand.100}}',
                '{{vehicle.oxcartLoss.100}}%',
                '{{pace.oxcartLand.100}}',
              ],
            ],
            num: [0, 1, 2, 3, 4],
            foot: 'Il carico è la parte della stiva del carro in uso. La perdita cresce in modo uniforme con il carico: un carretto a mano pieno va più lento del {{vehicle.handcartLoss.100}}%, uno pieno a metà del {{vehicle.handcartLoss.50}}%. Un carro di buoi pieno perde il {{vehicle.oxcartLoss.100}}%. Per confronto: un colono con le scarpe cammina a {{pace.walkerLand}} esagoni/s fuori strada (un passo ogni {{step.landBrief}} s).',
          },
        },
        {
          list: [
            'Così si muove un carro con un comandante. Le scarpe qui non cambiano nulla.',
            'Un trasportatore o un mercante che tira da solo un carro va al proprio passo, più veloce con le scarpe. Il carico lo rallenta della stessa percentuale: un mercante con le scarpe e un carretto a mano pieno impiega {{step.traderFullCart}} s per passo fuori strada.',
            'Una [[good:catapult|Catapulta]] si muove fuori strada a {{pace.catapultLand}} esagoni/s.',
            'Una nave carica non rallenta e naviga a circa {{pace.ship}} esagoni/s.',
          ],
        },
        {
          h: 'Un bue per il carro di buoi',
        },
        {
          p: 'Un carro di buoi finito aspetta il suo animale da tiro e prende il [[good:cattle|Bue]] adulto più vicino sulla stessa terraferma. Ogni allevamento tiene per sé {{draught.kept}} buoi adulti e lo stesso numero resta in una mandria senza allevamento, quindi il carro di buoi riceve solo un bue oltre quel numero.',
        },
        {
          h: 'Navi',
        },
        {
          table: {
            head: ['Nave', 'Posti per veicoli', 'Veicoli'],
            rows: [
              [
                '[[good:ship_small|Nave]]',
                '{{vehicle.shipSlots}}',
                'Carretto a mano, Carro di buoi, Catapulta',
              ],
              ['[[good:ship_big|Grande nave]]', '{{vehicle.bigShipSlots}}', 'Carretto a mano, Carro di buoi'],
            ],
            num: [1],
          },
        },
        {
          list: [
            'Un veicolo sale a bordo se il suo equipaggio entra nella nave. Una nave assegnata alla rotta di un mercante non prende veicoli.',
            '«Attracca»: scegli una riva e la nave si ferma a {{vehicle.mooringDistance}} esagoni da essa. Non serve un porto.',
            'In mare nessuno sale o scende.',
            'Ctrl/Cmd + clic destro attracca e fa sbarcare tutti tranne il comandante, così la nave può ripartire subito. Alt + clic destro attracca e fa sbarcare tutti.',
          ],
        },
        {
          h: 'Stiva',
        },
        {
          list: [
            '«obiettivo» è il numero di unità che vuoi nella stiva. La somma degli obiettivi non può superare la capienza.',
            '«dal trasportatore»: un trasportatore tira il carro e sceglie da solo il carico a ogni viaggio. In questo caso non puoi impostare obiettivi.',
            'Chi carica porta 1 unità alla volta. Cerca i beni prima entro {{vehicle.cargoSearch}} esagoni dal carro, poi ovunque arrivino i cartelli indicatori.',
            'Il bene deve trovarsi sulla stessa terraferma del carro o della nave. Nessuno prende cibo dalle abitazioni.',
            'Quando abbassi un obiettivo, il surplus va al magazzino o al quartier generale più vicino con spazio, entro {{vehicle.cargoSearch}} esagoni dal carro. Se non ce ne sono, finisce a terra.',
          ],
        },
        {
          h: 'Perdere un veicolo',
        },
        {
          table: {
            head: ['Veicolo', 'Equipaggio a bordo', 'Veicolo trasportato', 'Carico'],
            rows: [
              [
                'Carro, [[good:catapult|Catapulta]]',
                'Scende accanto',
                '-',
                'Sparso entro {{vehicle.spill}} esagoni',
              ],
              ['Nave attraccata', 'Scende sulla riva', 'Si ferma sulla riva', 'Perso'],
              ['Nave in mare', 'Affonda', "Affonda con l'equipaggio", 'Perso'],
            ],
            foot: "Finché il veicolo regge, nessuno può colpire l'equipaggio al suo interno.",
          },
        },
      ],
      see: ['article:hauling', 'article:trade', 'article:catapult', 'article:livestock', 'good:handcart'],
    },
    {
      id: 'diplomacy',
      name: 'Diplomazia',
      lead: "L'atteggiamento va in una sola direzione: il tuo verso di loro e il loro verso di te sono due impostazioni separate.",
      blocks: [
        {
          h: "Cosa fa l'atteggiamento",
        },
        {
          table: {
            head: ['Effetto', 'Ostile', 'Neutrale', 'Amichevole'],
            rows: [
              ['Attacchi la loro gente e i loro edifici', 'sì', 'no', 'no'],
              ['Gli [[job:scout|esploratori]] prendono i loro buoi e le loro pecore', 'sì', 'no', 'no'],
              [
                'Il [[job:trader|mercante]] commercia con le offerte nei loro edifici',
                'no',
                'no',
                'sì, da entrambe le parti',
              ],
              ['Visuale della mappa condivisa', 'no', 'no', 'sì, da entrambe le parti'],
              ['Vittoria condivisa «Ultimo superstite»', 'no', 'no', 'sì, da entrambe le parti'],
            ],
            foot: 'Una visuale condivisa richiede anche «Mappa condivisa tra alleati» nelle impostazioni della partita.',
          },
        },
        {
          h: "Cosa cambia l'atteggiamento",
        },
        {
          table: {
            head: ['Evento', 'Risultato'],
            rows: [
              [
                'Inizio della mappa',
                'La mappa imposta gli atteggiamenti. Dove non ne indica, parti neutrale',
              ],
              ['Qualcuno ti attacca', 'Il tuo atteggiamento verso di lui diventa automaticamente ostile'],
              ['Imposti ostile verso un computer neutrale', 'Anche il computer diventa ostile'],
              ['Computer neutrale su una mappa a isole', 'Diventa ostile ai giocatori da solo'],
              [
                'Abbassi il tuo atteggiamento verso un computer amichevole',
                'Anche il computer abbassa il suo, al tuo livello',
              ],
              ['Computer ostile', 'Non fa mai la pace di sua iniziativa'],
              ['Missione', 'Può cambiare atteggiamento, anche dopo un tributo pagato'],
              ['«Atteggiamento fissato dallo scenario»', 'Non puoi cambiarlo nella finestra Diplomazia'],
            ],
          },
        },
        {
          h: 'Tregua iniziale',
        },
        {
          list: [
            'Imposti la «Tregua iniziale» prima della partita. I giocatori in tregua non possono combattersi.',
            'Non puoi mandare persone né costruire entro {{peace.keepOut}} esagoni da un edificio di quel giocatore, a meno che il punto non sia più vicino a un tuo edificio.',
            'Gli avvisi arrivano {{peace.noticeFirstMinutes}} min e {{peace.noticeLastMinutes}} min prima della fine.',
          ],
        },
        {
          h: 'Primo contatto',
        },
        {
          p: 'Con la nebbia, una tribù entra nella finestra Diplomazia quando vedi una sua persona, un suo edificio, veicolo o palizzata, oppure quando ti attacca. Da quel momento ci resta per sempre.',
        },
        {
          h: 'Tributi',
        },
        {
          p: 'Solo una missione chiede un tributo. «Paga» nella finestra Diplomazia preleva subito i beni, nessuno li trasporta, e la «Scorta minima» non li protegge.',
        },
        {
          p: 'I beni vengono dal [[building:headquarters|Quartier generale]], dai magazzini e dalle botteghe, da una bottega solo i suoi prodotti. Abitazioni, torri, la [[building:barracks|Caserma]], la [[building:school|Scuola]] e i mucchi a terra non pagano.',
        },
      ],
      see: ['article:trade', 'article:fog', 'article:walls'],
    },
    {
      id: 'fog',
      name: 'Nebbia e visuale',
      lead: "L'esploratore vede a {{vision.scout}} esagoni, il quartier generale a {{vision.headquarters}}. Un cantiere non vede nulla.",
      blocks: [
        {
          h: 'Modalità della mappa',
        },
        {
          table: {
            head: ['Impostazione', 'Inizio', 'Terreno fuori vista'],
            rows: [
              ['Rivelata', 'tutto visibile', 'niente nebbia'],
              ['Classica', 'mappa nera', 'una volta scoperto, resta visibile'],
              ['Classica + nebbia di guerra', 'mappa nera', 'terreno grigio, senza persone né animali'],
              [
                'Ricognizione',
                'terreno grigio, senza persone né animali',
                'una volta scoperto, resta visibile',
              ],
              [
                'Ricognizione + nebbia di guerra',
                'terreno grigio, senza persone né animali',
                'terreno grigio, senza persone né animali',
              ],
            ],
          },
        },
        {
          p: "Il terreno grigio mostra edifici, beni, risorse e veicoli com'erano l'ultima volta che li hai visti. Persone e animali lì non compaiono.",
        },
        {
          h: 'Raggio visivo',
        },
        {
          figure: {
            id: 'vision',
            caption: 'Raggio visivo',
          },
        },
        {
          table: {
            head: ['Chi', 'Raggio, esagoni'],
            rows: [
              ['[[job:scout|Esploratore]]', '{{vision.scout}}'],
              ['[[building:headquarters|Quartier generale]]', '{{vision.headquarters}}'],
              ['Eroe', '{{vision.hero}}'],
              ['[[good:ship_small|Nave]], [[good:ship_big|Grande nave]]', '{{vision.ship}}'],
              ['Soldato', '{{vision.soldier}}'],
              ['Qualsiasi altro edificio', '{{vision.building}}'],
              ['[[good:handcart|Carretto a mano]], [[good:oxcart|Carro di buoi]]', '{{vision.cart}}'],
              ['[[good:catapult|Catapulta]]', '{{vision.siege}}'],
              ['Altri adulti, i tuoi animali', '{{vision.adult}}'],
              ['Bambino', '{{vision.child}}'],
              ['Cantiere', '0'],
            ],
            num: [1],
            foot: 'Palizzate, strade e cartelli indicatori non rivelano nulla. Soldati e [[job:hunter|cacciatori]] trovano bersagli anche nella nebbia, ma una [[good:catapult|Catapulta]] spara da sola solo a ciò che vede.',
          },
        },
      ],
      see: ['article:scout', 'article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'scout',
      name: 'Esploratore',
      lead: 'Un esploratore non ha un luogo di lavoro e non fa nulla senza un ordine.',
      blocks: [
        {
          p: 'Piazza [[article:roads|cartelli indicatori]] senza materiali e reclama buoi e pecore selvatici quando ci passa accanto: [[article:livestock|Bestiame]]. Può percorrere tutta la mappa, i cartelli indicatori non lo limitano.',
        },
        {
          h: '«Esplora»',
        },
        {
          list: [
            'Scopre il territorio in cerchi sempre più ampi intorno al punto che indichi.',
            "Non lascia la sua terraferma. Solo una [[article:vehicles|nave]] può portarlo su un'altra.",
            'Salta le strisce strette lungo le coste e i bordi della mappa, quindi piccole zone possono restare inesplorate.',
          ],
        },
        {
          h: 'Quando ha finito',
        },
        {
          table: {
            head: ['Evento', 'Risultato'],
            rows: [
              ['Non resta nulla da esplorare', "Avviso «Terra esplorata», l'esploratore aspetta"],
              [
                'Per più di {{explore.maxFailedLegs}} volte di fila non è riuscito ad arrivare',
                'Il resto conta come irraggiungibile, «Terra esplorata»',
              ],
              ['Nuovo ordine o cambio di professione', "L'esplorazione si interrompe"],
              ['Ordine con Maiusc', "Eseguito dopo la fine dell'esplorazione"],
            ],
          },
        },
      ],
      see: ['article:roads', 'article:livestock', 'article:fog', 'job:scout'],
    },
    {
      id: 'wildlife',
      name: 'Animali selvatici e caccia',
      lead: 'Un branco aggressivo si lancia sulle persone entro {{wild.aggro}} esagoni dal punto in cui pascola. Insegue per al massimo {{wild.giveUp}} esagoni, poi torna indietro.',
      blocks: [
        {
          p: "La scheda di un animale nell'enciclopedia indica salute, dimensione del branco e se può essere addomesticato.",
        },
        {
          h: 'Aggressività',
        },
        {
          table: {
            head: ['Gruppo', 'Animali', 'Comportamento'],
            rows: [
              ['Aggressivi', 'Lupo, leone, leonessa, orso polare', 'Attaccano di loro iniziativa'],
              [
                'Reagiscono se colpiti',
                'Orso, elefante',
                "Pericolosi per {{wild.angrySeconds}} s dall'ultimo colpo. Un attacco in corso dura finché il bersaglio muore o si nasconde",
              ],
              [
                'Timorosi',
                'Tutti gli altri',
                'Un capobranco colpito fugge fino a {{wild.flight}} esagoni, il branco lo segue',
              ],
            ],
            foot: 'Lo stambecco non attacca e non fugge.',
          },
        },
        {
          list: [
            'Quando colpisci un animale, reagiscono anche gli altri della sua specie entro {{wild.kinAlarm}} esagoni.',
            'Gli animali non attaccano edifici né veicoli.',
          ],
        },
        {
          h: 'Crescita del branco',
        },
        {
          p: "Cresce solo circa 1 branco su {{wild.breedingShare}}. Un branco così guadagna 1 adulto ogni {{wild.growthMinutes}} min, se ha almeno 2 animali e meno di quanti ne indica «Branco» sulla scheda dell'animale.",
        },
        {
          h: 'Cosa caccia un cacciatore',
        },
        {
          list: [
            'Il terreno di caccia arriva a {{flag.hunter}} esagoni dalla bandierina di lavoro o dal luogo di lavoro. Durante un inseguimento il cacciatore va al massimo {{wild.huntChase}} esagoni oltre.',
            "Punta prima all'animale più debole, anche se è lontano.",
            'Il tiro del cacciatore toglie {{wild.hunterShot}} di salute a un animale e arriva da {{hunterBow.min}} a {{hunterBow.max}} esagoni.',
            'Non caccia da solo uno stambecco adulto, ma caccia i suoi piccoli.',
            "Non caccia animali che appartengono a qualcuno, né quelli su un'altra terraferma.",
            'Sulla scheda di un animale, «Cacciatore: da solo» è la selvaggina che caccia di sua iniziativa, e «su ordine» quella che attacca solo quando glielo ordini.',
          ],
        },
        {
          h: 'Uccisione',
        },
        {
          p: 'Cosa lascia un animale adulto è indicato sulla sua scheda. Un piccolo ucciso da un cacciatore dà la metà, un piccolo di cavallo solo 1 [[good:leather|Cuoio]]. Un piccolo ucciso da chiunque altro non lascia nulla.',
        },
      ],
      see: ['article:damage', 'article:gathering', 'article:livestock', 'job:hunter'],
    },
    {
      id: 'livestock',
      name: 'Bestiame',
      lead: "L'allevatore fa riprodurre gli animali solo quando ha esattamente {{livestock.pair}} adulti di una specie. Un terzo lo macella prima.",
      blocks: [
        {
          figure: {
            id: 'livestock-cycle',
            caption: "Il ciclo dell'allevamento",
          },
        },
        {
          h: 'Dove trovare gli animali',
        },
        {
          table: {
            head: ['Chi', 'Cosa fa', 'Raggio, esagoni'],
            rows: [
              [
                '[[job:scout|Esploratore]]',
                "Passando, reclama buoi e pecore selvatici e gli animali di un nemico. Quelli un po' più lontani si disperdono",
                'reclamo {{livestock.captureRange}}, dispersione {{livestock.scatterRange}}',
              ],
              [
                '[[job:breeder|Allevatore]]',
                "Porta all'allevamento il tuo animale più vicino che si trova fuori da un allevamento. Quando gli manca una coppia, prende anche il surplus da un altro tuo allevamento",
                'stessa terraferma',
              ],
            ],
            foot: 'Un esploratore fermo non reclama nulla.',
          },
        },
        {
          h: 'Macellazione',
        },
        {
          table: {
            head: ['Animale', 'La macellazione dà'],
            rows: [
              [
                '[[good:sheep|Pecora]]',
                '{{livestock.sheepWool}} [[good:wool|Lana]], {{livestock.sheepMeat}} [[good:meat|Carne]]',
              ],
              [
                '[[good:cattle|Bue]]',
                '{{livestock.cattleLeather}} [[good:leather|Cuoio]], {{livestock.cattleMeat}} [[good:meat|Carne]]',
              ],
            ],
            foot: "Scegli la specie nella produzione dell'allevatore. Quanto costa e cosa richiede un piccolo, e quanti beni contiene l'allevamento, è indicato sulla scheda dell'[[building:work_animal_farm|Allevamento]].",
          },
        },
        {
          list: [
            'Un [[building:work_animal_farm|Allevamento]] contiene {{livestock.farmHerd}} animali in tutto, contando entrambe le specie e i piccoli in arrivo.',
            'I piccoli impiegano {{livestock.growMinutes}} min a crescere e fino ad allora non contano per la coppia.',
          ],
        },
        {
          h: "Stato dell'allevamento",
        },
        {
          table: {
            head: ['Messaggio', 'Significato'],
            rows: [
              ['«Senza animale»', 'Neanche un animale, serve un esploratore'],
              ['«Un solo animale»', 'Ne serve un secondo'],
              ['«Cuccioli in crescita»', 'La riproduzione riprende quando una coppia è cresciuta'],
              ['«Mandria al completo»', "L'allevatore aspetta che i piccoli crescano"],
            ],
          },
        },
      ],
      see: ['article:vehicles', 'article:wildlife', 'article:food', 'building:work_animal_farm'],
    },
    {
      id: 'religion',
      name: 'Religione e tempio',
      lead: 'La religione cala solo fabbricando armi e armature. Allo 0% un artigiano non fabbrica armi né armature.',
      blocks: [
        {
          h: 'Quanta religione costa ogni oggetto',
        },
        {
          table: {
            head: [
              'Professione',
              'Costa il {{piety.lowPct}}% di religione per unità',
              'Costa il {{piety.highPct}}% di religione per unità',
            ],
            rows: [
              [
                '[[job:armorer|Armaiolo]]',
                '[[good:bow_short|Arco corto]], [[good:spear_wooden|Lancia di legno]]',
                '[[good:bow_long|Arco lungo]]',
              ],
              [
                '[[job:smith|Fabbro]]',
                '[[good:spear_iron|Lancia di ferro]], [[good:sword_shord|Spada corta]]',
                '[[good:sword_long|Spada lunga]], [[good:armor_chain|Cotta di maglia]], [[good:armor_plate|Armatura di piastre]]',
              ],
              [
                '[[job:sewer|Sarto]]',
                '[[good:armor_wool|Tunica]], [[good:armor_leather|Armatura di cuoio]]',
                '-',
              ],
            ],
            foot: 'È uguale in ogni tribù. Gli altri prodotti di queste professioni non costano religione.',
          },
        },
        {
          list: [
            'Sotto il {{need.drivePct}}% armaiolo, fabbro e sarto vanno a pregare da soli. Quando non hanno dove andare, al {{need.criticalPct}}% compare «Vuole pregare».',
            'Finiscono un oggetto già iniziato, anche allo 0%.',
          ],
        },
        {
          h: 'Dove pregare',
        },
        {
          table: {
            head: ['Luogo', 'Condizione'],
            rows: [
              ['Abitazione', 'Quando ci arde un fuoco sacro. In tal caso il colono prega prima a casa'],
              [
                '[[building:work_temple|Tempio]], [[building:headquarters|Quartier generale]]',
                'Solo se finito e tuo',
              ],
            ],
            foot: 'Una preghiera dura {{pray.seconds}} s e dà +{{pray.pct}}% di religione.',
          },
        },
        {
          h: 'Fuoco sacro',
        },
        {
          p: "Puoi accenderlo dall'Abitazione 3 in su. 1 [[good:holy_oil|Olio]] dura {{oil.burnTime}}, una scorta piena nell'abitazione {{oil.fullBurnTime}}. Il fuoco arde anche quando nessuno prega.",
        },
        {
          h: 'Aura del tempio',
        },
        {
          table: {
            head: ['Effetto', 'Valore'],
            rows: [
              ['Raggio', '{{aura.range}} esagoni'],
              ['Salute', '+{{aura.perSecond}} al secondo, fino a {{aura.ceiling}}'],
              ['Religione', '+{{aura.pietyPct}}% al secondo finché la barra è al {{need.satedPct}}% o meno'],
              ['Per chi', 'Tutta la tua gente, ai bambini solo salute'],
              ['Condizione', 'Tempio finito, integro e con [[good:holy_oil|olio]] che brucia'],
              [
                'Olio',
                '1 dura {{aura.oilBurnTime}}, la scorta piena di {{aura.oilUnits}} dura {{aura.oilFullBurnTime}}',
              ],
              ['Più templi', 'Le aure non si sommano'],
            ],
            foot: 'La salute sopra {{health.human}} resta finché le ferite non la tolgono.',
          },
        },
        {
          p: "I [[job:druid|druidi]] portano da soli l'olio ai templi entro i loro [[article:roads|cartelli]]. Può portarlo anche un [[job:carrier|trasportatore]] assegnato al tempio o un [[job:trader|mercante]]. Un tempio nuovo parte con l'olio del suo costo di costruzione. Senza olio, o se è danneggiato, il suo bagliore e il suo fuoco si spengono. Puoi anche spegnere tu il fuoco nel pannello del tempio: conserva allora l'olio e non benedice nessuno finché non lo riaccendi.",
        },
      ],
      see: ['article:needs', 'article:health', 'building:work_temple', 'good:holy_oil'],
    },
    {
      id: 'chests',
      name: 'Casse e documenti',
      lead: 'I documenti trovati nelle casse erigono subito un edificio, senza costruzione, materiali né scoperte richieste.',
      blocks: [
        {
          p: "Qualsiasi adulto può aprire una cassa, ma una cassa magica solo un [[job:druid|Druido]] o un eroe. L'ordine è «Apri la cassa». Il colono deve poterla raggiungere a piedi.",
        },
        {
          h: 'Contenuto',
        },
        {
          table: {
            head: ['Ricompensa', 'Cassa', 'Magica'],
            rows: [
              ['Pozione o amuleto', '{{chest.singleWooden}}', '{{chest.singleMagical}}'],
              ['Pozioni grandi, 1 tipo', '{{chest.bulkWooden}}', '{{chest.bulkMagical}}'],
              [
                '[[good:armor_chain|Cotta di maglia]], [[good:armor_plate|Armatura di piastre]] o [[good:shoes|Scarpe]]',
                '{{chest.wearWooden}}',
                '{{chest.wearMagical}}',
              ],
              ['[[good:bread|Cibo]]', '{{chest.foodWooden}}', '{{chest.foodMagical}}'],
              ['[[good:catapult|Catapulta]]', '1', '1'],
              [
                'Civili, donne, soldati con spada lunga o arcieri con arco lungo',
                '{{chest.settlers}}',
                '{{chest.settlers}}',
              ],
              [
                'Lupi o leoni. Escono selvatici e attaccano subito',
                '{{chest.wolves}} o {{chest.lions}}',
                '{{chest.wolves}} o {{chest.lions}}',
              ],
            ],
            num: [1, 2],
            foot: 'È la mappa a stabilire il contenuto di ogni cassa, non il caso.',
          },
        },
        {
          h: 'Documenti',
        },
        {
          table: {
            head: ['Documento', 'Effetto'],
            rows: [
              [
                'Piazza un edificio a scelta',
                "Qualsiasi edificio dell'elenco di costruzione, subito in piedi",
              ],
              ["Piazza 'nome'", "L'edificio indicato, subito in piedi"],
              ["Piazza 'nome' e riempine il magazzino", "L'edificio indicato con le scorte piene"],
            ],
            foot: "Un documento sparisce dopo l'uso, tranne quando il punto non è adatto. Trovi i tuoi documenti nella finestra di costruzione alla voce «Documenti».",
          },
        },
        {
          h: 'Documenti con una bottega',
        },
        {
          table: {
            head: ['Edificio con scorte', 'Colono', 'Scopre per sempre'],
            rows: [
              [
                '[[building:work_smithy_01|Fucina 2]]',
                '1 [[job:smith|Fabbro]]',
                '[[good:sword_long|Spada lunga]]',
              ],
              [
                '[[building:work_armory_00|Armeria 1]]',
                '1 [[job:armorer|Armaiolo]]',
                '[[good:bow_short|Arco corto]]',
              ],
              ['[[building:work_coin_mint|Zecca]]', '1 [[job:coin_maker|Coniatore]]', '[[good:coin|Moneta]]'],
              [
                "[[building:work_druid_00|Capanna dell'alchimista 1]]",
                '1 [[job:druid|Druido]]',
                '[[good:holy_oil|Olio]]',
              ],
              [
                "[[building:work_druid_01|Capanna dell'alchimista 2]]",
                '1 [[job:druid|Druido]]',
                '[[good:holy_oil|Olio]], pozioni piccole',
              ],
            ],
            foot: 'Una cassa così dà anche un colono con quella professione e sblocca la professione.',
          },
        },
      ],
      see: ['article:construction', 'article:trades', 'article:draughts'],
    },
  ],
};
