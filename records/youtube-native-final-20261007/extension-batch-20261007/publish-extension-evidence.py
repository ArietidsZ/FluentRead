import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TASK = ROOT.parent
DEST = TASK / 'FluentRead-youtube-acceptance-evidence/records/youtube-native-final-20261007/extension-batch-20261007'


def returned(tag):
    record = json.loads((ROOT / (tag + '.json')).read_text())
    for item in record.get('content', []):
        text = item.get('text', '')
        if '\nreturn: ' in text:
            return json.JSONDecoder().raw_decode(text.split('\nreturn: ', 1)[1])[0]
    raise ValueError('No actual returned value for ' + tag)


before = returned('extensions-before')['state']['value']
loaded = returned('extensions-loaded-reconnected')['state']['value']
after = returned('final-read-only-cleanup-manager')['state']['value']
integrity = json.loads((ROOT / 'build-integrity-reverified.json').read_text())
process = json.loads((ROOT / 'cleanup-process-state.local.json').read_text())
tabs = returned('owned-test-tabs-closed')
github = json.loads((ROOT / 'github-cli-readonly-diagnostic.json').read_text())
extension = loaded['extensions'][0]
assert before['extensionIds'] == [] and before['developerMode'] is False
assert extension['id'] == 'djnlaiohfaaifbibleebjggkghlmcpcj'
assert extension['version'] == '0.0.35' and extension['location'] == 'UNPACKED'
assert extension['path'].endswith('/FluentRead-youtube-remaining-combined/.output/chrome-mv3')
assert integrity['commit'] == 'bf22ae081ab5b997c088640c605fcc962f7f4bd4'
assert integrity['all_398_build_files_match_prior_verified_manifest']
assert after['developerMode'] is False
removed = extension['id'] not in after['extensionIds']
summary = {
    'execution_environment': 'CW local only; existing dedicated native Wayland Neo',
    'code_commit': '66abb72b9e5830634616099172f0b3cc9970c369',
    'build_commit': integrity['commit'],
    'build_integrity': integrity,
    'loaded_extension': extension,
    'baseline': before,
    'after': after,
    'outcomes': {
        'specified_build_loaded_via_normal_ui': 'PASS',
        'extension_name_version_path_enabled_state': 'PASS',
        'management_card_visible': 'PASS',
        'manifest_and_runtime_errors_at_load': 'NONE_REPORTED',
        'popup_native_mcp_visibility': 'BLOCKED_UNKNOWN_PAGE',
        'subtitle_fixture_provider_isolation': 'BLOCKED_NOT_ESTABLISHED',
        'actual_extension_subtitle_injection_and_translation': 'NOT_RUN',
        'real_youtube_capture': 'NOT_RUN',
        'provider_api_or_model_download_actions': 'NOT_RUN',
        'provider_network_request_count': 'NOT_MEASURED',
        'rtx5090_webgpu_and_asr': 'NOT_RUN',
        'developer_mode_restored_off': 'PASS',
        'test_extension_removed': 'PASS' if removed else 'BLOCKED_PERMISSION_SCOPE',
        'baseline_extension_set_restored': 'PASS' if removed else 'FAIL_ONE_DISABLED_TEST_EXTENSION_REMAINS',
        'owned_cua_daemons_stopped': 'PASS' if not process['owned_cua_daemon_still_present'] else 'FAIL',
        'existing_neo_kept_running': 'PASS' if process['neo_running'] else 'FAIL',
        'owned_extension_tabs_closed': 'PASS' if tabs['remainingExtensionManagerPages'] == [] and tabs['ownedPopupTargets'] == [] else 'FAIL',
    },
    'remaining_action': None if removed else {
        'target_id': extension['id'],
        'state': 'DISABLED',
        'permission_required': 'One-time Cua read and confirmation of this test extension native uninstall dialog; previous Cua scope was the system directory chooser only.',
        'risk': 'Delete only this newly loaded unpacked extension from the dedicated test profile. Do not operate another extension, page, profile, or security setting.',
        'approval_received': False,
    },
    'process_state': process,
    'owned_tabs_after': tabs,
    'github_cli_readonly_diagnostic': github,
    'claims_limit': 'Loading and management-card visibility do not establish content injection, subtitle correctness, translation, provider isolation, WebGPU, or ASR.',
}
(ROOT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
review_path = ROOT / 'cleanup-auto-review-rejection.json'
review = json.loads(review_path.read_text())
review.update(resolved_after_ownership_evidence=True, successful_retry_record='close-confirmed-test-manager-and-open-cleanup-page.json')
review_path.write_text(json.dumps(review, indent=2) + '\n')

readme = '''# Neo extension load acceptance — CW only

Build [`bf22ae08`](https://github.com/ArietidsZ/FluentRead/commit/bf22ae081ab5b997c088640c605fcc962f7f4bd4), with unchanged subtitle code [`66abb72b`](https://github.com/ArietidsZ/FluentRead/commit/66abb72b9e5830634616099172f0b3cc9970c369). All 398 Chrome build files (60,306,304 bytes) were rehashed and exactly match the earlier verified build manifest. Source SHA256 also matches. The build was not recreated or modified for this round.

The existing dedicated Neo profile loaded FluentRead 0.0.35 through the normal Developer mode / Load unpacked interface. Neo native MCP handled browser pages. Cua 0.34.0 handled only the system directory chooser with a v3 five-minute single-window manifest. An expired manifest was renewed with the same window identity and fewer tools. Background delivery was unavailable, so the already focused chooser used foreground Wayland input. No new portal permission, unsafe extension debugging flag, no-sandbox flag, or remote control port was added. This test created no additional Codex task or model call.

The management API reported the exact unpacked build path, ENABLED state, and no manifest/runtime errors at that time. [The real management-page screenshot](extension-loaded-screenshot-0.png) shows the card. This is a load/visibility result, not a claim of extension content injection or functional subtitle acceptance. Opening popup.html through Neo returned Unknown page; no corresponding extension target remained by the later read.

The existing synthetic YouTube script depends on Playwright context routing and separate MV3 worker fetch redirection to prevent all real provider traffic. Equivalent fail-closed isolation was not established through the approved native Neo MCP route. The script was read but not run. Subtitle fixture execution, translation, actual YouTube capture, provider API/model actions, WebGPU and ASR were NOT_RUN. Provider request count is NOT_MEASURED; it must not be represented as zero. See [fixture-isolation-blocker.json](fixture-isolation-blocker.json).

**Cleanup is incomplete.** Developer mode is OFF and this test extension is DISABLED, but its ID `djnlaiohfaaifbibleebjggkghlmcpcj` still exists in the dedicated profile. Normal Remove controls did not complete deletion; native-MCP management attempts timed out. A one-time native uninstall confirmation through Cua needs a scope supplement because the current authorization restricted Cua to the directory chooser. This record does not claim the original empty extension list was restored. All test manager tabs were closed, and no popup target remained; pending removal/screenshot attempts were cancelled by closing those owned pages. Existing Neo remains running, and the task-owned Cua daemons were stopped. [summary.json](summary.json) and the actual after-state bind that limit to this round. Two attempted after-state screenshots timed out; actual management reads are available, and no after-state image is fabricated.

The first request to close the test-created manager tab was rejected by automatic approval review because Neo reconnection labelled it other-agent. The initial creation record proved that it was this same test's page; a subsequent close was accepted. That approval issue was resolved with evidence, not bypassed. Browser operations remained on native Neo MCP.

## Minimal existing GitHub CLI session diagnostic

The parent added a specifically authorized, necessary read-only diagnostic in this same batch. CW already has `/usr/bin/gh`. Exactly three API reads used its existing authentication: the selected user fields and the two repository permission summaries. Account: `ArietidsZ`, ID 69024461, type User. The upstream repository reports pull=true, push=false; the fork reports pull=true, push=true, admin=true. Whitelisted response headers report scopes `gist, read:org, repo, workflow`. Token class and any unreported scope restrictions are unknown. No auth file was inspected, no token was printed/exported, no login/account change was attempted, and no PR/write probe was made. See [github-cli-readonly-diagnostic.json](github-cli-readonly-diagnostic.json).

This establishes an existing user CLI session that can read both repositories. Upstream push=false must not be interpreted as inability to submit a normal fork PR. Read success does not prove a PR write path or resolve the original connector's cross-fork 403; the parent must decide the next step within the actual PR approval scope.

All tool outputs are actual saved responses, including unsuccessful attempts. Machine path prefixes and the ephemeral tab group identifier are redacted. Native directory-chooser screenshots contain local folder names and remain private; their original SHA256 values and omission reasons are recorded in [artifact-manifest.json](artifact-manifest.json). Neo session/transport initialization and private launch metadata are excluded. No credential or auth-file body was read or published.

No source changes, credentials, daily browser profiles, browser defaults, GitHub login, permissions, PRs, merges or deployments were changed in this batch. Earlier passing module tests and builds remain separate evidence; this limited extension round does not replace those records or turn the repository-wide gates green.
'''
(ROOT / 'README.md').write_text(readme)

DEST.mkdir(parents=True, exist_ok=True)
manifest = []
replacements = [(str(TASK), '$CW_TASK_DIR'), (str(Path.home()), '$HOME'),
                ('$NEO_TEST_GROUP_ID', '$NEO_TEST_GROUP_ID')]
for path in sorted(ROOT.iterdir()):
    if not path.is_file():
        continue
    raw = path.read_bytes()
    reason = None
    if path.name.endswith('.local.json'):
        reason = 'Private process/socket/window launch metadata; normalized summary is published.'
    elif path.name == 'cua-mcp-initialize.json':
        reason = 'Transport/session initialization is not needed for public acceptance evidence.'
    elif path.suffix in ['.png', '.jpg'] and path.name.startswith('dialog-'):
        reason = 'Native chooser screenshot contains local folder names; kept private.'
    item = {'file': path.name, 'original_bytes': len(raw), 'original_sha256': hashlib.sha256(raw).hexdigest()}
    if reason:
        item.update(published=False, omission_reason=reason)
    else:
        out = raw
        if path.suffix not in ['.png', '.jpg']:
            text = raw.decode()
            for original, replacement in replacements:
                text = text.replace(original, replacement)
            out = text.encode()
            assert '$HOME' not in text
            assert not re.search(r'(?i)mcp-session-id\s*:\s*[a-z0-9._-]{12,}', text)
        (DEST / path.name).write_bytes(out)
        item.update(published=True, published_bytes=len(out), published_sha256=hashlib.sha256(out).hexdigest())
    manifest.append(item)
(DEST / 'artifact-manifest.json').write_text(json.dumps({'redactions': [{'replacement': r, 'kind': 'machine prefix or ephemeral group id'} for _, r in replacements], 'artifacts': manifest}, indent=2) + '\n')
print(json.dumps({'destination': str(DEST), 'published_files': sum(x['published'] for x in manifest) + 1, 'private_files': sum(not x['published'] for x in manifest), 'test_extension_removed': removed}))
