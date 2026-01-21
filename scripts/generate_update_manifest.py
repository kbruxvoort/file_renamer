import os
import json
import glob
import sys
from datetime import datetime, timezone

def generate_manifest(version, tag_name, output_file="latest.json"):
    # Base URL for GitHub Releases
    # Format: https://github.com/kbruxvoort/file_renamer/releases/download/<tag>/<filename>
    base_url = f"https://github.com/kbruxvoort/file_renamer/releases/download/{tag_name}"

    # Path to bundle directory - adjusted for CI environment
    # In CI, we run from root. Artifacts are in gui/src-tauri/target/release/bundle/nsis/
    bundle_dir = "gui/src-tauri/target/release/bundle/nsis"
    
    # Check if directory exists
    if not os.path.exists(bundle_dir):
        print(f"Error: Bundle directory not found: {bundle_dir}")
        sys.exit(1)

    # Find the setup EXE and SIG
    # Looking for *-setup.exe
    exe_files = glob.glob(os.path.join(bundle_dir, "*-setup.exe"))
    if not exe_files:
        print("Error: No setup.exe found!")
        sys.exit(1)
        
    exe_path = exe_files[0]
    exe_name = os.path.basename(exe_path)
    
    # Find signature file
    sig_path = exe_path + ".sig"
    if not os.path.exists(sig_path):
        print(f"Error: Signature file not found: {sig_path}")
        sys.exit(1)
        
    with open(sig_path, 'r') as f:
        signature = f.read().strip()

    # Construct manifest
    manifest = {
        "version": version,
        "notes": f"Update {version}",
        "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": {
            "windows-x86_64": {
                "signature": signature,
                "url": f"{base_url}/{exe_name}"
            }
        }
    }

    # Write to file
    with open(output_file, 'w') as f:
        json.dump(manifest, f, indent=2)
        
    print(f"Successfully generated {output_file}")
    print(json.dumps(manifest, indent=2))

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python generate_update_manifest.py <version> <tag_name>")
        sys.exit(1)
        
    version = sys.argv[1]
    tag_name = sys.argv[2]
    
    generate_manifest(version, tag_name)
