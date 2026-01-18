from pathlib import Path
from typing import List, Generator

VIDEO_EXTENSIONS = {'.mkv', '.mp4', '.avi', '.mov', '.wmv'}
AUDIO_EXTENSIONS = {'.mp3', '.m4b', '.flac', '.m4a'}
BOOK_EXTENSIONS = {'.epub', '.pdf', '.mobi'}

from src.config import config

ALL_EXTENSIONS = VIDEO_EXTENSIONS | AUDIO_EXTENSIONS | BOOK_EXTENSIONS

def scan_directory(root_path: Path, min_video_size_mb: float) -> Generator[Path, None, None]:
    """
    recursively scans the directory for media files.
    """
    for path in root_path.rglob('*'):
        if path.is_file() and path.suffix.lower() in ALL_EXTENSIONS:
            # Check for sample
            if config.IGNORE_SAMPLES and "sample" in path.name.lower():
                continue
                
            # Check for size (only for videos)
            if path.suffix.lower() in VIDEO_EXTENSIONS:
                size_mb = path.stat().st_size / (1024 * 1024)
                if size_mb < min_video_size_mb:
                    continue
            
            yield path
