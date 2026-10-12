import http.client
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import sqlite3
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]


class API(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / 'activities.sqlite3'
        self.start()

    def start(self):
        self.process = subprocess.Popen([sys.executable, str(ROOT / 'server.py'), '--port', '0', '--db', str(self.db)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        line = self.process.stdout.readline()
        self.assertTrue(line.startswith('Afterglow http://127.0.0.1:'), line or self.process.stderr.read())
        self.port = int(line.strip().rsplit(':', 1)[1])

    def stop(self):
        self.process.terminate()
        self.process.communicate(timeout=5)

    def tearDown(self):
        self.stop()
        self.temp.cleanup()

    def request(self, method='GET', path='/api/activities', data=None, headers=None, raw=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        body = raw if raw is not None else json.dumps(data) if data is not None else None
        h = {'Content-Type': 'application/json'} if body is not None else {}
        h.update(headers or {})
        connection.request(method, quote(path, safe='/%?=&'), body=body, headers=h)
        response = connection.getresponse()
        value = response.read()
        result = (response.status, json.loads(value) if response.getheader('Content-Type', '').startswith('application/json') and value else value)
        connection.close()
        return result

    def create(self, **changes):
        data = dict(title=' Blue-hour wander ', mood='outdoors', duration=30, place=None, note=' Take the slow way home ')
        data.update(changes)
        return self.request('POST', data=data)

    def test_crud_filters_and_restart(self):
        status, body = self.create()
        self.assertEqual(status, 201)
        activity = body['activity']
        self.assertEqual((activity['title'], activity['place'], activity['note'], activity['status']), ('Blue-hour wander', '', 'Take the slow way home', 'saved'))
        identifier = activity['id']
        self.assertEqual(self.request('PATCH', f'/api/activities/{identifier}', {'status': 'tried', 'duration': 60})[0], 200)
        rows = self.request(path='/api/activities?mood=outdoors&max_duration=30')[1]['activities']
        self.assertNotIn(identifier, [a['id'] for a in rows])
        rows = self.request(path='/api/activities?status=tried&max_duration=60')[1]['activities']
        self.assertIn(identifier, [a['id'] for a in rows])
        self.stop()
        self.start()
        self.assertEqual(next(a for a in self.request()[1]['activities'] if a['id'] == identifier)['status'], 'tried')
        for a in self.request()[1]['activities']:
            self.assertEqual(self.request('DELETE', f"/api/activities/{a['id']}")[0], 204)
        self.stop()
        self.start()
        self.assertEqual(self.request()[1], {'activities': []})

    def test_validation_unicode_and_atomicity(self):
        self.assertEqual(self.create(title='🌙' * 120)[0], 201)
        before = self.request()[1]
        for patch in [dict(title='🌙' * 121), dict(title='  '), dict(title=3), dict(mood=['quiet']), dict(duration=True), dict(duration=30.0), dict(note='n' * 1001), dict(place=2), dict(extra='bad'), dict(status='unknown')]:
            with self.subTest(patch=patch):
                status, body = self.create(**patch)
                self.assertEqual(status, 400)
                self.assertIn('error', body)
        for raw in ['[]', '{}', 'null', '{bad', '{"title":"x","title":"y","mood":"quiet","duration":30}']:
            self.assertEqual(self.request('POST', raw=raw)[0], 400)
        self.assertEqual(self.request('PATCH', '/api/activities/1', {'title': 'changed', 'duration': 42})[0], 400)
        self.assertEqual(self.request()[1], before)

    def test_boundary_and_bad_ids(self):
        for path in ['/api/activities/0', '/api/activities/-1', '/api/activities/1%20OR%201=1', '/api/activities/١', '/api/activities/99999999999999999999999999999']:
            self.assertEqual(self.request('DELETE', path)[0], 400)
        self.assertEqual(self.request('DELETE', '/api/activities/99999')[0], 404)
        for query in ['mood=no', 'max_duration=45', 'status=no', 'unknown=x', 'mood=quiet&mood=social']:
            self.assertEqual(self.request(path='/api/activities?' + query)[0], 400)
        for path in ['/server.py', '/.kandev/jlab-project.json', '/../server.py', '/%2e%2e/server.py', '/fonts/../../server.py', '/fixtures.json']:
            self.assertEqual(self.request(path=path)[0], 404)
        self.assertEqual(self.request(path='/')[0], 200)
        self.assertEqual(self.request(path='/api/health')[1], {'ok': True})
        for h in [{'Origin': 'https://attacker.invalid'}, {'Sec-Fetch-Site': 'cross-site'}, {'Host': 'evil.invalid'}]:
            self.assertEqual(self.create_request(h)[0], 403)
        self.assertEqual(self.create_request({'Origin': f'http://127.0.0.1:{self.port}'})[0], 201)
        self.assertEqual(self.request('POST', data={}, headers={'Content-Type': 'text/plain'})[0], 415)

    def create_request(self, headers):
        return self.request('POST', data={'title': 'Evening', 'mood': 'quiet', 'duration': 30}, headers=headers)

    def test_unrepresentable_unicode_and_shared_whitespace(self):
        self.assertEqual(self.create(title='\ud800')[0], 400)
        self.assertEqual(self.create(title='\ufeff \ufeff')[0], 400)
        self.assertEqual(self.create(title='\ufeffEvening\ufeff')[1]['activity']['title'], 'Evening')

    def test_real_storage_failure_is_generic_and_atomic(self):
        before = self.request()[1]
        with sqlite3.connect(self.db) as lock:
            lock.execute('BEGIN EXCLUSIVE')
            status, body = self.create()
            self.assertEqual(status, 500)
            self.assertIn('try again', body['error']['message'])
            self.assertNotIn('sqlite', json.dumps(body).lower())
            lock.rollback()
        self.assertEqual(self.request()[1], before)


if __name__ == '__main__':
    unittest.main()
