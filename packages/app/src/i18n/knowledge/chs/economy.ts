import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: '经济',
  items: [
    {
      id: 'construction',
      name: '建造、升级与修理',
      lead: '一名建筑工人盖一座一级民居要{{build.noviceSeconds}}秒，用铁质工具要{{build.noviceIronSeconds}}秒。搬材料的时间另算。',
      blocks: [
        {
          h: '哪里能建造',
        },
        {
          table: {
            head: ['项目', '规则'],
            rows: [
              ['地形', '陆地、沙地、海滩和石漠都能建。山地、雪地、水面和沼泽不行。'],
              [
                '[[building:work_well_00|水井]]、[[building:work_hive_00|蜂房]]',
                '建筑边缘至少要有一点压在草地上。',
              ],
              ['空间', '建筑一开始就占下最高等级需要的位置，外加周围一圈窄边。两座建筑的窄边不能重叠。'],
              ['树木、岩石、矿藏、木栅栏', '必须在建筑最高等级的位置之外。'],
              [
                '敌方士兵',
                '他周围{{contest.radius}}格内不能建，斜向约{{contest.diagonal}}格。只算你看得见的士兵，箭塔驻军不算。',
              ],
              [
                '和平关系玩家的建筑',
                '距其建筑或工地{{peace.keepOut}}格内不能建，除非你自己的建筑离那里比他的更近。',
              ],
              ['迷雾中的地块', '不能建。那个位置此刻必须看得见。'],
              ['路标范围', '没关系。工地可以放在网络外，但要等网络覆盖到那里，建筑工人才会过去。'],
            ],
          },
        },
        {
          h: '建造时长',
        },
        {
          table: {
            head: ['[[building:home_level_00|一级民居]]，1名建筑工人', '敲击数', '时长'],
            rows: [
              ['没有经验，无工具', '{{build.noviceSwings}}', '{{build.noviceSeconds}}秒'],
              [
                '没有经验，[[good:tool_iron|铁质工具]]',
                '{{build.noviceIronSwings}}',
                '{{build.noviceIronSeconds}}秒',
              ],
              [
                '大师，[[good:tool_iron|铁质工具]]',
                '{{build.masterIronSwings}}',
                '{{build.masterIronSeconds}}秒',
              ],
            ],
            num: [1, 2],
            foot: '一级民居要{{build.homeUnits}}份材料。时长只算敲击，每次敲击{{build.swingSeconds}}秒。',
          },
        },
        {
          h: '每1份材料要敲的次数',
        },
        {
          table: {
            head: ['经验', '无工具', '木质', '铁质'],
            rows: [
              ['0-9%', '{{build.perUnit.0.bare}}', '{{build.perUnit.0.wooden}}', '{{build.perUnit.0.iron}}'],
              [
                '10-21%',
                '{{build.perUnit.10.bare}}',
                '{{build.perUnit.10.wooden}}',
                '{{build.perUnit.10.iron}}',
              ],
              [
                '22-49%',
                '{{build.perUnit.22.bare}}',
                '{{build.perUnit.22.wooden}}',
                '{{build.perUnit.22.iron}}',
              ],
              [
                '50-78%',
                '{{build.perUnit.50.bare}}',
                '{{build.perUnit.50.wooden}}',
                '{{build.perUnit.50.iron}}',
              ],
              [
                '79-89%',
                '{{build.perUnit.79.bare}}',
                '{{build.perUnit.79.wooden}}',
                '{{build.perUnit.79.iron}}',
              ],
              [
                '90-100%',
                '{{build.perUnit.90.bare}}',
                '{{build.perUnit.90.wooden}}',
                '{{build.perUnit.90.iron}}',
              ],
            ],
            num: [1, 2, 3],
            foot: '[[job:builder|建筑工人]]的经验只靠推进了工程的敲击增长：[[article:exp-work|工作经验]]。',
          },
        },
        {
          p: '材料由建筑工人和分配到工地的工人运过去，每次1份。',
        },
        {
          h: '建筑工人先做什么',
        },
        {
          p: '建筑工人先修理，再盖建筑，木栅栏和道路放到最后。你把他指派到某个工地后，他会一直留在那里，别处有活也不走。',
        },
        {
          h: '升级',
        },
        {
          list: [
            '花费新等级的材料。只要每一级都已解锁，就可以一次跨多级。',
            '升级需要的物资如果建筑库存里已经有，会直接用到工程上。',
            '升级期间工人和住户搬出去，完工后回到原来的位置。',
            '完工后建筑按新等级回满生命值。',
            '取消升级时建筑拿回自己的库存，但已运到的材料作废。',
          ],
        },
        {
          h: '修理',
        },
        {
          p: '建筑工人每敲一下给建筑回复{{repair.minPerSwing}}-{{repair.maxPerSwing}}点生命值，一座建筑最多同时由{{repair.crew}}名建筑工人修理。修理不花材料。木栅栏和栅门的修理方式不同，经验和工具对它们没有影响：[[article:walls|木栅栏与栅门]]。',
        },
        {
          p: '最后一次挨打后{{repair.calmSeconds}}秒内，或{{alert.standTo}}格内还在打仗时，建筑工人不会自己去修理。你下命令的话他马上就去。',
        },
        {
          h: '损失与返还',
        },
        {
          table: {
            head: ['情况', '剩下什么'],
            rows: [
              ['拆除工地', '已运到的材料留在地上'],
              ['拆除或摧毁建筑', '库存加一半成本，向上取整'],
            ],
            foot: '物资落在建筑{{reach.spill}}格内的地上，放不下的消失。',
          },
        },
      ],
      see: ['article:tools', 'article:walls', 'article:roads', 'article:exp-work', 'job:builder'],
    },
    {
      id: 'workshops',
      name: '工坊与产品选择',
      lead: '产品旁的计数器决定工人做多少批：0为停止，∞为不停。一批就是执行一次配方。',
      blocks: [
        {
          h: '计数器取值',
        },
        {
          table: {
            head: ['计数器', '工坊', '采集者'],
            rows: [
              ['0', '不做这种产品', '不采这种物资'],
              ['1-{{workshop.counterMax}}', '做这么多批，每批开工时计数减1', '采这么多份，每得一份计数减1'],
              ['∞', '不停，计数不减', '不停，计数不减'],
            ],
            foot: '经验和工具能让一批多出几份：[[article:tools|工具]]。',
          },
        },
        {
          h: '按钮',
        },
        {
          table: {
            head: ['按钮', '单击', 'Shift', 'Ctrl'],
            rows: [
              ['物资图标，“仅此产品”', '此物资∞，其余0', '-', '此物资在0和∞之间切换，其余不变'],
              ['减少', '-1。从0跳到∞，从∞跳到{{workshop.counterMax}}', '-10', '归0'],
              ['增加', '+1。从{{workshop.counterMax}}跳到∞，从∞跳到0', '+10', '设为∞'],
            ],
          },
        },
        {
          h: '计数器何时变化',
        },
        {
          p: '每名工人的计数器各管各的，所以同一工坊的2个人可以做2种产品。工人换工作场所或换职业时计数器清空，建筑被拆时也一样。升级不动它们，新等级的产品从0开始。',
        },
        {
          h: '同时做多种产品',
        },
        {
          p: '工人轮流做所有计数大于0的产品，每种1批，按面板上的顺序。',
        },
        {
          table: {
            head: ['情况', '工人怎么做'],
            rows: [
              ['产品库存已满', '换下一种产品'],
              ['缺少原料', '换下一种产品'],
              ['原料只有一部分', '等待补齐。无处可取时换下一种产品。'],
              ['经验不够做这种产品', '面板在计数器处显示“已锁定”，工人跳过这种产品'],
              ['有计数的产品全被锁定', '做已经会做的，包括计数为0的产品'],
            ],
          },
        },
        {
          h: '载具',
        },
        {
          p: '载具不在工坊里面造。工匠在旁边开车场，自己把材料运过去再建造。工坊旁放不下车场时，他换下一种产品。',
        },
        {
          h: '采集者',
        },
        {
          table: {
            head: ['情况', '结果'],
            rows: [
              ['“仅此物资”', '此物资∞，其余0'],
              ['右键点击资源', '“采集”命令：此物资∞，其余0。工作旗帜不动。'],
              ['Ctrl+右键点击资源', '同上，但旗帜移到资源处'],
              ['所有计数都是0', '采集者显示“全部设为 0”，什么也不采'],
              ['物资已经在地上', '计数只管开采。砍倒的树干和堆垛采集者照样搬运，计数为0时也一样。'],
            ],
          },
        },
      ],
      see: [
        'article:work-flag',
        'article:tools',
        'article:gathering',
        'article:exp-work',
        'article:vehicles',
      ],
    },
    {
      id: 'gathering',
      name: '采集与种植',
      lead: '一棵树敲{{gather.strokes}}下得{{gather.treeYield}}份木材。岩石每出一份都要敲这么多下，所以木材比毛石大约快{{gather.treeYield}}倍。',
      blocks: [
        {
          h: '资源产出',
        },
        {
          table: {
            head: ['资源', '谁来采', '产出', '没有经验时的敲击数', '每棵树、每份或每块田的时长', '工具有用'],
            rows: [
              [
                '树',
                '[[job:collector|采集者]]',
                '{{gather.treeYield}}份[[good:wood|木材]]',
                '每棵{{gather.strokes}}',
                '{{gather.treeSeconds}}秒',
                '是',
              ],
              [
                '岩石',
                '[[job:collector|采集者]]',
                '4-5份[[good:stone|毛石]]',
                '每份{{gather.strokes}}',
                '{{gather.stoneSeconds}}秒',
                '是',
              ],
              [
                '矿藏',
                '[[job:collector|采集者]]',
                '5份[[good:mud|黏土]]、[[good:iron|铁矿]]或[[good:gold|金矿]]',
                '每份{{gather.strokes}}',
                '{{gather.oreSeconds}}秒',
                '是',
              ],
              [
                '蘑菇',
                '[[job:collector|采集者]]',
                '1份[[good:mushroom|蘑菇]]',
                '拾取1次',
                '{{gather.mushroomSeconds}}秒',
                '否',
              ],
              [
                '麦田',
                '[[job:farmer|农夫]]',
                '1份[[good:wheat|小麦]]',
                '每块{{gather.wheatStrokes}}',
                '{{gather.wheatSeconds}}秒',
                '是',
              ],
              [
                '草药田',
                '[[job:herb_mush_guy|草药师]]',
                '1份[[good:herb|草药]]',
                '每块{{gather.herbStrokes}}',
                '{{gather.herbSeconds}}秒',
                '是',
              ],
              [
                '鱼群',
                '[[job:fisher|渔夫]]',
                '1份[[good:fish|鱼]]',
                '{{gather.casts}}竿',
                '{{gather.fishSeconds}}秒',
                '是',
              ],
            ],
            foot: '时长只算干活，没有经验和工具，不含走路。',
          },
        },
        {
          p: '砍倒的树变成树干，上面有{{gather.treeYield}}份木材，采集者每次搬1份。岩石或矿藏每采出一份，都掉在旁边的地上。',
        },
        {
          h: '铁矿与金矿',
        },
        {
          p: '采集者自己采到[[good:mud|黏土]]和[[good:stone|毛石]]合计{{gather.oreNeed}}份，比例不限，就会发现[[good:iron|铁矿]]和[[good:gold|金矿]]。两种矿是同一个条件，一起开放。第一个做到的人为全聚落发现它们，之后也能在[[building:school|学校]]学会。在那之前面板显示“已锁定”。',
        },
        {
          h: '田地',
        },
        {
          figure: {
            id: 'field-stages',
            caption: '从播种到收割',
          },
        },
        {
          p: '田地只有被浇水才会长，光等时间不会长。每次浇水让这块田和6块相邻田各长1阶段，所以一块田最多浇{{field.waterings}}次。收割后地上留1份收成，这块地可以重新播种。',
        },
        {
          p: '播种和浇水都不花东西，连水也不用。',
        },
        {
          table: {
            head: ['建筑', '田数', '半径'],
            rows: [
              ['[[building:work_farm_00|农场]]', '{{field.max}}', '{{field.radius}}格'],
              ['[[building:work_herb_hut|草药屋]]', '{{field.max}}', '{{field.radius}}格'],
            ],
            num: [1],
            foot: '斜向半径约{{field.diagonal}}格。田数上限按建筑算，不按工人算，所以人多只是收得快，田不会变多。人手和库存见建筑卡片。',
          },
        },
        {
          p: '沙地和道路上不能播种。建筑范围内地图自带的野生田计入它的上限。从建筑门口{{field.reclaimSeconds}}秒走不到的田会消失，腾出上限名额。',
        },
        {
          h: '什么会再生',
        },
        {
          table: {
            head: ['来源', '速度', '上限'],
            rows: [
              [
                '[[building:work_well_00|水井]]',
                '每秒+1份[[good:water|水]]，无需工人',
                '建筑内{{well.stock}}份',
              ],
              [
                '[[building:work_hive_00|蜂房]]',
                '每秒+1份[[good:honey|蜂蜜]]，无需工人',
                '建筑内{{hive.stock}}份',
              ],
              [
                '果灌木',
                '{{bush.regrowSeconds}}秒：开花{{bush.stageSeconds}}秒，结果{{bush.stageSeconds}}秒',
                '1餐',
              ],
              ['鱼群', '每{{fish.regrowSeconds}}秒+1条鱼', '{{fish.swarmMax}}条'],
              ['树、岩石、矿藏、蘑菇', '不再生', '-'],
            ],
          },
        },
      ],
      see: [
        'article:tools',
        'article:hauling',
        'article:workshops',
        'article:work-flag',
        'article:exp-work',
        'job:collector',
        'job:farmer',
        'job:fisher',
      ],
    },
    {
      id: 'tools',
      name: '工具',
      lead: '工具让人少敲几下，让工坊多出几份，能用{{tool.uses}}次。',
      blocks: [
        {
          h: '居民的工具从哪来',
        },
        {
          p: '工具由[[article:assistant|助手]]发放，它开局就开着，你也可以下命令发。没有工具的居民会自己去仓库拿，有铁质的拿铁质，没有就拿木质。助手的“铁质工具”和“替换木质工具”开关都开着、仓库里又有多余的铁质工具时，助手会把木质工具换成铁质的。用过的木质工具在更换时丢失，没用过的放回仓库。',
        },
        {
          h: '谁能受益',
        },
        {
          table: {
            head: ['对象', '收益'],
            rows: [
              ['工坊里的工匠', '每批多产'],
              ['[[job:collector|采集者]]', '少敲几下，蘑菇除外'],
              ['[[job:farmer|农夫]]、[[job:herb_mush_guy|草药师]]', '收割少敲几下'],
              ['[[job:fisher|渔夫]]', '少抛几竿'],
              ['[[job:builder|建筑工人]]', '每份材料少敲几下：[[article:construction|建造]]'],
              ['[[job:hunter|猎人]]、[[job:carrier|搬运工]]', '无'],
              ['士兵、英雄', '不带工具'],
            ],
          },
        },
        {
          h: '采集敲击数',
        },
        {
          table: {
            head: ['无经验的居民', '无工具', '木质', '铁质'],
            rows: [
              [
                '每棵树或每份石头、黏土、矿石的敲击数',
                '{{tool.strokes.bare}}',
                '{{tool.strokes.wooden}}',
                '{{tool.strokes.iron}}',
              ],
              ['每1条鱼的抛竿数', '{{tool.casts.bare}}', '{{tool.casts.wooden}}', '{{tool.casts.iron}}'],
            ],
            num: [1, 2, 3],
            foot: '敲击数适用于树、岩石、矿藏和草药田。经验会从中减去几下，但至少还要1下：[[article:exp-work|工作经验]]。',
          },
        },
        {
          p: '一块[[good:wheat|小麦]]田无工具时要敲{{gather.wheatStrokes}}下，有工具或经验到{{exp.savedStrokePct}}%时敲1下就够。',
        },
        {
          h: '工坊每批产量',
        },
        {
          p: '工具给每批加一份固定加成：木质+{{tool.bonus.wooden}}份，铁质+{{tool.bonus.iron}}份。它与经验加成叠加，经验加成见[[article:exp-work|工作经验]]。产出2份的配方加成翻倍。原料和工作时长不变。',
        },
        {
          p: '不足一份的部分会累加，凑满1份就进库存，可以超过容量。',
        },
        {
          h: '耗损',
        },
        {
          p: '每次敲击、抛竿、浇水和工坊每完成一批，都消耗一次工具，没成功的也算。播种和拾蘑菇不消耗。用满{{tool.uses}}次后工具消失，居民徒手工作，直到拿到新工具。没有经验的居民，一件铁质工具够砍{{tool.ironTrees}}棵树。',
        },
      ],
      see: [
        'good:tool_wooden',
        'good:tool_iron',
        'article:exp-work',
        'article:construction',
        'article:gathering',
      ],
    },
    {
      id: 'hauling',
      name: '搬运工与仓库',
      lead: '没有推车的搬运工每次搬{{haul.carry}}份，地面同一处最多堆{{haul.groundStack}}份同种物资。',
      blocks: [
        {
          p: '仓库能装多少、有几个岗位，见[[building:stock_00|一级仓库]]、[[building:stock_01|二级]]、[[building:stock_02|三级仓库]]和[[building:headquarters|大本营]]的卡片。',
        },
        {
          h: '优先',
        },
        {
          p: '优先可以在仓库、大本营、兵营或箭塔里设置。设置后，只要还有空位，这座建筑的搬运工就从其他仓库、工坊和堆垛把这种物资运来。',
        },
        {
          h: '最低库存',
        },
        {
          p: '最低库存每种物资最多{{haul.minimumMax}}份，把所有仓库和大本营加在一起算。总量低于它时，搬运工从工坊、水井、蜂房和堆垛把这种物资运来，也没人能从仓库拿走它。',
        },
        {
          p: '吃饭也一样：全部食物都在最低库存之内时，没人能从仓库拿来吃。优先仓库从别的仓库只能拿到高于最低库存的部分。',
        },
        {
          h: '车辆',
        },
        {
          p: '有车时，搬运工每趟装满整车：[[vehicle:handcart|手推车]]、[[vehicle:oxcart|牛车]]。载货后车会减速多少：[[article:vehicles|载具与船只]]。',
        },
        {
          list: [
            '只有有工作场所的搬运工和[[job:trader|商人]]能用车。',
            '车必须是你的、空闲的，并且在同一片陆地上。',
            '车上还有空位时，仓库搬运工会顺路拾取{{haul.cartTopUp}}格内堆垛和工坊里的同种物资，再返回。',
          ],
        },
        {
          h: '地面堆垛',
        },
        {
          p: '地上的堆垛不属于任何人，谁都能拿。搬运工从哪里拾取堆垛：[[article:work-flag|工作旗帜]]。',
        },
      ],
      see: [
        'article:work-flag',
        'article:roads',
        'article:vehicles',
        'article:construction',
        'job:carrier',
        'building:stock_00',
      ],
    },
    {
      id: 'work-flag',
      name: '工作旗帜',
      lead: '工作旗帜（按钮上简称旗帜）决定工人在哪里干活。它本身不存东西，所以没有工作场所的采集者会把物资留在地上。',
      blocks: [
        {
          figure: {
            id: 'flag-flow',
            caption: '旗帜下的物资去向',
          },
        },
        {
          h: '有无工作场所的区别',
        },
        {
          table: {
            head: ['项目', '无工作场所', '有工作场所'],
            rows: [
              [
                '对象',
                '[[job:collector|采集者]]、[[job:fisher|渔夫]]、[[job:hunter|猎人]]',
                '同左，另加仓库、大本营或工坊的[[job:carrier|搬运工]]',
              ],
              ['旗帜从哪来', '转职时自动插在脚下', '只能用“插下旗帜”命令'],
              ['工作地点', '旗帜周围', '旗帜周围，没有旗帜时见下表'],
              ['可采物资', '他的职业能采的全部', '仅建筑能存放的'],
              ['货物去向', '旗帜旁的堆垛', '他所在的建筑'],
              ['收回旗帜', '不行，只能移动', '“收回旗帜”'],
            ],
          },
        },
        {
          h: '收回旗帜后',
        },
        {
          table: {
            head: ['对象', '无旗帜时'],
            rows: [
              ['采集者', '整个路标范围'],
              ['仓库搬运工', '建筑{{flag.radius}}格内的堆垛'],
              ['猎人', '工作场所周围'],
              ['渔夫', '在所站的地方附近钓鱼'],
            ],
          },
        },
        {
          h: '工作区域',
        },
        {
          table: {
            head: ['对象', '计算起点', '横向、纵向', '斜向'],
            rows: [
              ['[[job:collector|采集者]]', '工作旗帜', '{{flag.radius}}', '约{{flag.diagonal}}'],
              ['搬运工', '工作旗帜或建筑', '{{flag.radius}}', '约{{flag.diagonal}}'],
              ['[[job:hunter|猎人]]', '工作旗帜', '{{flag.hunter}}', '{{flag.hunter}}'],
              ['[[job:fisher|渔夫]]', '工作旗帜', '{{flag.fisher}}', '约{{flag.fisherDiagonal}}'],
              [
                '[[job:farmer|农夫]]、[[job:herb_mush_guy|草药师]]',
                '建筑',
                '{{field.radius}}',
                '约{{field.diagonal}}',
              ],
            ],
            num: [2, 3],
            foot: '单位为格。需要路标的人只在路标范围内工作。',
          },
        },
        {
          p: '农场、草药屋、水井、蜂房、箭塔和兵营的搬运工插不了工作旗帜。',
        },
        {
          h: '旗帜旁的堆垛',
        },
        {
          list: [
            '旗帜下的堆垛只有有工作场所的搬运工才会运走。',
            '采集者的旗帜离仓库超过{{flag.radius}}格时，给仓库搬运工在旁边插一面旗帜。',
            '移动旗帜后，堆垛留在原地。',
          ],
        },
        {
          h: '插旗帜',
        },
        {
          p: '“插下旗帜”在指定位置插旗，或把旗帜移过去，效果和Ctrl+右键一样。位置被占时，旗帜插到{{flag.snap}}格内的空地上，找不到空地命令就作废。',
        },
        {
          p: '在[[article:assistant|助手]]里可以让采集者自己移动旗帜。这时采集者把旗帜插在离资源{{assistant.flagMin}}-{{assistant.flagMax}}格处，附近采空后，就去离自己建筑最近的资源。猎人和渔夫不会这样做。',
        },
        {
          p: '旗帜可以插在网络外，但工人会站着不动，直到网络覆盖那里：[[article:roads|道路与路标]]。',
        },
      ],
      see: ['article:hauling', 'article:workshops', 'article:roads', 'article:assistant', 'job:collector'],
    },
    {
      id: 'roads',
      name: '道路与路标',
      lead: '道路花1份毛石，穿鞋走陆地每步从{{step.landBrief}}秒缩短到{{step.road}}秒。',
      blocks: [
        {
          h: '路标',
        },
        {
          p: '路标由[[job:scout|侦察兵]]竖立，不花材料。',
        },
        {
          figure: {
            id: 'reach',
            caption: '网络范围',
          },
        },
        {
          p: '没有路标时，居民最远能走到{{reach.walk}}格外的目标，[[job:carrier|搬运工]]是{{reach.carrier}}格。再远要靠路标：只要这个距离内有路标，居民就能用与它相连的整个网络，目标则要在该网络某个路标的同样距离内。',
        },
        {
          list: [
            '两个路标相距小于{{reach.link}}格、之间步行路线不超过{{reach.linkRoute}}格时相连。',
            '你的新路标要离别的路标至少{{reach.spacing}}格。',
            '居民在离自己或这个距离内的路标小于{{reach.goods}}格的范围内找物资。',
            '建筑压住路标时，路标最多被推开{{reach.displace}}格，推不开就消失。',
          ],
        },
        {
          table: {
            head: ['地形', '找物资的范围（格）'],
            rows: [
              ['道路、陆地', '小于{{reach.goods}}'],
              ['沙地', '约{{reach.goodsSand}}'],
              ['山地', '约{{reach.goodsMountain}}'],
              ['雪地', '约{{reach.goodsSnow}}'],
            ],
            num: [1],
            foot: '地形越差，居民找物资的范围越小。',
          },
        },
        {
          p: '侦察兵、士兵、英雄、[[job:hunter|猎人]]和[[job:druid|德鲁伊]]有没有路标都能到处走。',
        },
        {
          p: '工作场所或旗帜落到范围外的工人进入“迷路了”状态，等到网络覆盖那里为止。手上的物资还是会送回去。',
        },
        {
          h: '路标面板',
        },
        {
          table: {
            head: ['面板项目', '含义'],
            rows: [
              ['“网络内物资”', '相连网络范围内的全部物资：建筑里、堆垛上、车上和手上的。'],
              ['“拆除”', '路标立即消失，不会询问。如果它连着网络的两部分，网络就会断开。'],
            ],
            foot: '地图上的“路标”图层显示网络。',
          },
        },
        {
          h: '道路',
        },
        {
          table: {
            head: ['路下地形', '走道路每步缩短'],
            rows: [
              ['陆地', '{{step.roadSavedOnLandPct}}%'],
              ['沙地', '{{step.roadSavedOnSandPct}}%'],
              ['山地', '{{step.roadSavedOnMountainPct}}%'],
              ['雪地', '{{step.roadSavedOnSnowPct}}%'],
            ],
            num: [1],
            foot: '穿鞋、空手的居民。各地形的步速见[[article:walking|步速]]。鞋子走道路比走陆地磨损慢{{shoes.roadWear}}倍。',
          },
        },
        {
          list: [
            '每段花1份[[good:stone|毛石]]和[[job:builder|建筑工人]]敲1下。',
            '一份毛石还能铺最多6段相邻路段，前提是还没有建筑工人接手那些路段，上面也没有毛石。',
            '走道路更快时，居民会自己走道路。',
          ],
        },
      ],
      see: [
        'article:walking',
        'article:hauling',
        'article:work-flag',
        'article:construction',
        'job:scout',
        'good:stone',
      ],
    },
    {
      id: 'walking',
      name: '步速',
      lead: '陆地上穿鞋每步{{step.landBrief}}秒，赤脚{{step.landBare}}秒。',
      blocks: [
        {
          p: '格是最小的移动单位：居民每走1步过1格。',
        },
        {
          h: '各地形的步速',
        },
        {
          table: {
            head: ['地形', '穿鞋每步', '赤脚每步', '一双鞋可走步数'],
            rows: [
              ['道路、铺石路', '{{step.road}}秒', '{{step.roadBare}}秒', '{{shoes.road}}'],
              ['陆地', '{{step.land}}秒', '{{step.landBare}}秒', '{{shoes.land}}'],
              ['沙地、海滩、石漠', '{{step.sand}}秒', '{{step.sandBare}}秒', '{{shoes.sand}}'],
              ['山地', '{{step.mountain}}秒', '{{step.mountainBare}}秒', '{{shoes.mountain}}'],
              ['雪地', '{{step.snow}}秒', '{{step.snowBare}}秒', '{{shoes.snow}}'],
            ],
            num: [1, 2, 3],
            foot: '手上拿货时鞋子磨损快{{shoes.carryWear}}倍。赤脚走路消耗多少体力见[[article:needs|需求]]。道路的好处见[[article:roads|道路与路标]]。',
          },
        },
        {
          h: '影响步速的因素',
        },
        {
          table: {
            head: ['状态', '变化'],
            rows: [
              ['手上拿货', '+{{step.carryExtra}}秒'],
              ['耐力不超过{{need.drivePct}}%', '+{{step.tiredExtra}}秒'],
              ['儿童', '+{{step.childExtra}}秒'],
              ['婴儿', '每步 × 2'],
              ['武器和护甲合计重量{{step.weightLowFrom}}-{{step.weightLowTo}}', '+{{step.weightLowExtra}}秒'],
              [
                '武器和护甲合计重量{{step.weightHighFrom}}-{{step.weightHighTo}}',
                '+{{step.weightHighExtra}}秒',
              ],
              ['[[good:amulet_speed|疾风护符]]', '-{{step.amuletSaved}}秒'],
            ],
            foot: '每步至少{{step.shortest}}秒。英雄不受重量影响。车辆减速多少：[[article:vehicles|载具与船只]]。',
          },
        },
        {
          h: '武器和护甲重量',
        },
        {
          table: {
            head: ['武器', '重量'],
            rows: [
              ['[[good:sword_shord|短剑]]、[[good:bow_short|短弓]]', '{{weight.shortSword}}'],
              ['[[good:spear_wooden|木矛]]、[[good:bow_long|长弓]]', '{{weight.woodenSpear}}'],
              ['[[good:spear_iron|铁矛]]、[[good:sword_long|长剑]]', '{{weight.ironSpear}}'],
            ],
            num: [1],
            foot: '所有民族相同。把武器重量加上“护甲”表里的护甲重量：[[article:damage|伤害计算器]]。',
          },
        },
        {
          h: '示例',
        },
        {
          table: {
            head: ['对象', '地形', '每步'],
            rows: [
              ['搬运工，穿鞋，手上拿货', '道路', '{{step.carrierOnRoad}}秒'],
              ['士兵，长剑，板甲，穿鞋', '陆地', '{{step.plateSoldierOnLand}}秒'],
            ],
            num: [2],
          },
        },
      ],
      see: [
        'good:shoes',
        'good:amulet_speed',
        'article:roads',
        'article:needs',
        'article:vehicles',
        'article:damage',
      ],
    },
    {
      id: 'trade',
      name: '贸易',
      lead: '商人往返于{{trade.stops}}座建筑之间，没有车时每次拿{{haul.carry}}份。',
      blocks: [
        {
          h: '运输工具',
        },
        {
          table: {
            head: ['运输工具', '装或卸1份用时'],
            rows: [
              ['手拿', '{{trade.handsSeconds}}秒'],
              ['[[good:handcart|手推车]]', '{{trade.handcartSeconds}}秒'],
              ['[[good:oxcart|牛车]]', '{{trade.oxcartSeconds}}秒'],
            ],
            num: [1],
            foot: '车的容量见其卡片，减速见[[article:vehicles|载具与船只]]。',
          },
        },
        {
          p: '去程满载、回程空车时，两种车的运量在陆地约{{trade.cartParLand}}格或道路约{{trade.cartParRoad}}格的路线上持平。路线更短时手推车更好，更长时牛车更好。',
        },
        {
          h: '路线',
        },
        {
          list: [
            '路线连接{{trade.stops}}座已建成且有库存的建筑，其中最多1座可以属于别人。',
            '建筑升级时，[[job:trader|商人]]等升级结束。',
            '商人不从民居拿食物。',
          ],
        },
        {
          h: '跨海',
        },
        {
          list: [
            '路线上的建筑位于不同岸边时，路线显示“需跨海”。点击“指定船只”，选择商人所在岸边的一艘自己的[[good:ship_small|船]]或[[good:ship_big|大船]]，船上不能有乘员和载具。商人会乘它走自己的路线。',
            '安排上这艘船的[[job:carrier|搬运工]]会在岸边帮商人装卸，前提是路线两端的建筑都是你的。',
          ],
        },
        {
          h: '自家建筑之间',
        },
        {
          p: 'A和B是路线上的两座建筑。',
        },
        {
          table: {
            head: ['设置', '结果'],
            rows: [
              ['物资在建筑B标记', '从A拿货运到B'],
              ['物资在两座建筑都标记', '平衡两边库存'],
              ['两座建筑都没标记', '商人什么也不运'],
              ['最多 N', '目的建筑连同车上货物将达到N份时停止运送'],
              ['保留 N', '来源建筑留下N份'],
              [
                '聚落',
                '从整个聚落拿货：先从这座仓库，再从其路标网络内的其他仓库和工坊。这座仓库满了时，送到聚落的另一座仓库',
              ],
            ],
            foot: '“聚落”选项只能在仓库或大本营里开启。只有两座建筑的聚落没有共同建筑时（例如在两座岛上），路线两端才能同时开启。商人不会拿走仓库里低于最低库存的物资。',
          },
        },
        {
          h: '与电脑贸易',
        },
        {
          list: [
            '只能和电脑玩家已建成、且有地图设定报价的建筑交易。',
            '把建筑加入路线时双方都要互相友好。之后只要商人所属民族友好就行：[[article:diplomacy|外交]]。',
            '报价是用N份一种物资换M份另一种，数字由地图决定。一条路线一次只做一个报价。',
            '电脑每{{trade.refillSeconds}}秒把自己仓库里的报价物资补到{{trade.refillLevel}}份。',
            '电脑的建筑里没有报酬时，商人等待，不交货。',
            '“保留 N”在你的建筑里留下N份待售物资。回程上限N：你的建筑有了N份报酬时交易结束。',
          ],
        },
      ],
      see: [
        'article:diplomacy',
        'article:vehicles',
        'article:hauling',
        'article:roads',
        'job:trader',
        'good:handcart',
      ],
    },
  ],
};
