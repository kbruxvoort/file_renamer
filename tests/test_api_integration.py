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
    with patch.object(api.tmdb_client, "get_episode_details", AsyncMock(return_value={})):
        return client.post("/execute", json={
            "files": [{"original_path": str(f), "selected_candidate": {"title": "The Bear", "type": "tv", "id": 1}} for f in files],
            "source_roots": [str(scanned)],
        })

def _release_folder(parent, name="The.Bear.S05.1080p.WEB-DL", extra=()):
    folder = parent / name
    folder.mkdir(parents=True)
    episodes = [folder / f"The.Bear.S05E0{i}.mkv" for i in (1, 2)]
    for f in [*episodes, *(folder / e for e in extra)]:
        f.touch()
    return folder, episodes

@pytest.fixture
def no_source_dir(temp_env, tmp_path):
    """No SOURCE_DIR, and a fake home so standard folders are under tmp_path."""
    config.file_config.pop("SOURCE_DIR")
    home = tmp_path / "home"
    (home / "Downloads").mkdir(parents=True)
    with patch("src.config.Path.home", return_value=home):
        yield temp_env, home

def test_release_folder_inside_library_is_removed_once_empty(no_source_dir):
    """The reported case: scanning Y:/Library/TV Shows/<release folder>."""
    (source_dir, dest_dir), _ = no_source_dir
    folder, episodes = _release_folder(dest_dir / "TV")

    assert _move_tv(episodes, folder).status_code == 200

    assert not folder.exists()
    assert (dest_dir / "TV").exists()

def test_release_folder_inside_downloads_is_removed_once_empty(no_source_dir):
    _, home = no_source_dir
    folder, episodes = _release_folder(home / "Downloads")

    _move_tv(episodes, folder)

    assert not folder.exists()
    assert (home / "Downloads").exists()

def test_scanned_downloads_itself_is_kept(no_source_dir):
    _, home = no_source_dir
    downloads = home / "Downloads"
    episode = downloads / "The.Bear.S05E01.mkv"
    episode.touch()

    _move_tv([episode], downloads)

    assert not episode.exists()
    assert downloads.exists()

def test_unknown_long_lived_folder_is_kept(no_source_dir):
    """e.g. a torrent client's D:/Torrents/Complete: its parent isn't a known container."""
    (source_dir, _), _ = no_source_dir
    inbox, episodes = _release_folder(source_dir / "Torrents", name="Complete")

    _move_tv(episodes, inbox)

    assert inbox.exists()

def test_release_folder_with_leftover_files_is_kept(no_source_dir):
    _, home = no_source_dir
    folder, episodes = _release_folder(home / "Downloads", extra=("notes.txt",))

    _move_tv(episodes, folder)

    assert folder.exists() and (folder / "notes.txt").exists()

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
