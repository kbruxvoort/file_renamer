# File Renamer - Development Guide

## Reinstalling After Code Changes

When you modify the source code, the globally installed `renamer` command will still use the old version. To update it:

```bash
# Build a fresh wheel from source
uv build

# Reinstall the tool from the new wheel
uv tool install dist/file_renamer-0.1.0-py3-none-any.whl --force
```

If you encounter stale code issues, clear the cache first:
```bash
uv cache clean
uv tool uninstall file-renamer
uv build
uv tool install dist/file_renamer-0.1.0-py3-none-any.whl
```

## Running the Tool

```bash
# Basic dry-run (default)
renamer scan <path>

# Interactive mode (prompts you to select matches)
renamer scan <path> --interactive

# Execute changes (actually move files)
renamer scan <path> --execute

# Skip size filter for testing with small files
renamer scan <path> --min-size 0
```

## Configuration

Set global config values:
```bash
renamer config-set TMDB_API_KEY "your-key"
renamer config-set DEST_DIR "C:\Media"
```

Config is stored in `~/.renamer_config.json`.

## Version Management

To bump the application version across all files (Tauri, Cargo, Python, Package.json):

```bash
python scripts/bump_version.py 0.1.3
```
