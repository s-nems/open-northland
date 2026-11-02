import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const MILITARY: ArticleGroup = {
  group: 'Military',
  items: [
    {
      id: 'damage',
      name: 'Weapons, Armour and Damage',
      lead: 'A person has {{health.human}} health. The table shows how much one blow takes.',
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
          h: 'What changes damage',
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
            foot: "A blow from the front or front flank doesn't change the damage.",
          },
        },
        {
          list: [
            "Experience doesn't work on arrows, stones, vehicles or stockades.",
            'Direction and the Amulet of Defence work only on people. For an arrow, what counts is the spot it was fired from.',
            "A commander's amulets don't work on a Catapult stone.",
            'A stockade counts damage its own way: [[article:walls|Stockades and Gates]].',
            "A blow for 0 doesn't wound and gives no experience.",
            "Children can't be hurt.",
          ],
        },
        {
          h: 'Tribe differences',
        },
        {
          list: [
            'Saracen: [[good:bow_short|Short Bow]] deals {{saracen.bowOnWool}} to a Tunic instead of {{viking.bowOnWool}}, {{saracen.bowOnChain}} to Chain Mail and Plate instead of {{viking.bowOnChain}}.',
            'Byzantine: the Dragon from the map fights with its own [[good:spear_wooden|Wooden Spear]]: {{dragon.hitpoints}} health, range {{dragon.min}}-{{dragon.max}}, {{dragon.blows}} blows every {{dragon.seconds}} s, {{dragon.bare}} damage against no armour. The table shows it in this row. A trained Spearman fights as in the other tribes.',
            'All other weapons are the same in every tribe.',
          ],
        },
        {
          h: 'Armour',
        },
        {
          data: 'armour',
        },
        {
          p: 'Heavy weapons and armour slow walking: [[article:walking|Walking Speed]].',
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
      lead: 'You arm your army with the counters in the Assistant window. You change a single man in his own panel.',
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
            "While an unarmed soldier is waiting, the counter trains no new one, even if there's no weapon yet.",
            'An unarmed soldier goes for a weapon when one of that kind lies in his reach and nobody else is waiting for it.',
            'Lowering the counter makes those waiting for a weapon stop waiting.',
          ],
        },
        {
          h: 'Weapon and Armour strips',
        },
        {
          p: 'Each kind of soldier has its own strips. A soldier takes the first item from the left that a store holds and skips crossed-out ones. At the start the strongest stands on the left. Click to cross out, hold and drag to reorder.',
        },
        {
          list: [
            'No weapon to take: he waits, and the window shows "waits for a weapon".',
            'No armour to take: he goes without. Later he puts it on only when ordered.',
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
            foot: 'If a better item on the strip lies in a store in reach, the recruit goes for it and leaves the worse one at the Barracks. Then he returns to the Barracks. A soldier armed by a counter does the same.',
          },
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
            foot: 'The Barracks has {{barracks.carriers}} Carrier places. They bring goods marked priority from the warehouses themselves: [[article:hauling|Carriers and Warehouses]].',
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
            "If he can't find the item anywhere, he comes back empty-handed.",
            'A weapon changes the kind of soldier at once. With the weapon removed, he stays a [[job:soldier_unarmed|Soldier]].',
            'Used Shoes, tools and opened bottles are lost when replaced or removed. Unused ones go back to the store.',
            "Weapons, armour and amulets don't wear out, so they go back to the store.",
            'An order to one person beats the Assistant.',
          ],
        },
        {
          h: 'Who can carry a better weapon',
        },
        {
          p: "Any soldier takes any weapon from a store, hits don't limit it. The limit is on making it: an experienced [[job:smith|Blacksmith]] makes the [[good:spear_iron|Iron Spear]] and [[good:sword_long|Longsword]], an experienced [[job:armorer|Armourer]] the [[good:bow_long|Longbow]]. Table: [[article:exp-combat|Combat Experience]].",
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
            foot: "Range in hexes. An archer won't shoot closer than the lower number. Closes to: the distance he starts shooting from when he walks up to the target himself.",
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
              ['{{aim.noSpreadHits}}+', 'Always on target'],
            ],
            num: [0, 1],
            foot: 'Each hit is +1%. From {{aim.noSpreadHits}} hits even an inaccurate arrow lands on target. Short Bow and Longbow share a hit counter, the [[article:catapult|Catapult]] has its own on the same table. A hero always shoots true.',
          },
        },
        {
          h: 'Scatter of a stray arrow',
        },
        {
          list: [
            'A stray arrow lands close to the target: up to {{aim.spreadShort}} hexes from a [[good:bow_short|Short Bow]], up to {{aim.spreadLong}} from a [[good:bow_long|Longbow]], up to {{aim.spreadTower}} from a Longbow on a tower. Scatter grows with distance.',
            'A stray arrow wounds the first enemy at the landing spot: a person, animal or vehicle first, then a building, and a stockade last.',
            'Arrows fly over your own side, allies and neutrals.',
            'An archer aims ahead of a walking enemy. A building shoots at where the enemy stands right now.',
          ],
        },
        {
          h: 'Tower post',
        },
        {
          list: [
            'An archer has the longer range only at his post, not on his way there.',
            "An enemy can't shoot at an archer on post, only at the tower.",
          ],
        },
      ],
      see: ['article:exp-combat', 'article:defence', 'building:tower_00', 'building:tower_01'],
    },
    {
      id: 'stances',
      name: 'Stances',
      lead: 'A stance says whether a soldier looks for enemies on his own and how far he follows them. Soldiers and heroes start on Defence.',
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
                'Goes for the attacker',
              ],
              [
                'Defence',
                'Around his standing point',
                '{{stance.search}}',
                'Target past {{stance.defendLeash}} from the standing point',
                'Goes for the attacker',
              ],
              [
                'Ignorant',
                "Only within weapon range, doesn't close in",
                'Weapon range',
                'Target past {{stance.ignoreLeash}} from the standing point',
                'Stays put',
              ],
            ],
            foot: 'Radii in hexes. The standing point is where the soldier stood when his stance changed. After a move or attack order it shifts to the new spot.',
          },
        },
        {
          list: [
            'A soldier on Attack returns to his standing point if the fight ends more than {{stance.attackReturn}} hexes from it.',
            'A soldier finds enemies in [[article:fog|fog]] too.',
            'An attack order works in every stance.',
            "An archer on post shoots at what's in range, in every stance.",
            'After a plain move order a soldier keeps going, even under blows. After "Attack on the way" he turns on his attacker.',
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
          p: 'A soldier never picks a Stockade or Defence wall on his own: [[article:walls|Stockades and Gates]].',
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
            foot: 'Only a blow on a person counts. A struck building or animal alarms nobody.',
          },
        },
        {
          h: 'Civilians',
        },
        {
          list: [
            "A civilian doesn't fight. You set stances only for soldiers and heroes.",
            "Seeing an enemy doesn't move a civilian.",
            "A fleeing settler drops what he's carrying. A Carrier leaves his handcart behind.",
          ],
        },
        {
          h: 'The "Eating and sleeping" switch',
        },
        {
          p: 'On "Prohibited" a soldier doesn\'t go to food, bed or prayer on his own, doesn\'t eat from his hands or the tower\'s stock, and hunger doesn\'t break off a long order. Without potions that ends in starvation. An Eat order or a return to "Allowed" saves him.',
        },
        {
          p: 'Potions, amulets and the Eat, Sleep and Pray orders work in both states. In the order menu the states are "Allow Regeneration" and "Prohibit Regeneration". Only soldiers have the switch. It starts on "Allowed" and returns there after a change of profession.',
        },
        {
          h: 'Standing to',
        },
        {
          p: 'This is the state of a soldier on Attack or Defence near a fight, not the [[article:defence|settlement alarm]] the player sounds.',
        },
        {
          table: {
            head: ['What is nearby', 'Hexes', 'Effect'],
            rows: [
              ['Fight', 'up to {{alert.restClearance}}', 'No sleep, no prayer, no talk.'],
              ['Visible enemy on Attack or Defence', 'up to {{alert.standTo}}', 'Same.'],
              ['Fight beside a soldier sleeping in the open', 'up to {{alert.standTo}}', 'He gets up.'],
            ],
            foot: 'He goes for food only at {{need.criticalPct}}% Energy. Wild animals only count once a fight with them is on. On Ignorant the rule is off, and a need order takes priority.',
          },
        },
      ],
      see: ['article:defence', 'article:aim', 'article:fog', 'article:needs'],
    },
    {
      id: 'heroes',
      name: 'Heroes',
      lead: "A hero comes from the map. You can't train one or change his profession.",
      blocks: [
        {
          table: {
            head: ['Trait', 'Soldier', 'Hero'],
            rows: [
              ['Vision range, hexes', '{{vision.soldier}}', '{{vision.hero}}'],
              ['Bow accuracy', 'Grows with hits', 'Always true'],
              ['Combat experience', 'Grows', "Doesn't grow, unless the mission allows it"],
              ['Eating and sleeping', 'Needs them', "Doesn't need them"],
              ['Weapon, armour, Shoes', 'Can change, Shoes wear out', "Fixed, Shoes don't wear out"],
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
            foot: 'A blow every {{hero.blowSeconds}} s. Damage: turn on Heroes in the [[article:damage|Weapons, Armour and Damage]] table.',
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
            'Takes only: [[good:amulet_strength|Amulet of Strength]], [[good:amulet_defense|Amulet of Defence]], [[good:amulet_crithit|Amulet of Precision]], [[good:amulet_speed|Wind Amulet]], [[good:potion_heal_small|S Healing Potion]], [[good:potion_heal_big|L Healing Potion]].',
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
      name: 'Towers and Alarm',
      lead: 'A building on alarm shoots by itself. Each person inside adds {{shelter.shotsPerSeat}} arrows per second.',
      blocks: [
        {
          h: 'Alarm',
        },
        {
          list: [
            '"Start defence mode" acts on one building, "Whole town" on all defensive buildings.',
            "You raise the alarm yourself. An attack on the settlement doesn't.",
            "A building under construction can't raise the alarm.",
            'The alarm doesn\'t switch itself off. It lasts until "Stop defence mode" or until the building is destroyed.',
          ],
        },
        {
          h: 'Who hides',
        },
        {
          list: [
            'Civilians, Women and children run to the nearest building with a free place. The building must be in walking reach.',
            'Soldiers, heroes and the [[job:scout|Scout]] stay outside.',
            'Anyone who finds no place keeps working.',
            "On alarm a settler drops eating and sleeping. Inside he doesn't work and eats only what he carries.",
            "Someone hidden inside can't be attacked.",
            'When the building falls, those hidden inside come out.',
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
            foot: "Arrows per second with the building full. A post doesn't take a place in the building. An archer employed in a tower shoots by himself, no alarm needed: [[article:aim|Hitting and Shooting]].",
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
            foot: 'The same in every tribe. Blow direction and the Amulet of Defence can change this: [[article:damage|Weapons, Armour and Damage]].',
          },
        },
        {
          list: [
            'A building shoots {{shelter.range}} hexes from its nearest wall, also at an enemy right under the walls.',
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
            head: ['Tower', 'Carrier places', 'Mead', 'Food', 'Weapons, pieces of each'],
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
          },
        },
        {
          list: [
            'A post takes only its own archer: [[job:soldier_bow_short|Short Bow Archer]] or [[job:soldier_bow_long|Longbow Archer]]. You assign him like a workplace.',
            'An archer who takes a different weapon loses the post.',
            "The crew eats from the tower's stock and sleeps at the post without coming down. When the stock runs out, they go for food.",
            'The Assistant never pulls archers off a tower, not even for equipment.',
            '"Release the garrison": archers leave the tower and stay selected for the next order. A move order also takes an archer off his post.',
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
      lead: 'A stockade loses 1 health for every full {{wall.damagePerPoint}} damage from the Building column. A weaker blow does nothing to it.',
      blocks: [
        {
          table: {
            head: ['Part', 'Health', 'Repair per stroke', 'Cost'],
            rows: [
              ['Stockade segment', '{{wall.segmentHp}}', '{{wall.segmentRepair}}', '1 [[good:wood|Wood]]'],
              ['Gate', '{{wall.gateHp}}', '{{wall.gateRepair}}', 'Free, made from segments'],
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
            caption: 'Where the gate goes',
          },
        },
        {
          list: [
            'A gate takes {{wall.gateSegments}} of your finished segments in a straight line. Each must have at least {{wall.gateMinHealthPct}}% health and stand on level ground, and nobody may be standing in the passage.',
            'The gate appears at once, closed. It has full health even if a segment was damaged.',
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
            foot: "Any person or vehicle of a player you are at war with shuts the gate, civilians too. Animals don't.",
          },
        },
        {
          list: [
            'A gate shuts only once nobody is standing in the passage.',
            'The computer sets its gates to automatic.',
          ],
        },
        {
          h: 'How fast a stockade falls',
        },
        {
          table: {
            head: ['Weapon', 'Health per blow', 'Blows per segment', 'Blows per gate', 'Time per segment'],
            rows: [
              [
                '[[building:catapult|Catapult]]',
                '{{wall.catapult.blow}}',
                '{{wall.catapult.segmentHits}}',
                '{{wall.catapult.gateHits}}',
                '{{wall.catapult.segmentSeconds}} s',
              ],
              [
                'Hero, melee',
                '{{wall.hero.blow}}',
                '{{wall.hero.segmentHits}}',
                '{{wall.hero.gateHits}}',
                '{{wall.hero.segmentSeconds}} s',
              ],
              [
                '[[good:spear_iron|Iron Spear]]',
                '{{wall.ironSpear.blow}}',
                '{{wall.ironSpear.segmentHits}}',
                '{{wall.ironSpear.gateHits}}',
                '{{wall.ironSpear.segmentSeconds}} s',
              ],
              [
                '[[good:sword_long|Longsword]]',
                '{{wall.longSword.blow}}',
                '{{wall.longSword.segmentHits}}',
                '{{wall.longSword.gateHits}}',
                '{{wall.longSword.segmentSeconds}} s',
              ],
              [
                '[[good:sword_shord|Shortsword]]',
                '{{wall.shortSword.blow}}',
                '{{wall.shortSword.segmentHits}}',
                '{{wall.shortSword.gateHits}}',
                '{{wall.shortSword.segmentSeconds}} s',
              ],
              [
                '[[good:spear_wooden|Wooden Spear]]',
                '{{wall.woodenSpear.blow}}',
                '{{wall.woodenSpear.segmentHits}}',
                '{{wall.woodenSpear.gateHits}}',
                '{{wall.woodenSpear.segmentSeconds}} s',
              ],
              [
                '[[good:bow_short|Short Bow]]',
                '{{wall.shortBow.blow}}',
                '{{wall.shortBow.segmentHits}}',
                '{{wall.shortBow.gateHits}}',
                '{{wall.shortBow.segmentSeconds}} s',
              ],
              [
                '[[good:bow_long|Longbow]]',
                '{{wall.longBow.blow}}',
                '{{wall.longBow.segmentHits}}',
                '{{wall.longBow.gateHits}}',
                '{{wall.longBow.segmentSeconds}} s',
              ],
              ['Fists, arrows from a building', '0', '-', '-', '-'],
            ],
            num: [1, 2, 3, 4],
            foot: 'Time for one soldier. Cyra takes {{wall.heroBow.blow}}, with the Franks {{wall.frankHeroBow.blow}}.',
          },
        },
        {
          list: [
            "Combat experience doesn't raise a blow on a stockade.",
            'The Amulet of Strength raises this number: {{wall.ironSpear.blow}} gives {{wall.ironSpear.strongBlow}}, {{wall.shortSword.blow}} gives {{wall.shortSword.strongBlow}}, {{wall.shortBow.blow}} stays {{wall.shortBow.strongBlow}}.',
            "A soldier doesn't pick a stockade on his own. He strikes it on orders or when it blocks his way to an enemy.",
            'Once a segment falls, soldiers go through the breach and leave the neighbouring segments alone.',
          ],
        },
        {
          h: 'Defence wall',
        },
        {
          p: 'The [[building:work_pottery_02|Defence wall]] is an ordinary building: {{wall.defenceHp}} health, damage from the Building column. A soldier treats it like a stockade.',
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
      lead: 'A stone wounds everything on the hex where it lands and the six hexes around it, your own people included.',
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
            ],
            num: [2],
            foot: 'Damage to a person from the front, no amulets. Stockades: [[article:walls|Stockades and Gates]].',
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
          p: 'Accuracy grows as with an archer: [[article:aim|Hitting and Shooting]]. At {{catapult.max}} hexes an inaccurate stone lands up to {{stone.spread.0}} hexes from the target at 0 hits, {{stone.spread.25}} at 25, {{stone.spread.50}} at 50. From {{aim.noSpreadHits}} hits it lands on target. The commander collects the experience: 1 hit for a stone that damaged something, a building included. A stone that hit several targets counts once.',
        },
        {
          h: 'Catapult stances',
        },
        {
          table: {
            head: ['Stance', 'Seeks enemies', 'Radius', 'Moves'],
            rows: [
              ['Attack', 'Around itself', '{{catapult.searchRadius}}', 'Yes'],
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
            'You can order it to fire at a spot on the ground. It strikes a stockade only on orders.',
          ],
        },
        {
          h: 'What destroys a Catapult',
        },
        {
          table: {
            head: ['Weapon', 'Damage', 'Hits to destroy'],
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
            foot: "Experience doesn't work on vehicles. The attacker's amulets do.",
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
            foot: 'Times are game time: at ×3 they pass three times faster. No wave leaves before "Peace time" ends. Easy and Medium train no soldiers past the army limit.',
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
            foot: 'Time counts from the later of two moments: "First wave" or the end of peace. Wave size is rolled from the range.',
          },
        },
        {
          list: [
            'One wave goes at a time. The next gathers at the [[building:barracks|Barracks]].',
            "Gathering takes up to {{ai.gatherMinutes}} minutes. After that the lower number from the table sets out, or everyone who can make it if there aren't that many.",
          ],
        },
        {
          h: 'When a wave sets out',
        },
        {
          list: [
            "The computer compares its army's strength with yours. It counts weapons, armour, amulets, health and healing potions, but not experience.",
            'Your archer on a tower counts as {{ai.towerPostWeight}}.',
            'Each computer rolls a plan at the start. An aggressive one sets out at {{ai.planAggressivePct}}% of your strength, a defensive one only at {{ai.planDefensivePct}}%, the others at {{ai.planBalancedPct}}%.',
            "In fog it counts what it has seen. If it knows nothing about you, it assumes you're just as strong.",
            'Until it has the strength, the wave waits at the Barracks, even after gathering.',
            'When the computer army reaches its limit, the wave sets out anyway.',
            "When you attack its settlement or you're {{ai.defendRatio}} times stronger, it keeps its army at home, and a wave on the way turns back.",
          ],
        },
        {
          h: 'Raids',
        },
        {
          list: [
            "A small party of {{ai.raidMen}} men goes for your Extractors and economy buildings. It avoids tower range, and if there's no way around the towers it doesn't set out.",
            'A hard computer does this in {{ai.raidChancePct}}% of games, unless it starts on an island. A harassing plan always does it, at every level.',
            'The first raid leaves {{ai.raidMinMinutes}}-{{ai.raidMaxMinutes}} minutes after peace ends, the next ones at similar intervals.',
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
            'In fog the computer knows the buildings from the map start and the ones it has already seen. It learns of new ones when it sees them.',
          ],
        },
        {
          h: 'Water',
        },
        {
          list: [
            "A wave on foot only goes over the landmass the computer's Barracks stand on. Your building or person on that landmass becomes a target.",
            "If a rival's Headquarters is on another landmass, the computer puts up a [[building:work_joinery_03|Carpenter's Shop 4]] on the shore, builds [[good:ship_small|Ships]] and carries troops on them.",
            'A landing sets out once {{ai.landingShips}} Ships stand at the shore, fewer for a weaker computer, and the army is {{ai.landingEdge}} times stronger than the defenders. A Ship carries {{vehicle.shipSeats}} soldiers.',
            'It lands outside the range of your towers and buildings on alarm, as close to the Headquarters as it can, and goes for it.',
            'After losing {{ai.landingRetreatPct}}% of its men on land, the rest return to the Ships. The next landing leaves {{ai.landingCooldownMinutes}} minutes later at the earliest.',
          ],
        },
        {
          h: 'Rebuilding',
        },
        {
          p: 'A player set to "Map AI" in the lobby rebuilds buildings when no enemy is within {{ai.rebuildNear}} hexes and one of its civilians is. It does not rebuild the Headquarters.',
        },
      ],
      see: ['article:defence', 'article:walls', 'article:catapult', 'article:fog', 'article:diplomacy'],
    },
  ],
};
