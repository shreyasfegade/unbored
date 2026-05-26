import json
import logging
from pathlib import Path
from app.config import settings
from app.models.taste import UserTasteVector
from app.storage.models import TasteProfileStore

logger = logging.getLogger(__name__)

class FileStore:
    """JSON file-based storage for taste profiles. Implements Pydantic TasteProfileStore schema."""

    def __init__(self):
        self.storage_dir = Path(settings.storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.profiles_file = self.storage_dir / "taste_profiles.json"
        self._ensure_file()

    def _ensure_file(self):
        if not self.profiles_file.exists():
            store = TasteProfileStore(version=1, profiles=[])
            self.profiles_file.write_text(store.model_dump_json(indent=2))

    def save_vector(self, vector: UserTasteVector) -> None:
        """Save or update a UserTasteVector in the store."""
        store = self._load_store()
        updated = False
        for i, profile in enumerate(store.profiles):
            if profile.id == vector.id:
                store.profiles[i] = vector
                updated = True
                break
        if not updated:
            store.profiles.append(vector)
        self._write_store(store)
        logger.info(f"Saved taste vector: {vector.id}")

    def get_vector(self, vector_id: str) -> UserTasteVector | None:
        """Retrieve a UserTasteVector by ID. Returns None if not found."""
        store = self._load_store()
        for profile in store.profiles:
            if profile.id == vector_id:
                return profile
        return None

    def delete_vector(self, vector_id: str) -> bool:
        """Delete a UserTasteVector by ID. Returns True if deleted, False if not found."""
        store = self._load_store()
        initial_len = len(store.profiles)
        store.profiles = [p for p in store.profiles if p.id != vector_id]
        if len(store.profiles) < initial_len:
            self._write_store(store)
            logger.info(f"Deleted taste vector: {vector_id}")
            return True
        return False

    def _load_store(self) -> TasteProfileStore:
        try:
            if not self.profiles_file.exists():
                return TasteProfileStore(version=1, profiles=[])
            raw = self.profiles_file.read_text(encoding="utf-8")
            return TasteProfileStore.model_validate_json(raw)
        except Exception as e:
            logger.error(f"Failed to load profile store: {e}")
            return TasteProfileStore(version=1, profiles=[])

    def _write_store(self, store: TasteProfileStore) -> None:
        try:
            self.profiles_file.write_text(
                store.model_dump_json(indent=2),
                encoding="utf-8"
            )
        except Exception as e:
            logger.error(f"Failed to write profile store: {e}")

# Singleton instance
file_store = FileStore()
