import os
import json
from pathlib import Path
from dotenv import load_dotenv

# Load .env first (Project specific overrides)
load_dotenv()

CONFIG_PATH = Path.home() / ".renamer_config.json"

MEDIA_TYPES = ("movie", "tv", "book", "audiobook")

DEFAULT_TEMPLATES = {
    "MOVIE_TEMPLATE": "{title} ({year})/{title} ({year}){ext}",
    "TV_TEMPLATE": "{title}/Season {season}/{title} - s{season}e{episode}{ext}",
    "BOOK_TEMPLATE": "{author}/{title}/{title}{ext}",
    "AUDIOBOOK_TEMPLATE": "{author}/{title}/{title}{ext}",
}

class Config:
    def __init__(self):
        self._load_from_file()

    def _load_from_file(self):
        self.file_config = {}
        if CONFIG_PATH.exists():
            try:
                self.file_config = json.loads(CONFIG_PATH.read_text())
            except Exception:
                pass

    @property
    def TMDB_API_KEY(self):
        return os.getenv("TMDB_API_KEY") or self.file_config.get("TMDB_API_KEY")

    @property
    def DEST_DIR(self):
        val = os.getenv("DEST_DIR") or self.file_config.get("DEST_DIR")
        return Path(val) if val else Path.home() / "Sortify Library"

    @property
    def MOVIE_DIR(self):
        val = os.getenv("MOVIE_DIR") or self.file_config.get("MOVIE_DIR")
        return Path(val) if val else self.DEST_DIR / "Movies"

    @property
    def TV_DIR(self):
        val = os.getenv("TV_DIR") or self.file_config.get("TV_DIR")
        return Path(val) if val else self.DEST_DIR / "TV Shows"

    @property
    def BOOK_DIR(self):
        val = os.getenv("BOOK_DIR") or self.file_config.get("BOOK_DIR")
        return Path(val) if val else self.DEST_DIR / "Books"

    @property
    def AUDIOBOOK_DIR(self):
        val = os.getenv("AUDIOBOOK_DIR") or self.file_config.get("AUDIOBOOK_DIR")
        return Path(val) if val else self.DEST_DIR / "Audiobooks"

    @property
    def SOURCE_DIR(self):
        val = os.getenv("SOURCE_DIR") or self.file_config.get("SOURCE_DIR")
        return Path(val) if val else None

    @property
    def IGNORE_SAMPLES(self):
        return self.file_config.get("IGNORE_SAMPLES", True)

    @property
    def MIN_VIDEO_SIZE_MB(self):
        return self.file_config.get("MIN_VIDEO_SIZE_MB", 50)

    # Naming Templates
    @property
    def MOVIE_TEMPLATE(self):
        return self.file_config.get("MOVIE_TEMPLATE") or DEFAULT_TEMPLATES["MOVIE_TEMPLATE"]

    @property
    def TV_TEMPLATE(self):
        return self.file_config.get("TV_TEMPLATE") or DEFAULT_TEMPLATES["TV_TEMPLATE"]

    @property
    def BOOK_TEMPLATE(self):
        return self.file_config.get("BOOK_TEMPLATE") or DEFAULT_TEMPLATES["BOOK_TEMPLATE"]

    @property
    def AUDIOBOOK_TEMPLATE(self):
        return self.file_config.get("AUDIOBOOK_TEMPLATE") or DEFAULT_TEMPLATES["AUDIOBOOK_TEMPLATE"]

    def library_dir(self, media_type) -> Path:
        """Library folder for a media type ('movie', 'tv', 'book', 'audiobook')."""
        return {
            'movie': self.MOVIE_DIR,
            'tv': self.TV_DIR,
            'book': self.BOOK_DIR,
            'audiobook': self.AUDIOBOOK_DIR,
        }.get(media_type, self.DEST_DIR)

    def library_dirs(self) -> list:
        """Every folder files can be moved into (per-type folders and DEST_DIR)."""
        return [self.library_dir(t) for t in MEDIA_TYPES] + [self.DEST_DIR]

    def protected_dirs(self) -> list:
        """Folders cleanup must never delete: the source and library folders,
        and the home folder with its standard subfolders."""
        home = Path.home()
        standard = [home / name for name in ("Downloads", "Desktop", "Documents", "Videos", "Music", "Pictures")]
        return [self.SOURCE_DIR, *self.library_dirs(), home, *standard]

    def save(self, key: str, value: str):
        self.file_config[key] = value
        CONFIG_PATH.write_text(json.dumps(self.file_config, indent=2))

    def validate(self):
        if not self.TMDB_API_KEY:
            # print("Warning: TMDB_API_KEY is not set.")
            pass

config = Config()
