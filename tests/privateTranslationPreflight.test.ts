import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import ts from 'typescript';
import {describe, expect, it} from 'vitest';
import {Config} from '@/src/core/config/model';
import {resolvePrivateTranslationConfig} from '@/src/core/config/privateTranslation';
import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {resolveWritingReadiness} from '@/src/core/config/writingReadiness';

/** Compile the production computed expression, not a reimplementation of its checks. */
function computedFrom(file: string, name: string, ports: Record<string, unknown>) {
    const source = readFileSync(resolve(file), 'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)![1];
    const ast = ts.createSourceFile('component.ts', source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
        .find(declaration => declaration.name.getText(ast) === name)!;
    const compiled = ts.transpileModule(`const result = ${declaration.initializer!.getText(ast)};`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
    return new Function('computed', ...Object.keys(ports), `${compiled}\nreturn result;`)(
        (read: () => unknown) => ({get value() {return read();}}), ...Object.values(ports));
}
const getTranslationServiceUnavailableMessage = () => null;
describe('private-profile production UI preflights', () => {
    it('allows valid private translation despite missing ordinary OpenAI credentials, and keeps ordinary warnings', () => {
        const current = new Config(); current.service = 'openai'; current.token.openai = '';
        current.privateTranslation = {enabled: true, service: 'microsoft', model: ''};
        const config = {value: current}; const currentTabPrivate = {value: true}; const before = JSON.stringify(current);
        const warning = computedFrom('src/app/popup/PopupApp.vue', 'credentialWarning',
            {config, currentTabPrivate, resolvePrivateTranslationConfig, getTranslationServiceUnavailableMessage, getMissingCredentialMessage});
        expect(warning.value).toBeNull(); currentTabPrivate.value = false; expect(warning.value).toBeTruthy();
        expect(JSON.stringify(current)).toBe(before);
        currentTabPrivate.value = true; current.privateTranslation.service = ''; expect(warning.value).toContain('无痕');
    });
    it('allows private AI writing when ordinary inherited service is machine translation', () => {
        const current = new Config(); current.service = 'microsoft'; current.writing.service = '';
        current.privateTranslation = {enabled: true, service: 'openai', model: 'private-writer'};
        const browser = {extension: {inIncognitoContext: true}};
        const readiness = computedFrom('src/features/writing-assistant/ui/WritingPanel.vue', 'readiness',
            {config: {value: current}, browser, resolvePrivateTranslationConfig, resolveWritingReadiness});
        expect(readiness.value).toMatchObject({ready: true, service: 'openai', model: 'private-writer'});
        browser.extension.inIncognitoContext = false; expect(readiness.value.ready).toBe(false);
        browser.extension.inIncognitoContext = true; current.privateTranslation.model = ''; expect(readiness.value.ready).toBe(false);
    });
    it('does not gate a private document request on ordinary document credentials', () => {
        const current = new Config(); current.service = 'openai'; current.documentService = 'openai'; current.token.openai = '';
        current.privateTranslation = {enabled: true, service: 'microsoft', model: ''};
        const warning = computedFrom('src/app/document-translation/DocumentApp.vue', 'credentialWarning',
            {config: current, browser: {extension: {inIncognitoContext: true}}, resolvePrivateTranslationConfig,
                getTranslationServiceUnavailableMessage, getMissingCredentialMessage});
        expect(warning.value).toBeNull(); current.privateTranslation.service = ''; expect(warning.value).toContain('无痕');
    });
});
