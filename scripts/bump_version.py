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

    print("Version bump complete!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bump application version")
    parser.add_argument("version", help="New version number (e.g. 0.1.3)")
    args = parser.parse_args()
    
    bump_version(args.version)
