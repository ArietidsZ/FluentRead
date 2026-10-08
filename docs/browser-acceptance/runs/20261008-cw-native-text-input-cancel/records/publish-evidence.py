import hashlib
import json
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1]).resolve()
raw = pathlib.Path(__file__).resolve().parent
out = root / 'docs/browser-acceptance/runs/20261008-cw-native-text-input-cancel'
records = out / 'records'
records.mkdir(parents=True, exist_ok=True)
source = json.loads((raw / 'SOURCE-COMMIT.json').read_text())
results = json.loads((raw / 'coverage-final.results.json').read_text())
coverage = json.loads((raw / 'coverage-final/coverage-summary.json').read_text())['total']
checks = ['coverage-final', 'types-final', 'audit-final', 'architecture-final', 'chrome-final',
          'firefox-final', 'userscript-final', 'userscript-verify-final', 'docs-final',
          'manifests-final', 'bindings-final']
architecture = (raw / 'architecture-final.stdout.txt').read_text()
architecture_cases = int(re.search(r'Tests\s+(\d+) passed', architecture)[1])
artifact_hashes = json.loads((raw / 'ARTIFACT-SHA256.json').read_text())
userscript = root / '.output/userscript/FluentRead.user.js'
if not userscript.exists():
    candidates = list((root / '.output/userscript').glob('*.user.js'))
    assert len(candidates) == 1, candidates
    userscript = candidates[0]
validation = {
    **source,
    'tests': {key: results[key] for key in ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests']},
    'test_files': len(results['testResults']), 'coverage': coverage,
    'architecture_tests': architecture_cases, 'architecture_files': 32,
    'userscript_bytes': userscript.stat().st_size, 'userscript_budget': 1955000,
    'artifact_files': len(artifact_hashes),
    'checks': {name: json.loads((raw / (name + '.command.json')).read_text())['exit_code'] for name in checks},
    'permissions_match_89fd0580': True, 'firefox_minimum': '140.0',
    'effective_chrome_incognito': 'spanning',
    'real_browsers_or_providers_run_for_this_source': False,
    'separate_neo_application_commit': '89fd05806c4c41778e8a47817988130ef09ca583',
    'bounded_cancel_before_start_history': 512, 'bounded_completed_history': 512,
    'pending': ['document-lifetime Port lease for old Firefox without documentId',
                'reader/writer and dictionary route wiring', 'remaining feature source wiring',
                'real browser/GUI acceptance of this cancellation source', 'real RTX5090 WebGPU acceptance'],
}
assert results['success'] and results['numFailedTests'] == results['numPendingTests'] == 0
assert all(value == 0 for value in validation['checks'].values())
assert all(coverage[key]['pct'] == 100 for key in ['statements', 'branches', 'functions', 'lines'])
assert validation['userscript_bytes'] <= validation['userscript_budget']
(out / 'VALIDATION.json').write_text(json.dumps(validation, ensure_ascii=False, indent=2) + '\n')
replacements = [(str(root), '<WORKTREE>'), (str(raw), '<RAW>'),
                ('<CW_DEPENDENCIES>', '<CW_DEPENDENCIES>'),
                (str(root.parent), '<CW_TASK>')]
raw_hashes = {}
for path in sorted(raw.rglob('*')):
    if not path.is_file():
        continue
    name = str(path.relative_to(raw))
    raw_hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    content = path.read_text()
    for original, placeholder in replacements:
        content = content.replace(original, placeholder)
    content = '\n'.join(line.rstrip() for line in content.splitlines()) + '\n'
    destination = records / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content)
(out / 'RAW-RECORDS-SHA256.json').write_text(json.dumps(raw_hashes, indent=2) + '\n')
totals = {key: coverage[key]['total'] for key in ['statements', 'branches', 'functions', 'lines']}
readme = f'''# CW 原生文本与输入框取消：固定源码离线验证

源码 **`{source['source_commit']}`**，tree **`{source['source_tree']}`**；从取消检查点 `9da3fd9f` 继续，补上独立审查发现的准备等待清理缺口，以及文件头和架构／测试说明。最终验证期间 **{source['input_files']:,}** 个源码、测试、配置和既有文档输入的 SHA256 全部不变，提交后的 Git tree 路径及每个 blob SHA256 与冻结输入逐项一致。源码提交与本证据提交分开，产物哈希绑定源码提交。

普通文本 fallback 同步解析公开 ID、捕获实际 sender，并在任何来源／配置 await 前登记活动请求；来源等待后核验取消。隐私和术语上下文先附着，不可枚举 control 最后附着，私密改路仍保留 control、snapshot、budget 等描述符。原生文本／批量每次 runtime 尝试均使用新 ID，与前端预选服务无关；视频沿用原来的 ID 协议，userscript 文本和输入框保留旧协议。

输入框使用相同工厂的独立注册表及专用 `inputBoxTranslationCancel`。生产 composition root 给 start/cancel 注入同一输入实例；输入 ownershipKey 加协议范围，同 owner/ID 的普通文本与输入请求既不能互相取消，也不能共享 broker 可取消 pending。公开 start ID 可选以兼容旧调用，并在 broker/cache/provider 前移除。内容页把既有 activeRequestController.signal 连接至传输，保留 generation、invalidate、编辑和值检查，配置变化、编辑或卸载取消一次且不写回迟到结果。

provider 前的 input ready/source 与 generic source/getContexts 等待独立响应取消：底层永不 settle 也能结束 handler，并通过原有 identity-checked finally 清理准确的 active 项；迟到 resolve/reject 被消费，不分派 provider，也不影响新请求。准备 helper 只包这些准备阶段，没有对整个已分派 operation 做 Promise.race；既有 broker 自己的 deadline/abort 行为保持。直接忽略 abort 的 translate operation 仍在注册表中保持至实际 settle，原有 runtime 传输 lease 测试也通过。

发出 start 前的取消不发送 start/cancel；发出之后的取消或超时最多发送一次 cancel。调用方及时结束等待，队列 lease 保留至传输真正回复或超时；clearQueue/sessionCancel 的活动请求语义不变。注册表分别最多保留 **512** 条真正乱序 cancel-before-start 与 completed 历史，不能声称无限乱序取消保证。实际 sender 有 documentId 时沿用既有文档范围；旧 Firefox 缺少它时仍为 tab/frame，无 tab 的扩展页仍为 URL/frame，随机 ID 不能提供导航授权。完整文档断开／重连隔离仍需后续 Port lease。

先在未实现源码上保存固定 red 输入：208 测试中 197 通过、11 个预期失败；实现后检查点专项 **232/232**，注册表／共享传输／输入 handler 局部四项覆盖率 100%。准备等待缺口的新增固定 red 输入为 **140 测试，130 通过／10 预期失败**；修复后四个专项文件 **239/239**，类型通过，另覆盖 userscript 内容页无 ID／无 cancel 的真实旧协议触发。最终冻结源码完整测试 **{results['numPassedTests']:,}/{results['numTotalTests']:,}**、**{len(results['testResults'])} 文件**，零失败、零跳过；statements **{totals['statements']:,}/{totals['statements']:,}**、lines **{totals['lines']:,}/{totals['lines']:,}**、functions **{totals['functions']:,}/{totals['functions']:,}**、branches **{totals['branches']:,}/{totals['branches']:,}**，四项均为 **100%**。架构 **{architecture_cases:,}/{architecture_cases:,}**、32 文件；类型、审计、Chrome／Firefox／userscript／文档构建和两个产物 verifier 通过。userscript **{validation['userscript_bytes']:,} bytes**，既定 **1,955,000 bytes** 上限未改。

**{len(artifact_hashes)}** 个 Chrome／Firefox／userscript 本地产物保存 SHA256。manifest 的 permissions、optional_permissions、host_permissions、optional_host_permissions 和 incognito 与接受的 `89fd0580` 本地产物一致；Chrome 仍是默认 spanning，Firefox 最低版本仍为 140.0。本批不安装依赖、不改凭据或安全设置、不创建 PR、不调用真实模型／搜索 API。确定性组合夹具使用实际 handler → availability → broker → 捕获 mock provider，不代表真实服务、Linux／macOS GUI 或 GPU 验收通过。已完成的隔离 Neo 5/5 仅属于原应用 `89fd0580`，不能套用到本取消源码；本轮没有重跑旧浏览器场景。

完整 JSON、coverage、stdout/stderr、逐命令时间和退出码、固定 red 输入、源码／产物／权限绑定位于 `records/`。修复准备等待前的完整 **9,814/9,814** 测试通过，但旧协议分支少一行及一分支，coverage gate 未通过，其记录单独留在 `pre-preparation-fix/`。初轮类型／夹具错误、不可用 Chai matcher、错用 userscript 配置路径、中间产物超预算和绑定脚本相对路径错误均保留；初轮错误的“broker 必须继续等忽略 abort 的 provider”测试假设已纠正，既有 broker 自带及时 abort/deadline，不更改该行为。中间成功的 userscript 构建也不验证最终源码，最终 verifier 仅在本次最终构建成功后执行。公开副本只替换 CW 绝对路径和行尾空白，原始与公开哈希分别保存。

[实现与剩余接入范围](../../../incognito-route-first-batch.md)。阅读／写作 gateway、字典和更多入口的私密来源接入以及本取消源码的真实浏览器验证仍另行处理。
'''
(out / 'README.md').write_text(readme)
hashes = {str(p.relative_to(out)): hashlib.sha256(p.read_bytes()).hexdigest()
          for p in sorted(out.rglob('*')) if p.is_file() and p.name != 'RECORDS-SHA256.json'}
(out / 'RECORDS-SHA256.json').write_text(json.dumps(hashes, indent=2) + '\n')
print(json.dumps({'evidence_directory': str(out), 'published_records': len(raw_hashes),
                  'source_commit': source['source_commit'], 'validation': validation}, ensure_ascii=False, indent=2))
