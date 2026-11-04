import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const MILITARY: ArticleGroup = {
  group: '军事',
  items: [
    {
      id: 'damage',
      name: '武器、护甲与伤害',
      lead: '人有{{health.human}}点生命值。表里是一次攻击扣掉的数值。',
      blocks: [
        {
          data: 'matrix',
        },
        {
          figure: {
            id: 'direction',
            caption: '攻击从哪边来',
          },
        },
        {
          h: '影响伤害的因素',
        },
        {
          table: {
            head: ['倍率', '数值'],
            rows: [
              ['[[article:exp-combat|该武器的经验]]（仅近战）', '最高×{{combat.fightCapFactor}}'],
              ['从后侧攻击', '×{{combat.backSideFactor}}'],
              ['从背后攻击', '×{{combat.behindFactor}}'],
              ['攻击者的[[good:amulet_strength|力量护符]]', '×{{amulet.strengthFactor}}'],
              [
                '攻击者的[[good:amulet_crithit|精准护符]]',
                '{{amulet.critChancePct}}%几率×{{amulet.critFactor}}',
              ],
              ['目标的[[good:amulet_defense|防御护符]]', '×{{amulet.defenseFactor}}'],
            ],
            foot: '从正面和前侧攻击，伤害不变。',
          },
        },
        {
          list: [
            '经验对箭矢、石弹、载具和木栅栏无效。',
            '攻击方向和防御护符只对人起作用。箭矢的方向按射出的位置算。',
            '投石机指挥官的护符不会加强石弹。',
            '木栅栏的伤害另算：[[article:walls|木栅栏与栅门]]。',
            '儿童不会受伤。',
          ],
        },
        {
          h: '民族差异',
        },
        {
          list: [
            '撒拉逊人的[[good:bow_short|短弓]]对布甲{{saracen.bowOnWool}}（他族{{viking.bowOnWool}}），对锁甲和板甲{{saracen.bowOnChain}}（他族{{viking.bowOnChain}}）。',
            '拜占庭人那里，表中[[good:spear_wooden|木矛]]这一行显示的是地图上的龙。它有{{dragon.hitpoints}}点生命值，射程{{dragon.min}}-{{dragon.max}}，每{{dragon.seconds}}秒攻击{{dragon.blows}}次，对无甲每次{{dragon.bare}}。训练出的矛兵和其他民族一样。',
            '其余武器在所有民族中效果都一样。',
          ],
        },
        {
          h: '护甲',
        },
        {
          data: 'armour',
        },
        {
          p: '重武器和重护甲会拖慢步速：[[article:walking|步速]]。',
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
      name: '士兵装备',
      lead: '军队用助手窗口里的计数器来武装。单个居民的装备在他自己的面板里更换。',
      blocks: [
        {
          h: '计数器',
        },
        {
          table: {
            head: ['计数器', '作用', '何时减少'],
            rows: [
              ['“徒手士兵”', '在兵营训练，不发武器', '训练完成后'],
              ['“剑兵”“矛兵”“弓箭手”', '先武装徒手士兵，再训练新兵', '士兵拿到武器时'],
            ],
            foot: '派谁去兵营：[[article:assistant|助手]]。',
          },
        },
        {
          list: [
            '只要还有徒手士兵在等武器，计数器就不训练新兵，哪怕武器迟迟不来。',
            '范围内有该类武器且没有别人在等时，徒手士兵才去拿。',
          ],
        },
        {
          h: '武器和护甲排序栏',
        },
        {
          p: '每个兵种有自己的排序栏。士兵从左起取仓库里有的第一件，跳过划掉的。一开始最强的装备排在左边。单击可划掉某件装备，拖动可调整顺序。',
        },
        {
          list: [
            '没有武器时，士兵会等待，窗口显示“人在等待武器”。',
            '没有护甲时，他不穿护甲就出发，之后只有你下令才会穿上。',
          ],
        },
        {
          h: '新兵训练后',
        },
        {
          table: {
            head: ['兵营里有', '新兵'],
            rows: [
              ['武器和护甲', '穿戴整齐出营'],
              ['只有武器或只有护甲', '拿上现有的，再去仓库取另一样'],
              ['都没有', '先取武器，再取护甲'],
            ],
            foot: '范围内的仓库有排位更高的装备时，新兵会去取它，而不拿兵营里较差的。',
          },
        },
        {
          h: '兵营存放',
        },
        {
          table: {
            head: ['物资', '数量'],
            rows: [
              [
                '各种武器、护甲、[[good:shoes|鞋子]]、[[good:mead|蜂蜜酒]]、各种药水和护符',
                '{{barracks.gearStock}}',
              ],
              ['食物', '{{barracks.foodStock}}'],
              ['[[good:coin|金币]]', '{{barracks.coinStock}}'],
            ],
            num: [1],
            foot: '兵营有{{barracks.carriers}}个搬运工岗位。你设为优先的物资，他们会自己从仓库运来：[[article:hauling|搬运工与仓库]]。',
          },
        },
        {
          h: '手动更换',
        },
        {
          table: {
            head: ['对象', '可更换'],
            rows: [
              ['士兵', '武器、护甲、鞋子、随身物品'],
              ['有职业的男性', '工具、鞋子、随身物品'],
              ['英雄', '仅背包：[[article:heroes|英雄]]'],
              ['妇女、儿童', '无'],
            ],
          },
        },
        {
          list: [
            '换上新武器会立即改变士兵的兵种。卸下武器后，他就成为普通[[job:soldier_unarmed|士兵]]。',
            '用过的鞋子、工具和开过封的瓶子，换下或卸下时会消失。没用过的回到仓库。',
            '武器、护甲和护符不会耗损，总会回到仓库。',
            '你对单人下的命令优先于助手的设置。',
          ],
        },
        {
          h: '谁能用更好的武器',
        },
        {
          p: '不管经验多少，士兵都能拿仓库里的任何武器。限制在生产环节：[[good:spear_iron|铁矛]]和[[good:sword_long|长剑]]只有有经验的[[job:smith|铁匠]]做得出，[[good:bow_long|长弓]]只有有经验的[[job:armorer|武器匠]]做得出。需要多少经验见[[article:exp-combat|战斗经验]]。',
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
      name: '命中与射击',
      lead: '近战只有在目标已经走出武器范围时才会落空。弓手命中的次数越多，射得越准。',
      blocks: [
        {
          h: '远程武器',
        },
        {
          table: {
            head: ['武器', '射程', '塔上射程', '接近目标至', '射击间隔'],
            rows: [
              [
                '[[good:bow_short|短弓]]',
                '{{shortBow.min}}-{{shortBow.max}}',
                '0-{{shortBow.towerMax}}',
                '{{shortBow.standoff}}',
                '{{shortBow.seconds}}秒',
              ],
              [
                '[[good:bow_long|长弓]]',
                '{{longBow.min}}-{{longBow.max}}',
                '0-{{longBow.towerMax}}',
                '{{longBow.standoff}}',
                '{{longBow.seconds}}秒',
              ],
              [
                '[[job:hunter|猎人]]',
                '{{hunterBow.min}}-{{hunterBow.max}}',
                '-',
                '-',
                '{{hunterBow.seconds}}秒',
              ],
              [
                '[[job:heroine_bow_xena|希拉]]',
                '{{heroBow.min}}-{{heroBow.max}}',
                '-',
                '{{heroBow.standoff}}',
                '{{heroBow.seconds}}秒',
              ],
              [
                '[[building:catapult|投石机]]',
                '{{catapult.min}}-{{catapult.max}}',
                '-',
                '{{catapult.bandMin}}-{{catapult.max}}',
                '{{catapult.seconds}}秒',
              ],
            ],
            num: [1, 2, 3, 4],
            foot: '射程单位为格。目标近于射程下限时，弓手不射击。',
          },
        },
        {
          h: '命中率',
        },
        {
          table: {
            head: ['命中次数', '射准的几率'],
            rows: [
              ['0', '{{aim.basePct}}%'],
              ['50', '{{aim.samplePct}}%'],
              ['{{aim.noSpreadHits}}+', '总落在目标上'],
            ],
            num: [0, 1],
            foot: '每命中一次增加1%。{{aim.noSpreadHits}}次命中起，打偏的箭也落在目标上。短弓和长弓一起累计命中，[[article:catapult|投石机]]单独累计，但用同一张表。英雄总能射中。',
          },
        },
        {
          h: '打偏的箭落在哪',
        },
        {
          list: [
            '打偏的箭落在目标附近：[[good:bow_short|短弓]]最多偏{{aim.spreadShort}}格，[[good:bow_long|长弓]]最多{{aim.spreadLong}}格，塔上的长弓最多{{aim.spreadTower}}格。距离越远，偏得越多。',
            '打偏的箭可能伤到落点处的其他敌人。',
            '箭不会伤到己方、盟友和中立单位。',
            '弓手会瞄准行走敌人的前方，而建筑射向敌人射击瞬间所在的位置。',
          ],
        },
        {
          h: '箭塔岗位',
        },
        {
          list: ['岗位上的弓手打不到，敌人只能射箭塔。'],
        },
      ],
      see: ['article:exp-combat', 'article:defence', 'building:tower_00', 'building:tower_01'],
    },
    {
      id: 'stances',
      name: '姿态',
      lead: '姿态决定士兵会不会自己找敌人，以及追多远。新的士兵和英雄处于防御姿态。',
      blocks: [
        {
          figure: {
            id: 'leash',
            caption: '追击距离',
          },
        },
        {
          table: {
            head: ['姿态', '索敌位置', '半径', '放弃条件', '受击时'],
            rows: [
              ['进攻', '自身周围', '{{stance.search}}', '目标死亡或无法到达', '冲向攻击者'],
              [
                '防御',
                '驻守点周围',
                '{{stance.search}}',
                '目标离驻守点超过{{stance.defendLeash}}',
                '冲向攻击者',
              ],
              [
                '无视',
                '仅武器范围内，不接近',
                '武器范围',
                '目标离驻守点超过{{stance.ignoreLeash}}',
                '留在原地',
              ],
            ],
            foot: '距离单位为格。驻守点是你更换姿态时士兵所站的位置。移动或攻击命令会重新设定它。',
          },
        },
        {
          list: [
            '进攻姿态的士兵打完仗时若离驻守点超过{{stance.attackReturn}}格，就返回驻守点。',
            '士兵在[[article:fog|迷雾]]里也能发现敌人。',
            '攻击命令在任何姿态下都有效。',
            '岗位上的弓手在任何姿态下都会射击范围内的所有目标。',
            '下达普通移动命令后，士兵即使挨打也继续走。下达“沿途攻击”命令后，他会和攻击者交战。',
          ],
        },
        {
          h: '先打谁',
        },
        {
          p: '士兵先打能还手的目标：士兵、英雄、投石机、箭塔和会射击的建筑。平民、其他建筑和无武装载具放到后面。',
        },
        {
          p: '士兵不会主动攻击木栅栏和防御墙：[[article:walls|木栅栏与栅门]]。',
        },
        {
          h: '谁会响应攻击',
        },
        {
          table: {
            head: ['对象', '与伤者的距离', '做什么'],
            rows: [
              ['进攻或防御姿态的士兵和英雄', '{{stance.soldierAlarm}}', '冲向攻击者'],
              ['无视姿态的士兵和英雄', '-', '只打武器范围内的目标'],
              [
                '平民和侦察兵',
                '{{stance.peopleAlarm}}',
                '逃开{{stance.fleeMin}}-{{stance.fleeMax}}格后回去工作',
              ],
            ],
            num: [1],
            foot: '距离单位为格。只有人挨打才会惊动别人，建筑或动物挨打不会。',
          },
        },
        {
          h: '平民',
        },
        {
          list: [
            '平民不参与战斗。只有士兵和英雄能设置姿态。',
            '平民不会一看见敌人就逃跑。',
            '平民逃跑时会扔下携带的物资，搬运工会丢下推车。',
          ],
        },
        {
          h: '“进食与睡眠”开关',
        },
        {
          p: '设为“禁止”时，士兵不会自己去吃饭、睡觉或祈祷，连随身带的和箭塔存的食物也不吃，饥饿也不会打断长命令。没有饮品的话，他最后会挨饿。下“进食”命令或改回“允许”就能解决。',
        },
        {
          p: '饮品、护符以及进食、睡觉、祈祷命令在两种设置下都有效。命令菜单里这两种设置叫“允许休整”和“禁止休整”。',
        },
        {
          h: '战斗附近的休息',
        },
        {
          table: {
            head: ['附近情况', '格数', '士兵'],
            rows: [
              ['战斗', '{{alert.restClearance}}以内', '不睡觉、不祈祷、不聊天'],
              ['视野内有敌人', '{{alert.standTo}}以内', '同上'],
            ],
            foot: '体力降到{{need.criticalPct}}%时才去吃饭。无视姿态下不适用。',
          },
        },
      ],
      see: ['article:defence', 'article:aim', 'article:fog', 'article:needs'],
    },
    {
      id: 'heroes',
      name: '英雄',
      lead: '英雄由地图提供，不能训练，也不能换职业。',
      blocks: [
        {
          table: {
            head: ['项目', '士兵', '英雄'],
            rows: [
              ['视野（格）', '{{vision.soldier}}', '{{vision.hero}}'],
              ['弓箭准头', '随命中次数上升', '总是打得准'],
              ['战斗经验', '增长', '只有任务允许时才增长'],
              ['吃饭和睡觉', '需要', '不需要'],
              ['武器、护甲、鞋子', '可更换，鞋子会磨损', '固定，鞋子不磨损'],
              ['装备重量', '减速', '不减速'],
              ['住所和工作场所', '可以有', '没有'],
              ['魔法箱子', '打不开', '能打开'],
            ],
          },
        },
        {
          h: '英雄的武器',
        },
        {
          table: {
            head: ['英雄', '武器', '护甲', '范围'],
            rows: [
              [
                '[[job:hero_spear_siegfried|西格德]]',
                '矛',
                '[[good:armor_plate|板甲]]',
                '{{hero.spearMin}}-{{hero.spearMax}}',
              ],
              ['[[job:hero_sword_bjarni|比亚尼]]', '剑', '[[good:armor_chain|锁甲]]', '{{hero.swordReach}}'],
              ['[[job:hero_saber_hatschi|哈奇]]', '弯刀', '[[good:armor_chain|锁甲]]', '{{hero.saberReach}}'],
              [
                '[[job:heroine_bow_xena|希拉]]',
                '弓',
                '[[good:armor_leather|皮甲]]',
                '{{heroBow.min}}-{{heroBow.max}}',
              ],
            ],
            num: [3],
            foot: '英雄每{{hero.blowSeconds}}秒攻击一次。伤害见[[article:damage|武器、护甲与伤害]]里的表，打开“英雄”即可。',
          },
        },
        {
          h: '民族差异',
        },
        {
          table: {
            head: ['英雄', '民族', '差异'],
            rows: [
              ['西格德', '埃及人', '对锁甲{{hero.sigurdEgyptChain}}'],
              ['哈奇', '撒拉逊人', '每{{hero.hatchieSaracenSeconds}}秒{{hero.hatchieSaracenBlows}}击'],
              [
                '希拉',
                '法兰克人',
                '射程{{frankHeroBow.min}}-{{frankHeroBow.max}}，每{{frankHeroBow.seconds}}秒一箭。伤害：对无甲{{hero.frankBowBare}}，对布甲和皮甲{{hero.frankBowWool}}，对锁甲和板甲{{hero.frankBowChain}}，对建筑和载具{{hero.frankBowVehicle}}',
              ],
            ],
          },
        },
        {
          h: '背包',
        },
        {
          list: [
            '英雄的背包只装：[[good:amulet_strength|力量护符]]、[[good:amulet_defense|防御护符]]、[[good:amulet_crithit|精准护符]]、[[good:amulet_speed|疾风护符]]、[[good:potion_heal_small|小型治疗药水]]、[[good:potion_heal_big|大型治疗药水]]。',
          ],
        },
      ],
      see: ['article:damage', 'article:chests', 'article:fog', 'article:exp-combat'],
    },
    {
      id: 'defence',
      name: '箭塔与防御模式',
      lead: '防御模式下建筑会自己向敌人射击。里面每多躲一个人，每秒多射{{shelter.shotsPerSeat}}箭。',
      blocks: [
        {
          h: '防御模式',
        },
        {
          list: [
            '“开启防御模式”作用于一座建筑，“全城”作用于所有防御建筑。',
            '防御模式由你自己开启。聚落遭到攻击也不会自动开启。',
            '防御模式不会自己关闭，会一直持续到你点“关闭防御模式”或建筑被毁。',
          ],
        },
        {
          h: '谁去避难',
        },
        {
          list: [
            '平民、妇女和儿童跑向最近的、走得到的有空位的建筑。',
            '士兵、英雄和[[job:scout|侦察兵]]留在外面。',
            '找不到位置的人继续工作。',
            '防御模式开启时，居民会中断吃饭和睡觉。在里面不工作，只吃随身带的。',
            '躲进去的居民不会受到攻击。',
            '建筑被毁时，躲在里面的人会出来。',
          ],
        },
        {
          h: '防御建筑',
        },
        {
          table: {
            head: ['建筑', '名额', '每秒箭数', '岗位'],
            rows: [
              ['[[building:headquarters|大本营]]', '{{shelter.hq}}', '{{shelter.hqShots}}', '-'],
              [
                '[[building:tower_01|二级箭塔]]',
                '{{shelter.tower2}}',
                '{{shelter.tower2Shots}}',
                '短弓{{tower2.posts}}个，长弓{{tower2.longPosts}}个',
              ],
              [
                '[[building:tower_00|一级箭塔]]',
                '{{shelter.tower1}}',
                '{{shelter.tower1Shots}}',
                '短弓{{tower1.posts}}个，长弓{{tower1.longPosts}}个',
              ],
              ['[[building:barracks|兵营]]', '{{shelter.barracks}}', '{{shelter.barracksShots}}', '-'],
            ],
            num: [1, 2],
            foot: '每秒箭数按建筑住满计算。岗位不占避难名额。箭塔里雇用的弓手自己射击，无需防御模式：[[article:aim|命中与射击]]。',
          },
        },
        {
          h: '建筑射出的箭',
        },
        {
          table: {
            head: ['目标', '箭矢'],
            rows: [
              ['无甲', '{{arrow.bare}}'],
              ['布甲', '{{arrow.wool}}'],
              ['皮甲', '{{arrow.leather}}'],
              ['锁甲、板甲', '{{arrow.chain}}'],
              ['载具', '{{arrow.vehicle}}'],
              ['建筑', '{{arrow.building}}'],
            ],
            num: [1],
            foot: '所有民族一样。攻击方向和防御护符可能改变数值：[[article:damage|武器、护甲与伤害]]。',
          },
        },
        {
          list: [
            '射程为从建筑最近的墙起{{shelter.range}}格，贴着墙根的敌人也打得到。',
            '建筑也会射击迷雾中的敌人。',
            '箭不花东西，也不给经验。',
            '建筑先射士兵和英雄，平民排在最后。',
          ],
        },
        {
          h: '箭塔驻军',
        },
        {
          table: {
            head: ['箭塔', '搬运工岗位', '蜂蜜酒', '食物', '每种武器'],
            rows: [
              [
                '[[building:tower_00|一级箭塔]]',
                '{{tower1.carriers}}',
                '{{tower1.mead}}',
                '{{tower1.food}}',
                '{{tower1.weapon}}',
              ],
              [
                '[[building:tower_01|二级箭塔]]',
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
            '只有对应的弓手才能上岗：[[job:soldier_bow_short|短弓手]]或[[job:soldier_bow_long|长弓手]]。分配方式与工作场所相同。',
            '弓手换别的武器就失去岗位。',
            '驻军吃箭塔的存粮，在岗位上睡觉。存粮吃完了才下塔找吃的。',
            '助手不会把弓手调离箭塔，换新装备也不会。',
            '“撤出驻军”会让弓手离开箭塔并选中他们，方便你马上下命令。移动命令也能让弓手离岗。',
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
      name: '木栅栏与栅门',
      lead: '“建筑”列的伤害每满{{wall.damagePerPoint}}点，木栅栏掉1点生命值。伤害更低的攻击对它没用。',
      blocks: [
        {
          table: {
            head: ['部件', '生命值', '每次敲击修复', '成本'],
            rows: [
              ['木栅栏段', '{{wall.segmentHp}}', '{{wall.segmentRepair}}', '1份[[good:wood|木材]]'],
              ['栅门', '{{wall.gateHp}}', '{{wall.gateRepair}}', '免费，由栅栏段改建'],
            ],
            num: [1, 2],
            foot: '修理不花东西。一段栅栏同时只能由一名建筑工人修理。',
          },
        },
        {
          h: '建造栅门',
        },
        {
          figure: {
            id: 'gate',
            caption: '栅门建在哪里',
          },
        },
        {
          list: [
            '栅门占用{{wall.gateSegments}}段连成直线的自家已完工栅栏。每段至少有{{wall.gateMinHealthPct}}%生命值，且在平地上，通道内不能有人。',
            '栅门立即建成，处于关闭状态，生命值是满的，即使原来的栅栏段受过损。',
          ],
        },
        {
          h: '栅门模式',
        },
        {
          table: {
            head: ['模式', '效果'],
            rows: [
              ['开启', '谁都能过，包括敌人'],
              ['关闭', '谁也过不去，包括自己人'],
              ['自动', '保持开启。敌人走近到{{wall.gateEnemyNear}}格内时关闭，敌人离开后再打开'],
            ],
            foot: '和你交战的玩家的人或载具都会让栅门关闭，平民也算。动物不会。',
          },
        },
        {
          list: ['通道内没人时栅门才关闭。'],
        },
        {
          h: '木栅栏倒得多快',
        },
        {
          table: {
            head: ['武器', '每击生命值', '栅栏段击数', '栅门击数', '栅栏段用时'],
            rows: [
              [
                '[[building:catapult|投石机]]',
                '{{wall.catapult.blow}}',
                '{{wall.catapult.segmentHits}}',
                '{{wall.catapult.gateHits}}',
                '{{wall.catapult.segmentSeconds}}秒',
              ],
              [
                '英雄近战',
                '{{wall.hero.blow}}',
                '{{wall.hero.segmentHits}}',
                '{{wall.hero.gateHits}}',
                '{{wall.hero.segmentSeconds}}秒',
              ],
              [
                '[[good:spear_iron|铁矛]]',
                '{{wall.ironSpear.blow}}',
                '{{wall.ironSpear.segmentHits}}',
                '{{wall.ironSpear.gateHits}}',
                '{{wall.ironSpear.segmentSeconds}}秒',
              ],
              [
                '[[good:sword_long|长剑]]',
                '{{wall.longSword.blow}}',
                '{{wall.longSword.segmentHits}}',
                '{{wall.longSword.gateHits}}',
                '{{wall.longSword.segmentSeconds}}秒',
              ],
              [
                '[[good:sword_shord|短剑]]',
                '{{wall.shortSword.blow}}',
                '{{wall.shortSword.segmentHits}}',
                '{{wall.shortSword.gateHits}}',
                '{{wall.shortSword.segmentSeconds}}秒',
              ],
              [
                '[[good:spear_wooden|木矛]]',
                '{{wall.woodenSpear.blow}}',
                '{{wall.woodenSpear.segmentHits}}',
                '{{wall.woodenSpear.gateHits}}',
                '{{wall.woodenSpear.segmentSeconds}}秒',
              ],
              [
                '[[good:bow_short|短弓]]',
                '{{wall.shortBow.blow}}',
                '{{wall.shortBow.segmentHits}}',
                '{{wall.shortBow.gateHits}}',
                '{{wall.shortBow.segmentSeconds}}秒',
              ],
              [
                '[[good:bow_long|长弓]]',
                '{{wall.longBow.blow}}',
                '{{wall.longBow.segmentHits}}',
                '{{wall.longBow.gateHits}}',
                '{{wall.longBow.segmentSeconds}}秒',
              ],
              ['拳头、建筑射出的箭', '0', '-', '-', '-'],
            ],
            num: [1, 2, 3, 4],
            foot: '用时按一名士兵计算。希拉扣{{wall.heroBow.blow}}，法兰克人的希拉扣{{wall.frankHeroBow.blow}}。',
          },
        },
        {
          list: [
            '战斗经验不会加强对木栅栏的攻击。',
            '力量护符会加强攻击：{{wall.ironSpear.blow}}变{{wall.ironSpear.strongBlow}}，{{wall.shortSword.blow}}变{{wall.shortSword.strongBlow}}，{{wall.shortBow.blow}}还是{{wall.shortBow.strongBlow}}。',
            '士兵不会主动攻击木栅栏。只有下令或栅栏挡住去敌人的路时才会打。',
            '一段栅栏倒下后，士兵会穿过缺口，不再打旁边的栅栏。',
          ],
        },
        {
          h: '防御墙',
        },
        {
          p: '[[building:work_pottery_02|防御墙]]是普通建筑：{{wall.defenceHp}}点生命值，伤害看“建筑”列。士兵对待它和木栅栏一样。',
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
      name: '投石机',
      lead: '石弹伤及落点和周围六格内的一切，你自己的人也不例外。',
      blocks: [
        {
          figure: {
            id: 'catapult-splash',
            caption: '石弹落点',
          },
        },
        {
          table: {
            head: ['项目', '数值'],
            rows: [
              ['射程', '{{catapult.min}}-{{catapult.max}}格'],
              ['射击间隔', '{{catapult.seconds}}秒'],
              ['生命值', '{{catapult.hitpoints}}'],
              ['乘员', '1名士兵或英雄，武器不限'],
              [
                '成本',
                '[[building:catapult|投石机]]：[[good:wood|木材]]{{catapult.wood}}份，[[good:iron|铁矿]]{{catapult.iron}}份',
              ],
            ],
            foot: '没有指挥官的投石机不能移动也不能射击。石弹不花东西。',
          },
        },
        {
          h: '石弹',
        },
        {
          table: {
            head: ['目标', '伤害', '摧毁所需石弹'],
            rows: [
              ['无甲', '{{stone.bare}}', '{{stone.bareKills}}'],
              ['皮甲', '{{stone.leather}}', '{{stone.leatherKills}}'],
              ['布甲', '{{stone.wool}}', '{{stone.woolKills}}'],
              ['锁甲、板甲', '{{stone.chain}}', '{{stone.chainKills}}'],
              ['投石机', '{{stone.vehicle}}', '{{stone.vehicleKills}}'],
              ['建筑', '{{stone.building}}', '{{stone.tower1}}-{{stone.frankHq}}'],
            ],
            num: [2],
            foot: '对人的伤害按正面命中、无护符计算。木栅栏：[[article:walls|木栅栏与栅门]]。',
          },
        },
        {
          table: {
            head: ['建筑', '生命值', '石弹数', '用时'],
            rows: [
              [
                '[[building:tower_00|一级箭塔]]',
                '{{hp.tower1}}',
                '{{stone.tower1}}',
                '{{stone.tower1Seconds}}秒',
              ],
              [
                '[[building:tower_01|二级箭塔]]',
                '{{hp.tower2}}',
                '{{stone.tower2}}',
                '{{stone.tower2Seconds}}秒',
              ],
              [
                '[[building:headquarters|大本营]]，维京人',
                '{{hp.hq}}',
                '{{stone.hq}}',
                '{{stone.hqSeconds}}秒',
              ],
            ],
            num: [1, 2, 3],
            foot: '法兰克人大本营：{{hp.frankHq}}点生命值，{{stone.frankHq}}发石弹，{{stone.frankHqSeconds}}秒。',
          },
        },
        {
          h: '谁会被砸中',
        },
        {
          table: {
            head: ['石弹下方', '结果'],
            rows: [
              ['敌人', '受伤'],
              ['己方人员、载具、建筑、木栅栏', '受伤'],
              ['中立方和盟友', '受伤，不影响立场'],
              ['大厅设定为和平的玩家', '避开'],
              ['儿童', '避开'],
              ['建筑内的人', '避开'],
              ['树木', '砸倒'],
            ],
          },
        },
        {
          h: '命中率',
        },
        {
          p: '准头和弓手一样随命中上升：[[article:aim|命中与射击]]。在{{catapult.max}}格处，打偏的石弹落在目标周围：0次命中时最多{{stone.spread.0}}格，25次{{stone.spread.25}}格，50次{{stone.spread.50}}格。{{aim.noSpreadHits}}次命中起落在目标上。命中次数归指挥官：每发打坏了东西的石弹都算，建筑也算，但即使打中多个目标也只算一次。',
        },
        {
          h: '投石机的姿态',
        },
        {
          table: {
            head: ['姿态', '索敌位置', '半径', '是否移动'],
            rows: [
              ['进攻', '自身周围', '{{catapult.searchRadius}}', '是'],
              ['防御', '驻守位置周围', '{{catapult.searchRadius}}', '是，离驻守位置最多{{catapult.leash}}'],
              ['无视', '驻守位置周围', '{{catapult.min}}-{{catapult.max}}', '否'],
            ],
            foot: '新投石机为无视姿态。它只会主动攻击看得见的目标。攻击命令在任何姿态下都有效。',
          },
        },
        {
          list: [
            '目标近于{{catapult.min}}格时，投石机后撤。目标远于{{catapult.max}}格时，它会开到{{catapult.bandMin}}-{{catapult.max}}格处。',
            '只在静止且不与其他载具接触时射击。',
            '可以命令它射击地面上的任意位置。只有下令它才会打木栅栏。',
          ],
        },
        {
          h: '什么能摧毁投石机',
        },
        {
          table: {
            head: ['武器', '伤害', '摧毁所需命中'],
            rows: [
              ['另一台投石机', '{{stone.vehicle}}', '{{stone.vehicleKills}}'],
              [
                '矛、[[good:sword_long|长剑]]、[[good:bow_long|长弓]]',
                '{{vs.catapult.spear}}',
                '{{vs.catapult.spearHits}}',
              ],
              [
                '[[good:sword_shord|短剑]]、[[good:bow_short|短弓]]',
                '{{vs.catapult.shortSword}}',
                '{{vs.catapult.shortSwordHits}}',
              ],
              ['拳头', '{{vs.catapult.fist}}', '{{vs.catapult.fistHits}}'],
              ['建筑射出的箭', '{{arrow.vehicle}}', '{{vs.catapult.arrowHits}}'],
            ],
            num: [1, 2],
            foot: '经验对载具无效，攻击者的护符有效。',
          },
        },
      ],
      see: ['article:vehicles', 'article:walls', 'article:aim', 'article:exp-combat', 'building:catapult'],
    },
    {
      id: 'computer',
      name: '电脑对手',
      lead: '电脑难度在大厅里选择。困难电脑可能在和平时间一结束就进攻。',
      blocks: [
        {
          table: {
            head: ['项目', '简单', '中等', '困难'],
            rows: [
              ['第一波', '{{ai.easy.firstWaveMinutes}}分钟', '{{ai.medium.firstWaveMinutes}}分钟', '立刻'],
              ['军队上限', '{{ai.easy.armyCap}}', '{{ai.medium.armyCap}}', '{{ai.hard.armyCap}}'],
              ['投石机', '{{ai.easy.catapults}}', '最多{{ai.medium.catapults}}', '最多{{ai.hard.catapults}}'],
              ['密集箭塔环', '否', '是', '是'],
              [
                '同时开工的工地',
                '{{ai.easy.sites}}',
                '{{ai.medium.sites}}，{{ai.medium.grownMinutes}}分钟起{{ai.medium.grownSites}}',
                '{{ai.hard.sites}}，{{ai.hard.midMinutes}}分钟起{{ai.hard.midSites}}，{{ai.hard.lateMinutes}}分钟起{{ai.hard.lateSites}}',
              ],
            ],
            foot: '时间均为游戏时间：×3速度下快三倍。“和平时间”结束前不会出兵。简单和中等不会训练超过军队上限的士兵。',
          },
        },
        {
          h: '进攻波次',
        },
        {
          table: {
            head: ['第一波之后', '每波人数'],
            rows: [
              ['0', '{{ai.wave.0.min}}-{{ai.wave.0.max}}'],
              ['1小时', '{{ai.wave.1.min}}-{{ai.wave.1.max}}'],
              ['2小时', '{{ai.wave.2.min}}-{{ai.wave.2.max}}'],
              ['3小时及以后', '{{ai.wave.3.min}}-{{ai.wave.3.max}}'],
            ],
            num: [1],
            foot: '人数在这个区间内随机。',
          },
        },
        {
          list: [
            '同时只有一波在进攻，下一波同时在[[building:barracks|兵营]]前集结。',
            '集结最多{{ai.gatherMinutes}}分钟。之后按表中下限的人数出发，人数不够时能走到的全部出发。',
          ],
        },
        {
          h: '何时出发',
        },
        {
          list: [
            '电脑比较自己和你的军队实力，算武器、护甲、护符、生命值和治疗药水，不算经验。',
            '你箭塔岗位上的弓手按野外的{{ai.towerPostWeight}}倍计算。',
            '开局时每台电脑随机选一个计划。进攻型在有你{{ai.planAggressivePct}}%的实力时出发，防守型要到{{ai.planDefensivePct}}%，其余的到{{ai.planBalancedPct}}%。',
            '你在迷雾中的军队，它按最后一次看到的情况计算。对你一无所知时，就当你和它一样强。',
            '电脑实力不够时，这波在兵营前等待，集结结束后也一样。',
            '电脑军队达到上限时，这波不管实力如何都会出发。',
            '你攻打它的聚落，或比它强{{ai.defendRatio}}倍时，电脑会把军队留在家里，在路上的波次也会折返。',
          ],
        },
        {
          h: '突袭',
        },
        {
          list: [
            '突袭是一支{{ai.raidMen}}人的小队，专打你的采集者和经济建筑。它绕开箭塔的射程，没有这样的路就不出发。',
            '困难电脑在{{ai.raidChancePct}}%的对局里会突袭，开局在岛上时除外。选了骚扰计划的电脑在任何难度下都会突袭。',
            '第一次突袭在和平结束后{{ai.raidMinMinutes}}-{{ai.raidMaxMinutes}}分钟出发，之后间隔差不多。',
          ],
        },
        {
          h: '目标',
        },
        {
          p: '进攻波次先打最近的[[building:headquarters|大本营]]，再打箭塔和其他建筑（包括工地），最后打人。',
        },
        {
          list: [
            '木栅栏和[[building:work_pottery_02|防御墙]]不是进攻波次的目标：[[article:walls|木栅栏与栅门]]。',
            '迷雾中，电脑知道地图开局时的建筑和它看见过的建筑。新建筑要等它看见才知道。',
          ],
        },
        {
          h: '水路',
        },
        {
          list: [
            '步行的波次只走电脑兵营所在的那片陆地。你在那片陆地上的任何建筑和人员都可能成为目标。',
            '对手大本营在别的陆地时，电脑在岸边建[[building:work_joinery_03|四级木匠坊]]，造[[good:ship_small|船]]，用船运兵。',
            '岸边有{{ai.landingShips}}艘船（弱一些的电脑更少），且军队比守军强{{ai.landingEdge}}倍时，登陆部队出发。每艘船载{{vehicle.shipSeats}}名士兵。',
            '登陆部队尽量在靠近你大本营的地方靠岸，但会避开箭塔和防御模式建筑的射程，然后冲向大本营。',
            '在陆地上损失{{ai.landingRetreatPct}}%的人后，其余的人回到船上。下一次登陆最早在{{ai.landingCooldownMinutes}}分钟后。',
          ],
        },
        {
          h: '重建',
        },
        {
          p: '大厅里设为“地图 AI”的玩家，在{{ai.rebuildNear}}格内没有敌人且有自家平民时重建被毁的建筑。大本营不重建。',
        },
      ],
      see: ['article:defence', 'article:walls', 'article:catapult', 'article:fog', 'article:diplomacy'],
    },
  ],
};
