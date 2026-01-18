import os
import json
from pathlib import Path
from dotenv import load_dotenv

# Load .env first (Project specific overrides)
load_dotenv()

CONFIG_PATH = Path.home() / ".renamer_config.json"

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
    def GOOG_BOOKS_API_KEY(self):
         return os.getenv("GOOG_BOOKS_API_KEY") or self.file_config.get("GOOG_BOOKS_API_KEY")

    @property
    def DEST_DIR(self):
        val = os.getenv("DEST_DIR") or self.file_config.get("DEST_DIR")
        return Path(val) if val else Path("./organized")

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
        return self.file_config.get("MOVIE_TEMPLATE", "{title} ({year})/{title} ({year}){ext}")
        
    @property
    def TV_TEMPLATE(self):
        return self.file_config.get("TV_TEMPLATE", "{title}/Season {season}/{title} - s{season}e{episode}{ext}")

    @property
    def BOOK_TEMPLATE(self):
        return self.file_config.get("BOOK_TEMPLATE", "{author}/{title}/{title}{ext}")

    @property
    def AUDIOBOOK_TEMPLATE(self):
        return self.file_config.get("AUDIOBOOK_TEMPLATE", "{author}/{title}/{title}{ext}")
    
    def save(self, key: str, value: str):
        self.file_config[key] = value
        CONFIG_PATH.write_text(json.dumps(self.file_config, indent=2))

    def validate(self):
        if not self.TMDB_API_KEY:
            # print("Warning: TMDB_API_KEY is not set.")
            pass

config = Config()
