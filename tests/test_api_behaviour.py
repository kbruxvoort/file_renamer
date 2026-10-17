from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

import src.api as api
from src import filesystem
from src.api import app
from src.config import config
from src.undo import undo_manager

client = TestClient(app)


@pytest.fixture
def library(tmp_path):
    source = tmp_path / "source"
    dest = tmp_path / "dest"
    source.mkdir()
    dest.mkdir()

    orig_config = config.file_config.copy()
    config.file_config.update({
        "DEST_DIR": str(dest),
        "MOVIE_DIR": str(dest / "Movies"),
        "TV_DIR": str(dest / "TV"),
        "BOOK_DIR": str(dest / "Books"),
        "AUDIOBOOK_DIR": str(dest / "Audiobooks"),
    })
    config.file_config.pop("SOURCE_DIR", None)

    orig_history_file, orig_history = undo_manager.history_file, undo_manager.history
    undo_manager.history_file = tmp_path / "history.json"
    undo_manager.history = []

    yield source, dest

    config.file_config = orig_config
    undo_manager.history_file, undo_manager.history = orig_history_file, orig_history


# ---------- Auth ----------

def test_token_required_when_configured():
    with patch.object(api, "API_TOKEN", "secret"):
        assert client.get("/history").status_code == 401
        assert client.get("/history", headers={"X-Sortify-Token": "wrong"}).status_code == 401
        assert client.get("/history", headers={"X-Sortify-Token": "secret"}).status_code == 200
        # Health check stays open so the UI can tell the backend is up
        assert client.get("/health").status_code == 200


def test_cors_rejects_unknown_origin():
    response = client.options("/execute", headers={
        "Origin": "https://evil.example",
        "Access-Control-Request-Method": "POST",
    })
    assert "access-control-allow-origin" not in response.headers


# ---------- Scan ----------

def test_scan_reports_missing_tmdb_key(library, monkeypatch):
    source, _ = library
    (source / "Some.Movie.2020.mkv").write_bytes(b"x")
    monkeypatch.delenv("TMDB_API_KEY", raising=False)
    config.file_config.pop("TMDB_API_KEY", None)

    response = client.post("/scan", json={"paths": [str(source)], "min_size_mb": 0})

    assert response.status_code == 200
    assert any("TMDB API key" in w for w in response.json()["warnings"])


def test_scan_cancel(library):
    source, _ = library
    for i in range(3):
        (source / f"Movie.{2000 + i}.mkv").write_bytes(b"x")

    async def cancel_during_lookup(*_args, **_kwargs):
        api.scan_jobs["job1"]["cancelled"] = True
        return []

    with patch.object(api.renamer, "get_candidates", side_effect=cancel_during_lookup):
        response = client.post("/scan", json={"paths": [str(source)], "min_size_mb": 0, "scan_id": "job1"})

    assert response.status_code == 409
    assert client.get("/scan/job1/progress").json()["cancelled"] is True


def test_scan_does_not_serialize_movie_folders(library):
    """Non-TV folders must go straight to parallel matching (no one-by-one priming)."""
    source, _ = library
    for i in range(4):
        (source / f"Movie.{2000 + i}.mkv").write_bytes(b"x")

    calls = []

    async def fake_process(*args, **kwargs):
        calls.append(args[0]["title"])
        return []

    with patch.object(api.renamer, "get_candidates", side_effect=fake_process):
        response = client.post("/scan", json={"paths": [str(source)], "min_size_mb": 0})

    assert response.status_code == 200
    assert len(calls) == 4
    # Unmatched files get no proposed path
    assert all(f["proposed_path"] is None for f in response.json()["files"])


# ---------- Execute ----------

def test_execute_uses_previewed_path(library):
    source, dest = library
    episode = source / "Show.S01E02.mkv"
    episode.write_bytes(b"x")
    previewed = dest / "TV" / "Show" / "Season 01" / "Show - s01e02 - The Real Title.mkv"

    response = client.post("/execute", json={"files": [{
        "original_path": str(episode),
        "selected_candidate": {"title": "Show", "type": "tv", "id": 1},
        "proposed_path": str(previewed),
    }]})

    assert response.status_code == 200
    assert previewed.exists()


def test_execute_ignores_previewed_path_outside_library(library, tmp_path):
    source, dest = library
    movie = source / "Movie.mkv"
    movie.write_bytes(b"x")
    outside = tmp_path / "elsewhere" / "Movie.mkv"

    client.post("/execute", json={"files": [{
        "original_path": str(movie),
        "selected_candidate": {"title": "Movie", "year": 2020, "type": "movie"},
        "proposed_path": str(outside),
    }]})

    assert not outside.exists()
    assert (dest / "Movies" / "Movie (2020)" / "Movie (2020).mkv").exists()


def test_other_media_files_are_not_sidecars(tmp_path):
    main = tmp_path / "Alien.mkv"
    cut = tmp_path / "Alien - Director's Cut.mkv"
    subs = tmp_path / "Alien.en.srt"
    for f in (main, cut, subs):
        f.write_bytes(b"x")

    assert filesystem.find_associated_files(main) == [subs]


# ---------- Undo ----------

def test_undo_keeps_blocked_operations_for_retry(library):
    source, dest = library
    original = source / "a.mkv"
    moved = dest / "a.mkv"
    moved.write_bytes(b"x")
    original.write_bytes(b"blocker")  # original location occupied
    undo_manager.record_batch([{"src": str(original), "dest": str(moved)}])

    result = client.post("/undo").json()
    assert result["success"] is False
    assert result["failure_count"] == 1
    assert len(undo_manager.history) == 1  # still there to retry

    original.unlink()
    result = client.post("/undo").json()
    assert result["success"] is True
    assert original.exists()
    assert undo_manager.history == []


def test_undo_specific_batch(library):
    source, dest = library
    batches = []
    for name in ("first", "second"):
        src, dst = source / f"{name}.mkv", dest / f"{name}.mkv"
        dst.write_bytes(b"x")
        undo_manager.record_batch([{"src": str(src), "dest": str(dst)}])
        batches.append(undo_manager.history[0]["batch_id"])

    result = client.post("/undo", json={"batch_id": batches[0]}).json()

    assert result["success"] is True
    assert (source / "first.mkv").exists()
    assert (dest / "second.mkv").exists()
    assert [b["batch_id"] for b in undo_manager.history] == [batches[1]]


# ---------- Config ----------

def test_template_preview(library):
    ok = client.post("/template_preview", json={"template": "{title} ({year}){ext}", "type": "movie"}).json()
    bad = client.post("/template_preview", json={"template": "{title", "type": "movie"}).json()

    assert ok["error"] is None and ok["path"].endswith("The Matrix (1999).mkv")
    assert bad["path"] is None and bad["error"]


def test_rejected_tmdb_key_is_not_saved():
    with patch.object(api.tmdb_client, "validate_key", AsyncMock(return_value=False)), \
         patch.object(config, "save") as save:
        response = client.post("/config", json={"key": "TMDB_API_KEY", "value": "bad"})

    assert response.status_code == 400
    save.assert_not_called()
