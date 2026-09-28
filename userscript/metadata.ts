export interface UserscriptMetadataOptions {
    version: string;
    iconDataUrl?: string;
    requires?: readonly string[];
}
const grants = [
    'GM_getValue',
    'GM_setValue',
    'GM_deleteValue',
    'GM_listValues',
    'GM_xmlhttpRequest',
    'GM_registerMenuCommand',
    'GM_openInTab',
    'GM_addStyle',
    'GM.getValue',
    'GM.setValue',
    'GM.deleteValue',
    'GM.listValues',
    'GM.xmlHttpRequest',
    'GM.openInTab',
];

export function createUserscriptMetadata({version, iconDataUrl, requires = []}: UserscriptMetadataOptions): string {
    const lines = [
        '// ==UserScript==',
        '// @name         FluentRead-流畅阅读',
        '// @name:en      FluentRead',
        '// @namespace    https://fr.unmeta.cn/',
        `// @version      ${version}`,
        '// @description  An open-source userscript for bilingual translation. 一款开源的双语翻译用户脚本。',
        '// @description:en An open-source userscript for bilingual translation.',
        '// @author       ThinkStu',
        '// @license      GPL-3.0-only',
        '// @homepageURL  https://github.com/FluentRead/FluentRead',
        '// @supportURL   https://github.com/FluentRead/FluentRead/issues/220',
        '// @match        http://*/*',
        '// @match        https://*/*',
        '// @run-at       document-start',
        '// @inject-into  content',
        '// @noframes',
        '// @connect      *',
        ...requires.map((url) => `// @require      ${url}`),
        ...grants.map((grant) => `// @grant        ${grant}`),
        ...(iconDataUrl ? [`// @icon         ${iconDataUrl}`] : []),
        '// ==/UserScript==',
    ];
    return `${lines.join('\n')}\n`;
}
