import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const WORLD: ArticleGroup = {
  group: '世界',
  items: [
    {
      id: 'goals',
      name: '任务目标与游戏结束',
      lead: '玩家没有一名在世的成年男性时出局。成年男性和英雄算数，妇女和希拉不算，儿童也不算。',
      blocks: [
        {
          h: '由什么决定',
        },
        {
          table: {
            head: ['地图', '胜利', '失败'],
            rows: [
              ['多人地图，单人游玩也算', '地图列表中的目标', '没有成年男性；脚本的失败目标'],
              ['剧情任务', '地图脚本', '地图脚本；没有成年男性'],
              ['无脚本地图', '最后的幸存者', '没有成年男性'],
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
              ['物资', '建筑货架上的库存。地面堆垛、货舱和手上的物资不算', '清单全部达标时胜利'],
              ['“居民”', '玩家的所有人，包括儿童', '达到要求人数时胜利'],
              ['“士兵”', '士兵职业的成年男性，不含英雄', '达到要求人数时胜利'],
              ['脚本胜利', '任务事件指定玩家', '胜利'],
              ['脚本失败', '任务事件指定玩家', '失败'],
              [
                '最后的幸存者',
                '至少一名对手出局，其余玩家互为友好：[[article:diplomacy|外交]]',
                '其余玩家全部胜利',
              ],
            ],
            foot: '物资、“居民”和“士兵”的进度显示为当前/要求。只有地图没有物资、人数或脚本结果目标时，“最后的幸存者”才生效。',
          },
        },
        {
          list: [
            '先检查是否没有男性，再按地图顺序检查目标列表。',
            '第一个达成的条件决定该玩家的结局，不再改变。胜者之后失去所有人，仍是胜者。',
            '一名玩家获胜，其他玩家继续游戏。',
            '地图可以让指定玩家不受成年男性规则约束。',
          ],
        },
        {
          h: '战败者的结局',
        },
        {
          steps: [
            '没有成年男性：载具立即消失。',
            '下一次目标检查时判定失败。',
            '再下一次检查时，建筑、人员、载具和路标消失。',
            '玩家的动物原地变为野生。',
          ],
        },
        {
          p: '以上适用于多人地图。在剧情任务和无脚本地图中，只有载具消失，电脑停止行动，建筑和人员留下。',
        },
      ],
      see: ['article:diplomacy', 'article:family', 'article:heroes'],
    },
    {
      id: 'vehicles',
      name: '载具与船只',
      lead: '没有指挥官的载具不动。船载{{vehicle.shipSeats}}人，大船载{{vehicle.bigShipSeats}}人，都含指挥官。',
      blocks: [
        {
          data: 'vehicles',
        },
        {
          table: {
            head: ['载具', '谁能上', '含指挥官的座位'],
            rows: [
              [
                '[[good:handcart|手推车]]、[[good:oxcart|牛车]]',
                '[[job:carrier|搬运工]]、[[job:trader|商人]]',
                '1',
              ],
              ['[[good:ship_small|船]]', '任何成人', '{{vehicle.shipSeats}}'],
              ['[[good:ship_big|大船]]', '任何成人', '{{vehicle.bigShipSeats}}'],
              ['[[good:catapult|投石机]]', '士兵、英雄', '1'],
            ],
            num: [2],
          },
        },
        {
          list: [
            '第一个被分配的人成为指挥官。他离开后由下一名乘客接任。',
            '上载具的人失去工作场所。有工作场所的搬运工和商人把空闲车辆当工具，工作场所保留。',
            '货舱由指挥官或船上的搬运工操作。两者都没有时显示“无搬运工”。',
          ],
        },
        {
          h: '载重与速度',
        },
        {
          table: {
            head: ['载具', '满载减速', '道路：空载', '道路：满载', '陆地：空载', '陆地：满载'],
            rows: [
              [
                '[[good:handcart|手推车]]',
                '{{vehicle.handcartLossPct}}%',
                '{{pace.cartRoad}}',
                '{{pace.handcartRoadFull}}',
                '{{pace.cartLand}}',
                '{{pace.handcartLandFull}}',
              ],
              [
                '[[good:oxcart|牛车]]',
                '{{vehicle.oxcartLossPct}}%',
                '{{pace.cartRoad}}',
                '{{pace.oxcartRoadFull}}',
                '{{pace.cartLand}}',
                '{{pace.oxcartLandFull}}',
              ],
              ['[[good:catapult|投石机]]', '-', '{{pace.catapultRoad}}', '-', '{{pace.catapultLand}}', '-'],
            ],
            num: [1, 2, 3, 4, 5],
            foot: '单位为步/秒。满载指手推车{{haul.handcart}}/{{haul.handcart}}、牛车{{haul.oxcart}}/{{haul.oxcart}}。按赤脚车夫计算，穿鞋更快。船不受载重影响，约{{pace.ship}}步/秒。拉车的搬运工步速也按相同比例下降。路线选车见[[article:trade|贸易]]。',
          },
        },
        {
          h: '建造',
        },
        {
          table: {
            head: ['载具', '工坊', '成本'],
            rows: [
              [
                '[[good:handcart|手推车]]',
                '[[building:work_joinery_02|三级木匠坊]]、4级',
                '[[good:wood|木材]]{{cost.handcartWood}}份',
              ],
              [
                '[[good:oxcart|牛车]]',
                '[[building:work_joinery_02|三级木匠坊]]、4级',
                '[[good:wood|木材]]{{cost.oxcartWood}}份',
              ],
              [
                '[[good:ship_small|船]]',
                '[[building:work_joinery_03|四级木匠坊]]',
                '[[good:wood|木材]]{{cost.shipWood}}份，[[good:leather|皮革]]{{cost.shipLeather}}份',
              ],
              [
                '[[good:ship_big|大船]]',
                '[[building:work_joinery_03|四级木匠坊]]',
                '[[good:wood|木材]]{{cost.bigShipWood}}份，[[good:leather|皮革]]{{cost.bigShipLeather}}份',
              ],
              [
                '[[good:catapult|投石机]]',
                '[[building:work_joinery_03|四级木匠坊]]',
                '[[good:wood|木材]]{{catapult.wood}}份，[[good:iron|铁矿]]{{catapult.iron}}份',
              ],
            ],
            foot: '[[job:joiner|木匠]]在工坊旁的车场造载具，在岸边水面造船。',
          },
        },
        {
          h: '牛车用牛',
        },
        {
          steps: [
            '造好的牛车状态为“等待役畜”。',
            '它牵走同一陆地上玩家最近的空闲成年[[good:cattle|牛]]，畜牧场里面的不算。',
            '每座畜牧场保留最先的{{livestock.pair}}头成年牲畜。没有畜牧场的牛同样保留{{livestock.pair}}头。',
            '牛走到车旁后消失，牛车这才能动。',
          ],
        },
        {
          h: '船只',
        },
        {
          list: [
            '货舱由所有物资共用。',
            '船载1辆载具：手推车、牛车或投石机。载具的乘员必须也上得了船。大船不载载具。',
            '“靠岸”需要指定岸边。船停在离指定位置{{vehicle.mooringDistance}}步处，不需要港口建筑。',
            '海上不能上下船。',
            'Ctrl/Cmd + 单击：靠岸并让乘员登陆。',
          ],
        },
        {
          h: '货舱',
        },
        {
          list: [
            '“目标”：货舱要装多少份。目标总和不超过容量。',
            '“由搬运工”：有工作场所的搬运工拉车，车上装的是他每趟搬起的货物。目标被锁定。',
            '车辆停下或船靠岸时，指挥官或搬运工下来干活。海上没人干活。',
            '每次拿1份：堆垛、{{vehicle.cargoSearch}}步内的建筑，然后更远处。',
            '来源必须在船门所在的陆地上。不拿民居里的食物。',
            '目标为0或低于现有数量：多余的运到{{vehicle.cargoSearch}}步内最近的有空位的仓库或大本营。没有就卸在地上。',
            '船上没有搬运工时，指挥官在物资无处可取时调低目标。有搬运工时目标不变。',
            '移动命令会在出发前召回乘员。',
          ],
        },
        {
          h: '失去载具',
        },
        {
          table: {
            head: ['状态', '船上乘员', '载运的载具', '货物'],
            rows: [
              ['车辆、[[good:catapult|投石机]]', '在门口下车', '-', '散落在{{vehicle.spill}}步内'],
              ['船已靠岸', '登岸', '停在门口', '消失'],
              ['船在海上', '溺亡', '连同乘员沉没', '消失'],
            ],
            foot: '船体未毁时，船上的乘员不会被打中。不在船上的乘员只是失去分配。',
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
              ['最后的幸存者共同胜利', '否', '否', '是，需双方'],
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
              ['受到外方攻击', '受害者对攻击者转为敌对'],
              ['中立的电脑，你对它敌对', '电脑转为敌对'],
              ['你调低对友好电脑的立场', '电脑也调低到你的水平'],
              ['敌对的电脑', '不会自行恢复和平'],
              ['支付贡品、任务事件', '可能改变对方立场'],
              ['“立场由剧本设定”', '无法在外交窗口更改'],
            ],
          },
        },
        {
          h: '和平时间',
        },
        {
          list: [
            '受和平保护的玩家之间不能交战。',
            '不能进入或在对方建筑{{peace.keepOut}}步内建造，除非离你自己的建筑更近。',
            '结束前{{peace.noticeFirstMinutes}}分钟和{{peace.noticeLastMinutes}}分钟发出提醒。',
          ],
        },
        {
          h: '初次接触',
        },
        {
          p: '迷雾之下，你看见某民族的人员、建筑、载具或木栅栏，或被其攻击后，它就进入外交窗口。接触不会失效。',
        },
        {
          h: '贡品',
        },
        {
          p: '贡品只能由地图脚本发起。外交窗口的“支付”立即扣除物资，无需搬运。扣除来源顺序：',
        },
        {
          steps: [
            '第一座[[building:headquarters|大本营]]。',
            '其他大本营和仓库。',
            '工坊，只扣自产产品，不扣原料。',
          ],
        },
        {
          list: [
            '民居、箭塔、[[building:barracks|兵营]]、[[building:school|学校]]和地面堆垛不参与支付。',
            '要求食物时，同类的任何食物都行。',
            '“最低库存”挡不住贡品扣除。',
          ],
        },
      ],
      see: ['article:trade', 'article:fog', 'article:walls'],
    },
    {
      id: 'fog',
      name: '迷雾与视野',
      lead: '你只能看见己方人员和建筑视野内的东西。',
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
              ['经典 + 战争迷雾', '全黑地图', '灰色地面，不显示单位'],
              ['侦察', '灰色地面，不显示单位', '探明后保持可见'],
              ['侦察 + 战争迷雾', '灰色地面，不显示单位', '灰色地面，不显示单位'],
            ],
          },
        },
        {
          p: '灰色地面按最后一次看见的状态显示建筑、木栅栏、载具、箱子、资源、树干和物资堆垛，不显示人和动物。这份记忆也保存在小地图和存档中。',
        },
        {
          h: '视野范围',
        },
        {
          figure: {
            id: 'vision',
            caption: '各单位的视野',
          },
        },
        {
          table: {
            head: ['对象', '范围（步）'],
            rows: [
              ['[[job:scout|侦察兵]]、[[building:headquarters|大本营]]', '{{vision.scout}}'],
              ['英雄、[[good:ship_small|船]]、[[good:ship_big|大船]]', '{{vision.hero}}'],
              ['士兵、建筑，包括箭塔和民居', '{{vision.soldier}}'],
              ['[[good:handcart|手推车]]、[[good:oxcart|牛车]]、[[good:catapult|投石机]]', '{{vision.cart}}'],
              ['成年平民、妇女、自家动物', '{{vision.adult}}'],
              ['儿童', '{{vision.child}}'],
              ['工地', '0'],
            ],
            num: [1],
            foot: '步数按横向计算。木栅栏、道路和路标没有视野。',
          },
        },
        {
          h: '迷雾中的战斗',
        },
        {
          p: '士兵在迷雾中也会攻击，[[good:catapult|投石机]]不会自行攻击。[[job:hunter|猎人]]狩猎不受迷雾影响。',
        },
      ],
      see: ['article:scout', 'article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'scout',
      name: '侦察兵',
      lead: '侦察兵没有工作场所。没有命令时站着等待。',
      blocks: [
        {
          h: '能做什么',
        },
        {
          table: {
            head: ['任务', '方式', '详情'],
            rows: [
              ['路标', '“放置路标”命令，不花材料', '[[article:roads|道路与路标]]'],
              ['探索陆地', '“探索”命令', '见下'],
              ['动物', '从野生牛和绵羊身旁走过即可收服', '[[article:livestock|畜牧]]'],
              ['视野', '{{vision.scout}}步，人员中最远', '[[article:fog|迷雾与视野]]'],
            ],
            foot: '不受路标范围限制，可走遍全图。',
          },
        },
        {
          h: '“探索”',
        },
        {
          list: [
            '只对侦察兵有效，可同时选中多名。',
            '从下令位置一圈圈向外走，总是去最近的未探明陆地。',
            '留在同一片陆地上。只有[[article:vehicles|船]]能把他送到别处。',
            '跳过沿海岸和地图边缘的窄条，零碎小块会保持未探明。',
            '途中照常吃饭睡觉，然后从所在位置继续。',
          ],
        },
        {
          h: '何时结束',
        },
        {
          table: {
            head: ['事件', '结果'],
            rows: [
              ['没有可探明的陆地', '通知“探索完毕”，侦察兵等待'],
              ['连续{{explore.maxFailedLegs}}个以上目标失败', '其余视为不可达，“探索完毕”'],
              ['地图模式“已揭示”', '立即“探索完毕”'],
              ['新命令', '探索作废'],
              ['按住Shift下令', '排到探索结束后'],
              ['更换职业', '探索作废'],
            ],
          },
        },
      ],
      see: ['article:roads', 'article:livestock', 'article:fog', 'job:scout'],
    },
    {
      id: 'wildlife',
      name: '野生动物与狩猎',
      lead: '攻击性兽群会扑向其所在地{{wild.aggro}}步内的人，超出{{wild.giveUp}}步后返回。',
      blocks: [
        {
          data: 'animals',
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
                '受击后激怒',
                '熊、大象',
                '愤怒持续到最后一次受击后{{wild.angrySeconds}}秒，已开始的攻击持续到目标死亡或避难',
              ],
              ['胆小', '其余动物', '头领受击后逃开{{wild.flight}}步，兽群跟随'],
            ],
            foot: '野山羊既不攻击也不逃跑。',
          },
        },
        {
          list: ['攻击会惊动受击者{{wild.kinAlarm}}步内的同种动物。', '动物不攻击建筑和载具。'],
        },
        {
          h: '兽群增长',
        },
        {
          p: '数量大于1且小于“兽群”列的野生兽群，每{{wild.growthMinutes}}分钟增加1只成年动物，但大约每5群只有1群会增长。',
        },
        {
          h: '猎人的猎物',
        },
        {
          list: [
            '猎场是工作旗帜或工作场所周围{{flag.hunter}}步。追击可超出猎场{{wild.huntChase}}步。',
            '优先选择又近又弱的动物。',
            '一次只猎1只，收完猎物才找下一只。',
            '猎人的弓每箭造成{{wild.hunterShot}}，射程{{hunterBow.min}}-{{hunterBow.max}}步。',
            '不会主动猎成年野山羊，其幼崽可猎。',
            '跳过有主人的动物、被激怒的动物和其他陆地上的动物。',
          ],
        },
        {
          h: '猎物产出',
        },
        {
          table: {
            head: ['动物', '猎人杀死', '其他人杀死'],
            rows: [
              ['成年', '2份[[good:leather|皮革]]，2份[[good:meat|肉]]', '1份[[good:meat|肉]]'],
              ['幼崽', '1份[[good:leather|皮革]]，1份[[good:meat|肉]]', '无'],
              ['成年马', '1份[[good:leather|皮革]]，1份[[good:meat|肉]]', '1份[[good:meat|肉]]'],
              ['幼马', '1份[[good:leather|皮革]]', '无'],
            ],
          },
        },
      ],
      see: ['article:damage', 'article:gathering', 'article:livestock', 'job:hunter'],
    },
    {
      id: 'livestock',
      name: '畜牧',
      lead: '某种牲畜的成年数量正好是{{livestock.pair}}头时，畜牧师才繁殖。第三头成年牲畜送去屠宰。',
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
            head: ['对象', '做法', '范围（步）'],
            rows: [
              [
                '[[job:scout|侦察兵]]',
                '每走一步都收服野生牛和绵羊，以及你持敌对立场的玩家的畜群。附近其余敌方畜群四散',
                '{{livestock.captureRange}}，四散{{livestock.scatterRange}}',
              ],
              ['[[job:breeder|畜牧师]]', '把最近的未入场牲畜带进畜牧场', '同一片陆地'],
              ['[[job:breeder|畜牧师]]', '不足一对时，从你另一座超过一对的畜牧场牵一头', '同一片陆地'],
            ],
            foot: '站着不动的侦察兵收服不了动物。',
          },
        },
        {
          h: '幼崽与屠宰',
        },
        {
          table: {
            head: ['牲畜', '幼崽成本', '屠宰产出'],
            rows: [
              [
                '[[good:sheep|绵羊]]',
                '[[good:water|水]]{{livestock.calfWater}}份，[[good:wheat|小麦]]{{livestock.calfWheat}}份',
                '[[good:wool|羊毛]]{{livestock.sheepWool}}份，[[good:meat|肉]]{{livestock.sheepMeat}}份',
              ],
              [
                '[[good:cattle|牛]]',
                '[[good:water|水]]{{livestock.calfWater}}份，[[good:wheat|小麦]]{{livestock.calfWheat}}份',
                '[[good:leather|皮革]]{{livestock.cattleLeather}}份，[[good:meat|肉]]{{livestock.cattleMeat}}份',
              ],
            ],
            foot: '繁殖和屠宰各需8秒。畜牧师的生产选择决定养哪种牲畜。畜牧场肉、羊毛和皮革各存{{livestock.farmShelf}}份。',
          },
        },
        {
          list: [
            '[[building:work_animal_farm|畜牧场]]总共容纳{{livestock.farmHerd}}头，含两种牲畜和待出生的幼崽。',
            '幼崽{{livestock.growSeconds}}秒（{{livestock.growMinutes}}分钟）长大，不计入一对。',
            '出生时亲代必须在畜牧场门口{{livestock.birthRange}}步内。否则原料白费，没有幼崽。',
            '畜牧场人手：[[job:breeder|畜牧师]]{{livestock.breeders}}名，[[job:carrier|搬运工]]{{livestock.carriers}}名。',
          ],
        },
        {
          h: '畜牧场状态',
        },
        {
          table: {
            head: ['提示', '含义'],
            rows: [
              ['“没有动物”', '该种牲畜为零，需要侦察兵'],
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
      lead: '信仰只在生产武器和护甲时下降。降到0%时，工匠不会开工消耗信仰的批次。',
      blocks: [
        {
          h: '每批消耗',
        },
        {
          table: {
            head: ['职业', '15%', '30%'],
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
            foot: '所有民族相同。这些职业的其他物资不消耗信仰。',
          },
        },
        {
          list: [
            '低于{{need.drivePct}}%时，武器匠和铁匠去祈祷。没有祈祷场所时，到{{need.criticalPct}}%显示“想要祈祷”。',
            '裁缝不会自己去，要下令“祈祷”。',
            '到0%时，工匠会做完已付出信仰的批次。',
          ],
        },
        {
          h: '在哪里祈祷',
        },
        {
          table: {
            head: ['地点', '条件'],
            rows: [
              ['民居', '燃着圣火，始终首选'],
              ['[[building:work_temple|神庙]]', '已建成，属于你'],
              ['[[building:headquarters|大本营]]', '已建成，属于你'],
            ],
            foot: '祈祷{{pray.seconds}}秒，信仰+{{pray.pct}}%。无圣火的民居和外方建筑无效。',
          },
        },
        {
          h: '圣火',
        },
        {
          p: '三级民居起可用。1份[[good:holy_oil|油]]燃烧{{oil.burnMinutes}}分钟，满油{{oil.fullBurnMinutes}}分钟。',
        },
        {
          h: '神庙光环',
        },
        {
          table: {
            head: ['项目', '数值'],
            rows: [
              ['范围', '{{aura.range}}步'],
              ['生命值', '每秒+{{aura.perSecond}}，上限{{aura.ceiling}}'],
              ['信仰', '需求条不超过{{need.satedPct}}%时每秒+{{aura.pietyPct}}%'],
              ['对象', '神庙所有者的全部人员。儿童获得生命值'],
              ['条件', '神庙已建成且无损伤'],
              ['多座神庙', '只有一层光环，数值不叠加'],
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
          h: '谁能打开',
        },
        {
          table: {
            head: ['箱子', '对象'],
            rows: [
              ['箱子', '任何成人'],
              ['魔法箱子', '[[job:druid|德鲁伊]]、英雄'],
            ],
            foot: '使用“打开箱子”命令。居民受步行范围限制。物资掉在箱子旁。',
          },
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
              [
                '平民{{chest.settlers}}名、妇女{{chest.settlers}}名、长剑兵{{chest.settlers}}名或长弓手{{chest.settlers}}名',
                '{{chest.settlers}}',
                '{{chest.settlers}}',
              ],
              [
                '狼{{chest.wolves}}只或狮子{{chest.lions}}只，野生兽群',
                '{{chest.wolves}}或{{chest.lions}}',
                '{{chest.wolves}}或{{chest.lions}}',
              ],
            ],
            num: [1, 2],
            foot: '每个箱子的内容由地图决定。',
          },
        },
        {
          h: '文书',
        },
        {
          table: {
            head: ['文书', '效果'],
            rows: [
              ['放置一座你选择的建筑', '建筑目录中任选一座，立即建成'],
              ['放置“名称”', '指定建筑，立即建成'],
              ['放置“名称”并装满库存', '指定建筑，库存全满'],
            ],
            foot: '文书用后消失，位置被拒时不消耗。列表在建造窗口的“文书”下。',
          },
        },
        {
          p: '文书中的建筑：[[building:home_level_01|二级民居]]、[[building:home_level_04|五级民居]]、[[building:stock_02|三级仓库]]、[[building:headquarters|大本营]]、[[building:work_well_00|水井]]、[[building:work_farm_00|农场]]、[[building:work_mill_00|磨坊]]、[[building:work_bakery_00|一级烘焙坊]]、[[building:work_temple|神庙]]、[[building:school|学校]]、[[building:barracks|兵营]]、[[building:tower_01|二级箭塔]]。',
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
            foot: '这种箱子给出文书、一名该职业的居民，并解锁该职业。',
          },
        },
      ],
      see: ['article:construction', 'article:trades', 'article:draughts'],
    },
  ],
};
