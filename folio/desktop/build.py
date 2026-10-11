#!/usr/bin/env python3
"""Build a personal macOS app that launches this checkout; no downloads."""
import json
from pathlib import Path
import plistlib
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
NAME = 'Private Writing Editor'
APP = ROOT / f'{NAME}.app'
CONTENTS = APP / 'Contents'
RESOURCES = CONTENTS / 'Resources'
BINARY = CONTENTS / 'MacOS' / NAME
CACHE = ROOT / 'folio' / 'desktop' / '.build'


def main():
    BINARY.parent.mkdir(parents=True, exist_ok=True)
    RESOURCES.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    subprocess.run(['/usr/bin/xcrun', 'swiftc', '-swift-version', '5', '-parse-as-library', '-O',
                    '-module-cache-path', str(CACHE), '-framework', 'AppKit',
                    '-framework', 'WebKit', str(Path(__file__).with_name('Folio.swift')),
                    '-o', str(BINARY)], check=True)
    config = {'project': str(ROOT), 'python': sys.executable}
    (RESOURCES / 'launcher.json').write_text(json.dumps(config), encoding='utf-8')
    iconset = CACHE / 'Folio.iconset'
    iconset.mkdir(exist_ok=True)
    subprocess.run(['/usr/bin/xcrun', 'swift', '-module-cache-path', str(CACHE),
                    str(Path(__file__).with_name('Icon.swift')), str(ROOT / 'folio/static/favicon.svg'),
                    str(iconset)], check=True)
    subprocess.run(['/usr/bin/iconutil', '-c', 'icns', str(iconset), '-o', str(RESOURCES / 'Folio.icns')], check=True)
    info = {'CFBundleName': NAME, 'CFBundleDisplayName': NAME,
            'CFBundleIdentifier': 'local.folio.desktop', 'CFBundleExecutable': NAME,
            'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': '1.0',
            'CFBundleIconFile': 'Folio.icns',
            'CFBundleVersion': '1', 'NSHighResolutionCapable': True,
            'NSPrincipalClass': 'NSApplication',
            'NSAppTransportSecurity': {'NSAllowsLocalNetworking': True},
            'NSHumanReadableCopyright': 'Private local writing editor'}
    (CONTENTS / 'Info.plist').write_bytes(plistlib.dumps(info))
    subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(APP)], check=True)
    print(f'Built {APP}\nDouble-click {NAME}.app. Close its window or choose Quit {NAME} to stop its server.')


if __name__ == '__main__':
    main()
