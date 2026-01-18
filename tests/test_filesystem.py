import pytest
import shutil
from pathlib import Path
from src import filesystem

@pytest.fixture
def temp_dir(tmp_path):
    d = tmp_path / "test_data"
    d.mkdir()
    return d

def test_get_unique_path_no_collision(temp_dir):
    target = temp_dir / "file.txt"
    assert filesystem.get_unique_path(target) == target

def test_get_unique_path_with_collision(temp_dir):
    target = temp_dir / "file.txt"
    target.touch()
    
    unique = filesystem.get_unique_path(target)
    assert unique == temp_dir / "file (1).txt"
    
    # Create the (1) file and test again
    unique.touch()
    unique_2 = filesystem.get_unique_path(target)
    assert unique_2 == temp_dir / "file (2).txt"

def test_find_associated_files(temp_dir):
    main = temp_dir / "movie.mkv"
    main.touch()
    
    sub = temp_dir / "movie.srt"
    sub.touch()
    
    extra = temp_dir / "movie.en.srt"
    extra.touch()
    
    unrelated = temp_dir / "other.mkv"
    unrelated.touch()
    
    # Should match stem
    assoc = filesystem.find_associated_files(main)
    assert len(assoc) == 2
    assert sub in assoc
    assert extra in assoc
    assert unrelated not in assoc

def test_move_file_simple(temp_dir):
    src = temp_dir / "source.txt"
    src.touch()
    dest = temp_dir / "dest" / "moved.txt"
    
    final = filesystem.move_file(src, dest)
    
    assert final == dest
    assert dest.exists()
    assert not src.exists()

def test_move_file_collision(temp_dir):
    src = temp_dir / "source.txt"
    src.write_text("source content")
    
    dest_dir = temp_dir / "dest"
    dest_dir.mkdir()
    
    existing = dest_dir / "file.txt"
    existing.write_text("existing content")
    
    final = filesystem.move_file(src, existing)
    
    assert final.name == "file (1).txt"
    assert final.read_text() == "source content"
    assert existing.read_text() == "existing content"

def test_clean_empty_dirs_simple(temp_dir):
    nested = temp_dir / "a" / "b" / "c"
    nested.mkdir(parents=True)
    
    filesystem.clean_empty_dirs(nested)
    
    assert not (temp_dir / "a").exists()

def test_clean_empty_dirs_stops_at_root(temp_dir):
    nested = temp_dir / "a" / "b"
    nested.mkdir(parents=True)
    
    filesystem.clean_empty_dirs(nested, root_path=temp_dir)
    
    assert temp_dir.exists()
    assert not (temp_dir / "a").exists()

def test_clean_empty_dirs_stops_at_non_empty(temp_dir):
    nested = temp_dir / "a" / "b"
    nested.mkdir(parents=True)
    
    (temp_dir / "a" / "file.txt").touch()
    
    filesystem.clean_empty_dirs(nested)
    
    assert (temp_dir / "a").exists()
    assert not (temp_dir / "a" / "b").exists()
