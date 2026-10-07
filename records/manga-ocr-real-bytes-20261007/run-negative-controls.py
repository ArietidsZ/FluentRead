import difflib
import hashlib
import json
import pathlib
import subprocess
import sys
root = pathlib.Path(__file__).resolve().parent
worktree = root.parent / 'FluentRead-manga-real-bytes-fix'
runtime = 'src/features/image-translation/services/mangaOcrAssets.ts'
manifest = 'src/features/image-translation/services/mangaOcrAssetManifest.ts'
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=worktree, text=True).strip()
cases = [
 ('size-validation', runtime, "if (buffer.byteLength !== asset.bytes) throw new Error('漫画识别模型文件不完整，请重试');", '', 'tests/mangaOcrAssets.test.ts', '原生无 body'),
 ('hash-validation', runtime, "if (hash !== asset.sha256) throw new Error('漫画识别模型校验失败，请重试');", '', 'tests/mangaOcrAssets.test.ts', '错误 filename'),
 ('filename-validation', runtime, "const asset=MANGA_OCR_ASSETS.find(asset=>asset.path.split('/').pop()===file.name);", 'const asset=MANGA_OCR_ASSETS[0];', 'tests/mangaOcrAssets.test.ts', '错误 filename'),
 ('timeout-boundary', runtime, 'timeout=setTimeout(abort,20_000);', 'timeout=setTimeout(abort,19_999);', 'tests/mangaOcrAssets.test.ts', '19,999ms'),
 ('user-cancellation', runtime, "if (signal?.aborted) throw new DOMException('漫画识别已取消', 'AbortError');", "if (false) throw new DOMException('漫画识别已取消', 'AbortError');", 'tests/mangaOcrAssets.test.ts', '用户取消立即结束'),
 ('reader-rejection-cleanup', runtime, 'void reader.cancel().catch(()=>undefined);', 'void reader.cancel();', 'tests/mangaOcrAssets.test.ts', '真实 reader.cancel'),
 ('production-revision-contract', manifest, 'bf1d5edb0335d3262be7caf13f766ba274b4cadd', '0000000000000000000000000000000000000000', 'tests/mangaOcrAssetManifest.test.ts', '识别源固定'),
]
records = []
for label, source, old, replacement, test, pattern in cases:
    path = worktree / source
    before = path.read_text()
    assert before.count(old) == 1
    before_sha = hashlib.sha256(before.encode()).hexdigest()
    blob = subprocess.check_output(['git', 'hash-object', source], cwd=worktree, text=True).strip()
    assert blob == subprocess.check_output(['git','rev-parse',commit+':'+source],cwd=worktree,text=True).strip()
    mutated = before.replace(old, replacement, 1)
    patch = ''.join(difflib.unified_diff(before.splitlines(True), mutated.splitlines(True), fromfile='a/'+source, tofile='b/'+source))
    (root / (label + '.mutation.patch')).write_text(patch)
    try:
        path.write_text(mutated)
        args = ['node','scripts/testing/run-resource-safe.mjs','--','node','node_modules/vitest/vitest.mjs','run',test,'--testNamePattern',pattern,'--reporter=default','--reporter=json','--outputFile='+str(root/('negative-'+label+'.results.json')),'--no-cache']
        result = subprocess.run([sys.executable,str(root/'run-recorded.py'),'negative-'+label,str(worktree),*args])
        assert result.returncode == 1
        data = json.loads((root/('negative-'+label+'.results.json')).read_text())
        failed = [a['fullName'] for s in data['testResults'] for a in s['assertionResults'] if a['status']=='failed']
        errors = data.get('numRuntimeErrorTestSuites', 0)
        stderr = (root/('negative-'+label+'.stderr.txt')).read_text()
        unhandled = 'Unhandled Rejection' in stderr or 'Unhandled Error' in stderr
        if label == 'reader-rejection-cleanup':
            assert unhandled and 'already closed' in stderr
        else:
            assert failed and not unhandled
        records.append({'label':label,'source_commit':commit,'source_file':source,'source_blob':blob,'source_sha256_before':before_sha,'mutated_source_sha256':hashlib.sha256(mutated.encode()).hexdigest(),'test_file':test,'test_blob':subprocess.check_output(['git','hash-object',test],cwd=worktree,text=True).strip(),'actual_exit_code':result.returncode,'failed_assertions':failed,'unhandled_reported':unhandled,'interpretation':'Expected behavior mutant detected; production and tests restored after the run.'})
    finally:
        path.write_text(before)
        assert hashlib.sha256(path.read_bytes()).hexdigest() == before_sha
(root/'negative-controls.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
assert subprocess.check_output(['git','status','--porcelain'],cwd=worktree,text=True).strip() == ''
print('ALL_SEVEN_REAL_BEHAVIOR_MUTANTS_DETECTED_AND_RESTORED',flush=True)
