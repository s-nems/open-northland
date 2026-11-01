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
          p: '大厅选项“居民需求：关闭”会冻结所有需求条，也不会再有人挨饿。此时本文不适用。',
        },
        {
          h: '需求条',
        },
        {
          table: {
            head: ['需求条', '自然下降', '工作时下降', '补充方式', '降到0%时'],
            rows: [
              [
                '体力',
                '{{need.drainMinutes}}分钟掉100%',
                '是',
                '[[article:food|进餐]]',
                '[[article:health|{{need.starveMinutes}}分钟后死亡]]',
              ],
              ['耐力', '{{need.drainMinutes}}分钟掉100%', '是', '睡觉', '生命值不变'],
              ['社交', '{{need.drainMinutes}}分钟掉100%', '否', '聊天', '无惩罚'],
              ['信仰', '否', '仅武器和护甲', '[[article:religion|祈祷]]', '不开工消耗信仰的批次'],
            ],
            foot: '开局时每条需求随机为{{need.startMinPct}}-100%。没有[[good:shoes|鞋子]]时，每走一步按地面不同扣{{need.barefootStepMinPct}}-{{need.barefootStepMaxPct}}%体力，负重时翻倍。',
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
              ['{{need.overfillPct}}%', '上限。在家进餐和用家具睡觉可以存下超过100%的部分。'],
            ],
            foot: '[[job:armorer|武器匠]]和[[job:smith|铁匠]]会自己去祈祷。[[job:sewer|裁缝]]消耗信仰，但只有下令才祈祷。',
          },
        },
        {
          h: '居民的行动优先级',
        },
        {
          steps: [
            '防御模式：避难。',
            '[[article:draughts|饮品与护符]]，原地使用。',
            '体力：进食。',
            '耐力：睡觉。',
            '信仰：祈祷。',
            '玩家命令：兵营、装备、箭塔。',
            '社交：聊天。',
            '工作。',
          ],
        },
        {
          p: '没东西吃、没地方祈祷时，居民回去工作，需求条继续下降。{{reach.walk}}格内没有住所就露天睡觉。',
        },
        {
          p: '士兵战斗中只吃随身带的或箭塔存粮。进食命令会打断战斗。',
        },
        {
          h: '睡眠',
        },
        {
          table: {
            head: ['对象', '睡眠时长', '在外', '在家', '在家有家具'],
            rows: [
              [
                '有住所的男性',
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
          h: '谁没有需求条',
        },
        {
          table: {
            head: ['对象', '需求条'],
            rows: [
              ['婴儿、儿童', '没有。成年时每条都是100%。'],
              ['[[article:heroes|英雄]]', '没有。'],
              ['怪物、动物', '没有。'],
              ['士兵', '没有社交。'],
              ['手推车乘客', '需求条和生命值冻结。'],
              ['船上乘客', '吃货舱里的食物，按在外睡觉，可以聊天。信仰等到上岸。'],
            ],
          },
        },
        {
          h: '进食、睡觉、聊天、祈祷命令',
        },
        {
          list: [
            '需求条多高都能下令。命令会打断行军、攻击和战斗。',
            '满足不了需求时命令会等待。后面还有排队的命令时，这条直接作废。',
            '英雄不接受这些命令。“祈祷”只对会祈祷的职业有效。',
          ],
        },
        {
          h: '“进食与睡眠”开关',
        },
        {
          table: {
            head: ['士兵', '“允许”', '“禁止”'],
            rows: [
              ['自己去吃饭、睡觉、祈祷', '是', '否'],
              ['自己吃随身食物或箭塔存粮', '是', '否'],
              ['饥饿打断长命令', '是', '否'],
            ],
            foot: '饮品、护符以及进食、睡觉、祈祷命令在两种状态下都有效。命令菜单里这两种状态叫“允许休整”和“禁止休整”。只有士兵有这个开关，默认“允许”，换职业后恢复“允许”。',
          },
        },
        {
          p: '“禁止”又没有饮品，士兵会饿死。下达进食命令或改回“允许”可救。',
        },
        {
          h: '饥饿与长命令',
        },
        {
          list: [
            '体力到{{need.criticalPct}}%时，居民离开行军、侦察或命令队列。状态显示“饿了，去吃东西”。',
            '吃到{{need.satedPct}}%，然后从头执行命令。',
            '找不到吃的就回去执行命令，{{meal.breakRetrySeconds}}秒后再找。',
            '给饥饿的人下新命令时新命令优先：{{meal.breakRetrySeconds}}秒内饥饿不会打断他。',
            '耐力要等所有命令执行完。',
          ],
        },
        {
          h: '戒备中',
        },
        {
          p: '这是[[article:stances|进攻或防御姿态]]的士兵靠近战斗时的状态，不是玩家开启的[[article:defence|聚落防御模式]]。',
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
              ['已婚者在家补需求条', '-', '社交100%。'],
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
      lead: '食物包括面包、肉和鱼。同样一餐在家吃，体力加倍。',
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
          h: '食物来源',
        },
        {
          table: {
            head: ['物资', '来源', '算作'],
            rows: [
              [
                '[[good:bread|面包]]',
                '[[building:work_bakery_00|一级烘焙坊]]、[[building:work_bakery_01|二级烘焙坊]]',
                '食物',
              ],
              ['[[good:candy|饼干]]', '[[building:work_bakery_01|二级烘焙坊]]', '蛋糕'],
              ['[[good:meat|肉]]', '[[building:work_animal_farm|畜牧场]]、[[job:hunter|猎人]]', '食物'],
              ['[[good:fish|鱼]]', '[[job:fisher|渔夫]]', '食物'],
            ],
            foot: '居民也吃工坊货架上的食物。在仓库先拿食物，没有食物才拿饼干。成熟的灌木就地吃，吃完灌木变空。',
          },
        },
        {
          h: '在哪里吃',
        },
        {
          steps: [
            '自家存粮，住所门口最多{{reach.walk}}格远。',
            '{{reach.goods}}格内最近的仓库、工坊或地面堆垛，或{{reach.bushAtHand}}格内的成熟灌木。',
            '{{reach.goods}}格内最近的成熟灌木。',
            '步行范围内任何地方最近的食物，包括较远的自家。',
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
            '拿1份回家，存粮按食物或蛋糕入账。',
            '家里有[[good:crockery|陶器]]时，运回1份算2份存粮。',
          ],
        },
        {
          p: '没别的事做的妇女会一直运，直到存粮满。存粮上限见[[article:family|家庭与住所]]。',
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
            head: ['来源', '变化', '条件', '{{health.human}}点所需时间'],
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
            foot: '自动恢复和光环叠加，共{{aura.totalPerSecond}}/秒。自动恢复到{{health.human}}为止，光环可超上限治疗到{{aura.ceiling}}。儿童和英雄同样有{{health.human}}点并会自动恢复。',
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
            '先喝开过封的，再喝小瓶，最后喝大瓶。',
          ],
        },
      ],
      see: ['article:draughts', 'article:needs', 'article:religion', 'good:potion_heal_small'],
    },
    {
      id: 'life',
      name: '生与死',
      lead: '儿童出生{{age.adultMinutes}}分钟后成年。成年人只要有生命值就一直活着。',
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
                '步速慢一倍。',
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
            foot: '一岁等于{{age.yearSeconds}}秒。没有职业的平民等待分配。',
          },
        },
        {
          h: '死后留下什么',
        },
        {
          table: {
            head: ['物品', '去向'],
            rows: [
              ['携带的物资', '全部掉在地上。'],
              ['[[good:shoes|鞋子]]、工具', '磨损不超过{{death.newWearPct}}%时按新品掉落，否则消失。'],
              ['武器', '仅士兵掉落。'],
              ['护甲', '一定掉落。'],
              ['饮品、护符', '掉落护符和未开封的瓶子。'],
              ['搬运工推车', '连同货物留在原地。'],
              ['遗体', '人留下骸骨。动物留下[[article:wildlife|肉]]。'],
            ],
          },
        },
        {
          p: '已发现的[[article:trades|职业]]留在聚落。对配偶的影响见[[article:family|家庭与住所]]。',
        },
      ],
      see: ['article:family', 'article:health', 'article:trades'],
    },
    {
      id: 'family',
      name: '家庭与住所',
      lead: '生一个孩子花{{family.childFood}}份存粮，一对夫妇一次只养一个孩子。',
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
            '只有“结婚”命令才能结婚，居民不会自己成婚。',
            '命令把居民和最近的异性成人配对，须同一民族、同一玩家。',
            '对象必须在该居民的[[article:roads|路标]]范围内。找不到对象时命令作废，显示“无人可婚”。',
            '士兵、英雄、侦察兵，以及被派往[[building:barracks|兵营]]或[[building:school|学校]]的居民不能结婚。',
            '夫妇住在妻子家。妻子没有住所时住在丈夫家。',
          ],
        },
        {
          h: '生孩子',
        },
        {
          steps: [
            '玩家选择：“生个儿子”或“生个女儿”。',
            '存粮少于{{family.childFood}}份时，妻子去运粮。',
            '夫妇俩进屋。',
            '存粮减少{{family.childFood}}份。',
            '维京人{{family.birthVikingSeconds}}秒后出生，其他民族{{family.birthOtherSeconds}}秒后出生。',
          ],
        },
        {
          table: {
            head: ['生育受阻原因', '解决办法'],
            rows: [
              ['妻子没有住所', '分配住所。'],
              ['住所还在建造', '建完。'],
              ['丈夫是士兵、[[job:trader|商人]]或[[job:scout|侦察兵]]', '给他换职业。'],
              ['夫妻分居', '分配同一座住所。'],
              ['范围内没有食物', '把食物运到附近仓库。'],
            ],
          },
        },
        {
          p: '上一个孩子成年后才能生下一个，也就是{{age.adultMinutes}}分钟后。孩子不占住所的家庭名额。',
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
          p: '存粮的食物和蛋糕分开计算：一级民居可存{{home.larder}} + {{home.candyLarder}}份。一户是一名成人、其配偶和未成年的孩子。住所可以属于玩家的任何民族。',
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
              ['全体住户', '住所被拆毁时失去住所。'],
              ['全家', '“搬出住所”命令后失去住所。'],
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
            foot: '范围0-{{assistant.counterMax}}，初始为0。对单个人下的命令优先于助手。武器和护甲的顺序见[[article:equip|士兵装备]]。',
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
              ['铁质工具、木质工具', '开', '从事职业工作的人，不含士兵、[[job:scout|侦察兵]]和平民'],
              ['[[good:mead|蜂蜜酒]]', '开', '平民、士兵'],
              ['营养药水、耐力药水、治疗药水', '关', '平民、士兵'],
              ['护符：营养、耐力、力量、防御、精准、疾风', '关', '平民、士兵'],
              ['学校毕业生自动分配到工坊', '关', '[[building:school|学校]]毕业生'],
              ['采集者自动移动旗帜', '开', '插了旗的[[job:collector|采集者]]'],
            ],
            foot: '饮品和护符可用“平民”和“士兵”按钮选择发放对象，初始都开。关掉不会收回任何东西，已有的继续留着。',
          },
        },
        {
          h: '生育',
        },
        {
          list: [
            '先女儿后儿子。女儿不能设为∞，否则永远轮不到儿子。',
            '计数器为3表示最多3对夫妇同时生育。',
            '一对夫妇一次接一单。受阻原因和手动下令相同：[[article:family|家庭与住所]]。',
            '调低计数器不会取消夫妇已接的单。',
          ],
        },
        {
          h: '征兵去兵营',
        },
        {
          list: [
            '只征没有工作场所、没有任务的成年平民，未婚者优先。不会抽走在职的人。',
            '兵种计数器优先武装范围内有武器可拿的徒手士兵。',
          ],
        },
        {
          table: {
            head: ['征兵停止的原因', '解决办法'],
            rows: [
              ['没有建成的[[building:barracks|兵营]]', '建完兵营。'],
              ['没有空闲平民', '手动派人去兵营。'],
              ['徒手士兵在等该兵种的武器', '提供武器。在此之前他占着新兵的名额。'],
            ],
            foot: '每秒最多{{assistant.draftsPerSecond}}人。在路上的新兵计入计数器，损失的新兵回到队列。',
          },
        },
        {
          h: '发放',
        },
        {
          list: [
            '跳过妇女、儿童、[[article:heroes|英雄]]和箭塔驻军。',
            '去一趟仓库，顺便领齐其余物品。',
            '仓库里每1份物资只派一名居民去领。不动用低于[[article:hauling|最低库存]]的物资。',
            '只补空位，不换更好的。铁质工具先于木质工具，大瓶先于小瓶。',
            '有小瓶的人不再去领大瓶。饮品和护符共{{amulet.slots}}个栏位：[[article:draughts|饮品与护符]]。',
          ],
        },
        {
          h: '毕业生',
        },
        {
          list: [
            '毕业生只分配一次，去本职业最近的空缺，工坊工地也算。能做该课程产品的工坊优先，哪怕离得更远。',
            '没有空缺就在学校旁等待。[[job:collector|采集者]]、[[job:hunter|猎人]]、[[job:fisher|渔夫]]和士兵不参与。',
          ],
        },
        {
          p: '旗帜跟着资源移动，与其相距{{assistant.flagMin}}-{{assistant.flagMax}}格：[[article:work-flag|工作旗帜]]。',
        },
        {
          p: '“臣民”窗口统计缺口：住所、工作场所、工具、鞋子、配偶、孩子、武器、蜂蜜酒。',
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
                '体力或耐力不超过{{need.drivePct}}%',
              ],
              [
                '[[good:potion_food_small|小型]] / [[good:potion_food_big|大型营养药水]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '体力+{{draught.potionPct}}%',
                '体力不超过{{need.drivePct}}%',
              ],
              [
                '[[good:potion_stamina_small|小型]] / [[good:potion_stamina_big|大型耐力药水]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '耐力+{{draught.potionPct}}%',
                '耐力不超过{{need.drivePct}}%',
              ],
              [
                '[[good:potion_heal_small|小型]] / [[good:potion_heal_big|大型治疗药水]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '生命值+{{draught.healSip}}',
                '受伤后生命值将低于{{draught.healBelow}}',
              ],
            ],
            num: [1],
            foot: '进食或睡觉命令期间暂停饮用。',
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
                '每次体力不超过{{need.drivePct}}%时',
              ],
              [
                '[[good:amulet_stamina|耐力护符]]',
                '耐力+{{amulet.needPct}}%',
                '每次耐力不超过{{need.drivePct}}%时',
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
            '不同护符同时生效：力量加精准，暴击时×{{amulet.comboFactor}}。',
            '补需求的顺序：开过封的瓶子、护符、剩余口数较少的瓶子。',
            '因体力喝下的蜂蜜酒也会补耐力。',
            '有营养护符的居民不找吃的，有耐力护符的不去睡觉。',
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
