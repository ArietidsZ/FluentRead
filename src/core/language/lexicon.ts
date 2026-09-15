/**
 * @file src/core/language/lexicon.ts
 *
 * 文件职责：保存统计识别使用的独立语言证据数据，为短文本和相近语言提供不依赖三元组分数的旁证与反证。
 * 主要内容：按书写体系列出各语言高频封闭类功能词（冠词、介词、代词、助词、连词等），以及 Latin、Cyrillic、Arabic 文字语言的合法附加字母或排他字母；数据只描述语言通用特征，不收录任何具体网页、品牌、模型名或用户样例整句。另收录与目录语言相近、但 franc-min 缺少模型的语言（加泰罗尼亚语、加利西亚语、南非荷兰语、马其顿语、白俄罗斯语、哈萨克语）作为反证。可核对的公开符号包括 FUNCTION_WORDS、LATIN_EXTRA_LETTERS、CYRILLIC_LETTERS、ARABIC_FOREIGN_LETTERS、STATISTICAL_SCRIPT_LANGUAGES。
 * 模块边界：本文件只导出静态只读数据，不执行识别、不访问配置或浏览器；如何加权、何时视为可信由 statistical.ts 负责并通过语料测试校准。
 */

export type StatisticalScript = 'Latin' | 'Cyrillic' | 'Arabic' | 'Devanagari';

function words(value: string): ReadonlySet<string> {
    return new Set(value.trim().split(/\s+/u));
}

/**
 * 功能词按书写体系分组，只在同一文字的候选之间比较。列表刻意保持在高频词范围：
 * 它们在正文中必然大量出现，却几乎不会出现在品牌名、界面标签或技术标识符中。
 */
export const FUNCTION_WORDS: Readonly<Record<StatisticalScript, Readonly<Record<string, ReadonlySet<string>>>>> = {
    Latin: {
        en: words('the a an and or but of to in on at for with from by is are was were be been being this that these those it its you your we our they their he she his her not will would can could have has had do does did what which who how there here about into than then if as all more no so just only also very'),
        fr: words('le la les un une des du de et ou mais est sont être avoir pour par avec dans sur sous ce cette ces qui que quoi nous vous ils elles il elle je ne pas plus notre nos votre vos leur leurs au aux très aussi comme où sans entre chez cela été fait peut son sa ses mon ma mes tout tous'),
        de: words('der die das den dem des ein eine einen einem einer und oder aber ist sind war wird werden wurde wurden nicht mit auf für von zu zum zur im in an bei aus nach über unter auch sich es wir ihr sie ich du unser unsere unserer ihre dieser diese dieses noch schon sehr wie wenn dass kann können hier kein keine'),
        es: words('el la los las un una unos unas y o pero de del al en con por para sin sobre es son está están ser fue que se su sus nuestro nuestra nuestros nuestras este esta estos estas muy más también como cuando donde hay lo le les mi tu usted ustedes nosotros ya no sí puede'),
        pt: words('o a os as um uma uns umas e ou mas de do da dos das no na nos nas em com por para sem sobre é são está estão ser foi que se seu sua seus suas nosso nossa nossos nossas este esta isso isto muito mais também como quando onde há não você vocês ao aos pelo pela pode'),
        it: words('il lo la i gli le un uno una e o ma di del della dei delle a al alla in nel nella con per su sul sulla da dal è sono essere che non si suo sua nostro nostra nostri questo questa molto più anche come quando dove ci vi noi voi può tutto'),
        nl: words('de het een en of maar van in op aan met voor door bij uit naar is zijn was wordt worden niet geen ook dit dat deze die wij we jullie ze zij hij ik je u uw ons onze er hier nog al wel om te als kan'),
        pl: words('i w na z do się nie jest są to że jak ale lub oraz dla od po przez przy o co czy ten ta te tego nasz nasza naszej naszym wasz jego jej ich my wy oni być był była może tylko już bardzo także też aby'),
        cs: words('a i v ve na s se z do je jsou byl být to že jak ale nebo pro od po při o co ten ta tento tato naše našich náš váš jeho její jejich my vy oni není také jen už velmi jako když kde abychom'),
        sk: words('a i v vo na s so sa z do je sú bol byť to že ako ale alebo pre od po pri o čo ten táto naša našej náš váš jeho jej ich my vy oni nie tiež len už veľmi keď kde aby sme ste'),
        ro: words('și în de la cu pe din pentru este sunt a al ale un o unei unui care că nu se mai ce acest această nostru noastră vă ne sau dar prin după foarte fost fi'),
        hu: words('a az és egy is nem van vagy hogy de meg ez azt ezt mint már csak még sem el ki be fel le ön önök minden nagyon lesz volt lehet kell'),
        tr: words('ve bir bu için ile da de ne çok daha gibi olarak olan var yok değil mi mı ama veya her şu o ben sen biz siz onlar kadar sonra önce en'),
        vi: words('và của là có không được cho với các những một này đó trong trên khi đã sẽ đang người bạn chúng tôi ta để từ về như thì mà rất cũng'),
        id: words('dan yang di ke dari untuk dengan ini itu adalah tidak akan pada dalam juga kami kita anda mereka saya atau tetapi bisa sudah belum ada oleh sebagai karena lebih sangat bahwa telah'),
        ms: words('dan yang di ke dari untuk dengan ini itu ialah adalah tidak akan pada dalam juga kami kita anda mereka saya atau tetapi boleh sudah belum ada oleh sebagai kerana lebih sangat bahawa telah sila'),
        fil: words('ang ng mga sa at ay na para ko mo ka siya kami kayo ito iyon hindi may nang kung pero ni si aming inyong ating iyong'),
        sw: words('na ya wa za la kwa ni katika hii huu hiyo kama lakini au sisi wewe yeye wao kuwa pia sana hapa yetu zetu wetu yako ili'),
        sv: words('och i att det som en ett på är för med av till den har inte om vi du han hon de jag var kan men eller från vår vårt våra er ert era också mycket'),
        da: words('og i at det som en et på er for med af til den har ikke om vi du han hun de jeg var kan men eller fra vores jeres også meget hvad hvor blevet'),
        nb: words('og i å det som en et på er for med av til den har ikke om vi du han hun de jeg var kan men eller fra vår vårt våre deres også veldig hva hvor blitt'),
        fi: words('ja on ei se että tämä mutta tai kun jos niin myös vain olla ovat oli me te he minä sinä hän meidän teidän kanssa mukaan jälkeen ennen hyvin joka mikä'),
        et: words('ja on ei see et aga või kui siis ka ainult olla oli me te nad mina sina tema meie teie oma kõik väga mis kes selle nagu'),
        lv: words('un ir ar uz no par kas ka bet vai arī ļoti mēs jūs viņi es tu viņš viņa mūsu jūsu šis šī tas tā nav būt bija kā kur lai tiek'),
        lt: words('ir į su iš ant apie kad bet ar taip pat labai mes jūs jie aš tu jis ji mūsų jūsų šis ši tas ta nėra būti buvo kaip kur yra po'),
        sl: words('in je v na z s za da se so ne pa ki kot ali tudi samo zelo mi vi oni jaz ti on ona naš naša našo vaš to ta biti bil kje smo'),
        hr: words('i u na je se da za s sa od do su ne a ali ili kao što koji ovo to mi vi oni ja ti on ona naš naša našu vaš biti bio vrlo gdje kako također smo'),
        bs: words('i u na je se da za s sa od do su ne a ali ili kao što koji ovo to mi vi oni ja ti on ona naš naša našu vaš biti bio veoma gdje kako također smo'),
        'sr-Latn': words('i u na je se da za sa od do su ne a ali ili kao što koji ovo to mi vi oni ja ti on ona naš naša našu vaš biti bio veoma gde kako takođe smo'),
        // 以下语言不在翻译目录中，但与目录语言高度相近且 franc-min 没有统计模型；它们只作为反证，防止加泰罗尼亚语、加利西亚语或南非荷兰语被当成西班牙语、葡萄牙语或荷兰语跳过。
        ca: words('el la els les un una uns unes i o però de del dels a al als en amb per sense sobre és són era ser que es se seu seva seus seves nostre nostra aquest aquesta aquests aquestes molt més també com quan on hi ha no ja vaig va van em et ens us li'),
        gl: words('o a os as un unha uns unhas e ou pero de do da dos das no na nos nas en con por para sen sobre é son está están ser foi que se seu súa seus súas noso nosa este esta isto moi máis tamén como cando onde hai non xa ca'),
        af: words('die en of maar van in op aan met vir deur by uit na is was word het nie ook dit dat hierdie ek jy hy sy ons julle hulle my jou sal kan baie as wat waar hoe'),
    },
    Cyrillic: {
        ru: words('и в во не на я что он с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда наш наша наше наши это этот эта мы они для есть будет очень также или чтобы'),
        uk: words('і й в у не на я що він з із як а то все вона так його але ти до ж ви за б по тільки її мені було ось від мене ще немає про йому тепер коли наш наша наше наші це цей ця ми вони для є буде дуже також або щоб'),
        bg: words('и в във не на аз че той с със като а то всички тя така го но да ти към вие за би по само ми беше ето от още няма му сега когато наш нашия нашата нашите това този тази ние те е са ще много също или'),
        sr: words('и у на је се да за са од до су не а али или као што који ово то ми ви они ја ти он она наш наша ваш бити био веома где како такође смо'),
        be: words('і ў у не на я што ён з як а то усё яна так яго але ты да вы за па толькі мне было ад яшчэ няма пра калі наш наша гэта гэты мы яны для ёсць будзе вельмі таксама або'),
        kk: words('және мен бұл да де бір үшін емес бар жоқ біз сіз олар сен ол біздің сіздің осы сол өте қазір қалай қайда'),
        mk: words('и во на не се да за со од до се а но или како што кој ова тоа ние вие тие јас ти тој таа наш наша ваш биде беше многу каде исто'),
    },
    Arabic: {
        ar: words('في من على إلى عن مع هذا هذه ذلك التي الذي الذين هو هي نحن أنت أنتم هم كان كانت يكون لا لم لن ما ماذا كل بعد قبل أو ثم حتى إذا قد أن إن لقد تم'),
        fa: words('و در به از که این آن با برای را است هستند بود شد می ما شما آنها من تو او یک هم نیز تا اگر یا اما خود بسیار خیلی هر چه'),
        ur: words('اور میں کے کی کا کو سے پر یہ وہ ہے ہیں تھا تھی نہیں ہم آپ ایک بھی کہ جو اگر یا لیکن بہت ہماری ہمارا گئی گیا'),
    },
    Devanagari: {
        hi: words('और का की के में है हैं को से पर यह वह एक नहीं हम आप मैं तुम था थी थे भी तो कि जो लिए साथ हमारी हमारा आपका आपके बहुत गए गई'),
        mr: words('आणि च्या ची चा चे मध्ये आहे आहेत ला ने हे ते एक नाही आम्ही तुम्ही मी होता होती पण की जो साठी सह आमच्या आपले खूप वर तुमचे'),
        ne: words('र को का की मा छ छन् लाई बाट यो त्यो एक छैन हामी तपाईं म थियो पनि कि जो लागि साथ हाम्रो तपाईंको धेरै हो गरिए'),
    },
};

/** 各统计文字中有功能词证据、可以被识别的语言；目录外语言即使被识别也不会匹配任何目标语言。 */
export const STATISTICAL_SCRIPT_LANGUAGES: Readonly<Record<StatisticalScript, readonly string[]>> = {
    Latin: Object.keys(FUNCTION_WORDS.Latin),
    Cyrillic: Object.keys(FUNCTION_WORDS.Cyrillic),
    Arabic: Object.keys(FUNCTION_WORDS.Arabic),
    Devanagari: Object.keys(FUNCTION_WORDS.Devanagari),
};

/** Latin 文字语言在 ASCII 字母之外正常使用的字母，每个功能词语言都必须有条目；出现清单外字母是该语言结论的反证。 */
export const LATIN_EXTRA_LETTERS: Readonly<Record<string, string>> = {
    en: '', fr: 'àâæçéèêëîïôœùûüÿ', de: 'äöüß', es: 'áéíóúüñ', pt: 'áàâãçéêíóôõú', it: 'àèéìíîòóùú',
    nl: 'áäéëïóöüè', pl: 'ąćęłńóśźż', cs: 'áčďéěíňóřšťúůýž', sk: 'áäčďéíĺľňóôŕšťúýž', ro: 'ăâîșțşţ',
    hu: 'áéíóöőúüű', tr: 'çğıöşüâîû', vi: 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ',
    id: 'é', ms: '', fil: 'ñ', sw: '', sv: 'åäöé', da: 'æøåé', nb: 'æøåéóòô', fi: 'äöåšž', et: 'äöüõšž',
    lv: 'āčēģīķļņšūž', lt: 'ąčęėįšųūž', sl: 'čšžćđ', hr: 'čćđšž', bs: 'čćđšž', 'sr-Latn': 'čćđšž',
    ca: 'àçèéíïòóúü·', gl: 'áéíñóúü', af: 'áéèêëíîïóôöúûü',
};

/** Cyrillic 文字语言的完整小写字母表；清单外字母（如乌克兰文 ї 出现在俄文候选中）构成反证。 */
export const CYRILLIC_LETTERS: Readonly<Record<string, string>> = {
    ru: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
    uk: 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя',
    bg: 'абвгдежзийклмнопрстуфхцчшщъьюяѝ',
    sr: 'абвгдђежзијклљмнњопрстћуфхцчџш',
    be: 'абвгдеёжзійклмнопрстуўфхцчшыьэюя',
    kk: 'аәбвгғдеёжзийкқлмнңоөпрстуұүфхһцчшщъыіьэюя',
    mk: 'абвгдѓежзѕијклљмнњопрстќуфхцчџш',
};

/** Arabic 文字语言中属于其他语言正字法的字母；阿拉伯文键盘输入的 ي/ك 在波斯文和乌尔都文中常见，不作反证。 */
export const ARABIC_FOREIGN_LETTERS: Readonly<Record<string, string>> = {
    ar: 'پچژگیکٹڈڑںےہھ',
    fa: 'ٹڈڑںےہھة',
    ur: 'ة',
};
