"""Isolated browser-test service; never touches the retained preview database."""
import signal
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
with tempfile.TemporaryDirectory(prefix='afterglow-browser-') as directory:
    sys.argv = ['server.py', '--port', '8778', '--db', str(Path(directory) / 'test.sqlite3')]
    server.main()
