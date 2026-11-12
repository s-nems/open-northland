import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const MILITARY: ArticleGroup = {
  group: 'Esercito',
  items: [
    {
      id: 'damage',
      name: 'Calcolatore dei danni',
      lead: 'Una persona ha {{health.human}} punti di salute. La tabella mostra quanti ne toglie un colpo.',
      blocks: [
        {
          data: 'matrix',
        },
        {
          figure: {
            id: 'direction',
            caption: 'Direzione del colpo',
          },
        },
        {
          h: 'Cosa cambia il danno',
        },
        {
          table: {
            head: ['Moltiplicatore', 'Valore'],
            rows: [
              [
                "[[article:exp-combat|Esperienza di combattimento]] dell'attaccante (solo in mischia)",
                'fino a ×{{combat.fightCapFactor}}',
              ],
              [
                '[[article:exp-combat|Esperienza di combattimento]] del bersaglio',
                'fino a ×{{combat.fightTakenFactor}}',
              ],
              ['Colpo sul fianco posteriore', '×{{combat.backSideFactor}}'],
              ['Colpo alle spalle', '×{{combat.behindFactor}}'],
            ],
            foot: 'Un colpo frontale o sul fianco anteriore non cambia il danno. Amuleti della forza, della precisione e della difesa: [[article:draughts|Pozioni e amuleti]].',
          },
        },
        {
          list: [
            "L'esperienza dell'attaccante non rafforza frecce, pietre né colpi contro veicoli e palizzate. L'esperienza del bersaglio riduce ogni colpo e tiro su una persona.",
            "La direzione del colpo e l'Amuleto della difesa contano solo contro le persone. Per una freccia la direzione si calcola dal punto da cui è stata scoccata.",
            "Una catapulta non può ricevere l'Amuleto della forza.",
            'Una palizzata calcola il danno a modo suo: [[article:walls|Palizzate e cancelli]].',
            'I bambini non possono essere feriti.',
          ],
        },
        {
          h: 'Differenze tra le tribù',
        },
        {
          p: 'La tabella considera le armi della tribù di cui scegli lo stemma in cima alla finestra. Il dragone che la riga [[good:spear_wooden|Lancia di legno]] mostra per i Bizantini ha {{dragon.hitpoints}} punti di salute.',
        },
        {
          h: 'Armature',
        },
        {
          data: 'armour',
        },
        {
          p: 'Armi e armature pesanti rallentano il passo: [[article:walking|Velocità di cammino]].',
        },
      ],
      see: [
        'article:exp-combat',
        'article:aim',
        'article:walking',
        'good:spear_iron',
        'good:sword_long',
        'good:armor_chain',
        'good:armor_plate',
      ],
    },
    {
      id: 'equip',
      name: 'Equipaggiare i soldati',
      lead: "Puoi armare il tuo esercito con i contatori della finestra dell'Assistente. L'equipaggiamento di un singolo colono si cambia nel suo pannello.",
      blocks: [
        {
          p: "I contatori dell'esercito e la chiamata alla caserma sono spiegati in [[article:assistant|Assistente]].",
        },
        {
          h: 'Strisce di armi e armature',
        },
        {
          p: "Ogni tipo di soldato ha le sue strisce. Un soldato prende il primo oggetto da sinistra presente in un magazzino e salta quelli barrati. All'inizio gli oggetti più forti stanno a sinistra. Fai clic su un oggetto per barrarlo, trascinalo per cambiare l'ordine.",
        },
        {
          list: [
            "Se non c'è nessun'arma, aspetta e la finestra mostra «in attesa di un'arma».",
            "Se non c'è nessuna armatura, ne fa a meno e la indossa più tardi solo quando glielo ordini.",
          ],
        },
        {
          h: "Una recluta dopo l'addestramento",
        },
        {
          table: {
            head: ['La caserma ha', 'La recluta'],
            rows: [
              ['Arma e armatura', 'Esce completamente equipaggiata'],
              [
                "Solo l'arma o solo l'armatura",
                "Prende ciò che c'è e va a prendere il resto in un magazzino",
              ],
              ['Niente', "Va a prendere un'arma, poi l'armatura"],
            ],
            foot: 'Se un oggetto migliore della striscia si trova in un magazzino raggiungibile, la recluta va a prenderlo invece di prendere quello peggiore dalla caserma.',
          },
        },
        {
          h: 'Cosa tiene la caserma',
        },
        {
          table: {
            head: ['Merce', 'Quantità'],
            rows: [
              [
                'Ogni arma e armatura, [[good:shoes|Scarpe]], [[good:mead|Idromele]], ogni pozione e amuleto',
                '{{barracks.gearStock}}',
              ],
              ['Cibo', '{{barracks.foodStock}}'],
              ['[[good:coin|Moneta]]', '{{barracks.coinStock}}'],
            ],
            num: [1],
            foot: 'I trasportatori della caserma vanno a prendere da soli nei magazzini i beni a cui dai la priorità: [[article:hauling|Trasportatori e magazzini]].',
          },
        },
        {
          h: 'Cambiare a mano',
        },
        {
          table: {
            head: ['Chi', 'Può cambiare'],
            rows: [
              ['Soldato', 'Arma, armatura, scarpe, equipaggiamento'],
              ['Uomo con una professione', 'Attrezzi, scarpe, equipaggiamento'],
              ['Eroe', 'Solo la borsa: [[article:heroes|Eroi]]'],
              ['Donna, bambino', 'Niente'],
            ],
          },
        },
        {
          list: [
            'Una nuova arma cambia subito il tipo di soldato. Senza arma diventa un semplice [[job:soldier_unarmed|Soldato]].',
            'Quando vengono sostituiti o tolti, le scarpe consumate, gli attrezzi usati e le bottiglie aperte vanno persi. Quelli intatti tornano in magazzino.',
            'Armi, armature e amuleti non si consumano e tornano sempre in magazzino.',
          ],
        },
        {
          h: "Chi può portare un'arma migliore",
        },
        {
          p: "Qualsiasi soldato prende qualsiasi arma da un magazzino, a prescindere dalla sua esperienza. Il limite sta nel fabbricarla: solo un [[job:smith|Fabbro]] esperto fa la [[good:spear_iron|Lancia di ferro]] e la [[good:sword_long|Spada lunga]], e solo un [[job:armorer|Armaiolo]] esperto l'[[good:bow_long|Arco lungo]]. La scheda di ciascuna di queste armi indica quanta esperienza serve.",
        },
      ],
      see: [
        'article:damage',
        'article:assistant',
        'article:exp-combat',
        'article:hauling',
        'building:barracks',
      ],
    },
    {
      id: 'aim',
      name: 'Colpire e tirare',
      lead: "Un colpo in mischia va a vuoto solo se il bersaglio è già uscito dalla portata dell'arma. Più un arciere ha colpito, più è preciso.",
      blocks: [
        {
          h: 'Armi a distanza',
        },
        {
          table: {
            head: ['Arma', 'Gittata normale', 'Gittata dalla torre', 'Si ferma per tirare a'],
            rows: [
              [
                '[[good:bow_short|Arco corto]]',
                '{{shortBow.min}}-{{shortBow.max}}',
                '0-{{shortBow.towerMax}}',
                '{{shortBow.min}}-{{shortBow.standoff}}',
              ],
              [
                '[[good:bow_long|Arco lungo]]',
                '{{longBow.min}}-{{longBow.max}}',
                '0-{{longBow.towerMax}}',
                '{{longBow.min}}-{{longBow.standoff}}',
              ],
              [
                '[[job:heroine_bow_xena|Cyra]]',
                '{{heroBow.min}}-{{heroBow.max}}',
                '-',
                '{{heroBow.min}}-{{heroBow.standoff}}',
              ],
            ],
            num: [1, 2, 3],
            foot: "Gittata in esagoni. Un arciere che si avvicina a un bersaglio si ferma un po' più vicino di quanto potrebbe, così il bersaglio non esce di portata. Non tira a un bersaglio più vicino del limite inferiore della sua gittata, a meno che non stia su una torre. La cadenza di tiro, anche per l'arco del cacciatore e la catapulta, è nella tabella di [[article:damage|Calcolatore dei danni]].",
          },
        },
        {
          h: 'Precisione',
        },
        {
          table: {
            head: ['Punti', 'Probabilità di un tiro preciso'],
            rows: [
              ['0', '{{aim.basePct}}%'],
              ['50', '{{aim.samplePct}}%'],
              ['{{aim.noSpreadPoints}}+', 'Sempre a segno'],
            ],
            num: [0, 1],
            foot: "Ogni punto di [[article:exp-combat|esperienza di combattimento]] aggiunge l'1%, anche i punti dell'esercitazione e quelli presi con un'altra arma. Da {{aim.noSpreadPoints}} punti anche una freccia imprecisa arriva sul bersaglio. La [[article:catapult|Catapulta]] conta i propri colpi a parte, ma sulla stessa tabella. Un eroe colpisce sempre.",
          },
        },
        {
          h: 'Dispersione di una freccia vagante',
        },
        {
          list: [
            'Una freccia vagante cade vicino al bersaglio: fino a {{aim.spreadShort}} esagoni con un [[good:bow_short|Arco corto]], fino a {{aim.spreadLong}} con un [[good:bow_long|Arco lungo]], fino a {{aim.spreadTower}} con un arco lungo da una torre. La dispersione cresce con la distanza.',
            'Una freccia vagante può ferire un altro nemico dove cade.',
            'Le frecce non feriscono la tua gente, gli alleati e i neutrali.',
            'Un arciere anticipa un nemico in movimento, mentre un edificio tira dove si trova il nemico al momento del tiro.',
          ],
        },
        {
          h: 'Postazione sulla torre',
        },
        {
          list: ['Un arciere in postazione non può essere colpito. Un nemico può tirare solo alla torre.'],
        },
      ],
      see: ['article:exp-combat', 'article:defence', 'building:tower_00', 'building:tower_01'],
    },
    {
      id: 'stances',
      name: 'Atteggiamenti',
      lead: "L'atteggiamento stabilisce se un soldato cerca i nemici da solo e fin dove li insegue. I nuovi soldati e gli eroi sono in Difesa.",
      blocks: [
        {
          figure: {
            id: 'leash',
            caption: 'Fin dove insegue',
          },
        },
        {
          p: 'In Indifferente un soldato lascia andare un bersaglio appena si allontana più di {{stance.ignoreLeash}} esagoni dalla sua posizione.',
        },
        {
          table: {
            head: ['Atteggiamento', 'Cerca nemici', 'Raggio', 'Rinuncia quando', 'Se viene colpito'],
            rows: [
              [
                'Attacco',
                'Intorno a sé',
                '{{stance.search}}',
                'Il bersaglio muore o è irraggiungibile',
                "Attacca l'aggressore",
              ],
              [
                'Difesa',
                'Intorno alla sua posizione',
                '{{stance.search}}',
                'Il bersaglio si allontana più di {{stance.defendLeash}} dalla posizione',
                "Attacca l'aggressore",
              ],
              [
                'Indifferente',
                "Solo nella portata dell'arma, non si avvicina",
                "Portata dell'arma",
                'Il bersaglio si allontana più di {{stance.ignoreLeash}} dalla posizione',
                'Resta fermo',
              ],
            ],
            foot: 'Distanze in esagoni. La posizione è il punto in cui il soldato si trovava quando hai cambiato il suo atteggiamento. Un ordine di movimento o di attacco la reimposta.',
          },
        },
        {
          list: [
            'Un soldato in Attacco torna alla sua posizione se il combattimento finisce a più di {{stance.attackReturn}} esagoni da essa.',
            'Un soldato individua i nemici anche nella [[article:fog|nebbia]].',
            "Un ordine d'attacco funziona con ogni atteggiamento.",
            'Con ogni atteggiamento un arciere in postazione tira a tutto ciò che è a portata.',
            "Dopo un semplice ordine di movimento un soldato prosegue, anche se qualcuno lo colpisce. Dopo «Attacca lungo la strada» si gira per combattere l'aggressore.",
          ],
        },
        {
          h: 'Chi attacca per primo',
        },
        {
          p: 'Un soldato colpisce prima chi può rispondere: soldati, eroi, catapulte, torri ed edifici che tirano. Civili, altri edifici e veicoli disarmati vengono dopo.',
        },
        {
          p: 'Un soldato non attacca mai di sua iniziativa una palizzata o un muro difensivo: [[article:walls|Palizzate e cancelli]].',
        },
        {
          h: 'Chi reagisce a un colpo',
        },
        {
          table: {
            head: ['Chi', 'Distanza dal ferito', 'Cosa fanno'],
            rows: [
              ['Soldati ed eroi in Attacco o Difesa', '{{stance.soldierAlarm}}', "Attaccano l'aggressore"],
              ['Soldati ed eroi in Indifferente', '-', "Colpiscono solo ciò che è a portata d'arma"],
              [
                'Civili ed esploratori',
                '{{stance.peopleAlarm}}',
                'Fuggono di {{stance.fleeMin}}-{{stance.fleeMax}} esagoni e tornano al lavoro',
              ],
            ],
            num: [1],
            foot: "Distanza in esagoni. Solo un colpo a una persona dà l'allarme, non uno a un edificio o a un animale.",
          },
        },
        {
          h: 'Civili',
        },
        {
          list: [
            'Un civile non combatte. Gli atteggiamenti si impostano solo per soldati ed eroi.',
            'Un civile non fugge alla sola vista di un nemico.',
            'Quando fugge, un civile lascia cadere ciò che porta e un trasportatore abbandona il carretto a mano.',
          ],
        },
        {
          h: "L'interruttore «Mangiare e dormire»",
        },
        {
          p: 'Con «Vietato» un soldato non va da solo a mangiare, dormire o pregare. Non mangia nemmeno ciò che porta né dalle scorte della torre, non si ferma a bere idromele, e la fame non interrompe un ordine lungo. Senza pozioni alla fine morirà di fame. Aiutano un ordine Mangia o il ritorno a «Consentito».',
        },
        {
          p: 'Pozioni, amuleti e gli ordini Mangia, Dormi e Prega funzionano con entrambe le impostazioni. Nel menu degli ordini le impostazioni si chiamano «Consenti rigenerazione» e «Vieta rigenerazione».',
        },
        {
          h: 'Riposare vicino a uno scontro',
        },
        {
          table: {
            head: ["Cosa c'è vicino", 'Esagoni', 'Il soldato'],
            rows: [
              ['Combattimento', 'fino a {{alert.restClearance}}', 'Non dorme, non prega e non conversa'],
              [
                'Soldato nemico in Attacco o Difesa, visibile sulla mappa',
                'fino a {{alert.standTo}}',
                'Lo stesso',
              ],
            ],
            foot: "Va a mangiare solo quando l'energia scende al {{need.criticalPct}}%. In Indifferente un soldato riposa come al solito.",
          },
        },
      ],
      see: ['article:defence', 'article:aim', 'article:fog', 'article:needs'],
    },
    {
      id: 'heroes',
      name: 'Eroi',
      lead: 'Un eroe arriva con la mappa. Non puoi addestrarlo né cambiargli professione.',
      blocks: [
        {
          table: {
            head: ['Caratteristica', 'Soldato', 'Eroe'],
            rows: [
              ['Raggio visivo in esagoni', '{{vision.soldier}}', '{{vision.hero}}'],
              ["Precisione con l'arco", "Cresce con l'esperienza di combattimento", 'Sempre a segno'],
              ['Esperienza di combattimento', 'Cresce', 'Cresce solo se la missione lo consente'],
              ['Mangiare e dormire', 'Ne ha bisogno', 'Non ne ha bisogno'],
              [
                'Arma, armatura, scarpe',
                'Si cambiano, le scarpe si consumano',
                'Fisse, le scarpe non si consumano',
              ],
              ["Peso dell'equipaggiamento", 'Lo rallenta', 'Non lo rallenta'],
              ['Abitazione e luogo di lavoro', 'Può averli', 'Non li ha'],
              ['Cassa magica', 'Non la apre', 'La apre'],
            ],
          },
        },
        {
          h: 'Armi degli eroi',
        },
        {
          table: {
            head: ['Eroe', 'Arma', 'Armatura'],
            rows: [
              ['[[job:hero_spear_siegfried|Sigurd]]', 'Lancia', '[[good:armor_plate|Armatura di piastre]]'],
              ['[[job:hero_sword_bjarni|Bjarni]]', 'Spada', '[[good:armor_chain|Cotta di maglia]]'],
              ['[[job:hero_saber_hatschi|Hatchie]]', 'Sciabola', '[[good:armor_chain|Cotta di maglia]]'],
              ['[[job:heroine_bow_xena|Cyra]]', 'Arco', '[[good:armor_leather|Armatura di cuoio]]'],
            ],
            foot: "Gittata, cadenza dei colpi e danno sono nella tabella di [[article:damage|Calcolatore dei danni]] con gli eroi attivati. Gli eroi di un'altra tribù combattono in modo un po' diverso: scegli il suo stemma in cima alla finestra.",
          },
        },
        {
          h: 'Borsa',
        },
        {
          list: [
            'Un eroe mette nella borsa solo questi oggetti: [[good:amulet_strength|Amuleto della forza]], [[good:amulet_defense|Amuleto della difesa]], [[good:amulet_crithit|Amuleto della precisione]], [[good:amulet_speed|Amuleto del vento]], [[good:potion_heal_small|Pozione di guarigione piccola]], [[good:potion_heal_big|Pozione di guarigione grande]].',
          ],
        },
      ],
      see: ['article:damage', 'article:chests', 'article:fog', 'article:exp-combat'],
    },
    {
      id: 'defence',
      name: 'Torri e allarme',
      lead: 'Un edificio in allarme tira da solo sui nemici. Ogni persona nascosta dentro aggiunge {{shelter.shotsPerSeat}} frecce al secondo.',
      blocks: [
        {
          h: 'Allarme',
        },
        {
          list: [
            '«Attiva la modalità difensiva» agisce su un edificio, «Tutta la città» su tutti gli edifici difensivi.',
            "L'allarme lo dai tu. Un attacco all'insediamento non lo fa scattare.",
            "L'allarme non si spegne da solo. Dura fino a «Disattiva la modalità difensiva» o finché l'edificio non viene distrutto.",
          ],
        },
        {
          h: 'Chi si nasconde',
        },
        {
          list: [
            "Civili, donne e bambini corrono all'edificio più vicino con un posto libero che possono raggiungere a piedi.",
            "Soldati, eroi e l'[[job:scout|Esploratore]] restano fuori.",
            'Chi non trova posto continua a lavorare.',
            "Con l'allarme un colono interrompe il pasto e il sonno. Dentro non lavora e mangia solo ciò che porta con sé.",
            'Chi è nascosto dentro non può essere attaccato.',
            "Quando l'edificio viene distrutto, chi vi è nascosto esce.",
          ],
        },
        {
          h: 'Edifici difensivi',
        },
        {
          table: {
            head: ['Edificio', 'Posti', 'Frecce al secondo'],
            rows: [
              ['[[building:headquarters|Quartier generale]]', '{{shelter.hq}}', '{{shelter.hqShots}}'],
              ['[[building:tower_01|Torre di difesa 2]]', '{{shelter.tower2}}', '{{shelter.tower2Shots}}'],
              ['[[building:tower_00|Torre di difesa 1]]', '{{shelter.tower1}}', '{{shelter.tower1Shots}}'],
              ['[[building:barracks|Caserma]]', '{{shelter.barracks}}', '{{shelter.barracksShots}}'],
            ],
            num: [1, 2],
            foot: "Frecce al secondo con l'edificio pieno. Le postazioni degli arcieri, indicate sulla scheda della torre, non occupano posti per nascondersi. Un arciere assegnato a una torre tira da solo, senza allarme: [[article:aim|Colpire e tirare]].",
          },
        },
        {
          h: 'Frecce da un edificio',
        },
        {
          p: 'Quanto toglie una freccia è nella riga «Frecce da un edificio» della tabella di [[article:damage|Calcolatore dei danni]].',
        },
        {
          list: [
            'Un edificio tira fino a {{shelter.range}} esagoni dal suo muro più vicino, anche a un nemico proprio sotto le mura.',
            'Un edificio tira anche ai nemici nella nebbia.',
            'Le frecce non costano nulla e non danno esperienza.',
            'Tira prima a soldati ed eroi e per ultimi ai civili.',
          ],
        },
        {
          h: 'Scorte della torre',
        },
        {
          table: {
            head: ['Torre', 'Idromele', 'Cibo', 'Per ogni arma'],
            rows: [
              [
                '[[building:tower_00|Torre di difesa 1]]',
                '{{tower1.mead}}',
                '{{tower1.food}}',
                '{{tower1.weapon}}',
              ],
              [
                '[[building:tower_01|Torre di difesa 2]]',
                '{{tower2.mead}}',
                '{{tower2.food}}',
                '{{tower2.weapon}}',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Le postazioni e i posti per i trasportatori sono sulla scheda della torre.',
          },
        },
        {
          h: 'Guarnigione della torre',
        },
        {
          list: [
            "Solo l'arciere giusto può occupare una postazione: [[job:soldier_bow_short|Arciere con arco corto]] o [[job:soldier_bow_long|Arciere con arco lungo]]. Lo assegni come a un luogo di lavoro.",
            "Un arciere che prende un'altra arma perde la postazione.",
            'La guarnigione mangia dalle scorte della torre e dorme alla postazione. Scende a cercare cibo solo quando le scorte finiscono.',
            "L'Assistente non toglie mai gli arcieri da una torre, nemmeno per l'equipaggiamento.",
            '«Fai uscire la guarnigione» fa uscire gli arcieri dalla torre e li seleziona, così puoi dare subito un ordine. Anche un ordine di movimento toglie un arciere dalla sua postazione.',
          ],
        },
      ],
      see: [
        'article:aim',
        'article:stances',
        'building:tower_00',
        'building:tower_01',
        'building:headquarters',
        'building:barracks',
        'article:equip',
      ],
    },
    {
      id: 'walls',
      name: 'Palizzate e cancelli',
      lead: 'Una palizzata perde 1 punto di salute per ogni {{wall.damagePerPoint}} danni interi della colonna Edificio. Un colpo più debole non le fa nulla.',
      blocks: [
        {
          table: {
            head: ['Parte', 'Salute', 'Riparazione per colpo', 'Costo'],
            rows: [
              [
                'Segmento di palizzata',
                '{{wall.segmentHp}}',
                '{{wall.segmentRepair}}',
                '1 [[good:wood|Legno]]',
              ],
              ['Cancello', '{{wall.gateHp}}', '{{wall.gateRepair}}', 'Gratis, ricavato dai segmenti'],
            ],
            num: [1, 2],
            foot: 'Le riparazioni non costano nulla. Un segmento viene riparato da un solo costruttore alla volta.',
          },
        },
        {
          h: 'Costruire un cancello',
        },
        {
          list: [
            'Un cancello richiede {{wall.gateSegments}} tuoi segmenti finiti in linea retta. Ognuno deve avere almeno il {{wall.gateMinHealthPct}}% di salute e stare su terreno piano, e nessuno deve trovarsi nel passaggio.',
            'Il cancello compare subito, chiuso e con la salute piena, anche se i segmenti erano danneggiati.',
          ],
        },
        {
          h: 'Modalità del cancello',
        },
        {
          table: {
            head: ['Modalità', 'Effetto'],
            rows: [
              ['Aperto', 'Passano tutti, anche i nemici'],
              ['Chiuso', 'Non passa nessuno, nemmeno la tua gente'],
              [
                'Automatico',
                'Aperto. Si chiude quando un nemico arriva entro {{wall.gateEnemyNear}} esagoni e si riapre quando se ne va',
              ],
            ],
            foot: 'Qualsiasi persona o veicolo di un giocatore con cui sei in guerra chiude il cancello, anche i civili. Gli animali no.',
          },
        },
        {
          list: ['Un cancello si chiude solo quando nessuno si trova nel passaggio.'],
        },
        {
          h: 'Quanto resiste una palizzata',
        },
        {
          table: {
            head: [
              'Arma',
              'Salute per colpo',
              'Con Amuleto della forza',
              'Colpi per segmento',
              'Colpi per cancello',
              'Tempo per segmento',
            ],
            rows: [
              [
                '[[building:catapult|Catapulta]]',
                '{{wall.catapult.blow}}',
                '-',
                '{{wall.catapult.segmentHits}}',
                '{{wall.catapult.gateHits}}',
                '{{wall.catapult.segmentSeconds}}',
              ],
              [
                'Eroe, in mischia',
                '{{wall.hero.blow}}',
                '{{wall.hero.strongBlow}}',
                '{{wall.hero.segmentHits}}',
                '{{wall.hero.gateHits}}',
                '{{wall.hero.segmentSeconds}}',
              ],
              [
                '[[good:spear_iron|Lancia di ferro]]',
                '{{wall.ironSpear.blow}}',
                '{{wall.ironSpear.strongBlow}}',
                '{{wall.ironSpear.segmentHits}}',
                '{{wall.ironSpear.gateHits}}',
                '{{wall.ironSpear.segmentSeconds}}',
              ],
              [
                '[[good:sword_long|Spada lunga]]',
                '{{wall.longSword.blow}}',
                '{{wall.longSword.strongBlow}}',
                '{{wall.longSword.segmentHits}}',
                '{{wall.longSword.gateHits}}',
                '{{wall.longSword.segmentSeconds}}',
              ],
              [
                '[[good:sword_shord|Spada corta]]',
                '{{wall.shortSword.blow}}',
                '{{wall.shortSword.strongBlow}}',
                '{{wall.shortSword.segmentHits}}',
                '{{wall.shortSword.gateHits}}',
                '{{wall.shortSword.segmentSeconds}}',
              ],
              [
                '[[good:spear_wooden|Lancia di legno]]',
                '{{wall.woodenSpear.blow}}',
                '{{wall.woodenSpear.strongBlow}}',
                '{{wall.woodenSpear.segmentHits}}',
                '{{wall.woodenSpear.gateHits}}',
                '{{wall.woodenSpear.segmentSeconds}}',
              ],
              [
                '[[good:bow_short|Arco corto]]',
                '{{wall.shortBow.blow}}',
                '{{wall.shortBow.strongBlow}}',
                '{{wall.shortBow.segmentHits}}',
                '{{wall.shortBow.gateHits}}',
                '{{wall.shortBow.segmentSeconds}}',
              ],
              [
                '[[good:bow_long|Arco lungo]]',
                '{{wall.longBow.blow}}',
                '{{wall.longBow.strongBlow}}',
                '{{wall.longBow.segmentHits}}',
                '{{wall.longBow.gateHits}}',
                '{{wall.longBow.segmentSeconds}}',
              ],
              ['Pugni, frecce da un edificio', '0', '0', '-', '-', '-'],
            ],
            num: [1, 2, 3, 4, 5],
            foot: "Tempo per un soldato. Una catapulta non può ricevere l'Amuleto della forza. Cyra toglie {{wall.heroBow.blow}} punti di salute alla palizzata per tiro, la Cyra dei Franchi {{wall.frankHeroBow.blow}}.",
          },
        },
        {
          list: [
            "L'esperienza di combattimento non rafforza i colpi contro una palizzata.",
            'Un soldato non attacca una palizzata di sua iniziativa. La colpisce su ordine o quando gli sbarra la strada verso un nemico.',
            'Appena cade un segmento, i soldati passano dalla breccia e lasciano in piedi quelli vicini.',
          ],
        },
        {
          h: 'Muro difensivo',
        },
        {
          p: 'Il [[building:defence_wall|Muro difensivo]] è un edificio normale e subisce i danni della colonna Edificio. Un soldato lo tratta come una palizzata.',
        },
      ],
      see: [
        'article:damage',
        'article:catapult',
        'article:construction',
        'building:defence_wall',
        'good:wood',
      ],
    },
    {
      id: 'catapult',
      name: 'Catapulte',
      lead: "Una pietra ferisce tutto ciò che si trova sull'esagono dove cade e sui sei esagoni intorno, compresa la tua gente.",
      blocks: [
        {
          figure: {
            id: 'catapult-splash',
            caption: 'Dove cade la pietra',
          },
        },
        {
          p: 'Una catapulta è guidata da 1 soldato o eroe, con qualsiasi arma. Senza comandante non si muove e non tira. Le pietre non costano nulla. Salute, gittata, cadenza di tiro e costo sono sulla scheda della [[building:catapult|Catapulta]].',
        },
        {
          h: 'Pietra',
        },
        {
          p: 'Quanto toglie una pietra a persone, veicoli ed edifici è nella riga Catapulta della tabella di [[article:damage|Calcolatore dei danni]]. Una palizzata lo calcola in modo diverso: [[article:walls|Palizzate e cancelli]].',
        },
        {
          table: {
            head: ['Edificio', 'Salute', 'Pietre per distruggerlo', 'Tempo con 1 catapulta'],
            rows: [
              [
                '[[building:tower_00|Torre di difesa 1]]',
                '{{hp.tower1}}',
                '{{stone.tower1}}',
                '{{stone.tower1Seconds}}',
              ],
              [
                '[[building:tower_01|Torre di difesa 2]]',
                '{{hp.tower2}}',
                '{{stone.tower2}}',
                '{{stone.tower2Seconds}}',
              ],
              [
                '[[building:headquarters|Quartier generale]], vichingo',
                '{{hp.hq}}',
                '{{stone.hq}}',
                '{{stone.hqSeconds}}',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Quartier generale dei Franchi: {{hp.frankHq}} punti di salute, {{stone.frankHq}} pietre, {{stone.frankHqSeconds}}.',
          },
        },
        {
          h: 'Chi viene colpito',
        },
        {
          table: {
            head: ['Sotto la pietra', 'Pietra'],
            rows: [
              ['Nemico', 'Ferito'],
              ['La tua gente, i tuoi veicoli, edifici e palizzate', 'Feriti'],
              ['Neutrali e alleati', "Feriti, l'atteggiamento non cambia"],
              ['Un giocatore in pace per impostazione della lobby', 'Risparmiato'],
              ['Bambini', 'Risparmiati'],
              ['Persone dentro gli edifici', 'Risparmiate'],
              ['Alberi', 'Abbattuti'],
            ],
          },
        },
        {
          h: 'Precisione',
        },
        {
          p: 'La precisione cresce come per un arciere: [[article:aim|Colpire e tirare]]. A {{catapult.max}} esagoni una pietra imprecisa cade fino a {{stone.spread.0}} esagoni dal bersaglio con 0 colpi a segno, {{stone.spread.25}} con 25, {{stone.spread.50}} con 50. Da {{aim.noSpreadPoints}} colpi cade sul bersaglio. I colpi a segno li accumula il comandante: conta ogni pietra che ha danneggiato qualcosa, anche un edificio, ma una volta sola, anche se ha colpito più bersagli.',
        },
        {
          h: 'Atteggiamenti della catapulta',
        },
        {
          table: {
            head: ['Atteggiamento', 'Cerca nemici', 'Raggio', 'Si muove'],
            rows: [
              ['Attacco', 'Intorno a sé', '{{catapult.searchRadius}}', 'Sì'],
              [
                'Difesa',
                'Intorno alla sua posizione',
                '{{catapult.searchRadius}}',
                'Sì, fino a {{catapult.leash}} esagoni dalla sua posizione',
              ],
              ['Indifferente', 'Intorno alla sua posizione', '{{catapult.min}}-{{catapult.max}}', 'No'],
            ],
            foot: "Una nuova catapulta parte in Indifferente. Da sola attacca solo i bersagli che vede. Un ordine d'attacco funziona con ogni atteggiamento.",
          },
        },
        {
          list: [
            'Nella sua portata di {{catapult.min}}-{{catapult.max}} esagoni tira prima alle torri, al quartier generale, alla caserma, alle case da cui si tira e alle catapulte nemiche, poi agli arcieri e agli altri soldati che tirano, poi agli altri soldati, e solo dopo alle altre case e alle persone.',
            "Fuori da Indifferente, quando a portata non c'è nessun bersaglio dei primi due gruppi, uno di questi fino a {{catapult.priorityReach}} esagoni di distanza la attira più vicino: una torre, il quartier generale, la caserma, una casa da cui si tira, una catapulta nemica, oppure arcieri e altri soldati che tirano. Avanza anche quando altri soldati sono a portata o i nemici le si affollano accanto.",
            'Senza nulla a portata arretra da un nemico isolato più vicino di {{catapult.min}} esagoni, ma resta ferma quando due o più sono così vicini. Se il bersaglio è più lontano di {{catapult.max}}, avanza fino a {{catapult.bandMin}}-{{catapult.max}} esagoni.',
            'Tira solo da ferma. Tra le catapulte che si toccano ne tira una sola: quella che da lì sta già tirando. Le altre si spostano in un punto libero, oppure aspettano dove sono quando non ce ne sono.',
            'Puoi ordinarle di tirare su un punto qualsiasi del terreno. Tira a una palizzata solo su ordine.',
          ],
        },
        {
          h: 'Cosa distrugge una catapulta',
        },
        {
          table: {
            head: ['Arma', 'Danno', 'Colpi per distruggerla'],
            rows: [
              ['Una seconda catapulta', '{{stone.vehicle}}', '{{stone.vehicleKills}}'],
              [
                'Lance, [[good:sword_long|Spada lunga]], [[good:bow_long|Arco lungo]]',
                '{{vs.catapult.spear}}',
                '{{vs.catapult.spearHits}}',
              ],
              [
                '[[good:sword_shord|Spada corta]], [[good:bow_short|Arco corto]]',
                '{{vs.catapult.shortSword}}',
                '{{vs.catapult.shortSwordHits}}',
              ],
              ['Pugni', '{{vs.catapult.fist}}', '{{vs.catapult.fistHits}}'],
              ['Freccia da un edificio', '{{arrow.vehicle}}', '{{vs.catapult.arrowHits}}'],
            ],
            num: [1, 2],
            foot: "L'esperienza non vale contro i veicoli. Gli amuleti di chi attacca sì.",
          },
        },
      ],
      see: ['article:vehicles', 'article:walls', 'article:aim', 'article:exp-combat', 'building:catapult'],
    },
  ],
};
