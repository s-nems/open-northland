import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const PROBLEMS: ArticleGroup = {
  group: 'Problems',
  items: [
    {
      id: 'why',
      name: "Why Isn't It Working?",
      lead: 'Select the building or settler and read its status bar.',
      blocks: [
        {
          h: 'Messages',
        },
        {
          table: {
            filter: 'Search messages',
            head: ['Message', 'Level', 'Cause', 'What to do'],
            rows: [
              [
                '"Village attacked"',
                'Important',
                'A blow on a building or stockade, or within {{notice.settlementReach}} steps of one. Blows within {{notice.fightRadius}} steps of each other share one card, which clears after {{notice.fightQuietSeconds}} s with no blow',
                'Send soldiers',
              ],
              [
                '"Under attack"',
                'Notable',
                'A blow more than {{notice.settlementReach}} steps from the settlement',
                'Send soldiers or pull your people out',
              ],
              [
                '"No way through"',
                'Notable',
                'The resource is in the area, but no path reaches it',
                'Open a path or move the flag',
              ],
              [
                '"No commander"',
                'Notable',
                'A vehicle with no commander was ordered to move',
                'Assign a commander',
              ],
              [
                '"No trade"',
                'Notable',
                "The Merchant's destination needs both sides friendly",
                'Check [[article:diplomacy|Diplomacy]]',
              ],
              [
                '"No storage", "No store"',
                'Regular; workshop: Notable',
                'No store will take the good',
                'Build a store or free up space in one',
              ],
              [
                '"No free post"',
                'Notable',
                'The building has no free workplaces',
                'Free a post or build a second one of these',
              ],
              [
                '"No match"',
                'Regular',
                'After "Marry", nobody free was in reach. The order is lost',
                'Give the order again when someone is free',
              ],
              [
                '"Need a pair: [good]"',
                'Notable',
                'The [[article:livestock|Cattle Farm]] has only one animal',
                'Send a Scout for a second one',
              ],
              [
                '"No yard space"',
                'Notable',
                'No free ground next to the workshop for the vehicle',
                'Clear some space. The next try comes after {{notice.yardRetrySeconds}} s',
              ],
              [
                '"No fish"',
                'Notable',
                'No fish left within reach of the shore',
                'Put the flag on water with fish',
              ],
              [
                '"No carrier"',
                'Notable',
                'Nobody aboard can handle cargo',
                'Put a Carrier or another civilian aboard',
              ],
              [
                '"No route"',
                'Important',
                "The vehicle has no way to its destination. A ship's destination is not on this water",
                'Pick another destination',
              ],
              [
                '"Nothing in area"',
                'Notable',
                'The work area has none of this resource',
                'Move the work flag or extend your signposts',
              ],
              [
                '"No garrison"',
                '-',
                'The tower has no crew',
                'Assign archers: [[article:defence|Towers, Alarm and Shelter]]',
              ],
              [
                '"No resources"',
                'Notable',
                'Nothing left to gather on the whole map',
                'Change his profession',
              ],
              [
                '"No animals: [good]"',
                'Notable',
                'The [[article:livestock|Cattle Farm]] has none of this species',
                'Send a Scout to wild animals',
              ],
              [
                '"No animal"',
                'Notable',
                'The Ox Cart has no Ox',
                'Keep {{livestock.pairPlusOne}} adults: [[article:vehicles|Vehicles and Ships]]',
              ],
              [
                '"No prey"',
                'Notable',
                'No free game in the hunting ground',
                'Move the flag to where game grazes',
              ],
              [
                '"No [good]"',
                'Regular; workshop: Notable',
                'Builder: sites are waiting for a good that no store in their reach holds. Workshop: the stores have no input and nobody makes it',
                'Make it, import it or staff the workshop',
              ],
              [
                '"Site needs [good]"',
                'Important',
                "No store within the site's signpost reach holds the good",
                'Make it, import it or link a store with signposts',
              ],
              [
                '"Wants to pray"',
                'Notable',
                'Religion has dropped to {{need.criticalPct}}% and there is nowhere to pray',
                'Build a [[building:work_temple|Temple]] or light a holy fire',
              ],
              [
                '"Waiting for the workshop"',
                '-',
                'The workplace is still a construction site',
                'Finish the building',
              ],
              [
                '"Waiting for construction"',
                '-',
                'The School or Barracks is still a construction site',
                'Finish the building',
              ],
              ['"Waiting for a free place"', '-', 'All pupil places are taken', 'Wait or send him elsewhere'],
              [
                '"wild beasts"',
                '-',
                'The enemy on the attack card is wild animals',
                '[[article:wildlife|Wild Animals and Hunting]]',
              ],
              [
                '"Starving"',
                'Important',
                'Losing health from hunger',
                'Get food to a store in his reach, fast',
              ],
              ['"Hungry"', 'Regular', 'Needs food', 'Get food to a store in his reach'],
              [
                '"Land explored"',
                'Notable',
                'The Scout has uncovered all the land he can reach and is waiting',
                'Give him a new order: [[article:scout|Scout]]',
              ],
              [
                '"Store far away", "Store too far"',
                'Regular; workshop: Notable',
                'The stores that would take it are out of signpost reach',
                'Link them with signposts or build a store closer',
              ],
              [
                '"A mission holds this person to its task"',
                '-',
                'A map script controls this character',
                'Wait. He will not take orders',
              ],
              [
                '"Nothing to build"',
                'Regular',
                'The Builder has no site',
                'Place a building or change his profession',
              ],
              [
                '"Nothing to do"',
                'Regular',
                'A settler with a workplace has stood idle 10 s for no named reason. Does not apply to soldiers, settlers on Defence or Carriers with no flag',
                'Check the building or change his profession',
              ],
              [
                '"Flag is empty"',
                'Regular',
                'The Carrier has nothing to pick up at his flag',
                'Move the flag or take it away',
              ],
              [
                '"No way to ship"',
                'Notable',
                "The ship's door is on another landmass",
                'Moor at a shore he can reach',
              ],
              ['"Wrong trade"', 'Notable', 'Wrong profession for this building', 'Change his profession'],
              [
                '"Peace: no entry", "Peace: no site"',
                'Notable',
                "Peace is on and the order reaches into a partner's settlement",
                'Pick a spot further off: [[article:diplomacy|Diplomacy]]',
              ],
              [
                '"Cannot board"',
                'Notable',
                'The profession does not suit the vehicle, or the ship is at sea',
                'Moor at the shore or pick another vehicle',
              ],
              ['"Stuck aboard"', 'Notable', 'The ship is at sea', 'Moor at the shore'],
              [
                '"Nobody gathers [good]", "Nobody hunts for [good]", "Nobody catches [good]"',
                'Notable',
                'The workshop has stood {{notice.noGathererSeconds}} s with no input and nobody is getting it',
                'Assign a settler or switch this good on for those you have',
              ],
              [
                '"Ship refused"',
                'Notable',
                'The ship cannot carry this vehicle, or its place is taken',
                'Use a Ship or free the place: [[article:vehicles|Vehicles and Ships]]',
              ],
              [
                '"Stores full: [good]"',
                'Regular',
                "The maker's shelf and every store holding this good have been full for {{notice.storageFullSeconds}} s",
                'Build a store or use up the stock',
              ],
              ['"No room aboard"', 'Notable', 'All places are taken', 'Free a place or use another vehicle'],
              ['"Yard blocked"', 'Notable', 'Another vehicle is standing in the yard', 'Move it away'],
              [
                '"Work locked"',
                'Notable',
                'The profession or building is not yet open to your tribe, or the mission bans it',
                'Make the discovery: [[article:exp-work|Work Experience]]',
              ],
              [
                '"Standing to"',
                '-',
                'A soldier on Attack or Defence does not rest with a fight within {{alert.restClearance}} steps or a visible enemy soldier within {{alert.standTo}} steps. A wild animal only counts once fighting',
                'An "Eat" or "Sleep" order releases him',
              ],
              [
                '"Input too far"',
                'Notable',
                'Only buildings out of signpost reach hold the input',
                'Link them with signposts or build a store closer',
              ],
              [
                '"All set to 0"',
                'Regular',
                'All his counters are at 0',
                'Choose in the panel what he should do',
              ],
              ['"Dying"', 'Important', 'Close to death', 'Get him out of danger and give him food'],
              [
                '"No workplace"',
                'Notable',
                'He lost his workplace and has stood 10 s with neither one nor a flag. The building is gone or he was released. The profession stays',
                'Assign a workplace or change his profession',
              ],
              [
                '"Needs a restart"',
                'Important',
                'The changed setting only applies from a fresh start',
                '"Restart mission" in the Esc menu',
              ],
              [
                '"Product locked"',
                'Notable',
                'The chosen product is not available yet',
                'Choose another product',
              ],
              [
                '"Lacks experience"',
                'Notable',
                'Too little experience for this profession',
                'Send someone more experienced: [[article:exp-work|Work Experience]]',
              ],
              [
                '"Lost"',
                'Important',
                'No path to the destination, or the workplace, work flag or site is out of signpost reach. Stays put until you change something',
                '"Show the goal" points to the place. Place a [[article:roads|signpost]] or give another order',
              ],
              ['"Exhausted"', 'Regular', 'Needs sleep', 'Let him rest'],
              [
                '"Prey cut off"',
                'Notable',
                'The game is behind water or a wall',
                'Open a path or move the flag',
              ],
            ],
            foot: 'The "Notable and important" filter hides Regular, "Important only" hides Notable too. A new game starts on "All". Level "-" is a line on the panel with no notice.',
          },
        },
        {
          h: 'Work and Production',
        },
        {
          faq: [
            [
              'The workshop stands empty',
              'Status "No workers": nobody holds a workplace there. A settler enters only with the right profession and a free post, otherwise a message says "Wrong trade", "No free post" or "Lacks experience". Status "Idle" names the missing input. The worker fetches it himself if it lies within {{reach.goods}} steps of a signpost.',
            ],
            [
              "The Armourer, Blacksmith or Tailor won't work",
              'Religion under "Wellbeing" is at 0%. A batch of weapons or armour costs 15% or 30%, a prayer gives {{pray.pct}}%. "Wants to pray" means nowhere to pray: you need a [[building:work_temple|Temple]], [[building:headquarters|Headquarters]] or a holy fire in the dwelling. Tailors do not pray on their own, so give the "Pray" order.',
            ],
            [
              "Carriers aren't carrying",
              'A Carrier only carries with a workplace in a building. Status "Nothing to carry in reach": no goods to take within {{flag.radius}} steps of the building, or of the work flag if he has one. "No destination accepts this good" means the stores are full.',
            ],
            [
              'Breeding has stopped',
              'The Stock Farmer breeds at exactly {{livestock.pair}} adults of a species. The Cattle Farm status says "No animals", "Only one animal", "Young growing up" or "Herd full": [[article:livestock|Livestock]].',
            ],
            [
              'The Hunter brings nothing back',
              'Status "No free prey in the hunting ground": no game within {{flag.hunter}} steps of the work flag or workplace. He does not hunt Wolf, Lion, Bear, Elephant, Dog or Chicken. Move the work flag to where game grazes.',
            ],
          ],
        },
        {
          h: 'People',
        },
        {
          faq: [
            [
              'No children are being born',
              'A couple needs a shared dwelling and {{family.childFood}} pieces of food in the larder. Messages: "Husband away" (the husband is a Merchant, Scout, soldier or hero), "No dwelling", "Dwelling unbuilt", "Living apart", "No food stock". The "Births" counter in the Assistant places orders. More: [[article:family|Family and Home]].',
            ],
            [
              'Hungry with a full store',
              'Check "Storage minimum": nobody takes a good below that total, not even for a meal. Lower the minimum on food. The other cause is distance: the store must be within the settler\'s walking reach, {{reach.walk}} steps or the signpost network.',
            ],
            [
              'A profession is missing from the School list',
              'The list shows only courses that are discovered and allowed in this mission. A row you can\'t pick gives the reason: "Already learned" or "These settlers cannot train at this school". [[article:exp-work|Work Experience]] discovers courses.',
            ],
          ],
        },
        {
          h: 'Building and Fields',
        },
        {
          faq: [
            [
              'A building is locked',
              'In the build window it lands in the "Locked" section. The "Required discoveries:" tooltip lists professions and goods, with experience for a good shown as current/required. "Unavailable in this mission" is a map ban. A paper from a chest places the building even undiscovered: [[article:chests|Chests and Papers]].',
            ],
            [
              'Construction has stopped',
              'The site status says what\'s missing: "materials missing", "delivery on the way" or "no builder". The message "Site needs [good]" means no store within the site\'s signpost reach holds it, {{reach.goods}} steps from a signpost. Builders carry their own materials.',
            ],
            [
              "A field isn't growing",
              'It grows only when watered by a [[job:farmer|Farmer]] with a workplace at a [[building:work_farm_00|Farm]]. The Farmer sows first and waters only at {{field.max}} fields or when there is nowhere left to sow. A field ripens after {{field.waterings}} waterings, and one watering also covers 6 neighbouring fields. Sowing works only on grass, off roads, within {{field.radius}} steps of the Farm.',
            ],
          ],
        },
        {
          h: 'Army and Vehicles',
        },
        {
          faq: [
            [
              "A soldier won't attack",
              'Check his stance: [[article:stances|Stances]]. On Ignorant he stays put and strikes only within weapon reach. Attack and orders work only against a tribe you hold as "Hostile", and only outside "Peace time".',
            ],
            [
              "A ship won't sail",
              'Status "Waiting for a commander": assign one, any adult will do. "Waiting for its crew": someone assigned is still walking to the door, and a settler from another landmass drops out of the crew. The message "No route" means the destination is not on this water. A ship picks nobody up at sea, so "Moor" first.',
            ],
            [
              "An Ox Cart won't move",
              'Status "Waiting for its draught animal". The cart takes an [[good:cattle|Ox]] from your herd on the same landmass, but every Cattle Farm keeps {{livestock.pair}} adults. You need {{livestock.pairPlusOne}} adults at one Cattle Farm or {{livestock.pairPlusOne}} outside any farm. Only then can you assign a commander.',
            ],
          ],
        },
        {
          h: 'Weather',
        },
        {
          faq: [
            [
              'Do rain, snow or night change anything?',
              'No. Weather, the "Winter" setting and time of day are picture and sound only. People, work, fields and combat run the same. Only map terrain slows walking: sand, mountains and snow that lies on the map from the start.',
            ],
          ],
        },
      ],
      see: ['article:walking', 'article:hauling', 'article:stances', 'article:religion', 'article:livestock'],
    },
  ],
};
