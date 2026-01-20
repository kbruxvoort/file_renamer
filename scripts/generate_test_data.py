import os
from pathlib import Path
import shutil

def create_dummy_file(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w') as f:
        f.write("Dummy media content")

def generate_test_data(base_dir: str = "tests/fixtures/Sandbox"):
    root = Path(base_dir)
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)

    print(f"Generating test data in {root.resolve()}...")

    # Scenario 1: Clean Show Folder
    show1 = root / "Firefly (2002)"
    for i in range(1, 15):
        create_dummy_file(show1 / f"Firefly - 1x{i:02d} - Episode Title.mkv")
    
    # Scenario 2: Mixed "Downloads" Folder
    downloads = root / "Downloads"
    # Show A
    create_dummy_file(downloads / "The.Mandalorian.S01E01.mkv")
    create_dummy_file(downloads / "The.Mandalorian.S01E02.mkv")
    create_dummy_file(downloads / "The.Mandalorian.S01E03.mkv")
    # Show B (Completely different)
    create_dummy_file(downloads / "Stranger.Things.S01E01.mp4")
    create_dummy_file(downloads / "Stranger.Things.S01E02.mp4")
    # A Movie
    create_dummy_file(downloads / "Inception.2010.1080p.mkv")
    
    # Scenario 3: Ambiguous Folder (Common Issue)
    # Both 2005 and 2009 versions exist, usually triggers multiple candidates
    ambiguous = root / "The Office"
    create_dummy_file(ambiguous / "The.Office.S01E01.avi")
    create_dummy_file(ambiguous / "The.Office.S01E02.avi")
    create_dummy_file(ambiguous / "The.Office.S01E03.avi")

    # Scenario 4: Anime (Complex numbering)
    anime = root / "One Piece"
    create_dummy_file(anime / "[SubGrp] One Piece - 001.mkv")
    create_dummy_file(anime / "[SubGrp] One Piece - 002.mkv")

    print("Done! You can now scan 'tests/fixtures/Sandbox' in the app.")

if __name__ == "__main__":
    generate_test_data()
