import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
from src.renamer import Renamer
from src.config import config

@pytest.fixture
def renamer():
    return Renamer()

@pytest.fixture(autouse=True)
def mock_config():
    """Ensure config is clean/mocked for all tests in this file."""
    # We patch the underlying file_config dict to be empty so defaults are used
    with patch('src.renamer.config.file_config', {}):
        yield

class TestRenamerProposePath:

    def test_propose_movie_path(self, renamer):
        """Test Movie template generation."""
        # Setup config defaults (though config.py should have defaults)
        # Assuming MOVIE_TEMPLATE = "{title} ({year})/{title} ({year}){ext}"
        
        current = Path("old_movie.mkv")
        metadata = {
            'type': 'movie',
            'title': 'The Matrix',
            'year': 1999
        }
        
        new_path = renamer.propose_new_path(current, metadata)
        
        # We check expectation based on default config
        # If default is {title} ({year})/{title} ({year}){ext}
        expected = Path("The Matrix (1999)/The Matrix (1999).mkv")
        assert new_path == expected

    def test_propose_tv_path(self, renamer):
        """Test TV template generation (Season/Episode padding)."""
        # TV_TEMPLATE = "{title}/Season {season}/{title} - s{season}e{episode}{ext}"
        
        current = Path("raw.mkv")
        metadata = {
            'type': 'tv',
            'title': 'Lost',
            'season': 1,
            'episode': 4,
            'episode_title': 'Walkabout'
        }
        
        new_path = renamer.propose_new_path(current, metadata)
        
        # Logic ensures season/episode are zero-padded
        # Default config uses lowercase 's' and 'e'
        expected = Path("Lost/Season 01/Lost - s01e04.mkv")
        assert new_path == expected

    def test_propose_tv_path_missing_ep_title(self, renamer):
        """Test fallback when episode title is missing."""
        current = Path("raw.mkv")
        metadata = {
            'type': 'tv',
            'title': 'Lost',
            'season': 1,
            'episode': 1
        }
        
        new_path = renamer.propose_new_path(current, metadata)
        
        # Default template doesn't actually use {episode_title} in the filename!
        # It is: "{title}/Season {season}/{title} - s{season}e{episode}{ext}"
        expected = Path("Lost/Season 01/Lost - s01e01.mkv")
        assert new_path == expected

    def test_propose_book_path(self, renamer):
        """Test Book template."""
        # BOOK_TEMPLATE = "{author}/{title}/{title}{ext}"
        
        current = Path("raw.epub")
        metadata = {
            'type': 'book',
            'title': 'Dune',
            'author': 'Frank Herbert',
            'year': 1965
        }
        
        new_path = renamer.propose_new_path(current, metadata)
        expected = Path("Frank Herbert/Dune/Dune.epub")
        assert new_path == expected

    def test_sanitization(self, renamer):
        """Test removal of illegal characters (colon)."""
        current = Path("raw.mkv")
        metadata = {
            'type': 'movie',
            'title': 'Mission: Impossible',
            'year': 1996
        }
        
        new_path = renamer.propose_new_path(current, metadata)
        # "Mission: Impossible" -> "Mission - Impossible"
        expected = Path("Mission - Impossible (1996)/Mission - Impossible (1996).mkv")
        assert new_path == expected
