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
            ],
            foot: "A blow from the front or front flank doesn't change the damage. Amulets of Strength, Precision and Defence: [[article:draughts|Potions and Amulets]].",
          },
        },
        {
          list: [
            "Experience doesn't work on arrows, stones, vehicles or stockades.",
            'Blow direction and the Amulet of Defence count only against people. For an arrow, direction is taken from where it was fired.',
            "A Catapult commander's amulets don't strengthen its stones.",
            'A stockade counts damage its own way: [[article:walls|Stockades and Gates]].',
            "Children can't be hurt.",
          ],
        },
        {
          h: 'Tribe differences',
        },
        {
          p: 'The table counts the weapons of the tribe whose emblem you pick at the top of the window. The Dragon that the [[good:spear_wooden|Wooden Spear]] row shows for the Byzantines has {{dragon.hitpoints}} health.',
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
      lead: "You arm your army with the counters in the Assistant window. You change one settler's equipment in his own panel.",
      blocks: [
        {
          p: 'Army counters and the call-up to the Barracks are covered in [[article:assistant|Assistant]].',
        },
        {
          h: 'Weapon and Armour strips',
        },
        {
          p: 'Each kind of soldier has its own strips. A soldier takes the first item from the left that a store holds and skips crossed-out ones. At first the strongest items stand on the left. Click an item to cross it out, drag it to change the order.',
        },
        {
          list: [
            'If there is no weapon, he waits, and the window shows "waits for a weapon".',
            'If there is no armour, he goes without and later puts it on only when you order it.',
          ],
        },
        {
          h: 'A recruit after drill',
        },
        {
          table: {
            head: ['Barracks has', 'Recruit'],
            rows: [
              ['Weapon and armour', 'Walks out fully equipped'],
              ['Only the weapon or only the armour', 'Takes what is there and fetches the rest from a store'],
              ['Nothing', 'Goes for a weapon, then armour'],
            ],
            foot: 'If a better item on the strip lies in a store in reach, the recruit goes for it instead of taking the worse one from the Barracks.',
          },
        },
        {
          h: 'What the Barracks holds',
        },
        {
          table: {
            head: ['Good', 'How many'],
            rows: [
              [
                'Every weapon and armour, [[good:shoes|Shoes]], [[good:mead|Mead]], every potion and amulet',
                '{{barracks.gearStock}}',
              ],
              ['Food', '{{barracks.foodStock}}'],
              ['[[good:coin|Coin]]', '{{barracks.coinStock}}'],
            ],
            num: [1],
            foot: "The Barracks' Carriers fetch goods you give priority from the warehouses themselves: [[article:hauling|Carriers and Warehouses]].",
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
            'A new weapon changes the kind of soldier at once. With the weapon removed, he becomes a plain [[job:soldier_unarmed|Soldier]].',
            'When replaced or removed, worn Shoes, used tools and opened bottles are lost. Unused ones go back to the store.',
            "Weapons, armour and amulets don't wear out and always go back to the store.",
          ],
        },
        {
          h: 'Who can carry a better weapon',
        },
        {
          p: "Any soldier takes any weapon from a store, whatever his experience. The limit is on making it: only an experienced [[job:smith|Blacksmith]] makes the [[good:spear_iron|Iron Spear]] and [[good:sword_long|Longsword]], and only an experienced [[job:armorer|Armourer]] the [[good:bow_long|Longbow]]. Each of these weapons' cards says how much experience it takes.",
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
      lead: 'A melee blow misses only if the target has already moved out of weapon range. The more an archer has hit, the more accurately he shoots.',
      blocks: [
        {
          h: 'Ranged weapons',
        },
        {
          table: {
            head: ['Weapon', 'Range on tower', 'Walks up to'],
            rows: [
              ['[[good:bow_short|Short Bow]]', '0-{{shortBow.towerMax}}', '{{shortBow.standoff}}'],
              ['[[good:bow_long|Longbow]]', '0-{{longBow.towerMax}}', '{{longBow.standoff}}'],
              ['[[job:heroine_bow_xena|Cyra]]', '-', '{{heroBow.standoff}}'],
            ],
            num: [1, 2],
            foot: "Range in hexes. Normal range and shot rate, also for the Hunter's bow and the Catapult, are in the table in [[article:damage|Weapons, Armour and Damage]]. An archer won't shoot at a target closer than the lower end of his range.",
          },
        },
        {
          h: 'Accuracy',
        },
        {
          table: {
            head: ['Hits', 'Chance of an accurate shot'],
            rows: [
              ['0', '{{aim.basePct}}%'],
              ['50', '{{aim.samplePct}}%'],
              ['{{aim.noSpreadHits}}+', 'Always on target'],
            ],
            num: [0, 1],
            foot: 'Each hit adds 1%. From {{aim.noSpreadHits}} hits even an inaccurate arrow lands on target. Short Bow and Longbow count hits together, the [[article:catapult|Catapult]] separately but on the same table. A hero always hits.',
          },
        },
        {
          h: 'Scatter of a stray arrow',
        },
        {
          list: [
            'A stray arrow lands close to the target: up to {{aim.spreadShort}} hexes from a [[good:bow_short|Short Bow]], up to {{aim.spreadLong}} from a [[good:bow_long|Longbow]], up to {{aim.spreadTower}} from a Longbow on a tower. Scatter grows with distance.',
            'A stray arrow can wound another enemy where it lands.',
            "Arrows don't wound your own side, allies or neutrals.",
            'An archer leads a moving enemy, while a building shoots at where the enemy is at the moment of the shot.',
          ],
        },
        {
          h: 'Tower post',
        },
        {
          list: ["An archer on post can't be hit. An enemy can shoot only at the tower."],
        },
      ],
      see: ['article:exp-combat', 'article:defence', 'building:tower_00', 'building:tower_01'],
    },
    {
      id: 'stances',
      name: 'Stances',
      lead: 'A stance says whether a soldier looks for enemies on his own and how far he follows them. New soldiers and heroes stand on Defence.',
      blocks: [
        {
          figure: {
            id: 'leash',
            caption: 'How far he chases',
          },
        },
        {
          table: {
            head: ['Stance', 'Seeks enemies', 'Radius', 'Gives up when', 'When struck'],
            rows: [
              [
                'Attack',
                'Around himself',
                '{{stance.search}}',
                "Target dies or can't be reached",
                'Goes for the attacker',
              ],
              [
                'Defence',
                'Around his standing point',
                '{{stance.search}}',
                'Target moves more than {{stance.defendLeash}} from the standing point',
                'Goes for the attacker',
              ],
              [
                'Ignorant',
                "Only within weapon range, doesn't close in",
                'Weapon range',
                'Target moves more than {{stance.ignoreLeash}} from the standing point',
                'Stays put',
              ],
            ],
            foot: 'Distances in hexes. The standing point is where the soldier stood when you changed his stance. A move or attack order sets it anew.',
          },
        },
        {
          list: [
            'A soldier on Attack returns to his standing point if the fight ends more than {{stance.attackReturn}} hexes from it.',
            'A soldier spots enemies in [[article:fog|fog]] too.',
            'An attack order works in every stance.',
            'In every stance an archer on post shoots at anything in range.',
            'After a plain move order a soldier keeps going, even when someone strikes him. After "Attack on the way" he turns to fight his attacker.',
          ],
        },
        {
          h: 'Who he attacks first',
        },
        {
          p: 'A soldier first strikes those who can hit back: soldiers, heroes, catapults, towers and buildings that shoot. Civilians, other buildings and unarmed vehicles come later.',
        },
        {
          p: 'A soldier never attacks a Stockade or Defence wall on his own: [[article:walls|Stockades and Gates]].',
        },
        {
          h: 'Who reacts to a blow',
        },
        {
          table: {
            head: ['Who', 'Distance from the wounded', 'What they do'],
            rows: [
              ['Soldiers and heroes on Attack or Defence', '{{stance.soldierAlarm}}', 'Go for the attacker'],
              ['Soldiers and heroes on Ignorant', '-', "Strike only what's within weapon range"],
              [
                'Civilians and Scouts',
                '{{stance.peopleAlarm}}',
                'Flee {{stance.fleeMin}}-{{stance.fleeMax}} hexes and go back to work',
              ],
            ],
            num: [1],
            foot: 'Distance in hexes. Only a blow on a person alarms anyone, not one on a building or animal.',
          },
        },
        {
          h: 'Civilians',
        },
        {
          list: [
            "A civilian doesn't fight. You set stances only for soldiers and heroes.",
            "A civilian doesn't flee at the mere sight of an enemy.",
            "When fleeing, a civilian drops what he's carrying, and a Carrier leaves his handcart behind.",
          ],
        },
        {
          h: 'The "Eating and sleeping" switch',
        },
        {
          p: 'On "Prohibited" a soldier doesn\'t go to eat, sleep or pray on his own. He doesn\'t even eat what he carries or from the tower\'s stock, and hunger doesn\'t break off a long order. Without potions he will starve in the end. An Eat order or switching back to "Allowed" helps.',
        },
        {
          p: 'Potions, amulets and the Eat, Sleep and Pray orders work with either setting. In the order menu the settings are called "Allow Regeneration" and "Prohibit Regeneration".',
        },
        {
          h: 'Resting near a fight',
        },
        {
          table: {
            head: ['What is close', 'Hexes', 'The soldier'],
            rows: [
              ['Fight', 'up to {{alert.restClearance}}', "Doesn't sleep, pray or talk"],
              ['Enemy in sight', 'up to {{alert.standTo}}', 'The same'],
            ],
            foot: "He goes to eat only once Energy drops to {{need.criticalPct}}%. On Ignorant this doesn't apply.",
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
              ['Vision range in hexes', '{{vision.soldier}}', '{{vision.hero}}'],
              ['Bow accuracy', 'Grows with hits', 'Always true'],
              ['Combat experience', 'Grows', 'Grows only if the mission allows it'],
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
            head: ['Hero', 'Weapon', 'Armour'],
            rows: [
              ['[[job:hero_spear_siegfried|Sigurd]]', 'Spear', '[[good:armor_plate|Plate Armour]]'],
              ['[[job:hero_sword_bjarni|Bjarni]]', 'Sword', '[[good:armor_chain|Chain Mail]]'],
              ['[[job:hero_saber_hatschi|Hatchie]]', 'Sabre', '[[good:armor_chain|Chain Mail]]'],
              ['[[job:heroine_bow_xena|Cyra]]', 'Bow', '[[good:armor_leather|Leather Armour]]'],
            ],
            foot: 'Range, blow rate and damage are in the table in [[article:damage|Weapons, Armour and Damage]] with Heroes turned on. Heroes of another tribe fight a little differently: pick its emblem at the top of the window.',
          },
        },
        {
          h: 'Bag',
        },
        {
          list: [
            'A hero puts only these in his bag: [[good:amulet_strength|Amulet of Strength]], [[good:amulet_defense|Amulet of Defence]], [[good:amulet_crithit|Amulet of Precision]], [[good:amulet_speed|Wind Amulet]], [[good:potion_heal_small|S Healing Potion]], [[good:potion_heal_big|L Healing Potion]].',
          ],
        },
      ],
      see: ['article:damage', 'article:chests', 'article:fog', 'article:exp-combat'],
    },
    {
      id: 'defence',
      name: 'Towers and Alarm',
      lead: 'A building on alarm shoots at enemies by itself. Each person hiding inside adds {{shelter.shotsPerSeat}} arrows per second.',
      blocks: [
        {
          h: 'Alarm',
        },
        {
          list: [
            '"Start defence mode" acts on one building, "Whole town" on all defensive buildings.',
            "You raise the alarm yourself. An attack on the settlement doesn't.",
            'The alarm doesn\'t switch itself off. It lasts until "Stop defence mode" or until the building is destroyed.',
          ],
        },
        {
          h: 'Who hides',
        },
        {
          list: [
            'Civilians, Women and children run to the nearest building with a free place that they can walk to.',
            'Soldiers, heroes and the [[job:scout|Scout]] stay outside.',
            'Anyone who finds no place keeps working.',
            "On alarm a settler breaks off eating and sleeping. Inside he doesn't work and eats only what he carries.",
            "Someone hidden inside can't be attacked.",
            'When the building is destroyed, those hidden inside come out.',
          ],
        },
        {
          h: 'Defensive buildings',
        },
        {
          table: {
            head: ['Building', 'Places', 'Arrows per second'],
            rows: [
              ['[[building:headquarters|Headquarters]]', '{{shelter.hq}}', '{{shelter.hqShots}}'],
              ['[[building:tower_01|Defence Tower 2]]', '{{shelter.tower2}}', '{{shelter.tower2Shots}}'],
              ['[[building:tower_00|Defence Tower 1]]', '{{shelter.tower1}}', '{{shelter.tower1Shots}}'],
              ['[[building:barracks|Barracks]]', '{{shelter.barracks}}', '{{shelter.barracksShots}}'],
            ],
            num: [1, 2],
            foot: "Arrows per second with the building full. Archer posts, shown on the tower's card, don't use up hiding places. An archer employed in a tower shoots by himself, no alarm needed: [[article:aim|Hitting and Shooting]].",
          },
        },
        {
          h: 'Arrows from a building',
        },
        {
          p: 'How much one arrow takes is in the "Arrows from a building" row of the table in [[article:damage|Weapons, Armour and Damage]].',
        },
        {
          list: [
            'A building shoots {{shelter.range}} hexes from its nearest wall, also at an enemy right under the walls.',
            'A building also shoots at enemies in fog.',
            'Arrows cost nothing and give no experience.',
            'It shoots at soldiers and heroes first and at civilians last.',
          ],
        },
        {
          h: 'Tower crew',
        },
        {
          table: {
            head: ['Tower', 'Mead', 'Food', 'Of each weapon'],
            rows: [
              [
                '[[building:tower_00|Defence Tower 1]]',
                '{{tower1.mead}}',
                '{{tower1.food}}',
                '{{tower1.weapon}}',
              ],
              [
                '[[building:tower_01|Defence Tower 2]]',
                '{{tower2.mead}}',
                '{{tower2.food}}',
                '{{tower2.weapon}}',
              ],
            ],
            num: [1, 2, 3],
            foot: "Posts and Carrier places are on the tower's card.",
          },
        },
        {
          list: [
            'Only the right archer can take a post: [[job:soldier_bow_short|Short Bow Archer]] or [[job:soldier_bow_long|Longbow Archer]]. You assign him like a workplace.',
            'An archer who takes a different weapon loses the post.',
            "The crew eats from the tower's stock and sleeps at the post. They come down for food only when the stock runs out.",
            'The Assistant never pulls archers off a tower, not even for equipment.',
            '"Release the garrison" brings the archers out of the tower and selects them, so you can give them an order right away. A move order also takes an archer off his post.',
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
            foot: 'Repairs cost nothing. Only one Builder at a time repairs a segment.',
          },
        },
        {
          h: 'Building a gate',
        },
        {
          list: [
            'A gate takes {{wall.gateSegments}} of your finished segments in a straight line. Each must have at least {{wall.gateMinHealthPct}}% health and stand on level ground, and nobody may be standing in the passage.',
            'The gate appears at once, closed and at full health, even if the segments were damaged.',
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
                'Open. Shuts when an enemy comes within {{wall.gateEnemyNear}} hexes and opens again when he leaves',
              ],
            ],
            foot: "Any person or vehicle of a player you are at war with shuts the gate, civilians too. Animals don't.",
          },
        },
        {
          list: ['A gate shuts only once nobody is standing in the passage.'],
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
            "Combat experience doesn't strengthen blows on a stockade.",
            'The Amulet of Strength strengthens the blow: {{wall.ironSpear.blow}} becomes {{wall.ironSpear.strongBlow}}, {{wall.shortSword.blow}} becomes {{wall.shortSword.strongBlow}}, and {{wall.shortBow.blow}} stays {{wall.shortBow.strongBlow}}.',
            "A soldier doesn't attack a stockade on his own. He strikes it on orders or when it blocks his way to an enemy.",
            'Once one segment falls, soldiers go through the breach and leave the neighbouring ones standing.',
          ],
        },
        {
          h: 'Defence wall',
        },
        {
          p: 'The [[building:work_pottery_02|Defence wall]] is an ordinary building and takes damage from the Building column. A soldier treats it like a stockade.',
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
          p: 'A Catapult is led by 1 soldier or hero, with any weapon. Without a commander it neither moves nor shoots. Stones cost nothing. Health, range, shot rate and cost are on the [[building:catapult|Catapult]] card.',
        },
        {
          h: 'Stone',
        },
        {
          p: 'What a stone takes from people, vehicles and buildings is in the Catapult row of the table in [[article:damage|Weapons, Armour and Damage]]. A stockade counts it differently: [[article:walls|Stockades and Gates]].',
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
          p: 'Accuracy grows as with an archer: [[article:aim|Hitting and Shooting]]. At {{catapult.max}} hexes an inaccurate stone lands up to {{stone.spread.0}} hexes from the target at 0 hits, {{stone.spread.25}} at 25, {{stone.spread.50}} at 50. From {{aim.noSpreadHits}} hits it lands on target. The commander collects the hits: every stone that damaged something counts, a building included, but only once, even if it hit several targets.',
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
            foot: 'A new Catapult starts on Ignorant. On its own it attacks only targets it can see. An attack order works in every stance.',
          },
        },
        {
          list: [
            'If the target is closer than {{catapult.min}} hexes, the Catapult backs off. If it is farther than {{catapult.max}}, it moves up to {{catapult.bandMin}}-{{catapult.max}} hexes.',
            'It fires only standing still, and only when not touching another vehicle.',
            'You can order it to fire at any spot on the ground. It shoots at a stockade only on orders.',
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
  ],
};
