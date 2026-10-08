import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const root = process.cwd(), raw = path.dirname(new URL(import.meta.url).pathname);
const ts = createRequire(path.join(root, 'package.json'))('typescript');
const sha = contents => crypto.createHash('sha256').update(contents).digest('hex');
const extract = file => {
 const text = fs.readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), candidates = [];
 const visit = node => {if (ts.isFunctionDeclaration(node) && node.body?.getText(ast).includes('image-transaction:')) candidates.push(node.getText(ast)); ts.forEachChild(node, visit);};
 visit(ast); candidates.sort((a,b) => a.length-b.length); if (!candidates.length) throw new Error('registry factory missing');
 return {file,artifact_bytes:Buffer.byteLength(text),artifact_sha256:sha(text),factory_bytes:Buffer.byteLength(candidates[0]),factory_sha256:sha(candidates[0]),factory:candidates[0]};
};
const prior=JSON.parse(fs.readFileSync(path.join(raw,'USERSCRIPT-26-BYTE-PROOF.json'),'utf8')).accepted_1fb8c697;
const current=extract(path.join(root,'.output/userscript/fluent-read.user.js'));
fs.writeFileSync(path.join(raw,'userscript-final-registry.js'),current.factory+'\n');
const {factory,...data}=current;
const proof={current:data,artifact_delta_from_1fb8c697:current.artifact_bytes-prior.artifact_bytes,registry_factory_delta_from_1fb8c697:current.factory_bytes-prior.factory_bytes,remainder_byte_count_delta_from_1fb8c697:(current.artifact_bytes-current.factory_bytes)-(prior.artifact_bytes-prior.factory_bytes),budget:1955000,headroom:1955000-current.artifact_bytes};
fs.writeFileSync(path.join(raw,'USERSCRIPT-CATCH-BYTE-PROOF.json'),JSON.stringify(proof,null,2)+'\n');process.stdout.write(JSON.stringify(proof,null,2)+'\n');
