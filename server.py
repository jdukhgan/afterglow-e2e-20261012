"""Loopback-only Afterglow preview; standard-library HTTP and durable SQLite."""
import argparse
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
import sqlite3
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'
LIMITS = {'title': 120, 'place': 160, 'note': 1000}
ENUMS = {'mood': ('quiet', 'social', 'outdoors'), 'duration': (30, 60, 120), 'status': ('saved', 'planned', 'tried')}
FIELDS = (*LIMITS, *ENUMS)


class Problem(Exception):
    def __init__(self, status, message, fields=None):
        self.status, self.message, self.fields = status, message, fields


def validate(data, create=False):
    if not isinstance(data, dict) or set(data) - set(FIELDS):
        raise Problem(400, 'Use only supported activity fields.')
    fields, value = {}, {}
    for key, limit in LIMITS.items():
        if key not in data and not create:
            continue
        item = data.get(key, '')
        if item is None and key != 'title':
            item = ''
        if not isinstance(item, str):
            fields[key] = 'Enter text for this field.'
            continue
        item = item.strip()
        if key == 'title' and not item:
            fields[key] = 'Give this evening a title.'
        elif len(item) > limit:
            fields[key] = f'Keep the {key} to {limit} characters or fewer.'
        value[key] = item
    for key, choices in ENUMS.items():
        if key not in data and (not create or key == 'status'):
            continue
        item = data.get(key)
        valid = type(item) is int if key == 'duration' else isinstance(item, str)
        if not valid or item not in choices:
            fields[key] = f'Choose a valid {key}.'
        else:
            value[key] = item
    if fields:
        raise Problem(400, 'Some details need another look.', fields)
    if create:
        value.setdefault('status', 'saved')
    return value


def initialize(db):
    db.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(db)) as conn, conn:
        conn.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY)')
        conn.execute('CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, place TEXT NOT NULL, note TEXT NOT NULL, mood TEXT NOT NULL, duration INTEGER NOT NULL, status TEXT NOT NULL)')
        if not conn.execute("SELECT 1 FROM metadata WHERE key='seeded'").fetchone():
            seed = json.loads((WEB / 'fixtures.json').read_text())['activities']
            for row in seed:
                value = validate({k: v for k, v in row.items() if k != 'id'}, True)
                columns = ['id', *value]
                conn.execute(f"INSERT INTO activities ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", [row['id'], *value.values()])
            conn.execute("INSERT INTO metadata VALUES ('seeded')")


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('Duplicate field')
        value[key] = item
    return value


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Do not log user text or request URLs.

    def respond(self, status, body=None, content_type='application/json; charset=utf-8'):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        body = body or b''
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def guard(self):
        # The operator's existing loopback bridge preserves its owner-side Host.
        ports = (self.server.server_port, 8335)
        hosts = {f'{host}:{port}' for host in ('127.0.0.1', 'localhost') for port in ports}
        host = self.headers.get('Host', '')
        if host not in hosts:
            raise Problem(403, 'Use the configured local preview address.')
        if self.command in ('POST', 'PATCH', 'DELETE'):
            origin = self.headers.get('Origin')
            if (origin is not None and origin != f'http://{host}') or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                raise Problem(403, 'Cross-origin changes are not allowed.')

    def read_json(self):
        if self.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
            raise Problem(415, 'Send activity details as JSON.')
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 32768:
                raise Problem(400, 'Send a JSON object within the field limits.')
            return json.loads(self.rfile.read(size).decode('utf-8'), object_pairs_hook=unique_object, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (ValueError, UnicodeError):
            raise Problem(400, 'Send a valid JSON object.') from None

    def dispatch(self):
        try:
            self.guard()
            url = urlsplit(self.path)
            path = unquote(url.path)
            if path == '/api/health' and self.command == 'GET':
                with closing(sqlite3.connect(self.server.db)) as conn:
                    conn.execute('SELECT 1 FROM activities LIMIT 1')
                return self.respond(200, {'ok': True})
            if path == '/api/activities' or path.startswith('/api/activities/'):
                return self.api(path, url.query)
            if self.command in ('GET', 'HEAD'):
                assets = {'/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css'}
                assets.update({f'/fonts/{p.name}': f'fonts/{p.name}' for p in (WEB / 'fonts').glob('*') if p.is_file()})
                if path in assets:
                    asset = WEB / assets[path]
                    return self.respond(200, asset.read_bytes(), mimetypes.guess_type(asset)[0] or 'application/octet-stream')
            raise Problem(404, 'That page was not found.')
        except Problem as error:
            envelope = {'message': error.message}
            if error.fields:
                envelope['fields'] = error.fields
            self.respond(error.status, {'error': envelope})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.respond(500, {'error': {'message': 'Afterglow couldn’t finish that request. Please try again.'}})

    def api(self, path, query):
        identifier = None
        if path != '/api/activities':
            tail = path.removeprefix('/api/activities/')
            if not re.fullmatch(r'[1-9][0-9]{0,18}', tail) or int(tail) > 9223372036854775807:
                raise Problem(400, 'Use a positive activity ID.')
            identifier = int(tail)
        with closing(sqlite3.connect(self.server.db, timeout=5)) as conn, conn:
            conn.row_factory = sqlite3.Row
            if self.command == 'GET' and identifier is None:
                params = parse_qs(query, keep_blank_values=True)
                if set(params) - {'mood', 'max_duration', 'status'} or any(len(v) != 1 for v in params.values()):
                    raise Problem(400, 'Use supported filters once each.')
                clauses, values = [], []
                for key, entries in params.items():
                    item = entries[0]
                    if key == 'max_duration':
                        if item not in ('30', '60', '120'):
                            raise Problem(400, 'Choose 30, 60 or 120 minutes.')
                        clauses.append('duration <= ?')
                        values.append(int(item))
                    else:
                        if item not in ENUMS[key]:
                            raise Problem(400, f'Choose a valid {key}.')
                        clauses.append(f'{key} = ?')
                        values.append(item)
                sql = 'SELECT * FROM activities' + (' WHERE ' + ' AND '.join(clauses) if clauses else '') + ' ORDER BY id'
                return self.respond(200, {'activities': [dict(row) for row in conn.execute(sql, values)]})
            if query:
                raise Problem(400, 'Filters are only supported when listing evenings.')
            if self.command == 'POST' and identifier is None:
                value = validate(self.read_json(), True)
                cursor = conn.execute(f"INSERT INTO activities ({','.join(value)}) VALUES ({','.join('?' for _ in value)})", list(value.values()))
                identifier = cursor.lastrowid
                status = 201
            elif identifier is not None and self.command in ('PATCH', 'DELETE'):
                if not conn.execute('SELECT 1 FROM activities WHERE id=?', (identifier,)).fetchone():
                    raise Problem(404, 'That evening no longer exists.')
                if self.command == 'DELETE':
                    conn.execute('DELETE FROM activities WHERE id=?', (identifier,))
                    conn.commit()  # Commit before reporting successful mutations.
                    return self.respond(204)
                value = validate(self.read_json())
                if value:
                    conn.execute(f"UPDATE activities SET {','.join(k + '=?' for k in value)} WHERE id=?", [*value.values(), identifier])
                status = 200
            else:
                raise Problem(405, 'That method is not supported here.')
            activity = dict(conn.execute('SELECT * FROM activities WHERE id=?', (identifier,)).fetchone())
            conn.commit()
            return self.respond(status, {'activity': activity})

    do_GET = do_HEAD = do_POST = do_PATCH = do_DELETE = do_OPTIONS = dispatch


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--db', type=Path, default=ROOT / '.kandev/data/activities.sqlite3')
    args = parser.parse_args()
    initialize(args.db)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.db = args.db
    print(f'Afterglow http://127.0.0.1:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
