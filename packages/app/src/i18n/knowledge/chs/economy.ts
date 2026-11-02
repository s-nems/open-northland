import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: '经济',
  items: [
    {
      id: 'construction',
      name: '建造、升级与修理',
      lead: '建一座一级民居，一名建筑工人光敲击就要{{build.noviceSeconds}}秒，用铁质工具要{{build.noviceIronSeconds}}秒。搬材料的时间另算。',
      blocks: [
        {
          h: '哪里能建造',
        },
        {
          table: {
            head: ['项目', '结果'],
            rows: [
              ['地形', '陆地、沙地、海滩和石漠都能建。山地、雪地、水面和沼泽不行。'],
              [
                '[[building:work_well_00|水井]]、[[building:work_hive_00|蜂房]]',
                '建筑边缘至少要有一点压在草地上。',
              ],
              ['空间', '建筑一开始就占下最高等级的位置和周围一圈窄边。两座建筑的窄边不能重叠。'],
              ['树木、岩石、矿藏、木栅栏', '会挡路，必须在最高等级的位置之外。'],
              [
                '敌方士兵',
                '{{contest.radius}}格内不能建，斜向约{{contest.diagonal}}格。只算你看得见的士兵，箭塔岗位上的驻军不算。',
              ],
              [
                '和平关系玩家的建筑',
                '距其建筑或工地{{peace.keepOut}}格内不能建，除非你自己的建筑离那里比他的更近。',
              ],
              ['迷雾中的地块', '不能建。那个位置此刻必须看得见。'],
              ['居民、载具、工作旗帜、路标、堆垛、尸体', '会被移到一旁。'],
              ['灌木、田地、树桩、已打开的箱子', '工地放下时消失。'],
              ['道路工地', '被取消，已运到的毛石落在旁边。'],
              [
                '升级预留位置上的道路、木栅栏',
                '画线时会绕开这里。默认按G键可以铺上去，但升级时会拆掉，不返还。',
              ],
              ['敌方平民、动物', '不碍事，工地可以建在他们旁边。'],
              ['已铺好的道路', '留在建筑下面。'],
              ['路标范围', '不限制。工地可以建在网络外，网络覆盖到那里后建筑工人才过得去。'],
            ],
          },
        },
        {
          figure: {
            id: 'step-diamond',
            caption: '为什么斜向更短',
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
            foot: '每1份材料要敲的次数。[[job:builder|建筑工人]]敲{{exp.build.repeatsFull}}次后经验到100%，只算有进度的敲击。',
          },
        },
        {
          list: [
            '无成本的建筑只需敲1下。',
            '一段木栅栏或道路在材料运到后，由1名建筑工人敲1下完成。',
            '材料由建筑工人和分配到工地的工人运，每次1份。',
          ],
        },
        {
          h: '建筑工人的工作顺序',
        },
        {
          steps: [
            '玩家刚派给这名工人的道路或木栅栏。',
            '修理：先栅门，再建筑，最后木栅栏。',
            '建筑工地，材料齐且快完工的优先。',
            '新的木栅栏段。',
            '道路。',
          ],
        },
        {
          p: '玩家指派到工地的建筑工人会留在那里，别处有活也不走。',
        },
        {
          h: '升级',
        },
        {
          list: [
            '花费所升等级的材料。可以一次跨多级，只要每一级都已解锁。',
            '建筑库存里属于升级成本的物资直接进工地。其余库存完工后返回。',
            '工人和住户搬出去，保留名额，完工后回来。',
            '升级期间生命值不涨。完工后按新等级回满。',
            '开始升级会关闭防御模式。',
            '取消时退回库存和从中取走的物资，已运到的材料作废。',
          ],
        },
        {
          h: '修理',
        },
        {
          table: {
            head: ['目标', '每次敲击回复生命值', '同时工作的工人数'],
            rows: [
              ['建筑', '{{repair.minPerSwing}}-{{repair.maxPerSwing}}', '{{repair.crew}}'],
              ['木栅栏段', '{{wall.segmentRepair}}', '{{repair.wallCrew}}'],
              ['栅门', '{{wall.gateRepair}}', '{{repair.wallCrew}}'],
            ],
            num: [1, 2],
            foot: '修理不花材料。修木栅栏和栅门时，经验和工具没有影响。',
          },
        },
        {
          list: [
            '最后一次挨打后{{repair.calmSeconds}}秒内，或{{alert.standTo}}格内还在打仗时，建筑工人不会自己去修理。你下命令可以跳过这两个条件。',
            '工地和在建的木栅栏没有修理一说，生命值随建造上涨。',
            '受损的建筑升级时，先修理再升级。',
          ],
        },
        {
          h: '损失与返还',
        },
        {
          table: {
            head: ['情况', '结果'],
            rows: [
              ['拆除工地', '已运到的材料掉在地上'],
              ['拆除或摧毁建筑', '库存加一半成本，每种物资向上取整'],
              ['拆除升级中的建筑', '当前等级同上，另加暂存的库存和升级材料'],
            ],
            foot: '物资堆放在{{reach.spill}}格内的同一片陆地上，放不下的消失。',
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
              ['0', '产品停工', '跳过该物资'],
              ['1-{{workshop.counterMax}}', '做这么多批，开工时-1', '采集这么多份，每得一份-1'],
              ['∞', '不停，计数不减', '不停，计数不减'],
            ],
            foot: '工坊按批计数，采集者按份计数。经验和工具能让一批多出几份：[[article:tools|工具]]。',
          },
        },
        {
          h: '按钮',
        },
        {
          table: {
            head: ['按钮', '单击', 'Shift', 'Ctrl'],
            rows: [
              ['物资图标，“仅此产品”', '此物资∞，其余0', '-', '此物资：0变∞，其他值变0。其余不变。'],
              ['减少', '-1。从0跳到∞，从∞跳到{{workshop.counterMax}}', '-10', '归0'],
              ['增加', '+1。从{{workshop.counterMax}}跳到∞，从∞跳到0', '+10', '设为∞'],
            ],
          },
        },
        {
          h: '新工人的初始设置',
        },
        {
          table: {
            head: ['对象', '初始计数'],
            rows: [
              ['工匠', '工坊第一种产品∞，其余0'],
              ['[[building:work_animal_farm|畜牧场]]的[[job:breeder|畜牧师]]', '牛∞，绵羊0'],
              ['由助手分配的毕业生，且学校教这个职业多种产品', '在学校学过的产品∞，其余0'],
              ['[[job:collector|采集者]]', '所有物资∞'],
            ],
          },
        },
        {
          h: '计数器何时变化',
        },
        {
          p: '换工作场所或换职业时计数器清空，建筑被拆时也一样。升级不动它们，新等级增加的产品为0。每名工人的计数器各管各的：同一工坊的2个人可以做2种产品。',
        },
        {
          h: '同时做多种产品',
        },
        {
          p: '工人轮流做计数大于0的产品，每种1批，按面板上的顺序。',
        },
        {
          table: {
            head: ['情况', '结果'],
            rows: [
              ['产品库存已满', '换下一种。在做的批次算占了位置。'],
              ['建筑内没有原料', '换下一种'],
              ['建筑内原料不够', '等待补齐。无处可取时才换下一种。'],
              ['产品缺少所需经验', '计数器处显示“已锁定”，轮转时跳过'],
              ['有计数的产品全被锁定', '工人做已经会做的，包括计数为0的产品'],
            ],
          },
        },
        {
          h: '载具',
        },
        {
          list: [
            '载具在工坊外面造：工匠在旁边开车场，自己运材料并建造。',
            '载具计数在完工时减少，不是开工时。',
            '工坊旁放不下车场时，工人换下一种产品。',
          ],
        },
        {
          h: '采集者',
        },
        {
          table: {
            head: ['操作', '结果'],
            rows: [
              ['“仅此物资”', '此物资∞，其余0'],
              ['右键点击资源', '“采集”：此物资∞，其余0，工作旗帜不动'],
              ['Ctrl+右键点击资源', '同上，旗帜移到资源处'],
              ['所有计数都是0', '状态“全部设为 0”'],
              ['计数为0但物资在地上', '计数只管开采。地上的树干和堆垛采集者照样搬运。'],
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
      lead: '一棵树敲{{gather.strokes}}下得{{gather.treeYield}}份木材。岩石敲这么多下才出1份，所以木材大约快{{gather.treeYield}}倍。',
      blocks: [
        {
          h: '资源产出',
        },
        {
          table: {
            head: ['资源', '谁来采', '产出', '没有经验时的敲击数', '时长', '工具'],
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
          list: [
            '砍倒的树变成树干，上面有{{gather.treeYield}}份木材，采集者每次搬1份。',
            '岩石或矿藏每采1份，就掉在旁边的地上。',
          ],
        },
        {
          h: '铁矿与金矿',
        },
        {
          table: {
            head: ['途径', '条件', '适用对象'],
            rows: [
              [
                '工作',
                '[[good:mud|黏土]]和[[good:stone|毛石]]合计{{gather.oreNeed}}份',
                '该居民本人。第一个做到的人为全聚落发现该物资。',
              ],
              ['[[building:school|学校]]', '物资已发现后上课', '毕业生'],
            ],
            foot: '居民要自己达成条件，[[good:iron|铁矿]]和[[good:gold|金矿]]分开算。达成之前面板显示“已锁定”。',
          },
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
          p: '田地只靠浇水生长，时间不起作用。每次浇水让这块田和6块相邻田各长1阶段，所以一块田最多浇{{field.waterings}}次。收割后地上留1份，空地可以重新播种。',
        },
        {
          p: '播种和浇水都不花东西，也不需要水这种物资。',
        },
        {
          table: {
            head: ['建筑', '田数', '半径', '人手', '库存'],
            rows: [
              [
                '[[building:work_farm_00|农场]]',
                '{{field.max}}',
                '{{field.radius}}格',
                '农夫{{farm.farmers}}名，搬运工{{farm.carriers}}名',
                '{{farm.stock}}',
              ],
              [
                '[[building:work_herb_hut|草药屋]]',
                '{{field.max}}',
                '{{field.radius}}格',
                '草药师{{herbHut.herbalists}}名，搬运工{{herbHut.carriers}}名',
                '{{herbHut.stock}}',
              ],
            ],
            num: [1, 4],
            foot: '斜向半径约{{field.diagonal}}格。田数上限按建筑算，不按工人算。人多只是收得快。',
          },
        },
        {
          h: '农夫和草药师的工作顺序',
        },
        {
          steps: [
            '把收割的物资运回建筑。',
            '建筑的田不足{{field.max}}块时播种。',
            '收割最近的成熟田。',
            '给阶段最低的田浇水。',
            '在建筑里等待。',
          ],
        },
        {
          p: '沙地和道路上不能播种。建筑范围内地图自带的野生田计入它的上限。',
        },
        {
          p: '和建筑门口隔断{{field.reclaimSeconds}}秒的田会消失，腾出上限名额。',
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
          p: '工具由[[article:assistant|助手]]发放，开局就开着，你也可以下命令。只有工具栏空着的居民才去仓库拿，铁质先于木质。已经有工具的人不会自己去换更好的。',
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
              ['[[job:builder|建筑工人]]', '每份材料少敲几下'],
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
            head: ['经验', '无工具', '木质', '铁质'],
            rows: [
              ['0%', '{{tool.strokes.0.bare}}', '{{tool.strokes.0.wooden}}', '{{tool.strokes.0.iron}}'],
              ['20%', '{{tool.strokes.20.bare}}', '{{tool.strokes.20.wooden}}', '{{tool.strokes.20.iron}}'],
              ['40%', '{{tool.strokes.40.bare}}', '{{tool.strokes.40.wooden}}', '{{tool.strokes.40.iron}}'],
              ['60%', '{{tool.strokes.60.bare}}', '{{tool.strokes.60.wooden}}', '{{tool.strokes.60.iron}}'],
              ['80%', '{{tool.strokes.80.bare}}', '{{tool.strokes.80.wooden}}', '{{tool.strokes.80.iron}}'],
              [
                '100%',
                '{{tool.strokes.100.bare}}',
                '{{tool.strokes.100.wooden}}',
                '{{tool.strokes.100.iron}}',
              ],
            ],
            num: [1, 2, 3],
            foot: '树、岩石、矿藏、草药田。',
          },
        },
        {
          table: {
            head: ['经验', '无工具', '木质', '铁质'],
            rows: [
              ['0%', '{{tool.casts.0.bare}}', '{{tool.casts.0.wooden}}', '{{tool.casts.0.iron}}'],
              ['20%', '{{tool.casts.20.bare}}', '{{tool.casts.20.wooden}}', '{{tool.casts.20.iron}}'],
              ['40%', '{{tool.casts.40.bare}}', '{{tool.casts.40.wooden}}', '{{tool.casts.40.iron}}'],
              ['60%', '{{tool.casts.60.bare}}', '{{tool.casts.60.wooden}}', '{{tool.casts.60.iron}}'],
              ['80-100%', '{{tool.casts.80.bare}}', '{{tool.casts.80.wooden}}', '{{tool.casts.80.iron}}'],
            ],
            num: [1, 2, 3],
            foot: '每条鱼要抛的竿数。',
          },
        },
        {
          p: '收割一块[[good:wheat|小麦]]田，无工具时敲{{gather.wheatStrokes}}下，有工具或经验到20%时敲1下。',
        },
        {
          h: '工坊每批产量',
        },
        {
          table: {
            head: ['经验', '无工具', '木质', '铁质'],
            rows: [
              ['0%', '{{tool.output.0.bare}}', '{{tool.output.0.wooden}}', '{{tool.output.0.iron}}'],
              ['20%', '{{tool.output.20.bare}}', '{{tool.output.20.wooden}}', '{{tool.output.20.iron}}'],
              ['40%', '{{tool.output.40.bare}}', '{{tool.output.40.wooden}}', '{{tool.output.40.iron}}'],
              ['60%', '{{tool.output.60.bare}}', '{{tool.output.60.wooden}}', '{{tool.output.60.iron}}'],
              ['80%', '{{tool.output.80.bare}}', '{{tool.output.80.wooden}}', '{{tool.output.80.iron}}'],
              ['100%', '{{tool.output.100.bare}}', '{{tool.output.100.wooden}}', '{{tool.output.100.iron}}'],
            ],
            num: [1, 2, 3],
            foot: '按产出1份的配方算，产出2份的配方加成翻倍。原料和时长不变。经验对屠宰同样有效。',
          },
        },
        {
          p: '小数部分在工坊里累积，凑满1份就进库存，可以超过容量。',
        },
        {
          h: '耗损',
        },
        {
          table: {
            head: ['工作', '工具耗损'],
            rows: [
              ['工坊批次', '每完成一批算1次'],
              ['采集敲击', '每次敲击算1次，没采出来也算'],
              ['抛竿', '每竿1次，没钓到也算'],
              ['建筑工人敲击', '每次敲击算1次，修理和没有进度的敲击也算'],
              ['浇水', '每次浇水1次'],
              ['播种、拾蘑菇', '0'],
            ],
            foot: '用满{{tool.uses}}次后工具消失，居民徒手工作，直到拿到新工具。没有经验的居民，一件铁质工具够砍{{tool.ironTrees}}棵树。',
          },
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
          h: '容量',
        },
        {
          table: {
            head: ['建筑', '每种物资份数'],
            rows: [
              ['[[building:stock_00|一级仓库]]', '{{haul.store1}}'],
              ['[[building:stock_01|二级仓库]]', '{{haul.store2}}'],
              ['[[building:stock_02|三级仓库]]', '{{haul.store3}}'],
              ['[[building:headquarters|大本营]]', '{{haul.hq}}'],
            ],
            num: [1],
            foot: '这些建筑可容纳[[job:carrier|搬运工]]、采集者、渔夫和猎人各{{haul.storeSeats}}名。',
          },
        },
        {
          h: '优先',
        },
        {
          p: '优先在单座建筑上设置：仓库、大本营、兵营或箭塔。只要还有空位，这座建筑的搬运工就从其他仓库、工坊和堆垛把物资运来。',
        },
        {
          h: '最低库存',
        },
        {
          p: '最低库存把所有仓库和大本营加在一起算，每种物资最多{{haul.minimumMax}}份。总量低于它时，仓库、大本营、水井和蜂房的搬运工从工坊、水井、蜂房和堆垛运货过来，也没人能从仓库拿走这种物资。',
        },
        {
          p: '吃饭也一样：全部食物都在最低库存之内时，没人能从仓库吃。仓库只把高于最低库存的部分交给优先仓库。',
        },
        {
          h: '仓库搬运工的工作顺序',
        },
        {
          steps: [
            '放下手上的东西。',
            '运来本建筑标记为优先的物资。',
            '在仓库和大本营运来低于最低库存的物资。',
            '拾取本建筑可收的最近堆垛。',
            '把工坊的成品运回本建筑。',
          ],
        },
        {
          table: {
            head: ['搬运工所在', '工作内容'],
            rows: [
              [
                '[[building:work_farm_00|农场]]、[[building:work_herb_hut|草药屋]]',
                '先把收成运到仓库，再运堆垛',
              ],
              ['工坊', '先运来原料，再运走产品'],
              ['[[building:work_well_00|水井]]、[[building:work_hive_00|蜂房]]', '运走存货'],
            ],
          },
        },
        {
          h: '车辆',
        },
        {
          table: {
            head: ['搬运工', '每趟份数', '满载减速'],
            rows: [
              ['无车', '{{haul.carry}}', '-'],
              ['带[[good:handcart|手推车]]', '{{haul.handcart}}', '{{haul.handcartLossPct}}%'],
              ['带[[good:oxcart|牛车]]', '{{haul.oxcart}}', '{{haul.oxcartLossPct}}%'],
            ],
            num: [1, 2],
            foot: '货越少，减速越小。[[job:trader|商人]]的车辆数值相同。',
          },
        },
        {
          list: [
            '只有有工作场所的搬运工和[[job:trader|商人]]能用车。搬运工保留工作场所。',
            '车必须是自己的且空闲：没有乘员，没有别的指挥官，在同一片陆地上。',
            '车上有空位时，仓库搬运工顺路拾取自己{{haul.cartTopUp}}格内堆垛和工坊里的同种物资，然后返回。',
            '失去工作场所后车留在原地。',
          ],
        },
        {
          h: '地面堆垛',
        },
        {
          list: [
            '堆垛没有主人，谁都能拿。',
            '搬运工没有工作旗帜时在建筑{{flag.radius}}格内拾取，有旗帜时在旗帜{{flag.radius}}格内。',
          ],
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
      lead: '工作旗帜（按钮上简称旗帜）划定工作区域，本身不存东西。没有工作场所的采集者把物资留在地上。',
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
              ['旗帜来源', '转职时自动插在脚下', '只能用“插下旗帜”'],
              ['工作地点', '旗帜周围', '旗帜周围，无旗时见下表'],
              ['可采物资', '职业能采的全部', '仅建筑能存放的'],
              ['货物去向', '旗帜旁的地面堆垛', '工人所在建筑'],
              ['收回旗帜', '不行，只能移动', '“收回旗帜”'],
              [
                '失去工作场所',
                '-',
                '采集者、渔夫和猎人继续围绕自己的旗帜工作，没有旗帜时在脚下插新旗。搬运工失去旗帜。',
              ],
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
              ['搬运工', '仓库：建筑{{flag.radius}}格内的堆垛'],
              ['猎人', '工作场所周围'],
              ['渔夫', '从所在位置寻找岸边'],
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
            foot: '单位为格。受路标限制的职业只在路标范围内工作。',
          },
        },
        {
          p: '农场、草药屋、水井、蜂房、箭塔和兵营的搬运工不接受工作旗帜。',
        },
        {
          h: '旗帜旁的堆垛',
        },
        {
          list: [
            '旗帜下的堆垛只有带工作场所的搬运工才会运走。',
            '离仓库超过{{flag.radius}}格时，在采集者的旗帜旁给搬运工插一面自己的旗帜。',
            '有旗帜的搬运工拿旗帜周围的堆垛和成品，运回自己的建筑。',
            '移动旗帜时堆垛留在原地。',
          ],
        },
        {
          h: '插旗帜',
        },
        {
          p: '“插下旗帜”在指定位置插旗，或把旗帜移过去。位置被占时在{{flag.snap}}格内找空地，再远命令作废。Ctrl+右键效果相同。',
        },
        {
          p: '[[article:assistant|助手]]里的开关让采集者自己移动旗帜：插在离资源{{assistant.flagMin}}-{{assistant.flagMax}}格处。区域采空后，他去离自己建筑最近的资源。猎人和渔夫不受影响。',
        },
        {
          p: '旗帜可以插在范围外，但工人会站着不动，直到网络覆盖那里：[[article:roads|道路与路标]]。',
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
          p: '居民自己能走到{{reach.walk}}格内的目标，[[job:carrier|搬运工]]是{{reach.carrier}}格。再远要靠路标：路标离他比这个距离近时，整个相连网络都向他开放，目标则要在该网络某个路标的同样距离内。',
        },
        {
          list: [
            '两个路标相距小于{{reach.link}}格时相连，两者间路线不超过{{reach.linkRoute}}格。',
            '自家路标要离别的路标至少{{reach.spacing}}格才放得下。',
            '居民在小于{{reach.goods}}格的范围内找物资，这个距离内的路标也算起点。',
            '建筑压住路标时，路标最多被推开{{reach.displace}}格，再远就消失。',
          ],
        },
        {
          table: {
            head: ['地形', '寻找物资（格）'],
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
          p: '侦察兵、士兵、英雄、[[job:hunter|猎人]]和[[job:druid|德鲁伊]]不受范围限制。',
        },
        {
          p: '工作场所或旗帜落到范围外的工人进入“迷路了”状态，站着不动，直到网络覆盖那里。手上的物资还是会送回去。',
        },
        {
          h: '路标面板',
        },
        {
          table: {
            head: ['项目', '含义'],
            rows: [
              ['“网络内物资”', '整个相连网络范围内的物资：建筑、堆垛、车辆、手上。每份只算一次。'],
              ['“拆除”', '路标立即消失，无需确认，也不用侦察兵。如果它是唯一的连接，网络分裂成几块。'],
            ],
            foot: '地图上的“路标”图层显示网络。',
          },
        },
        {
          h: '道路',
        },
        {
          table: {
            head: ['路下地形', '无路每步', '有路每步', '节省'],
            rows: [
              ['陆地', '{{step.land}}秒', '{{step.road}}秒', '{{step.roadSavedOnLandPct}}%'],
              ['沙地', '{{step.sand}}秒', '{{step.road}}秒', '{{step.roadSavedOnSandPct}}%'],
              ['山地', '{{step.mountain}}秒', '{{step.road}}秒', '{{step.roadSavedOnMountainPct}}%'],
              ['雪地', '{{step.snow}}秒', '{{step.road}}秒', '{{step.roadSavedOnSnowPct}}%'],
            ],
            num: [1, 2, 3],
            foot: '穿鞋、空手的居民。鞋子走道路比走陆地磨损慢{{shoes.roadWear}}倍。',
          },
        },
        {
          list: [
            '每段花1份[[good:stone|毛石]]和[[job:builder|建筑工人]]敲1下。',
            '同一份毛石还能铺最多6段相邻路段，前提是没有建筑工人接手那些路段，上面也没有毛石。',
            '取消路段：已运到的毛石落在旁边。',
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
          h: '各地形的步速',
        },
        {
          table: {
            head: ['地形', '穿鞋', '赤脚', '一双鞋可走步数'],
            rows: [
              ['道路、铺石路', '{{step.road}}秒', '{{step.roadBare}}秒', '{{shoes.road}}'],
              ['陆地', '{{step.land}}秒', '{{step.landBare}}秒', '{{shoes.land}}'],
              ['沙地、海滩、石漠', '{{step.sand}}秒', '{{step.sandBare}}秒', '{{shoes.sand}}'],
              ['山地', '{{step.mountain}}秒', '{{step.mountainBare}}秒', '{{shoes.mountain}}'],
              ['雪地', '{{step.snow}}秒', '{{step.snowBare}}秒', '{{shoes.snow}}'],
            ],
            num: [1, 2, 3],
            foot: '手上拿货时鞋子磨损快{{shoes.carryWear}}倍。赤脚每步的体力消耗见[[article:needs|需求]]。',
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
              ['武器和护甲合计重量2-3', '+{{step.weightLowExtra}}秒'],
              ['武器和护甲合计重量4-5', '+{{step.weightHighExtra}}秒'],
              ['[[good:amulet_speed|疾风护符]]', '-{{step.amuletSaved}}秒'],
              ['满载[[good:handcart|手推车]]', '慢{{haul.handcartLossPct}}%'],
              ['满载[[good:oxcart|牛车]]', '慢{{haul.oxcartLossPct}}%'],
            ],
            foot: '每步最快{{step.shortest}}秒。货越少，车辆减速越小。英雄不受重量影响。',
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
            foot: '所有民族相同。武器重量加上下表的护甲重量。',
          },
        },
        {
          data: 'armour',
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
              ['商人，穿鞋，满载手推车', '陆地', '{{step.traderFullCart}}秒'],
            ],
            num: [2],
          },
        },
      ],
      see: ['good:shoes', 'good:amulet_speed', 'article:roads', 'article:needs', 'article:vehicles'],
    },
    {
      id: 'trade',
      name: '贸易',
      lead: '商人往返于{{trade.stops}}座建筑之间，无车时每趟拿{{haul.carry}}份。',
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
            foot: '容量和减速见[[article:hauling|搬运工与仓库]]。',
          },
        },
        {
          p: '穿鞋、去程满载、回程空车时，两种车的运量在陆地约{{trade.cartParLand}}格或道路约{{trade.cartParRoad}}格的路线上持平。路线更短时手推车划算，更长时牛车划算。',
        },
        {
          h: '路线',
        },
        {
          list: [
            '路线连接{{trade.stops}}座已建成且有库存的建筑。外方建筑最多1座。',
            '建筑升级时，[[job:trader|商人]]等到完工。',
            '商人不从民居拿食物。',
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
              ['物资在建筑B标记', '在A装货，在B卸货'],
              ['物资在两座建筑都标记', '平衡两边库存'],
              ['两座建筑都没标记', '商人不动'],
              ['最多 N', '目的建筑连同货物达到N时停止运送'],
              ['保留 N', '来源建筑留下N份'],
              ['聚落', '从整个聚落装货：先此仓库，再其路标网络覆盖的仓库和工坊'],
            ],
            foot: '“聚落”选项只对仓库或大本营有效，且只能用于路线上的一座建筑。最低库存同样限制装货。',
          },
        },
        {
          h: '与电脑贸易',
        },
        {
          list: [
            '只能和电脑玩家已建成、且有地图设定报价的建筑交易。',
            '把建筑加入路线时双方都要友好。之后只要商人所属民族友好就行：[[article:diplomacy|外交]]。',
            '报价是用N份一种物资换M份另一种，数字由地图决定。一条路线一次只做一个报价。',
            '电脑仓库每{{trade.refillSeconds}}秒把报价物资补回{{trade.refillLevel}}份。',
            '商人按车上装得下的完整交换次数拿货，并留出放报酬的位置。车小时，一次交换要分几趟跑完。',
            '他交出物资，收下报酬，有货就重复。建筑里没有报酬时他等待，不交货。',
            '“保留 N”在建筑里留下N份待售物资。回程上限N：建筑有N份报酬时商人收工。',
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
