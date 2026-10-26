#!/usr/bin/env python3
from __future__ import annotations
import glob, re, subprocess, sys, textwrap

TARGET = 16

OPCACHE_INI_GLOBS = [
    "/etc/php/*/fpm/conf.d/opcache.ini",
    "/etc/php/*/cli/conf.d/opcache.ini",
    "/etc/php/*/mods-available/opcache.ini",
    "/etc/php/*/fpm/php.ini.d/opcache.ini",
    "/etc/php/*/cli/php.ini.d/opcache.ini",
    "/etc/php/*/fpm/php-fpm.d/opcache.ini",
    "/etc/php/*/fpm/pool.d/*.ini",
    "/etc/php/*/fpm/php.ini",
    "/etc/php/*/cli/php.ini",
]

def sh(cmd):
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr

def find_candidates():
    files = set()
    for pat in OPCACHE_INI_GLOBS:
        files.update(glob.glob(pat))
    hits = []
    for f in sorted(files):
        try:
            data = open(f, "r", encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        for m in re.finditer(r"^\s*opcache\.interned_strings_buffer\s*=\s*([0-9]+)", data, re.M):
            hits.append((f, int(m.group(1)), m.start()))
    return hits

def main():
    before = {}
    rc, out, err = sh("php -r 'echo json_encode(opcache_get_status(false));'")
    if rc == 0 and out.strip():
        try:
            import json
            st = json.loads(out)
            for k in ("interned_strings_buffer_usage", "interned_strings_buffer", "memory_usage", "opcache_statistics"):
                if k in st:
                    before[k] = st[k]
            print(f"### before opcache status:\n{textwrap.indent(str(before), '### ')}")
        except Exception as e:
            print(f"### failed to parse opcache status: {e}\n### raw:\n### {out[:2000]}")

    hits = find_candidates()
    print(f"### found {len(hits)} active interned_strings_buffer settings")
    for f, val, pos in hits:
        print(f"###   {f} = {val}")

    if not hits:
        print("### no active interned_strings_buffer setting found; nothing changed")
        return 0

    changed = 0
    for f, val, pos in hits:
        if val == TARGET:
            print(f"### {f} already {TARGET}; skipping")
            continue
        data = open(f, "r", encoding="utf-8", errors="replace").read()
        new = re.sub(
            r"(^\s*opcache\.interned_strings_buffer\s*=\s*)([0-9]+)",
            lambda m: m.group(1) + str(TARGET),
            data,
            flags=re.M,
        )
        if new == data:
            print(f"### regex did not touch {f}; skipping")
            continue
        open(f, "w", encoding="utf-8").write(new)
        changed += 1
        print(f"### updated {f}: {val} -> {TARGET}")

    if changed == 0:
        print("### no files were changed")
        return 0

    print("### reloading php-fpm services")
    rc, out, err = sh("systemctl list-units --type=service --all --no-pager 'php*-fpm*' 2>/dev/null || ls /lib/systemd/system/php*-fpm*.service /etc/systemd/system/php*-fpm*.service 2>/dev/null")
    print(f"### systemctl scan rc={rc}\n### stdout:\n{textwrap.indent(out.strip(), '### ')}")

    for svc in ["php-fpm", "php8.1-fpm", "php8.2-fpm", "php8.3-fpm", "php8.4-fpm"]:
        rc, out, err = sh(f"systemctl reload {svc} 2>/dev/null && echo reloaded:{svc} || true")
        if "reloaded:" in out:
            print(f"### reloaded {svc}")
        else:
            print(f"### no reload for {svc} (rc={rc})")

    print("### after opcache status:")
    rc, out, err = sh("php -r 'echo json_encode(opcache_get_status(false));'")
    if rc == 0 and out.strip():
        try:
            import json
            st = json.loads(out)
            for k in ("interned_strings_buffer_usage", "interned_strings_buffer", "memory_usage", "opcache_statistics"):
                if k in st:
                    print(f"### {k}: {st[k]}")
        except Exception as e:
            print(f"### failed to parse after status: {e}\n### raw:\n### {out[:2000]}")
    else:
        print(f"### could not read opcache status (rc={rc})\n### stderr:\n### {err[:1000]}")

    return 0

if __name__ == "__main__":
    sys.exit(main())
