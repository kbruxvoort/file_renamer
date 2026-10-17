"""
FastAPI backend for Sortify GUI.
Exposes REST endpoints for the Tauri frontend.
"""
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pathlib import Path
from typing import Optional, List, Dict, Any
import asyncio
import logging
import os
import secrets
import time

# Initialize Logging EARLY to capture import errors
from src.logger import setup_logging
setup_logging()
logger = logging.getLogger(__name__)

try:
    from src.scanner import scan_directory, VIDEO_EXTENSIONS, ALL_EXTENSIONS
    from src.renamer import renamer, validate_template, render_template, TemplateError
    from src.config import config, DEFAULT_TEMPLATES, MEDIA_TYPES
    from src.undo import undo_manager
    from src.api_clients.tmdb import tmdb_client
    from src import filesystem
except Exception as e:
    logger.critical(f"Startup Failure: {e}", exc_info=True)
    raise e

app = FastAPI(title="Sortify API", version="1.0.0")

# Only the Tauri webview (and the Vite dev server) may call this API from a browser context
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Sortify-Token"],
)

# Per-launch secret shared with the Tauri shell. When set, every request except the
# health check must carry it, so other local programs and web pages can't drive the API.
# Without a token every request is refused, unless running unauthenticated was asked for
# explicitly (local development / tests) with SORTIFY_ALLOW_NO_AUTH=1.
API_TOKEN: Optional[str] = os.environ.get("SORTIFY_API_TOKEN") or None
ALLOW_NO_AUTH = os.environ.get("SORTIFY_ALLOW_NO_AUTH") == "1"
OPEN_PATHS = {"/health"}


@app.middleware("http")
async def require_token(request: Request, call_next):
    if request.method != "OPTIONS" and request.url.path not in OPEN_PATHS:
        if API_TOKEN:
            supplied = request.headers.get("x-sortify-token", "")
            if not secrets.compare_digest(supplied, API_TOKEN):
                return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
        elif not ALLOW_NO_AUTH:
            return JSONResponse(status_code=401, content={"detail": "Server started without an API token"})
    return await call_next(request)

# ============== Models ==============

class ScanRequest(BaseModel):
    paths: Optional[List[str]] = None
    path: Optional[str] = None # Backwards compatibility/fallback
    min_size_mb: int = 50
    scan_id: Optional[str] = None  # Client-chosen id for progress polling and cancel

class FileCandidate(BaseModel):
    title: str
    year: Optional[int] = None
    overview: Optional[str] = None
    poster_url: Optional[str] = None
    id: Optional[int] = None
    type: str
    score: Optional[float] = None
    author: Optional[str] = None
    episode_title: Optional[str] = None

class ScannedFile(BaseModel):
    original_path: str
    filename: str
    file_type: str
    parsed_title: Optional[str] = None
    candidates: List[FileCandidate]
    selected_index: int = 0
    proposed_path: Optional[str] = None
    conflict: bool = False  # Something already exists at proposed_path

class ScanResponse(BaseModel):
    files: List[ScannedFile]
    source_dir: str
    dest_dir: str
    warnings: List[str] = []

class ExecuteRequest(BaseModel):
    files: List[Dict[str, Any]]  # List of {original_path, selected_candidate, proposed_path?}
    source_roots: Optional[List[str]] = None  # Paths the user scanned (bounds empty-folder cleanup)

class ConfigUpdate(BaseModel):
    key: str
    value: str

class SearchRequest(BaseModel):
    query: str
    type: str

class PreviewRenameRequest(BaseModel):
    original_path: str
    selected_candidate: Optional[Dict[str, Any]] = None

class UndoRequest(BaseModel):
    batch_id: Optional[str] = None

class TemplatePreviewRequest(BaseModel):
    template: str
    type: str

# ============== Helpers ==============

# Generic download folders hold unrelated files, so they never share TV context
MIXED_DIR_NAMES = {'downloads', 'desktop', 'documents', 'unsorted', 'incoming'}

# How many files per folder are processed one at a time to establish TV context
MAX_PRIMING_FILES = 3


def candidate_to_model(c: Dict[str, Any]) -> FileCandidate:
    poster_url = None
    if c.get('poster_path'):
        if c.get('type') in ('movie', 'tv'):
            # TMDB returns a relative path
            poster_url = f"https://image.tmdb.org/t/p/w200/{c['poster_path'].lstrip('/')}"
        else:
            # Book providers return a full URL
            poster_url = c['poster_path']

    return FileCandidate(
        title=c.get('title') or 'Unknown',
        year=c.get('year'),
        overview=c.get('overview'),
        poster_url=poster_url,
        id=c.get('id'),
        type=c.get('type', 'unknown'),
        score=c.get('score'),
        author=c.get('author'),
        episode_title=c.get('episode_title'),
    )


def build_target(original: Path, metadata: Dict[str, Any]) -> Path:
    """Absolute destination for a file given its resolved metadata.
    Raises TemplateError if the naming template can't be applied."""
    return config.library_dir(metadata.get('type')) / renamer.propose_new_path(original, metadata)


async def resolve_metadata(original: Path, candidate: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Parsed filename info merged with the chosen candidate. For TV, fills in the
    real episode title when the candidate doesn't carry one.
    """
    metadata = renamer.parse_filename(original)
    if candidate:
        metadata.update(candidate)

    if metadata.get('type') == 'tv' and metadata.get('id'):
        curr_title = metadata.get('episode_title') or ''
        is_generic = not curr_title or curr_title.lower().startswith('episode ')

        if is_generic and metadata.get('season') and metadata.get('episode'):
            try:
                details = await tmdb_client.get_episode_details(metadata['id'], metadata['season'], metadata['episode'])
                if details:
                    metadata['episode_title'] = details.get('name')
            except Exception as e:
                logger.warning(f"Failed to fetch episode details for {original.name}: {e}")

    return metadata


def is_valid_client_target(original: Path, target: Path, ftype: Optional[str]) -> bool:
    """A target sent by the UI is trusted only if it stays inside the type's library folder
    and keeps the file's extension."""
    return (
        ftype in MEDIA_TYPES
        and target.is_absolute()
        and target.suffix.lower() == original.suffix.lower()
        and filesystem.is_within(target, config.library_dir(ftype))
    )


# ============== Scan progress ==============

class ScanCancelled(Exception):
    pass

# scan_id -> {"phase", "total", "done", "cancelled", "updated"}
scan_jobs: Dict[str, Dict[str, Any]] = {}


def _scan_job(scan_id: Optional[str]) -> Dict[str, Any]:
    job = {"phase": "discovering", "total": 0, "done": 0, "cancelled": False, "updated": time.time()}
    if scan_id:
        # Forget stale jobs so the dict can't grow without bound
        cutoff = time.time() - 3600
        for key in [k for k, v in scan_jobs.items() if v["updated"] < cutoff]:
            scan_jobs.pop(key, None)
        scan_jobs[scan_id] = job
    return job


@app.get("/scan/{scan_id}/progress")
async def scan_progress(scan_id: str):
    job = scan_jobs.get(scan_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown scan")
    return {k: job[k] for k in ("phase", "total", "done", "cancelled")}


@app.post("/scan/{scan_id}/cancel")
async def cancel_scan(scan_id: str):
    job = scan_jobs.get(scan_id)
    if job:
        job["cancelled"] = True
    return {"cancelled": bool(job)}

# ============== Endpoints ==============

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/shutdown")
async def shutdown_server():
    """Immediately terminate the API server. Used before updates."""
    import threading
    logger.info("Shutdown requested via API, terminating...")
    # Schedule exit in a separate thread to allow response to be sent
    def delayed_exit():
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

    job = _scan_job(request.scan_id)
    lookup_errors: List[str] = []

    def collect_targets() -> List[Path]:
        targets = []
        for path in scan_paths:
            if job["cancelled"]:
                break
            if not path.exists():
                logger.warning(f"Skipping non-existent path: {path}")
                continue
            if path.is_file():
                if path.suffix.lower() in ALL_EXTENSIONS:
                    targets.append(path)
            else:
                targets.extend(scan_directory(
                    path,
                    min_video_size_mb=float(request.min_size_mb),
                    should_stop=lambda: job["cancelled"],
                ))
        return targets

    # Walking a large or network folder is slow, blocking I/O: keep it off the event
    # loop so heartbeats (and progress polls) are still answered during the walk
    logger.info(f"[SCAN] Starting scan for {len(scan_paths)} paths")
    search_targets = await asyncio.to_thread(collect_targets)
    if job["cancelled"]:
        raise HTTPException(status_code=409, detail="Scan cancelled")

    job.update(phase="matching", total=len(search_targets), updated=time.time())
    logger.info(f"[SCAN] Total search_targets found: {len(search_targets)}")

    if any(p.suffix.lower() in VIDEO_EXTENSIONS for p in search_targets) and not config.TMDB_API_KEY:
        lookup_errors.append("TMDB API key is not set. Add it in Settings.")

    # Parallel processing setup
    semaphore = asyncio.Semaphore(5)
    folder_cache: Dict[Path, Dict[str, Any]] = {} # Parent Path -> {tmdb_id, title, type}
    season_cache: Dict[tuple, Dict[str, Any]] = {} # (tmdb_id, season_num) -> Full Season Data

    # Group files by directory to ensure context flows from the first file to the rest
    files_by_dir: Dict[Path, List[Path]] = {}
    for p in search_targets:
        files_by_dir.setdefault(p.parent, []).append(p)

    logger.info(f"[SCAN] Grouped into {len(files_by_dir)} directories")

    async def process_file(file_path: Path) -> Optional[ScannedFile]:
        async with semaphore:
            if job["cancelled"]:
                raise ScanCancelled()
            try:
                logger.debug(f"[PROCESS] Processing {file_path.name}...")

                # 1. Parse Initial Metadata
                metadata = renamer.parse_filename(file_path)
                parsed_title = metadata.get('title')

                # 2. Check Folder Cache (Smart Context)
                is_mixed_dir = file_path.parent.name.lower() in MIXED_DIR_NAMES

                if not is_mixed_dir and file_path.parent in folder_cache:
                    cached = folder_cache[file_path.parent]
                    if cached.get('type') == 'tv':
                         # Only reuse the folder's show if the filename seemingly matches it.
                         # "Breaking Bad S01E02" in a Pokemon folder must not use the cache;
                         # a bare "S01E01" should.
                         p_norm = (parsed_title or '').strip().lower().replace('.', ' ').replace('-', ' ')
                         c_norm = (cached.get('title') or '').strip().lower().replace('.', ' ').replace('-', ' ')

                         should_use = not (len(p_norm) > 2 and p_norm not in c_norm and c_norm not in p_norm)

                         if should_use:
                            metadata['title'] = cached['title']
                            for key in ('tmdb_id', 'show_metadata', 'all_candidates'):
                                if key in cached:
                                    metadata[key] = cached[key]

                # 3. Check/Fetch Season Cache (Batching)
                cached_season_data = None
                tmdb_id = metadata.get('tmdb_id')
                season_num = metadata.get('season')

                if metadata.get('type') == 'tv' and tmdb_id and season_num is not None:
                    cache_key = (tmdb_id, season_num)
                    if cache_key in season_cache:
                        cached_season_data = season_cache[cache_key]
                    else:
                        try:
                            season_data = await tmdb_client.get_season_details(tmdb_id, season_num)
                            if season_data:
                                season_cache[cache_key] = season_data
                                cached_season_data = season_data
                        except Exception as e:
                             logger.warning(f"Failed to batch fetch season {season_num}: {e}")

                # 4. Get Candidates (passing cached data)
                candidates_raw = await renamer.get_candidates(
                    metadata,
                    cached_season_data=cached_season_data,
                    cached_all_candidates=metadata.get('all_candidates'),
                    errors=lookup_errors,
                )

                # Update Folder Cache if we found a good TV match and didn't have one
                if candidates_raw and candidates_raw[0].get('type') == 'tv' and not is_mixed_dir:
                     if file_path.parent not in folder_cache:
                         logger.debug(f"[SCAN] Folder context for {file_path.parent.name}: {candidates_raw[0]['title']}")
                         folder_cache[file_path.parent] = {
                             'type': 'tv',
                             'title': candidates_raw[0]['title'],
                             'tmdb_id': candidates_raw[0]['id'],
                             'show_metadata': candidates_raw[0],  # Primary match
                             'all_candidates': candidates_raw  # ALL candidates for ambiguity detection
                         }
                     elif 'tmdb_id' not in folder_cache[file_path.parent]:
                          folder_cache[file_path.parent].update(
                              tmdb_id=candidates_raw[0]['id'],
                              show_metadata=candidates_raw[0],
                              all_candidates=candidates_raw,
                          )

                # 5. Build Response Model
                candidates = [candidate_to_model(c) for c in candidates_raw]

                proposed_path = None
                conflict = False
                ftype = metadata.get('type')
                if candidates_raw:
                    selected_metadata = {**metadata, **candidates_raw[0]}
                    ftype = selected_metadata.get('type')
                    try:
                        target = build_target(file_path, selected_metadata)
                        proposed_path = str(target)
                        conflict = target.exists() and not filesystem.is_same_path(target, file_path)
                    except TemplateError as e:
                        lookup_errors.append(str(e))

                return ScannedFile(
                    original_path=str(file_path),
                    filename=file_path.name,
                    file_type=ftype or 'unknown',
                    parsed_title=parsed_title,
                    candidates=candidates,
                    selected_index=0,
                    proposed_path=proposed_path,
                    conflict=conflict,
                )
            except Exception as e:
                logger.error(f"Error processing {file_path}: {e}", exc_info=True)
                return None
            finally:
                job["done"] += 1
                job["updated"] = time.time()

    file_results: List[Optional[ScannedFile]] = []

    try:
        for dir_path, dir_files in files_by_dir.items():
            # Sort files by name to ensure consistent order (helps with finding S01E01 etc first)
            dir_files.sort(key=lambda p: p.name)

            # Phase 1: Context priming. Process a few TV-looking files one at a time until the
            # folder's show is known, so the rest can reuse it. Non-TV files skip straight to
            # the parallel phase.
            primed = set()
            if dir_path.name.lower() not in MIXED_DIR_NAMES:
                tv_files = [p for p in dir_files if renamer.parse_filename(p).get('type') == 'tv']
                for file_p in tv_files[:MAX_PRIMING_FILES]:
                    if folder_cache.get(dir_path, {}).get('type') == 'tv':
                        break
                    file_results.append(await process_file(file_p))
                    primed.add(file_p)

            # Phase 2: Parallel Processing
            remaining_files = [f for f in dir_files if f not in primed]
            logger.info(f"[SCAN] {dir_path.name}: primed {len(primed)}, {len(remaining_files)} in parallel")
            if remaining_files:
                rest_results = await asyncio.gather(*[process_file(p) for p in remaining_files], return_exceptions=True)
                for i, res in enumerate(rest_results):
                    if isinstance(res, ScanCancelled):
                        raise res
                    if isinstance(res, BaseException):
                        logger.error(f"[SCAN] Exception processing {remaining_files[i].name}: {res}")
                        rest_results[i] = None
                file_results.extend(rest_results)
    except ScanCancelled:
        logger.info("[SCAN] Cancelled by user")
        raise HTTPException(status_code=409, detail="Scan cancelled")
    finally:
        job.update(phase="done", updated=time.time())

    files = [f for f in file_results if f]
    failed = len(file_results) - len(files)
    if failed:
        logger.warning(f"[SCAN] {failed} files could not be processed")
        lookup_errors.append(f"{failed} file(s) could not be processed. See the log for details.")
    logger.info(f"[SCAN] Final result count: {len(files)}")

    return ScanResponse(
        files=files,
        source_dir=str(scan_paths[0]),
        dest_dir=str(config.DEST_DIR),
        # Same message for many files -> show once, in first-seen order
        warnings=list(dict.fromkeys(lookup_errors)),
    )


def _move_with_sidecars(original: Path, target_main: Path, cleanup_roots: List[Path]) -> List[Dict[str, Any]]:
    """Moves a file and its sidecars (subtitles, nfo, ...). Returns the moves made."""
    moved = []

    # 1. Identify Associated Files (BEFORE moving the main file)
    associated_files = filesystem.find_associated_files(original)

    # 2. Move Main File
    final_target = filesystem.move_file(original, target_main)
    moved.append({"src": str(original), "dest": str(final_target)})

    # 3. Move Associated Files. They follow the main file's new name but keep their own
    # suffix, e.g. "Movie.en.srt" -> "New Name (2020).en.srt"
    for assoc in associated_files:
        try:
            suffix_part = assoc.name[len(original.stem):]  # ".en.srt"
            target_assoc = final_target.parent / (final_target.stem + suffix_part)
            # Record where it actually landed (may differ after a collision rename)
            final_assoc = filesystem.move_file(assoc, target_assoc)
            moved.append({"src": str(assoc), "dest": str(final_assoc), "associated": True})
        except Exception as e:
            logger.warning(f"Failed to move associated file {assoc}: {e}")

    # 4. Clean up now-empty source folders, but never above the scanned folder
    source_root = filesystem.find_root(original.parent, cleanup_roots)
    filesystem.clean_empty_dirs(original.parent, root_path=source_root)
    return moved


@app.post("/execute")
async def execute_moves(request: ExecuteRequest):
    moved = []
    errors = []
    skipped = []

    # Folders the user scanned; empty-folder cleanup never goes above these
    cleanup_roots = [Path(p) for p in (request.source_roots or []) if Path(p).is_dir()]
    if config.SOURCE_DIR:
        cleanup_roots.append(config.SOURCE_DIR)

    for file_info in request.files:
        try:
            original = Path(file_info['original_path'])
            if not original.exists():
                 errors.append({"file": str(original), "error": "File not found"})
                 continue

            # Never move a file without a confirmed match: it would land in the library root
            candidate = file_info.get('selected_candidate')
            if not candidate or candidate.get('type') not in MEDIA_TYPES:
                skipped.append({"file": str(original), "reason": "No match selected"})
                continue

            # Use the exact path the user previewed when it's safe to; otherwise rebuild it
            # the same way /preview_rename does (including the episode-title lookup)
            client_target = Path(file_info['proposed_path']) if file_info.get('proposed_path') else None
            if client_target and is_valid_client_target(original, client_target, candidate.get('type')):
                target_main = client_target
            else:
                target_main = build_target(original, await resolve_metadata(original, candidate))

            if filesystem.is_same_path(target_main, original):
                skipped.append({"file": str(original), "reason": "Already named and in place"})
                continue

            moved.extend(await asyncio.to_thread(_move_with_sidecars, original, target_main, cleanup_roots))

        except Exception as e:
            logger.error(f"Error executing move for {file_info.get('original_path')}: {e}", exc_info=True)
            errors.append({
                "file": file_info.get('original_path'),
                "error": str(e)
            })

    # Record transaction for Undo
    if moved:
        undo_manager.record_batch(moved)
        logger.info(f"Executed batch move of {len(moved)} files.")

    return {"moved": moved, "errors": errors, "skipped": skipped}


@app.post("/search")
async def search(request: SearchRequest):
    try:
        metadata = {
            'title': request.query,
            'type': request.type
        }

        # If user typed "Movie Name 2024", search with the year as a hint
        import re
        year_match = re.search(r'\b(19|20)\d{2}\b', request.query)
        if year_match:
            metadata['year'] = int(year_match.group(0))

        errors: List[str] = []
        candidates_raw = await renamer.get_candidates(metadata, errors=errors)
        if errors and not candidates_raw:
            raise HTTPException(status_code=502, detail=errors[0])

        return {"candidates": [candidate_to_model(c) for c in candidates_raw]}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Search failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/preview_rename")
async def preview_rename(request: PreviewRenameRequest):
    original = Path(request.original_path)
    metadata = await resolve_metadata(original, request.selected_candidate)
    try:
        target = build_target(original, metadata)
    except TemplateError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "proposed_path": str(target),
        "conflict": target.exists() and not filesystem.is_same_path(target, original),
    }


@app.post("/template_preview")
async def template_preview(request: TemplatePreviewRequest):
    """Renders a template against a sample file so Settings can show a live preview."""
    samples = {
        'movie': ({'title': 'The Matrix', 'year': 1999}, '.mkv'),
        'tv': ({'title': 'Breaking Bad', 'year': 2008, 'season': 1, 'episode': 1, 'episode_title': 'Pilot'}, '.mkv'),
        'book': ({'title': 'Dune', 'year': 1965, 'author': 'Frank Herbert'}, '.epub'),
        'audiobook': ({'title': 'Project Hail Mary', 'year': 2021, 'author': 'Andy Weir'}, '.m4b'),
    }
    metadata, ext = samples.get(request.type, samples['movie'])
    error = validate_template(request.template)
    if error:
        return {"path": None, "error": error}
    return {"path": str(config.library_dir(request.type) / render_template(request.template, metadata, ext)), "error": None}


@app.get("/history")
async def get_history():
    return undo_manager.get_history()


@app.post("/undo")
async def undo_operation(request: Optional[UndoRequest] = None):
    batch_id = request.batch_id if request else None
    logger.info(f"Undo requested by user (batch={batch_id or 'latest'}).")
    result = undo_manager.undo_batch(batch_id)
    if result['failure_count']:
        logger.warning(f"Undo finished with {result['failure_count']} failures: {result['failures']}")
    logger.info(f"Undo restored {result.get('restored_count')} files.")
    return result


@app.get("/config")
async def get_config(reveal_keys: bool = False):
    """
    Get current configuration.
    """
    try:
        # Force reload from disk
        config._load_from_file()

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
            "DEFAULT_TEMPLATES": DEFAULT_TEMPLATES,
        }

        # Mask key if needed
        if not reveal_keys and cfg["TMDB_API_KEY"]:
            key = cfg["TMDB_API_KEY"]
            cfg["TMDB_API_KEY"] = "***" + key[-4:] if len(key) > 4 else "***"

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
        valid_keys = [
            "TMDB_API_KEY", "DEST_DIR", "MOVIE_DIR", "TV_DIR",
            "BOOK_DIR", "AUDIOBOOK_DIR", "SOURCE_DIR", "MIN_VIDEO_SIZE_MB",
            "MOVIE_TEMPLATE", "TV_TEMPLATE", "BOOK_TEMPLATE", "AUDIOBOOK_TEMPLATE"
        ]

        if update.key not in valid_keys:
             raise HTTPException(status_code=400, detail=f"Invalid config key: {update.key}")

        if update.key.endswith("_TEMPLATE"):
            template_error = validate_template(update.value)
            if template_error:
                raise HTTPException(status_code=400, detail=template_error)

        warning = None
        if update.key == "TMDB_API_KEY":
            valid = await tmdb_client.validate_key(update.value)
            if valid is False:
                raise HTTPException(status_code=400, detail="TMDB rejected this API key. Check that you copied the v3 API key.")
            if valid is None:
                warning = "Saved, but TMDB couldn't be reached to verify the key."

        config.save(update.key, update.value)
        # Never log secrets
        logged_value = "***" if update.key == "TMDB_API_KEY" else update.value
        logger.info(f"Config updated: {update.key} = {logged_value}")
        return {"success": True, "warning": warning}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update config: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============== Run Server ==============

# Global state for heartbeat
last_heartbeat = 0
HEARTBEAT_TIMEOUT = 30 # Seconds

@app.post("/heartbeat")
async def heartbeat():
    global last_heartbeat
    last_heartbeat = time.time()
    return {"status": "ok"}

def start_server():
    """Start the API server (called by Tauri)"""
    import uvicorn
    import argparse
    import threading

    global last_heartbeat
    last_heartbeat = time.time() # Initialize

    parser = argparse.ArgumentParser(description="Sortify API Server")
    parser.add_argument("--port", type=int, default=8742, help="Port to bind to")

    args, _unknown = parser.parse_known_args()
    port = args.port

    auth_mode = "token" if API_TOKEN else ("OFF (SORTIFY_ALLOW_NO_AUTH)" if ALLOW_NO_AUTH else "refusing all requests: no token")
    logger.info(f"Starting API server on port {port} (auth: {auth_mode})")

    # Process Management: exit when the app stops sending heartbeats
    def monitor_heartbeat():
        while True:
            time.sleep(2)
            if time.time() - last_heartbeat > HEARTBEAT_TIMEOUT:
                logger.info(f"No heartbeat for {HEARTBEAT_TIMEOUT}s. Shutting down...")
                # os._exit is safer than sys.exit from a non-main thread
                os._exit(0)

    threading.Thread(target=monitor_heartbeat, daemon=True).start()

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

if __name__ == "__main__":
    start_server()
