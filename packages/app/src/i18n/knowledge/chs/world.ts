import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const WORLD: ArticleGroup = {
  group: '世界',
  items: [
    {
      id: 'goals',
      name: '任务目标与游戏结束',
      lead: '你一个成年男性都没有时就输了。英雄算数，妇女、希拉和儿童不算。',
      blocks: [
        {
          h: '地图怎么结束',
        },
        {
          table: {
            head: ['地图', '胜利', '失败'],
            rows: [
              ['多人地图，单人游玩也算', '地图目标，见下表', '没有成年男性，或任务宣布失败'],
              ['剧情任务', '任务宣布', '任务宣布，或没有成年男性'],
              ['无任务地图', '最后的幸存者', '没有成年男性'],
            ],
          },
        },
        {
          h: '多人地图目标',
        },
        {
          table: {
            head: ['目标', '计入范围', '结果'],
            rows: [
              ['物资', '建筑里的库存。地面堆垛、货舱和手上的物资不算', '全部达到要求数量时胜利'],
              ['“居民”', '玩家的所有人，包括儿童', '达到要求人数时胜利'],
              ['“士兵”', '士兵职业的成年男性，不含英雄', '达到要求人数时胜利'],
              ['任务宣布', '任务宣布玩家胜利或失败', '胜利或失败'],
              [
                '最后的幸存者',
                '至少一名玩家出局，其余玩家互相友好：[[article:diplomacy|外交]]',
                '其余玩家全部胜利',
              ],
            ],
            foot: '物资、“居民”和“士兵”的进度显示为当前/要求。只有地图没有物资或人数目标、任务也不宣布结果时，“最后的幸存者”才生效。',
          },
        },
        {
          list: [
            '游戏开始后的前{{match.graceSeconds}}秒内，没有男性不算失败。',
            '结果只判定一次，之后不再改变。赢了的玩家之后就算失去所有人，也不会输。',
            '一名玩家获胜，其他玩家继续游戏。',
          ],
        },
        {
          h: '战败者留下什么',
        },
        {
          p: '在多人地图上，战败者的建筑、载具和路标消失，他在陆地上的人变成野鸡，动物变为野生。在剧情任务和无任务地图中，只有载具消失，电脑停止行动。',
        },
      ],
      see: ['article:diplomacy', 'article:family', 'article:heroes'],
    },
    {
      id: 'vehicles',
      name: '载具与船只',
      lead: '没有指挥官，载具哪儿也去不了。船载人更多，大船载货更多。',
      blocks: [
        {
          p: '每种载具的货舱、乘客数、生命值和造价见其卡片：[[vehicle:handcart|手推车]]、[[vehicle:oxcart|牛车]]、[[vehicle:ship_small|船]]、[[vehicle:ship_big|大船]]、[[vehicle:catapult|投石机]]。哪座工坊造什么，见[[building:work_joinery_02|三级木匠坊]]和[[building:work_joinery_03|四级]]的卡片。',
        },
        {
          table: {
            head: ['载具', '谁能上'],
            rows: [
              [
                '[[good:handcart|手推车]]、[[good:oxcart|牛车]]',
                '[[job:carrier|搬运工]]、[[job:trader|商人]]',
              ],
              ['[[good:ship_small|船]]、[[good:ship_big|大船]]', '任何成人'],
              ['[[good:catapult|投石机]]', '士兵、英雄'],
            ],
          },
        },
        {
          list: [
            '卡片上的乘客数不含指挥官。第一个被分配的人成为指挥官，他离开后由下一名乘客接任。',
            '[[job:joiner|木匠]]在工坊旁的车场造载具，在岸边水面造船。',
            '上载具的人失去工作场所。只有有工作场所的搬运工和商人自己拉车，保留工作。',
            '指挥官和船上任何成年男性都会装货，但士兵、英雄、[[job:scout|侦察兵]]和[[job:druid|德鲁伊]]只在当指挥官时才装。没人装货时显示“无搬运工”。',
          ],
        },
        {
          h: '载重与速度',
        },
        {
          table: {
            head: ['载具', '道路：空载', '道路：满载'],
            rows: [
              ['[[good:handcart|手推车]]', '{{pace.cartRoad}}', '{{pace.handcartRoadFull}}'],
              ['[[good:oxcart|牛车]]', '{{pace.cartRoad}}', '{{pace.oxcartRoadFull}}'],
              ['[[good:catapult|投石机]]', '{{pace.catapultRoad}}', '-'],
            ],
            num: [1, 2],
            foot: '单位为格/秒。满载指手推车{{haul.handcart}}份、牛车{{haul.oxcart}}份。陆地上的速度见下表。路线选车见[[article:trade|贸易]]。',
          },
        },
        {
          h: '载货多少，慢多少',
        },
        {
          table: {
            head: ['装载', '手推车：减速', '手推车：陆地', '牛车：减速', '牛车：陆地'],
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
            foot: '装载指货舱占用的比例。减速随装载均匀增加：满载减速全部，半载减速一半。速度为普通陆地上的格/秒。',
          },
        },
        {
          list: [
            '这是有指挥官的车辆的速度。鞋子在这里没有影响。',
            '自己拉车的搬运工和商人按自己的步速走，穿鞋更快。载重让他们减速的比例相同：穿鞋的商人拉满载手推车在陆地上每步{{step.traderFullCart}}秒。',
            '[[good:catapult|投石机]]在陆地上的速度为{{pace.catapultLand}}格/秒。',
            '船装了货也不减速，约{{pace.ship}}格/秒。',
          ],
        },
        {
          h: '牛车用牛',
        },
        {
          p: '造好的牛车会等待役畜，牵走同一陆地上最近的成年[[good:cattle|牛]]。每座畜牧场给自己留下{{livestock.pair}}头成年牛，没有畜牧场的牛群也留下这么多，所以牛车只能牵走超出这个数的牛。',
        },
        {
          h: '船只',
        },
        {
          list: [
            '船能载1辆载具：手推车、牛车或投石机，前提是载具的乘员上得了船。大船不载载具。',
            '“靠岸”：指定岸边，船停在离它{{vehicle.mooringDistance}}格处。不需要港口。',
            '海上不能上下船。',
            'Ctrl/Cmd + 右键：靠岸并让乘员登陆。',
          ],
        },
        {
          h: '货舱',
        },
        {
          list: [
            '“目标”是你想让货舱里有多少份。目标总和不超过容量。',
            '“由搬运工”：搬运工拉车，每趟自己挑货。这时不能设目标。',
            '装货的人每次拿1份。先找车{{vehicle.cargoSearch}}格内的物资，再找路标覆盖的所有地方。',
            '物资必须和车或船在同一片陆地上。没人拿民居里的食物。',
            '调低目标时，多余的运到车{{vehicle.cargoSearch}}格内最近的有空位的仓库或大本营。没有就卸在地上。',
          ],
        },
        {
          h: '失去载具',
        },
        {
          table: {
            head: ['载具', '船上乘员', '载运的载具', '货物'],
            rows: [
              ['车辆、[[good:catapult|投石机]]', '在旁边下车', '-', '散落在周围{{vehicle.spill}}格内'],
              ['船已靠岸', '登岸', '停在岸上', '消失'],
              ['船在海上', '溺亡', '连同乘员沉没', '消失'],
            ],
            foot: '载具没毁时，谁也打不到里面的乘员。',
          },
        },
      ],
      see: ['article:hauling', 'article:trade', 'article:catapult', 'article:livestock', 'good:handcart'],
    },
    {
      id: 'diplomacy',
      name: '外交',
      lead: '立场是单向的：你对他们和他们对你是两项独立设置。',
      blocks: [
        {
          h: '立场的作用',
        },
        {
          table: {
            head: ['行为', '敌对', '中立', '友好'],
            rows: [
              ['攻击对方人员和建筑', '是', '否', '否'],
              ['[[job:scout|侦察兵]]收服对方的牛和绵羊', '是', '否', '否'],
              ['[[job:trader|商人]]在对方有报价的建筑交易', '否', '否', '是，需双方'],
              ['共享地图视野', '否', '否', '是，需双方'],
              ['“最后的幸存者”共同胜利', '否', '否', '是，需双方'],
            ],
            foot: '共享视野还需要在对局设置中打开“盟友共享地图”。',
          },
        },
        {
          h: '什么会改变立场',
        },
        {
          table: {
            head: ['事件', '结果'],
            rows: [
              ['地图开始', '地图设定立场，未设定的双方为中立'],
              ['有人攻击你', '你对他的立场自动变为敌对'],
              ['你对中立的电脑设为敌对', '电脑也转为敌对'],
              ['岛屿地图上中立的电脑', '自己转为对玩家敌对'],
              ['你调低对友好电脑的立场', '电脑也调低到你的水平'],
              ['敌对的电脑', '不会主动讲和'],
              ['任务', '可能改变立场，支付贡品后也可能'],
              ['“立场由剧本设定”', '无法在外交窗口更改'],
            ],
          },
        },
        {
          h: '和平时间',
        },
        {
          list: [
            '“和平时间”在开局前设置。受和平保护的玩家之间不能交战。',
            '不能派人到该玩家建筑{{peace.keepOut}}格内，也不能在那里建造，除非那里离你的建筑更近。',
            '结束前{{peace.noticeFirstMinutes}}分钟和{{peace.noticeLastMinutes}}分钟发出提醒。',
          ],
        },
        {
          h: '初次接触',
        },
        {
          p: '迷雾之下，你看见某民族的人、建筑、载具或木栅栏，或被其攻击后，它就出现在外交窗口里，之后一直留在那里。',
        },
        {
          h: '贡品',
        },
        {
          p: '只有任务会索要贡品。外交窗口的“支付”立即扣除物资，没人需要搬运，“最低库存”也挡不住。',
        },
        {
          p: '物资从[[building:headquarters|大本营]]、仓库和工坊扣除，工坊只扣自产产品。民居、箭塔、[[building:barracks|兵营]]、[[building:school|学校]]和地面堆垛不参与支付。',
        },
      ],
      see: ['article:trade', 'article:fog', 'article:walls'],
    },
    {
      id: 'fog',
      name: '迷雾与视野',
      lead: '侦察兵和大本营看得最远，{{vision.scout}}格。工地什么也看不见。',
      blocks: [
        {
          h: '地图模式',
        },
        {
          table: {
            head: ['设置', '开局', '视野外的地面'],
            rows: [
              ['已揭示', '全部可见', '无迷雾'],
              ['经典', '全黑地图', '探明后保持可见'],
              ['经典 + 战争迷雾', '全黑地图', '灰色地面，不显示人和动物'],
              ['侦察', '灰色地面，不显示人和动物', '探明后保持可见'],
              ['侦察 + 战争迷雾', '灰色地面，不显示人和动物', '灰色地面，不显示人和动物'],
            ],
          },
        },
        {
          p: '灰色地面上的建筑、物资、资源和载具保持你最后一次看见时的样子，人和动物不显示。',
        },
        {
          h: '视野范围',
        },
        {
          figure: {
            id: 'vision',
            caption: '视野范围',
          },
        },
        {
          table: {
            head: ['对象', '范围（格）'],
            rows: [
              ['[[job:scout|侦察兵]]、[[building:headquarters|大本营]]', '{{vision.scout}}'],
              ['英雄、[[good:ship_small|船]]、[[good:ship_big|大船]]', '{{vision.hero}}'],
              ['士兵、所有建筑', '{{vision.soldier}}'],
              ['[[good:handcart|手推车]]、[[good:oxcart|牛车]]、[[good:catapult|投石机]]', '{{vision.cart}}'],
              ['其余成人、你的动物', '{{vision.adult}}'],
              ['儿童', '{{vision.child}}'],
              ['工地', '0'],
            ],
            num: [1],
            foot: '木栅栏、道路和路标不揭开迷雾。士兵和[[job:hunter|猎人]]在迷雾中也能找到目标，[[good:catapult|投石机]]却只会自动打看得见的目标。',
          },
        },
      ],
      see: ['article:scout', 'article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'scout',
      name: '侦察兵',
      lead: '侦察兵没有工作场所，没有命令就什么也不做。',
      blocks: [
        {
          p: '他竖立[[article:roads|路标]]不花材料，从野生牛和绵羊身旁走过就能收服它们：[[article:livestock|畜牧]]。他不受路标限制，可以走遍全图。',
        },
        {
          h: '“探索”',
        },
        {
          list: [
            '从你指定的位置向外越探越远。',
            '他不离开自己所在的陆地。去别处要靠[[article:vehicles|船]]送。',
            '跳过沿海岸和地图边缘的窄条，零碎小块可能保持未探明。',
          ],
        },
        {
          h: '何时结束',
        },
        {
          table: {
            head: ['事件', '结果'],
            rows: [
              ['已没有可探索的地方', '通知“探索完毕”，侦察兵等待'],
              ['连续超过{{explore.maxFailedLegs}}次没能走到', '其余视为不可达，“探索完毕”'],
              ['新命令或更换职业', '探索结束'],
              ['按住Shift下令', '探索结束后执行'],
            ],
          },
        },
      ],
      see: ['article:roads', 'article:livestock', 'article:fog', 'job:scout'],
    },
    {
      id: 'wildlife',
      name: '野生动物与狩猎',
      lead: '攻击性兽群会扑向吃草处{{wild.aggro}}格内的人。最远追{{wild.giveUp}}格，然后返回。',
      blocks: [
        {
          p: '生命值、兽群大小以及能否驯服，见百科中该动物的卡片。',
        },
        {
          h: '攻击性',
        },
        {
          table: {
            head: ['类型', '动物', '行为'],
            rows: [
              ['攻击性', '狼、狮子、母狮、北极熊', '主动攻击'],
              [
                '受击后反击',
                '熊、大象',
                '最后一次受击后{{wild.angrySeconds}}秒内有危险。已开始的攻击持续到目标死亡或躲起来',
              ],
              ['胆小', '其余动物', '头领受击后逃开最多{{wild.flight}}格，兽群跟随'],
            ],
            foot: '野山羊既不攻击也不逃跑。',
          },
        },
        {
          list: ['你打一只动物时，{{wild.kinAlarm}}格内的同种动物也有反应。', '动物不攻击建筑和载具。'],
        },
        {
          h: '兽群增长',
        },
        {
          p: '大约每{{wild.breedingShare}}群里只有1群会增长。这样的兽群至少有2只、且少于动物卡片上“兽群”的数量时，每{{wild.growthMinutes}}分钟增加1只成年动物。',
        },
        {
          h: '猎人的猎物',
        },
        {
          list: [
            '猎场是工作旗帜或工作场所周围{{flag.hunter}}格。追击时猎人最多超出猎场{{wild.huntChase}}格。',
            '他先猎最弱的动物，哪怕很远。',
            '猎人一箭打掉动物{{wild.hunterShot}}点生命值，射程{{hunterBow.min}}-{{hunterBow.max}}格。',
            '他不会主动猎成年野山羊，但会猎它的幼崽。',
            '他不猎有主人的动物，也不猎其他陆地上的动物。',
            '动物卡片上“猎人：自动”是他自己会去猎的，“需下令”是只有你下令才会打的。',
          ],
        },
        {
          h: '猎物产出',
        },
        {
          p: '成年动物留下什么见其卡片。猎人猎到的幼崽只给一半，幼马只给1份[[good:leather|皮革]]。被其他人杀死的幼崽什么也不留。',
        },
      ],
      see: ['article:damage', 'article:gathering', 'article:livestock', 'job:hunter'],
    },
    {
      id: 'livestock',
      name: '畜牧',
      lead: '某种牲畜正好有{{livestock.pair}}头成年时，畜牧师才繁殖。多出第三头时，他先把它宰了。',
      blocks: [
        {
          figure: {
            id: 'livestock-cycle',
            caption: '畜牧循环',
          },
        },
        {
          h: '牲畜来源',
        },
        {
          table: {
            head: ['对象', '做法', '范围（格）'],
            rows: [
              [
                '[[job:scout|侦察兵]]',
                '经过时收服野生牛和绵羊，以及敌人的动物。稍远一些的会四散跑开',
                '收服{{livestock.captureRange}}，四散{{livestock.scatterRange}}',
              ],
              [
                '[[job:breeder|畜牧师]]',
                '把离得最近、不在畜牧场里的你的牲畜带进畜牧场。凑不够一对时，也会从你另一座畜牧场牵走多余的一头',
                '同一片陆地',
              ],
            ],
            foot: '站着不动的侦察兵收服不了动物。',
          },
        },
        {
          h: '幼崽与屠宰',
        },
        {
          table: {
            head: ['牲畜', '屠宰产出'],
            rows: [
              [
                '[[good:sheep|绵羊]]',
                '[[good:wool|羊毛]]{{livestock.sheepWool}}份，[[good:meat|肉]]{{livestock.sheepMeat}}份',
              ],
              [
                '[[good:cattle|牛]]',
                '[[good:leather|皮革]]{{livestock.cattleLeather}}份，[[good:meat|肉]]{{livestock.cattleMeat}}份',
              ],
            ],
            foot: '畜牧师的生产选择决定养哪种牲畜。幼崽的成本和用时，以及畜牧场能存多少物资，见[[building:work_animal_farm|畜牧场]]卡片。',
          },
        },
        {
          list: [
            '[[building:work_animal_farm|畜牧场]]总共容纳{{livestock.farmHerd}}头，含两种牲畜和待出生的幼崽。',
            '幼崽{{livestock.growMinutes}}分钟长大，长大前不算在一对里。',
          ],
        },
        {
          h: '畜牧场状态',
        },
        {
          table: {
            head: ['提示', '含义'],
            rows: [
              ['“没有动物”', '一头都没有，需要侦察兵'],
              ['“只有一只动物”', '需要第二头'],
              ['“幼崽正在长大”', '一对长大后恢复繁殖'],
              ['“畜群已满”', '畜牧师等待幼崽长大'],
            ],
          },
        },
      ],
      see: ['article:vehicles', 'article:wildlife', 'article:food', 'building:work_animal_farm'],
    },
    {
      id: 'religion',
      name: '信仰与神庙',
      lead: '信仰只在制造武器和护甲时下降。降到0%时，工匠不制造武器和护甲。',
      blocks: [
        {
          h: '每件消耗多少信仰',
        },
        {
          table: {
            head: ['职业', '{{piety.lowPct}}%', '{{piety.highPct}}%'],
            rows: [
              [
                '[[job:armorer|武器匠]]',
                '[[good:bow_short|短弓]]、[[good:spear_wooden|木矛]]',
                '[[good:bow_long|长弓]]',
              ],
              [
                '[[job:smith|铁匠]]',
                '[[good:spear_iron|铁矛]]、[[good:sword_shord|短剑]]',
                '[[good:sword_long|长剑]]、[[good:armor_chain|锁甲]]、[[good:armor_plate|板甲]]',
              ],
              ['[[job:sewer|裁缝]]', '[[good:armor_wool|布甲]]、[[good:armor_leather|皮甲]]', '-'],
            ],
            foot: '所有民族相同。这些职业的其他产品不消耗信仰。',
          },
        },
        {
          list: [
            '低于{{need.drivePct}}%时，武器匠、铁匠和裁缝自己去祈祷。无处可去时，到{{need.criticalPct}}%显示“想要祈祷”。',
            '已经开始的那件到0%也会做完。',
          ],
        },
        {
          h: '在哪里祈祷',
        },
        {
          table: {
            head: ['地点', '条件'],
            rows: [
              ['民居', '燃着圣火时。这时居民先在家里祈祷'],
              ['[[building:work_temple|神庙]]、[[building:headquarters|大本营]]', '已建成且属于你'],
            ],
            foot: '祈祷{{pray.seconds}}秒，信仰+{{pray.pct}}%。',
          },
        },
        {
          h: '圣火',
        },
        {
          p: '三级及以上民居可以点燃。1份[[good:holy_oil|油]]能烧{{oil.burnMinutes}}分钟，满油能烧{{oil.fullBurnMinutes}}分钟。没人祈祷时火也一直烧着。',
        },
        {
          h: '神庙光环',
        },
        {
          table: {
            head: ['项目', '数值'],
            rows: [
              ['范围', '{{aura.range}}格'],
              ['生命值', '每秒+{{aura.perSecond}}，上限{{aura.ceiling}}'],
              ['信仰', '信仰条不超过{{need.satedPct}}%时每秒+{{aura.pietyPct}}%'],
              ['对象', '你的所有人，儿童只加生命值'],
              ['条件', '神庙已建成且无损伤'],
              ['多座神庙', '光环不叠加'],
            ],
            foot: '超过{{health.human}}的生命值一直保留，直到被伤害扣除。',
          },
        },
      ],
      see: ['article:needs', 'article:health', 'building:work_temple', 'good:holy_oil'],
    },
    {
      id: 'chests',
      name: '箱子与文书',
      lead: '箱子里的文书能直接放下建筑，无需建造、材料和发现条件。',
      blocks: [
        {
          p: '箱子任何成人都能打开，魔法箱子只有[[job:druid|德鲁伊]]和英雄能打开。命令是“打开箱子”。居民要能走到箱子跟前。',
        },
        {
          h: '内容',
        },
        {
          table: {
            head: ['奖励', '箱子', '魔法箱子'],
            rows: [
              ['药水或护符', '{{chest.singleWooden}}', '{{chest.singleMagical}}'],
              ['大型药水，1种', '{{chest.bulkWooden}}', '{{chest.bulkMagical}}'],
              [
                '[[good:armor_chain|锁甲]]、[[good:armor_plate|板甲]]或[[good:shoes|鞋子]]',
                '{{chest.wearWooden}}',
                '{{chest.wearMagical}}',
              ],
              ['[[good:bread|食物]]', '{{chest.foodWooden}}', '{{chest.foodMagical}}'],
              ['[[good:catapult|投石机]]', '1', '1'],
              ['平民、妇女、长剑兵或长弓手', '{{chest.settlers}}', '{{chest.settlers}}'],
              [
                '狼或狮子。它们是野生的，一出来就攻击',
                '{{chest.wolves}}或{{chest.lions}}',
                '{{chest.wolves}}或{{chest.lions}}',
              ],
            ],
            num: [1, 2],
            foot: '每个箱子的内容由地图决定，不是随机的。',
          },
        },
        {
          h: '文书',
        },
        {
          table: {
            head: ['文书', '效果'],
            rows: [
              ['放置一座你选择的建筑', '建筑列表中任选一座，立即建成'],
              ['放置“名称”', '指定建筑，立即建成'],
              ['放置“名称”并装满库存', '指定建筑，库存全满'],
            ],
            foot: '文书用后消失，位置不合适时则保留。你的文书在建造窗口的“文书”下。',
          },
        },
        {
          h: '带工坊的文书',
        },
        {
          table: {
            head: ['带库存的建筑', '居民', '永久发现'],
            rows: [
              ['[[building:work_smithy_01|二级铁匠铺]]', '1名[[job:smith|铁匠]]', '[[good:sword_long|长剑]]'],
              [
                '[[building:work_armory_00|一级武器坊]]',
                '1名[[job:armorer|武器匠]]',
                '[[good:bow_short|短弓]]',
              ],
              ['[[building:work_coin_mint|铸币厂]]', '1名[[job:coin_maker|铸币师]]', '[[good:coin|金币]]'],
              ['[[building:work_druid_00|一级炼金小屋]]', '1名[[job:druid|德鲁伊]]', '[[good:holy_oil|油]]'],
              [
                '[[building:work_druid_01|二级炼金小屋]]',
                '1名[[job:druid|德鲁伊]]',
                '[[good:holy_oil|油]]、小型药水',
              ],
            ],
            foot: '这种箱子还会给一名该职业的居民，并解锁该职业。',
          },
        },
      ],
      see: ['article:construction', 'article:trades', 'article:draughts'],
    },
  ],
};
