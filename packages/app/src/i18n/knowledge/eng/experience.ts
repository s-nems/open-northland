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
          p: 'The table shows ordinary work. Wood, hunting, fishing and building count differently, and their multiplier is in the table below. In [[article:gathering|gathering]], experience means fewer strokes per piece. In workshops and at slaughter it adds extra pieces. Tables with tools: [[article:tools|Tools]]. Building: [[article:construction|Building, Upgrades and Repairs]].',
        },
        {
          p: "A selected settler of yours wears a profession star. It appears at {{star.step}}% in the profession's best skill and grows every {{star.step}}%, up to {{star.full}}%. Carriers don't get one.",
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
                'stroke that added something',
                '×{{exp.build.points}}',
                '{{exp.build.repeatsQuoted}}',
                '{{exp.build.repeatsFull}}',
              ],
            ],
            num: [2, 3, 4],
            foot: 'The last columns count trees, pieces, cycles or strokes. From {{exp.quotedPct}}% a [[job:builder|Builder]] with no tool needs half as many strokes per piece of material. In the settler panel, under Experience, each skill has its own row, e.g. Extraction - Iron: {{exp.craft.repeatsQuoted}} times, output +{{exp.quotedPct}}%.',
          },
        },
        {
          p: "Each tree, piece and cycle also counts toward the profession's general skill, e.g. Agriculture. A profession opens through the general skill or through the skill of one good: Agriculture opens the [[job:miller|Miller]], and Extraction - Wood the [[job:joiner|Carpenter]]. Requirements: [[article:trades|Professions and School]]. The general skill also applies to a good with no skill of its own. Experience stays through a change of profession.",
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
          p: 'Bow and catapult: {{aim.basePct}}% of shots are accurate at 0 hits, and from {{aim.noSpreadHits}} hits every shot lands on target. Table: [[article:aim|Hitting and Shooting]].',
        },
        {
          h: 'What counts as a hit',
        },
        {
          p: "A hit is a blow or shot that dealt damage. It counts separately for each kind of weapon: Fist, Spear, Sword, Bow, Catapult. The [[job:hunter|Hunter's]] bow is a Bow too. A shot that hits several targets counts once.",
        },
        {
          p: "In the settler panel these are the rows Fighting - Sword, Fighting - Bow and so on. Sword hits don't help a spearman, and they stay after a change of profession. Fighting doesn't raise a hero's damage, unless the mission allows it.",
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
          p: 'A soldier needs no hits to take a weapon: he takes any weapon from a store in reach and fights as a Swordsman, Spearman or Archer on the spot. The {{exp.classLowNeed}} or {{exp.classHighNeed}} hit threshold only discovers that kind of soldier for the settlement and opens it in "Change profession": [[article:trades|Professions and School]].',
        },
        {
          h: 'The star',
        },
        {
          p: 'A soldier wears a star from {{star.step}} hits with the weapon he fights with. It grows every {{star.step}} hits and is biggest at {{star.full}}. You can see it on every soldier, enemies included.',
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
          h: 'How a discovery happens',
        },
        {
          steps: [
            'A settler works, e.g. an [[job:collector|Extractor]] fells trees.',
            'After {{exp.joinerNeed}} trees he meets the [[job:joiner|Carpenter]] requirement and the game announces the discovery.',
            'The profession is discovered for the whole settlement, and this settler can take it up at once.',
            'Everyone else goes to the [[building:school|School]] or earns the same requirement through work.',
          ],
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
            foot: 'When the places are full, pupils wait at the door in order of enrolment.',
          },
        },
        {
          list: [
            'Needs interrupt a course without losing progress. Cancelling wipes it.',
            'A pupil sent to a School under construction brings materials and waits.',
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
          p: '"Change profession" clears the workplace and nobody assigns a new one on their own. The exception is graduates, once you switch on their toggle in the [[article:assistant|Assistant]].',
        },
        {
          table: {
            head: ['Profession', 'Building', 'Without a building'],
            rows: [
              ['[[job:builder|Builder]]', 'not needed', 'Goes to construction sites on his own.'],
              ['[[job:scout|Scout]]', 'not needed', 'Works on orders.'],
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
            "A settler who lacks the requirement for the building's profession takes a free Carrier post there, if there is one.",
            'A soldier only takes a post in his own profession.',
            '"Remove work place" keeps the profession and whatever he is carrying. It takes away the production counters and the Carrier\'s handcart.',
            'Demolishing the building keeps the profession too.',
            'Women, children and heroes never get a profession.',
          ],
        },
        {
          h: 'What changing profession costs',
        },
        {
          table: {
            head: ['Item', 'What happens'],
            rows: [
              ['Workplace and production counters', 'Lost.'],
              ['Carried goods', 'Dropped on the ground.'],
              ['Tool', 'Kept. On joining the army a new tool drops to the ground, a used one is lost.'],
              ['Weapon and armour', 'On leaving the army they go to his hands or the ground.'],
              [
                'Orders',
                'The current order and the queue are lost. "Eating and sleeping" returns to "Allowed".',
              ],
              ['Known professions', 'Kept, including the previous one. Experience too.'],
            ],
            foot: 'The School and Barracks change profession the same way, but the order queue stays. A Carrier leaves his handcart behind.',
          },
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
