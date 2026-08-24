from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.mood import MoodType, TimeSlot


class CreateRoomRequest(BaseModel):
    name: str = Field(default="Guest", max_length=24)
    favourite_ids: list[str] = Field(default_factory=list, max_length=100)


class JoinRoomRequest(BaseModel):
    name: str = Field(default="Guest", max_length=24)
    favourite_ids: list[str] = Field(default_factory=list, max_length=100)


class RoomPickRequest(BaseModel):
    mood: MoodType
    time_available: TimeSlot


class MemberView(BaseModel):
    """What everyone in the room may see about a member — a name and how much
    taste they brought, never the titles themselves."""

    id: str
    name: str
    favourite_count: int


class RoomState(BaseModel):
    code: str
    members: list[MemberView]
    combined_favourites: int
    expires_in: int  # seconds until the room lapses if idle


class JoinResult(BaseModel):
    member_id: str
    room: RoomState
