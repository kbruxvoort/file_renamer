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

from src.scanner import scan_directory, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, BOOK_EXTENSIONS, ALL_EXTENSIONS
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
    
    # Process each path
    for path in scan_paths:
        if not path.exists():
            print(f"Skipping non-existent path: {path}")
            continue

        search_targets = []
        if path.is_file():
            # If it's a file, verify extension and add directly
            if path.suffix.lower() in ALL_EXTENSIONS: 
                 search_targets.append(path)
            else:
                 # Check if the user really wanted this file? 
                 # For drag and drop of specific file, we might want to check against ALL_EXTENSIONS
                 # But we need access to that list. Imported from scanner below.
                 pass
        else:
            # It's a directory, scan it
            search_targets.extend(scan_directory(path, min_video_size_mb=float(request.min_size_mb)))

        
        for file_path in search_targets:
            # Parse filename
            try:
                metadata = renamer.parse_filename(file_path)
                
                # Get candidates from API
                candidates_raw = await renamer.get_candidates(metadata)
                
                # Convert to FileCandidate models
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
                
                # Propose path using first candidate (default selection)
                selected_metadata = metadata.copy()
                if candidates:
                    selected_metadata.update(candidates_raw[0])
                
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
            except Exception as e:
                print(f"Error processing {file_path}: {e}")
                continue
    
    # Just use first path or config as source_dir for display
    display_source = str(scan_paths[0]) if scan_paths else str(config.SOURCE_DIR)

    return ScanResponse(
        files=files,
        source_dir=display_source, 
        dest_dir=str(config.DEST_DIR)
    )

@app.post("/execute")
async def execute_moves(request: ExecuteRequest):
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
                "from": str(original),
                "to": str(final_target)
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
                        "from": str(assoc),
                        "to": str(target_assoc),
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
