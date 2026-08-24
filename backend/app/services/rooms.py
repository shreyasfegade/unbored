"""In-memory group rooms for Watch Together.

A room is a short-lived, shared taste session: several people join with a code,
each contributes the favourites their browser already holds, and the group gets
one blended pick. Consistent with the rest of the API, there is no database —
rooms live in process memory with a TTL, so an API restart simply drops open
rooms, which cost nothing to recreate. Bounded in every direction (rooms,
members, lifetime) so this can never grow without limit.
"""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field

ROOM_TTL = 2 * 3600          # rooms expire two hours after last activity
MAX_MEMBERS = 12
MAX_ROOMS = 60
MAX_FAVOURITES = 100         # matches the recommend API's favourite_ids cap
_CODE_LEN = 4
# No 0/O/1/I: a code is read aloud and typed by hand.
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class RoomError(Exception):
    """Raised for expected room failures; the router maps .code to HTTP status."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class Member:
    id: str
    name: str
    favourite_ids: list[str]
    joined_at: float


@dataclass
class Room:
    code: str
    created_at: float
    last_activity: float
    members: dict[str, Member] = field(default_factory=dict)

    def touch(self) -> None:
        self.last_activity = time.time()

    @property
    def combined_favourites(self) -> list[str]:
        """Every member's favourites, de-duplicated, capped for the engine."""
        seen: set[str] = set()
        out: list[str] = []
        for m in self.members.values():
            for fid in m.favourite_ids:
                if fid not in seen:
                    seen.add(fid)
                    out.append(fid)
        return out[:MAX_FAVOURITES]


class RoomStore:
    """Thread-safe store. FastAPI runs handlers in a threadpool, so the lock is
    not ceremonial."""

    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}
        self._lock = threading.Lock()

    def _prune(self, now: float) -> None:
        dead = [code for code, r in self._rooms.items() if now - r.last_activity > ROOM_TTL]
        for code in dead:
            self._rooms.pop(code, None)

    def _new_code(self) -> str:
        for _ in range(64):
            code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LEN))
            if code not in self._rooms:
                return code
        raise RoomError(503, "Couldn't allocate a room code, try again.")

    def create(self, name: str, favourite_ids: list[str]) -> tuple[Room, Member]:
        now = time.time()
        with self._lock:
            self._prune(now)
            if len(self._rooms) >= MAX_ROOMS:
                raise RoomError(503, "Too many rooms open right now — try again shortly.")
            code = self._new_code()
            room = Room(code=code, created_at=now, last_activity=now)
            self._rooms[code] = room
            member = self._add_member(room, name, favourite_ids, now)
            return room, member

    def join(self, code: str, name: str, favourite_ids: list[str]) -> tuple[Room, Member]:
        now = time.time()
        with self._lock:
            room = self._require(code, now)
            if len(room.members) >= MAX_MEMBERS:
                raise RoomError(409, "This room is full.")
            member = self._add_member(room, name, favourite_ids, now)
            return room, member

    def get(self, code: str) -> Room:
        now = time.time()
        with self._lock:
            return self._require(code, now)

    # ── internals (call with the lock held) ────────────────────────────
    def _require(self, code: str, now: float) -> Room:
        self._prune(now)
        room = self._rooms.get((code or "").strip().upper())
        if room is None:
            raise RoomError(404, "That room code isn't active.")
        room.touch()
        return room

    def _add_member(self, room: Room, name: str, favourite_ids: list[str], now: float) -> Member:
        member = Member(
            id=secrets.token_urlsafe(8),
            name=(name or "Guest").strip()[:24] or "Guest",
            favourite_ids=list(dict.fromkeys(favourite_ids))[:MAX_FAVOURITES],
            joined_at=now,
        )
        room.members[member.id] = member
        room.touch()
        return member


# Process-wide singleton.
store = RoomStore()
