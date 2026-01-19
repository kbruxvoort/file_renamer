import os
import shutil
import PyInstaller.__main__
from pathlib import Path

def build():
    # Define paths
    base_dir = Path(__file__).parent.parent
    src_dir = base_dir / "src"
    dist_dir = base_dir / "dist" # PyInstaller output
    target_bin_dir = base_dir / "gui" / "src-tauri" / "binaries"
    
    # Ensure binary dir exists
    target_bin_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"Building backend from {src_dir}...")
    
    # PyInstaller arguments
    args = [
        str(src_dir / "api.py"), # Use api.py as entry point
        "--name=renamer-api",
        "--onefile",
        "--noconfirm",
        "--clean",
        "--log-level=WARN",
        # Hidden imports for key dependencies that might be missed
        "--hidden-import=uvicorn",
        "--hidden-import=uvicorn.loops",
        "--hidden-import=uvicorn.loops.auto",
        "--hidden-import=uvicorn.protocols",
        "--hidden-import=uvicorn.protocols.http",
        "--hidden-import=uvicorn.protocols.http.auto",
        "--hidden-import=uvicorn.lifespan",
        "--hidden-import=uvicorn.lifespan.on",
        "--hidden-import=uvicorn.logging",
        "--hidden-import=fastapi",
        "--hidden-import=pydantic",
        "--hidden-import=rich",
        "--hidden-import=typer",
        "--hidden-import=tenacity",
        "--hidden-import=dotenv",
        "--hidden-import=bs4",
        "--hidden-import=aiohttp",
        "--hidden-import=requests",
        "--hidden-import=httpx",
        "--hidden-import=httpcore",
        "--collect-all=rich", # Collect rich assets/themes if needed
    ]
    
    PyInstaller.__main__.run(args)
    
    # Move binary to Tauri sidecar location
    # Tauri expects the binary to have the target triple attached
    # For now assuming Windows x86_64
    src_bin = dist_dir / "renamer-api.exe"
    target_bin = target_bin_dir / "renamer-api-x86_64-pc-windows-msvc.exe"
    
    if src_bin.exists():
        print(f"Moving binary to {target_bin}")
        shutil.copy2(src_bin, target_bin)
        print("Build successful!")
    else:
        print("Error: Binary not found after build.")

if __name__ == "__main__":
    build()
