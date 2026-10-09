import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {defineConfig, type Plugin} from 'vite';

const root = resolve(__dirname, '..');

// 仅为缺根 LICENSE 的两个精确版本保留离线官方全文；版本、SPDX 和原始字节摘要均固定。
const vendorLicenseFallbacks: Record<string, {version: string; license: string; files: {file: string; sha256: string; source: string}[]}> = {
    '@ai-sdk/provider-utils': {version: '4.0.46', license: 'Apache-2.0', files: [
        {file: 'provider-utils-Vercel.txt', sha256: 'b4f9adb7c568904834d0dd6cc98d16c390d21ca32fc17ae7a267715269bd5529',
            source: 'https://raw.githubusercontent.com/vercel/ai/85464f4e2026d9fc0274424c0171a25742836411/LICENSE'},
        {file: 'Apache-2.0.txt', sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
            source: 'https://raw.githubusercontent.com/apache/www-site/01b1be9fbc5cd93b6794f5653a58b9b863807f84/content/licenses/LICENSE-2.0.txt'},
        {file: 'provider-utils-zod3-ISC.txt', sha256: '6dd0d97acd4d13f4608a0f530f0487e0ff20812888bd1803aecfaaa17ff0f849',
            source: 'https://raw.githubusercontent.com/vercel/ai/85464f4e2026d9fc0274424c0171a25742836411/packages/provider-utils/src/to-json-schema/zod3-to-json-schema/LICENSE'},
    ]},
    'franc-min': {version: '6.2.0', license: 'MIT', files: [
        {file: 'franc-min-MIT.txt', sha256: 'f5e0c5c44706ddda7ac2f9096f848222f1e0e90f88643955041c2735be84592b',
            source: 'https://raw.githubusercontent.com/wooorm/franc/3f9f0b51a96c5df32a407dad865a3011ac0fa2d1/license'},
    ]},
};

function includeVendorLicenses(): Plugin {
    return {
        name: 'include-userscript-vendor-licenses',
        generateBundle(_options, bundle) {
            const chunk = Object.values(bundle).find((item) => item.type === 'chunk' && item.isEntry);
            if (!chunk || chunk.type !== 'chunk') throw new Error('Userscript vendor bundle is missing');
            const packageRoots = new Set<string>();
            for (const id of chunk.moduleIds) {
                if (id.startsWith('\0')) continue;
                const match = /^(.*\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?)(@[^/]+\/[^/]+|[^/]+)/u.exec(id);
                if (match) packageRoots.add(`${match[1]}${match[2]}`);
            }
            const notices = [...packageRoots].sort().map((packageRoot) => {
                const manifest = JSON.parse(fs.readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
                    name: string;
                    version: string;
                    license?: string;
                    repository?: string | {url?: string};
                };
                if (!manifest.license) throw new Error(`Missing userscript vendor license: ${manifest.name}`);
                const licenseFile = fs.readdirSync(packageRoot).find((name) => /^LICEN[CS]E(?:[.-].*)?$/iu.test(name));
                const repository = typeof manifest.repository === 'string'
                    ? manifest.repository : manifest.repository?.url;
                const fallback = vendorLicenseFallbacks[manifest.name];
                if (!licenseFile && fallback && (manifest.version !== fallback.version || manifest.license !== fallback.license)) {
                    throw new Error(`Userscript vendor license fallback version/SPDX mismatch: ${manifest.name}@${manifest.version} ${manifest.license}`);
                }
                const licenseText = licenseFile
                    ? fs.readFileSync(resolve(packageRoot, licenseFile), 'utf8').trim().replace(/[ \t]+$/gmu, '')
                    : fallback ? fallback.files.map(({file, sha256, source}) => {
                        const bytes = fs.readFileSync(resolve(root, 'userscript/licenses', file));
                        if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
                            throw new Error(`Userscript vendor license fallback hash mismatch: ${file}`);
                        }
                        return `License source: ${source}\n${bytes.toString('utf8').trim().replace(/[ \t]+$/gmu, '')}`;
                    }).join('\n\n')
                        : `License source: ${repository || `https://www.npmjs.com/package/${manifest.name}/v/${manifest.version}`}`;
                if (licenseText.includes('*/')) throw new Error(`Unsafe userscript vendor license comment: ${manifest.name}`);
                return `/*\n${manifest.name} ${manifest.version} — ${manifest.license}\n${licenseText}\n*/`;
            });
            if (notices.length === 0) throw new Error('Userscript vendor bundle contains no third-party licenses');
            chunk.code = `${notices.join('\n')}\n${chunk.code}`;
        },
    };
}

export default defineConfig({
    root,
    publicDir: false,
    plugins: [includeVendorLicenses()],
    build: {
        outDir: resolve(root, '.output/userscript-vendor'),
        emptyOutDir: true,
        target: 'es2018',
        minify: 'esbuild',
        sourcemap: false,
        lib: {
            entry: resolve(root, 'userscript/vendorEntry.ts'),
            name: 'FluentReadUserscriptVendor',
            formats: ['iife'],
            fileName: () => 'fluentread-vendor.v1.js',
        },
        rollupOptions: {output: {inlineDynamicImports: true}},
    },
});
