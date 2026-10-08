import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]).resolve();raw=pathlib.Path(__file__).resolve().parent;out=root/'docs/browser-acceptance/runs/20261008-cw-writing-private-route';records=out/'records';records.mkdir(parents=True,exist_ok=True)
read=lambda p:json.loads(p.read_text())
source=read(raw/'SOURCE-COMMIT.json');full=read(raw/'full-coverage.results.json');cov=read(raw/'full-coverage/coverage-summary.json');arch=read(raw/'architecture.results.json');targeted=read(raw/'writing-route-coverage-final.results.json');tcov=read(raw/'targeted-coverage-final/coverage-summary.json');red=read(raw/'writing-route-red.results.json');binding=read(raw/'FINAL-BINDING.json');scope=read(raw/'TYPECHECK-SCOPE-PROOF.json')
checks=['writing-route-coverage-final','full-coverage','architecture','typecheck-final','typecheck-list','audit','build-chrome','build-firefox','build-userscript','verify-extension-manifests','verify-userscript','docs-source-build','bindings-final','bind-source-commit']
for r in [full,arch,targeted]:assert r['success'] and r['numFailedTests']==r['numPendingTests']==0
for c in [cov,tcov]:assert all(c['total'][m]['pct']==100 for m in ['lines','statements','functions','branches'])
assert all(read(raw/(label+'.command.json'))['exit_code']==0 for label in checks)
validation={**source,**binding,'slice':read(raw/'SLICE-SCOPE.json'),'tests':{k:full[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']},'test_files':len(full['testResults']),'coverage':cov['total'],'changed_modules_coverage':{p.split('/src/')[1]:v for p,v in tcov.items() if '/src/' in p},'targeted_tests':targeted['numPassedTests'],'red_tests':{k:red[k] for k in ['numTotalTests','numPassedTests','numFailedTests']},'architecture_tests':arch['numTotalTests'],'architecture_files':len(arch['testResults']),'checks':{label:read(raw/(label+'.command.json'))['exit_code'] for label in checks},'typecheck_scope':scope,'no_gui_or_real_provider_api_run':True,'no_credentials_permissions_defaults_or_dependencies_changed':True,'previous_neo_source_not_this_acceptance':'89fd05806c4c41778e8a47817988130ef09ca583','pending':['reading-assistant source routing before Harness/conversation/modelGateway','dictionary and other source routes','real Firefox/Neo GUI acceptance for this source','real RTX5090 WebGPU acceptance']}
if (raw/'docs-evidence-build.command.json').exists():validation['evidence_docs_build_exit_code']=read(raw/'docs-evidence-build.command.json')['exit_code'];assert validation['evidence_docs_build_exit_code']==0
replacements=[(str(root),'<WORKTREE>'),(str(raw),'<RAW>'),('<CW_DEPENDENCIES>','<CW_DEPENDENCIES>'),(str(root.parent),'<CW_TASK>'),('<CW_HOME>/','<CW_HOME>/')];raw_hashes={}
for p in sorted(raw.rglob('*')):
 if not p.is_file():continue
 name=str(p.relative_to(raw));data=p.read_bytes();raw_hashes[name]=hashlib.sha256(data).hexdigest();content=data.decode()
 for original,placeholder in replacements:content=content.replace(original,placeholder)
 content='\n'.join(line.rstrip() for line in content.splitlines()).rstrip('\n')+'\n';dst=records/name;dst.parent.mkdir(parents=True,exist_ok=True);dst.write_text(content)
validation['published_record_files']=len(raw_hashes);(out/'VALIDATION.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n');(out/'RAW-RECORDS-SHA256.json').write_text(json.dumps(raw_hashes,indent=2)+'\n')
(out/'README.md').write_text(f'''# CW 写作私密模型路由：完整功能切片离线验证

源码 **`{source['source_commit']}`**，tree **`{source['source_tree']}`**；应用基线 **`469ce1991f00fd69b09faaac492d76e567171421`**，工作分支此前 HEAD 为 `1e60e1f11544eb7755208da2c4b9796e08ade133`。本批仅完成写作切片，**阅读 Harness/conversation 入口尚未接入专用路由**。共享 modelGateway 新增的检查只在已有内部模型锁时拒绝冲突，未更改普通阅读选模。本批不宣称隐私功能整体完成，不把旧 Neo 场景计入此源码验收。

定位发现：写作后台直接调用 createHarnessLanguageModel，原先的原生 private 布尔只控制记忆，没有选用专用模型；配置取消键也缺少专用对和部分 provider 字段。当前端口在任何 await 前复制并冻结实际 sender；应用层用既有原生三态解析器和可取消准备等待，按同一 documentId 精确查询无 tab 上下文，并附着内部来源。前端的 privateContext/incognito 或 service/model 字段由实际严格 parser 拒绝，旧内存 boolean 也不能作为私密模型授权。

写作 runtime 在构造 modelGateway 前同时核验当前配置及冻结快照：private 解析目录和能力有效的专用 provider/model，覆盖本次写作对并附着既有内部模型锁；unknown 且任一专用字段设置时 fail closed；regular 保持独立写作对；两字段都为空保持原写作路线与记忆策略。机器翻译、本地翻译和不支持会话上下文的翻译专用模型明确拒绝，失效模型或请求体/端点冲突不回退普通模型。网关拒绝已有锁与调用参数不同的 provider 或 model，多 Key 调用仍保留冻结的模型、端点和凭据快照。

角色、语气、目标语言、draft/reply/polish/chat、忠实翻译、read_context 和既有记忆边界仍由原写作 runtime 定义，没有注入普通翻译 prompt。实际 SDK wire 用例验证私密正文和写作阅读对照均使用专用 model，translation intent 保留忠实翻译及无工具语义。多 Key 合成 429 负控在首次调用中改变全局配置后，第二次实际请求仍携带原专用 model 和 endpoint。生产配置变更路径另外中止请求；该冻结负控不代表可以在配置变更后绕过取消。

专用 provider/model、目录、端点、请求体/头、API Key 池和模型思考等字段加入已有写作配置取消键。关闭、断连、导航、停用以及配置变更中止在途生成，真实 handler 的 finished/controller 边界拒绝迟到 progress/result。ready 刚 resolve 而原生关闭先于 continuation 的窗口也阻止迟到启动；getContexts 永不返回时取消准备等待，底层迟到结果被消费。客户端既有 requestId/关闭清理和写作对照的 generation/缓存结果边界另由原测试覆盖；没有重做图片或文本文档 Port。

固定 red 源码与基线 Git blob 记录在 `records/red-tests/` 和 `records/BASE-SOURCE-BINDING.json`：**{red['numTotalTests']} 测试，{red['numPassedTests']} 通过/{red['numFailedTests']} 预期失败**。最终六文件针对性 **{targeted['numPassedTests']}/{targeted['numTotalTests']}**，四个改动模块 statements/branches/functions/lines 均 100%。首轮局部覆盖率只缺 ready-continuation 关闭窗口分支，其原始 JSON 保留，补真实窗口用例后闭合；没有放宽阈值或加入忽略。

冻结源码完整检查 **{full['numPassedTests']:,}/{full['numTotalTests']:,}**，**{len(full['testResults'])} 文件**，零失败、零跳过；statements/lines **{cov['total']['lines']['covered']:,}/{cov['total']['lines']['total']:,}**、functions **{cov['total']['functions']['covered']:,}/{cov['total']['functions']['total']:,}**、branches **{cov['total']['branches']['covered']:,}/{cov['total']['branches']['total']:,}**，四项均 **100%**。架构 **{arch['numPassedTests']:,}/{arch['numTotalTests']:,}**、{len(arch['testResults'])} 文件；类型、审计、Chrome/Firefox/userscript/文档构建及两个 verifier 全部通过。类型清单包含全部 **799 src、496 tests、15 entrypoint** TS/Vue 文件；本批 tsconfig 与原有验收存档排除均未改。

冻结 **{source['input_files']:,}** 个源码/测试/配置/文档输入（明确排除已发布 browser acceptance run 数据），对应 Git tree 路径及每个 blob SHA256 一致；**{binding['artifacts']}** 个本地产物保存 SHA256。userscript **{binding['userscript_bytes']:,} bytes**，原 1,955,000 bytes 上限未改，与 469ce199/ed89 **字节一致**。权限、Chrome spanning、Firefox 140.0 最低版本、依赖锁、凭据和默认模型均未变；用户配置的修改只发生在合成测试对象中。

完整 command/UTC 时间/耗时/退出码、stdout/stderr、原始红测输入、JSON 和 coverage、类型文件清单、源码/产物/权限绑定均在 `records/`；公开副本仅替换 CW 绝对路径和清除行尾/末尾空白，原始及公开 SHA256 分别保存。本批使用实际 handler → writing runtime → modelGateway → AI SDK provider → **合成 fetch**，没有真实模型/API/搜索、GUI 或 GPU 调用，没有依赖安装、安全设置变更、额外 Codex/Work 任务、子代理或 PR。完整离线 gate 同机解除执行沙箱仅用于既有 read-only spawnSync 和 WebDAV 临时 127.0.0.1 HTTP 夹具，不是远程控制监听。真实 GUI/供应商/RTX5090 验收、阅读及字典等其余接线仍待后续处理。
''')
hashes={str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.rglob('*')) if p.is_file() and p!=out/'RECORDS-SHA256.json'};(out/'RECORDS-SHA256.json').write_text(json.dumps(hashes,indent=2)+'\n');print(json.dumps({'source_commit':source['source_commit'],'evidence':str(out),'raw_records':len(raw_hashes),'public_hashes':len(hashes),'tests':validation['tests']},ensure_ascii=False,indent=2))
