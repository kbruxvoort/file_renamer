import re
from pathlib import Path
from typing import Dict, Optional, Any

from src.api_clients.tmdb import tmdb_client
from src.api_clients.books import books_client
from src.api_clients.itunes import itunes_client
from src.config import config

class Renamer:
    def parse_filename(self, filename: str) -> Dict[str, str]:
        """
        Basic regex parser for movies and TV shows.
        Extracts title, year, season, episode.
        """
        info = {}
        path_obj = Path(filename)
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

        # Try TV pattern first (SxxExx)
        tv_pattern = re.search(r'(.+?)[ .][sS](\d{1,2})[eE](\d{1,2})', filename)
        if tv_pattern:
            info['title'] = tv_pattern.group(1).replace('.', ' ').strip()
            info['season'] = int(tv_pattern.group(2))
            info['episode'] = int(tv_pattern.group(3))
            info['type'] = 'tv'
            return info
            
        # Try Movie pattern (Year)
        movie_pattern = re.search(r'(.+?)[ .]\(?(\d{4})\)?', filename)
        if movie_pattern:
            info['title'] = movie_pattern.group(1).replace('.', ' ').strip()
            info['year'] = int(movie_pattern.group(2))
            info['type'] = 'movie'
            return info
            
        # Fallback
        info['title'] = path_obj.stem
        info['type'] = 'unknown'
        return info

    async def get_candidates(self, parsed_info: Dict[str, Any]) -> list[Dict[str, Any]]:
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
                results = await tmdb_client.search_tv(parsed_info['title'])
                if results.get('results'):
                    # Normalize TMDB TV results
                    for res in results['results'][:5]:
                        candidates.append({
                            'title': res['name'],
                            'year': None, # TV usually has first_air_date
                            'overview': res.get('overview', '')[:100] + "...",
                            'id': res['id'],
                            'type': 'tv',
                            'score': res.get('vote_average', 0),
                            'poster_path': res.get('poster_path')
                        })
            
            elif parsed_info['type'] in ('audiobook', 'book'):
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
        if 'year' not in context or context['year'] is None:
             context['year'] = ''
        
        # Helper: zero-pad season/episode
        if 'season' in context:
             context['season'] = f"{context['season']:02d}"
        if 'episode' in context:
             context['episode'] = f"{context['episode']:02d}"

        try:
            if metadata.get('type') == 'movie':
                # Template: {title} ({year})/{title} ({year}){ext}
                rel = config.MOVIE_TEMPLATE.format(**context)
                # If MOVIE_DIR is absolute/custom, api.py handles the join. 
                # But here 'propose_new_path' is returning a relative path usually?
                # Actually, `renamer.py`'s `propose_new_path` returns a Path object.
                # In `api.py` line 137: proposed_path = str(renamer.propose_new_path(...))
                # The logic in `api.py` lines 171-172 is:
                # new_relative = renamer.propose_new_path(...)
                # target = config.DEST_DIR / new_relative
                
                # This logic assumes `propose_new_path` returns something RELATIVE to DEST_DIR.
                # But if MOVIE_DIR is "D:\Movies", it's not relative to "C:\Media".
                
                return Path(rel) 
                
            elif metadata.get('type') == 'tv':
                rel = config.TV_TEMPLATE.format(**context)
                return Path(rel)
    
            elif metadata.get('type') in ('book', 'audiobook'):
                context['author'] = context.get('author', 'Unknown Author')
                is_audio = (metadata.get('type') == 'audiobook') or metadata.get('is_audio')
                if is_audio:
                    rel = config.AUDIOBOOK_TEMPLATE.format(**context)
                else:
                    rel = config.BOOK_TEMPLATE.format(**context)
                return Path(rel)
                
        except KeyError as e:
            # Fallback if template uses unknown keys
            print(f"Template Error: Missing key {e}")
            return current_path
            
        return current_path

renamer = Renamer()
