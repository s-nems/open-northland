import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const PROBLEMS: ArticleGroup = {
  group: 'Problemi',
  items: [
    {
      id: 'why',
      name: 'Problemi frequenti',
      lead: "Seleziona l'edificio o il colono e leggi la sua barra di stato.",
      blocks: [
        {
          h: 'Lavoro e produzione',
        },
        {
          faq: [
            [
              'La bottega è vuota',
              'Lo stato «Nessun lavoratore» significa che lì non lavora nessuno: assegna un colono con la professione giusta. Se rifiuta, un messaggio dice perché: «Mestiere errato», «Nessun posto libero» o «Poca esperienza». Lo stato «Inattivo» indica la materia prima che manca. Il lavoratore va a prenderla da solo se si trova entro {{reach.goods}} esagoni da un cartello.',
            ],
            [
              "L'armaiolo, il fabbro o il sarto non lavora",
              "Molto probabilmente la sua religione in «Benessere» è allo 0%, perché armi e armature costano religione. «Vuole pregare» significa che non c'è un posto dove pregare: serve un [[building:work_temple|Tempio]], il [[building:headquarters|Quartier generale]] o un fuoco sacro nell'abitazione. Quanto costa ogni oggetto: [[article:religion|Religione e tempio]].",
            ],
            [
              'I trasportatori non trasportano',
              "Un trasportatore lavora solo se ha un luogo di lavoro in un edificio. Lo stato «Niente da trasportare nel raggio» significa che non ci sono beni entro {{flag.radius}} esagoni dall'edificio o dalla bandierina di lavoro, e «Nessuna destinazione accetta questa merce» che i magazzini sono pieni.",
            ],
            [
              "L'allevamento si è fermato",
              "L'allevatore fa riprodurre gli animali solo quando ha esattamente {{livestock.pair}} adulti. Cosa significa lo stato dell'allevamento: [[article:livestock|Bestiame]].",
            ],
            [
              'Il cacciatore non porta niente',
              "Lo stato «Nessuna preda libera nel territorio di caccia» significa che non c'è niente da cacciare entro {{flag.hunter}} esagoni dalla bandierina o dal luogo di lavoro. Non va da solo a caccia di ogni animale, vedi la colonna «Cacciato da solo»: [[article:wildlife|Animali selvatici e caccia]]. Sposta la bandierina di lavoro dove pascola la selvaggina.",
            ],
          ],
        },
        {
          h: 'Persone',
        },
        {
          faq: [
            [
              'Non nascono bambini',
              "Una coppia ha bisogno di un'abitazione comune e di {{family.childFood}} porzioni di cibo in dispensa. Un messaggio dice cosa manca: «Senza abitazione», «Abitazione incompiuta», «Vivono separati», «Niente cibo in casa». «Marito assente» significa che il marito è mercante, esploratore, soldato o eroe e non torna a casa. Puoi anche ordinare figli con i contatori «Figlie» e «Figli» dell'[[article:assistant|Assistente]]. Altro: [[article:family|Famiglia e casa]].",
            ],
            [
              'Hanno fame con il magazzino pieno',
              'Controlla «Scorta minima»: nessuno prende un bene sotto quella quantità, nemmeno per un pasto. Abbassala per il cibo. Il magazzino può anche essere troppo lontano: deve trovarsi entro {{reach.goods}} esagoni dal colono o da un cartello della sua rete.',
            ],
            [
              "Manca una professione nell'elenco della scuola",
              "L'elenco mostra solo i corsi scoperti e consentiti in questa missione. Una riga che non puoi scegliere indica il motivo: «Già appresa» o «Questi coloni non possono addestrarsi in questa scuola». I corsi si scoprono con l'[[article:exp-work|Esperienza di lavoro]].",
            ],
          ],
        },
        {
          h: 'Costruzioni e campi',
        },
        {
          faq: [
            [
              'Un edificio è bloccato',
              "Si trova nella sezione «Bloccati» della finestra di costruzione. Il suggerimento «Scoperte richieste:» dice quali professioni e beni ti servono e quanta esperienza ti manca. «Non disponibile in questa missione»: non puoi costruirlo su questa mappa. Un documento trovato in una cassa piazza l'edificio anche se non è scoperto: [[article:chests|Casse e documenti]].",
            ],
            [
              'La costruzione si è fermata',
              'Lo stato del cantiere dice cosa manca: «materiali mancanti», «consegna in arrivo» o «nessun costruttore». Il messaggio «Cantiere: serve [good]» significa che nessun magazzino nella portata dei cartelli del cantiere lo contiene, cioè entro {{reach.goods}} esagoni da un cartello. I costruttori portano da soli i materiali.',
            ],
            [
              'Un campo non cresce',
              "Senza acqua cresce solo di 1 stadio ogni {{field.stageSeconds}} s. Lo annaffia un [[job:farmer|Contadino]] di una [[building:work_farm_00|Fattoria]] o un [[job:herb_mush_guy|Erborista]] di una [[building:work_herb_hut|Capanna delle erbe]], se lì ha il suo luogo di lavoro. Prima semina e annaffia solo con {{field.max}} campi o quando non resta posto per seminare. Un campo matura dopo {{field.waterings}} annaffiature, e un'annaffiatura copre anche 6 campi vicini. Non semina sulla sabbia o su una strada, e semina entro {{field.radius}} esagoni dall'edificio, o dalla sua bandierina di lavoro se ne ha una.",
            ],
            [
              'Pioggia, neve o notte cambiano qualcosa?',
              "No. Il tempo atmosferico, l'impostazione «Inverno» e l'ora del giorno influiscono solo su immagine e suono. Si cammina più lentamente solo sulla sabbia, in montagna e sulla neve presente sulla mappa fin dall'inizio.",
            ],
          ],
        },
        {
          h: 'Esercito e veicoli',
        },
        {
          faq: [
            [
              'Un soldato non attacca',
              "Controlla il suo atteggiamento: [[article:stances|Atteggiamenti]]. In Indifferente non si avvicina e colpisce solo ciò che è a portata d'arma. Attacca solo una tribù che consideri «Ostile», e solo fuori dalla «Tregua iniziale».",
            ],
            [
              'Una nave non salpa',
              "Stato «In attesa di un comandante»: assegnane uno, va bene qualsiasi adulto. «Attende il suo equipaggio»: qualcuno dell'equipaggio sta ancora andando alla nave. «Nessun percorso»: la destinazione non è su queste acque. In mare non sale a bordo nessuno, quindi prima «Attracca».",
            ],
            [
              'Un carro di buoi non si muove',
              'Lo stato «Attende il suo animale da tiro» significa che gli manca un bue. Prende un [[good:cattle|Bue]] solo al di fuori della coppia, quindi ti servono {{draught.keptPlusOne}} adulti in un allevamento o {{draught.keptPlusOne}} fuori da un allevamento: [[article:vehicles|Veicoli e navi]].',
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
      name: 'Messaggi',
      lead: 'Un messaggio ti dice cosa si è bloccato. Qui trovi la causa e cosa fare.',
      blocks: [
        {
          table: {
            filter: 'Cerca messaggi',
            head: ['Messaggio', 'Livello', 'Causa', 'Cosa fare'],
            rows: [
              [
                '«Villaggio attaccato»',
                'Importante',
                'Qualcuno attacca un tuo edificio o una tua palizzata, o combatte entro {{notice.settlementReach}} esagoni da uno di essi',
                'Manda dei soldati',
              ],
              [
                '«Sotto attacco»',
                'Rilevante',
                "Un attacco a più di {{notice.settlementReach}} esagoni dall'insediamento",
                'Manda dei soldati o ritira la tua gente',
              ],
              [
                '«Nessun passaggio»',
                'Rilevante',
                "La risorsa è nell'area, ma nessun percorso la raggiunge",
                'Apri un passaggio o sposta la bandierina',
              ],
              [
                '«Senza comandante»',
                'Rilevante',
                "Un veicolo senza comandante ha ricevuto l'ordine di muoversi",
                'Assegna un comandante',
              ],
              [
                '«Niente commercio»',
                'Rilevante',
                'La destinazione del mercante richiede che entrambe le parti siano amichevoli',
                'Controlla la [[article:diplomacy|Diplomazia]]',
              ],
              [
                '«Nessun magazzino»',
                'Normale, bottega: Rilevante',
                'Nessun magazzino accetta il bene',
                'Costruisci un magazzino o libera spazio in uno',
              ],
              [
                '«Nessun posto libero»',
                'Rilevante',
                "L'edificio non ha luoghi di lavoro liberi",
                'Libera un posto o costruisci un secondo edificio uguale',
              ],
              [
                '«Nessun partner»',
                'Normale',
                "Dopo l'ordine «Sposa», nessuno nelle vicinanze era libero",
                'Riprova quando qualcuno è libero',
              ],
              [
                '«Serve una coppia: [good]»',
                'Rilevante',
                "L'[[article:livestock|Allevamento]] ha un solo animale",
                'Manda un esploratore a cercarne un secondo',
              ],
              [
                '«Nessuna area di montaggio», «Area di montaggio bloccata»',
                'Rilevante',
                "Accanto alla bottega non c'è terreno libero per il veicolo, per una nave non c'è acqua a portata, oppure c'è già un altro veicolo",
                "Libera un po' di spazio, la bottega riprova dopo {{notice.yardRetrySeconds}} s. Metti una bottega navale dove la finestra di costruzione non avvisa di mancanza d'acqua",
              ],
              [
                '«Niente pesce»',
                'Rilevante',
                "Non ci sono più pesci nell'acqua vicina",
                "Metti la bandierina sull'acqua con i pesci",
              ],
              [
                '«Senza trasportatore»',
                'Rilevante',
                'Nessuno a bordo può gestire il carico',
                'Fai salire a bordo un trasportatore o un altro civile',
              ],
              [
                '«Nessun percorso»',
                'Importante',
                'Il veicolo non ha una via per la destinazione. La destinazione di una nave non è su queste acque',
                "Scegli un'altra destinazione",
              ],
              [
                '«Area vuota»',
                'Rilevante',
                "L'area di lavoro non contiene questa risorsa",
                'Sposta la bandierina di lavoro o estendi i cartelli',
              ],
              [
                '«Nessuna guarnigione»',
                '-',
                'La torre non ha guarnigione',
                'Assegna degli arcieri: [[article:defence|Torri e allarme]]',
              ],
              [
                '«Nessuna risorsa»',
                'Rilevante',
                "Non resta niente da raccogliere sull'intera mappa",
                'Cambiagli professione',
              ],
              [
                '«Nessun animale: [good]»',
                'Rilevante',
                "L'[[article:livestock|Allevamento]] non ha animali di questa specie",
                'Manda un esploratore dagli animali selvatici',
              ],
              [
                '«Senza animale»',
                'Rilevante',
                'Il carro di buoi non ha un bue',
                'Tieni {{draught.keptPlusOne}} adulti: [[article:vehicles|Veicoli e navi]]',
              ],
              [
                '«Nessuna preda»',
                'Rilevante',
                'Nessuna selvaggina libera nel territorio di caccia',
                'Sposta la bandierina dove pascola la selvaggina',
              ],
              [
                '«Manca [good]»',
                'Normale, bottega: Rilevante',
                'I cantieri dei costruttori aspettano un bene che i magazzini vicini non hanno, o a una bottega manca una materia prima che nessuno produce',
                'Producilo, importalo o assegna lavoratori alla bottega',
              ],
              [
                '«Cantiere: serve [good]»',
                'Importante',
                'Nessun magazzino nella portata dei cartelli del cantiere contiene il bene',
                'Producilo, importalo o collega un magazzino con i cartelli',
              ],
              [
                '«Vuole pregare»',
                'Rilevante',
                "La religione è scesa al {{need.criticalPct}}% e non c'è un posto dove pregare",
                'Costruisci un [[building:work_temple|Tempio]] o accendi un fuoco sacro',
              ],
              [
                '«Muore di fame»',
                'Importante',
                'Il colono perde salute per la fame',
                'Porta subito cibo in un magazzino alla sua portata',
              ],
              [
                '«Affamato»',
                'Normale',
                "L'energia è scesa al {{need.criticalPct}}%",
                'Porta cibo in un magazzino alla sua portata',
              ],
              [
                '«Terra esplorata»',
                'Rilevante',
                "L'esploratore ha scoperto tutta la terra che può raggiungere e aspetta",
                'Dagli un nuovo ordine: [[article:scout|Esploratore]]',
              ],
              [
                '«Magazzino lontano», «Magazzino lontano»',
                'Normale, bottega: Rilevante',
                'I magazzini che lo accetterebbero sono fuori dalla portata dei cartelli',
                'Collegali con i cartelli o costruisci un magazzino più vicino',
              ],
              [
                '«Niente da costruire»',
                'Normale',
                'Il costruttore non ha un cantiere',
                'Piazza un edificio o cambiagli professione',
              ],
              [
                '«Niente da fare»',
                'Normale',
                'Un colono con un luogo di lavoro non ha fatto nulla per {{notice.idleSeconds}} s e non è chiaro perché',
                "Controlla l'edificio o cambiagli professione",
              ],
              [
                '«Bandierina vuota»',
                'Normale',
                'Il trasportatore non ha niente da raccogliere alla sua bandierina',
                'Sposta la bandierina o toglila',
              ],
              [
                '«Non distribuito: [good]»',
                'Rilevante',
                "Un interruttore dell'[[article:assistant|Assistente]] è spento, il suo bene è in magazzino e a qualcuno manca",
                "Accendilo nell'Assistente, o chiudi l'avviso per lasciarlo spento",
              ],
              [
                '«Bandierine ferme»',
                'Rilevante',
                "A un estrattore non resta niente vicino alla bandierina e l'Assistente non sposta le bandierine",
                "Accendilo nell'Assistente, o sposta tu la bandierina",
              ],
              [
                '«Nave irraggiungibile»',
                'Rilevante',
                'La nave è attraccata a una terra diversa da quella del veicolo',
                'Attracca a una riva che il veicolo può raggiungere',
              ],
              [
                '«Mestiere errato»',
                'Rilevante',
                "Il colono non ha la professione che serve all'edificio",
                'Cambiagli professione',
              ],
              [
                '«Tregua: accesso vietato», «Tregua: niente cantiere»',
                'Rilevante',
                "La tregua iniziale è attiva e il punto è troppo vicino all'insediamento di un altro giocatore",
                'Scegli un punto più lontano: [[article:diplomacy|Diplomazia]]',
              ],
              [
                '«Non può salire», «Bloccato a bordo»',
                'Rilevante',
                'La nave è in mare, oppure la professione non è adatta al veicolo',
                'Attracca alla riva o scegli un altro veicolo',
              ],
              [
                '«Nessuno raccoglie [good]», «Nessuno caccia [good]», «Nessuno pesca [good]»',
                'Rilevante',
                'La bottega è ferma da {{notice.noGathererSeconds}} s senza materia prima e nessuno la procura',
                'Assegna un colono o attiva questo bene per quelli che hai',
              ],
              [
                '«Nave rifiutata»',
                'Rilevante',
                'La nave non può trasportare questo veicolo, oppure il suo posto è occupato',
                'Usa una nave o libera il posto: [[article:vehicles|Veicoli e navi]]',
              ],
              [
                '«Magazzini pieni: [good]»',
                'Normale',
                'Le scorte del produttore e ogni magazzino che contiene questo bene sono pieni da {{notice.storageFullSeconds}} s',
                'Costruisci un magazzino o consuma le scorte',
              ],
              [
                '«Niente posto a bordo»',
                'Rilevante',
                'Tutti i posti sono occupati',
                'Libera un posto o usa un altro veicolo',
              ],
              [
                '«Lavoro bloccato»',
                'Rilevante',
                "La professione o l'edificio non è ancora disponibile per la tua tribù, oppure la missione lo vieta",
                'Fai la scoperta o cambia professione: [[article:exp-work|Esperienza di lavoro]]',
              ],
              [
                '«In allerta»',
                '-',
                "Un soldato in Attacco o Difesa non riposa finché c'è uno scontro entro {{alert.restClearance}} esagoni o un soldato nemico entro {{alert.standTo}} esagoni",
                "Dagli l'ordine «Mangia» o «Dormi»",
              ],
              [
                '«Materie prime lontane»',
                'Rilevante',
                'Solo edifici fuori dalla portata dei cartelli contengono la materia prima',
                'Collegali con i cartelli o costruisci un magazzino più vicino',
              ],
              [
                '«Tutto a 0»',
                'Normale',
                'Tutti i suoi contatori sono a 0',
                'Scegli nel pannello cosa deve fare',
              ],
              [
                '«Morente»',
                'Importante',
                'La salute è scesa sotto {{health.nearDeath}}, per ferite o fame',
                'Toglilo dal combattimento o dagli del cibo',
              ],
              [
                '«Nessun luogo di lavoro»',
                'Rilevante',
                "L'edificio non c'è più o il colono è stato congedato, ed è fermo da {{notice.idleSeconds}} s senza bandierina. La professione resta",
                'Assegna un luogo di lavoro o cambiagli professione',
              ],
              [
                '«Serve un riavvio»',
                'Importante',
                "L'impostazione modificata ha effetto solo dopo un riavvio",
                '«Ricomincia la mappa» nel menu Esc',
              ],
              [
                '«Prodotto bloccato»',
                'Rilevante',
                'Il prodotto scelto non è ancora disponibile',
                'Scegli un altro prodotto',
              ],
              [
                '«Poca esperienza»',
                'Rilevante',
                'Troppo poca esperienza per questa professione',
                'Manda qualcuno più esperto: [[article:exp-work|Esperienza di lavoro]]',
              ],
              [
                '«Smarrito»',
                'Importante',
                'Nessun percorso verso la destinazione, oppure il luogo di lavoro, la bandierina di lavoro o il cantiere è fuori dalla portata dei cartelli. Resta lì finché non cambi qualcosa',
                '«Mostra la meta» indica il posto. Piazza un [[article:roads|cartello]] o dai un altro ordine',
              ],
              [
                '«Esausto»',
                'Normale',
                'La resistenza è scesa al {{need.criticalPct}}%',
                'Non dargli ordini adesso, andrà a dormire da solo',
              ],
              [
                '«Prede irraggiungibili»',
                'Rilevante',
                "La selvaggina è oltre l'acqua o un muro",
                'Apri un passaggio o sposta la bandierina',
              ],
            ],
            foot: 'Il filtro «Rilevanti e importanti» nasconde i Normali, «Solo importanti» nasconde anche i Rilevanti. Il livello «-» è una riga del pannello senza avviso.',
          },
        },
      ],
      see: ['article:why'],
    },
  ],
};
