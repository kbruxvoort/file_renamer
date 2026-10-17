"""
Bumps the app version in every manifest and lockfile.

    python scripts/bump_version.py 0.1.18

Lockfiles are edited surgically (only the app's own entry), because a blanket
find/replace also hits dependencies that share the old version number.
All edits are computed first and written only if every one succeeds, so a
failure never leaves the repo half-bumped.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")


def read(path: Path) -> str:
    # newline="" keeps the file's line endings exactly as they are
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def json_edit(*key_paths):
    """Sets the version at each key path (e.g. ("packages", "", "version")) in a JSON file."""
    def apply(text: str, version: str) -> str:
        content = json.loads(text)
        for key_path in key_paths:
            node = content
            for key in key_path[:-1]:
                if not isinstance(node, dict) or key not in node:
                    raise ValueError(f"missing key {'/'.join(map(repr, key_path))}")
                node = node[key]
            node[key_path[-1]] = version
        newline = "\r\n" if "\r\n" in text else "\n"
        return json.dumps(content, indent=2, ensure_ascii=False).replace("\n", newline) + newline
    return apply


def toml_edit(header_pattern: str):
    """Sets `version = "..."` on the line right after the header matching `header_pattern`."""
    pattern = re.compile(rf'({header_pattern}\r?\nversion = ")[^"]*(")')

    def apply(text: str, version: str) -> str:
        new_text, count = pattern.subn(lambda m: f"{m.group(1)}{version}{m.group(2)}", text)
        if count != 1:
            raise ValueError(f"expected exactly 1 match, found {count}")
        return new_text
    return apply


FILES = {
    "gui/package.json": json_edit(("version",)),
    "gui/package-lock.json": json_edit(("version",), ("packages", "", "version")),
    "gui/src-tauri/tauri.conf.json": json_edit(("version",)),
    "gui/src-tauri/Cargo.toml": toml_edit(r'\[package\]\r?\nname = "app"'),
    "gui/src-tauri/Cargo.lock": toml_edit(r'\[\[package\]\]\r?\nname = "app"'),
    "pyproject.toml": toml_edit(r'\[project\]\r?\nname = "file-renamer"'),
    "uv.lock": toml_edit(r'\[\[package\]\]\r?\nname = "file-renamer"'),
}


def bump_version(new_version: str) -> int:
    if not VERSION_PATTERN.match(new_version):
        print(f"Invalid version '{new_version}': expected MAJOR.MINOR.PATCH, e.g. 0.1.18")
        return 1

    print(f"Bumping version to {new_version}...")
    updates, failures = {}, []
    for rel_path, edit in FILES.items():
        path = ROOT / rel_path
        try:
            updates[path] = edit(read(path), new_version)
        except Exception as e:
            failures.append(f"{rel_path}: {e}")

    if failures:
        print("Nothing was changed, because these files couldn't be updated:")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    for path, text in updates.items():
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        print(f"Updated {path.relative_to(ROOT)}")

    print("Version bump complete!")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bump application version")
    parser.add_argument("version", help="New version number (e.g. 0.1.18)")
    sys.exit(bump_version(parser.parse_args().version))
