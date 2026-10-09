import fs from 'node:fs';
import {resolve, relative, dirname} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';
const root = process.cwd();
const evidence = dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
const phase = process.argv[3];
if (!['before','after'].includes(phase)) throw new Error('Expected candidate phase');
const candidateDir = evidence;
if (!['standard', 'standalone', 'greasyfork'].includes(mode)) throw new Error('Unexpected local build mode');
process.env.FLUENTREAD_USERSCRIPT_STANDALONE = mode === 'standalone' ? '1' : '0';
delete process.env.FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE;
if (mode === 'greasyfork') {
 const commit = execFileSync('git', ['log','-1','--format=%H','--','userscript/resources/fluentread-vendor.v1.js','userscript/resources/fluentread-data.v1.js'], {encoding:'utf8'}).trim();
 const baseUrl = `https://cdn.jsdelivr.net/gh/FluentRead/FluentRead@${commit}/userscript/resources`;
 process.env.FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE = '1';
 process.env.FLUENTREAD_USERSCRIPT_VENDOR_URL = baseUrl + '/fluentread-vendor.v1.js';
 process.env.FLUENTREAD_USERSCRIPT_DATA_URL = baseUrl + '/fluentread-data.v1.js';
}
const {build, normalizePath} = await import(pathToFileURL(resolve(root, 'node_modules/vite/dist/node/index.js')).href);
const hash = data => createHash('sha256').update(data).digest('hex');
const folder = mode === 'standard' ? 'userscript' : mode === 'standalone' ? 'userscript-standalone' : 'userscript-greasyfork';
const artifact = resolve(root, '.output', folder, 'fluent-read.user.js');
const prior = fs.readFileSync(artifact);
let graph;
await build({configFile: resolve(root, 'userscript/vite.config.ts'), plugins: [{
    name: 'cw-read-only-final-entry-module-proof',
    generateBundle: {order: 'post', handler(_options, bundle) {
        const entry = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry);
        if (!entry) throw new Error('No actual userscript entry');
        const canonical = normalizePath(resolve(root, 'src/ui/assets/serviceBrandPaths.json'));
        const ids = entry.moduleIds;
        graph = {moduleCount: ids.length,
            svgRelatedModuleIds: ids.filter(id => /(?:ServiceIcon\.vue|serviceBrandPaths\.json)/u.test(id)),
            matchingSvgDataModuleIds: ids.filter(id => normalizePath(id).split('?')[0] === canonical),
            canonicalSvgDataPath: canonical,
            includesSvg: ids.some(id => normalizePath(id).split('?')[0] === canonical),
            moduleIds: ids,
            modules: Object.fromEntries(Object.entries(entry.modules).map(([id, value]) => [
                id.startsWith(root + '/') ? relative(root, id) : id,
                {renderedLength: value.renderedLength, originalLength: value.originalLength, renderedExports: value.renderedExports},
            ])),
        };
    }},
}]});
const bytes = fs.readFileSync(artifact);
const notice = fs.readFileSync(resolve(root, 'public/third-party-notices/lobe-icons-MIT.txt'));
const record = {mode, platform: process.platform, viteVersion: '5.4.19',
    artifact: {path: relative(root, artifact), bytes: bytes.length, sha256: hash(bytes)},
    previous389Artifact: {bytes: prior.length, sha256: hash(prior)},
    byteIdenticalTo389: bytes.equals(prior),
    graph: Object.fromEntries(Object.entries(graph).filter(([key]) => !['moduleIds', 'modules'].includes(key))),
    fullLobeLicensePresent: bytes.includes(notice),
    candidateSourceSha256: Object.fromEntries(['userscript/vite.config.ts', 'src/features/settings/ui/SettingsSections.vue']
        .map(file => [file, hash(fs.readFileSync(resolve(root, file)))])),
    note: 'Read-only Vite generateBundle observer records actual production entry.moduleIds; it never changes the bundle. Windows path behavior is tested through the real hook with simulated path ports, not a Windows OS build.',
};
if (phase === 'before' && !record.byteIdenticalTo389) throw new Error('Before baseline differs from validated prior build');
if (record.fullLobeLicensePresent !== record.graph.includesSvg) throw new Error('License does not match actual SVG graph');
fs.writeFileSync(resolve(candidateDir, mode + '-' + phase + '-modules.json'), JSON.stringify(graph.modules, null, 2) + '\n');
const moduleIds = graph.moduleIds.map(id => id.replaceAll(root + '/', ''));
record.actualEntryModuleIds = moduleIds;
record.jsModuleIds = moduleIds.filter(id => !/(?:\.css(?:\?|$)|\?vue&type=style)/u.test(id));
record.cssModuleIds = moduleIds.filter(id => /(?:\.css(?:\?|$)|\?vue&type=style)/u.test(id));
const text = bytes.toString('utf8');
const css = mode === 'greasyfork'
 ? Buffer.from(runInNewContext(fs.readFileSync(resolve(root,'.output/userscript-greasyfork/fluentread-data.v1.js'),'utf8'),{}, {timeout:1000}).css)
 : gunzipSync(Buffer.from(text.match(/globalThis\.__fluentReadUserscriptCssCompressed="([A-Za-z0-9+/=]+)"/u)[1], 'base64'));
record.cssPayload = {bytes:css.length, sha256:hash(css)};
record.localTtsModuleIds = moduleIds.filter(id => /LocalTtsSettings/u.test(id));
if (mode === 'greasyfork') record.generatedDataSha256 = hash(fs.readFileSync(resolve(root,'.output/userscript-greasyfork/fluentread-data.v1.js')));
fs.writeFileSync(resolve(candidateDir, mode + '-' + phase + '-module-proof.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record));
