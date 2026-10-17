import asyncio
from pathlib import Path
from unittest.mock import patch

import pytest

from src.renamer import Renamer, TemplateError, validate_template


@pytest.fixture
def renamer():
    return Renamer()


@pytest.fixture(autouse=True)
def default_templates():
    with patch('src.renamer.config.file_config', {}):
        yield


@pytest.mark.parametrize("path, expected_title", [
    # Folders ending in "s <digits>" used to be read as TV season folders
    (Path("dl") / "The Avengers 2012" / "The.Avengers.2012.1080p.mkv", "The Avengers"),
    (Path("dl") / "Movies 2020" / "Inception.2010.mkv", "Inception"),
])
def test_movie_in_year_folder_is_not_tv(renamer, path, expected_title):
    info = renamer.parse_filename(path)
    assert info["type"] == "movie"
    assert info["title"] == expected_title


@pytest.mark.parametrize("folder, season", [("Season 1", 1), ("season.02", 2), ("Series 3", 3), ("S04", 4)])
def test_season_folders_still_detected(renamer, folder, season):
    info = renamer.parse_filename(Path("Show") / folder / "01 - Pilot.mkv")
    assert info["type"] == "tv"
    assert info["season"] == season
    assert info["title"] == "Show"


@pytest.mark.parametrize("ext, expected", [(".flac", "audiobook"), (".m4a", "audiobook"), (".azw3", "book")])
def test_all_scanned_book_extensions_are_classified(renamer, ext, expected):
    assert renamer.parse_filename(Path(f"Dune{ext}"))["type"] == expected


def test_illegal_characters_removed(renamer):
    rel = renamer.propose_new_path(Path("a.mkv"), {"type": "movie", "title": 'What If...? <Pilot> "Cut"', "year": 2021})
    assert not any(c in str(rel) for c in '<>"|?*')


def test_slash_in_title_does_not_create_folders(renamer):
    rel = renamer.propose_new_path(Path("a.mkv"), {"type": "movie", "title": "Face/Off", "year": 1997})
    assert rel == Path("Face-Off (1997)") / "Face-Off (1997).mkv"


@pytest.mark.parametrize("year", [None, ""])
def test_missing_year_leaves_no_trailing_space_or_none(renamer, year):
    rel = renamer.propose_new_path(Path("a.mkv"), {"type": "movie", "title": "Movie", "year": year})
    assert rel == Path("Movie") / "Movie.mkv"


def test_none_author_uses_default(renamer):
    rel = renamer.propose_new_path(Path("a.epub"), {"type": "book", "title": "Dune", "author": None})
    assert rel.parts[0] == "Unknown Author"


def test_template_cannot_escape_library(renamer):
    with patch('src.renamer.config.file_config', {"MOVIE_TEMPLATE": "../../{title}{ext}"}):
        rel = renamer.propose_new_path(Path("a.mkv"), {"type": "movie", "title": "X"})
    assert ".." not in rel.parts


def test_malformed_template_raises_instead_of_dumping_in_library_root(renamer):
    with patch('src.renamer.config.file_config', {"MOVIE_TEMPLATE": "{title"}):
        with pytest.raises(TemplateError):
            renamer.propose_new_path(Path("a.mkv"), {"type": "movie", "title": "X"})


@pytest.mark.parametrize("template, ok", [
    ("{title} ({year})/{title} ({year}){ext}", True),
    ("{title", False),
    ("{nope}{ext}", False),
])
def test_validate_template(template, ok):
    assert (validate_template(template) is None) == ok


@pytest.mark.parametrize("filename, expected", [
    ("Breaking.Bad.S01E01.Pilot.720p.HDTV.x264-GRP.mkv", "Pilot"),
    ("The.Office.S02E01.The.Dundies.mkv", "The Dundies"),
    ("Show.S01E02.1080p.WEB-DL.mkv", None),
])
def test_episode_title_drops_release_tags(renamer, filename, expected):
    assert renamer.parse_filename(Path(filename)).get("episode_title") == expected


def test_next_year_release_is_still_a_movie(renamer):
    from datetime import datetime
    year = datetime.now().year + 1
    info = renamer.parse_filename(Path(f"Future.Movie.{year}.mkv"))
    assert info["type"] == "movie" and info["year"] == year


def test_tv_candidates_use_show_premiere_year(renamer):
    """{year} for TV must be the show's year, not the episode's air year,
    or one show gets split across several "Show (YYYY)" folders."""
    from unittest.mock import AsyncMock
    search = {"results": [{"name": "Breaking Bad", "first_air_date": "2008-01-20", "id": 1396}]}
    episode = {"name": "Seven Thirty-Seven", "air_date": "2009-03-08"}
    with patch('src.renamer.tmdb_client.search_tv', AsyncMock(return_value=search)), \
         patch('src.renamer.tmdb_client.get_episode_details', AsyncMock(return_value=episode)):
        cands = asyncio.run(renamer.get_candidates({"type": "tv", "title": "Breaking Bad", "season": 2, "episode": 1}))

    assert cands[0]["year"] == 2008
    assert cands[0]["episode_title"] == "Seven Thirty-Seven"


@pytest.mark.parametrize("template", [r"..\..\{title}{ext}", r"C:\x\{title}{ext}", "../{title}{ext}"])
def test_backslash_and_drive_templates_stay_inside_library(renamer, template):
    with patch('src.renamer.config.file_config', {"MOVIE_TEMPLATE": template}):
        rel = renamer.propose_new_path(Path("a.mkv"), {"type": "movie", "title": "X"})
    assert ".." not in rel.parts and not rel.drive and not rel.is_absolute()


def test_backslash_template_components_are_cleaned(renamer):
    with patch('src.renamer.config.file_config', {"MOVIE_TEMPLATE": r"{title} ({year})\{title} ({year}){ext}"}):
        rel = renamer.propose_new_path(Path("a.mkv"), {"type": "movie", "title": "Mr.", "year": None})
    assert rel == Path("Mr") / "Mr.mkv"


def test_template_without_ext_is_rejected():
    assert validate_template("{title} ({year})") is not None
