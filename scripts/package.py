"""Package the Windows plugin, bundled dependencies, licenses and evidence.
Never includes generated source-plugin state, user credentials or work folders.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
root, output = args.root.resolve(), args.out.resolve()
if output.exists():
    raise SystemExit('Output already exists; refusing overwrite')
allowed_dirs = {'.agents', '.codex-plugin', 'bin', 'lib', 'node_modules', 'scripts', 'skills', 'tests', 'verification', 'repairs', 'web', 'data', 'ui'}
allowed_files = {'.mcp.json', '.npmrc', 'package.json', 'package-lock.json', 'LICENSE', 'README.md', 'COMPATIBILITY.md', 'MODULES.md', 'VERIFICATION.md', '功能限制說明.md', '安全限制調整對照.md', '開啟DSH插件市場.cmd', '開啟DSH插件市場.vbs'}
blocked = {'.git', '.state', '__pycache__', '.env', 'auth.json', 'bridge-endpoint.json'}
selected = []
for file in root.rglob('*'):
    rel = file.relative_to(root)
    if any(part in blocked or part.startswith('.env.') for part in rel.parts):
        continue
    if file.is_symlink():
        raise SystemExit(f'Refusing symbolic link in release: {rel}')
    if file.is_file() and (rel.parts[0] in allowed_dirs or rel.as_posix() in allowed_files):
        selected.append((file, 'dsh-to-codex/' + rel.as_posix()))
with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file, name in sorted(selected, key=lambda item: item[1]):
        archive.write(file, name)
with zipfile.ZipFile(output) as archive:
    bad = archive.testzip()
    if bad:
        raise SystemExit(f'Archive CRC check failed: {bad}')
    version = json.loads(archive.read('dsh-to-codex/package.json'))['version']
    assert version == json.loads(archive.read('dsh-to-codex/.codex-plugin/plugin.json'))['version']
result = {'version': version, 'archive': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'bytes': output.stat().st_size, 'files': len(selected), 'crcVerified': True, 'includesDependenciesAndLicenses': True}
print(json.dumps(result, ensure_ascii=False))
