import re
from pathlib import Path
from typing import Dict, Optional, Any

from src.api_clients.tmdb import tmdb_client
from src.api_clients.books import books_client
from src.api_clients.itunes import itunes_client
from src.config import config

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
        if ext in {'.epub', '.pdf', '.mobi', '.azw3', '.m4b', '.mp3'}:
             if ext in {'.m4b', '.mp3'}:
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
                      info['episode_title'] = tv_pattern_b.group(4).replace('.', ' ').strip(' -')
                 info['type'] = 'tv'
                 return info

        if tv_pattern:
            info['title'] = tv_pattern.group(1).replace('.', ' ').strip()
            info['season'] = int(tv_pattern.group(2))
            info['episode'] = int(tv_pattern.group(3))
            
            # Extract optional episode title from suffix
            if tv_pattern.group(4):
                 # simplistic clean: replace dots maybe?
                 info['episode_title'] = tv_pattern.group(4).replace('.', ' ').strip()
                 
            info['type'] = 'tv'
            return info
            
        # 2. Try Smart Parsing (Folder Context)
        try:
            parent_name = path_obj.parent.name
            season_match = re.search(r'(?:season|s)\s*(\d+)', parent_name, re.IGNORECASE)
            
            if season_match:
                # We found a Season folder!
                info['season'] = int(season_match.group(1))
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
            if not (1900 < potential_ep < 2030):
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
            if 1880 < potential_year < 2030:
                # Valid year found
                info['year'] = potential_year
                
                # Title is everything before the year
                # Find start index of match in original string
                match_start = match.start(1)
                # Adjust for potential separator captured in group 0 if regex was different
                # But here we used lookarounds or non-capturing.
                # Simplest: title is raw string before this year match
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

    async def get_candidates(self, parsed_info: Dict[str, Any], cached_season_data: Optional[Dict[str, Any]] = None, cached_show_metadata: Optional[Dict[str, Any]] = None) -> list[Dict[str, Any]]:
        """
        Queries APIs to get list of potential metadata matches.
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
                            'overview': res.get('overview', '')[:100] + "...",
                            'id': res['id'],
                            'type': 'movie',
                            'score': res.get('vote_average', 0),
                            'poster_path': res.get('poster_path')
                        })
            
            elif parsed_info['type'] == 'tv':
                # Path A: Using Cached Show Context (Already Normalized Candidate)
                if cached_show_metadata:
                    base_candidate = cached_show_metadata.copy()
                    
                    # Assume base_candidate has 'id' (TMDB ID)
                    # Try to fetch specific Episode details to refine the match
                    episode_title = parsed_info.get('episode_title')
                    year = base_candidate.get('year') # Default to show year
                    
                    if parsed_info.get('season') and parsed_info.get('episode'):
                         try:
                             details = {}
                             # Try Season Cache
                             if cached_season_data and str(parsed_info['season']) == str(cached_season_data.get('season_number')):
                                 ep_num = parsed_info['episode']
                                 for ep in cached_season_data.get('episodes', []):
                                     if ep.get('episode_number') == ep_num:
                                         details = ep
                                         break
                             
                             # Fallback to API if not in batch cache
                             if not details and 'id' in base_candidate:
                                 details = await tmdb_client.get_episode_details(
                                     base_candidate['id'], 
                                     parsed_info['season'], 
                                     parsed_info['episode']
                                 )
                                 
                             if details:
                                 # Found episode data!
                                 episode_title = details.get('name', episode_title)
                                 air_date = details.get('air_date', '')
                                 if air_date:
                                     year = int(air_date.split('-')[0])
                         except Exception as e:
                             print(f"Failed to fetch episode details (Cache Path): {e}")

                    # Update the candidate with specific episode info
                    base_candidate['episode_title'] = episode_title
                    base_candidate['year'] = year
                    
                    candidates.append(base_candidate)

                # Path B: No Cache - Perform Search
                else:
                    results = await tmdb_client.search_tv(parsed_info['title'])
                
                    if results.get('results'):
                        # Top result is most likely match
                        top_match = results['results'][0]
                        # Fetch extra details for top match if we have season/ep info
                        episode_title = parsed_info.get('episode_title') # From filename as default
                        year = None
                        
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
                                     air_date = details.get('air_date', '')
                                     if air_date:
                                         year = int(air_date.split('-')[0])
                             except Exception as e:
                                 print(f"Failed to fetch episode details: {e}")

                        # Normalize TMDB TV results
                        for i, res in enumerate(results['results'][:5]):
                            # For the top result (index 0), use the fetched year/ep title
                            # For others, we don't fetch deep details to save API calls
                            cand_year = year if i == 0 else (int(res.get('first_air_date', '').split('-')[0]) if res.get('first_air_date') else None)
                            cand_ep_title = episode_title if i == 0 else None
                            
                            candidates.append({
                                'title': res['name'],
                                'year': cand_year,
                                'episode_title': cand_ep_title,
                                'overview': res.get('overview', '')[:100] + "...",
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
            # print(f"API Error: {e}") 
            pass
            
        return candidates

    def propose_new_path(self, current_path: Path, metadata: Dict[str, Any]) -> Path:
        """
        Generates a new path based on metadata and Plex standards.
        """
        ext = current_path.suffix
        context = metadata.copy()
        
        # Ensure context has defaults for formatting
        context['ext'] = ext
        context.setdefault('title', 'Unknown')
        context.setdefault('year', '')
        context.setdefault('resolution', '')
        context.setdefault('group', '')
        
        # Zero-pad season/episode if present, else empty
        if 'season' in context and context['season'] is not None:
             context['season'] = f"{int(context['season']):02d}"
        else:
             context['season'] = '00'
             
        if 'episode' in context and context['episode'] is not None:
             context['episode'] = f"{int(context['episode']):02d}"
        else:
             context['episode'] = '00'
             
        # Episode Title Default
        if 'episode_title' not in context or not context['episode_title']:
             context['episode_title'] = f"Episode {context['episode']}"

        try:
            if metadata.get('type') == 'movie':
                # Template
                rel = config.MOVIE_TEMPLATE.format(**context)
                
            elif metadata.get('type') == 'tv':
                rel = config.TV_TEMPLATE.format(**context)
    
            elif metadata.get('type') in ('book', 'audiobook'):
                context['author'] = context.get('author', 'Unknown Author')
                is_audio = (metadata.get('type') == 'audiobook') or metadata.get('is_audio')
                if is_audio:
                    rel = config.AUDIOBOOK_TEMPLATE.format(**context)
                else:
                    rel = config.BOOK_TEMPLATE.format(**context)
            else:
                return Path(current_path.name)

            # Cleanup: Remove empty parens "()" from empty years
            rel = rel.replace('()', '').replace('  ', ' ')
            
            # Sanitization (Simple)
            # Remove chars illegal in Windows/Unix paths after formatting
            # Keep separators / and \
            # Replace : with -
            rel = rel.replace(':', ' -')
            
            return Path(rel.strip())
                
        except KeyError as e:
            # Fallback if template uses unknown keys
            print(f"Template Error: Missing key {e}")
            return Path(current_path.name)
            
        return Path(current_path.name)

renamer = Renamer()
