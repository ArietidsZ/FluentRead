import subprocess, os, json, sys, base64
from pathlib import Path

root = Path(__file__).parent
env = os.environ.copy()
env.update(CUA_DRIVER_RS_ENABLE_WAYLAND='1', CUA_DRIVER_RS_TELEMETRY_ENABLED='0', CUA_TELEMETRY_ENABLED='0')
sock = json.loads((root / 'cua-cleanup-launch.local.json').read_text())['socket']
log = (root / 'cua-cleanup-proxy.stderr').open('wb')
proc = subprocess.Popen([str(Path.home() / '.local/bin/cua-driver'), 'mcp', '--socket', sock],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True, env=env)
counter = 0
def rpc(method, params=None):
    global counter
    counter += 1
    payload = dict(jsonrpc='2.0', id=counter, method=method)
    if params is not None:
        payload['params'] = params
    proc.stdin.write(json.dumps(payload) + '\n'); proc.stdin.flush()
    while True:
        line = proc.stdout.readline()
        if not line:
            raise RuntimeError('Cua MCP closed')
        value = json.loads(line)
        if value.get('id') == counter:
            return value

init = rpc('initialize', dict(protocolVersion='2025-06-18', capabilities={}, clientInfo=dict(name='cw-fluentread-cleanup', version='1')))
(root / 'cua-cleanup-mcp-initialize.local.json').write_text(json.dumps(init, indent=2))
proc.stdin.write(json.dumps(dict(jsonrpc='2.0',method='notifications/initialized'))+'\n'); proc.stdin.flush()
print('CUA_SESSION_READY', flush=True)
try:
    for line in sys.stdin:
        command = json.loads(line)
        if command.get('stop'):
            break
        tag = command.pop('tag')
        result = rpc('tools/call', command)
        for i, block in enumerate(result.get('result', {}).get('content', [])):
            if block.get('type') == 'image':
                suffix = '.png' if block.get('mimeType') == 'image/png' else '.jpg'
                image = root / (tag + '-' + str(i) + suffix)
                image.write_bytes(base64.b64decode(block.pop('data')))
                block['saved_path'] = str(image)
        (root / (tag + '.json')).write_text(json.dumps(result, indent=2))
        body = result.get('result', {})
        structured = body.get('structuredContent')
        texts = [b.get('text','')[:5000] for b in body.get('content',[]) if b.get('type')=='text']
        print(json.dumps(dict(tag=tag, isError=body.get('isError'), structured=structured,
                             text=texts, images=[b.get('saved_path') for b in body.get('content',[]) if b.get('type')=='image']))[:9000], flush=True)
finally:
    proc.stdin.close()
    try: proc.wait(timeout=5)
    except subprocess.TimeoutExpired: proc.terminate()
    log.close()
