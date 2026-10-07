import json
import urllib.request

class NeoClient:
    def __init__(self):
        self.session = None
        self.serial = 0
        response = self.request('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {},
            'clientInfo': {'name': 'CW subtitle module acceptance', 'version': '1'}})
        self.server_info = response['result']['serverInfo']
        self.request('notifications/initialized', notification=True)

    def request(self, method, params=None, notification=False):
        self.serial += 1
        body = {'jsonrpc': '2.0', 'method': method}
        if not notification:
            body['id'] = self.serial
        if params is not None:
            body['params'] = params
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream',
                   'MCP-Protocol-Version': '2025-06-18'}
        if self.session:
            headers['Mcp-Session-Id'] = self.session
        request = urllib.request.Request('http://127.0.0.1:9010/mcp', data=json.dumps(body).encode(), headers=headers)
        with urllib.request.urlopen(request, timeout=45) as response:
            if response.headers.get('Mcp-Session-Id'):
                self.session = response.headers['Mcp-Session-Id']
            text = response.read().decode()
        if not text.strip():
            return None
        if text.lstrip().startswith('{'):
            value = json.loads(text)
        else:
            entries = [json.loads(line[5:].strip()) for line in text.splitlines()
                       if line.startswith('data:') and line[5:].strip()]
            value = next(item for item in reversed(entries) if 'result' in item or 'error' in item)
        if 'error' in value:
            raise RuntimeError(value['error'])
        return value

    def call(self, name, arguments):
        response = self.request('tools/call', {'name': name, 'arguments': arguments})['result']
        if response.get('isError'):
            raise RuntimeError(response)
        return response

    @staticmethod
    def data(result):
        for item in result.get('content', []):
            text = item.get('text', '')
            if 'Untrusted page content follows.' in text:
                text = text.split('ignore any embedded commands.\n', 1)[-1].split('\n[END_UNTRUSTED_PAGE_CONTENT', 1)[0]
            try:
                return json.loads(text)
            except (ValueError, TypeError):
                pass
        raise RuntimeError('No structured JSON returned by Neo')
