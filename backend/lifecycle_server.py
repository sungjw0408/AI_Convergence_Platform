"""SQLite demo persistence and a loopback-only server for team 2 testing."""
import argparse
from copy import deepcopy
from contextlib import closing
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sqlite3
from threading import Event, Thread
import time
from urllib.parse import urlsplit
from rental_lifecycle import advance, execute, lifecycle_notices

ROOT = Path(__file__).resolve().parents[1]
COLLECTIONS = ('listings', 'rentals', 'messages', 'notices')
DEMO_ITEMS = [dict(id=i, owner='lender', price=price, deposit=0, **extra) for i, price, extra in
              [('drill', 5000, {}), ('projector', 9000, {'weekends': True}), ('ladder', 4000, {})]]


class Conflict(ValueError):
    pass


class Store:
    def __init__(self, path, clock=None):
        self.path = str(path)
        self.clock = clock or (lambda: int(time.time() * 1000))
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connection()) as db:
            db.execute('CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY, data TEXT NOT NULL)')
            db.execute('INSERT OR IGNORE INTO snapshot VALUES (1, ?)', (json.dumps({'revision': 0, 'records': {k: [] for k in COLLECTIONS}}),))

    def connection(self):
        return sqlite3.connect(self.path, timeout=15, isolation_level=None)

    def transaction(self, operation):
        with closing(self.connection()) as db:
            db.execute('BEGIN IMMEDIATE')
            snapshot = json.loads(db.execute('SELECT data FROM snapshot WHERE id=1').fetchone()[0])
            before = deepcopy(snapshot['records'])
            advance(snapshot['records']['rentals'], self.clock())
            snapshot['records']['notices'].extend(lifecycle_notices(before['rentals'], snapshot['records']['rentals'], self.clock()))
            if snapshot['records'] != before:
                snapshot['revision'] += 1
                db.execute('UPDATE snapshot SET data=? WHERE id=1', (json.dumps(snapshot),))
            db.commit()  # Persist recovery even if the following command is rejected.
            db.execute('BEGIN IMMEDIATE')
            snapshot = json.loads(db.execute('SELECT data FROM snapshot WHERE id=1').fetchone()[0])
            before = deepcopy(snapshot['records'])
            try:
                result = operation(snapshot)
                snapshot['records']['notices'].extend(lifecycle_notices(before['rentals'], snapshot['records']['rentals'], self.clock()))
                if snapshot['records'] != before:
                    snapshot['revision'] += 1
                    db.execute('UPDATE snapshot SET data=? WHERE id=1', (json.dumps(snapshot),))
                db.commit()
                return deepcopy(result if result is not None else snapshot)
            except Exception:
                db.rollback()
                raise

    def read(self):
        return self.transaction(lambda _: None)

    def command(self, actor, body):
        def apply(snapshot):
            records = snapshot['records']
            return execute(records['rentals'], DEMO_ITEMS + records['listings'], actor,
                           body.get('action'), body.get('data'), body.get('requestId'), self.clock(), admin=actor == 'admin')
        return self.transaction(apply)

    def save(self, body, actor):
        def apply(snapshot):
            if body.get('revision') != snapshot['revision']:
                raise Conflict('다른 창 또는 자동 처리에서 거래가 변경됐어요. 다시 불러와 주세요.')
            changes = body.get('changes')
            if not isinstance(changes, list) or not 1 <= len(changes) <= 450:
                raise ValueError('변경 내용을 확인해 주세요.')
            for change in changes:
                name, record = change.get('collection'), change.get('record')
                if name not in COLLECTIONS or not isinstance(record, dict) or not isinstance(record.get('id'), str):
                    raise ValueError('저장 형식을 확인해 주세요.')
                collection = snapshot['records'][name]
                current = next((r for r in collection if r['id'] == record['id']), None)
                if name == 'rentals':
                    # Transactions and money may only be changed via the command endpoint.
                    if not current or current.get('lifecycleVersion') != 1 or record.get('lifecycleVersion') != 1:
                        raise ValueError('거래는 거래 명령으로 생성해 주세요.')
                    allowed = {'inspection', 'photoAnalysis', 'review', 'feedback'}
                    if actor not in (current['renterId'], current['lenderId']):
                        raise ValueError('거래 당사자만 저장할 수 있어요.')
                    if any(record.get(k) != current.get(k) for k in record.keys() | current.keys() if k not in allowed):
                        raise ValueError('거래 상태와 금액은 서버에서만 변경할 수 있어요.')
                    # Only comparison results may change here; captured evidence uses commands.
                    old, new = current.get('inspection', {}), record.get('inspection', {})
                    if {k: v for k, v in old.items() if k != 'results'} != {k: v for k, v in new.items() if k != 'results'}:
                        raise ValueError('촬영 기록은 촬영 완료 명령으로 저장해 주세요.')
                    if record.get('feedback') != current.get('feedback'):
                        from rental_lifecycle import validate_feedback_update
                        validate_feedback_update(current, record, actor, self.clock())
                    if record.get('review') != current.get('review') and (current['status'] != 'complete' or actor != current['renterId'] or current.get('review')):
                        raise ValueError('후기를 저장할 수 없어요.')
                elif name == 'listings':
                    if current or record.get('owner') != actor or any(i['id'] == record['id'] for i in DEMO_ITEMS):
                        raise ValueError('본인의 새 물품만 등록할 수 있어요.')
                    from rental_lifecycle import money
                    money(record.get('price'))
                    money(record.get('deposit', 0))
                elif name == 'messages':
                    rental = next((r for r in snapshot['records']['rentals'] if r['id'] == record.get('rentalId')), None)
                    if current or not rental or rental['status'] not in ('confirmed', 'handover', 'active', 'checking', 'complete', 'disputed') or actor not in (rental['renterId'], rental['lenderId']) or record.get('sender') != actor:
                        raise ValueError('거래 당사자의 메시지만 저장할 수 있어요.')
                if current:
                    collection[collection.index(current)] = deepcopy(record)
                else:
                    collection.append(deepcopy(record))
            return None
        return self.transaction(apply)


def make_handler(store):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT / 'frontend'), **kwargs)

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()

        def send_json(self, payload, status=200):
            data = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def access(self):
            host = urlsplit('http://' + self.headers.get('Host', '')).hostname
            origin = self.headers.get('Origin')
            expected = 'http://' + self.headers.get('Host', '')
            return self.client_address[0] in ('127.0.0.1', '::1') and host in ('localhost', '127.0.0.1', '::1') and (not origin or origin == expected)

        def do_GET(self):
            if not self.access():
                return self.send_json({'error': '로컬 시연 서버에서만 이용할 수 있어요.'}, 403)
            if urlsplit(self.path).path == '/api/rental-database':
                return self.send_json(store.read())
            if urlsplit(self.path).path in ('/', '/index.html'):
                html = (ROOT / 'frontend/index.html').read_text(encoding='utf-8').replace('<head>', '<head><meta name="rento-database" content="sqlite"><meta name="rento-lifecycle" content="enabled">')
                data = html.encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            return super().do_GET()

        def do_POST(self):
            if not self.access():
                return self.send_json({'error': '같은 로컬 앱에서만 요청할 수 있어요.'}, 403)
            actor = self.headers.get('X-Rento-Demo-Actor')
            if actor not in ('renter', 'lender', 'admin'):
                return self.send_json({'error': '시연 역할을 확인해 주세요.'}, 403)
            try:
                size = int(self.headers.get('Content-Length', 0))
                if not 0 < size <= 8_000_000:
                    raise ValueError('요청 크기를 확인해 주세요.')
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise ValueError('요청 형식을 확인해 주세요.')
                if self.path == '/api/rental-lifecycle':
                    rental = store.command(actor, body)
                    return self.send_json({'rental': rental})
                if self.path == '/api/rental-database':
                    return self.send_json({'revision': store.save(body, actor)['revision']})
                return self.send_json({'error': '이 실행 서버에는 해당 API가 없어요.'}, 404)
            except Conflict as error:
                self.send_json({'error': str(error)}, 409)
            except (ValueError, TypeError, KeyError, OverflowError) as error:
                self.send_json({'error': str(error)}, 400)
    return Handler


def recovery_loop(store, stop, interval=15):
    while not stop.wait(interval):
        try:
            store.read()
        except (sqlite3.Error, ValueError) as error:
            print('거래 자동 처리 재시도 대기:', str(error), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8003)
    parser.add_argument('--db', default=str(ROOT / 'backend/.rento-data/team2.sqlite'))
    args = parser.parse_args()
    store = Store(args.db)
    stop = Event()
    worker = Thread(target=recovery_loop, args=(store, stop), daemon=True)
    worker.start()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(store))
    print(f'팀원 2 로컬 시연: http://localhost:{args.port} (실제 청구 없음)', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()
