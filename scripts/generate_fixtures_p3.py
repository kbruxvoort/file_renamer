from pathlib import Path
import os
import random

fixtures_dir = Path("tests/fixtures_p3")

def create_fixtures():
    if fixtures_dir.exists():
        import shutil
        shutil.rmtree(fixtures_dir)
    
    fixtures_dir.mkdir(parents=True)
    
    # 1. Ambiguous Movie (Avatar)
    (fixtures_dir / "Avatar.mp4").write_text("dummy content " * 1000) # Small but Valid
    
    # 2. Sample File (Small + "sample" in name)
    (fixtures_dir / "Movies/Some.Movie.Sample.mkv").parent.mkdir(parents=True, exist_ok=True)
    (fixtures_dir / "Movies/Some.Movie.Sample.mkv").write_text("x") # 1 byte
    
    # 3. Small Video (No "sample" in name but < 50MB) -> Should be skipped based on Logic?
    # Logic: if in VIDEO_EXT and < MIN_VIDEO_SIZE_MB (50) -> Skip
    (fixtures_dir / "Tiny.Video.mp4").write_text("x" * 1024 * 1024) # 1MB

    print(f"Created fixtures in {fixtures_dir}")

if __name__ == "__main__":
    create_fixtures()
