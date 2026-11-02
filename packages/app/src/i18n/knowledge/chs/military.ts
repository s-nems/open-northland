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
            '方向和防御护符只对人有效。箭矢的方向从发射的位置算起。',
            '指挥官的护符对投石机的石弹无效。',
            '木栅栏的伤害另算：[[article:walls|木栅栏与栅门]]。',
            '伤害为0的攻击不伤人，也不给经验。',
            '儿童不会受伤。',
          ],
        },
        {
          h: '民族差异',
        },
        {
          list: [
            '撒拉逊人：[[good:bow_short|短弓]]对布甲{{saracen.bowOnWool}}（他族{{viking.bowOnWool}}），对锁甲和板甲{{saracen.bowOnChain}}（他族{{viking.bowOnChain}}）。',
            '拜占庭人：地图上的龙用自己的[[good:spear_wooden|木矛]]作战：{{dragon.hitpoints}}点生命值，射程{{dragon.min}}-{{dragon.max}}，每{{dragon.seconds}}秒{{dragon.blows}}击，对无甲{{dragon.bare}}。表里这一行显示的就是它。训练出的矛兵与其他民族相同。',
            '其余武器所有民族都一样。',
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
      lead: '军队靠助手窗口的计数器武装。单个人在他自己的面板里更换。',
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
            '只要有徒手士兵在等，计数器就不训练新兵，哪怕暂时没有武器。',
            '范围内有该类武器且没有别人在等时，徒手士兵才去拿。',
            '调低计数器后，等武器的人不再等了。',
          ],
        },
        {
          h: '武器和护甲排序栏',
        },
        {
          p: '每个兵种有自己的排序栏。士兵从左起取仓库里有的第一件，跳过划掉的。初始时最强的在左边。单击划掉，按住拖动改变顺序。',
        },
        {
          list: [
            '无武器可拿：等待，窗口显示“人在等待武器”。',
            '无护甲可拿：不穿护甲出发。之后只有下令才会穿。',
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
              ['只有其中一样', '拿上再去取另一样'],
              ['都没有', '先取武器，再取护甲'],
            ],
            foot: '范围内的仓库有排位更高的装备时，新兵去取，不拿兵营里差一等的。取完回到兵营门前。由计数器武装的士兵也一样。',
          },
        },
        {
          h: '兵营存放',
        },
        {
          table: {
            head: ['物资', '份数'],
            rows: [
              [
                '各种武器、护甲、[[good:shoes|鞋子]]、[[good:mead|蜂蜜酒]]、各种药水和护符',
                '{{barracks.gearStock}}',
              ],
              ['食物', '{{barracks.foodStock}}'],
              ['[[good:coin|金币]]', '{{barracks.coinStock}}'],
            ],
            num: [1],
            foot: '兵营有{{barracks.carriers}}个搬运工岗位。标记为优先的物资，他们自己从仓库运来：[[article:hauling|搬运工与仓库]]。',
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
            '居民去取东西，再回到接令的地方。',
            '哪里都找不到这件东西时，空手回来。',
            '武器立即改变士兵的兵种。卸下武器后成为[[job:soldier_unarmed|士兵]]。',
            '用过的鞋子、工具和开过封的瓶子，换下或卸下时会消失。没用过的回到仓库。',
            '武器、护甲和护符不耗损，所以会回到仓库。',
            '对单人下的命令优先于助手。',
          ],
        },
        {
          h: '谁能用更好的武器',
        },
        {
          p: '士兵能拿仓库里的任何武器，命中次数不限制这一点。限制在生产环节：[[good:spear_iron|铁矛]]和[[good:sword_long|长剑]]要有经验的[[job:smith|铁匠]]才做得出，[[good:bow_long|长弓]]要有经验的[[job:armorer|武器匠]]。数值表见[[article:exp-combat|战斗经验]]。',
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
      lead: '近战只有在出手瞬间目标超出武器范围时才落空。弓手的准头随弓的命中次数上升。',
      blocks: [
        {
          h: '远程武器',
        },
        {
          table: {
            head: ['武器', '射程', '塔上射程', '接近到', '射击间隔'],
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
            foot: '射程单位为格。目标近于射程下限时弓手不射击。“接近到”：自己走向目标时，从多远开始射击。',
          },
        },
        {
          h: '命中率',
        },
        {
          table: {
            head: ['命中次数', '打得准的射击'],
            rows: [
              ['0', '{{aim.basePct}}%'],
              ['50', '{{aim.samplePct}}%'],
              ['{{aim.noSpreadHits}}+', '总落在目标上'],
            ],
            num: [0, 1],
            foot: '每命中一次+1%。{{aim.noSpreadHits}}次命中起，打偏的箭也落在目标上。短弓和长弓共用命中计数，[[article:catapult|投石机]]单独计数，数值表相同。英雄总是打得准。',
          },
        },
        {
          h: '打偏的箭落在哪',
        },
        {
          list: [
            '打偏的箭落在目标附近：[[good:bow_short|短弓]]最多偏{{aim.spreadShort}}格，[[good:bow_long|长弓]]最多{{aim.spreadLong}}格，塔上的长弓最多{{aim.spreadTower}}格。距离越远，偏得越多。',
            '打偏的箭伤到落点的第一个敌人：先是人、动物或载具，然后是建筑，最后是木栅栏。',
            '箭会飞过己方、盟友和中立单位。',
            '弓手瞄准行走敌人的前方。建筑瞄准敌人此刻所站的位置。',
          ],
        },
        {
          h: '箭塔岗位',
        },
        {
          list: ['弓手站到岗位上才有更远的射程，走向岗位途中没有。', '敌人不能射岗位上的弓手，只能射箭塔。'],
        },
      ],
      see: ['article:exp-combat', 'article:defence', 'building:tower_00', 'building:tower_01'],
    },
    {
      id: 'stances',
      name: '姿态',
      lead: '姿态决定士兵会不会自己找敌人，以及追多远。士兵和英雄初始为防御姿态。',
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
              ['进攻', '自身周围', '{{stance.search}}', '目标倒下或无法到达', '冲向攻击者'],
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
            foot: '半径单位为格。驻守点是士兵更换姿态时所站的位置。移动或攻击命令后驻守点随之改变。',
          },
        },
        {
          list: [
            '进攻姿态的士兵打完仗时若离驻守点超过{{stance.attackReturn}}格，就返回驻守点。',
            '士兵在[[article:fog|迷雾]]里也能找到敌人。',
            '攻击命令在任何姿态下都有效。',
            '岗位上的弓手在任何姿态下都射击范围内的目标。',
            '普通移动命令下，士兵挨打也继续走。“沿途攻击”命令下他会转身迎敌。',
          ],
        },
        {
          h: '先打谁',
        },
        {
          steps: ['士兵、英雄、投石机、箭塔和会射击的建筑。', '其余目标：平民、其他建筑、无武装载具。'],
        },
        {
          p: '士兵不会主动选择木栅栏和防御墙：[[article:walls|木栅栏与栅门]]。',
        },
        {
          h: '谁会响应攻击',
        },
        {
          table: {
            head: ['对象', '距伤者（格）', '反应'],
            rows: [
              ['进攻或防御姿态的士兵和英雄', '{{stance.soldierAlarm}}', '冲向攻击者'],
              ['无视姿态的士兵和英雄', '-', '只打武器范围内的目标'],
              [
                '平民和侦察兵',
                '{{stance.peopleAlarm}}',
                '逃开{{stance.fleeMin}}-{{stance.fleeMax}}格后回去工作',
              ],
              ['建筑内的人', '-', '不反应，岗位上的弓手除外'],
              ['露天睡觉的平民', '-', '继续睡，被打才逃'],
            ],
            num: [1],
            foot: '只有人挨打才算。建筑或动物挨打不会惊动任何人。',
          },
        },
        {
          h: '平民',
        },
        {
          list: [
            '平民不参与战斗。只有士兵和英雄能设置姿态。',
            '看见敌人时平民不动。',
            '逃跑时扔下携带的物资。搬运工丢下推车。',
          ],
        },
        {
          h: '“进食与睡眠”开关',
        },
        {
          p: '设为“禁止”时，士兵不会自己去吃饭、睡觉或祈祷，也不吃随身的或箭塔存的食物，饥饿也打断不了长命令。没有饮品的话最后会饿死。下“进食”命令或改回“允许”可以救他。',
        },
        {
          p: '饮品、护符以及进食、睡觉、祈祷命令在两种状态下都有效。命令菜单里这两种状态叫“允许休整”和“禁止休整”。只有士兵有这个开关，初始为“允许”，换职业后恢复“允许”。',
        },
        {
          h: '戒备中',
        },
        {
          p: '这是进攻或防御姿态的士兵靠近战斗时的状态，不是玩家开启的[[article:defence|聚落防御模式]]。',
        },
        {
          table: {
            head: ['附近情况', '格数', '结果'],
            rows: [
              ['战斗', '{{alert.restClearance}}以内', '不睡觉、不祈祷、不聊天。'],
              ['可见的进攻或防御姿态敌人', '{{alert.standTo}}以内', '同上。'],
              ['露天睡觉者附近有战斗', '{{alert.standTo}}以内', '起身。'],
            ],
            foot: '体力到{{need.criticalPct}}%才去吃饭。野兽只有正在交战时才算。无视姿态下此规则无效，需求命令优先。',
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
              ['战斗经验', '增长', '不增长，除非任务允许'],
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
            foot: '每{{hero.blowSeconds}}秒攻击一次。伤害：在[[article:damage|武器、护甲与伤害]]的表里打开“英雄”。',
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
                '射程{{frankHeroBow.min}}-{{frankHeroBow.max}}，每{{frankHeroBow.seconds}}秒一箭，对无甲{{hero.frankBowBare}}，对布甲和皮甲{{hero.frankBowWool}}，对锁甲和板甲{{hero.frankBowChain}}，对建筑和载具{{hero.frankBowVehicle}}',
              ],
            ],
          },
        },
        {
          h: '背包',
        },
        {
          list: [
            '只装：[[good:amulet_strength|力量护符]]、[[good:amulet_defense|防御护符]]、[[good:amulet_crithit|精准护符]]、[[good:amulet_speed|疾风护符]]、[[good:potion_heal_small|小型治疗药水]]、[[good:potion_heal_big|大型治疗药水]]。',
          ],
        },
        {
          h: '死亡',
        },
        {
          p: '武器消失。护甲、鞋子和背包里没用过的物品留在地上。',
        },
      ],
      see: ['article:damage', 'article:chests', 'article:fog', 'article:exp-combat'],
    },
    {
      id: 'defence',
      name: '箭塔与防御模式',
      lead: '防御模式下建筑自己射击。里面每多一个人，每秒多{{shelter.shotsPerSeat}}箭。',
      blocks: [
        {
          h: '防御模式',
        },
        {
          list: [
            '“开启防御模式”作用于一座建筑，“全城”作用于所有防御建筑。',
            '防御模式由你自己开启。聚落遭到攻击也不会自动开启。',
            '在建建筑不能开启。',
            '防御模式不会自己关闭，一直持续到“关闭防御模式”或建筑被毁。',
          ],
        },
        {
          h: '谁去避难',
        },
        {
          list: [
            '平民、妇女和儿童跑向最近的有空位的建筑。建筑必须在步行范围内。',
            '士兵、英雄和[[job:scout|侦察兵]]留在外面。',
            '找不到位置的人继续工作。',
            '防御模式开启时，居民丢下吃饭和睡觉。在里面不工作，只吃随身带的。',
            '避难者不会受到攻击。',
            '建筑被毁时，避难者回到外面。',
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
            foot: '每秒箭数按建筑住满计算。岗位不占建筑名额。箭塔里雇用的弓手自己射击，无需防御模式：[[article:aim|命中与射击]]。',
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
            '目标顺序：士兵和英雄、野兽、建筑、其他人。',
          ],
        },
        {
          h: '箭塔驻军',
        },
        {
          table: {
            head: ['箭塔', '搬运工岗位', '蜂蜜酒', '食物', '每种武器份数'],
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
            '岗位只接受对应的弓手：[[job:soldier_bow_short|短弓手]]或[[job:soldier_bow_long|长弓手]]。分配方式与工作场所相同。',
            '弓手换别的武器就失去岗位。',
            '驻军吃箭塔存粮，在岗位上睡觉，不下塔。存粮吃完才去找吃的。',
            '助手不会把弓手调离箭塔，发装备也不会。',
            '“撤出驻军”：弓手离开箭塔并保持选中，等待下一条命令。移动命令也能让弓手离岗。',
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
            foot: '修理不花东西。木栅栏同时只有一名建筑工人修理。',
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
            '栅门立即建成，处于关闭状态。即使栅栏段受过损，栅门也是满生命值。',
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
              ['自动', '保持开启。敌人进入栅门{{wall.gateEnemyNear}}格内时关闭，之后再打开'],
            ],
            foot: '和你交战的玩家的人或载具都会让栅门关闭，平民也算。动物不会。',
          },
        },
        {
          list: ['通道内没人时栅门才关闭。', '电脑把自己的栅门设为自动模式。'],
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
            '战斗经验不增加对木栅栏的攻击。',
            '力量护符提高这个数：{{wall.ironSpear.blow}}变{{wall.ironSpear.strongBlow}}，{{wall.shortSword.blow}}变{{wall.shortSword.strongBlow}}，{{wall.shortBow.blow}}还是{{wall.shortBow.strongBlow}}。',
            '士兵不会主动选择木栅栏。只有下令或栅栏挡住去敌人的路时才会打。',
            '一段倒下后，士兵穿过缺口，不再打旁边的栅栏。',
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
            foot: '对人的伤害按从正面、无护符计算。木栅栏：[[article:walls|木栅栏与栅门]]。',
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
          p: '准头和弓手一样随命中上升：[[article:aim|命中与射击]]。在{{catapult.max}}格处，打偏的石弹落在目标周围：0次命中时最多{{stone.spread.0}}格，25次{{stone.spread.25}}格，50次{{stone.spread.50}}格。{{aim.noSpreadHits}}次命中起落在目标上。经验归指挥官：石弹打坏了东西算1次命中，建筑也算。一发打中多个目标只算一次。',
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
            foot: '新投石机为无视姿态。它只自动选择看得见的目标。攻击命令在任何姿态下都有效。',
          },
        },
        {
          list: [
            '目标近于{{catapult.min}}格：投石机后撤。目标远于{{catapult.max}}格：开到{{catapult.bandMin}}-{{catapult.max}}格处。',
            '只在静止且不与其他载具接触时射击。',
            '可以命令它射击地面上的某个位置。只有下令才打木栅栏。',
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
      lead: '难度在大厅设置。困难电脑可能在和平结束后立刻发动第一波。',
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
            head: ['波次开始后', '每波人数'],
            rows: [
              ['0', '{{ai.wave.0.min}}-{{ai.wave.0.max}}'],
              ['1小时', '{{ai.wave.1.min}}-{{ai.wave.1.max}}'],
              ['2小时', '{{ai.wave.2.min}}-{{ai.wave.2.max}}'],
              ['3小时及以后', '{{ai.wave.3.min}}-{{ai.wave.3.max}}'],
            ],
            num: [1],
            foot: '时间从“第一波”和和平结束二者中较晚的时刻算起。人数在这个区间内随机。',
          },
        },
        {
          list: [
            '同时只有一波在行动。下一波在[[building:barracks|兵营]]前集结。',
            '集结最多{{ai.gatherMinutes}}分钟。之后按表中下限的人数出发，人数不够时能走到的全部出发。',
          ],
        },
        {
          h: '何时出发',
        },
        {
          list: [
            '电脑比较自己和你的军队实力，算武器、护甲、护符、生命值和治疗药水，不算经验。',
            '你箭塔上的弓手按{{ai.towerPostWeight}}算。',
            '每台电脑开局随机选一个计划。进攻型在有你{{ai.planAggressivePct}}%的实力时出发，防守型要到{{ai.planDefensivePct}}%，其余的到{{ai.planBalancedPct}}%。',
            '迷雾中它按看见过的东西算。对你一无所知时，就当你和它一样强。',
            '实力不够时，这波在兵营前等待，集结结束后也一样。',
            '电脑军队达到上限时，照样出发。',
            '你攻打它的聚落，或比它强{{ai.defendRatio}}倍时，它把军队留在家里，在路上的波次也会折返。',
          ],
        },
        {
          h: '突袭',
        },
        {
          list: [
            '{{ai.raidMen}}人的小队去打你的采集者和经济建筑。它绕开箭塔的射程，没有这样的路就不出发。',
            '困难电脑在{{ai.raidChancePct}}%的对局里这样做，开局在岛上时除外。骚扰计划在任何难度下都这样做。',
            '第一次突袭在和平结束后{{ai.raidMinMinutes}}-{{ai.raidMaxMinutes}}分钟出发，之后间隔差不多。',
          ],
        },
        {
          h: '目标',
        },
        {
          steps: ['最近的[[building:headquarters|大本营]]。', '箭塔。', '其他建筑，包括工地。', '人。'],
        },
        {
          list: [
            '木栅栏和[[building:work_pottery_02|防御墙]]不是目标：[[article:walls|木栅栏与栅门]]。',
            '迷雾中，电脑知道地图开局时的建筑和它看见过的建筑。新建筑要等它看见才知道。',
          ],
        },
        {
          h: '水路',
        },
        {
          list: [
            '步行的波次只走电脑兵营所在的那片陆地。你在那片陆地上的建筑或人员会成为目标。',
            '对手大本营在别的陆地时，电脑在岸边建[[building:work_joinery_03|四级木匠坊]]，造[[good:ship_small|船]]，用船运兵。',
            '岸边有{{ai.landingShips}}艘船（弱一些的电脑更少），且军队比守军强{{ai.landingEdge}}倍时，登陆部队出发。每艘船载{{vehicle.shipSeats}}名士兵。',
            '它在你的箭塔和防御模式建筑的射程外靠岸，尽量靠近大本营，然后冲向大本营。',
            '在陆地上损失{{ai.landingRetreatPct}}%的人后，其余的人回到船上。下一次登陆最早在{{ai.landingCooldownMinutes}}分钟后。',
          ],
        },
        {
          h: '重建',
        },
        {
          p: '大厅里设为“地图 AI”的玩家，在{{ai.rebuildNear}}格内没有敌人且有自家平民时重建建筑。大本营不重建。',
        },
      ],
      see: ['article:defence', 'article:walls', 'article:catapult', 'article:fog', 'article:diplomacy'],
    },
  ],
};
