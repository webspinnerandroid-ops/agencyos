#!/usr/bin/env python3
"""
Upload agency-os (excluding node_modules, .next, .git) to the VPS by
scp-ing a binary zip to /tmp/agency-os-upload.zip, then having the remote
python extract it into the repo dir.

Usage:
  python scripts/upload-via-zip.py            # upload 12 sample files (test mode)
  python scripts/upload-via-zip.py --all     # upload the full source tree
"""
from __future__ import annotations
import sys, io, subprocess, zipfile, argparse, time, tempfile, os
from pathlib import Path

KEY = (Path('.freebuff') / 'ssh' / 'agencyos_vps_new').resolve()
HOST = 'blissmedialab.com'
REMOTE_BASE = '/home/admin/web/platform.blissmedialab.com/agency-os'
EXCLUDE_TOP = {'node_modules', '.next', '.git'}

REMOTE_PY = """\
import zipfile, pathlib
base = pathlib.Path('/home/admin/web/platform.blissmedialab.com/agency-os')
base.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile('/tmp/agency-os-upload.zip') as zf:
    print('ZIP_OK', len(zf.namelist()))
    zf.extractall(base)
print('EXTRACTED_OK')
"""


def scp_file(local_path, remote_path, timeout=300):
    key_posix = Path('/').joinpath(*KEY.parts).as_posix().replace('\\', '/')
    cmd = [
        'scp', '-i', key_posix,
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=12',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'LogLevel=ERROR',
        local_path,
        f'root@{HOST}:{remote_path}',
    ]
    print(f'### scp {local_path} -> root@{HOST}:{remote_path}')
    r = subprocess.run(cmd, capture_output=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr


def ssh_run(cmd, timeout=120, stdin_bytes=None):
    r = subprocess.run(cmd, input=stdin_bytes, capture_output=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr


def collect_files(repo, all_files=False):
    out = []
    for p in repo.rglob('*'):
        if not p.is_file():
            continue
        if any(pp in EXCLUDE_TOP for pp in p.parts):
            continue
        out.append(p.relative_to(repo).as_posix())
        if not all_files and len(out) >= 12:
            break
    return out


def build_zip_bytes(repo, rel_paths):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel in rel_paths:
            z.writestr(rel, (repo / rel).read_bytes())
    return buf.getvalue()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--all', action='store_true', help='Upload full source tree')
    args = parser.parse_args()

    repo = Path('.').resolve()
    rel_paths = collect_files(repo, all_files=args.all)
    print(f'### packaging {len(rel_paths)} files')
    t0 = time.time()
    for i, r in enumerate(rel_paths[:8]):
        print('  ', r)
    if len(rel_paths) > 8:
        print(f'  ... +{len(rel_paths)-8} more')

    zip_bytes = build_zip_bytes(repo, rel_paths)
    print(f'### zip bytes={len(zip_bytes)} ({time.time()-t0:.1f}s)')

    # Write binary zip to temp file
    with tempfile.NamedTemporaryFile('wb', delete=False, suffix='.zip') as tf:
        tf.write(zip_bytes)
        zip_tmp = tf.name
    print(f'### wrote zip tmp {zip_tmp} ({os.path.getsize(zip_tmp)} bytes)')

    try:
        rc, out, err = scp_file(zip_tmp, '/tmp/agency-os-upload.zip')
        print(f'### scp rc={rc}')
        if out:
            print('### scp stdout:', out.decode('utf8', 'replace')[-1000:])
        if err:
            print('### scp stderr:', err.decode('utf8', 'replace')[-1000:])
        if rc != 0:
            sys.exit(rc)
    finally:
        try:
            os.unlink(zip_tmp)
        except Exception:
            pass

    # Run remote extractor
    key_posix = Path('/').joinpath(*KEY.parts).as_posix().replace('\\', '/')
    cmd = [
        'ssh', '-i', key_posix,
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=12',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'LogLevel=ERROR',
        f'root@{HOST}',
        'python3', '-',
    ]
    print('### running remote extractor over ssh (via stdin) ...')
    rc, out, err = ssh_run(cmd, timeout=300, stdin_bytes=REMOTE_PY.encode('utf8'))
    print(f'### rc={rc}')
    if out:
        print('### stdout:', out.decode('utf8', 'replace')[-2000:])
    if err:
        print('### stderr:', err.decode('utf8', 'replace')[-2000:])
    if rc != 0:
        sys.exit(rc)


if __name__ == '__main__':
    main()
