import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const EXPERIENCE: ArticleGroup = {
  group: 'Esperienza',
  items: [
    {
      id: 'exp-work',
      name: 'Esperienza di lavoro',
      lead: "L'esperienza cresce separatamente per ogni bene: il 100% sul legno non serve a niente per la pietra grezza.",
      blocks: [
        {
          h: "Cosa ti dà l'esperienza",
        },
        {
          figure: {
            id: 'exp-curve',
            caption: 'I primi pezzi contano di più',
          },
        },
        {
          data: 'experience',
        },
        {
          p: "La tabella vale per il lavoro normale. Legno, caccia, pesca e costruzione crescono con un ritmo proprio, vedi la tabella più sotto. Nella [[article:gathering|raccolta]] l'esperienza riduce i colpi per pezzo, mentre nelle botteghe e nella macellazione aggiunge pezzi in più. Esperienza e attrezzi insieme: [[article:tools|Attrezzi]]. Costruzione: [[article:construction|Costruzione, miglioramenti e riparazioni]].",
        },
        {
          p: 'Quando selezioni uno dei tuoi coloni, vedi la stella della sua professione. Compare quando la sua abilità migliore nella professione arriva al {{star.step}}% e cresce ogni {{star.step}}% fino al {{star.full}}%. I trasportatori non la ricevono.',
        },
        {
          h: 'Quanto lavoro serve',
        },
        {
          table: {
            head: ['Lavoro', 'Si conta per', 'Volte fino a metà ({{exp.quotedPct}}%)', 'Volte fino al 100%'],
            rows: [
              ['Legno', 'albero abbattuto', '{{exp.wood.repeatsQuoted}}', '{{exp.wood.repeatsFull}}'],
              [
                'Caccia',
                'pezzo preso da una carcassa',
                '{{exp.hunt.repeatsQuoted}}',
                '{{exp.hunt.repeatsFull}}',
              ],
              ['Pesca', 'pesce', '{{exp.fish.repeatsQuoted}}', '{{exp.fish.repeatsFull}}'],
              [
                'Argilla, pietra grezza, ferro, oro, funghi, erbe, grano, macellazione, bottega',
                'pezzo, animale macellato, ciclo in bottega',
                '{{exp.craft.repeatsQuoted}}',
                '{{exp.craft.repeatsFull}}',
              ],
              [
                'Costruzione, riparazioni',
                'colpo di martello in un cantiere',
                '{{exp.build.repeatsQuoted}}',
                '{{exp.build.repeatsFull}}',
              ],
            ],
            num: [2, 3],
            foot: 'Le ultime colonne contano alberi, pezzi, cicli o colpi. Dal {{build.bareGainPct}}% un [[job:builder|costruttore]] senza attrezzo ha bisogno della metà dei colpi per pezzo di materiale. Nel pannello del colono, nella scheda Esperienza, ogni abilità ha la sua riga, per esempio Estrazione - Ferro: {{exp.craft.repeatsQuoted}} volte, produzione +{{exp.quotedPct}}%.',
          },
        },
        {
          p: "Ogni albero, pezzo e ciclo conta anche per l'abilità generale della professione, per esempio Agricoltura. Una nuova professione si sblocca con quell'abilità generale o con l'abilità di un singolo bene: Agricoltura sblocca il [[job:miller|mugnaio]], Estrazione - Legno il [[job:joiner|carpentiere]]. I requisiti sono in [[article:trades|Professioni e scuola]]. Per un bene senza un'abilità propria conta l'abilità generale. L'esperienza resta anche dopo un cambio di professione.",
        },
        {
          h: 'Esperienza che non velocizza il lavoro',
        },
        {
          list: [
            'I [[job:carrier|trasportatori]] accumulano Trasporto. Non velocizza il loro lavoro, ma {{exp.carrierTrader}} consegne sbloccano il [[job:trader|mercante]].',
            'I mercanti accumulano Commercio per ogni pezzo scaricato, ma il Commercio non cambia nulla.',
            'Gli [[job:scout|esploratori]], le [[job:woman|donne]] e i bambini non guadagnano esperienza.',
            'Piantare, annaffiare, la [[building:school|scuola]] e la [[building:barracks|caserma]] non danno esperienza.',
          ],
        },
      ],
      see: ['article:tools', 'article:trades', 'article:exp-combat', 'article:construction'],
    },
    {
      id: 'exp-combat',
      name: 'Esperienza di combattimento',
      lead: '{{combat.fightCapHits}} colpi a segno con un tipo di arma raddoppiano i tuoi danni in mischia.',
      blocks: [
        {
          h: 'Danni in mischia',
        },
        {
          table: {
            head: ['Colpi a segno', 'Moltiplicatore', 'Un colpo da {{combat.sampleBlow}} diventa'],
            rows: [
              [0, '×1', '{{combat.sampleBlow}}'],
              [10, '×{{fight.factor.10}}', '{{fight.blow.10}}'],
              [25, '×{{fight.factor.25}}', '{{fight.blow.25}}'],
              [50, '×{{fight.factor.50}}', '{{fight.blow.50}}'],
              [75, '×{{fight.factor.75}}', '{{fight.blow.75}}'],
              ['{{combat.fightCapHits}}', '×{{combat.fightCapFactor}}', '{{combat.fightCapBlow}}'],
            ],
            num: [0, 1, 2],
            foot: 'Oltre {{combat.fightCapHits}} colpi a segno il moltiplicatore smette di crescere.',
          },
        },
        {
          p: 'Il moltiplicatore vale per i colpi in mischia contro persone, animali ed edifici. Non vale contro [[article:walls|palizzate]] e [[article:vehicles|veicoli]], né per le frecce e la [[article:catapult|catapulta]].',
        },
        {
          p: 'Senza esperienza, archi e catapulte vanno a segno con il {{aim.basePct}}% dei tiri, e da {{aim.noSpreadHits}} colpi a segno ogni tiro va a bersaglio. Dettagli: [[article:aim|Colpire e tirare]].',
        },
        {
          h: 'Cosa conta come colpo a segno',
        },
        {
          p: "Un colpo a segno è un colpo o un tiro che ha fatto danni. Si conta separatamente per ogni tipo di arma: pugni, lancia, spada, arco, catapulta. Anche i tiri del [[job:hunter|cacciatore]] contano per l'arco.",
        },
        {
          p: 'Nel pannello del colono sono le righe Combattimento - Spada, Combattimento - Arco e così via. I colpi di spada non aiutano un lanciere e restano anche dopo un cambio di professione. Il combattimento non aumenta i danni di un eroe, a meno che la missione non lo attivi.',
        },
        {
          p: "Le armi migliori si sbloccano fabbricandole, non combattendo. La scheda dell'arma indica il requisito, per esempio [[good:sword_long|spada lunga]]. Chi porta quale arma: [[article:equip|Equipaggiare i soldati]].",
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
      name: 'Professioni e scuola',
      lead: "Una professione scoperta resta a disposizione di tutto l'insediamento, anche se il colono che l'ha scoperta muore.",
      blocks: [
        {
          p: "L'impostazione della lobby «Sviluppo delle professioni: Tutte sbloccate dall'inizio» toglie i requisiti per le professioni civili e i prodotti. I requisiti delle professioni militari e i divieti della mappa restano.",
        },
        {
          h: 'Cosa sblocca una professione',
        },
        {
          data: 'jobs',
        },
        {
          p: "Un requisito con due abilità conta la loro somma. [[job:builder|Costruttore]], estrattore, [[job:farmer|contadino]], [[job:hunter|cacciatore]], [[job:fisher|pescatore]], [[job:carrier|trasportatore]] ed [[job:scout|esploratore]] sono disponibili dall'inizio.",
        },
        {
          p: 'I prodotti si scoprono allo stesso modo, per esempio il [[good:furniture|mobilio]] richiede Falegnameria: {{exp.furnitureNeed}} volte.',
        },
        {
          p: 'Un colono che soddisfa il requisito può prendere subito la professione. Tutti gli altri devono seguire un corso alla [[building:school|scuola]] o raggiungere lo stesso requisito lavorando.',
        },
        {
          h: 'Scuola e caserma',
        },
        {
          table: {
            head: ['Caratteristica', 'Scuola', 'Caserma'],
            rows: [
              ['Posti', '{{school.seats}}', '{{barracks.seats}}'],
              ['Insegna', 'una professione civile o un prodotto', 'la professione di soldato'],
              ['Tempo', 'vedi la tabella più sotto', '{{barracks.drillSeconds}} s'],
              ['Chi', 'uomo adulto', 'uomo adulto'],
              [
                'Dopo il corso',
                'nuova professione, aspetta alla scuola un posto di lavoro',
                'soldato disarmato, la vecchia professione resta nota',
              ],
            ],
            foot: 'Quando i posti sono pieni, gli allievi successivi aspettano alla porta.',
          },
        },
        {
          list: [
            'Un allievo che esce per mangiare o dormire conserva i progressi. Se lo ritiri dal corso, li perde.',
            'Un allievo mandato a una scuola in costruzione porta i materiali e aspetta che sia finita.',
            'Un corso finito è permanente, anche dopo un cambio di professione.',
          ],
        },
        {
          h: 'Durata dei corsi',
        },
        {
          table: {
            head: ['Corsi', 'Tempo'],
            rows: [
              [
                '[[good:armor_leather|Armatura di cuoio]], [[good:potion_food_small|pozione nutriente piccola]], [[good:potion_stamina_small|pozione di resistenza piccola]]',
                '{{course.shortSeconds}} s',
              ],
              ['professioni e la maggior parte dei prodotti', '{{course.commonSeconds}} s'],
              ['[[good:potion_heal_big|Pozione di guarigione grande]]', '{{course.healSeconds}} s'],
              ['[[good:handcart|Carretto a mano]]', '{{course.handcartSeconds}} s'],
              ['[[good:oxcart|Carro di buoi]]', '{{course.oxcartSeconds}} s'],
              [
                '[[good:ship_small|Nave]], [[good:ship_big|grande nave]], [[good:catapult|catapulta]]',
                '{{course.shipSeconds}} s',
              ],
            ],
            num: [1],
          },
        },
        {
          h: 'Professione e luogo di lavoro',
        },
        {
          p: "Dopo «Cambia professione» un colono perde il suo luogo di lavoro e non ne trova uno nuovo da solo. Fanno eccezione i diplomati, se attivi la loro opzione nell'[[article:assistant|Assistente]].",
        },
        {
          table: {
            head: ['Professione', 'Edificio', 'Senza edificio'],
            rows: [
              ['[[job:builder|Costruttore]]', 'non serve', 'Va da solo nei cantieri.'],
              ['[[job:scout|Esploratore]]', 'non serve', 'Esegue gli ordini.'],
              [
                '[[job:trader|Mercante]]',
                'non serve',
                'Segue il suo [[article:trade|percorso commerciale]].',
              ],
              ['[[job:civilist|Civile]]', 'non serve', 'Non lavora, aspetta un posto di lavoro.'],
              [
                '[[job:collector|Estrattore]], [[job:hunter|cacciatore]], [[job:fisher|pescatore]]',
                'facoltativo',
                'Lavora da una [[article:work-flag|bandierina di lavoro]] piantata ai suoi piedi quando prende la professione.',
              ],
              [
                '[[job:farmer|Contadino]], [[job:herb_mush_guy|erborista]]',
                'necessario',
                'Non coltiva nessun campo.',
              ],
              ['[[job:carrier|Trasportatore]]', 'necessario', 'Non trasporta niente.'],
              ['Altre professioni civili', 'necessario', 'Resta inattivo.'],
            ],
          },
        },
        {
          list: [
            'Clicca con il tasto destro su un edificio («Lavora qui») per cambiare professione e ottenere subito il luogo di lavoro.',
            "Un colono che non soddisfa il requisito per quella professione prende un posto libero da trasportatore nell'edificio, se ce n'è uno.",
            'Un soldato prende solo un posto della sua professione.',
            "«Rimuovi dal lavoro» e la demolizione dell'edificio non tolgono la professione.",
            'Donne, bambini ed eroi non ricevono mai una professione.',
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
