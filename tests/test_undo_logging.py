import pytest
import time
from pathlib import Path
from src.undo import UndoManager
from src.api import app, undo_manager
from fastapi.testclient import TestClient

client = TestClient(app)

@pytest.fixture
def clean_undo_manager(tmp_path):
    # Mock the history file location
    hist_file = tmp_path / "history.json"
    undo_manager.history_file = hist_file
    undo_manager.history = []
    return undo_manager

def test_undo_manager_flow(clean_undo_manager, tmp_path):
    # Setup files
    src = tmp_path / "source.txt"
    src.write_text("content")
    dest = tmp_path / "dest.txt"
    
    # Simulate a move
    import shutil
    shutil.move(str(src), str(dest))
    
    # Record it
    clean_undo_manager.record_batch([{
        "src": str(src),
        "dest": str(dest)
    }])
    
    assert len(clean_undo_manager.history) == 1
    
    # Perform Undo
    result = clean_undo_manager.undo_last_batch()
    
    assert result['success'] is True
    assert result['restored_count'] == 1
    
    # Verify file is back
    assert src.exists()
    assert not dest.exists()
    assert src.read_text() == "content"
    
def test_undo_api_endpoint(clean_undo_manager):
    # Ensure history is empty
    clean_undo_manager.history = []
    
    # Call /history
    response = client.get("/history")
    assert response.status_code == 200
    assert response.json() == []

    # Call /undo (empty)
    response = client.post("/undo")
    assert response.status_code == 200
    assert response.json()['success'] is False

def test_logger_setup(tmp_path):
    from src import logger
    # Patch LOG_DIR to tmp
    logger.LOG_DIR = tmp_path
    logger.LOG_FILE = tmp_path / "test.log"
    
    logger.setup_logging()
    
    import logging as root_logging
    root_logging.info("Test Log Entry")
    
    assert logger.LOG_FILE.exists()
    content = logger.LOG_FILE.read_text(encoding='utf-8')
    assert "Test Log Entry" in content
