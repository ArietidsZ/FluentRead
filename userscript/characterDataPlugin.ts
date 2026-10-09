/**
 * @file userscript/characterDataPlugin.ts
 * 文件职责：在 userscript 构建期无损处理语言识别的静态字符串数据，保留共享 core 的原始导出契约。
 * 主要内容：仅接受两份明确数据表中的导出 const 字符串；标准/独立版沿用原压缩，GF 同步读取固定 data 的具名字符串。
 * 模块边界：不压缩可执行源码，不修改生成文件；Greasy Fork 只外置纯字符串，算法留主文件；扩展不使用本插件。
 */
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import ts from 'typescript';
import {normalizePath, type Plugin} from 'vite';

/** 两份构建路径共用原 AST 白名单与导出名；不排序、trim 或规范化任何字符串值。 */
export function readUserscriptCharacterData(code: string, sourcePath: string): {names: string[]; values: string[]; header: string} {
    const source = ts.createSourceFile(sourcePath, code, ts.ScriptTarget.Latest, true);
    const names: string[] = [];
    const values: string[] = [];
    const unsupported = () => new Error('Userscript language data must contain only exported const strings');
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)
            || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
            || !(statement.declarationList.flags & ts.NodeFlags.Const)) throw unsupported();
        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer
                || !(ts.isStringLiteral(declaration.initializer) || ts.isNoSubstitutionTemplateLiteral(declaration.initializer))
                || names.includes(declaration.name.text)) throw unsupported();
            names.push(declaration.name.text);
            values.push(declaration.initializer.text);
        }
    }
    if (!names.length) throw unsupported();
    return {names, values, header: code.slice(0, source.statements[0].getStart(source))};
}

/** 只处理两份权威纯数据表；数据文件出现逻辑时拒绝构建。GF 仅同步读固定 data 字符串。 */
export function createUserscriptCharacterDataCompressionPlugin(root: string, enabled = true, externalData = false): Plugin {
    const sourceModes = new Map([
        [normalizePath(resolve(root, 'src/core/language/chineseVariants.ts')), 'delta'],
        [normalizePath(resolve(root, 'src/core/language/functionWordData.ts')), 'strings'],
    ]);
    return {
        name: 'compress-userscript-character-data',
        enforce: 'pre',
        transform(code, id) {
            const sourcePath = normalizePath(id.split('?')[0]);
            const mode = sourceModes.get(sourcePath);
            if (!enabled || !mode) return null;
            const {names, values, header} = readUserscriptCharacterData(code, sourcePath);
            const digest = createHash('sha256').update(code).digest('hex');
            if (externalData) {
                return {
                    code: [
                        header,
                        '/* Non-code language data; source sha256 ' + digest + '. */',
                        'const characterData = globalThis.__FLUENTREAD_USERSCRIPT_DATA__?.characterData;',
                        'for (const name of ' + JSON.stringify(names) + ') {',
                        '    if (typeof characterData?.[name] !== "string") throw new Error("Missing pinned userscript language string: " + name);',
                        '}',
                        ...names.map((name) => 'export const ' + name + ' = characterData.' + name + ';'),
                    ].join('\n'),
                    map: null,
                };
            }
            const tables = mode === 'strings' ? values : values.map((value) => {
                let previous = 0;
                return Array.from(value, (character) => {
                    const point = character.codePointAt(0)!;
                    const delta = point - previous;
                    previous = point;
                    return delta;
                });
            });
            const compressed = gzipSync(Buffer.from(JSON.stringify(tables)), {level: 9}).toString('base64');
            return {
                code: [
                    header,
                    '/* Non-code language data; source sha256 ' + digest + '. */',
                    "import {inflateWithPako} from '@/userscript/pakoRuntime';",
                    'const bytes = Uint8Array.from(atob(' + JSON.stringify(compressed) + '), (character) => character.charCodeAt(0));',
                    ...(mode === 'strings' ? ['const characterTables = JSON.parse(inflateWithPako(bytes));'] : [
                        'const characterTables = JSON.parse(inflateWithPako(bytes)).map((deltas) => {',
                        '    let point = 0;',
                        '    return deltas.map((delta) => {',
                        '        point += delta;',
                        // fromCharCode 避免给旧内核新增 String.fromCodePoint 依赖；完整保留补充平面字符。
                        '        return point > 0xFFFF',
                        '            ? String.fromCharCode(0xD800 + ((point - 0x10000) >> 10), 0xDC00 + ((point - 0x10000) & 0x3FF))',
                        '            : String.fromCharCode(point);',
                        "    }).join('');",
                        '});',
                    ]),
                    ...names.map((name, index) => 'export const ' + name + ' = characterTables[' + index + '];'),
                ].join('\n'),
                map: null,
            };
        },
    };
}
