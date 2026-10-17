import json
import shutil
import uuid
from pathlib import Path
from typing import List, Dict, Any, Optional
from src import filesystem
from src.config import config

from datetime import datetime

HISTORY_FILE = Path.home() / ".renamer_history.json"

class UndoManager:
    def __init__(self):
        self.history_file = HISTORY_FILE
        self._load_history()

    def _load_history(self):
        self.history = []
        if not self.history_file.exists():
            return
        try:
            self.history = [self._normalize_batch(b) for b in json.loads(self.history_file.read_text())]
        except Exception:
            # Keep the unreadable file instead of overwriting it on the next save
            backup = self.history_file.with_suffix('.corrupt.json')
            shutil.copy2(self.history_file, backup)
            self.history = []

    @staticmethod
    def _normalize_batch(batch: Dict[str, Any]) -> Dict[str, Any]:
        """Older versions recorded moves as {'from', 'to'}; current code uses {'src', 'dest'}."""
        for op in batch.get('operations', []):
            if 'src' not in op and 'from' in op:
                op['src'] = op.pop('from')
            if 'dest' not in op and 'to' in op:
                op['dest'] = op.pop('to')
        return batch

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
        """Reverses the most recent batch of operations."""
        return self.undo_batch(None)

    def undo_batch(self, batch_id: Optional[str]) -> Dict[str, Any]:
        """
        Reverses one batch (the most recent when batch_id is None).
        Operations that can't be restored stay in history so the undo can be retried.
        """
        if not self.history:
            return {"success": False, "message": "No history found.", "restored_count": 0, "failure_count": 0, "failures": []}

        index = 0
        if batch_id is not None:
            index = next((i for i, b in enumerate(self.history) if b.get('batch_id') == batch_id), -1)
            if index == -1:
                return {"success": False, "message": "That batch is no longer in history.", "restored_count": 0, "failure_count": 0, "failures": []}

        batch = self.history[index]
        restored = []
        failures = []
        remaining_ops = []

        library_roots = config.library_dirs()
        # Where newer batches moved files from: a file missing here may just have been moved
        # on by a later batch, which has to be undone first
        moved_on_later = {op['src'] for b in self.history[:index] for op in b['operations']}

        # Reverse order so associated files and chains unwind cleanly
        for op in reversed(batch['operations']):
            src = Path(op['src'])
            dest = Path(op['dest'])

            # To undo: move from dest back to src
            try:
                if not dest.exists():
                    if str(dest) in moved_on_later:
                        failures.append({"file": str(dest), "error": "A newer batch moved this file; undo that batch first"})
                        remaining_ops.insert(0, op)
                    else:
                        # Nothing left to restore; retrying won't help, so drop it
                        failures.append({"file": str(dest), "error": "File is no longer at its new location"})
                    continue

                if src.exists():
                    failures.append({"file": str(src), "error": "Original location is occupied"})
                    remaining_ops.insert(0, op)
                    continue

                # Ensure parent exists (in case we deleted empty dirs)
                src.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(dest), str(src))
                restored.append(str(src))

                # Remove the now-empty folders the move created, but never a library root
                filesystem.clean_empty_dirs(dest.parent, root_path=filesystem.find_root(dest, library_roots))

            except Exception as e:
                failures.append({"file": str(dest), "error": str(e)})
                remaining_ops.insert(0, op)

        # Keep anything that could still be undone later; drop the batch when nothing is left
        if remaining_ops:
            batch['operations'] = remaining_ops
        else:
            self.history.pop(index)
        self._save_history()

        return {
            "success": not failures,
            "message": None if not failures else f"{len(failures)} file(s) could not be restored.",
            "restored_count": len(restored),
            "failure_count": len(failures),
            "failures": failures,
        }

undo_manager = UndoManager()
