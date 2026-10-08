import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]).resolve();raw=pathlib.Path(__file__).resolve().parent;out=root/'docs/browser-acceptance/runs/20261008-cw-reader-private-route';records=out/'records';records.mkdir(parents=True,exist_ok=True)
read=lambda p:json.loads(p.read_text())
source=read(raw/'SOURCE-COMMIT.json');binding=read(raw/'FINAL-BINDING.json');full=read(raw/'full-coverage-final.results.json');cov=read(raw/'full-coverage-final/coverage-summary.json');arch=read(raw/'architecture-final.results.json');target=read(raw/'reader-route-coverage-final.results.json');localcov=read(raw/'targeted-coverage-final/coverage-summary.json');red=read(raw/'reader-route-red.results.json');scope=read(raw/'TYPECHECK-SCOPE-PROOF.json')
checks=['reader-route-coverage-final','full-coverage-final','architecture-final','typecheck-complete','typecheck-list','audit-final','build-chrome','build-firefox','build-userscript','verify-extension-manifests','verify-userscript','docs-source-build','bindings-final','bind-source-commit']
assert red['numPassedTests']==6 and red['numFailedTests']==23
for r in [full,arch,target]:assert r['success'] and r['numFailedTests']==r['numPendingTests']==0
for c in [cov,localcov]:assert all(c['total'][m]['pct']==100 for m in ['statements','branches','functions','lines'])
assert all(read(raw/(name+'.command.json'))['exit_code']==0 for name in checks)
assert binding['userscript_identical_to_7fb7fc44'] and binding['permissions_match']
modules={p.split('/src/')[1]:v for p,v in localcov.items() if '/src/' in p};assert len(modules)==3
assert all(v[m]['pct']==100 for v in modules.values() for m in ['statements','branches','functions','lines'])
remaining=['dictionary and word-card source route','image/manga, area OCR/vision transcription and vision capability probe source route','remaining video/document source routes and cache audit','real GUI/provider API/RTX5090 acceptance']
validation={**source,**binding,'implemented_slice':'reading native Port and typed Harness entry → actual conversation/runtime/modelGateway/SDK private model routing','baseline_red':{k:red[k] for k in ['numTotalTests','numPassedTests','numFailedTests']},'final_private_entry_cases':37,'targeted_tests':{k:target[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']},'tests':{k:full[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']},'test_files':len(full['testResults']),'coverage':cov['total'],'changed_modules_coverage':modules,'architecture_tests':arch['numPassedTests'],'architecture_files':len(arch['testResults']),'checks':{name:read(raw/(name+'.command.json'))['exit_code'] for name in checks},'typecheck_scope':scope,'unchanged_port_conversation_gateway_writing':True,'reading_prompt_and_generation_blocks_byte_identical':True,'no_defensive_custom_key_added':True,'fixture_boundaries':{'real_config_store_normalization_save_patch_subscriber':True,'real_native_handler_conversation_runtime_gateway_sdk':True,'real_session_repository':'actual HarnessSessionRepository; isolated fake-indexeddb boundary','browser_config_storage_memory_usage_fetch':'synthetic boundary ports'},'earlier_failures_preserved':['initial baseline both-empty control reused completed request ID; fixed before final red binding','initial composition test expected synchronous untagged string call; updated to await tagged ReadingRequest','test type failures: unused router then typed message literal; fixed with ReadingRequest assertion only and byte-identical emitted JS proof'],'initial_full_gate_repeated_reason':'final source/test input binding after type-only test repair; not for status reporting','no_gui_or_real_provider_api_run':True,'no_credentials_permissions_defaults_dependencies_or_prompts_changed':True,'remaining':remaining,'privacy_feature_complete':False}
if (raw/'docs-evidence-build.command.json').exists():validation['evidence_docs_build_exit_code']=read(raw/'docs-evidence-build.command.json')['exit_code'];assert validation['evidence_docs_build_exit_code']==0
replacements=[(str(root),'<WORKTREE>'),(str(raw),'<RAW>'),('<CW_DEPENDENCIES>','<CW_DEPENDENCIES>'),(str(root.parent),'<CW_TASK>'),('<CW_HOME>/','<CW_HOME>/')];hashes={}
for p in sorted(raw.rglob('*')):
 if not p.is_file():continue
 name=str(p.relative_to(raw));data=p.read_bytes();hashes[name]=hashlib.sha256(data).hexdigest();content=data.decode()
 for original,placeholder in replacements:content=content.replace(original,placeholder)
 content='\n'.join(line.rstrip() for line in content.splitlines()).rstrip('\n')+'\n';dst=records/name;dst.parent.mkdir(parents=True,exist_ok=True);dst.write_text(content)
validation['published_record_files']=len(hashes);(out/'VALIDATION.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n');(out/'RAW-RECORDS-SHA256.json').write_text(json.dumps(hashes,indent=2)+'\n')
(out/'README.md').write_text(f'''# CW 阅读入口：原生来源与私密模型路由

源码 **`{source['source_commit']}`**，tree **`{source['source_tree']}`**；此前 HEAD **`fc99d1fa8b4c3cb143f2c53bc51527a3802f6ed2`**，此前应用源码 **`7fb7fc44f5ebb36ffaf531b07a277c63caea3415`**。本批仅闭合阅读助手的原生流式 Port 和 typed Harness 消息入口，不代表隐私功能整体完成。字典、单词卡、图片/漫画、圈选 OCR/视觉转录、视觉探测以及其余视频/文档入口的来源、专用路由与缓存审计仍未完成。

生产源码只改三个阅读后台模块。handler 在首个 await 前复制并冻结通过原生 tab/id 验证的 sender/tab；应用层使用已审查的三态解析器和可取消准备等待，在 conversation 会话读写前拒绝配置了专用对的 unknown，并附着不能从前端 JSON 构造的来源 symbol。该标记沿已有 restoredRequest 对象展开保留。阅读入口原有 native tab.id 边界不变，没有用 URL、活动窗口、前端 private/incognito boolean 或前端 service/model 提升来源。

阅读 runtime 在 Harness/modelGateway 创建前校验当前配置和完整复制的配置快照。private 选择目录与会话能力有效的专用 provider/model，覆盖本次 harness 的这两个字段并附着既有内部模型锁；机器翻译、本地翻译与 Qwen MT 等非会话模型、失效模型及高级请求体模型冲突失败关闭，不回退普通模型。regular 保持独立或继承的原阅读对，两字段均空保留旧选模和原生私密记忆/会话边界。旧 privateContext 存储 boolean 不能替代来源证据。

原阅读 prompt 和 generate 函数块与 7fb7fc44 字节一致，SHA256 在 `records/UNCHANGED-CONTRACTS.json`。选中文本、授权段落、上下文裁剪、学习动作、实际 read_context 工具循环及未保存的真实追问语义保留。private 不读写本机会话或学习记忆；实际 SDK 两 Key 合成 429 重试保持专用 model 与 endpoint，网关已有锁拒绝普通模型替换。既有 Port、conversation、modelGateway、写作、配置 normalizer/store、依赖锁、默认配置与发布版本源码全未改。

生成取消键复用已审查写作的实际模型、端点、目录、凭据、请求头/体和轮询策略字段，并保留原 Harness 偏好取消。真实 normalize/save/patch/subscriber 中的变更取消 active SDK 请求，抑制迟到 progress/result。已有关闭、导航、标签移除与停用仍走原 Port/handler 信号；普通会话按原规则保留已经收到的部分回答为 stopped，迟到 SSE 不会修改旧会话或页面。会话验证使用实际 HarnessSessionRepository 与隔离 fake-indexeddb，未替换仓库方法。

legacy custom 控制沿真实保存入口验证：已有归一化 provider.endpoint 时，只改兼容 custom 不改变有效端点，旧请求合法完成；空 endpoint 与新 custom 一起保存时，provider.endpoint 归一化为新值，已有 provider 取消键阻止旧生成。没有用裸 Object.assign 制造缺陷，也没有增加防御性 custom 字段。轮询 scope 另读兼容 custom，不将其等同于有效端点变化。serviceRegion 归一化后只保留三个机器翻译服务，不能进入 Harness；requestHeaderRules 属于独立浏览器 DNR 边界，本批不宣称对其做了真实网络策略验收。依赖核对详见 `records/DEPENDENCY-AUDIT.json`。

固定 red fixture 和基线 Git blob SHA256 见 `records/BASE-SOURCE-BINDING.json`：**29 案例，6 个旧行为控制通过、23 个专用路由或取消预期失败**。初始 both-empty 控制重复了已完成 requestId，修正后再绑定最终红测。最终新增真实入口文件 **37 案例**；七文件针对性 **{target['numPassedTests']}/{target['numTotalTests']}**，三个改动模块 statements/branches/functions/lines 均 **100%**。旧 composition 测试的同步无标记字符串预期已改为等待内部标记请求；两轮测试类型失败保留，最终 ReadingRequest 断言的 emitted JavaScript 与之前一致，并在最终输入冻结后重跑完整 gate。此重跑用于最终源码绑定，没有为进度报告重复执行门禁。

最终完整严格检查 **{full['numPassedTests']:,}/{full['numTotalTests']:,}**，**{len(full['testResults'])} 文件**，零失败/零跳过。statements/lines **{cov['total']['lines']['covered']:,}/{cov['total']['lines']['total']:,}**、functions **{cov['total']['functions']['covered']:,}/{cov['total']['functions']['total']:,}**、branches **{cov['total']['branches']['covered']:,}/{cov['total']['branches']['total']:,}**，全部四维 **100%**。架构 **{arch['numPassedTests']:,}/{arch['numTotalTests']:,}**、32 文件；最终类型、审计、Chrome/Firefox/userscript 构建、两个 verifier、文档构建通过。类型输入含全部 **799 src、498 tests、15 entrypoint** TS/Vue，tsconfig 与原有验收档案排除未改。

冻结 **{source['input_files']:,}** 个源码/测试/配置/文档输入，明确排除历史 browser acceptance run 数据；与提交的全部 Git tree 路径和每个 blob SHA256 一致。绑定 **{binding['artifacts']}** 个产物 SHA256。userscript **{binding['userscript_bytes']:,} bytes**，原 1,955,000 bytes 门槛未改；userscript 和 Chrome/Firefox manifest 与 7fb7fc44 字节一致，userscript 亦与 dd6f2bce/469ce199/ed89 一致。权限、Chrome spanning、Firefox 140.0 最低版本不变，历史验收证据未改。

全部 command/UTC 时间/耗时/退出码、stdout/stderr、红测输入、JSON、严格覆盖率、源码/产物/权限和类型绑定在 records。公开副本只替换 CW 绝对路径并清除行尾/末尾空白，原始与公开 SHA256 分别保存。仅 CW 本地，不用云或 MII，不读改用户配置/凭据，不调用真实搜索/模型 API、GUI 或 GPU，不安装依赖或部署程序，不新增权限、MCP 访问、安全设置、后台服务、额外 Codex/Work 任务、子代理或 PR。完整 gate 同机解除执行沙箱仅用于既有只读 spawnSync 与临时 127.0.0.1 WebDAV 夹具，不是远程控制。此为离线真实代码链路验收，不是部署、真实浏览器/供应商或 RTX5090 实测通过。
''')
public={str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.rglob('*')) if p.is_file() and p!=out/'RECORDS-SHA256.json'};(out/'RECORDS-SHA256.json').write_text(json.dumps(public,indent=2)+'\n');print(json.dumps({'source_commit':source['source_commit'],'evidence':str(out),'raw_records':len(hashes),'public_hashes':len(public),'tests':validation['tests']},ensure_ascii=False,indent=2))
