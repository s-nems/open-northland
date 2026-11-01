import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const EXPERIENCE: ArticleGroup = {
  group: '经验',
  items: [
    {
      id: 'exp-work',
      name: '工作经验',
      lead: '每种物资有独立的经验线：木材100%不会加快毛石。',
      blocks: [
        {
          h: '经验的作用',
        },
        {
          figure: {
            id: 'exp-curve',
            caption: '最初几份提升最大',
          },
        },
        {
          data: 'experience',
        },
        {
          p: '不足1点不起作用。[[article:gathering|采集]]时经验减少敲击次数，工坊和屠宰时经验增加产量。带工具的数值见[[article:tools|工具]]。建造点数见[[article:construction|建造、升级与修理]]。',
        },
        {
          h: '需要多少工作量',
        },
        {
          table: {
            head: ['工作', '计数单位', '每份点数', '到51%', '到100%'],
            rows: [
              [
                '木材',
                '砍倒的树',
                '{{exp.wood.points}}',
                '{{exp.wood.repeatsQuoted}}',
                '{{exp.wood.repeatsFull}}',
              ],
              [
                '狩猎',
                '从猎物身上取的每份',
                '{{exp.hunt.points}}',
                '{{exp.hunt.repeatsQuoted}}',
                '{{exp.hunt.repeatsFull}}',
              ],
              ['捕鱼', '鱼', '{{exp.fish.points}}', '{{exp.fish.repeatsQuoted}}', '{{exp.fish.repeatsFull}}'],
              [
                '黏土、毛石、铁矿、金矿、蘑菇、小麦、屠宰、工坊',
                '按份，屠宰按头，工坊按批',
                '{{exp.craft.points}}',
                '{{exp.craft.repeatsQuoted}}',
                '{{exp.craft.repeatsFull}}',
              ],
              [
                '建造、修理',
                '有进度的一次敲击',
                '{{exp.build.points}}',
                '{{exp.build.repeatsQuoted}}',
                '{{exp.build.repeatsFull}}',
              ],
            ],
            num: [2, 3, 4],
            foot: '后两列的单位是树、份、批或敲击次数。经验线按工作和物资命名，如“采集 - 铁矿”“烘焙 - 面包”。所有民族的经验线相同。',
          },
        },
        {
          p: '每棵树、每份、每批还给职业的通用经验线加1点，如“采集”。通用经验线解锁后续[[article:trades|职业]]，也用于没有专属经验线的物资。换职业不丢点数。',
        },
        {
          h: '谁得不到好处',
        },
        {
          list: [
            '[[job:carrier|搬运工]]积累“搬运”，不会加快工作。运送{{exp.carrierTrader}}次解锁[[job:trader|商人]]。',
            '商人积累“贸易”，每卸1份得{{exp.tradePointPerUnit}}点。贸易经验没有任何效果。',
            '[[job:scout|侦察兵]]不积累点数。[[job:woman|妇女]]和儿童没有经验线。',
            '种植、浇水、[[building:school|学校]]和[[building:barracks|兵营]]都不给点数。',
          ],
        },
      ],
      see: ['article:tools', 'article:trades', 'article:exp-combat', 'article:construction'],
    },
    {
      id: 'exp-combat',
      name: '战斗经验',
      lead: '同一类武器命中一百次，近战伤害翻倍。',
      blocks: [
        {
          h: '近战伤害',
        },
        {
          table: {
            head: ['命中次数', '倍率', '{{combat.sampleBlow}}伤害变为'],
            rows: [
              [0, '×1', '{{combat.sampleBlow}}'],
              [10, '×{{fight.factor.10}}', '{{fight.blow.10}}'],
              [25, '×{{fight.factor.25}}', '{{fight.blow.25}}'],
              [50, '×{{fight.factor.50}}', '{{fight.blow.50}}'],
              [75, '×{{fight.factor.75}}', '{{fight.blow.75}}'],
              ['{{combat.fightCapHits}}', '×{{combat.fightCapFactor}}', '{{combat.fightCapBlow}}'],
            ],
            num: [0, 1, 2],
            foot: '超过{{combat.fightCapHits}}次后倍率不再增长。',
          },
        },
        {
          p: '倍率适用于近战攻击人、动物和建筑。对[[article:walls|木栅栏]]、[[article:vehicles|载具]]无效，射击和[[article:catapult|投石机]]也无效。',
        },
        {
          h: '命中率',
        },
        {
          p: '弓和投石机：0次命中时命中率{{aim.basePct}}%，{{aim.sureHits}}次时100%。数值表见[[article:aim|命中与射击]]。',
        },
        {
          h: '什么算命中',
        },
        {
          p: '造成伤害的一击或一箭，给武器类别加1点：徒手、矛、剑、弓或投石机。[[job:hunter|猎人]]的弓也算弓。一发打中多个目标只算一次。',
        },
        {
          p: '类别经验线名为“战斗 - 类别”。不同类别的命中互不通用，换职业不丢失。',
        },
        {
          h: '解锁武器',
        },
        {
          table: {
            head: ['武器', '工匠', '条件'],
            rows: [
              ['[[good:spear_wooden|木矛]]', '[[job:armorer|武器匠]]', '无'],
              ['[[good:spear_iron|铁矛]]', '[[job:smith|铁匠]]', '{{exp.ironSpearNeed}} × 锻造'],
              ['[[good:sword_shord|短剑]]', '[[job:smith|铁匠]]', '无'],
              ['[[good:sword_long|长剑]]', '[[job:smith|铁匠]]', '{{exp.longSwordNeed}} × 锻造'],
              ['[[good:bow_short|短弓]]', '[[job:armorer|武器匠]]', '无'],
              ['[[good:bow_long|长弓]]', '[[job:armorer|武器匠]]', '{{exp.longBowNeed}} × 武器制造'],
            ],
            foot: '五个民族都一样。',
          },
        },
        {
          p: '命中次数不限制武器使用。士兵能拿范围内仓库的任何武器，没有命中记录也行，拿到就成为该武器的兵种。[[article:trades|职业与学校]]里{{exp.classLowNeed}}或{{exp.classHighNeed}}次命中的门槛只记录聚落发现了该兵种，并在“更换职业”中开放选择。',
        },
        {
          h: '星标',
        },
        {
          p: '士兵用手中武器命中25次后佩戴星标。每25次变大一级，100次时最大。',
        },
        {
          h: '英雄',
        },
        {
          p: '英雄不累计命中，伤害不会增长。',
        },
      ],
      see: [
        'article:damage',
        'article:aim',
        'article:heroes',
        'article:exp-work',
        'article:trades',
        'building:barracks',
      ],
    },
    {
      id: 'trades',
      name: '职业与学校',
      lead: '发现归玩家所有，获得它的工人死后依然保留。',
      blocks: [
        {
          p: '大厅选项“职业发展：开局全部解锁”取消平民职业和产品的条件。士兵职业的条件和地图禁令不受影响。',
        },
        {
          h: '解锁职业',
        },
        {
          data: 'jobs',
        },
        {
          p: '需要两条经验线的条件按总和计算。[[job:builder|建筑工人]]、采集者、[[job:farmer|农夫]]、[[job:hunter|猎人]]、[[job:fisher|渔夫]]、[[job:carrier|搬运工]]和[[job:scout|侦察兵]]一开始就可用。',
        },
        {
          p: '产品解锁方式相同，例如[[good:furniture|家具]]需要{{exp.furnitureNeed}} × 木工。所有民族的条件相同。',
        },
        {
          h: '发现的过程',
        },
        {
          steps: [
            '居民从事前置职业，如[[job:collector|采集者]]砍树。',
            '砍倒{{exp.joinerNeed}}棵树后达到[[job:joiner|木匠]]条件，游戏宣布发现。',
            '全聚落解锁该职业，这名居民可以立即转职。',
            '其他人去[[building:school|学校]]，或靠工作达到同样条件。',
          ],
        },
        {
          h: '学校与兵营',
        },
        {
          table: {
            head: ['项目', '学校', '兵营'],
            rows: [
              ['名额', '{{school.seats}}', '{{barracks.seats}}'],
              ['教授', '平民职业或产品', '士兵职业'],
              ['时长', '见下表', '{{barracks.drillSeconds}}秒'],
              ['对象', '成年男性', '成年男性，有职业也可以'],
              ['经验点数', '0', '0'],
              ['结业后', '获得新职业，在学校旁等待分配', '成为徒手士兵，原职业保留为已知'],
            ],
            foot: '超出名额的学员按报名顺序在门口排队。',
          },
        },
        {
          list: [
            '需求打断课程不丢进度。取消课程则清零。',
            '派往在建学校的学员先运材料，然后等待。',
            '结业的课程永久有效，换职业也不丢。',
          ],
        },
        {
          h: '课程时长',
        },
        {
          table: {
            head: ['课程', '时长'],
            rows: [
              [
                '[[good:armor_leather|皮甲]]、[[good:potion_food_small|小型营养药水]]、[[good:potion_stamina_small|小型耐力药水]]',
                '{{course.shortSeconds}}秒',
              ],
              ['职业和大多数产品', '{{course.commonSeconds}}秒'],
              ['[[good:potion_heal_big|大型治疗药水]]', '{{course.healSeconds}}秒'],
              ['[[good:handcart|手推车]]', '{{course.handcartSeconds}}秒'],
              ['[[good:oxcart|牛车]]', '{{course.oxcartSeconds}}秒'],
              [
                '[[good:ship_small|船]]、[[good:ship_big|大船]]、[[good:catapult|投石机]]',
                '{{course.shipSeconds}}秒',
              ],
            ],
            num: [1],
          },
        },
        {
          h: '职业与工作场所',
        },
        {
          p: '职业和工作场所是两回事。“更换职业”会清除工作场所，没人会自动分配新的。例外是毕业生，前提是在[[article:assistant|助手]]里打开了对应开关。',
        },
        {
          table: {
            head: ['职业', '建筑', '没有建筑时'],
            rows: [
              ['[[job:builder|建筑工人]]', '不需要', '自己去工地。'],
              ['[[job:scout|侦察兵]]', '不需要', '听命令行动。'],
              ['[[job:trader|商人]]', '不需要', '跑自己的[[article:trade|路线]]。'],
              ['[[job:civilist|平民]]', '不需要', '不工作，等待分配。'],
              [
                '[[job:collector|采集者]]、[[job:hunter|猎人]]、[[job:fisher|渔夫]]',
                '可选',
                '围绕[[article:work-flag|工作旗帜]]工作，转职时旗帜插在脚下。',
              ],
              ['[[job:farmer|农夫]]、[[job:herb_mush_guy|草药师]]', '必需', '不耕种。'],
              ['[[job:carrier|搬运工]]', '必需', '什么也不运。'],
              ['其他平民职业', '必需', '闲着。'],
            ],
          },
        },
        {
          list: [
            '右键点击建筑（“在此工作”），一条命令同时换职业并分配工作场所。',
            '不满足该建筑职业的条件时，居民会占用那里空着的搬运工岗位，如果有的话。',
            '士兵只接受本职业的岗位。',
            '“移除工作场所”保留职业和携带的物资，清除生产计数和搬运工推车。',
            '建筑被拆也保留职业。',
            '妇女、儿童和英雄永远不会获得职业。',
          ],
        },
        {
          h: '换职业的代价',
        },
        {
          table: {
            head: ['项目', '结果'],
            rows: [
              ['工作场所', '失去。'],
              ['生产计数', '失去。'],
              ['携带的物资', '掉在地上。'],
              ['工具', '保留。参军时新工具掉在地上，用过的消失。'],
              ['武器和护甲', '退伍时，没用过的拿在手里或掉在地上，用过的消失。'],
              ['命令', '当前命令和队列作废。“进食与睡眠”恢复“允许”。'],
              ['已学职业', '保留，包括前一个职业。经验点数同样保留。'],
            ],
            foot: '学校和兵营换职业的方式相同，但保留命令队列。搬运工会留下推车。',
          },
        },
      ],
      see: [
        'article:exp-work',
        'article:exp-combat',
        'article:assistant',
        'article:work-flag',
        'building:school',
        'building:barracks',
      ],
    },
  ],
};
