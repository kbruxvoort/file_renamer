import asyncio
import typer
from rich.console import Console
from rich.table import Table
from pathlib import Path
from src.scanner import scan_directory
from src.renamer import renamer
from src.config import config

app = typer.Typer(
    name="renamer",
    help="Media file organizer - Scans directories and renames/organizes files using TMDB and Google Books metadata.",
    add_completion=False
)
console = Console()

from rich.prompt import Prompt

async def run_scan(path: Path, dry_run: bool, interactive: bool, min_size: int):
    if not path.exists():
        console.print(f"[red]Error: Path {path} does not exist.[/red]")
        raise typer.Exit(code=1)

    console.print(f"Scanning [bold blue]{path}[/bold blue]...")

    table = Table(title="Proposed Renames")
    table.add_column("Original", style="cyan")
    table.add_column("Proposed", style="green")
    table.add_column("Type", style="magenta")

    files_found = 0
    
    for file_path in scan_directory(path, min_video_size_mb=float(min_size)):
        files_found += 1
        with console.status(f"Processing [bold]{file_path.name}[/bold]..."):
            # 1. Parse filename locally
            metadata = renamer.parse_filename(file_path.name)
            
            # 2. Get Candidates (Async)
            candidates = await renamer.get_candidates(metadata)
        
        # Selection Logic (Outside of spinner to allow input)
        if candidates:
            if len(candidates) > 1 and interactive:
                console.print(f"\n[bold yellow]Ambiguous result for: {file_path.name}[/bold yellow]")
                for i, cand in enumerate(candidates):
                    desc = f"{cand['title']} ({cand.get('year', 'N/A')})"
                    console.print(f"  {i+1}. {desc} - [dim]{cand.get('overview', '')}[/dim]")
                
                choice = Prompt.ask("Select a match", choices=[str(i+1) for i in range(len(candidates))] + ['s'], default='1')
                if choice == 's':
                     console.print("Skipping...")
                     continue
                selected = candidates[int(choice)-1]
                metadata.update(selected)
            else:
                 # Auto-pick first
                 metadata.update(candidates[0])
            
        # 3. Propose new path
        new_relative_path = renamer.propose_new_path(file_path, metadata)
        
        # Construct full new destination path
        new_full_path = config.DEST_DIR / new_relative_path
        
        table.add_row(file_path.name, str(new_relative_path), metadata.get('type', 'unknown'))
        
        if not dry_run:
            # Create parent dirs and move file
            target_path = new_full_path
            if not target_path.parent.exists():
                target_path.parent.mkdir(parents=True, exist_ok=True)
            
            import shutil
            shutil.move(str(file_path), str(target_path))
            console.print(f"[green]Moved:[/green] {file_path.name} → {target_path}")

    console.print(table)
    
    if files_found == 0:
        console.print("[yellow]No media files found.[/yellow]")
    
    if dry_run:
        console.print("\n[bold yellow]DRY RUN[/bold yellow]: No files were moved. Use --execute to apply changes.")
    else:
        console.print("\n[bold green]SUCCESS[/bold green]: Files processed.")

@app.command()
def config_set(
    key: str = typer.Argument(..., help="Config key (TMDB_API_KEY, DEST_DIR, etc)"),
    value: str = typer.Argument(..., help="Value to set")
):
    """
    Set a configuration value globally (e.g. TMDB_API_KEY, DEST_DIR).
    """
    config.save(key.upper(), value)
    console.print(f"[green]Updated {key.upper()} = {value}[/green]")

@app.command()
def scan(
    path: Path = typer.Argument(None, help="Directory to scan (defaults to SOURCE_DIR config)"),
    dry_run: bool = typer.Option(True, "--dry-run/--execute", help="Preview changes (default) or actually move files"),
    interactive: bool = typer.Option(True, "--interactive/--auto", help="Prompt to select matches (default) or auto-pick best"),
    min_size: int = typer.Option(50, "--min-size", help="Minimum video file size in MB (filters out samples)"),
    verbose: bool = typer.Option(False, "--verbose", help="Show detailed output")
):
    """
    Scans a directory for media files and proposes renames.
    """
    # Use SOURCE_DIR from config if path not provided
    scan_path = path or config.SOURCE_DIR
    if not scan_path:
        console.print("[red]Error: No path provided. Either pass a path or set SOURCE_DIR with:[/red]")
        console.print("[yellow]  renamer config-set SOURCE_DIR \"C:\\\\path\\\\to\\\\downloads\"[/yellow]")
        raise typer.Exit(code=1)
    
    asyncio.run(run_scan(scan_path, dry_run, interactive, min_size))

if __name__ == "__main__":
    app()
