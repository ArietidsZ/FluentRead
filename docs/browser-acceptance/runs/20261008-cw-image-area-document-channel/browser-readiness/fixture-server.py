import argparse
import http.server
import json
import pathlib
import time

root = pathlib.Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=18764)
args = parser.parse_args()

class Handler(http.server.BaseHTTPRequestHandler):
    def send(self, body, content_type='text/html; charset=utf-8'):
        value = body if isinstance(body, bytes) else body.encode()
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(value)))
        self.end_headers(); self.wfile.write(value)

    def do_GET(self):
        if self.path.startswith('/fixture') or self.path == '/':
            self.send((root / 'fixture.html').read_bytes())
        elif self.path.startswith('/frame'):
            self.send('<title>Synthetic child document</title><h1>Synthetic iframe</h1><p>The bird is singing.</p>')
        elif self.path.startswith('/next'):
            self.send('<title>Synthetic next document</title><h1>Synthetic next document</h1><a href="/fixture">Open fixture again</a>')
        else:
            self.send_error(404)

    def do_POST(self):
        # Model responses are controlled fixtures, not inference or provider acceptance.
        length = int(self.headers.get('Content-Length', '0'))
        if length > 5_000_000:
            self.send_error(413); return
        self.rfile.read(length)  # Never persist headers, credentials, prompt or image bytes.
        time.sleep(.15)
        self.send(json.dumps({'id': 'cw-synthetic-completion', 'object': 'chat.completion',
            'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': '受控测试译文'}, 'finish_reason': 'stop'}],
            'usage': {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0}}), 'application/json')

    def log_message(self, format, *args):
        pass

print(json.dumps({'fixture_only': True, 'bind': '127.0.0.1', 'port': args.port}), flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
