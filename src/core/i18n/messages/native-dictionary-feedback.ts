/**
 * @file src/core/i18n/messages/native-dictionary-feedback.ts
 * 文件职责：提供原生词典本地查询限制的简短多语言反馈，随当前界面语言展示。
 * 主要内容：保留本地结果与本地未命中两种反馈，提供七种界面语言的精确译文和中文回退。
 * 模块边界：只导出纯文案与匹配函数，不读取配置或浏览器；原生 UI 按需引用，兼容构建可移除整组资源。
 */
import type {UiLanguage} from '../types';

export function nativeDictionaryFeedback(kind: 'local' | 'missing'): string {
    return kind === 'local' ? '仅显示本地词典，在线查询不可用。' : '本地暂无条目，在线查询不可用。';
}
/** 仅识别本组反馈；其他文案交回已有旧文案本地化器。资源只在原生调用时创建。 */
export function localizeNativeDictionaryFeedback(value: string, language: UiLanguage): string | undefined {
    const copies: Readonly<Record<UiLanguage, readonly [string, string]>> = {
        'zh-CN': [nativeDictionaryFeedback('local'), nativeDictionaryFeedback('missing')],
        'en-US': ['Local dictionary only. Online lookup is unavailable.', 'No local entry. Online lookup is unavailable.'],
        'ja-JP': ['ローカル辞書のみ表示します。オンライン検索は利用できません。', 'ローカル辞書に項目がありません。オンライン検索は利用できません。'],
        'ko-KR': ['로컬 사전만 표시합니다. 온라인 검색은 사용할 수 없습니다.', '로컬 항목이 없습니다. 온라인 검색은 사용할 수 없습니다.'],
        'fr-FR': ['Dictionnaire local uniquement. La recherche en ligne est indisponible.', 'Aucune entrée locale. La recherche en ligne est indisponible.'],
        'ru-RU': ['Только локальный словарь. Онлайн-поиск недоступен.', 'Локальная статья не найдена. Онлайн-поиск недоступен.'],
        'es-ES': ['Solo diccionario local. La búsqueda en línea no está disponible.', 'No hay entrada local. La búsqueda en línea no está disponible.'],
    };
    const copy = copies[language] ?? copies['zh-CN'];
    const kind = Object.values(copies).findIndex(row => row.includes(value));
    if (kind < 0) return undefined;
    return Object.values(copies)[kind][0] === value ? copy[0] : copy[1];
}
