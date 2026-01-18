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

from src.scanner import scan_directory, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, BOOK_EXTENSIONS
from src.renamer import renamer
from src.config import config, CONFIG_PATH

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
    path: Optional[str] = None
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

# ============== Endpoints ==============

@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "1.0.0"}

@app.get("/config")
async def get_config(reveal_keys: bool = False):
    return {
        "TMDB_API_KEY": config.TMDB_API_KEY if reveal_keys else ("***" if config.TMDB_API_KEY else None),
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

@app.post("/config")
async def update_config(update: ConfigUpdate):
    config.save(update.key.upper(), update.value)
    return {"status": "updated", "key": update.key.upper()}

class SearchRequest(BaseModel):
    query: str
    type: str  # movie, tv, book, audiobook

@app.post("/search")
async def manual_search(request: SearchRequest):
    """
    Manually search for a specific title.
    """
    metadata = {'title': request.query, 'type': request.type}
    
    # Reuse renamer logic to fetch candidates
    candidates_raw = await renamer.get_candidates(metadata)
    
    # Convert to FileCandidate (duplicate logic, should refactor but this is faster)
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
    
    return {"candidates": candidates}

@app.post("/scan", response_model=ScanResponse)
async def scan_files(request: ScanRequest):
    # Determine source path
    scan_path = Path(request.path) if request.path else config.SOURCE_DIR
    if not scan_path:
        raise HTTPException(status_code=400, detail="No path provided and SOURCE_DIR not configured")
    
    if not scan_path.exists():
        raise HTTPException(status_code=404, detail=f"Path does not exist: {scan_path}")
    
    files: List[ScannedFile] = []
    
    for file_path in scan_directory(scan_path, min_video_size_mb=float(request.min_size_mb)):
        # Parse filename
        metadata = renamer.parse_filename(file_path)
        
        # Get candidates from API
        candidates_raw = await renamer.get_candidates(metadata)
        
        # Convert to FileCandidate models
        candidates = []
        for c in candidates_raw:
            # Debug logging
            print(f"Candidate ({c.get('type')}): {c.get('title')} - Poster: {c.get('poster_path')}")

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
        
        # Propose path using first candidate (default selection)
        selected_metadata = metadata.copy()
        if candidates:
            selected_metadata.update(candidates_raw[0])
            # Renamer ensures explicit type 'audiobook' is preserved or set
            
        # Get relative path from renamer
        new_relative = renamer.propose_new_path(file_path, selected_metadata)
        
        # Determine base directory
        base_dir = config.DEST_DIR
        ftype = selected_metadata.get('type')
        if ftype == 'movie':
            base_dir = config.MOVIE_DIR
        elif ftype == 'tv':
            base_dir = config.TV_DIR
        elif ftype == 'book':
            base_dir = config.BOOK_DIR
        elif ftype == 'audiobook':
            base_dir = config.AUDIOBOOK_DIR
            
        proposed_path = str(base_dir / new_relative)
        
        files.append(ScannedFile(
            original_path=str(file_path),
            filename=file_path.name,
            file_type=ftype or 'unknown',
            candidates=candidates,
            selected_index=0,
            proposed_path=proposed_path
        ))
    
    return ScanResponse(
        files=files,
        source_dir=str(scan_path),
        dest_dir=str(config.DEST_DIR)
    )

@app.post("/execute")
async def execute_moves(request: ExecuteRequest):
    import shutil
    
    moved = []
    errors = []
    
    for file_info in request.files:
        try:
            original = Path(file_info['original_path'])
            
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
                
            target = base_dir / new_relative
            
            # Create directories and move
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(original), str(target))
            
            moved.append({
                "from": str(original),
                "to": str(target)
            })
        except Exception as e:
            errors.append({
                "file": file_info.get('original_path'),
                "error": str(e)
            })
            
    return {"moved": moved, "errors": errors}
    
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

# ============== Run Server ==============

def start_server(port: int = 8742):
    """Start the API server (called by Tauri)"""
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

if __name__ == "__main__":
    start_server()
