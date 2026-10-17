import argparse
import json
import re
from pathlib import Path

def bump_version(new_version: str):
    root = Path(__file__).parent.parent
    
    files_to_update = [
        {
            "path": root / "gui" / "package.json",
            "type": "json",
            "key": "version"
        },
        {
            "path": root / "gui" / "src-tauri" / "tauri.conf.json",
            "type": "json",
            "key": "version"
        },
        {
            "path": root / "gui" / "src-tauri" / "Cargo.toml",
            "type": "toml",
            "pattern": r'^version = ".*"$'
        },
        {
            "path": root / "pyproject.toml",
            "type": "toml",
            "pattern": r'^version = ".*"$'
        }
    ]
    
    print(f"Bumping version to {new_version}...")
    
    for item in files_to_update:
        path = item["path"]
        if not path.exists():
            print(f"Warning: File not found: {path}")
            continue
            
        print(f"Updating {path.name}...")
        
        if item["type"] == "json":
            try:
                content = json.loads(path.read_text())
                content[item["key"]] = new_version
                path.write_text(json.dumps(content, indent=2) + "\n") # Restore newline
            except Exception as e:
                print(f"Failed to update {path.name}: {e}")
                
        elif item["type"] == "toml":
            try:
                # Simple regex replace to preserve comments/structure
                # This assumes 'version = "x.y.z"' is at the start of a line (standard for Cargo/PyProject at top level)
                # But Cargo.toml and pyproject.toml might have [package] or [project] sections.
                # Since we know the structure, let's be careful.
                
                lines = path.read_text().splitlines()
                new_lines = []
                updated = False
                
                for line in lines:
                    # Match version = "..."
                    # Check context if needed, but usually top-level version is what we want
                    # Pyproject: under [project]
                    # Cargo: under [package]
                    
                    if re.match(r'^version\s*=\s*".*"', line.strip()):
                        # Only update the FIRST occurrence which is typically the package version
                        if not updated:
                            new_lines.append(f'version = "{new_version}"')
                            updated = True
                        else:
                            new_lines.append(line)
                    else:
                        new_lines.append(line)
                
                path.write_text("\n".join(new_lines) + "\n")
                
            except Exception as e:
                print(f"Failed to update {path.name}: {e}")

    bump_lockfiles(root, new_version)
    print("Version bump complete!")


def bump_lockfiles(root: Path, new_version: str):
    """Updates only the app's own entries in the lockfiles. A blanket find/replace
    would also hit dependencies that happen to share the old version number."""
    cargo_lock = root / "gui" / "src-tauri" / "Cargo.lock"
    if cargo_lock.exists():
        text = cargo_lock.read_text()
        text, count = re.subn(
            r'(\[\[package\]\]\r?\nname = "app"\r?\nversion = ")[^"]*(")',
            rf'\g<1>{new_version}\g<2>',
            text,
        )
        cargo_lock.write_text(text)
        print(f"Updating Cargo.lock... ({count} entry)")

    npm_lock = root / "gui" / "package-lock.json"
    if npm_lock.exists():
        content = json.loads(npm_lock.read_text())
        content["version"] = new_version
        content.get("packages", {}).get("", {})["version"] = new_version
        npm_lock.write_text(json.dumps(content, indent=2) + "\n")
        print("Updating package-lock.json...")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bump application version")
    parser.add_argument("version", help="New version number (e.g. 0.1.3)")
    args = parser.parse_args()
    
    bump_version(args.version)
