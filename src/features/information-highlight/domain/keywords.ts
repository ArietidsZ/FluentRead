/**
 * @file src/features/information-highlight/domain/keywords.ts
 * 文件职责：以可解释的本地词项规则生成信息高亮候选，不依赖语言模型、词典下载或网络服务。
 * 主要内容：保留 UTF-16 原文坐标，以标准词分段及有界后备分词排除常见虚词，结合词长、数字、专名与缩写形态以及段内首次出现排序；中日文词长几乎相同，另按内置常用字表估计用字的常见程度，英文另按内置常用词表区分等长的常见词与少见词，让常见词浅、少见词深，繁体字先折算为简体再查表；密度选择只决定绘制覆盖，不把规则分数解释为理解收益或事实可信度。
 * 模块边界：纯文本算法，不读取 DOM、不写配置、不导入浏览器平台；调用方负责文本规模、页面所有权和原生 Range 绘制。
 */
import type {InformationHighlightDensity} from '@/src/core/config/informationHighlight';
import type {InformationHighlightResult, InformationHighlightSpan} from '../protocol';
import {informationGraphemeBoundaries} from './textBoundaries';

const stopWords = new Set(('a an and are as at be been but by can could did do does for from had has have he her here him his how i if in into is it its me more most my no nor not of on one or our out she so some than that the their them then there these they this those to too up us was we were what when where which who will with would you your ' +
    'about after all also any because before being between both down each even just like many may much must only other over same should such through under very well while without ' +
    '的 地 得 了 着 过 是 在 和 与 及 或 而 但 为 于 对 从 到 把 被 让 给 有 无 不 也 都 就 很 更 最 一 个 这 那 这些 那些 我 我们 你 你们 他 她 它 他们 什么 怎么 因为 所以 可以 可能 ' +
    '一个 一种 一样 没有 这个 那个 这样 那样 这种 时候 已经 还是 就是 但是 而且 以及 或者 如果 通过 进行 其它 其他 自己 非常 比较 应该 需要 对于 关于 并且 然后 现在 之间 之后 之前 以后 以前 其中 由于 因此 甚至 特别 几乎 越').split(/\s+/u));
// 现代汉语常用字，大致按使用频率排列。只用来估计“这个词是否由常见字组成”，不是词典，也不表示词义的重要性。
const commonHan = '的一是不了在人有我他这个们中来上大为和国地到以说时要就出会可也你对生能而子那得于着下自之年过发后作里用道行所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部其些主样理心她本前开但因只从想实日军者意无力它与长把机十民第公此已工使情明性知全三又关点正业外将两高间由问很最重并物手应战向头文体政美相见被利什二等产或新己制身果加西斯月话合回特代内信表化老给世位次度门任常先海通教儿原东声提立及比员解水名真论处走义各入几口认条平系气题活尔更别打女变四神总何电数安少报才结反受目太量再感建务做接必场件计管期市直德资命山金指克许统区保至队形社便空决治展马科司五基眼书非则听白却界达光放强即像难且权思王象完设式色路记南品住告类求据程北边死张该交规万取拉格望觉术领共确传师观清今切院让识候带导争运笑飞风步改收根干造言联持组每济车亲极林服快办议往元英士证近失转夫令准布始怎呢存未远叫台单影具罗字爱击流备兵连调深商算质团集百需价花党华城石级整府离况亚请技际约示复病息究线似官火断精满支视消越器容照须九增研写称企八功吗包片史委乎查轻易早曾除农找装广显吧阿李标谈吃图念六引历首医局突专费号尽另周较注语仅考落青随选列武红响虽推势参希古众构房半节土投某案黑维革划敌致陈律足态护七兴派孩验责营星够章音跟志底站严巴例防族供效续施留讲型料终答紧黄绝奇察母京段依批群项故按河米围江织害斗双境客纪采举杀攻父苏密低朝友诉止细愿千值仍男钱破网热助倒育属坐帝限船脸职速刻乐否刚威毛状率甚独球般普怕弹校苦创假久错承印晚兰试股拿脑预谁益阳若哪微尼继送急血惊伤素药适波夜省初喜卫源食险待述陆习置居劳财环排福纳欢雷警获模充负云停木游龙树疑层冷洲冲射略范竟句室异激汉村哈策演简卡罪判担州静退既衣您宗积余痛检差富灵协角占配征修皮挥胜降阶审沉坚善妈刘读啊超免压银买皇养伊怀执副乱抗犯追帮宣佛岁航优怪香著田铁控税左右份穿艺背阵草脚概恶块顿敢守酒岛托央户烈洋哥索胡款靠评版宝座释景顾弟登货互付伯慢欧换闻危忙核暗姐介坏讨丽良序升监临亮露永呼味野架域沙掉括舰鱼杂误湾吉减编楚肯测败屋跑梦散温困剑渐封救贵枪缺楼县尚毫移娘朋画班智亦耳恩短掌恐遗固席松秘谢鲁遇康虑幸均销钟诗藏赶剧票损忽巨炮旧端探湖录叶春乡附吸予礼港雨呀板庭妇归睛饭额含顺输摇招婚脱补谓督毒油疗旅泽材灭逐莫笔亡鲜词圣择寻厂睡博勒烟授诺伦岸奥唐卖俄炸载洛健堂旁宫喝借君禁阴园谋宋避抓荣姑孙逃牙束跳顶玉镇雪午练迫爷篇肉嘴馆遍凡础洞卷坦牛宁纸诸训私庄祖丝翻暴森塔默握戏隐熟骨访弱蒙歌店鬼软典欲萨伙遭盘爸扩盖弄雄稳忘亿刺拥徒姆杨齐赛趣曲刀床迎冰虚玩析窗醒妻透购替塞努休虎扬途侵刑绿兄迅套贸毕唯谷轮库迹尤竞街促延震弃甲伟麻川申缓潜闪售灯针哲络抵朱埃抱鼓植纯夏忍页杰筑折郑贝尊吴秀混臣雅振染盛怒舞圆搞狂措姓残秋培迷诚宽宇猛摆梅毁伸摩盟末乃悲拍丁赵硬麦蒋操耶阻订彩抽赞魔纷沿喊违妹浪汇币丰蓝殊献桌啦瓦莱援译夺汽烧距裁偏符勇触课敬哭懂墙袭召罚侠厅拜巧侧韩冒债曼融惯享戴童犹乘挂奖绍厚纵障讯涉彻刊丈爆乌役描洗玛患妙镜唱烦签仙彼弗症仿倾牌陷鸟轰咱菜闭奋庆撤泪茶疾缘播朗杜奶季丹狗尾仪偷奔珠虫驻孔宜艾桥淡翼恨繁寒伴叹旦愈潮粮缩罢聚径恰挑袋灰捕徐珍幕映裂泰隔启尖忠累炎暂估泛荒偿横拒瑞忆孤鼻闹羊呆厉衡胞零穷舍码赫婆魂灾洪腿胆津俗辩胸晓劲贫仁偶辑邦恢赖圈摸仰润堆碰艇稍迟辆废净凶署壁御奉旋冬矿抬蛋晨伏吹鸡倍糊秦盾杯租骑乏隆诊奴摄丧污渡旗甘耐凭扎抢绪粗肩梁幻菲皆碎宙叔岩荡综爬荷悉蒂返井壮薄悄扫敏碍殖详迪矛霍允幅撒剩凯颗骂赏液番箱贴漫酸郎腰舒眉忧浮辛恋餐吓挺励辞艘键伍峰尺昨黎辈贯侦滑券崇扰宪绕趋慈乔阅汗枝拖墨胁插箭腊粉泥氏彭拔骗凤慧媒佩愤扑龄驱惜豪掩兼跃尸肃帕驶堡届欣惠册储飘桑闲惨洁踪勃宾频仇磨递邪撞拟滚奏巡颜剂绩贡疯坡瞧截燃焦殿伪柳锁逼颇昏劝呈搜勤戒驾漂饮曹朵仔柔俩孟腐幼践籍牧凉牲佳娜浓芳稿竹腹跌逻垂遵脉貌柏狱猜怜惑陶兽帐饰贷昌叙躺钢沟寄扶铺邓寿惧询汤盗肥尝匆辉奈扣廷澳嘛董迁凝慰厌脏腾幽怨鞋丢埋泉涌辖躲晋紫艰魏吾慌祝邮吐狠鉴曰械咬邻赤挤弯椅陪割揭韦悟聪雾锋梯猫祥阔誉筹丛牵鸣沈阁穆屈旨袖猎臂蛇贺柱抛鼠瑟戈牢逊迈欺吨琴衰瓶恼燕仲诱狼池疼卢仗冠粒遥吕玄尘冯抚浅敦纠钻晶岂峡苍喷耗凌敲菌赔涂粹扁亏寂煤熊恭湿循暖糖赋抑秩帽哀宿踏烂袁侯抖夹昆肝擦猪炼恒慎搬纽纹玻渔磁铜齿跨押怖漠疲叛遣兹祭醉拳弥斜档稀捷肤疫肿豆削岗晃吞宏癌肚隶履涨耀扭坛拨沃绘伐堪仆郭牺歼墓雇廉契拼惩捉覆刷劫嫌瓜歇雕闷乳串娃缴唤赢莲霸桃妥瘦搭赴岳嘉舱俊址庞耕锐缝悔邀玲惟斥宅添挖呵讼氧浩羽斤酷掠妖祸侍乙妨贪挣汪尿莉悬唇翰仓轨枚盐览傅帅庙芬屏寺胖璃愚滴疏萧姿颤丑劣柯寸扔盯辱匹俱辨饿蜂哦腔郁溃谨糟葛苗肠忌溜鸿爵鹏鹰笼丘桂滋聊挡纲肌茨壳痕碗穴膀卓贤卧膜毅锦欠哩函茫昂薛皱夸豫胃舌剥傲拾窝睁携陵哼棉晴铃填饲渴吻扮逆脆喘罩卜炉柴愉绳胎蓄眠竭喂傻慕浑奸扇柜悦拦诞饱泡贼亭夕爹酬儒姻卵氛泄杆挨僧蜜吟遂狭肖甜霞驳裕顽摘矮秒卿畜咽披辅勾盆疆赌塑畏吵囊泊肺骤缠冈羞瞪吊贾漏斑涛悠鹿俘锡卑葬铭滩嫁催翅盒蛮矣潘歧赐鲍锅廊拆灌勉盲宰佐啥胀扯辽抹筒棋裤唉朴咐孕誓喉妄拘链驰栏逝窃艳臭纤棵趁匠盈翁愁瞬婴孝颈倘浙谅蔽畅赠妮莎尉冻跪闯葡咳巷';
// 常见繁体字与对应简体字成对排列，查常用字表和虚词表前先折算。
const traditionalPairs = '這这個个們们來来說说國国時时會会對对發发學学經经當当沒没還还進进種种將将與与現现實实點点體体問问題题開开關关長长樣样機机動动東东應应書书頭头見见產产業业兩两間间數数變变總总電电報报結结設设認认條条氣气爾尔別别萬万資资張张該该規规領领確确傳传師师觀观軍军無无義义員员論论處处過过後后裡里為为麼么於于從从讓让給给聽听話话歲岁幾几邊边遠远親亲愛爱歡欢買买賣卖車车門门馬马魚鱼鳥鸟風风飛飞雲云華华語语讀读寫写畫画歷历館馆醫医藥药錢钱銀银鐵铁紅红綠绿藍蓝黃黄顏颜雙双單单簡简複复雜杂難难類类態态權权濟济務务勢势戰战爭争黨党導导團团際际聯联內内區区級级組组織织證证據据議议選选舉举農农廠厂礦矿質质術术環环節节廣广場场網网絡络線线號号碼码檔档錄录製制創创構构計计劃划項项標标準准則则屬属層层達达運运輸输轉转斷断續续維维護护衛卫備备補补減减積积極极驗验測测試试檢检覺觉視视顯显響响聲声樂乐詞词詩诗劇剧戲戏遊游藝艺這这麽么著着裏里衹只祇只僅仅雖虽儘尽讚赞齊齐歐欧亞亚羅罗蘭兰爾尔倫伦斯斯紐纽約约舊旧歸归憶忆懷怀戀恋驚惊嚇吓懼惧憂忧慮虑煩烦惱恼興兴奮奋緊紧張张輕轻鬆松靜静鬧闹亂乱淨净髒脏滿满虛虚實实貴贵賤贱窮穷豐丰優优劣劣強强壯壮瘦瘦寬宽闊阔窄窄遲迟緩缓導导帶带擁拥擠挤擴扩減减縮缩漲涨跌跌賺赚賠赔損损獲获獎奖懲惩責责擔担負负貢贡獻献犧牺牲牲奪夺搶抢擊击殺杀傷伤敗败勝胜贏赢輸输競竞賽赛隊队員员隨随離离歸归還还遷迁訪访診诊療疗護护養养嬰婴兒儿孫孙爺爷媽妈婦妇夥伙賓宾鄰邻鄉乡鎮镇縣县國国灣湾島岛嶼屿橋桥樓楼廳厅櫃柜燈灯爐炉鍋锅盤盘飯饭麵面湯汤雞鸡鴨鸭豬猪貓猫龍龙鳳凤龜龟蟲虫樹树葉叶蘋苹園园莊庄糧粮穀谷紙纸筆笔書书圖图標标誌志雜杂誌志報报導导評评論论講讲談谈議议譯译釋释詢询問问答答覆复勸劝請请謝谢歡欢賀贺禮礼儀仪節节慶庆紀纪錄录憲宪審审訴诉辯辩護护罰罚獄狱監监禁禁毀毁壞坏敵敌槍枪彈弹砲炮艦舰隻只飛飞機机場场鐵铁軌轨輛辆駕驾駛驶運运載载貨货幣币價价值值貿贸稅税財财經经營营銷销購购貸贷債债償偿儲储險险額额億亿萬万噸吨釐厘畝亩歲岁齡龄週周鐘钟時时曆历歷历紀纪初初終终遲迟暫暂漸渐頻频徹彻絕绝極极稍稍頗颇僅仅竟竟顯显確确實实際际現现狀状況况勢势態态趨趋變变遷迁轉转換换調调適适應应順顺違违衝冲撞撞擊击鬥斗爭争競竞贊赞倡倡導导領领袖袖統统帥帅將将帝帝皇皇聖圣賢贤靈灵魂魂夢梦幻幻覺觉觸触聞闻視视聽听嘗尝飲饮飢饥餓饿飽饱醉醉醒醒睡睡臥卧躺躺蹲蹲躍跃';
const hanRank = new Map<string, number>(), simplified = new Map<string, string>();
[...commonHan].forEach((character, index) => hanRank.set(character, index));
for (let index = 0; index < traditionalPairs.length; index += 2) simplified.set(traditionalPairs[index], traditionalPairs[index + 1]);
const fold = (key: string) => [...key].map(character => simplified.get(character) ?? character).join('');
/** 用字越少见数值越高（0–1.1）：常用字按字表位次开方，平假名多为虚词和词尾，片假名多为外来语，字表以外的汉字最少见。 */
function characterRarity(key: string): number {
    let sum = 0, count = 0;
    for (const character of key) {
        const rank = hanRank.get(character);
        sum += rank !== undefined ? Math.sqrt(rank / hanRank.size) : /\p{Script=Hiragana}/u.test(character) ? 0.1 : /\p{Script=Han}/u.test(character) ? 1.1 : 0.8;
        count++;
    }
    return sum / count;
}
// 英语常用词，大致按使用频率排列，不含上面的虚词。只用来区分长度相近的常见词与少见词，不是词典。
const commonEnglish = 'said new time people year way day man thing get make go know take see come think look want give use find tell ask work seem feel try leave call good first last long great little own old right big high different small large next early young important few public bad able back still now never always often again really already however world life hand part child eye woman place case week company system program question government number night point home water room mother area money story fact month lot study book job word business issue side kind head house service friend father power hour game line end member law car city community name president team minute idea kid body information parent face others level office door health person art war history party result change morning reason research girl guy moment air teacher force education need become mean keep let begin help talk turn start show hear play run move like live believe hold bring happen write provide sit stand lose pay meet include continue set learn lead understand watch follow stop create speak read allow add spend grow open walk win offer remember love consider appear buy wait serve die send expect build stay fall cut reach kill remain suggest raise pass sell require report decide pull best better sure free real full special easy clear recent certain personal red hard ready simple left late general whole white black short possible second third major local social national political economic human true strong low main common poor natural significant similar hot dead central happy serious final nice today together once away around later ago almost enough far yet probably ever least quite soon maybe perhaps actually usually finally simply rather food foot age policy music market sense nation plan college interest death experience effect class control field development role effort rate heart drug leader light voice wife police mind price decision son hope view relationship town road arm difference value building action season society tax director position player record paper space ground form event official matter center couple site project activity star table court produce land material computer type figure street image phone data picture practice piece product doctor wall patient worker news test movie north step film tree source truth kitchen daughter term cost rule south floor campaign answer brother industry media size window choice skill blood attention language example note list page letter account fire future bank west sport board subject officer rest behavior performance top goal bed order author discussion century summer hospital church risk evening unit staff opportunity pressure dog technology range amount design model million thousand hundred two three four five six seven eight nine ten half per each every another both either since until while though although during against among within across along toward upon above below behind near off whether why else thus therefore instead indeed also even just only very much many most more some any such same other going being having doing done made got went came took seen known given used found told asked called tried looked thought wanted support check base fill deal return save join agree pick wear cover catch draw choose cause sign develop carry break receive visit explain share prepare push close drive hit eat sleep enjoy travel finish drop mention notice describe improve avoid manage wish thank worry lie throw touch teach increase apply contain available likely current single particular private past present various entire legal medical popular traditional financial physical environmental cultural sometimes especially quickly clearly recently nearly directly exactly certainly generally mostly easily completely particularly internet web website online user email software app code file search click link video photo post message content version update feature tool option'.split(' ');
const englishRank = new Map(commonEnglish.map((word, index) => [word, index]));
/** 英文词越少见数值越高（0–1）：先查原形，再去掉常见词尾查一次；词表以外的词最少见。 */
function englishRarity(key: string): number {
    const rank = englishRank.get(key) ?? englishRank.get(key.replace(/(?:ies|ied)$/u, 'y')) ?? englishRank.get(key.replace(/(?:ing|ed|es|ly|s|d)$/u, ''))
        ?? englishRank.get(key.replace(/(?:ing|ed)$/u, 'e'));
    return rank === undefined ? 1 : Math.sqrt(rank / englishRank.size) * 0.8;
}
export interface InformationWordSpan {start: number; end: number; key: string}

/** 返回原文的标准词项坐标，供规则评分、热力绘制和设置预览共同分词。 */
export function informationWordSpans(text: string): InformationWordSpan[] {
    const candidates: InformationWordSpan[] = [];
    const Segmenter = Intl.Segmenter;
    if (Segmenter) {
        const segmenter = new Segmenter(undefined, {granularity: 'word'});
        for (const part of segmenter.segment(text)) {
            if (part.isWordLike) candidates.push({start: part.index, end: part.index + part.segment.length, key: part.segment.toLocaleLowerCase()});
        }
    } else {
        // 后备只按原文匹配；连续汉字拆成双字单位，避免把整句误作一个词或更改原文。
        for (const match of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’_-][\p{L}\p{N}\p{M}]+)*/gu)) {
            const start = match.index!;
            if (/^[\p{Script=Han}]+$/u.test(match[0])) {
                let offset = 0;
                const characters = [...match[0]];
                for (let i = 0; i < characters.length; i += 2) {
                    const key = characters.slice(i, i + 2).join('');
                    candidates.push({start: start + offset, end: start + offset + key.length, key}); offset += key.length;
                }
            } else candidates.push({start, end: start + match[0].length, key: match[0].toLocaleLowerCase()});
        }
    }
    return candidates;
}

/**
 * 轻量规则评分是候选排序，不是概率、模型意外度或语义重要性的标定值。
 * 词越长、越少见的形态（数字、专名、缩写）分数越高；同一词在段内再次出现时更容易预料，分数降低。
 * 中日文按用字的常见程度加分，单个少见汉字也可成为候选；英文按常用词表加分。
 */
export function scoreInformationKeywords(text: string): InformationHighlightResult {
    const ideographic = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
    const candidates = informationWordSpans(text).map(word => ({...word, key: ideographic.test(word.key) ? fold(word.key) : word.key}))
        .filter(word => !stopWords.has(word.key) && ([...word.key].length >= 2 || (/^\p{Script=Han}$/u.test(word.key) && characterRarity(word.key) >= 0.6)));
    const counts = new Map<string, number>(), seen = new Set<string>();
    for (const word of candidates) counts.set(word.key, (counts.get(word.key) ?? 0) + 1);
    return {engine: 'local-keyword-rules-v4', spans: candidates.map(word => {
        const original = text.slice(word.start, word.end), length = [...word.key].length, repeated = seen.has(word.key);
        seen.add(word.key);
        // 表意文字的单字信息量高于字母：韩文按约 2.5 个字母折算；中日文的词长差别很小且长词多为常用短语，
        // 只按 1.5 个字母折算，主要由下面的用字常见程度拉开层次。
        const weight = ideographic.test(word.key) ? length * 1.5 : /^\p{Script=Hangul}/u.test(word.key) ? length * 2.5 : length;
        let score = Math.log2(2 + Math.min(weight, 12)) + (repeated ? -0.6 : Math.log2(counts.get(word.key)!) * 0.35);
        if (ideographic.test(word.key)) score += characterRarity(word.key) * 2.4;
        else if (/^[a-z]+$/u.test(word.key)) score += englishRarity(word.key) * 1.2;
        if (/\p{N}/u.test(word.key)) score += 1.4;
        if (/^\p{Lu}[\p{Lu}\p{N}]+$/u.test(original)) score += 0.7;
        // 句中首字母大写多为专名；句首大写不提供信息。
        else if (/^\p{Lu}/u.test(original) && /[^\s.!?。！？:：\n]\s+$/u.test(text.slice(Math.max(0, word.start - 3), word.start))) score += 0.5;
        return {start: word.start, end: word.end, score};
    })};
}

/** 过滤不可信分数及坐标，把模型分词贡献聚合到原文完整词项；不改写原始评分。 */
export function alignInformationWordSpans(text: string, spans: readonly InformationHighlightSpan[]): InformationHighlightSpan[] {
    const boundaries = informationGraphemeBoundaries(text);
    const validPieces = spans.filter(span => Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end)
        && span.start >= 0 && span.end <= text.length && span.end > span.start && Number.isFinite(span.score)
        && boundaries.has(span.start) && boundaries.has(span.end));
    // 模型 subword/byte pieces 在原文词段上聚合，密度绘制不会切开英文词或标准中文词项。
    validPieces.sort((a, b) => a.start - b.start);
    let cursor = 0;
    const valid: InformationHighlightSpan[] = [];
    for (const word of informationWordSpans(text)) {
        if (!boundaries.has(word.start) || !boundaries.has(word.end)) continue;
        while (cursor < validPieces.length && validPieces[cursor].end <= word.start) cursor++;
        let score = 0, matches = 0;
        for (let i = cursor; i < validPieces.length && validPieces[i].start < word.end; i++) {
            if (validPieces[i].end > word.start) {score += validPieces[i].score; matches++;}
        }
        if (matches && Number.isFinite(score)) valid.push({start: word.start, end: word.end, score});
    }
    return valid;
}

/** 按字符预算挑选高分候选，并合并相邻重叠坐标；保留原有底色和细线的选择语义。 */
export function selectInformationSpans(text: string, spans: readonly InformationHighlightSpan[], density: InformationHighlightDensity): InformationHighlightSpan[] {
    const valid = alignInformationWordSpans(text, spans);
    const budget = Math.max(1, Math.ceil(text.replace(/\s/gu, '').length * ({low: 0.12, medium: 0.22, high: 0.35}[density])));
    const selected: InformationHighlightSpan[] = [];
    let used = 0;
    for (const span of [...valid].sort((a, b) => b.score - a.score || a.start - b.start)) {
        if (selected.length >= 48 || (selected.length > 0 && used + span.end - span.start > budget)) continue;
        // 聚合后的词段已经构成互不重叠的原文分区。
        selected.push({...span}); used += span.end - span.start;
    }
    selected.sort((a, b) => a.start - b.start);
    const merged: InformationHighlightSpan[] = [];
    for (const span of selected) {
        const previous = merged.at(-1);
        if (previous && previous.end === span.start) {previous.end = span.end; previous.score = Math.max(previous.score, span.score);}
        else merged.push(span);
    }
    return merged;
}
