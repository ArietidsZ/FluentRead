import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TASK = ROOT.parent
DEST = TASK / 'FluentRead-youtube-acceptance-evidence/records/youtube-native-final-20261007/extension-cleanup-completion-20261007'


def returned(tag):
    record = json.loads((ROOT / (tag + '.json')).read_text())
    for item in record['content']:
        text = item.get('text', '')
        if '\nreturn: ' in text:
            return json.JSONDecoder().raw_decode(text.split('\nreturn: ', 1)[1])[0]
    raise ValueError(tag)


before = returned('cleanup-manager-open')['state']['value']
after = returned('cleanup-extensions-after')['state']['value']
tabs = returned('cleanup-owned-manager-closed')
process = json.loads((ROOT / 'cleanup-final-process-state.local.json').read_text())
assert len(before['extensions']) == 1
test = before['extensions'][0]
assert test['id'] == 'djnlaiohfaaifbibleebjggkghlmcpcj' and test['state'] == 'DISABLED'
assert test['location'] == 'UNPACKED' and test['version'] == '0.0.35'
assert test['path'].endswith('/FluentRead-youtube-remaining-combined/.output/chrome-mv3')
assert after == {'developerMode': False, 'extensionIds': [], 'fluentRead': []}
assert tabs['remainingExtensionManagerPages'] == [] and tabs['testExtensionTargets'] == []
assert process['neo_running'] and process['dedicated_profile'] and process['native_wayland']
assert not process['owned_cleanup_cua_daemon_still_present'] and not process['owned_cleanup_socket_present']
assert not process['unsafe_extension_debugging_flag'] and not process['no_sandbox_flag']
summary = {
    'environment': 'CW local; same existing dedicated Neo profile',
    'build_commit': 'bf22ae081ab5b997c088640c605fcc962f7f4bd4',
    'subtitle_code_commit': '66abb72b9e5830634616099172f0b3cc9970c369',
    'prior_record_commit': '0f4d4bd8a55d181993a7e42e562927b744e1e2b3',
    'authorization_resolution': 'Parent clarified that original GUI-only Cua authorization includes approved extension management and cleanup. No additional approval was needed.',
    'before': before,
    'after': after,
    'tabs_after': tabs,
    'process_after': process,
    'result': 'CLEANUP_PASS',
    'verified': {'test_extension_removed': True, 'baseline_empty_extension_list_restored': True, 'developer_mode_off': True, 'native_confirmation_dismissed': True, 'owned_manager_closed': True, 'owned_cua_stopped': True, 'owned_socket_removed': True, 'existing_neo_kept_running': True},
    'gui_actions': {'tool': 'Cua get_window_state/click only', 'windows': 1, 'confirmation_clicks': 1, 'target': test['id'], 'native_before_and_after_images_inspected': True},
    'correction_to_prior_report': 'Closing the test tabs did not remove the native uninstall confirmation; it remained visible on the main Neo window. The one actual GUI confirmation in this continuation completed deletion.',
    'functional_acceptance': 'BLOCKED_PROVIDER_ISOLATION_NOT_ESTABLISHED; no subtitle/provider/GPU/ASR tests added',
    'provider_request_count': 'NOT_MEASURED',
    'github_cli_diagnostic': 'Earlier three authorized read-only requests retained; no repeat, no auth changes, no PR write.',
    'quality_fixes': 'No code changes or repeated tests in this continuation.',
}
(ROOT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
(ROOT / 'README.md').write_text('''# Native extension cleanup completion — CW

The parent clarified that the original desktop GUI-only Cua authorization covers the already approved extension management and cleanup operations. The earlier report interpreted that scope too narrowly; an additional approval was not required. This continuation did not enable an unsafe debugging flag, bypass policy, or alter other security settings.

Native Neo MCP reopened the management page and verified exactly one disabled unpacked FluentRead 0.0.35 extension, ID `djnlaiohfaaifbibleebjggkghlmcpcj`, from the approved `bf22ae08` build. A five-minute v3 Cua manifest allowed only state reads and clicks for the already verified Neo window. The actual window screenshot showed a native Remove FluentRead confirmation still present, even though the prior test tabs had closed. This corrects the earlier claim that closing those tabs cancelled the native confirmation.

One capture-bound foreground GUI click confirmed Remove. [Native before](cleanup-browser-initial-state-1.png) and [native after](cleanup-native-dialog-after-2.png) images were inspected and show the approved confirmation disappearing. The click response alone reported its effect unverifiable; actual success is established by the subsequent Neo management read: developerMode=false, extensionIds=[], fluentRead=[]. [The real Neo after screenshot](cleanup-manager-after-screenshot-0.png) also shows the empty management page and developer mode OFF.

**Cleanup PASS.** The baseline empty extension set is restored, the test manager tab is closed, no test extension targets remain, and the task-owned Cua process and stale Unix socket were removed. Existing Neo remains running with its dedicated profile and native Wayland. Actual raw tool responses and normalized final process state are bound in [summary.json](summary.json).

The earlier load/visibility result remains limited: subtitle extension injection and translation did not run because provider isolation was not established on the approved native-MCP route. Provider request count is NOT_MEASURED. No provider/model API, real YouTube capture, WebGPU or ASR run was added. The existing three-read `gh` diagnostic was not repeated; no credentials/auth-file bodies, account changes or PR writes occurred. The five quality fixes and their tests were not changed or rerun.

This append-only completion record supersedes the previous cleanup blocker while preserving the earlier attempt logs at commit `0f4d4bd8`. It does not convert the functional acceptance or repository-wide test gates into passes. Machine prefixes are redacted; private launch and transport metadata are excluded. The native images show only this dedicated empty test window and the approved extension name, with no auth or local-folder data. Original and published hashes are listed in [artifact-manifest.json](artifact-manifest.json).
''')

DEST.mkdir(parents=True, exist_ok=True)
artifacts = []
for path in sorted(ROOT.iterdir()):
    if not path.is_file():
        continue
    raw = path.read_bytes()
    item = {'file': path.name, 'original_bytes': len(raw), 'original_sha256': hashlib.sha256(raw).hexdigest()}
    if path.name.endswith('.local.json'):
        item.update(published=False, omission_reason='Private launch/process/transport metadata; normalized final summary is published.')
    else:
        out = raw
        if path.suffix not in ['.png', '.jpg']:
            text = raw.decode().replace(str(TASK), '$CW_TASK_DIR').replace(str(Path.home()), '$HOME')
            assert '$HOME' not in text
            assert not re.search(r'(?i)(mcp-session-id\s*:\s*[a-z0-9._-]{12,}|authorization\s*:\s*bearer\s+\S+|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,})', text)
            out = text.encode()
        (DEST / path.name).write_bytes(out)
        item.update(published=True, published_bytes=len(out), published_sha256=hashlib.sha256(out).hexdigest())
    artifacts.append(item)
(DEST / 'artifact-manifest.json').write_text(json.dumps({'redactions': ['$CW_TASK_DIR', '$HOME'], 'artifacts': artifacts}, indent=2) + '\n')
print(json.dumps({'published_files': sum(x['published'] for x in artifacts) + 1, 'private_artifacts_excluded': sum(not x['published'] for x in artifacts), 'cleanup': 'PASS'}))
