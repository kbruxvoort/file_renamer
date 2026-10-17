import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from pathlib import Path
from src.api import app
import src.api as api
from src.config import config
from src.undo import undo_manager

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

    # Keep test batches out of the user's real undo history
    orig_history_file, orig_history = undo_manager.history_file, undo_manager.history
    undo_manager.history_file = tmp_path / "history.json"
    undo_manager.history = []

    yield source, dest

    # Restore
    config.file_config = orig_config
    undo_manager.history_file, undo_manager.history = orig_history_file, orig_history

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
    dest_path = Path(main_move["dest"])

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

def test_execute_skips_unmatched_files(temp_env):
    source_dir, dest_dir = temp_env
    unknown = source_dir / "random_clip.mkv"
    unknown.touch()

    response = client.post("/execute", json={"files": [
        {"original_path": str(unknown), "selected_candidate": None},
    ]})

    data = response.json()
    assert response.status_code == 200
    assert data["moved"] == []
    assert len(data["skipped"]) == 1
    assert unknown.exists()
    assert not any(dest_dir.iterdir())

def _move_tv(files, scanned):
    return client.post("/execute", json={
        "files": [{"original_path": str(f), "selected_candidate": {"title": "The Bear", "type": "tv", "id": 1}} for f in files],
        "source_roots": [str(scanned)],
    })

def test_execute_removes_scanned_release_folder_once_empty(temp_env):
    """Scanning a release folder directly: once every episode has moved, the folder goes."""
    source_dir, dest_dir = temp_env
    config.file_config.pop("SOURCE_DIR")
    scanned = source_dir / "The.Bear.S05.1080p.WEB-DL"
    scanned.mkdir()
    episodes = [scanned / f"The.Bear.S05E0{i}.mkv" for i in (1, 2)]
    for e in episodes:
        e.touch()

    with patch.object(api.tmdb_client, "get_episode_details", AsyncMock(return_value={})):
        assert _move_tv(episodes, scanned).status_code == 200

    assert not scanned.exists()
    assert source_dir.exists()  # never above the scanned folder

def test_execute_keeps_scanned_folder_with_leftover_files(temp_env):
    source_dir, dest_dir = temp_env
    config.file_config.pop("SOURCE_DIR")
    scanned = source_dir / "The.Bear.S05"
    scanned.mkdir()
    episode = scanned / "The.Bear.S05E01.mkv"
    episode.touch()
    (scanned / "notes.txt").touch()

    with patch.object(api.tmdb_client, "get_episode_details", AsyncMock(return_value={})):
        _move_tv([episode], scanned)

    assert scanned.exists() and (scanned / "notes.txt").exists()

def test_execute_never_removes_protected_scanned_folder(temp_env, tmp_path):
    """Scanning ~/Downloads must not delete Downloads, even when it ends up empty."""
    source_dir, dest_dir = temp_env
    config.file_config.pop("SOURCE_DIR")
    home = tmp_path / "home"
    downloads = home / "Downloads"
    downloads.mkdir(parents=True)
    movie = downloads / "Movie.mkv"
    movie.touch()

    with patch("pathlib.Path.home", return_value=home):
        response = client.post("/execute", json={
            "files": [{"original_path": str(movie), "selected_candidate": {"title": "Movie", "year": 2020, "type": "movie"}}],
            "source_roots": [str(downloads)],
        })

    assert response.status_code == 200
    assert not movie.exists()
    assert downloads.exists()

def test_execute_records_actual_associated_destination(temp_env):
    source_dir, dest_dir = temp_env
    movie = source_dir / "Clip.mkv"
    sub = source_dir / "Clip.srt"
    movie.touch()
    sub.touch()
    # Pre-existing subtitle forces a collision rename to "... (1).srt"
    existing = dest_dir / "Movies" / "Collide (2020)" / "Collide (2020).srt"
    existing.parent.mkdir(parents=True)
    existing.touch()

    response = client.post("/execute", json={"files": [
        {"original_path": str(movie), "selected_candidate": {"title": "Collide", "year": 2020, "type": "movie"}},
    ]})

    assoc = next(m for m in response.json()["moved"] if m.get("associated"))
    assert Path(assoc["dest"]).exists()
    assert Path(assoc["dest"]).name == "Collide (2020) (1).srt"

def test_config_rejects_invalid_template(temp_env):
    with patch.object(config, "save") as save:
        response = client.post("/config", json={"key": "MOVIE_TEMPLATE", "value": "{title"})
    assert response.status_code == 400
    save.assert_not_called()
