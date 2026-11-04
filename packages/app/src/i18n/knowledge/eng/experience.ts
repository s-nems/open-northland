import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const EXPERIENCE: ArticleGroup = {
  group: 'Experience',
  items: [
    {
      id: 'exp-work',
      name: 'Work Experience',
      lead: 'Experience grows separately for each good: 100% on wood does nothing for quarrystone.',
      blocks: [
        {
          h: 'What experience gives you',
        },
        {
          figure: {
            id: 'exp-curve',
            caption: 'The first pieces count the most',
          },
        },
        {
          data: 'experience',
        },
        {
          p: 'The table is for ordinary work. Wood, hunting, fishing and building grow at their own pace, see the table below. In [[article:gathering|gathering]], experience cuts the strokes per piece, and in workshops and at slaughter it adds extra pieces. Experience together with tools: [[article:tools|Tools]]. Building: [[article:construction|Building, Upgrades and Repairs]].',
        },
        {
          p: "When you select one of your settlers you see his profession star. It appears once his best skill in the profession reaches {{star.step}}% and grows every {{star.step}}% up to {{star.full}}%. Carriers don't get one.",
        },
        {
          h: 'How much work it takes',
        },
        {
          table: {
            head: ['Work', 'Counted per', 'Multiplier', 'Times to {{exp.quotedPct}}%', 'Times to 100%'],
            rows: [
              [
                'Wood',
                'tree felled',
                '×{{exp.wood.points}}',
                '{{exp.wood.repeatsQuoted}}',
                '{{exp.wood.repeatsFull}}',
              ],
              [
                'Hunting',
                'piece taken from a carcass',
                '×{{exp.hunt.points}}',
                '{{exp.hunt.repeatsQuoted}}',
                '{{exp.hunt.repeatsFull}}',
              ],
              [
                'Fishing',
                'fish',
                '×{{exp.fish.points}}',
                '{{exp.fish.repeatsQuoted}}',
                '{{exp.fish.repeatsFull}}',
              ],
              [
                'Clay, quarrystone, iron, gold, mushrooms, herbs, wheat, slaughter, workshop',
                'piece, animal at slaughter, cycle in a workshop',
                '×{{exp.craft.points}}',
                '{{exp.craft.repeatsQuoted}}',
                '{{exp.craft.repeatsFull}}',
              ],
              [
                'Building, repairs',
                'hammer stroke on a building site',
                '×{{exp.build.points}}',
                '{{exp.build.repeatsQuoted}}',
                '{{exp.build.repeatsFull}}',
              ],
            ],
            num: [2, 3, 4],
            foot: 'The last columns count trees, pieces, cycles or strokes. From {{exp.quotedPct}}% a [[job:builder|Builder]] with no tool needs half as many strokes per piece of material. In the settler panel, on the Experience tab, each skill has its own row, e.g. Extraction - Iron: {{exp.craft.repeatsQuoted}} times, output +{{exp.quotedPct}}%.',
          },
        },
        {
          p: "Each tree, piece and cycle also counts toward the profession's general skill, e.g. Agriculture. A new profession opens through that general skill or through the skill of one good: Agriculture opens the [[job:miller|Miller]], and Extraction - Wood the [[job:joiner|Carpenter]]. The requirements are in [[article:trades|Professions and School]]. For a good with no skill of its own, the general skill counts. Experience stays through a change of profession.",
        },
        {
          h: 'Who gains nothing',
        },
        {
          list: [
            "[[job:carrier|Carriers]] build up Carrying. It doesn't speed up their work, but {{exp.carrierTrader}} deliveries open the [[job:trader|Merchant]].",
            'Merchants build up Trade for each piece unloaded, but Trade changes nothing.',
            '[[job:scout|Scouts]], [[job:woman|Women]] and children gain no experience.',
            'Planting, watering, the [[building:school|School]] and the [[building:barracks|Barracks]] give no experience.',
          ],
        },
      ],
      see: ['article:tools', 'article:trades', 'article:exp-combat', 'article:construction'],
    },
    {
      id: 'exp-combat',
      name: 'Combat Experience',
      lead: '{{combat.fightCapHits}} hits with one kind of weapon double your melee damage.',
      blocks: [
        {
          h: 'Melee damage',
        },
        {
          table: {
            head: ['Hits', 'Multiplier', 'A {{combat.sampleBlow}} blow becomes'],
            rows: [
              [0, '×1', '{{combat.sampleBlow}}'],
              [10, '×{{fight.factor.10}}', '{{fight.blow.10}}'],
              [25, '×{{fight.factor.25}}', '{{fight.blow.25}}'],
              [50, '×{{fight.factor.50}}', '{{fight.blow.50}}'],
              [75, '×{{fight.factor.75}}', '{{fight.blow.75}}'],
              ['{{combat.fightCapHits}}', '×{{combat.fightCapFactor}}', '{{combat.fightCapBlow}}'],
            ],
            num: [0, 1, 2],
            foot: 'The multiplier stops growing past {{combat.fightCapHits}} hits.',
          },
        },
        {
          p: 'The multiplier applies to melee blows against people, animals and buildings. It does not apply to [[article:walls|stockades]] and [[article:vehicles|vehicles]], or to arrows and the [[article:catapult|catapult]].',
        },
        {
          p: 'Without experience, bows and catapults hit with {{aim.basePct}}% of shots, and from {{aim.noSpreadHits}} hits every shot lands on target. Details: [[article:aim|Hitting and Shooting]].',
        },
        {
          h: 'What counts as a hit',
        },
        {
          p: "A hit is a blow or shot that dealt damage. It counts separately for each kind of weapon: Fist, Spear, Sword, Bow, Catapult. [[job:hunter|Hunter's]] shots count toward Bow too.",
        },
        {
          p: "In the settler panel these are the rows Fighting - Sword, Fighting - Bow and so on. Sword hits don't help a spearman, and they stay after a change of profession. Fighting doesn't raise a hero's damage, unless the mission turns it on.",
        },
        {
          h: 'Discovering weapons',
        },
        {
          table: {
            head: ['Weapon', 'Craftsman', 'Requirement'],
            rows: [
              ['[[good:spear_wooden|Wooden Spear]]', '[[job:armorer|Armourer]]', 'none'],
              [
                '[[good:spear_iron|Iron Spear]]',
                '[[job:smith|Blacksmith]]',
                'Forging: {{exp.ironSpearNeed}} times',
              ],
              ['[[good:sword_shord|Shortsword]]', '[[job:smith|Blacksmith]]', 'none'],
              [
                '[[good:sword_long|Longsword]]',
                '[[job:smith|Blacksmith]]',
                'Forging: {{exp.longSwordNeed}} times',
              ],
              ['[[good:bow_short|Short Bow]]', '[[job:armorer|Armourer]]', 'none'],
              [
                '[[good:bow_long|Longbow]]',
                '[[job:armorer|Armourer]]',
                'Arms Production: {{exp.longBowNeed}} times',
              ],
            ],
          },
        },
        {
          p: 'A soldier needs no hits to take a weapon: he takes any weapon from a store in reach and fights as a Swordsman, Spearman or Archer on the spot.',
        },
      ],
      see: [
        'article:damage',
        'article:aim',
        'article:heroes',
        'article:exp-work',
        'article:trades',
        'building:barracks',
      ],
    },
    {
      id: 'trades',
      name: 'Professions and School',
      lead: 'A discovered profession stays with the whole settlement, even if the settler who discovered it dies.',
      blocks: [
        {
          p: 'The lobby setting "Profession development: All unlocked from start" removes the requirements for civilian professions and products. Soldier profession requirements and map bans stay.',
        },
        {
          h: 'What opens a profession',
        },
        {
          data: 'jobs',
        },
        {
          p: 'A requirement with two skills counts their sum. [[job:builder|Builder]], Extractor, [[job:farmer|Farmer]], [[job:hunter|Hunter]], [[job:fisher|Fisherman]], [[job:carrier|Carrier]] and [[job:scout|Scout]] are open from the start.',
        },
        {
          p: 'Products are discovered the same way, e.g. [[good:furniture|Furniture]] needs Carpentry: {{exp.furnitureNeed}} times.',
        },
        {
          p: 'A settler who meets the requirement can take up the profession at once. Everyone else has to take a course at the [[building:school|School]] or earn the same requirement through work.',
        },
        {
          h: 'School and Barracks',
        },
        {
          table: {
            head: ['Trait', 'School', 'Barracks'],
            rows: [
              ['Places', '{{school.seats}}', '{{barracks.seats}}'],
              ['Teaches', 'a civilian profession or product', 'the Soldier profession'],
              ['Time', 'see table below', '{{barracks.drillSeconds}} s'],
              ['Who', 'adult man', 'adult man'],
              [
                'After the course',
                'new profession, waits at the School for a post',
                'unarmed Soldier, old profession stays known',
              ],
            ],
            foot: 'When the places are full, the next pupils wait at the door.',
          },
        },
        {
          list: [
            'A pupil who leaves to eat or sleep keeps his progress. Calling him off the course wipes it.',
            'A pupil sent to a School under construction brings materials and waits until it is built.',
            'A finished course is permanent, even after a change of profession.',
          ],
        },
        {
          h: 'Course length',
        },
        {
          table: {
            head: ['Courses', 'Time'],
            rows: [
              [
                '[[good:armor_leather|Leather Armour]], [[good:potion_food_small|S Nourishing Potion]], [[good:potion_stamina_small|S Stamina Potion]]',
                '{{course.shortSeconds}} s',
              ],
              ['professions and most products', '{{course.commonSeconds}} s'],
              ['[[good:potion_heal_big|L Healing Potion]]', '{{course.healSeconds}} s'],
              ['[[good:handcart|Handcart]]', '{{course.handcartSeconds}} s'],
              ['[[good:oxcart|Ox Cart]]', '{{course.oxcartSeconds}} s'],
              [
                '[[good:ship_small|Ship]], [[good:ship_big|Big Ship]], [[good:catapult|Catapult]]',
                '{{course.shipSeconds}} s',
              ],
            ],
            num: [1],
          },
        },
        {
          h: 'Profession and workplace',
        },
        {
          p: 'After "Change profession" a settler loses his workplace and won\'t get a new one on his own. The exception is graduates, once you switch on their toggle in the [[article:assistant|Assistant]].',
        },
        {
          table: {
            head: ['Profession', 'Building', 'Without a building'],
            rows: [
              ['[[job:builder|Builder]]', 'not needed', 'Goes to construction sites on his own.'],
              ['[[job:scout|Scout]]', 'not needed', 'Follows orders.'],
              ['[[job:trader|Merchant]]', 'not needed', 'Drives his own [[article:trade|route]].'],
              ['[[job:civilist|Civilian]]', 'not needed', 'Does not work, waits for a post.'],
              [
                '[[job:collector|Extractor]], [[job:hunter|Hunter]], [[job:fisher|Fisherman]]',
                'optional',
                'Works from a [[article:work-flag|work flag]] planted at his feet when he takes the profession.',
              ],
              ['[[job:farmer|Farmer]], [[job:herb_mush_guy|Herb Gatherer]]', 'required', 'Tends no field.'],
              ['[[job:carrier|Carrier]]', 'required', 'Carries nothing.'],
              ['Other civilian professions', 'required', 'Stands idle.'],
            ],
          },
        },
        {
          list: [
            'Right-click a building ("Work here") to change profession and get the workplace at once.',
            "A settler who doesn't meet the requirement for that profession takes a free Carrier post in the building, if there is one.",
            'A soldier only takes a post in his own profession.',
            '"Remove work place" and demolishing the building don\'t take the profession away.',
            'Women, children and heroes never get a profession.',
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
