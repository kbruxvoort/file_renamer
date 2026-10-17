import os
import shutil
from pathlib import Path
from typing import Iterable, List, Optional

from src.scanner import ALL_EXTENSIONS

def get_unique_path(path: Path) -> Path:
    """
    Returns a unique path. If the path already exists, appends ' (n)' to the stem.
    e.g. file.txt -> file (1).txt -> file (2).txt
    """
    if not path.exists():
        return path
        
    parent = path.parent
    stem = path.stem
    suffix = path.suffix
    
    counter = 1
    while True:
        new_name = f"{stem} ({counter}){suffix}"
        new_path = parent / new_name
        if not new_path.exists():
            return new_path
        counter += 1

def find_associated_files(main_file: Path) -> List[Path]:
    """
    Finds files in the same directory that share the same stem (filename without extension),
    excluding the main file itself.
    """
    if not main_file.exists():
        return []

    parent = main_file.parent
    name_stem = main_file.stem
    
    # Simple strategy: look for files starting with the stem
    # careful not to match "Movie 2" when looking for "Movie"
    # So we'll iterate directory and check
    
    associated = []
    
    # We want exact stem match or stem + separator match
    # e.g. "Movie.mkv" -> "Movie.en.srt", "Movie-trailer.mov", "Movie.nfo"
    
    for item in parent.iterdir():
        if item.is_file() and item != main_file:
            # Check if it starts with the stem
            if item.name.startswith(name_stem):
                # Verify it's not just a similar named file (e.g. "Star Wars II" vs "Star Wars")
                # Acceptable suffixes after stem: . (ext), - (part), _ (part), ' ' (part)
                remainder = item.name[len(name_stem):]
                if not remainder: 
                     # Should catch if extensions match but we already excluded main_file
                     continue
                     
                # Other media files are separate items (e.g. "Movie - Director's Cut.mkv"),
                # never sidecars of this one
                if item.suffix.lower() in ALL_EXTENSIONS:
                    continue

                if remainder[0] in {'.', '-', '_', ' '}:
                    associated.append(item)
                    
    return associated

def move_file(source: Path, destination: Path) -> Path:
    """
    Moves a file to destination, handling collisions by renaming.
    Returns the final destination path.
    """
    if not source.exists():
        raise FileNotFoundError(f"Source file not found: {source}")
        
    # Ensure parent exists
    destination.parent.mkdir(parents=True, exist_ok=True)
    
    final_dest = get_unique_path(destination)
    shutil.move(str(source), str(final_dest))
    
    return final_dest

def is_within(path: Path, root: Path) -> bool:
    """True if `path` is `root` or inside it (case-insensitive on Windows)."""
    try:
        path = Path(os.path.normcase(os.path.abspath(path)))
        root = Path(os.path.normcase(os.path.abspath(root)))
    except (OSError, ValueError):
        return False
    return path == root or root in path.parents


def is_same_path(a: Path, b: Path) -> bool:
    """True if both point at the same location (case-insensitive on Windows)."""
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def find_root(path: Path, roots: Iterable[Optional[Path]]) -> Optional[Path]:
    """Returns the deepest root directory that contains `path`, if any."""
    matches = [r for r in roots if r and is_within(path, r)]
    return max(matches, key=lambda r: len(str(r)), default=None)


def clean_empty_dirs(path: Path, root_path: Optional[Path]):
    """
    Deletes empty directories starting from `path` and walking up.
    Stops at a non-empty directory, and never deletes `root_path` or anything
    outside it. Does nothing without a root.
    """
    if root_path is None or not path.is_dir():
        return

    if not is_within(path, root_path) or is_within(root_path, path):
        return
        
    try:
        # Check if empty (using iterdir which is a generator)
        if not any(path.iterdir()):
            path.rmdir()
            # Try to clean parent
            clean_empty_dirs(path.parent, root_path)
    except OSError:
        # Directory not empty or permission denied
        pass
    except Exception:
        pass
