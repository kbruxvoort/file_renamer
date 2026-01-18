from pathlib import Path
import os

fixtures_dir = Path("tests/fixtures")
files = [
    "Downloads/Inception.2010.1080p.mp4",
    "Downloads/The.Matrix.1999.mkv",
    "Downloads/Breaking.Bad.S01E01.Pilot.avi",
    "Downloads/Stranger Things S01E02.mp4",
    "Downloads/My.Unknown.Movie.mkv"
]

def create_fixtures():
    if fixtures_dir.exists():
        import shutil
        shutil.rmtree(fixtures_dir)
    
    fixtures_dir.mkdir(parents=True)
    
    for relative_path in files:
        file_path = fixtures_dir / relative_path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w") as f:
            f.write("dummy content")
    
    print(f"Created {len(files)} fixture files in {fixtures_dir}")

if __name__ == "__main__":
    create_fixtures()
