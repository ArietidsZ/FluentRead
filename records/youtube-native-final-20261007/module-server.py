import http.server
import json
import os
from pathlib import Path

root = Path(__file__).resolve().parent
page = b'<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Subtitle pure-module acceptance</title><h1>Local subtitle module smoke</h1><script type="module" src="/browser-smoke.js"></script>'
routes = {'/revision.js': 'revision.js', '/baseline.js': 'baseline.js', '/browser-smoke.js': 'browser-smoke.js'}
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            body, kind = page, 'text/html; charset=utf-8'
        elif self.path in routes:
            body, kind = (root / routes[self.path]).read_bytes(), 'application/javascript; charset=utf-8'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
metadata = {'pid': os.getpid(), 'host': '127.0.0.1', 'port': server.server_port, 'url': f'http://127.0.0.1:{server.server_port}/'}
(root / 'module-server.local.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(json.dumps(metadata), flush=True)
server.serve_forever()
