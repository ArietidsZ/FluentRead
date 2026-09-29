/**
 * @file src/core/language/partOfSpeech.ts
 * 文件职责：为词典释义和句法学习提供共用的词性名称与说明，避免把主语、宾语等句中成分当成词性。
 * 主要内容：识别常见词典缩写、通用英文标签与中文标签，返回稳定类别、易读名称和基础含义；未知标签保持原文。
 * 模块边界：只规范化供应方已经给出的词性，不猜测单词在句中的用法，不请求词典或模型。
 */
const PARTS = [
    ['noun', '名词', 'n.', '表示人、事物或概念', ['n', 'noun', '名词', '名詞', 'proper noun', '专有名词']],
    ['verb', '动词', 'v.', '表示动作或状态', ['v', 'verb', 'vi', 'vt', '动词', '動詞']],
    ['adjective', '形容词', 'adj.', '描述名词的性质或状态', ['a', 's', 'adj', 'adjective satellite', 'adjective', '形容词', '形容詞']],
    ['adverb', '副词', 'adv.', '修饰动作、性质或整个句子', ['adv', 'adverb', '副词', '副詞']],
    ['article', '冠词', 'art.', '放在名词前，表示特指或泛指', ['art', 'article', '冠词', '冠詞', 'definite article', 'indefinite article']],
    ['determiner', '限定词', 'det.', '限定名词所指的范围或数量', ['det', 'determiner', '限定词', '限定詞']],
    ['pronoun', '代词', 'pron.', '代替名词或指代人和事物', ['pron', 'pronoun', 'dat', 'obj', '代词', '代詞']],
    ['preposition', '介词', 'prep.', '连接名词，表达时间、位置等关系', ['prep', 'preposition', '介词', '介詞']],
    ['conjunction', '连词', 'conj.', '连接词语、短语或分句', ['conj', 'conjunction', '连词', '連詞']],
    ['auxiliary', '助动词', 'aux.', '辅助构成时态、语态或疑问', ['aux', 'auxiliary', 'auxiliary verb', '助动词', '助動詞', 'modal', '情态动词']],
    ['interjection', '感叹词', 'int.', '表达感叹或回应', ['int', 'intj', 'interjection', '感叹词', '感嘆詞']],
    ['numeral', '数词', 'num.', '表示数量或顺序', ['num', 'numeral', '数词', '數詞']],
    ['phrase', '短语', '', '多个词构成的表达，具体作用由语境决定', ['phrase', '短语', '短語']],
] as const;

export function describePartOfSpeech(value: unknown): {id: string; label: string; abbreviation: string; description: string} {
    const label = typeof value === 'string' ? value.trim().slice(0, 80) : '';
    const key = label.toLowerCase().replace(/\.$/u, '');
    const part = PARTS.find((entry) => (entry[4] as readonly string[]).includes(key));
    return part ? {id: part[0], label: part[1], abbreviation: part[2], description: part[3]}
        : {id: 'other', label: label || '其他', abbreviation: '', description: '词性未明确，结合原文理解'};
}
