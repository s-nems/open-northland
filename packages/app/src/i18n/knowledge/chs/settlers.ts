import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const SETTLERS: ArticleGroup = {
  group: '居民',
  items: [
    {
      id: 'needs',
      name: '需求',
      lead: '需求条降到{{need.drivePct}}%时，居民会丢下工作去补足。',
      blocks: [
        {
          p: '大厅选项“居民需求：关闭”会冻结所有需求条，也不会再有人挨饿。',
        },
        {
          h: '需求条',
        },
        {
          table: {
            head: ['需求条', '随时间下降', '工作时下降', '补充方式', '降到0%时'],
            rows: [
              [
                '体力',
                '{{need.drainMinutes}}分钟掉100%',
                '是',
                '[[article:food|进餐]]',
                '[[article:health|{{need.starveMinutes}}分钟后死亡]]',
              ],
              ['耐力', '{{need.drainMinutes}}分钟掉100%', '是', '睡觉', '只是走得慢'],
              ['社交', '{{need.drainMinutes}}分钟掉100%', '否', '聊天', '无惩罚'],
              ['信仰', '否', '仅武器和护甲', '[[article:religion|祈祷]]', '不制作武器和护甲'],
            ],
            foot: '地图开始时每条需求随机为{{need.startMinPct}}-100%。没有[[good:shoes|鞋子]]时，每走一步按地面不同扣{{need.barefootStepMinPct}}-{{need.barefootStepMaxPct}}%体力，负重时翻倍。',
          },
        },
        {
          h: '阈值',
        },
        {
          figure: {
            id: 'need-bar',
            caption: '需求条各段的含义',
          },
        },
        {
          table: {
            head: ['数值', '发生什么'],
            rows: [
              ['{{need.criticalPct}}%', '发出体力、耐力或信仰通知。'],
              ['{{need.drivePct}}%', '做完手头动作后丢下工作。耐力到此值时，每步慢{{step.tiredExtra}}秒。'],
              ['{{need.satedPct}}%', '居民在家先补耐力，再补体力，补到此值后出门。'],
              ['{{need.overfillPct}}%', '需求条上限。在家进餐和在家用家具睡觉可以存下超过100%的部分。'],
            ],
            foot: '[[job:armorer|武器匠]]、[[job:smith|铁匠]]和[[job:sewer|裁缝]]会自己去祈祷。',
          },
        },
        {
          h: '睡眠',
        },
        {
          table: {
            head: ['对象', '睡眠时长', '在外', '在家', '在家有家具'],
            rows: [
              [
                '男性',
                '{{sleep.manSeconds}}秒',
                '+{{sleep.manAwayPct}}%',
                '+{{sleep.manHomePct}}%',
                '+{{sleep.manFurnishedPct}}%',
              ],
              [
                '[[job:woman|妇女]]',
                '{{sleep.womanSeconds}}秒',
                '+{{sleep.womanAwayPct}}%',
                '+{{sleep.womanHomePct}}%',
                '+{{sleep.womanFurnishedPct}}%',
              ],
              ['商人、侦察兵', '{{sleep.manSeconds}}秒', '+{{sleep.manHomePct}}%', '-', '-'],
              ['士兵', '{{sleep.soldierSeconds}}秒', '+{{sleep.soldierPct}}%', '-', '-'],
            ],
            num: [1, 2, 3, 4],
          },
        },
        {
          h: '例外',
        },
        {
          table: {
            head: ['对象', '需求条'],
            rows: [
              ['婴儿、儿童', '没有。成年时每条都是100%。'],
              ['[[article:heroes|英雄]]', '没有。'],
              ['怪物、动物', '没有。'],
              ['士兵', '没有社交。'],
              ['车上乘客', '需求条不下降，生命值不变。'],
              ['船上乘客', '吃货舱里的食物，按在外睡觉，可以聊天。上岸后才去祈祷。'],
            ],
          },
        },
        {
          h: '信仰与社交',
        },
        {
          table: {
            head: ['活动', '时长', '效果'],
            rows: [
              [
                '祈祷',
                '{{pray.seconds}}秒',
                '信仰+{{pray.pct}}%。重复到100%，除非体力或耐力降到{{need.drivePct}}%。',
              ],
              ['聊天', '{{talk.shortSeconds}}-{{talk.longSeconds}}秒', '社交最多+{{talk.pct}}%。'],
              ['已婚者待在家里', '-', '社交100%。'],
            ],
            num: [1],
          },
        },
      ],
      see: [
        'article:food',
        'article:health',
        'article:draughts',
        'article:religion',
        'article:walking',
        'article:stances',
      ],
    },
    {
      id: 'food',
      name: '饮食',
      lead: '食物包括面包、肉和鱼。在家吃的一餐，体力加倍。',
      blocks: [
        {
          h: '进餐效果',
        },
        {
          table: {
            head: ['食物', '在外体力', '在家体力', '社交'],
            rows: [
              ['[[good:bread|食物]]', '+{{meal.plainPct}}%', '+{{meal.plainHomePct}}%', '-'],
              [
                '[[good:candy|饼干]]',
                '+{{meal.candyPct}}%',
                '+{{meal.candyHomePct}}%',
                '+{{meal.candyCompanyPct}}%',
              ],
              ['成熟的灌木', '+{{meal.plainPct}}%', '-', '-'],
            ],
            num: [1, 2, 3],
            foot: '一餐{{meal.seconds}}秒，吃掉1份。士兵不在家吃饭，饼干对他和普通食物一样：+{{meal.plainPct}}%。',
          },
        },
        {
          p: '居民也吃工坊库存里的食物。在仓库先拿食物，然后拿饼干。',
        },
        {
          h: '在哪里吃',
        },
        {
          steps: [
            '自家存粮，住所门口最多{{reach.walk}}格远。',
            '{{reach.goods}}格内最近的仓库、工坊或地面堆垛，或{{reach.bushAtHand}}格内的成熟灌木。',
            '{{reach.goods}}格内最近的成熟灌木。',
            '居民走得到的任何地方最近的食物，包括较远的自家。',
          ],
        },
        {
          p: '别家的存粮和其他玩家的储备都吃不到，灌木不归任何人。[[article:roads|路标]]能扩大这些范围。低于[[article:hauling|最低库存]]的物资，没人会吃，也没人会拿回家。',
        },
        {
          h: '往家里运粮',
        },
        {
          steps: [
            '有已建成住所的[[job:woman|妇女]]寻找住所以外最近的食物。',
            '拿1份回家。',
            '家里有[[good:crockery|陶器]]时，运回1份算2份存粮。',
          ],
        },
        {
          p: '妇女一直运，直到存粮满。存粮上限见[[article:family|家庭与住所]]。',
        },
      ],
      see: ['article:needs', 'article:family', 'article:gathering', 'good:bread', 'good:candy'],
    },
    {
      id: 'health',
      name: '生命与治疗',
      lead: '人有{{health.human}}点生命值，{{health.regenMinutes}}分钟可自动回满。',
      blocks: [
        {
          h: '生命值的增减',
        },
        {
          table: {
            head: ['来源', '变化', '条件', '全部生命值所需时间'],
            rows: [
              [
                '自动恢复',
                '+{{health.regenPerSecond}}/秒',
                '体力高于0%，战斗中也有效',
                '{{health.regenWholeMin}}分{{health.regenRestSec}}秒',
              ],
              [
                '[[article:religion|神庙光环]]',
                '+{{aura.perSecond}}/秒',
                '距[[building:work_temple|神庙]]{{aura.range}}格',
                '{{aura.wholeMin}}分{{aura.restSec}}秒',
              ],
              ['治疗药水', '每口+{{draught.healSip}}', '受伤后将低于{{draught.healBelow}}', '-'],
              [
                '饥饿',
                '-{{health.starvePerSecond}}/秒',
                '体力0%',
                '{{health.starveWholeMin}}分{{health.starveRestSec}}秒',
              ],
            ],
            num: [1, 3],
            foot: '自动恢复和光环加起来是每秒{{aura.totalPerSecond}}。自动恢复到{{health.human}}为止，但光环可超上限治疗到{{aura.ceiling}}。',
          },
        },
        {
          p: '生命值到{{health.nearDeath}}时，游戏会通知该居民濒临死亡。',
        },
        {
          h: '治疗药水',
        },
        {
          list: [
            '[[good:potion_heal_small|小型治疗药水]]有{{draught.smallUses}}口，共{{draught.healSmallTotal}}点。[[good:potion_heal_big|大型治疗药水]]有{{draught.bigUses}}口，共{{draught.healBigTotal}}点。',
            '居民一口接一口地喝，直到扣除伤害后至少还剩{{draught.healBelow}}点。',
            '只要药水够抵消伤害，致命一击也杀不死。',
            '饿到生命值低于{{draught.healBelow}}时也会喝。',
          ],
        },
      ],
      see: ['article:draughts', 'article:needs', 'article:religion', 'good:potion_heal_small'],
    },
    {
      id: 'life',
      name: '成长',
      lead: '儿童出生{{age.adultMinutes}}分钟后成年。没有人会老死。',
      blocks: [
        {
          h: '人生阶段',
        },
        {
          table: {
            head: ['阶段', '年龄', '出生后', '备注'],
            rows: [
              [
                '婴儿',
                '0-{{age.babyLastYear}}岁',
                '0-{{age.childWholeMin}}分{{age.childRestSec}}秒',
                '每步时间翻倍。',
              ],
              [
                '儿童',
                '{{age.childYears}}-{{age.childLastYear}}岁',
                '{{age.childWholeMin}}分{{age.childRestSec}}秒-{{age.adultMinutes}}分',
                '每步慢{{step.childExtra}}秒。在家附近活动。',
              ],
              [
                '成人',
                '{{age.adultYears}}岁起',
                '{{age.adultMinutes}}分钟起',
                '男孩成为[[job:civilist|平民]]，女孩成为[[job:woman|妇女]]。',
              ],
            ],
            foot: '一岁等于{{age.yearSeconds}}秒。',
          },
        },
      ],
      see: ['article:family', 'article:health', 'article:trades'],
    },
    {
      id: 'family',
      name: '家庭与住所',
      lead: '生一个孩子需要{{family.childFood}}份食物。',
      blocks: [
        {
          h: '分配住所',
        },
        {
          list: [
            '只有“分配住所”命令能给人住所。没人会自己搬进去，结婚也只会搬动配偶。',
            '一座住所能住几户，看等级表的“家庭”列。住满后命令无效。',
            '重新分配会搬走全家：本人、配偶和未成年的孩子。',
          ],
        },
        {
          h: '结婚',
        },
        {
          list: [
            '结婚要下“结婚”命令。',
            '命令把居民和最近的异性成人配对，须同一民族、同一玩家。',
            '对象必须在该居民的[[article:roads|路标]]范围内。找不到对象时命令作废，显示“无人可婚”。',
            '士兵、英雄、侦察兵，以及被派往[[building:barracks|兵营]]或[[building:school|学校]]的居民不能结婚。',
            '夫妇住在妻子家。妻子没有住所时住在丈夫家。',
          ],
        },
        {
          h: '住所等级',
        },
        {
          figure: {
            id: 'home-levels',
            caption: '住所等级',
          },
        },
        {
          data: 'homes',
        },
        {
          p: '存粮的食物和饼干分开计算：一级民居可存{{home.larder}} + {{home.candyLarder}}份。居民可以住在同一玩家其他民族的住所里。',
        },
        {
          h: '家中用品',
        },
        {
          table: {
            head: ['物资', '起始等级', '效果', '1份可用', '妇女补货线'],
            rows: [
              [
                '[[good:crockery|陶器]]',
                '1级民居',
                '运粮时每份算2份',
                '{{home.crockeryDeliveries}}次运粮',
                '{{home.crockeryFetchBelow}}',
              ],
              [
                '[[good:furniture|家具]]',
                '1级民居',
                '睡眠×2',
                '男性睡{{home.furnitureManSleeps}}次，女性睡{{home.furnitureWomanSleeps}}次',
                '{{home.furnitureFetchBelow}}',
              ],
              [
                '[[good:holy_oil|油]]',
                '3级民居',
                '[[article:religion|圣火]]：可在屋前祈祷',
                '{{oil.wholeMin}}分{{oil.restSec}}秒',
                '{{home.oilFetchBelow}}',
              ],
            ],
            num: [4],
            foot: '这些物资每种最多存{{home.wareUnits}}份。油一直燃烧，没人祈祷时也一样。',
          },
        },
        {
          p: '在住所面板可以为全聚落关闭陶器、家具的使用和油的运送。已存入的油继续燃烧。',
        },
        {
          h: '谁会失去住所',
        },
        {
          table: {
            head: ['对象', '结果'],
            rows: [
              ['鳏夫', '孩子成年或夭折后失去住所。'],
              ['寡妇', '留在家中。'],
              ['成年子女', '成年时失去住所。'],
              ['商人、侦察兵、士兵', '住所留给家人，但他本人不在家吃住。'],
            ],
          },
        },
      ],
      see: [
        'article:life',
        'article:food',
        'article:religion',
        'article:assistant',
        'building:home_level_00',
        'good:crockery',
        'good:furniture',
      ],
    },
    {
      id: 'assistant',
      name: '助手',
      lead: '计数器下单生孩子和招新兵，开关把库存装备发下去。',
      blocks: [
        {
          h: '计数器',
        },
        {
          table: {
            head: ['计数器', '下单内容', '执行者', '何时减少', '可设无限'],
            rows: [
              ['女儿', '女孩', '有住所的已婚妇女', '出生时', '否'],
              ['儿子', '男孩', '有住所的已婚妇女', '出生时', '是'],
              ['徒手士兵', '新兵', '[[job:civilist|平民]]', '训练完成后', '是'],
              ['剑兵、矛兵、弓箭手', '武器，然后新兵', '徒手士兵，然后平民', '拿到武器时', '是'],
            ],
            foot: '计数器可设为0到{{assistant.counterMax}}。对单个人下的命令优先于助手。武器和护甲的顺序见[[article:equip|士兵装备]]。',
          },
        },
        {
          h: '开关',
        },
        {
          table: {
            head: ['开关', '初始', '发给谁'],
            rows: [
              ['[[good:shoes|鞋子]]', '开', '成年男性'],
              ['铁质工具、木质工具', '开', '除士兵、[[job:scout|侦察兵]]和平民外的所有在职者'],
              ['[[good:mead|蜂蜜酒]]', '开', '平民、士兵'],
              ['营养药水、耐力药水、治疗药水', '关', '平民、士兵'],
              ['护符：营养、耐力、力量、防御、精准、疾风', '关', '平民、士兵'],
              ['学校毕业生自动分配到工坊', '关', '[[building:school|学校]]毕业生'],
              ['采集者自动移动旗帜', '开', '插了旗的[[job:collector|采集者]]'],
            ],
            foot: '饮品和护符可用“平民”和“士兵”按钮选择发放对象，初始都开。关掉不会收回已发的东西。',
          },
        },
        {
          h: '生育',
        },
        {
          list: [
            '先生女儿，再生儿子。所以女儿计数器不能设为∞，否则永远生不出儿子。',
            '计数器为3时，最多3对夫妇同时等着生孩子。',
          ],
        },
        {
          h: '征兵去兵营',
        },
        {
          list: [
            '只有没工作、闲着的成年平民才去兵营，未婚者优先。助手不会把人从工作中抽走。',
            '剑兵、矛兵或弓箭手计数器优先武装范围内有武器可拿的徒手士兵。',
          ],
        },
        {
          table: {
            head: ['征兵停止的原因', '解决办法'],
            rows: [
              ['没有建成的[[building:barracks|兵营]]', '建完兵营。'],
              ['没有空闲平民', '手动派人去兵营。'],
              ['徒手士兵在等这类武器', '提供武器。在此之前他占着新兵的名额。'],
            ],
            foot: '去兵营路上的新兵已计入计数器。',
          },
        },
        {
          h: '发放',
        },
        {
          list: [
            '助手不给妇女、儿童、[[article:heroes|英雄]]和箭塔驻军发东西。',
            '低于[[article:hauling|最低库存]]的物资助手不会发放。',
            '它只补空位，不会把东西换成更好的。铁质工具先于木质工具。',
            '每个居民有{{amulet.slots}}个饮品和护符栏位：[[article:draughts|饮品与护符]]。',
          ],
        },
        {
          h: '毕业生',
        },
        {
          list: [
            '毕业生去本职业最近的空缺，在建的工坊也算。能做他所学产品的工坊优先，哪怕离得更远。',
            '没有空缺就在学校旁等待。助手不给[[job:collector|采集者]]、[[job:hunter|猎人]]、[[job:fisher|渔夫]]和士兵分配工作。',
          ],
        },
        {
          p: '旗帜旁的资源用完时，助手会把旗帜移到下一处资源附近，与其相距{{assistant.flagMin}}-{{assistant.flagMax}}格：[[article:work-flag|工作旗帜]]。',
        },
        {
          p: '“臣民”窗口显示有多少居民缺少住所、工作、工具、鞋子、配偶、孩子、武器或蜂蜜酒。',
        },
      ],
      see: [
        'article:family',
        'article:equip',
        'article:draughts',
        'article:tools',
        'article:work-flag',
        'building:barracks',
      ],
    },
    {
      id: 'draughts',
      name: '饮品与护符',
      lead: '居民原地饮用，手上的事不停。护符不会耗损。',
      blocks: [
        {
          h: '饮品',
        },
        {
          table: {
            head: ['饮品', '口数', '每口效果', '何时饮用'],
            rows: [
              [
                '[[good:mead|蜂蜜酒]]',
                '{{draught.meadUses}}',
                '体力+{{draught.meadPct}}%，耐力+{{draught.meadPct}}%',
                '体力或耐力降到{{need.drivePct}}%',
              ],
              [
                '[[good:potion_food_small|小型]] / [[good:potion_food_big|大型营养药水]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '体力+{{draught.potionPct}}%',
                '体力降到{{need.drivePct}}%',
              ],
              [
                '[[good:potion_stamina_small|小型]] / [[good:potion_stamina_big|大型耐力药水]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '耐力+{{draught.potionPct}}%',
                '耐力降到{{need.drivePct}}%',
              ],
              [
                '[[good:potion_heal_small|小型]] / [[good:potion_heal_big|大型治疗药水]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '生命值+{{draught.healSip}}',
                '受伤后生命值将低于{{draught.healBelow}}',
              ],
            ],
            num: [1],
          },
        },
        {
          h: '护符',
        },
        {
          table: {
            head: ['护符', '效果', '触发时机'],
            rows: [
              [
                '[[good:amulet_food|营养护符]]',
                '体力+{{amulet.needPct}}%',
                '每次体力降到{{need.drivePct}}%时',
              ],
              [
                '[[good:amulet_stamina|耐力护符]]',
                '耐力+{{amulet.needPct}}%',
                '每次耐力降到{{need.drivePct}}%时',
              ],
              ['[[good:amulet_strength|力量护符]]', '造成伤害×{{amulet.strengthFactor}}', '每次攻击'],
              [
                '[[good:amulet_crithit|精准护符]]',
                '{{amulet.critChancePct}}%几率伤害×{{amulet.critFactor}}',
                '每次攻击',
              ],
              ['[[good:amulet_defense|防御护符]]', '受到伤害×{{amulet.defenseFactor}}', '每次受击'],
              ['[[good:amulet_speed|疾风护符]]', '每步快{{step.amuletSaved}}秒', '每一步'],
            ],
          },
        },
        {
          h: '同时佩戴',
        },
        {
          list: [
            '相同护符第二枚无效。',
            '不同护符同时生效：力量加精准，触发时×{{amulet.comboFactor}}。',
            '有营养护符的居民从不去吃饭，有耐力护符的从不去睡觉。',
          ],
        },
        {
          h: '谁能佩戴',
        },
        {
          table: {
            head: ['对象', '可携带'],
            rows: [
              ['成年男性', '饮品和护符共{{amulet.slots}}个栏位，任何职业都一样。'],
              ['[[article:heroes|英雄]]', '治疗药水以及力量、精准、防御、疾风护符。'],
              ['妇女、儿童', '无。'],
            ],
          },
        },
      ],
      see: ['article:needs', 'article:health', 'article:damage', 'article:walking'],
    },
  ],
};
