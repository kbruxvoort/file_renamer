from pathlib import Path
from src.renamer import renamer

def test_parsing_2x01_format():
    # Test case from user
    filename = Path("Pokemon - 2x01 - Pallet Party Panic.mkv")
    result = renamer.parse_filename(filename)
    
    # We expect it to parse, but currently it likely fails or returns defaults
    # This test asserts the DESIRED behavior
    assert result.get('season') == 2, f"Expected season 2, got {result.get('season')}"
    assert result.get('episode') == 1, f"Expected episode 1, got {result.get('episode')}"
    assert result.get('type') == 'tv', f"Expected type 'tv', got {result.get('type')}"

def test_parsing_standard_format():
    filename = Path("Pokemon.S02E01.mkv")
    result = renamer.parse_filename(filename)
    assert result.get('season') == 2
    assert result.get('episode') == 1
    assert result.get('type') == 'tv'
