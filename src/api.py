"""
FastAPI backend for Sortify GUI.
Exposes REST endpoints for the Tauri frontend.
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
from typing import Optional, List, Dict, Any
import asyncio
import logging

# Initialize Logging EARLY to capture import errors
from src.logger import setup_logging
setup_logging()
logger = logging.getLogger(__name__)

try:
    from src.scanner import scan_directory, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, BOOK_EXTENSIONS, ALL_EXTENSIONS
    from src.renamer import renamer
    from src.config import config, CONFIG_PATH
    from src.undo import undo_manager
    from src.api_clients.tmdb import tmdb_client
except Exception as e:
    logger.critical(f"Startup Failure: {e}", exc_info=True)
    raise e

app = FastAPI(title="Sortify API", version="1.0.0")

# Allow CORS for local Tauri app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============== Models ==============

class ScanRequest(BaseModel):
    paths: Optional[List[str]] = None
    path: Optional[str] = None # Backwards compatibility/fallback
    min_size_mb: int = 50

class FileCandidate(BaseModel):
    title: str
    year: Optional[int] = None
    overview: Optional[str] = None
    poster_url: Optional[str] = None
    id: Optional[int] = None
    type: str
    score: Optional[float] = None
    author: Optional[str] = None

class ScannedFile(BaseModel):
    original_path: str
    filename: str
    file_type: str
    candidates: List[FileCandidate]
    selected_index: int = 0
    proposed_path: Optional[str] = None

class ScanResponse(BaseModel):
    files: List[ScannedFile]
    source_dir: str
    dest_dir: str

class ExecuteRequest(BaseModel):
    files: List[Dict[str, Any]]  # List of {original_path, selected_candidate}

class ConfigUpdate(BaseModel):
    key: str
    value: str

@app.post("/shutdown")
async def shutdown_server():
    """Immediately terminate the API server. Used before updates."""
    import os
    import threading
    logger.info("Shutdown requested via API, terminating...")
    # Schedule exit in a separate thread to allow response to be sent
    def delayed_exit():
        import time
        time.sleep(0.5)  # Allow response to be sent
        os._exit(0)
    threading.Thread(target=delayed_exit, daemon=True).start()
    return {"status": "shutting_down"}

@app.post("/scan", response_model=ScanResponse)
async def scan_files(request: ScanRequest):
    # Determine source paths
    scan_paths = []
    if request.paths:
        scan_paths = [Path(p) for p in request.paths]
    elif request.path:
        scan_paths = [Path(request.path)]
    elif config.SOURCE_DIR:
        scan_paths = [config.SOURCE_DIR]
    
    if not scan_paths:
        raise HTTPException(status_code=400, detail="No paths provided and SOURCE_DIR not configured")
    
    files: List[ScannedFile] = []
    
    # Collect all search targets mainly
    search_targets = []
    logger.info(f"[SCAN] Starting scan for {len(scan_paths)} paths")

    # Process each path
    for path in scan_paths:
        if not path.exists():
            print(f"Skipping non-existent path: {path}")
            continue

        if path.is_file():
            # If it's a file, verify extension and add directly
            if path.suffix.lower() in ALL_EXTENSIONS: 
                 search_targets.append(path)
            else:
                 # Check if the user really wanted this file? 
                 pass
        else:
            # It's a directory, scan it
            search_targets.extend(scan_directory(path, min_video_size_mb=float(request.min_size_mb)))

        
        folder_cache: Dict[Path, Dict[str, Any]] = {}

    # Parallel processing setup
    semaphore = asyncio.Semaphore(5)
    folder_cache: Dict[Path, Dict[str, Any]] = {} # Parent Path -> {tmdb_id, title, type}
    season_cache: Dict[tuple, Dict[str, Any]] = {} # (tmdb_id, season_num) -> Full Season Data

    logger.info(f"[SCAN] Total search_targets found: {len(search_targets)}")
    for t in search_targets:
        logger.debug(f"[SCAN]   Target: {t.name}")

    # Group files by directory to ensure context flows from the first file to the rest
    files_by_dir: Dict[Path, List[Path]] = {}
    for p in search_targets:
        if p.parent not in files_by_dir:
            files_by_dir[p.parent] = []
        files_by_dir[p.parent].append(p)
    
    logger.info(f"[SCAN] Grouped into {len(files_by_dir)} directories")

    async def process_file(file_path: Path):
        async with semaphore:
            try:
                logger.debug(f"[PROCESS] Processing {file_path.name}...") 
                
                # 1. Parse Initial Metadata
                metadata = renamer.parse_filename(file_path)
                
                # 2. Check Folder Cache (Smart Context)
                # Avoid caching for generic mixed directories
                parent_name = file_path.parent.name
                is_mixed_dir = parent_name.lower() in ['downloads', 'desktop', 'documents', 'unsorted', 'incoming']
                
                using_cache = False
                if not is_mixed_dir and file_path.parent in folder_cache:
                    cached = folder_cache[file_path.parent]
                    if cached.get('type') == 'tv':
                         # Validate: Does the filename seemingly match the cached context?
                         # If filename has "Breaking Bad" and cache is "Pokemon", DO NOT USE CACHE.
                         # If filename is "S01E01", USE CACHE.
                         
                         parsed_title = metadata.get('title', '').strip()
                         cached_title = cached.get('title', '').strip()
                         
                         # Normalization for check
                         p_norm = parsed_title.lower().replace('.', ' ').replace('-', ' ')
                         c_norm = cached_title.lower().replace('.', ' ').replace('-', ' ')
                         
                         # Heuristic: If parsed title exists and is NOT a substring of cached (and vice versa) -> Mismatch
                         # But be careful of partials.
                         should_use = True
                         if parsed_title:
                             # If the parsed title is substantial (len > 3) and completely different
                             if len(parsed_title) > 2 and (p_norm not in c_norm and c_norm not in p_norm):
                                  should_use = False
                                  # print(f"[DEBUG] Cache Mismatch for {file_path.name}: Parsed '{parsed_title}' vs Cache '{cached_title}'")

                         if should_use:
                            metadata['title'] = cached['title']
                            if 'tmdb_id' in cached:
                                metadata['tmdb_id'] = cached['tmdb_id']
                            if 'show_metadata' in cached:
                                metadata['show_metadata'] = cached['show_metadata']
                            if 'all_candidates' in cached:
                                metadata['all_candidates'] = cached['all_candidates']
                            using_cache = True

                
                # 3. Check/Fetch Season Cache (Batching)
                cached_season_data = None
                tmdb_id = metadata.get('tmdb_id')
                season_num = metadata.get('season')
                
                if metadata.get('type') == 'tv' and tmdb_id and season_num is not None:
                    cache_key = (tmdb_id, season_num)
                    if cache_key in season_cache:
                        cached_season_data = season_cache[cache_key]
                    else:
                        # Fetch full season!
                        from src.api_clients.tmdb import tmdb_client
                        try:
                            # print(f"[DEBUG] Batch fetching Season {season_num} for ID {tmdb_id}")
                            season_data = await tmdb_client.get_season_details(tmdb_id, season_num)
                            if season_data:
                                season_cache[cache_key] = season_data
                                cached_season_data = season_data
                        except Exception as e:
                             print(f"Failed to batch fetch season {season_num}: {e}")

                # 4. Get Candidates (passing cached data)
                # Pass all_candidates if available to preserve ambiguous options
                cached_all = metadata.get('all_candidates')
                candidates_raw = await renamer.get_candidates(
                    metadata, 
                    cached_season_data=cached_season_data,
                    cached_all_candidates=cached_all
                )
                
                # Update Folder Cache if we found a good TV match and didn't have one
                if candidates_raw and candidates_raw[0].get('type') == 'tv':
                     # Only start caching if we didn't have ID before AND matches rules
                     if not is_mixed_dir and file_path.parent not in folder_cache:
                         print(f"[DEBUG] CACHE SET for {file_path.parent.name}: {candidates_raw[0]['title']} ({len(candidates_raw)} candidates)")
                         folder_cache[file_path.parent] = {
                             'type': 'tv',
                             'title': candidates_raw[0]['title'],
                             'tmdb_id': candidates_raw[0]['id'],
                             'show_metadata': candidates_raw[0],  # Primary match
                             'all_candidates': candidates_raw  # ALL candidates for ambiguity detection
                         }
                     elif file_path.parent in folder_cache and 'tmdb_id' not in folder_cache[file_path.parent]:
                          # Update if we had title but no ID
                          folder_cache[file_path.parent]['tmdb_id'] = candidates_raw[0]['id']
                          folder_cache[file_path.parent]['show_metadata'] = candidates_raw[0]
                          folder_cache[file_path.parent]['all_candidates'] = candidates_raw

                # 5. Build Response Model
                candidates = []
                for c in candidates_raw:
                    poster_url = None
                    if c.get('poster_path'):
                        if c.get('type') in ['movie', 'tv']:
                            poster_url = f"https://image.tmdb.org/t/p/w200/{c.get('poster_path').lstrip('/')}"
                        elif c.get('type') in ['book', 'audiobook']:
                            poster_url = c.get('poster_path')
                    
                    candidates.append(FileCandidate(
                        title=c.get('title', 'Unknown'),
                        year=c.get('year'),
                        overview=c.get('overview'),
                        poster_url=poster_url,
                        id=c.get('id'),
                        type=c.get('type', 'unknown'),
                        score=c.get('score'),
                        author=c.get('author')
                    ))
                
                # Propose path
                selected_metadata = metadata.copy()
                if candidates:
                    selected_metadata.update(candidates_raw[0])
                
                new_relative = renamer.propose_new_path(file_path, selected_metadata)
                
                base_dir = config.DEST_DIR
                ftype = selected_metadata.get('type')
                if ftype == 'movie': base_dir = config.MOVIE_DIR
                elif ftype == 'tv': base_dir = config.TV_DIR
                elif ftype == 'book': base_dir = config.BOOK_DIR
                elif ftype == 'audiobook': base_dir = config.AUDIOBOOK_DIR
                    
                proposed_path = str(base_dir / new_relative)
                
                return ScannedFile(
                    original_path=str(file_path),
                    filename=file_path.name,
                    file_type=ftype or 'unknown',
                    candidates=candidates,
                    selected_index=0,
                    proposed_path=proposed_path
                )
            except Exception as e:
                logger.error(f"Error processing {file_path}: {e}", exc_info=True)
                return None

    # Execute by directory group
    file_results = []
    
    for dir_path, dir_files in files_by_dir.items():
        if not dir_files:
            continue
        
        logger.info(f"[SCAN] Processing directory: {dir_path.name} ({len(dir_files)} files)")
            
        # Sort files by name to ensure consistent order (helps with finding S01E01 etc first)
        dir_files.sort(key=lambda p: p.name)
        
        # Phase 1: Context Priming
        # Process files sequentially until we establish a valid TV show context in folder_cache
        # or we run out of files.
        processed_indices = set()
        
        # Try up to 3 files to establish context (or all if small folder)
        # If we find a match, we stop priming and go to parallel.
        for i, file_p in enumerate(dir_files):
            # Check if cache is established
            if dir_path in folder_cache and folder_cache[dir_path].get('type') == 'tv':
                # Cache is ready! Switch to parallel for the rest
                logger.info(f"[SCAN] Cache established, breaking at file {i}")
                break
            
            # Process strictly one by one
            res = await process_file(file_p)
            file_results.append(res)
            processed_indices.add(i)
            
            # If this file resulted in a cache hit, the loop check next iter will break.
        
        # Phase 2: Parallel Processing
        # Process all remaining files
        remaining_files = [f for i, f in enumerate(dir_files) if i not in processed_indices]
        logger.info(f"[SCAN] Phase 1 processed {len(processed_indices)}, Phase 2: {len(remaining_files)} remaining")
        if remaining_files:
            rest_results = await asyncio.gather(*[process_file(p) for p in remaining_files], return_exceptions=True)
            # Log any exceptions
            for i, res in enumerate(rest_results):
                if isinstance(res, Exception):
                    logger.error(f"[SCAN] Exception processing {remaining_files[i].name}: {res}")
                    rest_results[i] = None
            file_results.extend(rest_results)
    
    logger.info(f"[SCAN] Total file_results before filter: {len(file_results)}")
    none_count = sum(1 for r in file_results if r is None)
    if none_count > 0:
        logger.warning(f"[SCAN] {none_count} files returned None")
    
    # Filter out None results
    files = [f for f in file_results if f]
    logger.info(f"[SCAN] Final result count: {len(files)}")
    
    # Just use first path or config as source_dir for display
    display_source = str(scan_paths[0]) if scan_paths else str(config.SOURCE_DIR)

    return ScanResponse(
        files=files,
        source_dir=display_source, 
        dest_dir=str(config.DEST_DIR)
    )

@app.post("/execute")
def execute_moves(request: ExecuteRequest):
    import shutil
    
    from src import filesystem

    moved = []
    errors = []
    
    for file_info in request.files:
        try:
            original = Path(file_info['original_path'])
            if not original.exists():
                 errors.append({"file": str(original), "error": "File not found"})
                 continue

            # Rebuild metadata from selected candidate
            metadata = renamer.parse_filename(original)
            if file_info.get('selected_candidate'):
                metadata.update(file_info['selected_candidate'])
            
            # Get proposed path (relative)
            new_relative = renamer.propose_new_path(original, metadata)
            
            # Determine base directory
            base_dir = config.DEST_DIR
            ftype = metadata.get('type')
            if ftype == 'movie':
                base_dir = config.MOVIE_DIR
            elif ftype == 'tv':
                base_dir = config.TV_DIR
            elif ftype == 'book':
                base_dir = config.BOOK_DIR
            elif ftype == 'audiobook':
                base_dir = config.AUDIOBOOK_DIR
                
            target_main = base_dir / new_relative
            
            # 1. Identify Associated Files (BEFORE moving the main file)
            associated_files = filesystem.find_associated_files(original)
            
            # 2. Move Main File
            final_target = filesystem.move_file(original, target_main)
            
            moved.append({
                "src": str(original),
                "dest": str(final_target)
            })
            
            # 3. Move Associated Files
            # They should follow the main file's new name but keep their extensions
            # e.g. "Movie.mkv" -> "New Name (2020).mkv"
            #      "Movie.srt" -> "New Name (2020).srt"
            #      "Movie.en.srt" -> "New Name (2020).en.srt"
            
            main_stem_len = len(original.stem)
            
            for assoc in associated_files:
                try:
                    # Calculate new name for associated file
                    # We want to replace the original stem with the new stem
                    # But handle complex extensions like .en.srt
                    
                    # Simple approach: Replace the start of the filename
                    # original.name: "MyMovie.en.srt"
                    # original.stem: "MyMovie"
                    # target_main.stem: "Real Data (2020)"
                    
                    suffix_part = assoc.name[len(original.stem):] # ".en.srt"
                    new_assoc_name = final_target.stem + suffix_part
                    target_assoc = final_target.parent / new_assoc_name
                    
                    filesystem.move_file(assoc, target_assoc)
                    
                    moved.append({
                        "src": str(assoc),
                        "dest": str(target_assoc),
                        "associated": True
                    })
                except Exception as e:
                    print(f"Failed to move associated file {assoc}: {e}")
            
            # 4. Clean up source directory
            # We cleanup from the original parent up to the SOURCE_DIR (if configured)
            # or just up one level if we are cautious
            source_root = config.SOURCE_DIR if config.SOURCE_DIR else None
            filesystem.clean_empty_dirs(original.parent, root_path=source_root)

        except Exception as e:
            logger.error(f"Error executing move for string {file_info.get('original_path')}: {e}", exc_info=True)
            errors.append({
                "file": file_info.get('original_path'),
                "error": str(e)
            })
            
    # Record transaction for Undo
    if moved:
        undo_manager.record_batch(moved)
        logger.info(f"Executed batch move of {len(moved)} files.")

    return {"moved": moved, "errors": errors}

class SearchRequest(BaseModel):
    query: str
    type: str

@app.post("/search")
async def search(request: SearchRequest):
    try:
        # Construct metadata for renamer
        metadata = {
            'title': request.query,
            'type': request.type
        }
        
        # Determine year if possible (simple heuristic)
        # If user typed "Movie Name 2024", extract 2024
        import re
        year_match = re.search(r'\b(19|20)\d{2}\b', request.query)
        if year_match:
            metadata['year'] = int(year_match.group(0))
            # Clean title? Maybe not needed as search APIs usually handle it.
        
        candidates_raw = await renamer.get_candidates(metadata)
        
        # Convert to FileCandidate models (duplicated from scan_files)
        candidates = []
        for c in candidates_raw:
            # Add TMDB poster URL if available
            poster_url = None
            if c.get('poster_path'):
                if c.get('type') in ['movie', 'tv']:
                    # TMDB returns relative path
                    poster_url = f"https://image.tmdb.org/t/p/w200/{c.get('poster_path').lstrip('/')}"
                elif c.get('type') in ['book', 'audiobook']:
                    # Google Books / Audnexus returns full URL
                    poster_url = c.get('poster_path')
            
            candidates.append(FileCandidate(
                title=c.get('title', 'Unknown'),
                year=c.get('year'),
                overview=c.get('overview'),
                poster_url=poster_url,
                id=c.get('id'),
                type=c.get('type', 'unknown'),
                score=c.get('score'),
                author=c.get('author')
            ))
            
        return {"candidates": candidates}
        
    except Exception as e:
        logger.error(f"Search failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    
class PreviewRenameRequest(BaseModel):
    original_path: str
    selected_candidate: Optional[Dict[str, Any]] = None

@app.post("/preview_rename")
async def preview_rename(request: PreviewRenameRequest):
    original = Path(request.original_path)
    
    # Rebuild metadata
    metadata = renamer.parse_filename(original)
    if request.selected_candidate:
        metadata.update(request.selected_candidate)
        
    # Lazy Fetch: If we have an ID but lack a specific episode title (common in forced propagation), fetch it.
    if metadata.get('type') == 'tv' and metadata.get('id'): # 'id' maps to tmdb_id usually, but ensure consistency
        # Check if title is generic
        curr_title = metadata.get('episode_title', '')
        is_generic = not curr_title or curr_title.lower().startswith('episode ')
        
        if is_generic and metadata.get('season') and metadata.get('episode'):
             try:
                 # Map 'id' to tmdb_id if needed, candidate usually has 'id'
                 tmdb_id = metadata['id']
                 details = await tmdb_client.get_episode_details(
                     tmdb_id, 
                     metadata['season'], 
                     metadata['episode']
                 )
                 if details:
                     metadata['episode_title'] = details.get('name')
                     if details.get('air_date'):
                         metadata['year'] = int(details['air_date'].split('-')[0])
             except Exception as e:
                 logger.warning(f"Failed to lazy fetch episode details for {original.name}: {e}")

    # Get proposed path (relative)
    new_relative = renamer.propose_new_path(original, metadata)
    
    # Determine base directory (duplicate logic, should refactor)
    base_dir = config.DEST_DIR
    ftype = metadata.get('type')
    if ftype == 'movie':
        base_dir = config.MOVIE_DIR
    elif ftype == 'tv':
        base_dir = config.TV_DIR
    elif ftype == 'book':
        base_dir = config.BOOK_DIR
    elif ftype == 'audiobook':
        base_dir = config.AUDIOBOOK_DIR
        
    proposed_path = str(base_dir / new_relative)
    return {"proposed_path": proposed_path}

@app.get("/history")
async def get_history():
    return undo_manager.get_history()

@app.post("/undo")
async def undo_last_operation():
    logger.info("Undo requested by user.")
    result = undo_manager.undo_last_batch()
    if not result['success']:
        logger.warning(f"Undo failed: {result.get('message')}")
    else:
        logger.info(f"Undo successful. Restored {result.get('restored_count')} files.")
    return result

    return result

@app.get("/config")
async def get_config(reveal_keys: bool = False):
    """
    Get current configuration.
    """
    try:
        logger.info(f"GET /config request received. reveal_keys={reveal_keys}")
        
        # Force reload from disk
        config._load_from_file()
        
        # Construct response
        cfg = {
            "TMDB_API_KEY": config.TMDB_API_KEY,
            "DEST_DIR": str(config.DEST_DIR),
            "MOVIE_DIR": str(config.MOVIE_DIR),
            "TV_DIR": str(config.TV_DIR),
            "BOOK_DIR": str(config.BOOK_DIR),
            "AUDIOBOOK_DIR": str(config.AUDIOBOOK_DIR),
            "SOURCE_DIR": str(config.SOURCE_DIR) if config.SOURCE_DIR else None,
            "MIN_VIDEO_SIZE_MB": config.MIN_VIDEO_SIZE_MB,
            "MOVIE_TEMPLATE": config.MOVIE_TEMPLATE,
            "TV_TEMPLATE": config.TV_TEMPLATE,
            "BOOK_TEMPLATE": config.BOOK_TEMPLATE,
            "AUDIOBOOK_TEMPLATE": config.AUDIOBOOK_TEMPLATE,
        }
        
        # Mask key if needed
        if not reveal_keys and cfg["TMDB_API_KEY"]:
            key = cfg["TMDB_API_KEY"]
            if len(key) > 4:
                cfg["TMDB_API_KEY"] = "***" + key[-4:]
                
        logger.info("GET /config success")
        return cfg
    except Exception as e:
        logger.error(f"GET /config failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/config")
async def update_config(update: ConfigUpdate):
    """
    Update a single configuration key.
    """
    try:
        # Validate key (simple check)
        valid_keys = [
            "TMDB_API_KEY", "DEST_DIR", "MOVIE_DIR", "TV_DIR", 
            "BOOK_DIR", "AUDIOBOOK_DIR", "SOURCE_DIR", "MIN_VIDEO_SIZE_MB",
            "MOVIE_TEMPLATE", "TV_TEMPLATE", "BOOK_TEMPLATE", "AUDIOBOOK_TEMPLATE"
        ]
        
        if update.key not in valid_keys:
             raise HTTPException(status_code=400, detail=f"Invalid config key: {update.key}")

        config.save(update.key, update.value)
        logger.info(f"Config updated: {update.key} = {update.value}")
        return {"success": True}
    except Exception as e:
        logger.error(f"Failed to update config: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============== Run Server ==============

# ============== Run Server ==============

# Global state for heartbeat
last_heartbeat = 0
HEARTBEAT_TIMEOUT = 30 # Seconds

@app.post("/heartbeat")
async def heartbeat():
    global last_heartbeat
    import time
    last_heartbeat = time.time()
    return {"status": "ok"}

def start_server():
    """Start the API server (called by Tauri)"""
    import uvicorn
    import argparse
    import sys
    import threading
    import time

    global last_heartbeat
    last_heartbeat = time.time() # Initialize

    parser = argparse.ArgumentParser(description="Sortify API Server")
    parser.add_argument("--port", type=int, default=8742, help="Port to bind to")
    
    # Check if we are being called correctly
    args, unknown = parser.parse_known_args()
    port = args.port
    
    logger.info(f"Starting API server on port {port}")

    # Process Management: Monitor Heartbeat
    def monitor_heartbeat():
        while True:
            time.sleep(2)
            if time.time() - last_heartbeat > HEARTBEAT_TIMEOUT:
                logger.info(f"No heartbeat for {HEARTBEAT_TIMEOUT}s. Shutting down...")
                # We need to force exit, os._exit is safer for threads
                import os
                os._exit(0)

    # Start monitor in background
    threading.Thread(target=monitor_heartbeat, daemon=True).start()

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

if __name__ == "__main__":
    start_server()
