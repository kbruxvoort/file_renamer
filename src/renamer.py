import re
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, Any

from src.api_clients.tmdb import tmdb_client
from src.api_clients.books import books_client
from src.api_clients.itunes import itunes_client
from src.config import config
from src.scanner import AUDIO_EXTENSIONS, BOOK_EXTENSIONS
from src.api_clients.retry import MissingApiKeyError

logger = logging.getLogger(__name__)

# Characters that are illegal in Windows file/folder names (plus control chars).
# '/' and '\' are handled separately so values can't introduce extra folder levels.
ILLEGAL_PATH_CHARS = re.compile(r'[<>"|?*\x00-\x1f]')

# A folder that names a season: "Season 1", "Series 02", "S01" (whole name only for the short form)
SEASON_FOLDER_PATTERN = re.compile(r'\b(?:season|series)[\s._-]*(\d{1,3})\b|^s(\d{1,3})$', re.IGNORECASE)


RELEASE_TAG_PATTERN = re.compile(
    r'\b(?:\d{3,4}p|hdtv|web(?:-?dl|rip)?|blu-?ray|bdrip|dvdrip|hdrip|x26[45]|h\.?26[45]|hevc|xvid|aac\d?|ac3|dts|proper|repack)\b.*$',
    re.IGNORECASE,
)


def _clean_episode_title(raw: str) -> Optional[str]:
    title = RELEASE_TAG_PATTERN.sub('', raw.replace('.', ' ')).strip(' -_')
    return title or None


def _max_year() -> int:
    """Latest plausible release year (next year, for early releases)."""
    return datetime.now().year + 1


def _truncate(text: Optional[str], length: int) -> str:
    if not text:
        return ''
    return text if len(text) <= length else text[:length].rstrip() + "..."


def _clean_value(value: Any) -> str:
    """Makes a single metadata value safe to drop into one path component."""
    if value is None:
        return ''
    text = str(value).replace(':', ' -').replace('/', '-').replace('\\', '-')
    return ILLEGAL_PATH_CHARS.sub('', text)


def _clean_component(part: str) -> str:
    """Tidies a formatted path component: drops empty brackets, collapses spaces,
    and strips the trailing spaces/dots/dashes Windows can't handle."""
    part = re.sub(r'\(\s*\)|\[\s*\]', '', part)
    part = re.sub(r'\s{2,}', ' ', part)
    return part.strip().rstrip(' .-').strip()

class Renamer:
    def parse_filename(self, file_path: Path | str) -> Dict[str, str]:
        """
        Parses filename and directory structure for metadata.
        Extracts title, year, season, episode.
        """
        info = {}
        path_obj = Path(file_path)
        filename = path_obj.name
        ext = path_obj.suffix.lower()

        # Audiobooks / Books
        # Simple heuristic: if extension is typical for books/audiobooks
        if ext in BOOK_EXTENSIONS or ext in AUDIO_EXTENSIONS:
             if ext in AUDIO_EXTENSIONS:
                 info['type'] = 'audiobook'
                 info['is_audio'] = True
             else:
                 info['type'] = 'book'

             # Remove extension for title guess
             info['title'] = path_obj.stem.replace('.', ' ').strip()
             return info

        # 1. Try Standard TV pattern first (SxxExx)
        # Matches: Show.S01E01.Title.mkv or Show S01E01 Title.mkv
        tv_pattern = re.search(r'(.+?)[ .][sS](\d{1,2})[eE](\d{1,2})(?:[ .-]*(.+?))?$', path_obj.stem)

        # 1b. Try "2x01" Pattern
        # Matches: Show - 2x01 - Title.mkv
        if not tv_pattern:
             tv_pattern_b = re.search(r'(.+?)(?:[ .-]+|\s+-\s+)(\d{1,2})[xX](\d{1,2})(?:[ .-]*(.+?))?$', path_obj.stem)
             if tv_pattern_b:
                 info['title'] = tv_pattern_b.group(1).replace('.', ' ').strip(' -')
                 info['season'] = int(tv_pattern_b.group(2))
                 info['episode'] = int(tv_pattern_b.group(3))
                 if tv_pattern_b.group(4):
                      info['episode_title'] = _clean_episode_title(tv_pattern_b.group(4))
                 info['type'] = 'tv'
                 return info

        if tv_pattern:
            info['title'] = tv_pattern.group(1).replace('.', ' ').strip()
            info['season'] = int(tv_pattern.group(2))
            info['episode'] = int(tv_pattern.group(3))

            # Extract optional episode title from suffix
            if tv_pattern.group(4):
                 # simplistic clean: replace dots maybe?
                 info['episode_title'] = _clean_episode_title(tv_pattern.group(4))

            info['type'] = 'tv'
            return info

        # 2. Try Smart Parsing (Folder Context)
        try:
            parent_name = path_obj.parent.name
            season_match = SEASON_FOLDER_PATTERN.search(parent_name.strip())

            if season_match:
                # We found a Season folder!
                info['season'] = int(season_match.group(1) or season_match.group(2))
                info['type'] = 'tv'

                # Grandparent is likely the show name
                # Clean up year if present in show folder name e.g. "Show Name (2020)"
                show_folder = path_obj.parent.parent.name
                show_match = re.match(r'(.+?)(?:\s*\(\d{4}\))?$', show_folder)
                info['title'] = (show_match.group(1) if show_match else show_folder).strip()

                # Try to find Episode Number in filename (relaxed)
                # Look for number at start, or "E01", or just "01 - "
                ep_match = re.search(r'(?:[eE]|^|\s)(\d{1,2})(?:$|\s|\.|-)', path_obj.stem)
                if ep_match:
                    info['episode'] = int(ep_match.group(1))
                else:
                    # Fallback default if we can't find numbering
                    info['episode'] = 1

                return info
        except Exception:
            # If path logic fails (e.g. no parent), fall through
            pass

        # 3. Try Anime / Absolute Numbering pattern
        # Matches: [SubGroup] Show Name - 001.mkv OR Show Name - 120.mkv
        anime_pattern = re.search(r'^(?:\[.*?\]\s*)?(.+?)\s*-\s*(\d{2,4})(?:\s|[\.\[]|$)', filename)
        if anime_pattern:
            potential_ep = int(anime_pattern.group(2))
            # Heuristic: If it looks like a year, it's probably a movie, skip this.
            if not (1900 < potential_ep <= _max_year()):
                info['title'] = anime_pattern.group(1).replace('.', ' ').strip()
                info['season'] = 1 # Default to Season 1 for absolute numbering
                info['episode'] = potential_ep
                info['type'] = 'tv'
                return info

        # 4. Try Movie pattern (Year)
        # Find all 4-digit numbers
        matches = list(re.finditer(r'(?:^|[ .\(])(\d{4})(?:$|[ .\)])', filename))

        # Iterate matches in reverse (years usually at end)
        for match in reversed(matches):
            potential_year = int(match.group(1))
            if 1880 < potential_year <= _max_year():
                # Valid year found
                info['year'] = potential_year

                # Title is everything before the year
                raw_title = filename[:match.start()]
                info['title'] = raw_title.replace('.', ' ').strip(' ()-')
                info['type'] = 'movie'
                return info

        # If no valid year found but looks like movie?
        # Fallback to just title
        if not info.get('type'):
            pass # Fall through to default

        # Fallback
        info['title'] = path_obj.stem
        info['type'] = 'unknown'
        return info

    async def get_candidates(self, parsed_info: Dict[str, Any], cached_season_data: Optional[Dict[str, Any]] = None, cached_show_metadata: Optional[Dict[str, Any]] = None, cached_all_candidates: Optional[list] = None, errors: Optional[list] = None) -> list[Dict[str, Any]]:
        """
        Queries APIs to get list of potential metadata matches.
        Lookup failures are logged and, when `errors` is given, appended to it.
        """
        candidates = []

        try:
            if parsed_info['type'] == 'movie':
                results = await tmdb_client.search_movie(parsed_info['title'], parsed_info.get('year'))
                if results.get('results'):
                    # Normalize TMDB movie results
                    for res in results['results'][:5]: # Limit to top 5
                        clean_date = res.get('release_date', '')
                        year = int(clean_date.split('-')[0]) if clean_date else None
                        candidates.append({
                            'title': res['title'],
                            'year': year,
                            'overview': _truncate(res.get('overview'), 100),
                            'id': res['id'],
                            'type': 'movie',
                            'score': res.get('vote_average', 0),
                            'poster_path': res.get('poster_path')
                        })

            elif parsed_info['type'] == 'tv':
                # Path A: Using Cached Candidates (return ALL cached candidates)
                if cached_all_candidates:
                    # Return all cached candidates, but enrich the first one with episode details
                    for i, base_cand in enumerate(cached_all_candidates):
                        cand = base_cand.copy()

                        # Only fetch episode details for the first/primary candidate
                        if i == 0 and parsed_info.get('season') and parsed_info.get('episode'):
                            episode_title = parsed_info.get('episode_title')
                            try:
                                details = {}
                                if cached_season_data and str(parsed_info['season']) == str(cached_season_data.get('season_number')):
                                    ep_num = parsed_info['episode']
                                    for ep in cached_season_data.get('episodes', []):
                                        if ep.get('episode_number') == ep_num:
                                            details = ep
                                            break

                                if not details and 'id' in cand:
                                    details = await tmdb_client.get_episode_details(
                                        cand['id'],
                                        parsed_info['season'],
                                        parsed_info['episode']
                                    )

                                if details:
                                    episode_title = details.get('name', episode_title)
                            except Exception as e:
                                logger.warning(f"Failed to fetch episode details (cache path): {e}")

                            cand['episode_title'] = episode_title

                        candidates.append(cand)

                # Path B: No Cache - Perform fresh search
                elif not cached_all_candidates:
                    results = await tmdb_client.search_tv(parsed_info['title'])

                    if results.get('results'):
                        # Top result is most likely match
                        top_match = results['results'][0]
                        # Fetch extra details for top match if we have season/ep info
                        episode_title = parsed_info.get('episode_title') # From filename as default

                        if top_match and parsed_info.get('season') and parsed_info.get('episode'):
                             try:
                                 details = {}
                                 # Try cache first (unlikely here if cached_show_metadata was None, but possible via args)
                                 if cached_season_data and str(parsed_info['season']) == str(cached_season_data.get('season_number')):
                                     ep_num = parsed_info['episode']
                                     for ep in cached_season_data.get('episodes', []):
                                         if ep.get('episode_number') == ep_num:
                                             details = ep
                                             break

                                 if not details:
                                     details = await tmdb_client.get_episode_details(
                                         top_match['id'],
                                         parsed_info['season'],
                                         parsed_info['episode']
                                     )

                                 if details:
                                     episode_title = details.get('name', episode_title)
                             except Exception as e:
                                 logger.warning(f"Failed to fetch episode details: {e}")

                        # Normalize TMDB TV results
                        for i, res in enumerate(results['results'][:5]):
                            # Only the top result gets the episode title; others skip the extra API call
                            first_air = res.get('first_air_date') or ''
                            cand_year = int(first_air.split('-')[0]) if first_air else None
                            cand_ep_title = episode_title if i == 0 else None

                            candidates.append({
                                'title': res['name'],
                                'year': cand_year,
                                'episode_title': cand_ep_title,
                                'overview': _truncate(res.get('overview'), 100),
                                'id': res['id'],
                                'type': 'tv',
                                'score': res.get('vote_average', 0),
                                'poster_path': res.get('poster_path')
                            })

            elif parsed_info['type'] in ('audiobook', 'book'):
                # ... (Existing book logic omitted for brevity, keeping it same)
                 # Determine if audiobook or ebook
                 # Legacy: some inputs might be manual searches with just 'book'
                 is_audio = (parsed_info.get('type') == 'audiobook') or parsed_info.get('is_audio', False)

                 if is_audio:
                     # Use iTunes for Audiobooks
                     results = await itunes_client.search_book(parsed_info['title'])
                     if results:
                         for item in results[:5]:
                             # Parse iTunes item
                             title = item.get('collectionName', 'Unknown')
                             artist = item.get('artistName', 'Unknown')
                             description = item.get('description', '')
                             artwork = item.get('artworkUrl100')
                             if artwork:
                                 artwork = artwork.replace('100x100', '600x600') # Better quality

                             date = item.get('releaseDate', '')
                             year = int(date.split('-')[0]) if date else None

                             candidates.append({
                                 'title': title,
                                 'year': year,
                                 'author': artist,
                                 'type': 'audiobook',
                                 'overview': description[:200] + "..." if description else f"Narrated by {artist}",
                                 'poster_path': artwork
                             })
                 else:
                     # Use Google Books for Keys/Ebooks
                     results = await books_client.search_book(parsed_info['title'])
                     if results.get('items'):
                         for item in results['items'][:5]:
                             vol = item.get('volumeInfo', {})
                             date = vol.get('publishedDate', '')
                             year = int(date.split('-')[0]) if date else None
                             if 'authors' in vol:
                                 author = vol['authors'][0]
                             else:
                                 author = "Unknown"

                             # Google books uses 'imageLinks' -> 'thumbnail'
                             img_links = vol.get('imageLinks', {})
                             thumbnail = img_links.get('thumbnail') or img_links.get('smallThumbnail')

                             candidates.append({
                                 'title': vol.get('title', 'Unknown'),
                                 'year': year,
                                 'author': author,
                                 'type': 'book',
                                 'overview': f"By {author}",
                                 'poster_path': thumbnail
                             })

        except Exception as e:
            logger.warning(f"Metadata lookup failed for '{parsed_info.get('title')}' ({parsed_info.get('type')}): {e}")
            if errors is not None:
                errors.append(str(e) if isinstance(e, MissingApiKeyError) else f"{parsed_info.get('type', 'metadata').title()} lookup failed: {e}")

        return candidates

    def propose_new_path(self, current_path: Path, metadata: Dict[str, Any]) -> Path:
        """
        Generates a new path (relative to the library folder) based on metadata
        and the configured naming template.
        """
        ext = current_path.suffix
        ftype = metadata.get('type')

        if ftype == 'movie':
            template = config.MOVIE_TEMPLATE
        elif ftype == 'tv':
            template = config.TV_TEMPLATE
        elif ftype in ('book', 'audiobook'):
            is_audio = ftype == 'audiobook' or metadata.get('is_audio')
            template = config.AUDIOBOOK_TEMPLATE if is_audio else config.BOOK_TEMPLATE
        else:
            return Path(current_path.name)

        try:
            return render_template(template, metadata, ext)
        except (KeyError, ValueError, IndexError, AttributeError) as e:
            # Bad or half-typed template (unknown key, unbalanced braces, ...)
            logger.error(f"Template error in '{template}': {e!r}")
            return Path(current_path.name)


def render_template(template: str, metadata: Dict[str, Any], ext: str) -> Path:
    """
    Fills a naming template with sanitized metadata values.
    Raises KeyError/ValueError/IndexError for invalid templates.
    """
    context = {k: _clean_value(v) for k, v in metadata.items()}

    # Defaults for missing *or empty* values (a candidate may carry year=None)
    defaults = {'title': 'Unknown', 'year': '', 'resolution': '', 'group': '', 'author': 'Unknown Author'}
    for key, default in defaults.items():
        if not context.get(key):
            context[key] = default

    # Zero-pad season/episode
    for key in ('season', 'episode'):
        try:
            context[key] = f"{int(metadata[key]):02d}"
        except (KeyError, TypeError, ValueError):
            context[key] = '00'

    if not context.get('episode_title'):
        context['episode_title'] = f"Episode {context['episode']}"

    context['ext'] = ext

    rel = template.format(**context)

    # Clean each folder/file component separately. Drop empty and '.'/'..'
    # components so a template can never escape the library folder.
    parts = [p for p in re.split(r'[\/]+', rel)]
    cleaned = []
    for i, part in enumerate(parts):
        is_last = i == len(parts) - 1
        if is_last and ext and part.endswith(ext):
            stem = _clean_component(part[:-len(ext)])
            part = (stem or 'Unknown') + ext
        else:
            part = _clean_component(part)
        if part and part not in ('.', '..'):
            cleaned.append(part)

    if not cleaned:
        raise ValueError(f"Template '{template}' produced an empty path")
    return Path(*cleaned)


def validate_template(template: str) -> Optional[str]:
    """Returns an error message if the template can't be rendered, else None."""
    sample = {
        'title': 'Title', 'year': 2000, 'season': 1, 'episode': 1,
        'episode_title': 'Episode', 'author': 'Author',
    }
    try:
        render_template(template, sample, '.mkv')
    except KeyError as e:
        return f"Unknown placeholder {e}. Available: {{title}}, {{year}}, {{season}}, {{episode}}, {{episode_title}}, {{author}}, {{ext}}"
    except (ValueError, IndexError, AttributeError) as e:
        return f"Invalid template: {e}"
    return None


renamer = Renamer()
