import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const EXPERIENCE: ArticleGroup = {
  group: '经验',
  items: [
    {
      id: 'exp-work',
      name: '工作经验',
      lead: '每种物资的经验单独计算：木材100%不会加快毛石。',
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
          p: '表里是普通工作的数值。木材、狩猎、捕鱼和建造的增长速度不同，见下表。[[article:gathering|采集]]时经验让每份少敲几下，工坊和屠宰时经验多出几份。经验与工具的配合见[[article:tools|工具]]，建造见[[article:construction|建造、升级与修理]]。',
        },
        {
          p: '选中自己的居民时，他身上有职业星标。他在本职业最好的技能到{{star.step}}%时出现，每{{star.step}}%变大一级，到{{star.full}}%为止。搬运工没有星标。',
        },
        {
          h: '需要多少工作量',
        },
        {
          table: {
            head: ['工作', '计数单位', '倍率', '到{{exp.quotedPct}}%的次数', '到100%的次数'],
            rows: [
              [
                '木材',
                '砍倒的树',
                '×{{exp.wood.points}}',
                '{{exp.wood.repeatsQuoted}}',
                '{{exp.wood.repeatsFull}}',
              ],
              [
                '狩猎',
                '从猎物身上取的每份',
                '×{{exp.hunt.points}}',
                '{{exp.hunt.repeatsQuoted}}',
                '{{exp.hunt.repeatsFull}}',
              ],
              [
                '捕鱼',
                '鱼',
                '×{{exp.fish.points}}',
                '{{exp.fish.repeatsQuoted}}',
                '{{exp.fish.repeatsFull}}',
              ],
              [
                '黏土、毛石、铁矿、金矿、蘑菇、草药、小麦、屠宰、工坊',
                '按份，屠宰按头，工坊按批',
                '×{{exp.craft.points}}',
                '{{exp.craft.repeatsQuoted}}',
                '{{exp.craft.repeatsFull}}',
              ],
              [
                '建造、修理',
                '在工地上敲一锤',
                '×{{exp.build.points}}',
                '{{exp.build.repeatsQuoted}}',
                '{{exp.build.repeatsFull}}',
              ],
            ],
            num: [2, 3, 4],
            foot: '后两列数的是树、份、批或敲击。经验到{{exp.quotedPct}}%后，无工具的[[job:builder|建筑工人]]每份材料少敲一半。居民面板的“经验”页里，每项技能占一行，例如“采集 - 铁矿：{{exp.craft.repeatsQuoted}} 次，产量 +{{exp.quotedPct}}%”。',
          },
        },
        {
          p: '每棵树、每份、每批也计入职业的通用技能，例如“农业”。新职业由这个通用技能或某项物资的技能解锁：“农业”解锁[[job:miller|磨坊工]]，“采集 - 木材”解锁[[job:joiner|木匠]]。条件见[[article:trades|职业与学校]]。没有专属技能的物资按通用技能计算。换职业后经验还在。',
        },
        {
          h: '谁得不到好处',
        },
        {
          list: [
            '[[job:carrier|搬运工]]积累“搬运”。工作不会变快，但运送{{exp.carrierTrader}}次解锁[[job:trader|商人]]。',
            '商人每卸1份积累“贸易”，但“贸易”没有任何效果。',
            '[[job:scout|侦察兵]]、[[job:woman|妇女]]和儿童不积累经验。',
            '种植、浇水、[[building:school|学校]]和[[building:barracks|兵营]]都不给经验。',
          ],
        },
      ],
      see: ['article:tools', 'article:trades', 'article:exp-combat', 'article:construction'],
    },
    {
      id: 'exp-combat',
      name: '战斗经验',
      lead: '同一类武器命中{{combat.fightCapHits}}次，近战伤害翻倍。',
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
          p: '倍率适用于近战攻击人、动物和建筑。对[[article:walls|木栅栏]]和[[article:vehicles|载具]]无效，射击和[[article:catapult|投石机]]也无效。',
        },
        {
          p: '没有经验时，弓和投石机有{{aim.basePct}}%的射击能命中，{{aim.noSpreadHits}}次命中起每一发都落在目标上。详见[[article:aim|命中与射击]]。',
        },
        {
          h: '什么算命中',
        },
        {
          p: '造成伤害的一击或一箭算一次命中。每类武器单独计数：徒手、矛、剑、弓、投石机。[[job:hunter|猎人]]的射击也计入弓。',
        },
        {
          p: '在居民面板里是“战斗 - 剑”“战斗 - 弓”这样的行。剑的命中帮不了矛兵，换职业后也不丢。英雄的伤害不随战斗增长，除非任务开启了这一点。',
        },
        {
          p: '更好的武器靠制造解锁，不靠战斗。要求写在武器卡片上，例如[[good:sword_long|长剑]]。谁拿什么武器：[[article:equip|士兵装备]]。',
        },
      ],
      see: [
        'article:damage',
        'article:aim',
        'article:equip',
        'article:heroes',
        'article:exp-work',
        'article:trades',
        'building:barracks',
      ],
    },
    {
      id: 'trades',
      name: '职业与学校',
      lead: '发现的职业归整个聚落所有，发现它的居民死了也还在。',
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
          p: '条件列出两项技能时按总和计算。[[job:builder|建筑工人]]、采集者、[[job:farmer|农夫]]、[[job:hunter|猎人]]、[[job:fisher|渔夫]]、[[job:carrier|搬运工]]和[[job:scout|侦察兵]]一开始就可用。',
        },
        {
          p: '产品的解锁方式相同，例如[[good:furniture|家具]]需要木工：{{exp.furnitureNeed}} 次。',
        },
        {
          p: '满足条件的居民可以马上担任这个职业。其他人要去[[building:school|学校]]上课，或通过工作达到同样的条件。',
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
              ['对象', '成年男性', '成年男性'],
              ['结业后', '获得新职业，在学校旁等待分配', '成为徒手士兵，原职业保留为已知'],
            ],
            foot: '名额满了，后来的学员就在门口等。',
          },
        },
        {
          list: [
            '学员去吃饭或睡觉不会丢进度。把他从课程中撤下，进度就清零。',
            '派往在建学校的学员会运材料，然后等到学校建好。',
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
          p: '“更换职业”后居民会失去工作场所，也不会自动得到新的。例外是毕业生，前提是在[[article:assistant|助手]]里打开了他们的开关。',
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
            '右键点击建筑（“在此工作”），立即换职业并分配工作场所。',
            '不满足该建筑职业的条件时，居民会占用那里空着的搬运工岗位，如果有的话。',
            '士兵只接受本职业的岗位。',
            '“移除工作场所”和拆除建筑都不会让他失去职业。',
            '妇女、儿童和英雄永远不会获得职业。',
          ],
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
