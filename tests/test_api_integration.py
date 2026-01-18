import pytest
from fastapi.testclient import TestClient
from pathlib import Path
from src.api import app
from src.config import config

client = TestClient(app)

@pytest.fixture
def temp_env(tmp_path):
    # Setup directories
    source = tmp_path / "source"
    dest = tmp_path / "dest"
    
    source.mkdir()
    dest.mkdir()
    
    # Store original config values
    orig_config = config.file_config.copy()
    
    # Override config by injecting into file_config dictionary
    # The Config properties check os.getenv then file_config
    config.file_config["DEST_DIR"] = str(dest)
    config.file_config["MOVIE_DIR"] = str(dest / "Movies")
    config.file_config["TV_DIR"] = str(dest / "TV")
    config.file_config["BOOK_DIR"] = str(dest / "Books")
    config.file_config["AUDIOBOOK_DIR"] = str(dest / "Audiobooks")
    config.file_config["SOURCE_DIR"] = str(source)
    
    yield source, dest
    
    # Restore
    config.file_config = orig_config

def test_execute_move_with_associations_renaming(temp_env):
    source_dir, dest_dir = temp_env
    
    # Create source files
    # Movie file
    movie = source_dir / "My.Test.Movie.2024.mkv"
    movie.touch()
    
    # Associated subtitle
    sub = source_dir / "My.Test.Movie.2024.en.srt"
    sub.touch()
    
    # Associated nfo
    nfo = source_dir / "My.Test.Movie.2024.nfo"
    nfo.touch()
    
    # Unrelated file
    other = source_dir / "Other.mkv"
    other.touch()

    # Payload mimicking what the frontend sends
    # We select a candidate that changes the name
    payload = {
        "files": [
            {
                "original_path": str(movie),
                "selected_candidate": {
                    "title": "Real Movie Title",
                    "year": 2024,
                    "type": "movie"
                }
            }
        ]
    }
    
    response = client.post("/execute", json=payload)
    assert response.status_code == 200
    data = response.json()
    
    assert len(data["moved"]) >= 1
    assert not data["errors"]
    
    # Verify Main File Moved
    # Config template default is unlikely to be exactly consistent without mocking everything, 
    # but we can check if file exists at the expected new location.
    # Default template: "{title} ({year})/{title} ({year}) - {resolution} {group}.{ext}"
    # Wait, the template might vary. Let's look at what was returned in "to"
    
    main_move = next(m for m in data["moved"] if not m.get("associated"))
    dest_path = Path(main_move["to"])
    
    assert dest_path.exists()
    assert "Real Movie Title (2024)" in str(dest_path)
    assert not movie.exists()
    
    # Verify Associated Files Moved and Renamed
    # They should share the stem of the new file
    new_stem = dest_path.stem # e.g. "Real Movie Title (2024) - "
    
    # Check .en.srt
    expected_sub = dest_path.parent / f"{new_stem}.en.srt"
    assert expected_sub.exists()
    assert not sub.exists()
    
    # Check .nfo
    expected_nfo = dest_path.parent / f"{new_stem}.nfo"
    assert expected_nfo.exists()
    assert not nfo.exists()
    
    # Verify unrelated file remains
    assert other.exists()

def test_execute_directory_cleanup(temp_env):
    source_dir, dest_dir = temp_env
    
    # Create nested empty dir structure
    nested = source_dir / "EmptyMove" / "Nested"
    nested.mkdir(parents=True)
    
    movie = nested / "Movie.mkv"
    movie.touch()
    
    payload = {
        "files": [
            {
                "original_path": str(movie),
                "selected_candidate": {
                    "title": "Clean Dir Movie",
                    "year": 2021,
                    "type": "movie"
                }
            }
        ]
    }
    
    response = client.post("/execute", json=payload)
    assert response.status_code == 200
    
    # Verify movie moved
    assert not movie.exists()
    
    # Verify cleanup: "Nested" and "EmptyMove" should be gone
    assert not nested.exists()
    assert not (source_dir / "EmptyMove").exists()
    
    # Source root should still exist
    assert source_dir.exists()
