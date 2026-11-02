import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: '经济',
  items: [
    {
      id: 'construction',
      name: '建造、升级与修理',
      lead: '一名建筑工人建一座一级民居要{{build.noviceSeconds}}秒，用铁质工具要{{build.noviceIronSeconds}}秒。',
      blocks: [
        {
          h: '哪里能建造',
        },
        {
          table: {
            head: ['建不了', '规则'],
            rows: [
              ['地形', '陆地、沙地、海滩、石漠可建。山地、雪地、水面和沼泽不行。'],
              ['[[building:work_well_00|水井]]、[[building:work_hive_00|蜂房]]', '建筑下方至少1格是草地'],
              ['空间', '建筑一开始就占用最高等级的轮廓和周围边距。两座建筑的边距不能重叠。'],
              ['树木、岩石、矿藏、木栅栏', '必须在轮廓之外'],
              [
                '敌方士兵',
                '{{contest.radius}}格内不能建，斜向约{{contest.diagonal}}格。只算可见的士兵，不算箭塔上岗的驻军。',
              ],
              ['和平关系玩家的建筑', '距其{{peace.keepOut}}格内不能建，工地也算，除非你的建筑离得更近。'],
              ['升级预留地', '现有建筑更高等级的轮廓已被占用，别的建筑不能建在那里。'],
              ['迷雾中的地块', '该位置此刻必须可见'],
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
          table: {
            head: ['会让开的', '规则'],
            rows: [
              ['居民、载具、工作旗帜、路标、堆垛、尸体', '被移到一旁'],
              ['灌木、田地、树桩、已打开的箱子', '放下工地时被清除'],
              ['道路工地', '被取消，已运到的毛石落在旁边'],
              [
                '升级预留地上的道路、木栅栏',
                '默认绕开。画线时按键切换“也可建在建筑升级预留地上”可铺在上面，但升级时会拆掉且不返还。',
              ],
            ],
          },
        },
        {
          table: {
            head: ['不受影响', '规则'],
            rows: [
              ['敌方平民、动物', '工地可建在他们旁边'],
              ['已铺好的道路', '留在建筑下方'],
              ['路标范围', '不限制。工地可建在网络外，网络覆盖到那里后建筑工人才能过去。'],
            ],
          },
        },
        {
          h: '建造时长',
        },
        {
          table: {
            head: ['[[building:home_level_00|一级民居]]，1名建筑工人', '每击点数', '敲击数', '时长'],
            rows: [
              [
                '新手，无工具',
                '{{build.novicePoints}}',
                '{{build.noviceSwings}}',
                '{{build.noviceSeconds}}秒',
              ],
              [
                '新手，[[good:tool_iron|铁质工具]]',
                '{{build.noviceIronPoints}}',
                '{{build.noviceIronSwings}}',
                '{{build.noviceIronSeconds}}秒',
              ],
              [
                '大师，[[good:tool_iron|铁质工具]]',
                '{{build.masterIronPoints}}',
                '{{build.masterIronSwings}}',
                '{{build.masterIronSeconds}}秒',
              ],
            ],
            num: [1, 2, 3],
            foot: '1份材料等于{{build.pointsPerUnit}}建造点。一级民居需要{{build.homeUnits}}份材料，共{{build.homePoints}}点。时长只算敲击，不含搬运材料。每次敲击{{build.swingSeconds}}秒。',
          },
        },
        {
          table: {
            head: ['经验', '无工具', '木质', '铁质'],
            rows: [
              ['0-9%', 1, 1, 2],
              ['10-21%', 1, 2, 2],
              ['22-49%', 1, 2, 3],
              ['50-78%', 2, 2, 3],
              ['79-89%', 2, 2, 4],
              ['90-100%', 2, 3, 4],
            ],
            num: [1, 2, 3],
            foot: '每次敲击的建造点。[[job:builder|建筑工人]]完成{{exp.build.repeatsFull}}次有进度的敲击后经验到100%。',
          },
        },
        {
          list: [
            '无成本的建筑只需敲1下。',
            '一段木栅栏或道路在材料运到后敲1下，由1名建筑工人完成。',
            '建筑工人和分配到工地的工人运材料，每次1份。',
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
            '花费所升等级的材料。可一次跨多级，只要每一级都已解锁。',
            '建筑库存中属于升级成本的物资直接进入工地。其余库存在完工后返回。',
            '工人和住户搬出，保留名额，完工后回来。',
            '升级期间生命值不变，完工后按新等级回满。',
            '开始升级会关闭防御模式。',
            '新建筑下方的木栅栏和道路消失，不返还。',
            '取消时退回库存和从中取走的物资，已运到的材料作废。',
          ],
        },
        {
          h: '修理',
        },
        {
          table: {
            head: ['目标', '每击回复生命值', '同时工作的工人数'],
            rows: [
              ['建筑', '{{repair.minPerSwing}}-{{repair.maxPerSwing}}', '{{repair.crew}}'],
              ['木栅栏段', 5, '{{repair.wallCrew}}'],
              ['栅门', 5, '{{repair.wallCrew}}'],
            ],
            num: [1, 2],
            foot: '修理不花材料。建筑每个建造点回复{{repair.perPoint}}点生命值。木栅栏和栅门的修理不受经验和工具影响。',
          },
        },
        {
          list: [
            '敌人攻击后要等{{repair.calmSeconds}}秒，且{{alert.standTo}}格内不能有人战斗，才会修理。玩家命令可跳过这两个条件。',
            '工地和在建的木栅栏段没有修理一说，生命值随建造增长。',
            '受损建筑升级时先修理，再升级。',
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
              ['拆除或摧毁建筑', '库存加一半成本，每项向上取整'],
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
      lead: '计数器决定工人做多少批：0为停止，∞为不停。一批就是执行一次配方。',
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
            foot: '工坊按批计数，不按份。经验和工具能让一批产出更多份：[[article:tools|工具]]。',
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
              ['学过多门课程、由助手分配的毕业生', '学校学过的产品∞，其余0'],
              ['只有1种产品的工坊', '该产品∞'],
              ['[[job:collector|采集者]]', '所有物资∞'],
            ],
          },
        },
        {
          h: '计数器何时变化',
        },
        {
          p: '每次更换工作场所或职业都会清空，建筑被拆时也一样。升级会保留，新等级增加的产品为0。每名工人的计数器各自独立：同一工坊的2个人可以做2种产品。',
        },
        {
          h: '同时做多种产品',
        },
        {
          p: '计数大于0的产品按面板顺序轮流生产，每次1批。',
        },
        {
          table: {
            head: ['情况', '结果'],
            rows: [
              ['产品货架已满', '轮到下一种。在制批次算占用位置。'],
              ['建筑内没有原料', '轮到下一种'],
              ['建筑内原料不足', '等待补齐。无处可取时才轮到下一种。'],
              ['所有计数都是0', '工人不开工'],
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
            '载具不算批次。工匠在工坊旁开车场，自己运材料并建造。',
            '载具计数在完工时减少，不是开工时。',
            '工坊旁放不下车场时，轮到下一种产品。',
          ],
        },
        {
          h: '采集者',
        },
        {
          p: '采集者用同一个面板。物资按钮在这里叫“仅此物资”。',
        },
        {
          table: {
            head: ['操作', '结果'],
            rows: [
              ['“仅此物资”', '此物资∞，其余0'],
              ['右键点击资源', '“采集”：此物资∞，其余0，工作旗帜不动'],
              ['Ctrl+右键点击资源', '同上，旗帜移到资源处'],
              ['所有计数都是0', '状态“全部设为 0”'],
              ['有工作场所的采集者', '只能选建筑能存放的物资'],
              ['计数为0但物资在地上', '计数只管开采。树干和堆垛采集者照样搬运。'],
            ],
            foot: '[[job:hunter|猎人]]、[[job:scout|侦察兵]]和士兵没有计数器。',
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
      lead: '新手敲{{gather.strokes}}下砍倒一棵树，得{{gather.treeYield}}份木材。',
      blocks: [
        {
          h: '资源产出',
        },
        {
          table: {
            head: ['资源', '谁来采', '产出', '新手敲击数', '工具'],
            rows: [
              [
                '树',
                '[[job:collector|采集者]]',
                '{{gather.treeYield}}份[[good:wood|木材]]',
                '每棵{{gather.strokes}}',
                '是',
              ],
              [
                '岩石',
                '[[job:collector|采集者]]',
                '4-5份[[good:stone|毛石]]',
                '每份{{gather.strokes}}',
                '是',
              ],
              [
                '矿藏',
                '[[job:collector|采集者]]',
                '5份[[good:mud|黏土]]、[[good:iron|铁矿]]或[[good:gold|金矿]]',
                '每份{{gather.strokes}}',
                '是',
              ],
              ['蘑菇', '[[job:collector|采集者]]', '1份[[good:mushroom|蘑菇]]', '拾取1次', '否'],
              ['麦田', '[[job:farmer|农夫]]', '1份[[good:wheat|小麦]]', '每块{{gather.wheatStrokes}}', '是'],
              [
                '草药田',
                '[[job:herb_mush_guy|草药师]]',
                '1份[[good:herb|草药]]',
                '每块{{gather.herbStrokes}}',
                '是',
              ],
              ['鱼群', '[[job:fisher|渔夫]]', '1份[[good:fish|鱼]]', '{{gather.casts}}竿', '是'],
              ['果灌木', '饥饿的居民', '就地吃1餐', '吃1次', '否'],
            ],
          },
        },
        {
          list: [
            '树一次倒下，{{gather.treeYield}}份木材留在树干上，采集者每次搬1份。',
            '岩石或矿藏每采1份就掉在矿藏旁的地上。',
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
                '该居民本人。第一人为全聚落发现该物资。',
              ],
              ['[[building:school|学校]]', '物资已发现后上课', '毕业生'],
            ],
            foot: '[[good:iron|铁矿]]和[[good:gold|金矿]]的条件分开计算，每名居民也分开计算。达成之前面板显示“已锁定”。',
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
          table: {
            head: ['阶段', '发生什么'],
            rows: [
              ['1', '已播种'],
              ['2-{{field.lastSeedStage}}', '每次浇水长1阶段，本田和6块相邻田都算'],
              ['{{field.ripeStage}}', '成熟，等待收割'],
              ['收割后', '1份留在地上，空地可重新播种'],
            ],
            foot: '田地只靠浇水生长，时间不起作用。',
          },
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
            foot: '斜向半径约{{field.diagonal}}格。田数上限按建筑计算，人多只是周转更快。',
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
          p: '田地需要可耕种的土地，沙地和道路不行。建筑半径内地图自带的野生田计入其上限。',
        },
        {
          p: '从建筑门口连续{{field.reclaimSeconds}}秒无法到达的田会消失，腾出上限名额。',
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
      lead: '工具减少敲击次数，增加工坊产量，可用{{tool.uses}}次。',
      blocks: [
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
              ['[[job:builder|建筑工人]]', '每击建造点更多'],
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
            foot: '需敲{{gather.strokes}}下的资源：树、岩石、矿藏、草药田。',
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
            foot: '捕鱼，每条鱼{{gather.casts}}竿。',
          },
        },
        {
          p: '[[good:wheat|小麦]]无工具时每块田敲{{gather.wheatStrokes}}下，有工具或经验达到20%时敲1下。',
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
            foot: '按产出1份的配方计算。产出2份的配方：加成×2。每批的原料和时长不变。经验对屠宰所得物资同样有效。',
          },
        },
        {
          p: '小数部分在工坊内累积，凑满1份放上货架，可超过容量。',
        },
        {
          h: '耗损',
        },
        {
          table: {
            head: ['工作', '工具耗损'],
            rows: [
              ['工坊批次', '每完成一批算1次'],
              ['采集敲击', '每击1次，没采出来也算'],
              ['抛竿', '每竿1次，没钓到也算'],
              ['建筑工人敲击', '每击1次，修理和没有进度的敲击也算'],
              ['浇水', '每次浇水1次'],
              ['播种、拾蘑菇', '0'],
            ],
            foot: '用满{{tool.uses}}次后工具消失，居民徒手工作，直到拿到新工具。',
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
          h: '优先与最低库存',
        },
        {
          table: {
            head: ['项目', '优先', '最低库存'],
            rows: [
              ['适用范围', '单座建筑：仓库、大本营、兵营、箭塔', '玩家所有仓库和大本营合计'],
              ['谁来运', '该建筑的搬运工', '仓库、大本营、水井和蜂房的搬运工'],
              ['来源', '其他仓库、工坊产品、堆垛', '工坊产品、水井、蜂房、堆垛'],
              ['运到何时', '建筑还有空位时', '合计低于最低库存时'],
              ['上限', '建筑容量', '每种物资{{haul.minimumMax}}份'],
              ['限制', '无', '低于最低库存时没人能从仓库取货'],
            ],
            foot: '仓库只把高于最低库存的部分交给优先仓库。',
          },
        },
        {
          p: '吃饭也受最低库存限制。全部食物都在最低库存之内时，没人能从仓库吃。',
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
              ['[[good:handcart|手推车]]', '{{haul.handcart}}', '{{haul.handcartLossPct}}%'],
              ['[[good:oxcart|牛车]]', '{{haul.oxcart}}', '{{haul.oxcartLossPct}}%'],
            ],
            num: [1, 2],
            foot: '减速随载重增加。[[job:trader|商人]]的车辆数值相同。',
          },
        },
        {
          list: [
            '只有有工作场所的搬运工和[[job:trader|商人]]能用车。搬运工保留工作场所，把车当工具用。',
            '车必须是自己的且空闲：没有乘员，没有别的车夫，在同一片陆地上。',
            '车上有空位时，仓库搬运工顺路拾取{{haul.cartTopUp}}格内堆垛和成品中的同种物资，然后返回。',
            '失去工作场所后车留在原地。',
          ],
        },
        {
          h: '地面堆垛',
        },
        {
          list: [
            '同一处只放1种物资，最多{{haul.groundStack}}份。',
            '堆垛没有主人，谁都能拿。',
            '搬运工没有工作旗帜时在建筑{{flag.radius}}格内拾取，有旗帜时在旗帜{{flag.radius}}格内。',
          ],
        },
        {
          h: '工作范围',
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
            foot: '单位为格。受路标限制的职业，工作区域到路标范围为止。',
          },
        },
        {
          p: '农场、草药屋、水井、蜂房、箭塔和兵营的搬运工不接受工作旗帜。',
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
      lead: '旗帜划定工作区域，本身不存东西。没有工作场所的采集者把物资留在地上。',
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
            foot: '有旗帜时的区域见[[article:hauling|搬运工与仓库]]的“工作范围”表。',
          },
        },
        {
          h: '旗帜旁的堆垛',
        },
        {
          list: [
            '旗帜下的物资不会自己进仓库，需要有工作场所的搬运工。',
            '仓库搬运工只够到建筑{{flag.radius}}格内。更远时，在采集者的旗帜旁给他插一面自己的旗帜。',
            '有旗帜的搬运工拿旗帜周围的堆垛和成品，运回自己的建筑。',
            '移动旗帜不影响堆垛，它们留在原地。',
          ],
        },
        {
          h: '按钮',
        },
        {
          table: {
            head: ['按钮', '效果'],
            rows: [
              [
                '“插下旗帜”',
                '在指定位置插旗，或把旗帜移过去。目标被占用时在{{flag.snap}}格内找位置，再远命令作废。',
              ],
              ['“收回旗帜”', '仅限有工作场所者，移除旗帜'],
              ['“显示工作区域”', '显示区域圆圈。旗帜在场时有效。'],
              ['“显示旗帜”', '镜头移到旗帜上'],
            ],
            foot: 'Ctrl+右键也能移动所选工人的旗帜。',
          },
        },
        {
          p: '打开[[article:assistant|助手]]的开关后，采集者会自己移动旗帜：与资源相距{{assistant.flagMin}}-{{assistant.flagMax}}格，区域采空后移到离自己建筑最近的资源。猎人和渔夫的旗帜不动。',
        },
        {
          h: '路标范围外的旗帜',
        },
        {
          p: '旗帜可以插在范围外。工人立即进入“迷路了”状态，站着不动，直到网络覆盖那里。猎人不受影响：[[article:roads|道路与路标]]。',
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
          p: '路标由[[job:scout|侦察兵]]竖立，不花材料。路标网络属于单个玩家。',
        },
        {
          figure: {
            id: 'reach',
            caption: '网络范围',
          },
        },
        {
          table: {
            head: ['范围（格）', '居民', '[[job:carrier|搬运工]]', '备注'],
            rows: [
              ['步行', '{{reach.walk}}', '{{reach.carrier}}', '从所在位置算起'],
              ['居民到路标', '小于{{reach.walk}}', '小于{{reach.carrier}}', '开放整个相连的网络'],
              ['路标到目标', '小于{{reach.walk}}', '小于{{reach.carrier}}', '从该网络任一路标算起'],
              [
                '两路标相连',
                '小于{{reach.link}}',
                '小于{{reach.link}}',
                '两者间路线不超过{{reach.linkRoute}}格',
              ],
              ['与自家路标的间距', '至少{{reach.spacing}}', '至少{{reach.spacing}}', '再近放不下'],
              ['寻找物资', '小于{{reach.goods}}', '小于{{reach.goods}}', '也从此范围内的路标算起'],
              ['建筑压住路标', '{{reach.displace}}', '{{reach.displace}}', '路标移开，再远则消失'],
            ],
            num: [1, 2],
          },
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
          },
        },
        {
          p: '侦察兵、士兵、英雄、[[job:hunter|猎人]]和[[job:druid|德鲁伊]]不受范围限制。',
        },
        {
          p: '工作场所或工作旗帜在范围外的工人闲着，直到网络覆盖那里。手上的物资还是会送回去。',
        },
        {
          h: '路标面板',
        },
        {
          table: {
            head: ['项目', '含义'],
            rows: [
              ['“网络内物资”', '整个相连网络范围内的物资：建筑、堆垛、车辆、手上。每份只算一次。'],
              ['“路标：N”', '相连路标数，含当前路标'],
              ['“拆除”', '路标立即消失，无需确认，也不用侦察兵'],
              ['相邻路标', '与被拆路标断开连接'],
              ['网络', '被拆路标是唯一连接时，网络分裂'],
              ['新范围外的工人', '状态“迷路了”，站着不动，直到网络恢复'],
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
            foot: '穿鞋、空手的居民。鞋子走道路的磨损比走陆地慢：×{{shoes.roadWear}}。',
          },
        },
        {
          list: [
            '每段花1份[[good:stone|毛石]]和[[job:builder|建筑工人]]敲1下，排在建筑和木栅栏之后。',
            '工人还会把毛石铺到最多6段相邻路段上，前提是没人正在去、那里也没有毛石。',
            '取消路段：已运到的毛石落在旁边。',
            '建筑升级压到道路：道路消失，毛石不返还。',
            '居民寻路时，走道路更省就会自动走。',
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
            foot: '手上拿货时鞋子磨损更快：×{{shoes.carryWear}}。赤脚每步的体力消耗见[[article:needs|需求]]。',
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
              ['武器和护甲重量2-3，英雄除外', '+{{step.weightLowExtra}}秒'],
              ['武器和护甲重量4-5，英雄除外', '+{{step.weightHighExtra}}秒'],
              ['[[good:amulet_speed|疾风护符]]', '-{{step.amuletSaved}}秒'],
              ['满载[[good:handcart|手推车]]', '慢{{haul.handcartLossPct}}%'],
              ['满载[[good:oxcart|牛车]]', '慢{{haul.oxcartLossPct}}%'],
            ],
            foot: '每步最快{{step.shortest}}秒。车辆减速随载重增加。',
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
            head: ['货舱', '装1份用时'],
            rows: [
              ['手拿', '{{trade.handsSeconds}}秒'],
              ['[[good:handcart|手推车]]', '{{trade.handcartSeconds}}秒'],
              ['[[good:oxcart|牛车]]', '{{trade.oxcartSeconds}}秒'],
            ],
            num: [1],
            foot: '卸货用时相同。容量和减速见[[article:hauling|搬运工与仓库]]。',
          },
        },
        {
          p: '单程20-30格时，两种车单位时间运量相同。更短用手推车，更远用牛车。',
        },
        {
          h: '路线',
        },
        {
          list: [
            '路线包含{{trade.stops}}座已建成的建筑。自家任何有库存的建筑都行，外方建筑最多1座。',
            '建筑升级时，[[job:trader|商人]]等到完工。',
            '商人不从民居拿食物。',
          ],
        },
        {
          h: '自家建筑之间',
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
            foot: 'A和B是路线上的两座建筑。“聚落”选项只对仓库或大本营有效，且只能用于一个站点。最低库存同样限制装货。',
          },
        },
        {
          h: '与电脑贸易',
        },
        {
          list: [
            '外方建筑属于电脑玩家，已建成，且有地图设定的报价。',
            '加入路线要求双方立场都友好，每趟只看商人所属民族一方：[[article:diplomacy|外交]]。',
            '报价是用N份一种物资换M份另一种，数字由地图决定。一条路线一次只做一个报价。电脑仓库每{{trade.refillSeconds}}秒把报价物资补回{{trade.refillLevel}}份。',
            '商人按货舱能装下的完整批次拿货，并留出回程货的位置。货舱小时，一批分多趟运。',
            '交出一批，收取报酬，有货就重复。建筑里没有报酬时商人等待，不交货。“保留 N”在建筑里留下N份待售物资。回程上限N：建筑有N份报酬时停止。',
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
