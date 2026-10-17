import logging
import os
from pathlib import Path
from typing import Generator

from src.config import config

VIDEO_EXTENSIONS = {'.mkv', '.mp4', '.avi', '.mov', '.wmv'}
AUDIO_EXTENSIONS = {'.mp3', '.m4b', '.flac', '.m4a'}
BOOK_EXTENSIONS = {'.epub', '.pdf', '.mobi', '.azw3'}

ALL_EXTENSIONS = VIDEO_EXTENSIONS | AUDIO_EXTENSIONS | BOOK_EXTENSIONS

logger = logging.getLogger(__name__)


def scan_directory(root_path: Path, min_video_size_mb: float) -> Generator[Path, None, None]:
    """
    Recursively scans the directory for media files.
    Folders or files that can't be read (permissions, broken links) are skipped.
    """
    def on_error(err: OSError):
        logger.warning(f"Skipping unreadable path during scan: {err}")

    for dirpath, _dirnames, filenames in os.walk(root_path, onerror=on_error):
        for name in filenames:
            path = Path(dirpath) / name
            suffix = path.suffix.lower()
            if suffix not in ALL_EXTENSIONS:
                continue

            # Check for sample
            if config.IGNORE_SAMPLES and "sample" in name.lower():
                continue

            # Check for size (only for videos)
            if suffix in VIDEO_EXTENSIONS:
                try:
                    size_mb = path.stat().st_size / (1024 * 1024)
                except OSError as e:
                    on_error(e)
                    continue
                if size_mb < min_video_size_mb:
                    continue

            yield path
