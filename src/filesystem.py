import shutil
from pathlib import Path
from typing import List, Optional

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

def clean_empty_dirs(path: Path, root_path: Optional[Path] = None):
    """
    Recursively deletes empty directories starting from `path` walking up.
    Stops if it hits `root_path` or a non-empty directory.
    """
    if not path.is_dir():
        return

    # Don't delete beyond root_path if specified
    if root_path and path == root_path:
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
