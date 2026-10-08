import hashlib
import json
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
raw = pathlib.Path(__file__).resolve().parent
out = root / 'docs/browser-acceptance/runs/20261008-cw-incognito-input-containment'
records = out / 'records'
records.mkdir(parents=True, exist_ok=True)
source = json.loads((raw / 'SOURCE-COMMIT.json').read_text())
results = json.loads((raw / 'coverage-final.results.json').read_text())
coverage = json.loads((raw / 'coverage-final/coverage-summary.json').read_text())['total']
checks = ['coverage-final', 'types-final', 'audit-final', 'architecture-final', 'chrome-final', 'firefox-final',
          'userscript-final', 'userscript-verify-final', 'docs-final', 'manifests-final', 'bindings-final']
validation = {**source, 'tests': {key: results[key] for key in ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests']},
              'test_files': len(results['testResults']), 'coverage': coverage,
              'architecture_tests': 1371, 'architecture_files': 32, 'userscript_bytes': 1954998, 'userscript_budget': 1955000,
              'artifact_files': len(json.loads((raw / 'ARTIFACT-SHA256.json').read_text())),
              'checks': {name: json.loads((raw / (name + '.command.json')).read_text())['exit_code'] for name in checks},
              'permissions_match_89fd0580': True, 'firefox_minimum': '140.0', 'effective_chrome_incognito': 'spanning',
              'real_browsers_or_providers_run_in_this_batch': False,
              'pending': ['backend input cancellation protocol', 'reader/writer and dictionary routes', 'remaining feature source wiring', 'separate Neo browser acceptance']}
assert all(value == 0 for value in validation['checks'].values())
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
readme = f'''# CW 输入框私密路线与未标记来源隔离：离线检查点

源码 **`{source['source_commit']}`**，tree **`{source['source_tree']}`**；父提交 `aa8d14b4`。最终验证期间 **4,406** 个源码、测试、配置及既有文档输入的 SHA256 全部不变，提交后的 Git tree 路径与 blob SHA256 逐项一致。此目录仅为本批离线检查点；后续 Neo 验收使用独立目录和指定 `89fd0580` 应用版本。

typed 输入框 handler 等待水合和可信原生来源解析后一次读取配置，先验证／锁定私密路线，再处理输入独立服务、模型和提示词能力。专用路线优先于输入 override；通用 AI 使用输入专属提示词，机器翻译和原生 MT 保留原协议规则。公开 payload 中的身份和模型字段不能决定路线。实际 handler → availability → broker → 捕获 mock provider 组合测试验证最终模型及缓存身份；availability 保留不可枚举 symbol 与快照描述符。

broker 同时检查水合后的 live 配置和附带 snapshot。任一方专用字段非空或畸形时，未标记与 unknown 来源均在缓存键、缓存和 provider 之前以非重试 `TRANSLATION_SOURCE_UNKNOWN` 拒绝。旧空 snapshot 不能绕过后来启用的 live 策略；live 清空不能释放旧受保护 snapshot。双方真正未设置才保留旧行为。明确 regular 不验证私密配置，已标记的请求保留捕获策略；userscript 的原生能力为 false。

输入内容页指纹纳入私密字段、模型登记及实际候选连接哈希。实际 composition root 配置回调推进既有 generation 并 invalidate；请求 ID、编辑代次、generation 和 signal 共同阻止旧结果写回。组合测试包括服务／模型和候选连接变更后的晚到回复。后台取消协议及 input cancellation ID 尚未接入，本批不改事务表、Port 或 ABA 规则。

图片／漫画文字、区域标准／AI 文字、区域视觉转录、单词卡辅助翻译和强制视觉探测尚未携带来源，因此专用路线配置后暂时闭锁，普通页面同样受影响。使用实际业务入口和实际 availability/broker 验证，没有伪造 regular 获得通过。词卡保留字典原文；独立字典 lookup 仍会执行。视觉探测可先做本地能力缓存准备，但闭锁前不会调用 provider，也不写 supported/unsupported 结论。阅读与写作 modelGateway、字典查词绕过此 broker，仍未受该策略保护；两套视频和更多入口仍待核验。七种界面语言明确显示接入范围和暂时限制。

最终 **9,747/9,747**，**399 文件**，零失败、零跳过；statements/lines **65,697/65,697**，functions **4,552/4,552**，branches **33,327/33,327**，四维门槛 **100%**。架构 **1,371/1,371**、32 文件通过。类型、审计、Chrome／Firefox／userscript／文档构建及 manifest verifier 均通过。userscript **1,954,998 bytes**，既定 **1,955,000 bytes** 预算未改。**797** 个本地产物保存 SHA256。

生成 manifest 的 permissions、optional_permissions、host_permissions、optional_host_permissions、incognito 与接受的 `89fd0580` 本地产物一致；Chrome 仍为默认 spanning，Firefox 最低版本仍为 140.0。未新增权限、改凭据、安装软件、创建 PR 或调用真实搜索／模型 API。本批没有 GUI、真实供应商或 RTX5090 WebGPU 验证。Xvfb／隔离 Neo 验收已获另项批准，将在保存此检查点后独立继续；虚拟显示结果不能作为 GPU 或当前桌面 Cua 全链路通过。

完整 JSON、coverage JSON、stdout/stderr 与逐命令时间／退出码位于 `records/`。初轮 model 夹具错误、类型错误、catalog 全量 mock 缺项以及 userscript 导出／预算失败保留为诊断。`verifier-initial` 的成功来自首次构建失败后残留的上一批产物，**不能视为本批验证**；最终 verifier 只在本批最终构建成功后执行。首次全量覆盖率运行期间修改了不在其执行清单中的架构夹具，因此仍单独执行了固定输入的最终全量验证。公开副本只替换 CW 绝对路径和行尾空白，原始记录哈希与公开副本哈希分别保存。

[实现与兼容边界](../../../incognito-route-first-batch.md)。本批检查点不表示全体私密功能或浏览器部署验收完成。
'''
(out / 'README.md').write_text(readme)
hashes = {str(p.relative_to(out)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.rglob('*')) if p.is_file() and p.name != 'RECORDS-SHA256.json'}
(out / 'RECORDS-SHA256.json').write_text(json.dumps(hashes, indent=2) + '\n')
print(json.dumps({'evidence_directory': str(out), 'published_records': len(raw_hashes), 'source_commit': source['source_commit']}, indent=2))
