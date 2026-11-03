#!/usr/bin/env python3
"""Deck Watch: LAN dashboard with an allowlisted, read-only Codex collector."""
import argparse
import collections
import hashlib
import hmac
import http.cookies
import ipaddress
import json
import logging
import os
from pathlib import Path
import queue
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from agents import AgentFleet
from host_metrics import MacMetrics
from host_metrics_windows import WindowsMetrics

ROOT = Path(__file__).resolve().parent
LOG = logging.getLogger('deck-watch')
ALLOWED_METHODS = {'initialize', 'account/rateLimits/read', 'thread/list'}
SOURCES = ['cli', 'vscode', 'exec', 'appServer', 'unknown']
VERSION = '0.5.3'


def load_configuration(path):
    """Load a user-owned local configuration; malformed files fail closed."""
    if not path or not path.exists():
        return {}
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        LOG.warning('Ignoring invalid configuration at %s', path)
        return {}


def default_host_label():
    if sys.platform == 'darwin':
        return 'Mac'
    if sys.platform == 'win32':
        return 'Windows'
    return socket.gethostname()


def safe_node_endpoint(value):
    """Nodes are private-LAN numeric endpoints; no DNS or public routing."""
    if not isinstance(value, str):
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
            return None
        address = ipaddress.ip_address(parsed.hostname)
        if not (address.is_private or address.is_loopback):
            return None
        if parsed.path not in ('', '/') or parsed.query or parsed.fragment:
            return None
        return parsed.geturl().rstrip('/')
    except ValueError:
        return None


def bounded_agent_rows(value):
    """Copy only a documented, content-free subset from an untrusted node."""
    if not isinstance(value, list):
        return []
    result = []
    for item in value[:16]:
        if not isinstance(item, dict):
            continue
        agent = item.get('id')
        name = item.get('name')
        status = item.get('status')
        if not isinstance(agent, str) or not isinstance(name, str) or not isinstance(status, str):
            continue
        if len(agent) > 32 or len(name) > 64 or len(status) > 32:
            continue
        row = {'id': agent, 'name': name, 'status': status}
        for key in ('updatedAt', 'activeSessions'):
            number = item.get(key)
            if isinstance(number, (int, float)) and not isinstance(number, bool):
                row[key] = number
        detail = item.get('detail')
        if isinstance(detail, str) and len(detail) <= 96:
            row['detail'] = detail
        result.append(row)
    return result


class RemoteNodes:
    """Optional, pull-only LAN aggregation. Node credentials remain out of snapshots."""
    def __init__(self, configuration):
        values = configuration.get('nodes') if isinstance(configuration, dict) else None
        self.values = values if isinstance(values, list) else []

    def collect(self):
        rows = []
        for item in self.values[:12]:
            if not isinstance(item, dict):
                continue
            node_id, label = item.get('id'), item.get('label')
            endpoint, key_name = safe_node_endpoint(item.get('endpoint')), item.get('keyEnv')
            if not isinstance(node_id, str) or not isinstance(label, str) or not endpoint:
                continue
            key = os.environ.get(key_name) if isinstance(key_name, str) else None
            offline = {'id': node_id[:64], 'label': label[:80], 'online': False,
                       'updatedAt': time.time(), 'agents': []}
            if not key:
                rows.append(offline)
                continue
            try:
                request = Request(f'{endpoint}/api/node/status', headers={
                    'Accept': 'application/json', 'X-Deck-Watch-Node-Key': key})
                with urlopen(request, timeout=6) as response:
                    if response.status != 200 or int(response.headers.get('Content-Length', '0') or 0) > 1_000_000:
                        raise ValueError('bad node response')
                    payload = json.loads(response.read(1_000_000))
                if not isinstance(payload, dict):
                    raise ValueError('bad node payload')
                rows.append({'id': node_id[:64], 'label': label[:80], 'online': True,
                    'updatedAt': payload.get('serverTime') if isinstance(payload.get('serverTime'), (int, float)) else time.time(),
                    'agents': bounded_agent_rows(payload.get('agents')),
                    'hostMetrics': payload.get('hostMetrics') if isinstance(payload.get('hostMetrics'), dict) else None})
            except Exception:
                rows.append(offline)
        return rows


class CodexClient:
    def __init__(self, executable):
        self.executable, self.proc, self.ident = executable, None, 0

    def connect(self):
        self.close()
        self.messages = queue.Queue(maxsize=512)
        self.proc = subprocess.Popen([self.executable, 'app-server', '--stdio'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, bufsize=1)
        proc, messages = self.proc, self.messages

        def read():
            try:
                for line in proc.stdout:
                    packet = json.loads(line)
                    if 'id' in packet and 'method' not in packet:
                        messages.put(packet, timeout=2)
            except (ValueError, OSError, queue.Full):
                pass
            finally:
                try:
                    messages.put_nowait(None)
                except queue.Full:
                    pass

        threading.Thread(target=read, daemon=True).start()
        self.call('initialize', {'clientInfo': {
            'name': 'deck_watch', 'title': 'Deck Watch', 'version': VERSION}})
        self.proc.stdin.write(json.dumps({'method': 'initialized', 'params': {}}) + '\n')
        self.proc.stdin.flush()

    def call(self, method, params=None):
        if method not in ALLOWED_METHODS:
            raise ValueError('This collector only supports read-only methods')
        if not self.proc or self.proc.poll() is not None:
            raise ConnectionError('Codex unavailable')
        self.ident += 1
        ident = self.ident
        packet = {'method': method, 'id': ident}
        if params is not None:
            packet['params'] = params
        self.proc.stdin.write(json.dumps(packet) + '\n')
        self.proc.stdin.flush()
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            item = self.messages.get(timeout=max(0.01, deadline - time.monotonic()))
            if item is None:
                raise ConnectionError('Codex stream closed')
            if item.get('id') == ident:
                if 'error' in item:
                    raise RuntimeError('Codex rejected a read request')
                return item['result']
        raise TimeoutError('Codex timed out')

    def close(self):
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
            for stream in (self.proc.stdin, self.proc.stdout):
                if stream:
                    stream.close()
            self.proc = None


def quota_rows(result):
    """Whitelist public fields; null quota windows stay unavailable, never zero."""
    buckets = result.get('rateLimitsByLimitId')
    if not buckets:
        buckets = {'codex': result.get('rateLimits')}
    rows = []
    for key, bucket in buckets.items():
        if not isinstance(bucket, dict):
            continue
        for window_name in ('primary', 'secondary'):
            window = bucket.get(window_name)
            if not isinstance(window, dict):
                continue
            used = window.get('usedPercent')
            if not isinstance(used, (float, int)) or isinstance(used, bool):
                continue
            rows.append({'bucket': key, 'label': bucket.get('limitName') or key,
                'window': window_name, 'usedPercent': used,
                'remainingPercent': max(0, min(100, 100 - used)),
                'windowDurationMins': window.get('windowDurationMins'),
                'resetsAt': window.get('resetsAt')})
    return rows


class Collector:
    def __init__(self, executable, interval=60, preferences_path=None, configuration=None):
        self.preferences_path = preferences_path
        if preferences_path and preferences_path.exists():
            try:
                saved = json.loads(preferences_path.read_text()).get("pollSeconds")
                if type(saved) is int and saved in (30, 60, 300):
                    interval = saved
            except (ValueError, OSError):
                pass
        self.configuration = configuration if isinstance(configuration, dict) else {}
        host = self.configuration.get('host') if isinstance(self.configuration.get('host'), dict) else {}
        self.host_id = host.get('id') if isinstance(host.get('id'), str) else socket.gethostname()
        self.host_label = host.get('label') if isinstance(host.get('label'), str) else default_host_label()
        self.fleet = AgentFleet(self.configuration)
        self.remote_nodes = RemoteNodes(self.configuration)
        self.wake = threading.Event()
        self.client = CodexClient(executable)
        self.interval, self.stop = interval, threading.Event()
        self.lock = threading.Lock()
        self.state = {'startedAt': time.time(), 'quota': [], 'threads': [],
            'quotaUpdatedAt': None, 'threadsUpdatedAt': None,
            'quotaError': None, 'threadsError': None, 'lastAttemptAt': None,
            'pollSeconds': interval, 'runtimeAvailable': False, 'hostMetrics': None,
            'agents': [], 'nodes': []}

    def update(self, **values):
        with self.lock:
            self.state.update(values)

    def snapshot(self):
        with self.lock:
            value = dict(self.state)
        value['serverTime'] = time.time()
        value['hostId'] = self.host_id
        value['hostLabel'] = self.host_label
        return value

    def node_snapshot(self):
        """The compact, content-free view consumed by another Deck Watch hub."""
        value = self.snapshot()
        return {key: value.get(key) for key in ('serverTime', 'hostId', 'hostLabel',
            'hostMetrics', 'agents', 'pollSeconds')}

    def set_interval(self, interval):
        if type(interval) is not int or interval not in (30, 60, 300):
            raise ValueError('Invalid interval')
        with self.lock:
            if self.preferences_path:
                temp = self.preferences_path.with_suffix('.tmp')
                fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, 'w') as handle:
                    json.dump({'pollSeconds': interval}, handle)
                os.replace(temp, self.preferences_path)
            self.interval = interval
            self.state['pollSeconds'] = interval
            self.wake.set()
        return interval

    def run(self):
        while not self.stop.is_set():
            self.wake.clear()
            self.update(lastAttemptAt=time.time())
            try:
                if not self.client.proc or self.client.proc.poll() is not None:
                    self.client.connect()
                try:
                    result = self.client.call('account/rateLimits/read')
                    self.update(quota=quota_rows(result), quotaUpdatedAt=time.time(), quotaError=None)
                except Exception:
                    self.update(quotaError='額度暫時讀取失敗；保留最後成功資料。')
                try:
                    result = self.client.call('thread/list', {'limit': 12,
                        'sortKey': 'updated_at', 'sortDirection': 'desc',
                        'sourceKinds': SOURCES, 'useStateDbOnly': True})
                    rows = [{'id': row['id'], 'name': row.get('name') or '未命名任務',
                             'updatedAt': row.get('updatedAt')}
                            for row in result.get('data', [])]
                    self.update(threads=rows, threadsUpdatedAt=time.time(), threadsError=None)
                except Exception:
                    self.update(threadsError='任務清單暫時讀取失敗；保留最後成功資料。')
                # Reconnect after read failures; never touch the desktop App process.
                snap = self.snapshot()
                failed = bool(snap['quotaError'] or snap['threadsError'])
                self.update(runtimeAvailable=not failed,
                    agents=self.fleet.collect(not failed, failed),
                    nodes=self.remote_nodes.collect())
                snap = self.snapshot()
                if snap['quotaError'] or snap['threadsError']:
                    self.client.close()
            except Exception:
                self.update(quotaError='無法連接 Codex 資料來源。',
                            threadsError='無法連接 Codex 資料來源。', runtimeAvailable=False,
                            agents=self.fleet.collect(False, True), nodes=self.remote_nodes.collect())
                self.client.close()
            self.wake.wait(self.interval)
        self.client.close()


class Pairing:
    def __init__(self, runtime):
        runtime.mkdir(mode=0o700, exist_ok=True)
        os.chmod(runtime, 0o700)
        path = runtime / 'pairing.json'
        if not path.exists():
            data = {'code': f'{secrets.randbelow(100000000):08d}', 'key': secrets.token_hex(32)}
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as handle:
                json.dump(data, handle)
        os.chmod(path, 0o600)
        data = json.loads(path.read_text())
        self.code, self.key = data['code'], data['key'].encode()
        self.attempts, self.lock = {}, threading.Lock()

    def pair(self, address, code):
        with self.lock:
            now = time.time()
            # Bound storage even if many clients try to connect.
            self.attempts = {ip: q for ip, q in self.attempts.items() if q and q[-1] > now - 300}
            failures = self.attempts.setdefault(address, collections.deque())
            while failures and failures[0] < now - 300:
                failures.popleft()
            if len(failures) >= 6:
                return None, 429
            if not hmac.compare_digest(str(code), self.code):
                failures.append(now)
                return None, 401
            expires = str(int(now) + 86400 * 7)
            nonce = secrets.token_hex(16)
            payload = f'{expires}.{nonce}'
            signature = hmac.new(self.key, payload.encode(), hashlib.sha256).hexdigest()
            return f'{payload}.{signature}', 200

    def valid(self, token):
        try:
            expires, nonce, signature = token.split('.')
            payload = f'{expires}.{nonce}'
            expected = hmac.new(self.key, payload.encode(), hashlib.sha256).hexdigest()
            return int(expires) > time.time() and hmac.compare_digest(signature, expected)
        except (ValueError, TypeError, AttributeError):
            return False


def handler_class(collector, pairing, bind, port, node_key=None):
    allowed_hosts = {f'{bind}:{port}', f'localhost:{port}', f'127.0.0.1:{port}'}

    class Handler(BaseHTTPRequestHandler):
        server_version = 'DeckWatch/0.1'

        def log_message(self, *args):
            pass  # Never log request credentials or private task titles.

        def send(self, status, body, content_type='application/json; charset=utf-8', cookie=None):
            if isinstance(body, dict):
                body = json.dumps(body, ensure_ascii=False).encode()
            elif isinstance(body, str):
                body = body.encode()
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            if cookie:
                self.send_header('Set-Cookie', cookie)
            self.end_headers()
            self.wfile.write(body)

        def trusted(self):
            host = self.headers.get('Host', '')
            origin = self.headers.get('Origin')
            permitted = host in allowed_hosts
            if bind == '0.0.0.0' and not permitted:
                # A wildcard listener has no single Host value.  Keep its DNS
                # rebinding boundary strict by accepting only private numeric
                # IPv4 hosts on the exact listener port.
                try:
                    parsed = urlsplit(f'//{host}')
                    address = ipaddress.ip_address(parsed.hostname or '')
                    permitted = (parsed.port == port and
                        (address.is_private or address.is_loopback))
                except ValueError:
                    permitted = False
            return permitted and (origin is None or origin == f'http://{host}')

        def authorized(self):
            try:
                cookie = http.cookies.SimpleCookie(self.headers.get('Cookie', ''))
                return 'deck_session' in cookie and pairing.valid(cookie['deck_session'].value)
            except http.cookies.CookieError:
                return False

        def do_GET(self):
            if not self.trusted():
                return self.send(403, {'error': 'Access denied'})
            path = self.path.split('?', 1)[0]
            if path == '/api/status':
                if not self.authorized():
                    return self.send(401, {'error': '請先配對這個裝置。'})
                return self.send(200, collector.snapshot())
            if path == '/api/node/status':
                supplied = self.headers.get('X-Deck-Watch-Node-Key', '')
                if not node_key or not hmac.compare_digest(supplied, node_key):
                    return self.send(401, {'error': 'Node authentication required'})
                return self.send(200, collector.node_snapshot())
            if path == '/healthz':
                return self.send(200, {'service': 'deck-watch', 'version': VERSION})
            files = {'/controller.js': ('controller.js', 'text/javascript; charset=utf-8'),
                     '/controller.css': ('controller.css', 'text/css; charset=utf-8'),
                     '/': ('index.html', 'text/html; charset=utf-8'),
                     '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
                     '/style-packs.js': ('style-packs.js', 'text/javascript; charset=utf-8'),
                     '/style-packs.css': ('style-packs.css', 'text/css; charset=utf-8'),
                     '/app.css': ('app.css', 'text/css; charset=utf-8'),
                     '/favicon.svg': ('favicon.svg', 'image/svg+xml'),
                     '/logo.png': ('logo.png', 'image/png')}
            if path not in files:
                return self.send(404, {'error': 'Not found'})
            filename, content_type = files[path]
            self.send(200, (ROOT / 'static' / filename).read_bytes(), content_type)

        def do_POST(self):
            if not self.trusted():
                return self.send(403, {'error': 'Access denied'})
            if self.path not in ('/api/pair', '/api/settings'):
                return self.send(404, {'error': 'Not found'})
            if self.path == '/api/settings' and not self.authorized():
                return self.send(401, {'error': 'Pairing required'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 2048:
                    return self.send(400, {'error': '請輸入配對碼。'})
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError()
            except (ValueError, OSError):
                return self.send(400, {'error': '配對資料格式錯誤。'})
            if self.path == '/api/settings':
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json' or set(data) != {'pollSeconds'}:
                    return self.send(400, {'error': 'Invalid settings'})
                try:
                    return self.send(200, {'pollSeconds': collector.set_interval(data['pollSeconds'])})
                except ValueError:
                    return self.send(400, {'error': 'Invalid interval'})
                except OSError:
                    return self.send(503, {'error': 'Settings could not be saved'})
            token, status = pairing.pair(self.client_address[0], data.get('code', ''))
            if not token:
                return self.send(status, {'error': '嘗試太多次，請等 5 分鐘。' if status == 429 else '配對碼不正確，請再試一次。'})
            self.send(200, {'paired': True}, cookie=f'deck_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800')

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bind', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--interval', type=int, default=60)
    parser.add_argument('--codex', default=shutil.which('codex'))
    parser.add_argument('--config', type=Path, default=ROOT / 'config' / 'agents.json')
    parser.add_argument('--node-key-env', default='DECK_WATCH_NODE_KEY')
    args = parser.parse_args()
    if args.interval < 30:
        parser.error('Polling interval must be at least 30 seconds')
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
    configuration = load_configuration(args.config)
    pairing = Pairing(ROOT / '.runtime')
    collector = Collector(args.codex, args.interval, ROOT / '.runtime' / 'preferences.json', configuration)
    node_key = os.environ.get(args.node_key_env)
    server = ThreadingHTTPServer((args.bind, args.port), handler_class(collector, pairing, args.bind, args.port, node_key))
    server.daemon_threads = True
    thread = threading.Thread(target=collector.run, daemon=True)
    thread.start()
    metrics = WindowsMetrics() if sys.platform == 'win32' else MacMetrics()
    metrics_thread = threading.Thread(target=metrics.run, args=(collector,), daemon=True)
    metrics_thread.start()
    LOG.info('Deck Watch ready at http://%s:%s', args.bind, args.port)

    def stop(*_):
        collector.stop.set()
        collector.wake.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        collector.stop.set()
        collector.wake.set()
        server.server_close()
        thread.join(timeout=55)


if __name__ == '__main__':
    main()
