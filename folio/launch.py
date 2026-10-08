#!/usr/bin/env python3
"""Open or start the local Folio app without fetching any dependency."""
import argparse
import errno
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import urllib.request
import urllib.error
from server import FolioServer


def open_browser(port):
    subprocess.run(['/usr/bin/open', f'http://127.0.0.1:{port}'], check=False)


def running_port(port=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for candidate in ([port] if port else range(8765, 8785)):
        try:
            with opener.open(f'http://127.0.0.1:{candidate}/api/health', timeout=0.15) as response:
                if json.load(response).get('app') == 'Folio':
                    return candidate
        except (OSError, ValueError):
            pass
    return None


def connect_or_start(port=None, *, reuse=True, **options):
    """Reuse Folio, or find a free loopback port without stopping another app."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for candidate in ([port] if port is not None else range(8765, 8785)):
        if reuse:
            try:
                with opener.open(f'http://127.0.0.1:{candidate}/api/health', timeout=0.4) as response:
                    if json.load(response).get('app') == 'Folio':
                        return None, candidate
            except (OSError, ValueError):
                pass
        try:
            server = FolioServer(('127.0.0.1', candidate), **options)
            return server, server.server_address[1] if candidate == 0 else candidate
        except OSError as error:
            if error.errno != errno.EADDRINUSE or port is not None:
                raise
    raise OSError('No available Folio port between 8765 and 8784.')


def managed_server(port=None, private_dir=None):
    """Own a server for one desktop app. Closing its control pipe stops it."""
    # An old terminal launcher does not have the ownership lock. Refuse to
    # open a second editor on the same writing rather than overwrite its saves.
    if private_dir is None and running_port() is not None:
        raise OSError('Folio is already running in a browser or Terminal. Stop that copy with Control-C, then reopen Folio.')
    directory = Path(private_dir or Path(__file__).resolve().parent / 'private')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(directory / '.desktop.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise OSError('This Folio workspace is already open. Quit its other app window first.') from exc
        server, actual_port = connect_or_start(port, reuse=False, private_dir=directory)
        def control():
            # Only the parent holds this pipe's write end. EOF also handles a
            # force quit or a launcher crash without leaving a listening port.
            os.read(sys.stdin.fileno(), 1)
            server.shutdown()
        threading.Thread(target=control, daemon=True).start()
        def interrupt(*_):
            raise KeyboardInterrupt
        previous = {sig: signal.signal(sig, interrupt)
                    for sig in (signal.SIGINT, signal.SIGTERM)}
        print(json.dumps({'event': 'ready', 'url': f'http://127.0.0.1:{actual_port}'}), flush=True)
        try:
            server.serve_forever(poll_interval=0.1)
        except KeyboardInterrupt:
            pass
        finally:
            with server.jobs_lock:
                processes = [job.process for job in server.jobs.values() if job.process is not None]
            server.server_close()
            for process in processes:
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            for sig, handler in previous.items():
                signal.signal(sig, handler)


def main():
    parser = argparse.ArgumentParser(description='Folio — a local writing editor')
    parser.add_argument('--port', type=int, help='Use a specific local port')
    parser.add_argument('--no-open', action='store_true')
    parser.add_argument('--managed', action='store_true', help='Desktop app: stop when the parent control pipe closes')
    parser.add_argument('--private-dir', type=Path, help='Use a separate workspace (desktop verification)')
    args = parser.parse_args()
    if args.port is not None and not (1024 <= args.port <= 65535 or args.managed and args.port == 0):
        parser.error('Choose a port between 1024 and 65535.')
    if args.private_dir and not args.managed:
        parser.error('--private-dir requires --managed.')
    if args.managed:
        os.umask(0o077)
        try:
            managed_server(args.port, args.private_dir)
        except OSError as error:
            print(json.dumps({'event': 'error', 'message': str(error)}), flush=True)
            return 1
        return 0
    try:
        server, args.port = connect_or_start(args.port)
    except OSError as error:
        parser.exit(1, f'Folio could not start: {error}. Try a different --port.\n')
    if server is None:
        if not args.no_open:
            open_browser(args.port)
        print(f'Folio is already running at http://127.0.0.1:{args.port}')
        return
    print(f'Folio is ready at http://127.0.0.1:{args.port}', flush=True)
    print('Keep this window open while using Folio. Press Control-C to stop the app.', flush=True)
    if not args.no_open:
        threading.Timer(0.3, open_browser, [args.port]).start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    raise SystemExit(main())
