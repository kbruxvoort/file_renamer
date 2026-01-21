import json
import shutil
import uuid
from pathlib import Path
from typing import List, Dict, Any
from src import filesystem

from datetime import datetime

HISTORY_FILE = Path.home() / ".renamer_history.json"

class UndoManager:
    def __init__(self):
        self.history_file = HISTORY_FILE
        self._load_history()

    def _load_history(self):
        if self.history_file.exists():
            try:
                self.history = json.loads(self.history_file.read_text())
            except Exception:
                self.history = []
        else:
            self.history = []

    def _save_history(self):
        self.history_file.write_text(json.dumps(self.history, indent=2))

    def record_batch(self, operations: List[Dict[str, str]]):
        """
        Records a batch of successful operations.
        operations: List of {'src': str, 'dest': str}
        """
        if not operations:
            return

        entry = {
            "batch_id": str(uuid.uuid4()),
            "timestamp": datetime.now().isoformat(),
            "operations": operations
        }
        self.history.insert(0, entry) # Prepend to keep latest first
        # Limit history to last 50 batches to save space
        self.history = self.history[:50]
        self._save_history()

    def get_history(self) -> List[Dict[str, Any]]:
        return self.history

    def undo_last_batch(self) -> Dict[str, Any]:
        """
        Reverses the most recent batch of operations.
        Returns report of success/failures.
        """
        if not self.history:
            return {"success": False, "message": "No history found."}

        last_batch = self.history[0]
        ops = last_batch['operations']
        
        undo_results = []
        failures = []

        # We need to reverse the operations (last moved file should be moved back first? 
        # Order shouldn't strictly matter for moves unless there's a chain, but reverse is safer)
        for op in reversed(ops):
            src = Path(op['src'])
            dest = Path(op['dest'])
            
            # To undo: move from dest back to src
            try:
                if not dest.exists():
                    failures.append(f"File missing at {dest}")
                    continue

                if src.exists():
                    # Collision! Original location blocked.
                    # We could try to rename, but for undo, maybe we fail?
                    # Or we rename to src (1)
                    failures.append(f"Original location occupied: {src}")
                    continue
                
                # Ensure parent exists (in case we deleted empty dirs)
                src.parent.mkdir(parents=True, exist_ok=True)
                
                shutil.move(str(dest), str(src))
                undo_results.append(f"Restored {src.name}")

                # Clean up the directory we just moved FROM (dest.parent)
                # If it's empty now, delete it.
                # We do not want to delete the ROOT (like 'Movies'), so we might need to know the root.
                # But clean_empty_dirs handles up to a root. Here we don't strictly know the root 
                # (Movies/TV/etc), but typically we just want to remove the specific folder created.
                # Let's pass DEST_DIR as root? We don't have access to config here easily without import.
                # Let's just clean up the immediate parent if empty to be safe, or just call clean_empty_dirs
                # which recursively cleans up. We should probably NOT clean up the top level dirs.
                # filesystem.clean_empty_dirs takes a root_path.
                # For safety, let's just try to clean the parent directory.
                filesystem.clean_empty_dirs(dest.parent)
                
            except Exception as e:
                failures.append(f"Error moving {dest} -> {src}: {e}")

        # Remove from history
        self.history.pop(0)
        self._save_history()

        return {
            "success": True,
            "restored_count": len(undo_results),
            "failure_count": len(failures),
            "failures": failures
        }

undo_manager = UndoManager()
