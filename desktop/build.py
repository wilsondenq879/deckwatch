#!/usr/bin/env python3
"""Bundle the official verified Linux Electron runtime with the local dashboard."""
import argparse
import hashlib
from pathlib import Path
import shutil
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
VERSION = '0.5.3'

def replace_once(text, source, destination):
    if text.count(source) != 1:
        raise ValueError(f'Expected one UI insertion point: {source[:60]}')
    return text.replace(source, destination, 1)

def build(archive, sums):
    expected = next(line.split()[0] for line in sums.read_text().splitlines() if line.split()[-1].lstrip('*') == archive.name)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise ValueError('Electron checksum mismatch')
    package = ROOT / 'dist' / f'DeckWatch-{VERSION}-linux-x64'
    if package.exists():
        shutil.rmtree(package)
    runtime = package / 'runtime'
    runtime.mkdir(parents=True)
    with zipfile.ZipFile(archive) as source:
        for item in source.infolist():
            target = (runtime / item.filename).resolve()
            if not target.is_relative_to(runtime.resolve()):
                raise ValueError('Invalid archive path')
            source.extract(item, runtime)
            mode = (item.external_attr >> 16) & 0o777
            if mode: target.chmod(mode)
    (runtime / 'electron').rename(runtime / 'deck-watch-bin')
    (runtime / 'resources' / 'default_app.asar').unlink(missing_ok=True)
    app = runtime / 'resources' / 'app'
    shutil.copytree(ROOT / 'desktop' / 'app', app)
    art = app / 'steam-art'
    art.mkdir()
    for asset in ['icon.png','steam-hero.png','steam-cover.png','steam-logo.png','README.md']:
        shutil.copy2(ROOT / 'design' / 'brand-v2' / asset, art / asset)
    ui = app / 'ui'
    shutil.copytree(ROOT / 'static', ui)
    for filename in ['desktop.js', 'desktop.css']:
        shutil.move(app / filename, ui / filename)
    shutil.copy2(ROOT / 'design' / 'brand-v2' / 'icon.png', app / 'icon.png')
    html = (ui / 'index.html').read_text()
    html = replace_once(html, '<script src="/app.js" defer>', '<link rel="stylesheet" href="/desktop.css"><script src="/desktop.js" defer></script><script src="/app.js" defer>')
    html = replace_once(html, '<form id="pairForm">', '<form id="pairForm"><label for="macAddress" data-i18n="macAddress">Hub 位址</label><input id="macAddress" class="desktop-address" value="http://192.168.1.2:8765" type="text" inputmode="url" spellcheck="false" required>')
    options = '''<details class="connection-settings"><summary data-i18n="reconnect">更換 Mac 或重新配對</summary><form id="changeMacForm"><label for="macAddressSettings" data-i18n="macAddress">Mac 位址</label><input id="macAddressSettings" type="text" inputmode="url" required spellcheck="false"><label for="newPairCode" data-i18n="pairCode">配對碼</label><input id="newPairCode" type="password" inputmode="numeric" pattern="[0-9]{8}" minlength="8" maxlength="8" required autocomplete="off"><button id="reconnectButton" data-i18n="connect">連接</button><p id="connectionError" class="error" role="status"></p></form></details>'''
    html = replace_once(html, '<div id="desktopConnectionSlot"></div>', '<div id="desktopConnectionSlot">' + options + '</div>')
    (ui / 'index.html').write_text(html)
    shutil.copy2(ROOT / 'desktop' / 'install.sh', package / 'install.sh')
    (package / 'install.sh').chmod(0o755)
    shutil.copy2(ROOT / 'desktop' / 'README.md', package / 'README.md')
    shutil.copy2(ROOT / 'design' / 'lucide-LICENSE', package / 'Lucide-LICENSE')
    (package / 'BUILD.txt').write_text(f'Deck Watch {VERSION}\nRuntime: {archive.name}\nOfficial runtime SHA-256: {expected}\n')
    result = ROOT / 'dist' / f'{package.name}.tar.gz'
    with tarfile.open(result, 'w:gz', compresslevel=6) as target:
        target.add(package, arcname=package.name)
    checksum = hashlib.sha256(result.read_bytes()).hexdigest()
    result.with_suffix(result.suffix + '.sha256').write_text(f'{checksum}  {result.name}\n')
    print(f'{result}\n{result.stat().st_size / 1024**2:.1f} MiB\nSHA-256: {checksum}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', required=True, type=Path)
    parser.add_argument('--sums', required=True, type=Path)
    args = parser.parse_args()
    build(args.runtime, args.sums)
