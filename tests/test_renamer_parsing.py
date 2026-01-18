import pytest
from pathlib import Path
from src.renamer import Renamer

@pytest.fixture
def renamer():
    return Renamer()

class TestRenamerParsing:
    
    def test_parse_tv_standard_sxxexx(self, renamer):
        """Test Standard S01E01 pattern."""
        info = renamer.parse_filename(Path("Breaking Bad.S05E14.Ozymandias.mkv"))
        assert info['type'] == 'tv'
        assert info['title'] == 'Breaking Bad'
        assert info['season'] == 5
        assert info['episode'] == 14
        assert info['episode_title'] == 'Ozymandias'

    def test_parse_tv_spaces_sxx_exx(self, renamer):
        """Test space separated S01 E01 pattern."""
        info = renamer.parse_filename(Path("The Office S02E04 The Fire.avi"))
        assert info['type'] == 'tv'
        assert info['title'] == 'The Office'
        assert info['season'] == 2
        assert info['episode'] == 4
        # Note: Depending on regex, "The Fire" might be captured or not. 
        # The current regex captures suffix after SxxExx.
        assert info.get('episode_title') == 'The Fire'

    def test_parse_movie_year_parens(self, renamer):
        """Test Movie with (Year)."""
        info = renamer.parse_filename(Path("The Matrix (1999).mkv"))
        assert info['type'] == 'movie'
        assert info['title'] == 'The Matrix'
        assert info['year'] == 1999

    def test_parse_movie_year_dots(self, renamer):
        """Test Movie with .Year. format."""
        info = renamer.parse_filename(Path("Inception.2010.1080p.mkv"))
        assert info['type'] == 'movie'
        assert info['title'] == 'Inception'
        assert info['year'] == 2010
        
    def test_parse_simple_movie_fallback(self, renamer):
        """Test fallback when no year is present (should be unknown or handled gracefully)."""
        # Current logic defaults to 'unknown' if no patterns match, or blindly accepts stem
        info = renamer.parse_filename(Path("MyHomeMovie.mp4"))
        # Based on current code:
        assert info['type'] == 'unknown'
        assert info['title'] == 'MyHomeMovie'

    def test_parse_audiobook_extension(self, renamer):
        """Test detection by extension (m4b/mp3)."""
        info = renamer.parse_filename(Path("Harry Potter 1.m4b"))
        assert info['type'] == 'audiobook'
        assert info['is_audio'] is True
        assert info['title'] == 'Harry Potter 1'

    def test_parse_ebook_extension(self, renamer):
        """Test detection by extension (epub)."""
        info = renamer.parse_filename(Path("Project Hail Mary.epub"))
        assert info['type'] == 'book'
        assert 'is_audio' not in info or not info['is_audio']
        assert info['title'] == 'Project Hail Mary'

    def test_smart_parsing_folder_context_tv(self, renamer):
        """Test parsing based on parent folder (Season 1)."""
        # Mock path structure: Show Name/Season 1/01 - Pilot.mkv
        path = Path("Lost/Season 1/01 - Pilot.mkv")
        info = renamer.parse_filename(path)
        
        # It relies on parent.name ('Season 1') and parent.parent.name ('Lost')
        # We need to ensure pathlib resolves these names correctly even if likely not on disk
        # The code just uses .name, so string manipulation is safe.
        
        assert info['type'] == 'tv'
        assert info['season'] == 1
        assert info['episode'] == 1
        
        # Note: The code blindly takes grandparent name. 
        # If path is relative "Season 1/01...", grandparent might be empty/dot.
        # But here we provided 'Lost/Season 1/...'
        assert info['title'] == 'Lost'

    def test_smart_parsing_folder_context_tv_with_year(self, renamer):
        """Test parsing Show Name (2022)/Season 1/..."""
        path = Path("Reacher (2022)/Season 01/Reacher.S01E01.mkv")
        # Even if the file has S01E01 info, the smart parser (Strategy 2) 
        # might trigger if Strategy 1 fails OR strategy 1 runs first?
        # Code order: 
        # 1. TV Pattern (SxxExx) on filename -> Returns immediately.
        # 2. Smart Folder Context -> Only if #1 fails.
        
        # Here "Reacher.S01E01.mkv" matches #1.
        info = renamer.parse_filename(path)
        assert info['type'] == 'tv'
        assert info['title'] == 'Reacher' # Extracted from filename
        assert info['season'] == 1
        assert info['episode'] == 1
        
    def test_smart_parsing_folder_fallback(self, renamer):
        """Test file without SxxExx inside a Season folder."""
        path = Path("Firefly/Season 1/01.mkv")
        info = renamer.parse_filename(path)
        
        assert info['type'] == 'tv'
        assert info['season'] == 1
        assert info['episode'] == 1
        assert info['title'] == 'Firefly'
