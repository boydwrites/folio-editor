"""Desktop process ownership. Synthetic workspaces; no model requests."""
import json
from pathlib import Path
import selectors
import signal
import socket
import subprocess
import sys
import tempfile
import unittest
import urllib.request

LAUNCH = Path(__file__).resolve().parents[1] / 'launch.py'


class DesktopLaunchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='folio-launch-test-')
        self.children = []

    def tearDown(self):
        for child in self.children:
            if child.stdin and not child.stdin.closed:
                child.stdin.close()
            try:
                child.wait(timeout=6)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
            child.stdout.close()
            child.stderr.close()
        self.temp.cleanup()

    def start(self, *, directory=None, port=0):
        child = subprocess.Popen([sys.executable, str(LAUNCH), '--managed', '--port', str(port),
                                  '--private-dir', directory or self.temp.name],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(child)
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ)
            self.assertTrue(selector.select(timeout=8), 'Desktop startup did not respond')
        line = child.stdout.readline()
        self.assertTrue(line, 'Desktop server exited before startup')
        return child, json.loads(line)

    def assert_port_released(self, url):
        port = int(url.rsplit(':', 1)[1])
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(('127.0.0.1', port))

    def test_control_pipe_eof_stops_server_and_preserves_saved_writing(self):
        child, event = self.start()
        self.assertEqual(event['event'], 'ready')
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(event['url'] + '/api/bootstrap') as response:
            token = json.load(response)['token']
        data = {'sessions': [{'id': 'test', 'title': 'Synthetic', 'draft': 'Saved synthetic writing.'}],
                'examples': [], 'settings': {'editorVersion': 2}}
        request = urllib.request.Request(event['url'] + '/api/state', data=json.dumps(data).encode(),
                                         headers={'X-Folio-Token': token, 'Content-Type': 'application/json'})
        with opener.open(request) as response:
            self.assertEqual(response.status, 200)
        child.stdin.close()
        self.assertEqual(child.wait(timeout=6), 0)
        self.assert_port_released(event['url'])
        self.assertEqual(json.loads((Path(self.temp.name) / 'state.json').read_text()), data)
        # The ownership lock and port can both be reused after quitting.
        other, reopened = self.start(port=int(event['url'].rsplit(':', 1)[1]))
        self.assertEqual(reopened['event'], 'ready')

    def test_termination_signal_releases_port(self):
        child, event = self.start()
        child.send_signal(signal.SIGTERM)
        self.assertEqual(child.wait(timeout=6), 0)
        self.assert_port_released(event['url'])

    def test_second_app_cannot_open_same_writing_workspace(self):
        first, event = self.start()
        second, error = self.start()
        self.assertEqual(error['event'], 'error')
        self.assertIn('already open', error['message'])
        self.assertEqual(second.wait(timeout=6), 1)
        self.assertIsNone(first.poll())

    def test_port_collision_does_not_stop_another_process(self):
        with socket.socket() as unrelated:
            unrelated.bind(('127.0.0.1', 0))
            unrelated.listen()
            child, error = self.start(port=unrelated.getsockname()[1])
            self.assertEqual(error['event'], 'error')
            self.assertEqual(child.wait(timeout=6), 1)
            with socket.create_connection(unrelated.getsockname(), timeout=2):
                accepted, _ = unrelated.accept()
                accepted.close()

    def test_parent_crash_closes_control_pipe(self):
        # Replicate a host crash: the OS closes its pipe rather than running a
        # graceful shutdown callback. The server still must release its port.
        code = '''
import os, subprocess, sys
child = subprocess.Popen([sys.executable, sys.argv[1], '--managed', '--port', '0',
                          '--private-dir', sys.argv[2]], stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
print(child.stdout.readline().decode().strip(), flush=True)
os._exit(0)
'''
        result = subprocess.run([sys.executable, '-c', code, str(LAUNCH), self.temp.name],
                                capture_output=True, timeout=10, check=True)
        event = json.loads(result.stdout)
        import time
        deadline = time.monotonic() + 6
        while True:
            try:
                self.assert_port_released(event['url'])
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(.05)


if __name__ == '__main__':
    unittest.main()
