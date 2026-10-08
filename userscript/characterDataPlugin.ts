/**
 * @file userscript/characterDataPlugin.ts
 * 文件职责：在 userscript 构建期无损压缩生成的 Unicode 字符数据，保留共享 core 的原始导出契约。
 * 主要内容：只接受导出的 const 字符串，以相邻码点差值缩小 gzip 数据；生成同步还原的普通模块。
 * 模块边界：不压缩可执行源码，不修改生成文件；Greasy Fork 保留可读数据，扩展不使用本插件。
 */
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import ts from 'typescript';
import {normalizePath, type Plugin} from 'vite';

/** 只处理权威字符表；数据文件出现逻辑时拒绝构建，避免把代码当成压缩资源。 */
export function createUserscriptCharacterDataCompressionPlugin(root: string, enabled = true): Plugin {
    const sourcePath = normalizePath(resolve(root, 'src/core/language/chineseVariants.ts'));
    return {
        name: 'compress-userscript-character-data',
        enforce: 'pre',
        transform(code, id) {
            if (!enabled || normalizePath(id.split('?')[0]) !== sourcePath) return null;
            const source = ts.createSourceFile(sourcePath, code, ts.ScriptTarget.Latest, true);
            const names: string[] = [];
            const tables: number[][] = [];
            const unsupported = () => new Error('Userscript character data must contain only exported const strings');
            for (const statement of source.statements) {
                if (!ts.isVariableStatement(statement)
                    || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
                    || !(statement.declarationList.flags & ts.NodeFlags.Const)) throw unsupported();
                for (const declaration of statement.declarationList.declarations) {
                    if (!ts.isIdentifier(declaration.name) || !declaration.initializer
                        || !(ts.isStringLiteral(declaration.initializer) || ts.isNoSubstitutionTemplateLiteral(declaration.initializer))
                        || names.includes(declaration.name.text)) throw unsupported();
                    names.push(declaration.name.text);
                    let previous = 0;
                    tables.push(Array.from(declaration.initializer.text, (character) => {
                        const point = character.codePointAt(0)!;
                        const delta = point - previous;
                        previous = point;
                        return delta;
                    }));
                }
            }
            if (!names.length) throw unsupported();
            const compressed = gzipSync(Buffer.from(JSON.stringify(tables)), {level: 9}).toString('base64');
            const digest = createHash('sha256').update(code).digest('hex');
            return {
                code: [
                    code.slice(0, source.statements[0].getStart(source)),
                    '/* Non-code Unicode character data; source sha256 ' + digest + '. */',
                    "import {inflateWithPako} from '@/userscript/pakoRuntime';",
                    'const bytes = Uint8Array.from(atob(' + JSON.stringify(compressed) + '), (character) => character.charCodeAt(0));',
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
                    ...names.map((name, index) => 'export const ' + name + ' = characterTables[' + index + '];'),
                ].join('\n'),
                map: null,
            };
        },
    };
}
