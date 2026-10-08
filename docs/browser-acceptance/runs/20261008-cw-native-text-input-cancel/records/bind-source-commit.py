import hashlib
import json
import pathlib
import subprocess
import sys

root = pathlib.Path(sys.argv[1]).resolve()
raw = pathlib.Path(__file__).resolve().parent
frozen = json.loads((raw / 'SOURCE-BEFORE.json').read_text())
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root).decode().strip()
tree = subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=root).decode().strip()
rows = subprocess.check_output(['git', 'ls-tree', '-rz', '-r', commit], cwd=root).split(b'\0')
blobs = {}
for row in rows:
    if not row:
        continue
    metadata, name = row.split(b'\t', 1)
    mode, kind, object_id = metadata.decode().split()
    assert kind == 'blob' and mode != '120000', (mode, kind, name)
    blobs[name.decode()] = object_id
assert set(blobs) == set(frozen), {'missing': sorted(set(frozen) - set(blobs)), 'extra': sorted(set(blobs) - set(frozen))}
ids = list(dict.fromkeys(blobs.values()))
content = subprocess.run(['git', 'cat-file', '--batch'], cwd=root,
    input=('\n'.join(ids) + '\n').encode(), stdout=subprocess.PIPE, check=True).stdout
offset = 0
hashes = {}
for object_id in ids:
    end = content.index(b'\n', offset)
    actual_id, kind, length = content[offset:end].decode().split()
    assert actual_id == object_id and kind == 'blob'
    start = end + 1
    end = start + int(length)
    hashes[object_id] = hashlib.sha256(content[start:end]).hexdigest()
    assert content[end:end + 1] == b'\n'
    offset = end + 1
assert offset == len(content)
for name, expected in frozen.items():
    assert hashes[blobs[name]] == expected, name
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected, name
record = {'source_commit': commit, 'source_tree': tree, 'input_files': len(frozen),
    'all_git_tree_paths_and_blob_sha256_match_frozen_inputs': True,
    'checkpoint_parent': '9da3fd9f01f912268cc7c919db4a804c250f62ca',
    'frozen_inputs_sha256': hashlib.sha256((raw / 'SOURCE-BEFORE.json').read_bytes()).hexdigest(),
    'artifact_hash_manifest_sha256': hashlib.sha256((raw / 'ARTIFACT-SHA256.json').read_bytes()).hexdigest()}
(raw / 'SOURCE-COMMIT.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2))
