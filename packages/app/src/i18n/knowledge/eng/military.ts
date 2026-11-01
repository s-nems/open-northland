import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const MILITARY: ArticleGroup = {
  group: 'Military',
  items: [
    {
      id: 'damage',
      name: 'Weapons, Armour and Damage',
      lead: 'A person has {{health.human}} health. A blow deals the table value, changed by the multipliers below.',
      blocks: [
        {
          data: 'matrix',
        },
        {
          figure: {
            id: 'direction',
            caption: 'Direction of the blow',
          },
        },
        {
          h: 'What changes a blow',
        },
        {
          table: {
            head: ['Multiplier', 'Value'],
            rows: [
              [
                '[[article:exp-combat|Experience with this weapon]] (melee only)',
                'up to ×{{combat.fightCapFactor}}',
              ],
              ['Blow from the rear flank', '×{{combat.backSideFactor}}'],
              ['Blow from behind', '×{{combat.behindFactor}}'],
              ["Attacker's [[good:amulet_strength|Amulet of Strength]]", '×{{amulet.strengthFactor}}'],
              [
                "Attacker's [[good:amulet_crithit|Amulet of Precision]]",
                '{{amulet.critChancePct}}% chance of ×{{amulet.critFactor}}',
              ],
              ["Target's [[good:amulet_defense|Amulet of Defence]]", '×{{amulet.defenseFactor}}'],
            ],
            foot: "They apply in this order. Front and front flank give ×1. Hits don't raise arrows or catapult stones, and their direction counts from where the shot was fired. Direction and the Amulet of Defence work only on people. Hits don't count against vehicles and stockades. A Catapult stone gets none of the commander's amulets. Stockades count damage their own way: [[article:walls|Stockades and Gates]].",
          },
        },
        {
          list: [
            "A result of 0 or less doesn't wound and gives no experience.",
            "Children can't be hurt.",
            'Weapons and armour never wear out.',
            'Only adult men carry weapons and armour.',
          ],
        },
        {
          h: 'Tribe differences',
        },
        {
          list: [
            'Saracen: [[good:bow_short|Short Bow]] deals {{saracen.bowOnWool}} to a Tunic instead of {{viking.bowOnWool}}, {{saracen.bowOnChain}} to Chain Mail and Plate instead of {{viking.bowOnChain}}.',
            'Byzantine: the [[good:spear_wooden|Wooden Spear]] row shows the Dragon from the map: {{dragon.hitpoints}} health, range {{dragon.min}}-{{dragon.max}}, a run of {{dragon.blows}} blows every {{dragon.seconds}} s, {{dragon.bare}} against no armour. A trained Spearman fights as in the other tribes.',
            'All other soldier weapons are the same across the five tribes.',
          ],
        },
        {
          h: 'Armour',
        },
        {
          data: 'armour',
        },
        {
          p: 'Weapon and armour weight add up: [[article:walking|Walking Speed]].',
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
      name: 'Equipping Soldiers',
      lead: 'The class counters in the Assistant arm your army. Change a single man in his own panel.',
      blocks: [
        {
          h: 'Counters',
        },
        {
          table: {
            head: ['Counter', 'What it does', 'Counts down'],
            rows: [
              ['"Soldiers without weapons"', 'Trains at the Barracks, hands out no weapon', 'After drill'],
              [
                '"Sword fighters", "Spearmen", "Archers"',
                'Arms an unarmed soldier first, then trains a new one',
                'When the fighter takes a weapon',
              ],
            ],
            foot: 'Who gets sent to the Barracks: [[article:assistant|Assistant]].',
          },
        },
        {
          list: [
            "While an unarmed soldier is waiting, the counter drafts nobody in his place, even if there's no weapon yet.",
            'An unarmed soldier goes for a weapon when one of the class is in his reach and nobody else is waiting for it.',
            'Lowering the counter cancels those still waiting for a weapon.',
          ],
        },
        {
          h: 'A recruit after drill',
        },
        {
          table: {
            head: ['Barracks has', 'Recruit'],
            rows: [
              ['Weapon and armour', 'Walks out equipped'],
              ['Only one of the two', 'Takes it and goes for the other'],
              ['Nothing', 'Goes for a weapon, then armour'],
            ],
            foot: 'If a higher item on the strip lies in a store in reach, the recruit goes for it and leaves the worse one at the Barracks. After the trip he returns to the Barracks, as does a soldier armed by a counter.',
          },
        },
        {
          h: 'Weapon and Armour strips',
        },
        {
          p: 'Each class has its own strips. A soldier takes the first item from the left that a store holds and skips crossed-out ones. Strips start strongest first. Click to cross out, hold and drag to reorder.',
        },
        {
          list: [
            'No weapon to take: he waits, and the window shows "waits for a weapon".',
            'No armour to take: he goes without. Later he puts it on only when ordered.',
          ],
        },
        {
          h: 'What the Barracks holds',
        },
        {
          table: {
            head: ['Good', 'Pieces'],
            rows: [
              [
                'Every weapon and armour, [[good:shoes|Shoes]], [[good:mead|Mead]], every potion and amulet',
                '{{barracks.gearStock}}',
              ],
              ['Food', '{{barracks.foodStock}}'],
              ['[[good:coin|Coin]]', '{{barracks.coinStock}}'],
            ],
            num: [1],
            foot: 'Goods for the Barracks get priority, with {{barracks.carriers}} Carrier places: [[article:hauling|Carriers and Warehouses]].',
          },
        },
        {
          h: 'Changing by hand',
        },
        {
          table: {
            head: ['Who', 'Can change'],
            rows: [
              ['Soldier', 'Weapon, Armour, Shoes, Equipment'],
              ['Man with a profession', 'Tools, Shoes, Equipment'],
              ['Hero', 'Bag only: [[article:heroes|Heroes]]'],
              ['Woman, child', 'Nothing'],
            ],
          },
        },
        {
          list: [
            'The settler goes for the item and returns to where he got the order.',
            'If he finds no source on the way, he comes back empty-handed.',
            "A weapon changes a soldier's class at once. With the weapon removed, he stays a [[job:soldier_unarmed|Soldier]].",
            'Replaced or removed Shoes, tools and opened bottles are lost.',
            "Weapons, armour and amulets don't wear out, so they go back to the store.",
            'An order to one person beats the Assistant.',
          ],
        },
        {
          h: 'Hits and better weapons',
        },
        {
          p: "Hits don't lock better weapons away. A soldier takes any weapon from a store. The lock is on making it: the [[good:spear_iron|Iron Spear]] and [[good:sword_long|Longsword]] need [[job:smith|Blacksmith]] experience, the [[good:bow_long|Longbow]] needs [[job:armorer|Armourer]] experience. Table: [[article:exp-combat|Combat Experience]].",
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
      name: 'Hitting and Shooting',
      lead: "A melee blow misses only if the target stands beyond weapon range at that moment. An archer's accuracy grows with bow hits.",
      blocks: [
        {
          h: 'Ranged weapons',
        },
        {
          table: {
            head: ['Weapon', 'Range', 'Range on tower', 'Closes to', 'Shot every'],
            rows: [
              [
                '[[good:bow_short|Short Bow]]',
                '{{shortBow.min}}-{{shortBow.max}}',
                '0-{{shortBow.towerMax}}',
                '{{shortBow.standoff}}',
                '{{shortBow.seconds}} s',
              ],
              [
                '[[good:bow_long|Longbow]]',
                '{{longBow.min}}-{{longBow.max}}',
                '0-{{longBow.towerMax}}',
                '{{longBow.standoff}}',
                '{{longBow.seconds}} s',
              ],
              [
                '[[job:hunter|Hunter]]',
                '{{hunterBow.min}}-{{hunterBow.max}}',
                '-',
                '-',
                '{{hunterBow.seconds}} s',
              ],
              [
                '[[job:heroine_bow_xena|Cyra]]',
                '{{heroBow.min}}-{{heroBow.max}}',
                '-',
                '{{heroBow.standoff}}',
                '{{heroBow.seconds}} s',
              ],
              [
                '[[building:catapult|Catapult]]',
                '{{catapult.min}}-{{catapult.max}}',
                '-',
                '{{catapult.bandMin}}-{{catapult.max}}',
                '{{catapult.seconds}} s',
              ],
            ],
            num: [1, 2, 3, 4],
            foot: "Range in hexes. An archer won't shoot below the lower limit. Cyra with the Franks: range {{frankHeroBow.min}}-{{frankHeroBow.max}}, a shot every {{frankHeroBow.seconds}} s.",
          },
        },
        {
          h: 'Accuracy',
        },
        {
          table: {
            head: ['Hits', 'Accurate shots'],
            rows: [
              ['0', '{{aim.basePct}}%'],
              ['50', '{{aim.samplePct}}%'],
              ['{{aim.sureHits}}+', '100%'],
            ],
            num: [0, 1],
            foot: 'Each hit is +1%. Short Bow and Longbow share a hit counter, the [[article:catapult|Catapult]] has its own on the same table. Heroes always shoot true.',
          },
        },
        {
          h: 'Scatter of a stray arrow',
        },
        {
          list: [
            'A stray arrow lands up to 3 hexes from the target. From 75 hits, arrows stop straying.',
            'A stray arrow hits the first enemy at the landing spot: a person, animal or vehicle, then a building, then a stockade.',
            'Arrows fly over your own side, allies and neutrals.',
            'Soldiers lead a moving target. Buildings aim where the target stands.',
          ],
        },
        {
          h: 'Tower post',
        },
        {
          list: [
            'The range bonus works once an archer stands at his post, not on his way there.',
            "An enemy can't aim at a shooter on post, only at the tower.",
          ],
        },
      ],
      see: ['article:exp-combat', 'article:defence', 'building:tower_00', 'building:tower_01'],
    },
    {
      id: 'stances',
      name: 'Stances',
      lead: 'Soldiers and heroes start on Defence.',
      blocks: [
        {
          figure: {
            id: 'leash',
            caption: 'How far he chases',
          },
        },
        {
          table: {
            head: ['Stance', 'Seeks enemies', 'Radius', 'Gives up when', 'When hit'],
            rows: [
              [
                'Attack',
                'Around himself',
                '{{stance.search}}',
                "Target falls or can't be reached",
                'Hits back',
              ],
              [
                'Defence',
                'Around his standing point',
                '{{stance.search}}',
                'Target past {{stance.defendLeash}} from the standing point',
                'Hits back',
              ],
              [
                'Ignorant',
                "Only within weapon range, doesn't close in",
                'Weapon range',
                'Target past {{stance.ignoreLeash}} from the standing point',
                "Doesn't respond",
              ],
            ],
            foot: 'Radii in hexes. The standing point is where the soldier stood when his stance changed. Move and attack orders shift it.',
          },
        },
        {
          list: [
            'A soldier on Attack returns to his standing point if the fight ends more than {{stance.attackReturn}} hexes from it.',
            '[[article:fog|Fog]] does not stop a soldier finding enemies.',
            'An attack order works in every stance.',
            "An archer on post shoots at what's in range, in every stance.",
            'A plain move order keeps a soldier on his route, even under blows. With "Attack on the way" he turns on his attacker.',
          ],
        },
        {
          h: 'Who he attacks first',
        },
        {
          steps: [
            'Soldiers, heroes, catapults, towers and buildings that shoot.',
            'The rest: civilians, other buildings, unarmed vehicles.',
          ],
        },
        {
          p: 'Soldiers never pick a Stockade or Defence wall on their own: [[article:walls|Stockades and Gates]].',
        },
        {
          h: 'Who reacts to a blow',
        },
        {
          table: {
            head: ['Who', 'Hexes from the wounded', 'Reaction'],
            rows: [
              ['Soldiers and heroes on Attack or Defence', '{{stance.soldierAlarm}}', 'Go for the attacker'],
              ['Soldiers and heroes on Ignorant', '-', "Strike only what's within weapon range"],
              [
                'Civilians and Scouts',
                '{{stance.peopleAlarm}}',
                'Flee {{stance.fleeMin}}-{{stance.fleeMax}} hexes and go back to work',
              ],
              ['People inside buildings', '-', "Don't react, except an archer on post"],
              ['Civilian sleeping in the open', '-', 'Sleeps on, flees only when struck'],
            ],
            num: [1],
            foot: 'Only a blow on a person triggers a reaction.',
          },
        },
        {
          h: 'Civilians',
        },
        {
          list: [
            'Civilians are Ignorant and do not fight. Stances are for soldiers and heroes.',
            "A civilian flees only from a blow. Seeing an enemy doesn't move him.",
            "A fleeing settler drops what he's carrying. A Carrier leaves his handcart behind.",
          ],
        },
      ],
      see: ['article:defence', 'article:aim', 'article:fog', 'article:needs'],
    },
    {
      id: 'heroes',
      name: 'Heroes',
      lead: "Heroes come from the map. You can't train one or change his profession.",
      blocks: [
        {
          table: {
            head: ['Trait', 'Soldier', 'Hero'],
            rows: [
              ['Vision range', '{{vision.soldier}}', '{{vision.hero}}'],
              ['Bow accuracy', 'Grows with hits', 'Always true'],
              ['Combat experience', 'Grows', 'Does not grow'],
              ['Eating and sleeping', 'Needs them', "Doesn't need them"],
              ['Shoes', 'Must be supplied, wear out', 'Has them from the start, never wear out'],
              ['Weapon, armour, shoes', 'Can change', 'Fixed'],
              ['Equipment weight', 'Slows him', "Doesn't slow him"],
              ['Dwelling and workplace', 'Can have', 'Has none'],
              ['Magic Chest', "Doesn't open", 'Opens'],
            ],
          },
        },
        {
          h: 'Hero weapons',
        },
        {
          table: {
            head: ['Hero', 'Weapon', 'Armour', 'Range'],
            rows: [
              [
                '[[job:hero_spear_siegfried|Sigurd]]',
                'Spear',
                '[[good:armor_plate|Plate Armour]]',
                '{{hero.spearMin}}-{{hero.spearMax}}',
              ],
              [
                '[[job:hero_sword_bjarni|Bjarni]]',
                'Sword',
                '[[good:armor_chain|Chain Mail]]',
                '{{hero.swordReach}}',
              ],
              [
                '[[job:hero_saber_hatschi|Hatchie]]',
                'Sabre',
                '[[good:armor_chain|Chain Mail]]',
                '{{hero.saberReach}}',
              ],
              [
                '[[job:heroine_bow_xena|Cyra]]',
                'Bow',
                '[[good:armor_leather|Leather Armour]]',
                '{{heroBow.min}}-{{heroBow.max}}',
              ],
            ],
            num: [3],
            foot: 'A blow every {{hero.blowSeconds}} s. Damage: the Heroes option in the [[article:damage|Weapons, Armour and Damage]] table.',
          },
        },
        {
          h: 'Tribe differences',
        },
        {
          table: {
            head: ['Hero', 'Tribe', 'Difference'],
            rows: [
              ['Sigurd', 'Egyptian', 'Chain Mail {{hero.sigurdEgyptChain}}'],
              [
                'Hatchie',
                'Saracen',
                '{{hero.hatchieSaracenBlows}} blows every {{hero.hatchieSaracenSeconds}} s',
              ],
              [
                'Cyra',
                'Frank',
                'Range {{frankHeroBow.min}}-{{frankHeroBow.max}}, a shot every {{frankHeroBow.seconds}} s, no armour {{hero.frankBowBare}}, Tunic and Leather {{hero.frankBowWool}}, Chain Mail and Plate {{hero.frankBowChain}}, Building and Vehicle {{hero.frankBowVehicle}}',
              ],
            ],
          },
        },
        {
          h: 'Bag',
        },
        {
          list: [
            'Takes: [[good:amulet_strength|Amulet of Strength]], [[good:amulet_defense|Amulet of Defence]], [[good:amulet_crithit|Amulet of Precision]], [[good:amulet_speed|Wind Amulet]], [[good:potion_heal_small|S Healing Potion]], [[good:potion_heal_big|L Healing Potion]].',
            "Doesn't take items for needs: Mead, Nourishing Potions, Stamina Potions, [[good:amulet_food|Nourishing Amulet]], [[good:amulet_stamina|Amulet of Stamina]].",
          ],
        },
        {
          h: 'Death',
        },
        {
          p: 'The weapon vanishes. Armour, Shoes and unused bag items stay on the ground.',
        },
      ],
      see: ['article:damage', 'article:chests', 'article:fog', 'article:exp-combat'],
    },
    {
      id: 'defence',
      name: 'Towers, Alarm and Shelter',
      lead: 'A building on alarm shoots by itself. Each person sheltering adds {{shelter.shotsPerSeat}} arrows per second.',
      blocks: [
        {
          h: 'Alarm',
        },
        {
          list: [
            '"Start defence mode" acts on one building, "Whole town" on all defensive buildings.',
            "Only the player raises the alarm. A blow on a settler doesn't.",
            "A building under construction can't raise the alarm.",
            'The alarm lasts until "Stop defence mode" or until the building is destroyed.',
          ],
        },
        {
          h: 'Who shelters',
        },
        {
          list: [
            'Civilians, Women and children run to the nearest building with a free place in walking reach.',
            'Soldiers, heroes and the [[job:scout|Scout]] stay outside.',
            'Anyone who finds no place keeps working.',
            "The alarm outranks hunger and sleep. A sheltering settler eats only what he carries and doesn't work.",
            "A sheltering settler can't be attacked.",
            'Destroying the building throws those sheltering outside.',
          ],
        },
        {
          h: 'Defensive buildings',
        },
        {
          table: {
            head: ['Building', 'Places', 'Arrows per second', 'Posts'],
            rows: [
              ['[[building:headquarters|Headquarters]]', '{{shelter.hq}}', '{{shelter.hqShots}}', '-'],
              [
                '[[building:tower_01|Defence Tower 2]]',
                '{{shelter.tower2}}',
                '{{shelter.tower2Shots}}',
                '{{tower2.posts}} Short Bow, {{tower2.longPosts}} Longbow',
              ],
              [
                '[[building:tower_00|Defence Tower 1]]',
                '{{shelter.tower1}}',
                '{{shelter.tower1Shots}}',
                '{{tower1.posts}} Short Bow, {{tower1.longPosts}} Longbow',
              ],
              ['[[building:barracks|Barracks]]', '{{shelter.barracks}}', '{{shelter.barracksShots}}', '-'],
            ],
            num: [1, 2],
            foot: "Arrows per second with all places full. A post doesn't take a shelter place. An archer employed in a tower shoots by himself, no alarm needed: [[article:aim|Hitting and Shooting]].",
          },
        },
        {
          h: 'Arrows from a building',
        },
        {
          table: {
            head: ['Target', 'Arrow'],
            rows: [
              ['No armour', '{{arrow.bare}}'],
              ['Tunic', '{{arrow.wool}}'],
              ['Leather', '{{arrow.leather}}'],
              ['Chain Mail, Plate', '{{arrow.chain}}'],
              ['Vehicle', '{{arrow.vehicle}}'],
              ['Building', '{{arrow.building}}'],
            ],
            num: [1],
            foot: 'Armour counted with Blocking {{combat.armourBlock}}, as in [[article:damage|Weapons, Armour and Damage]]. The same in every tribe, before multipliers.',
          },
        },
        {
          list: [
            'Range is {{shelter.range}} hexes from the nearest building wall, with no lower limit.',
            'A building also shoots at enemies in fog.',
            'Arrows cost nothing and give no experience.',
            'Target order: soldiers and heroes, wild animals, buildings, other people.',
          ],
        },
        {
          h: 'Tower crew',
        },
        {
          table: {
            head: ['Tower', 'Carriers', 'Mead', 'Food', 'Every soldier weapon'],
            rows: [
              [
                '[[building:tower_00|Defence Tower 1]]',
                '{{tower1.carriers}}',
                '{{tower1.mead}}',
                '{{tower1.food}}',
                '{{tower1.weapon}}',
              ],
              [
                '[[building:tower_01|Defence Tower 2]]',
                '{{tower2.carriers}}',
                '{{tower2.mead}}',
                '{{tower2.food}}',
                '{{tower2.weapon}}',
              ],
            ],
            num: [1, 2, 3, 4],
            foot: 'Carrier places and stock capacity.',
          },
        },
        {
          list: [
            'A post takes only its own class: [[job:soldier_bow_short|Short Bow Archer]] or [[job:soldier_bow_long|Longbow Archer]]. You assign him like a workplace.',
            'A different weapon changes his class and costs him the post.',
            "The crew eats from the tower's stock without coming down and sleeps at the post. An empty stock sends them out for food.",
            'The Assistant never pulls the crew off a tower, not even for equipment.',
            '"Release the garrison": archers leave the tower and stay selected for the next order. A move order also takes an archer off his post.',
            'Status "Manned": the tower has an archer assigned. "No garrison": it has none.',
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
      name: 'Stockades and Gates',
      lead: 'A blow takes 1 health from a stockade for every full {{wall.damagePerPoint}} damage against buildings. Anything under {{wall.damagePerPoint}} does nothing.',
      blocks: [
        {
          table: {
            head: ['Part', 'Health', 'Repair per stroke', 'Cost'],
            rows: [
              ['Stockade segment', '150', '5', '1 [[good:wood|Wood]]'],
              ['Gate', '500', '5', 'Free, made from segments'],
            ],
            num: [1, 2],
            foot: 'Repairs cost nothing. One Builder at a time repairs a stockade.',
          },
        },
        {
          h: 'Building a gate',
        },
        {
          figure: {
            id: 'gate',
            caption: 'A gate on five segments',
          },
        },
        {
          list: [
            'Place a gate on five segments in a straight line, your own and finished.',
            'Each segment has at least 75% health and stands on level ground.',
            'Nobody is standing in the passage.',
            'The gate appears at once, closed, at full health, even on a damaged segment.',
          ],
        },
        {
          h: 'Gate modes',
        },
        {
          table: {
            head: ['Mode', 'Effect'],
            rows: [
              ['Open', 'Anyone passes, enemies too'],
              ['Close', 'Nobody passes, your own people too'],
              [
                'Automatic',
                'Open. Shuts when an enemy is within {{wall.gateEnemyNear}} hexes of the gate, then opens again',
              ],
            ],
            foot: "In automatic mode, living people and vehicles of a player at war count, civilians too. Animals and buildings don't.",
          },
        },
        {
          list: [
            'A gate shuts only once nobody is standing in the passage.',
            'The computer sets its gates to automatic.',
          ],
        },
        {
          h: 'Blows on a stockade',
        },
        {
          table: {
            head: ['Weapon', 'Points per blow', 'Blows: segment', 'Blows: gate', 'Time: segment'],
            rows: [
              ['[[building:catapult|Catapult]]', '36', '5', '14', '20 s'],
              ['Hero, melee', '5', '30', '100', '30 s'],
              ['[[good:spear_iron|Iron Spear]]', '5', '30', '100', '68 s'],
              ['[[good:sword_long|Longsword]]', '5', '30', '100', '73 s'],
              ['[[good:sword_shord|Shortsword]]', '2', '75', '250', '75 s'],
              ['[[good:spear_wooden|Wooden Spear]]', '4', '38', '125', '86 s'],
              ['[[good:bow_short|Short Bow]]', '1', '150', '500', '150 s'],
              ['[[good:bow_long|Longbow]]', '2', '75', '250', '175 s'],
              ['Fists, arrows from a building', '0', '-', '-', '-'],
            ],
            num: [1, 2, 3, 4],
            foot: 'Time for one soldier. Cyra 2 points, 0 with the Franks.',
          },
        },
        {
          list: [
            "Combat experience doesn't raise a blow on a stockade.",
            'The Amulet of Strength acts on the points: 5 gives 7, 2 gives 3, 1 stays 1.',
            "Soldiers don't pick a stockade on their own. They strike it on orders or when it blocks their way to an enemy.",
            'Once a segment falls, soldiers go through the breach and stop hacking at its neighbours.',
          ],
        },
        {
          h: 'Defence wall',
        },
        {
          p: 'The [[building:work_pottery_02|Defence wall]] is a building: {{wall.defenceHp}} health, damage from the Building column. A soldier strikes it only on orders or when it blocks his way to an enemy.',
        },
      ],
      see: [
        'article:damage',
        'article:catapult',
        'article:construction',
        'building:work_pottery_02',
        'good:wood',
      ],
    },
    {
      id: 'catapult',
      name: 'Catapults',
      lead: 'A stone wounds everything on the impact point and the six points around it, your own side included.',
      blocks: [
        {
          figure: {
            id: 'catapult-splash',
            caption: 'Where the stone lands',
          },
        },
        {
          table: {
            head: ['Trait', 'Value'],
            rows: [
              ['Range', '{{catapult.min}}-{{catapult.max}} hexes'],
              ['Shot every', '{{catapult.seconds}} s'],
              ['Health', '{{catapult.hitpoints}}'],
              ['Crew', '1 soldier or hero, any weapon'],
              [
                'Cost',
                '[[building:catapult|Catapult]]: {{catapult.wood}} [[good:wood|Wood]], {{catapult.iron}} [[good:iron|Iron]]',
              ],
            ],
            foot: 'Without a commander a Catapult neither moves nor shoots. Stones cost nothing.',
          },
        },
        {
          h: 'Stone',
        },
        {
          table: {
            head: ['Target', 'Damage', 'Stones to destroy'],
            rows: [
              ['No armour', '{{stone.bare}}', '{{stone.bareKills}}'],
              ['Leather', '{{stone.leather}}', '{{stone.leatherKills}}'],
              ['Tunic', '{{stone.wool}}', '{{stone.woolKills}}'],
              ['Chain Mail, Plate', '{{stone.chain}}', '{{stone.chainKills}}'],
              ['Catapult', '{{stone.vehicle}}', '{{stone.vehicleKills}}'],
              ['Building', '{{stone.building}}', '{{stone.tower1}}-{{stone.frankHq}}'],
              ['Stockade segment', '36 points', '5'],
              ['Gate', '36 points', '14'],
            ],
            num: [2],
            foot: "A person, no blow direction, no amulets. Catapult hits don't raise damage.",
          },
        },
        {
          table: {
            head: ['Building', 'Health', 'Stones', 'Time'],
            rows: [
              [
                '[[building:tower_00|Defence Tower 1]]',
                '{{hp.tower1}}',
                '{{stone.tower1}}',
                '{{stone.tower1Seconds}} s',
              ],
              [
                '[[building:tower_01|Defence Tower 2]]',
                '{{hp.tower2}}',
                '{{stone.tower2}}',
                '{{stone.tower2Seconds}} s',
              ],
              [
                '[[building:headquarters|Headquarters]], Viking',
                '{{hp.hq}}',
                '{{stone.hq}}',
                '{{stone.hqSeconds}} s',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Frankish Headquarters: {{hp.frankHq}} health, {{stone.frankHq}} stones, {{stone.frankHqSeconds}} s.',
          },
        },
        {
          h: 'What gets hit',
        },
        {
          table: {
            head: ['Under the stone', 'Stone'],
            rows: [
              ['Enemy', 'Wounded'],
              ['Your own people, vehicles, buildings, stockades', 'Wounded'],
              ['Neutrals and allies', 'Wounded, attitude unharmed'],
              ['A player at peace by lobby setting', 'Spared'],
              ['Children', 'Spared'],
              ['People inside buildings', 'Spared'],
              ['Trees', 'Knocked down'],
            ],
          },
        },
        {
          h: 'Accuracy',
        },
        {
          p: 'Table: [[article:aim|Hitting and Shooting]]. At {{catapult.max}} hexes a stray stone drifts up to 3 hexes at 0 hits, 2 at 25, 1 at 50, 0 from 75. The commander collects the experience, 1 point per stone that wounded someone.',
        },
        {
          h: 'Catapult stances',
        },
        {
          table: {
            head: ['Stance', 'Seeks enemies', 'Radius', 'Moves'],
            rows: [
              ['Attack', 'Around himself', '{{catapult.searchRadius}}', 'Yes'],
              [
                'Defence',
                'Around its position',
                '{{catapult.searchRadius}}',
                'Yes, up to {{catapult.leash}} from its position',
              ],
              ['Ignorant', 'Around its position', '{{catapult.min}}-{{catapult.max}}', 'No'],
            ],
            foot: 'A new Catapult starts on Ignorant. On its own it picks only targets it can see. An attack order works in every stance.',
          },
        },
        {
          list: [
            'Target closer than {{catapult.min}} hexes: the Catapult backs off. Target past {{catapult.max}}: it moves up to {{catapult.bandMin}}-{{catapult.max}} hexes.',
            'It fires only standing still, and only when not touching another vehicle.',
            'An order can point at a spot on the ground. It strikes a stockade only on orders.',
          ],
        },
        {
          h: 'What destroys a Catapult',
        },
        {
          table: {
            head: ['Weapon', 'Damage', 'Blows on a Catapult'],
            rows: [
              ['A second Catapult', '{{stone.vehicle}}', '{{stone.vehicleKills}}'],
              [
                'Spears, [[good:sword_long|Longsword]], [[good:bow_long|Longbow]]',
                '{{vs.catapult.spear}}',
                '{{vs.catapult.spearHits}}',
              ],
              [
                '[[good:sword_shord|Shortsword]], [[good:bow_short|Short Bow]]',
                '{{vs.catapult.shortSword}}',
                '{{vs.catapult.shortSwordHits}}',
              ],
              ['Fists', '{{vs.catapult.fist}}', '{{vs.catapult.fistHits}}'],
              ['Arrow from a building', '{{arrow.vehicle}}', '{{vs.catapult.arrowHits}}'],
            ],
            num: [1, 2],
            foot: "Combat experience doesn't raise a blow on a vehicle. The attacker's amulets work.",
          },
        },
      ],
      see: ['article:vehicles', 'article:walls', 'article:aim', 'article:exp-combat', 'building:catapult'],
    },
    {
      id: 'computer',
      name: 'Computer Opponents',
      lead: 'Set the level in the lobby. Hard can send its first wave right after peace ends.',
      blocks: [
        {
          table: {
            head: ['Trait', 'Easy', 'Medium', 'Hard'],
            rows: [
              [
                'First wave',
                '{{ai.easy.firstWaveMinutes}} min',
                '{{ai.medium.firstWaveMinutes}} min',
                'At once',
              ],
              ['Army limit', '{{ai.easy.armyCap}}', '{{ai.medium.armyCap}}', '{{ai.hard.armyCap}}'],
              [
                'Catapults',
                '{{ai.easy.catapults}}',
                'up to {{ai.medium.catapults}}',
                'up to {{ai.hard.catapults}}',
              ],
              ['Dense ring of towers', 'No', 'Yes', 'Yes'],
              [
                'Sites at once',
                '{{ai.easy.sites}}',
                '{{ai.medium.sites}}, from {{ai.medium.grownMinutes}} min {{ai.medium.grownSites}}',
                '{{ai.hard.sites}}, from {{ai.hard.midMinutes}} min {{ai.hard.midSites}}, from {{ai.hard.lateMinutes}} min {{ai.hard.lateSites}}',
              ],
            ],
            foot: 'Times are game time: at ×3 they pass three times faster. No wave leaves before "Peace time" ends. Easy and Medium draft no soldiers past the army limit.',
          },
        },
        {
          h: 'Waves',
        },
        {
          table: {
            head: ['Time since waves began', 'Men in a wave'],
            rows: [
              ['0', '{{ai.wave.0.min}}-{{ai.wave.0.max}}'],
              ['1 hr', '{{ai.wave.1.min}}-{{ai.wave.1.max}}'],
              ['2 hrs', '{{ai.wave.2.min}}-{{ai.wave.2.max}}'],
              ['3 hrs and later', '{{ai.wave.3.min}}-{{ai.wave.3.max}}'],
            ],
            num: [1],
            foot: 'Waves begin at the later of two moments: "First wave" or the end of peace. Size is rolled from the range.',
          },
        },
        {
          list: [
            'One wave goes at a time. The next gathers at the [[building:barracks|Barracks]].',
            "Gathering takes up to {{ai.gatherMinutes}} minutes. After that the lower end of the range sets out, or everyone who can make it if there aren't that many.",
          ],
        },
        {
          h: 'When a wave sets out',
        },
        {
          list: [
            'A wave waits while you have more points: soldier and hero 1, archer on a tower 3. The computer counts 1 for each of its men.',
            "Weapons, armour, amulets, potions and experience don't count.",
            'It waits at the Barracks, even after gathering.',
            'Computer army at its limit: the wave sets out anyway.',
          ],
        },
        {
          h: 'Targets',
        },
        {
          steps: [
            'The nearest [[building:headquarters|Headquarters]].',
            'Towers.',
            'Other buildings, construction sites included.',
            'People.',
          ],
        },
        {
          list: [
            'Stockades and the [[building:work_pottery_02|Defence wall]] are not targets: [[article:walls|Stockades and Gates]].',
            'Fog hides nothing from the computer.',
          ],
        },
        {
          h: 'Water',
        },
        {
          list: [
            "The target must stand on the same landmass as the computer's Barracks. A wave doesn't board ships.",
            "If a rival's Headquarters is on another landmass, the computer puts up a [[building:work_joinery_03|Carpenter's Shop 4]] on the shore and builds [[good:ship_small|Ships]], but doesn't carry troops on them.",
            "Your building or person on the computer's landmass becomes a target.",
            'Seaborne landings are a map mode, Ragnarök for one.',
          ],
        },
        {
          h: 'Rebuilding',
        },
        {
          p: '"Map AI" rebuilds buildings, but not the Headquarters, when no enemy is within {{ai.rebuildNear}} hexes.',
        },
      ],
      see: ['article:defence', 'article:walls', 'article:catapult', 'article:fog', 'article:diplomacy'],
    },
  ],
};
