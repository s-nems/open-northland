import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const WORLD: ArticleGroup = {
  group: '世界',
  items: [
    {
      id: 'goals',
      name: '任務目標與遊戲結束',
      lead: '你一個成年男性都沒有時就輸了。英雄算數，婦女、希拉和兒童不算。',
      blocks: [
        {
          h: '地圖如何結束',
        },
        {
          table: {
            head: ['地圖', '勝利', '失敗'],
            rows: [
              ['多人地圖，單人遊玩也算', '地圖目標，見下表', '沒有成年男性，或任務宣告失敗'],
              ['劇情任務', '由任務宣告', '由任務宣告，或沒有成年男性'],
              ['無任務地圖', '最後的倖存者', '沒有成年男性'],
            ],
          },
        },
        {
          h: '多人地圖目標',
        },
        {
          table: {
            head: ['目標', '計入範圍', '結果'],
            rows: [
              ['貨物', '建築裡的庫存。地面貨堆、貨艙和手上的貨物不算', '達到所有要求數量時勝利'],
              ['「居民」', '玩家的所有人，包括兒童', '達到人數時勝利'],
              ['「士兵」', '士兵職業的成年男性，不含英雄', '達到人數時勝利'],
              ['任務宣告', '任務宣告玩家勝利或失敗', '勝利或失敗'],
              [
                '最後的倖存者',
                '至少一名玩家出局，其餘玩家互相友好：[[article:diplomacy|外交]]',
                '其餘玩家全部勝利',
              ],
            ],
            foot: '貨物、「居民」和「士兵」的進度顯示為當前/要求。只有地圖沒有貨物或人數目標、任務也不宣告結果時，「最後的倖存者」才生效。',
          },
        },
        {
          list: [
            '遊戲開始後的前{{match.graceSeconds}}秒內，沒有男性不算失敗。',
            '結果只判定一次，之後不再改變。贏了的玩家之後就算失去所有人，也不會輸。',
            '一名玩家獲勝不會結束其他玩家的遊戲。',
          ],
        },
        {
          h: '戰敗者的結局',
        },
        {
          p: '在多人地圖上，戰敗者的建築、載具和路標消失，他在陸地上的人變成野雞，動物變為野生。在劇情任務和無任務地圖上，只有載具消失，電腦停止行動。',
        },
      ],
      see: ['article:diplomacy', 'article:family', 'article:heroes'],
    },
    {
      id: 'vehicles',
      name: '載具與船隻',
      lead: '沒有指揮官，載具哪裡也去不了。船載人更多，大船載貨更多。',
      blocks: [
        {
          p: '每種載具的貨艙、乘客座位、生命值和成本見其卡片：[[vehicle:handcart|手推車]]、[[vehicle:oxcart|牛車]]、[[vehicle:ship_small|船]]、[[vehicle:ship_big|大船]]、[[vehicle:catapult|投石機]]。哪座工坊造什麼，見[[building:work_joinery_02|三級木匠坊]]和[[building:work_joinery_03|四級木匠坊]]的卡片。',
        },
        {
          table: {
            head: ['載具', '誰能上'],
            rows: [
              [
                '[[good:handcart|手推車]]、[[good:oxcart|牛車]]',
                '[[job:carrier|搬運工]]、[[job:trader|商人]]',
              ],
              ['[[good:ship_small|船]]、[[good:ship_big|大船]]', '任何成人'],
              ['[[good:catapult|投石機]]', '士兵、英雄'],
            ],
          },
        },
        {
          list: [
            '卡片上的乘客數不含指揮官。第一個被指派的人成為指揮官，他離開後由下一名乘客接任。',
            '[[job:joiner|木匠]]在工坊旁的工場造載具，在岸邊水面造船。',
            '上載具的人失去工作地點。只有有工作地點的搬運工和商人自己拉車，保留工作。',
            '指揮官和船上每名成年男性都會裝貨，但士兵、英雄、[[job:scout|偵察兵]]和[[job:druid|德魯伊]]只在當指揮官時才裝。沒人裝貨時顯示「沒有搬運工」。',
          ],
        },
        {
          h: '選哪種車',
        },
        {
          list: [
            '[[good:handcart|手推車]]適合短途，[[good:oxcart|牛車]]適合長途：它能裝{{haul.oxcart}}件，裝滿後幾乎不減速。',
            '給[[job:carrier|搬運工]]配手推車：在建築之間的短途往返中，同樣時間能運更多。',
            '給[[job:trader|商人]]配牛車：在長途貿易路線上能運更多。路線多長才划算：[[article:trade|貿易]]。',
          ],
        },
        {
          h: '載重與速度',
        },
        {
          table: {
            head: ['載具', '道路：空載', '道路：滿載'],
            rows: [
              ['[[good:handcart|手推車]]', '{{pace.cartRoad}}', '{{pace.handcartRoadFull}}'],
              ['[[good:oxcart|牛車]]', '{{pace.cartRoad}}', '{{pace.oxcartRoadFull}}'],
              ['[[good:catapult|投石機]]', '{{pace.catapultRoad}}', '-'],
            ],
            num: [1, 2],
            foot: '單位為格/秒。滿載指手推車{{haul.handcart}}份、牛車{{haul.oxcart}}份。陸地上的速度見下表。路線選車見[[article:trade|貿易]]。',
          },
        },
        {
          h: '載貨多少，慢多少',
        },
        {
          table: {
            head: ['裝載', '手推車：速度損失', '手推車：陸地格/秒', '牛車：速度損失', '牛車：陸地格/秒'],
            rows: [
              [
                '{{vehicle.fill.0}}%',
                '{{vehicle.handcartLoss.0}}%',
                '{{pace.handcartLand.0}}',
                '{{vehicle.oxcartLoss.0}}%',
                '{{pace.oxcartLand.0}}',
              ],
              [
                '{{vehicle.fill.25}}%',
                '{{vehicle.handcartLoss.25}}%',
                '{{pace.handcartLand.25}}',
                '{{vehicle.oxcartLoss.25}}%',
                '{{pace.oxcartLand.25}}',
              ],
              [
                '{{vehicle.fill.50}}%',
                '{{vehicle.handcartLoss.50}}%',
                '{{pace.handcartLand.50}}',
                '{{vehicle.oxcartLoss.50}}%',
                '{{pace.oxcartLand.50}}',
              ],
              [
                '{{vehicle.fill.75}}%',
                '{{vehicle.handcartLoss.75}}%',
                '{{pace.handcartLand.75}}',
                '{{vehicle.oxcartLoss.75}}%',
                '{{pace.oxcartLand.75}}',
              ],
              [
                '{{vehicle.fill.100}}%',
                '{{vehicle.handcartLoss.100}}%',
                '{{pace.handcartLand.100}}',
                '{{vehicle.oxcartLoss.100}}%',
                '{{pace.oxcartLand.100}}',
              ],
            ],
            num: [0, 1, 2, 3, 4],
            foot: '裝載指貨艙佔用的比例。速度損失隨裝載均勻增加：滿載的手推車慢{{vehicle.handcartLoss.100}}%，半載慢{{vehicle.handcartLoss.50}}%。滿載的牛車慢{{vehicle.oxcartLoss.100}}%。作為對比：穿鞋的居民在陸地上每秒走{{pace.walkerLand}}格（每步{{step.landBrief}}秒）。',
          },
        },
        {
          list: [
            '這是有指揮官時車的速度。鞋子在這裡沒有作用。',
            '自己拉車的搬運工和商人按自己的步速走，穿鞋更快。載重讓他們減速的百分比相同：穿鞋的商人拉滿載手推車在陸地上每步{{step.traderFullCart}}秒。',
            '[[good:catapult|投石機]]在陸地上的速度為{{pace.catapultLand}}格/秒。',
            '船裝了貨也不減速，約{{pace.ship}}格/秒。',
          ],
        },
        {
          h: '牛車用牛',
        },
        {
          p: '造好的牛車會等待役畜，牽走同一陸地上最近的成年[[good:cattle|牛]]。每座畜牧場給自己保留{{livestock.pair}}頭成年牛，沒有畜牧場的牛群也保留這麼多，所以牛車只能牽走超出這個數的牛。',
        },
        {
          h: '船隻',
        },
        {
          list: [
            '船能載1輛載具：手推車、牛車或投石機，前提是載具的乘員上得了船。大船不載載具。',
            '「靠岸」：指定岸邊，船停在離它{{vehicle.mooringDistance}}格處。不需要港口。',
            '海上不能上下船。',
            'Ctrl/Cmd + 右鍵：靠岸並讓乘員登陸。',
          ],
        },
        {
          h: '貨艙',
        },
        {
          list: [
            '「目標」是你想讓貨艙裡有多少份。目標總和不超過容量。',
            '「由搬運工」：車由搬運工拉，他每趟自己挑貨。這時不能設定目標。',
            '裝貨的人每次拿1份：先找車輛{{vehicle.cargoSearch}}格內的貨物，再找路標範圍內的任何地方。',
            '貨物必須和車或船在同一片陸地上。沒人會拿民居裡的食物。',
            '調低目標時，多餘的運到車輛{{vehicle.cargoSearch}}格內最近有空位的倉庫或大本營。沒有就卸在地上。',
          ],
        },
        {
          h: '失去載具',
        },
        {
          table: {
            head: ['載具', '船上乘員', '載運的載具', '貨物'],
            rows: [
              ['車輛、[[good:catapult|投石機]]', '在旁邊下車', '-', '散落在{{vehicle.spill}}格內'],
              ['船已靠岸', '登岸', '停在岸邊', '消失'],
              ['船在海上', '溺亡', '連同乘員沉沒', '消失'],
            ],
            foot: '載具未毀時，誰也打不到裡面的乘員。',
          },
        },
      ],
      see: ['article:hauling', 'article:trade', 'article:catapult', 'article:livestock', 'good:handcart'],
    },
    {
      id: 'diplomacy',
      name: '外交',
      lead: '態度是單向的：你對他們和他們對你是兩項獨立設定。',
      blocks: [
        {
          h: '態度的作用',
        },
        {
          table: {
            head: ['行為', '敵對', '中立', '友好'],
            rows: [
              ['攻擊對方人員和建築', '是', '否', '否'],
              ['[[job:scout|偵察兵]]收服對方的牛和綿羊', '是', '否', '否'],
              ['[[job:trader|商人]]在對方有提議的建築交易', '否', '否', '是，需雙方'],
              ['共享地圖視野', '否', '否', '是，需雙方'],
              ['「最後的倖存者」共同勝利', '否', '否', '是，需雙方'],
            ],
            foot: '共享視野還需要在對戰設定中開啟「盟友共用地圖」。',
          },
        },
        {
          h: '什麼會改變態度',
        },
        {
          table: {
            head: ['事件', '結果'],
            rows: [
              ['地圖開始', '態度由地圖設定，未設定的雙方為中立'],
              ['有人攻擊你', '你對他的態度自動變為敵對'],
              ['你對中立的電腦設為敵對', '電腦也轉為敵對'],
              ['島嶼地圖上中立的電腦', '自動對玩家轉為敵對'],
              ['你調低對友好電腦的態度', '電腦也調低到你的程度'],
              ['敵對的電腦', '不會主動講和'],
              ['任務', '可以改變態度，包括在支付貢品之後'],
              ['「態度由劇本設定」', '無法在外交視窗更改'],
            ],
          },
        },
        {
          h: '和平時間',
        },
        {
          list: [
            '「和平時間」在遊戲開始前設定。受保護的玩家之間不能交戰。',
            '不能派人進入，也不能在該玩家建築{{peace.keepOut}}格內建造，除非該處離你的建築更近。',
            '結束前{{peace.noticeFirstMinutes}}分鐘和{{peace.noticeLastMinutes}}分鐘發出提醒。',
          ],
        },
        {
          h: '初次接觸',
        },
        {
          p: '迷霧之下，你看見某民族的人員、建築、載具或木柵欄，或被其攻擊後，它就出現在外交視窗裡，並且一直留著。',
        },
        {
          h: '貢品',
        },
        {
          p: '貢品只能由任務要求。外交視窗的「支付」立即扣除貨物，無需搬運，「最低庫存」也擋不住。',
        },
        {
          p: '貨物從[[building:headquarters|大本營]]、倉庫和工坊扣除，工坊只扣自產產品。民居、箭塔、[[building:barracks|兵營]]、[[building:school|學校]]和地面貨堆不參與支付。',
        },
      ],
      see: ['article:trade', 'article:fog', 'article:walls'],
    },
    {
      id: 'fog',
      name: '迷霧與視野',
      lead: '偵察兵和大本營看得最遠，{{vision.scout}}格。工地什麼也看不見。',
      blocks: [
        {
          h: '地圖模式',
        },
        {
          table: {
            head: ['設定', '開局', '視野外的地面'],
            rows: [
              ['全開', '全部可見', '無迷霧'],
              ['經典', '全黑地圖', '探明後保持可見'],
              ['經典 + 戰爭迷霧', '全黑地圖', '灰色地面，不顯示人和動物'],
              ['偵察', '灰色地面，不顯示人和動物', '探明後保持可見'],
              ['偵察 + 戰爭迷霧', '灰色地面，不顯示人和動物', '灰色地面，不顯示人和動物'],
            ],
          },
        },
        {
          p: '灰色地面上的建築、貨物、資源和載具保持你最後一次看見時的樣子，人和動物不顯示。',
        },
        {
          h: '視野範圍',
        },
        {
          figure: {
            id: 'vision',
            caption: '視野範圍',
          },
        },
        {
          table: {
            head: ['對象', '範圍（格）'],
            rows: [
              ['[[job:scout|偵察兵]]、[[building:headquarters|大本營]]', '{{vision.scout}}'],
              ['英雄、[[good:ship_small|船]]、[[good:ship_big|大船]]', '{{vision.hero}}'],
              ['士兵、所有建築', '{{vision.soldier}}'],
              ['[[good:handcart|手推車]]、[[good:oxcart|牛車]]、[[good:catapult|投石機]]', '{{vision.cart}}'],
              ['其餘成人、你的動物', '{{vision.adult}}'],
              ['兒童', '{{vision.child}}'],
              ['工地', '0'],
            ],
            num: [1],
            foot: '木柵欄、道路和路標不揭開迷霧。士兵和[[job:hunter|獵人]]在迷霧中也能找到目標，[[good:catapult|投石機]]卻只會自動打看得見的目標。',
          },
        },
      ],
      see: ['article:scout', 'article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'scout',
      name: '偵察兵',
      lead: '偵察兵沒有工作地點，沒有命令就什麼也不做。',
      blocks: [
        {
          p: '他不花材料豎立[[article:roads|路標]]，從野生牛和綿羊身旁走過就能收服它們：[[article:livestock|畜牧]]。他不受路標限制，可走遍全圖。',
        },
        {
          h: '「探索」',
        },
        {
          list: [
            '從你指定的位置向外越探越遠。',
            '他不會離開所在的陸地。要到別處得靠[[article:vehicles|船]]。',
            '跳過沿海岸和地圖邊緣的窄條，零碎小塊可能保持未探明。',
          ],
        },
        {
          h: '何時結束',
        },
        {
          table: {
            head: ['事件', '結果'],
            rows: [
              ['已沒有可探索的地方', '通知「土地已探索」，偵察兵等待'],
              ['連續超過{{explore.maxFailedLegs}}次沒能走到', '其餘視為不可達，「土地已探索」'],
              ['新命令或更換職業', '探索結束'],
              ['按住Shift下令', '探索結束後執行'],
            ],
          },
        },
      ],
      see: ['article:roads', 'article:livestock', 'article:fog', 'job:scout'],
    },
    {
      id: 'wildlife',
      name: '野生動物與狩獵',
      lead: '攻擊性獸群會撲向其吃草處{{wild.aggro}}格內的人。最多追{{wild.giveUp}}格，然後返回。',
      blocks: [
        {
          p: '動物的生命值、獸群大小以及能否馴服，見百科中該動物的卡片。',
        },
        {
          h: '攻擊性',
        },
        {
          table: {
            head: ['類型', '動物', '行為'],
            rows: [
              ['攻擊性', '狼、獅子、母獅、北極熊', '主動攻擊'],
              [
                '受擊後攻擊',
                '熊、大象',
                '最後一次受擊後{{wild.angrySeconds}}秒內有危險。已開始的攻擊持續到目標死亡或躲起來',
              ],
              ['膽小', '其餘動物', '頭領受擊後逃開{{wild.flight}}格，獸群跟隨'],
            ],
            foot: '野山羊既不攻擊也不逃跑。',
          },
        },
        {
          list: ['你攻擊一隻動物時，{{wild.kinAlarm}}格內的同種動物也會反應。', '動物不攻擊建築和載具。'],
        },
        {
          h: '獸群增長',
        },
        {
          p: '大約每{{wild.breedingShare}}群只有1群會增長。這樣的獸群只要至少有2隻，且少於動物卡片上「獸群」的數量，每{{wild.growthMinutes}}分鐘增加1隻成年動物。',
        },
        {
          h: '獵人的獵物',
        },
        {
          list: [
            '獵場是工作旗幟或工作地點周圍{{flag.hunter}}格。追擊時獵人最多超出獵場{{wild.huntChase}}格。',
            '他先獵最弱的動物，再遠也一樣。',
            '獵人每箭扣動物{{wild.hunterShot}}生命值，射程{{hunterBow.min}}-{{hunterBow.max}}格。',
            '他不會主動獵成年野山羊，但會獵牠的幼崽。',
            '他不獵有主人的動物，也不獵其他陸地上的動物。',
            '動物卡片上「獵人：自動」是他自己會去獵的，「需下令」是只有你下令才會打的。',
          ],
        },
        {
          h: '獵物產出',
        },
        {
          p: '成年動物留下什麼，見其卡片。獵人獵到的幼崽產出減半，幼馬只有1份[[good:leather|皮革]]。被其他人殺死的幼崽什麼都不留。',
        },
      ],
      see: ['article:damage', 'article:gathering', 'article:livestock', 'job:hunter'],
    },
    {
      id: 'livestock',
      name: '畜牧',
      lead: '某種牲畜正好有{{livestock.pair}}頭成年時，畜牧師才繁殖。多出第三頭時，他先把牠宰了。',
      blocks: [
        {
          figure: {
            id: 'livestock-cycle',
            caption: '畜牧循環',
          },
        },
        {
          h: '牲畜來源',
        },
        {
          table: {
            head: ['對象', '做法', '範圍（格）'],
            rows: [
              [
                '[[job:scout|偵察兵]]',
                '經過時收服野生牛和綿羊，以及敵人的牲畜。稍遠一些的會四散跑開',
                '收服{{livestock.captureRange}}，四散{{livestock.scatterRange}}',
              ],
              [
                '[[job:breeder|畜牧師]]',
                '把離得最近、不在畜牧場裡的你的牲畜帶進畜牧場。湊不夠一對時，也會從你另一座畜牧場牽走多餘的一頭',
                '同一片陸地',
              ],
            ],
            foot: '站著不動的偵察兵收服不了動物。',
          },
        },
        {
          h: '屠宰',
        },
        {
          table: {
            head: ['牲畜', '屠宰產出'],
            rows: [
              [
                '[[good:sheep|綿羊]]',
                '[[good:wool|羊毛]]{{livestock.sheepWool}}份，[[good:meat|肉]]{{livestock.sheepMeat}}份',
              ],
              [
                '[[good:cattle|牛]]',
                '[[good:leather|皮革]]{{livestock.cattleLeather}}份，[[good:meat|肉]]{{livestock.cattleMeat}}份',
              ],
            ],
            foot: '畜牧師的生產選擇決定養哪種牲畜。幼崽的成本和時長，以及畜牧場能存多少貨物，見[[building:work_animal_farm|畜牧場]]的卡片。',
          },
        },
        {
          list: [
            '[[building:work_animal_farm|畜牧場]]總共容納{{livestock.farmHerd}}頭，含兩種牲畜和待出生的幼崽。',
            '幼崽{{livestock.growMinutes}}分鐘長大，之前不計入一對。',
          ],
        },
        {
          h: '畜牧場狀態',
        },
        {
          table: {
            head: ['提示', '含義'],
            rows: [
              ['「沒有動物」', '一頭都沒有，需要偵察兵'],
              ['「只有一隻動物」', '需要第二頭'],
              ['「幼崽成長中」', '一對長大後恢復繁殖'],
              ['「獸群已滿」', '畜牧師等待幼崽長大'],
            ],
          },
        },
      ],
      see: ['article:vehicles', 'article:wildlife', 'article:food', 'building:work_animal_farm'],
    },
    {
      id: 'religion',
      name: '信仰與神廟',
      lead: '信仰只在製造武器和護甲時下降。降到0%時，工匠不製造武器和護甲。',
      blocks: [
        {
          h: '每件消耗多少信仰',
        },
        {
          table: {
            head: ['職業', '每件消耗{{piety.lowPct}}%信仰', '每件消耗{{piety.highPct}}%信仰'],
            rows: [
              [
                '[[job:armorer|武器匠]]',
                '[[good:bow_short|短弓]]、[[good:spear_wooden|木矛]]',
                '[[good:bow_long|長弓]]',
              ],
              [
                '[[job:smith|鐵匠]]',
                '[[good:spear_iron|鐵矛]]、[[good:sword_shord|短劍]]',
                '[[good:sword_long|長劍]]、[[good:armor_chain|鎖甲]]、[[good:armor_plate|板甲]]',
              ],
              ['[[job:sewer|裁縫]]', '[[good:armor_wool|布甲]]、[[good:armor_leather|皮甲]]', '-'],
            ],
            foot: '所有民族相同。這些職業的其他產品不消耗信仰。',
          },
        },
        {
          list: [
            '低於{{need.drivePct}}%時，武器匠、鐵匠和裁縫會自己去禱告。無處可去時，到{{need.criticalPct}}%顯示「想要禱告」。',
            '已經開始的那件在0%時也會做完。',
          ],
        },
        {
          h: '在哪裡禱告',
        },
        {
          table: {
            head: ['地點', '條件'],
            rows: [
              ['民居', '燃著聖火時。這時居民先在家裡禱告'],
              ['[[building:work_temple|神廟]]、[[building:headquarters|大本營]]', '已完工且屬於你'],
            ],
            foot: '禱告{{pray.seconds}}秒，信仰+{{pray.pct}}%。',
          },
        },
        {
          h: '聖火',
        },
        {
          p: '三級及以上民居可以點燃。1份[[good:holy_oil|油]]能燒{{oil.burnTime}}，滿油能燒{{oil.fullBurnTime}}。沒人禱告時火也一直燒著。',
        },
        {
          h: '神廟光環',
        },
        {
          table: {
            head: ['項目', '數值'],
            rows: [
              ['範圍', '{{aura.range}}格'],
              ['生命值', '每秒+{{aura.perSecond}}，上限{{aura.ceiling}}'],
              ['信仰', '需求條不超過{{need.satedPct}}%時每秒+{{aura.pietyPct}}%'],
              ['對象', '你的所有人，兒童只加生命值'],
              ['條件', '神廟已完工且無損傷'],
              ['多座神廟', '光環不疊加'],
            ],
            foot: '超過{{health.human}}的生命值一直保留，直到被傷害扣除。',
          },
        },
      ],
      see: ['article:needs', 'article:health', 'building:work_temple', 'good:holy_oil'],
    },
    {
      id: 'chests',
      name: '箱子與文書',
      lead: '箱子裡的文書能直接放下建築，無需建造、材料和發現條件。',
      blocks: [
        {
          p: '箱子任何成人都能開，魔法箱子只有[[job:druid|德魯伊]]和英雄能開。命令是「打開箱子」。居民要能走到箱子跟前。',
        },
        {
          h: '內容',
        },
        {
          table: {
            head: ['獎勵', '箱子', '魔法箱子'],
            rows: [
              ['藥水或護符', '{{chest.singleWooden}}', '{{chest.singleMagical}}'],
              ['大型藥水，1種', '{{chest.bulkWooden}}', '{{chest.bulkMagical}}'],
              [
                '[[good:armor_chain|鎖甲]]、[[good:armor_plate|板甲]]或[[good:shoes|鞋子]]',
                '{{chest.wearWooden}}',
                '{{chest.wearMagical}}',
              ],
              ['[[good:bread|食物]]', '{{chest.foodWooden}}', '{{chest.foodMagical}}'],
              ['[[good:catapult|投石機]]', '1', '1'],
              ['平民、婦女、長劍兵或長弓手', '{{chest.settlers}}', '{{chest.settlers}}'],
              [
                '狼或獅子。野生，會立刻攻擊',
                '{{chest.wolves}}或{{chest.lions}}',
                '{{chest.wolves}}或{{chest.lions}}',
              ],
            ],
            num: [1, 2],
            foot: '每個箱子的內容由地圖決定，不是隨機。',
          },
        },
        {
          h: '文書',
        },
        {
          table: {
            head: ['文書', '效果'],
            rows: [
              ['放置一座你選擇的建築', '建造清單中任選一座建築，立即建成'],
              ['放置「名稱」', '指定建築，立即建成'],
              ['放置「名稱」並裝滿庫存', '指定建築，庫存全滿'],
            ],
            foot: '文書用後消失，位置不合適時則保留。你的文書在建造視窗的「文書」下。',
          },
        },
        {
          h: '帶工坊的文書',
        },
        {
          table: {
            head: ['帶庫存的建築', '居民', '永久發現'],
            rows: [
              ['[[building:work_smithy_01|二級鐵匠鋪]]', '1名[[job:smith|鐵匠]]', '[[good:sword_long|長劍]]'],
              [
                '[[building:work_armory_00|一級武器坊]]',
                '1名[[job:armorer|武器匠]]',
                '[[good:bow_short|短弓]]',
              ],
              ['[[building:work_coin_mint|鑄幣廠]]', '1名[[job:coin_maker|鑄幣師]]', '[[good:coin|金幣]]'],
              ['[[building:work_druid_00|一級鍊金小屋]]', '1名[[job:druid|德魯伊]]', '[[good:holy_oil|油]]'],
              [
                '[[building:work_druid_01|二級鍊金小屋]]',
                '1名[[job:druid|德魯伊]]',
                '[[good:holy_oil|油]]、小型藥水',
              ],
            ],
            foot: '這種箱子也給一名該職業的居民，並解鎖該職業。',
          },
        },
      ],
      see: ['article:construction', 'article:trades', 'article:draughts'],
    },
  ],
};
