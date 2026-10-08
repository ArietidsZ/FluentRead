import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]).resolve();raw=pathlib.Path(__file__).resolve().parent;out=root/'docs/browser-acceptance/runs/20261008-cw-writing-config-reachability';records=out/'records';records.mkdir(parents=True,exist_ok=True)
read=lambda p:json.loads(p.read_text())
source=read(raw/'SOURCE-COMMIT.json');binding=read(raw/'FINAL-BINDING.json');full=read(raw/'full-coverage.results.json');cov=read(raw/'full-coverage/coverage-summary.json');arch=read(raw/'architecture.results.json');green=read(raw/'saved-config-green.results.json');red=read(raw/'saved-config-red-final.results.json');audit=read(raw/'DEPENDENCY-AUDIT.json');scope=read(raw/'TYPECHECK-SCOPE-PROOF.json')
checks=['saved-config-green','full-coverage','architecture','typecheck','typecheck-list','audit','build-chrome','build-firefox','build-userscript','verify-extension-manifests','verify-userscript','docs-source-build','bindings-final','bind-source-commit']
assert red['numPassedTests']==3 and red['numFailedTests']==2
for r in [full,arch,green]:assert r['success'] and r['numFailedTests']==r['numPendingTests']==0
assert all(cov['total'][m]['pct']==100 for m in ['statements','branches','functions','lines'])
assert all(read(raw/(name+'.command.json'))['exit_code']==0 for name in checks)
assert binding['userscript_identical_to_dd6f2bce'] and binding['permissions_match']
writer=next(v for p,v in cov.items() if p.endswith('/src/app/background/writingRuntime.ts'))
assert all(writer[m]['pct']==100 for m in ['statements','branches','functions','lines'])
validation={**source,**binding,'withdrawn_custom_endpoint_blocker':True,'defensive_custom_key_added':False,'fixed_reachable_fields':['requireApiKey','apiKeyRecoveryMs'],'baseline_controls':{k:red[k] for k in ['numTotalTests','numPassedTests','numFailedTests']},'targeted_tests':{k:green[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']},'tests':{k:full[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']},'test_files':len(full['testResults']),'coverage':cov['total'],'changed_module_coverage':writer,'architecture_tests':arch['numPassedTests'],'architecture_files':len(arch['testResults']),'checks':{name:read(raw/(name+'.command.json'))['exit_code'] for name in checks},'typecheck_scope':scope,'fixture_boundaries':{'real_config_store_and_normalization':True,'real_writing_handler_runtime_gateway_sdk':True,'storage_and_native_browser_boundaries':'synthetic memory fixtures','fetch':'synthetic SSE and 429 only'},'initial_failures_preserved':['audit-missing-path: corrected audit command name','saved-config-baseline/saved-config-red: recovery fixture initially retained empty token / disabled rotation; not production red'],'no_gui_or_real_provider_api_run':True,'no_credentials_permissions_defaults_prompts_dependencies_changed':True,'reading_route_started':False,'pending':['reading source routing remains a separate subsequent slice','real GUI/provider API/RTX5090 WebGPU acceptance is not part of this evidence']}
if (raw/'docs-evidence-build.command.json').exists():validation['evidence_docs_build_exit_code']=read(raw/'docs-evidence-build.command.json')['exit_code'];assert validation['evidence_docs_build_exit_code']==0
replacements=[(str(root),'<WORKTREE>'),(str(raw),'<RAW>'),('<CW_DEPENDENCIES>','<CW_DEPENDENCIES>'),(str(root.parent),'<CW_TASK>'),('<CW_HOME>/','<CW_HOME>/')];raw_hashes={}
for p in sorted(raw.rglob('*')):
 if not p.is_file():continue
 name=str(p.relative_to(raw));data=p.read_bytes();raw_hashes[name]=hashlib.sha256(data).hexdigest();content=data.decode()
 for original,placeholder in replacements:content=content.replace(original,placeholder)
 content='\n'.join(line.rstrip() for line in content.splitlines()).rstrip('\n')+'\n';dst=records/name;dst.parent.mkdir(parents=True,exist_ok=True);dst.write_text(content)
validation['published_record_files']=len(raw_hashes);(out/'VALIDATION.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n');(out/'RAW-RECORDS-SHA256.json').write_text(json.dumps(raw_hashes,indent=2)+'\n')
(out/'README.md').write_text(f'''# CW 写作配置取消：真实保存可达性复核

源码 **`{source['source_commit']}`**，tree **`{source['source_tree']}`**；此前 HEAD **`99d982b8539c76b2d50aeb10ee29f8abbc9c7677`**，此前应用源码 **`dd6f2bce476de15f1c6d0a8bfa447568d1c89798`**。本批只处理写作取消策略，**未开始阅读路由切片**。

明确撤回 `configurationKey` 缺少 `next.custom` 就构成生产端点变更遗漏的判断。真实 config store 初始化和每次保存、订阅通知都会 normalize：legacy custom 的空 provider.endpoint 会由 custom 补入 customOpenAIProviders。真实保存单改 custom 而保留已补齐 endpoint 时，有效端点保持旧值，延迟 SDK 请求有效完成；将空 endpoint 和新 custom 一起提交时，save 与 patch 都补齐新 provider.endpoint，已有取消键取消一次旧请求并抑制迟到正文，下一次实际 SDK wire 使用新端点。本批没有用裸 Object.assign 制造生产红测，也没有增加防御性 custom 取消字段。轮询 scope 另读 legacy custom 兼容字段，这不等于有效端点变化。

实际复现并仅修复两个可达取消遗漏：`requireApiKey` 的真实 patch 使当前私密模型无凭据时变为 not ready，原先仍继续在途生成；`apiKeyRecoveryMs` 的真实 patch 改变恢复策略，原先仍继续多 Key 生成。后者运行实际 modelGateway、轮询和 SDK，合成 429 触发第二个 Key，并延迟第二次 fetch；非替换 spy 核验旧恢复时间确实进入轮询。两项字段仅加入已有写作 configurationKey，保留冻结模型与端点、handler 单次完成和取消信号边界；取消后迟到 SSE 不产生正文 progress 或第二个 result。未改 normalize、保存流程、提示词、路由、权限、凭据、默认设置或依赖。

静态决策依赖核对见 `records/DEPENDENCY-AUDIT.json`。其他有效端点、模型、凭据和已有私密校验字段已在取消键中；serviceRegion 经 normalize 仅保留三个机器翻译服务，均被 Harness 拒绝，未增加不可达 writer 字段。requestHeaderRules 不由本 modelGateway/runtimeFetch 读取，浏览器 DNR 是另一个边界；本批不宣称对它进行了真实浏览器网络策略验收。

固定 baseline 与红测 fixture SHA256 见 `records/BASE-SOURCE-BINDING.json`。最终修正夹具后的基线 **5 测试：3 个 custom 控制通过、2 个策略取消预期失败**；`records/red-fixture.ts` 与 baseline-writingRuntime.ts 保留。早期恢复夹具的空 token 清除 Key 池和未显式开启轮询，以及一次审计命令路径错误，其原始日志也保留，明确不算生产红测。修复后五文件针对性 **{green['numPassedTests']}/{green['numTotalTests']}**。

完整严格检查 **{full['numPassedTests']:,}/{full['numTotalTests']:,}**，**{len(full['testResults'])} 文件**，零失败/零跳过。statements/lines **{cov['total']['lines']['covered']:,}/{cov['total']['lines']['total']:,}**、functions **{cov['total']['functions']['covered']:,}/{cov['total']['functions']['total']:,}**、branches **{cov['total']['branches']['covered']:,}/{cov['total']['branches']['total']:,}**，全部四维 **100%**；唯一改动的可执行模块 writingRuntime 四维也全部 100%。架构 **{arch['numPassedTests']:,}/{arch['numTotalTests']:,}**、32 文件。类型、审计、Chrome/Firefox/userscript 构建、manifest/userscript verifier 和文档构建全部通过；编译输入覆盖所有 **799 src、497 tests、15 entrypoint** TS/Vue 文件，tsconfig 和原有档案排除未改。

冻结 **{source['input_files']:,}** 个源码/测试/配置/文档输入，明确排除旧验收档案；对应 Git tree 路径和每个 blob SHA256 全匹配。绑定 **{binding['artifacts']}** 个产物 SHA256。userscript **{binding['userscript_bytes']:,} bytes**，1,955,000 bytes 上限不变，与 dd6f2bce/469ce199/ed89 字节一致。权限、Chrome spanning、Firefox 140.0 最低版本、历史验收记录、依赖锁和现有发布版本未改。

所有 command/UTC 时间/耗时/退出码、stdout/stderr、JSON、覆盖率、源码/产物和权限绑定均在 records。公开副本仅替换 CW 绝对路径并清除行尾/末尾空白，原始和公开 SHA256 分别记录。只在 CW 本地执行，没有真实搜索/模型 API、GUI、GPU、系统部署、安全设置变更、日常浏览器/profile 操作、额外 Codex/Work 任务、子代理或 PR；测试凭据仅为内存合成 sentinels，未读改实际凭据。完整离线 gate 解除执行沙箱仅用于既有只读 spawnSync 和临时 127.0.0.1 WebDAV 夹具。此为离线真实代码链路证据，不代表部署或真实浏览器/供应商/RTX5090 验收通过。
''')
hashes={str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.rglob('*')) if p.is_file() and p!=out/'RECORDS-SHA256.json'};(out/'RECORDS-SHA256.json').write_text(json.dumps(hashes,indent=2)+'\n');print(json.dumps({'source_commit':source['source_commit'],'evidence':str(out),'raw_records':len(raw_hashes),'public_hashes':len(hashes),'tests':validation['tests']},ensure_ascii=False,indent=2))
