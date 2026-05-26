import pytest
from pathlib import Path
from app.storage.file_store import FileStore
from app.models.taste import UserTasteVector

def test_file_store_lifecycle(tmp_path, monkeypatch):
    test_storage_dir = tmp_path / "data"
    monkeypatch.setattr("app.storage.file_store.settings.storage_dir", str(test_storage_dir))

    store = FileStore()

    assert store.profiles_file.exists()
    assert len(store._load_store().profiles) == 0

    vector = UserTasteVector(
        genres={"action": 0.8, "sci-fi": 0.6},
        favourites=["tmdb_27205"],
        watched_ids=["tmdb_27205"]
    )

    store.save_vector(vector)
    assert len(store._load_store().profiles) == 1

    retrieved = store.get_vector(vector.id)
    assert retrieved is not None
    assert retrieved.id == vector.id
    assert retrieved.genres["action"] == 0.8
    assert retrieved.favourites == ["tmdb_27205"]

    vector.genres["comedy"] = 0.5
    store.save_vector(vector)

    retrieved_updated = store.get_vector(vector.id)
    assert retrieved_updated is not None
    assert retrieved_updated.genres["comedy"] == 0.5
    assert len(store._load_store().profiles) == 1

    assert store.delete_vector(vector.id) is True
    assert store.get_vector(vector.id) is None
    assert len(store._load_store().profiles) == 0

    assert store.delete_vector("non-existent-id") is False
