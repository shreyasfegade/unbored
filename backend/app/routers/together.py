"""Watch Together — group rooms.

Several people join a room with a short code, each contributes the favourites
their browser already holds, and the group gets one blended pick from the same
engine that powers solo recommendations. Rooms are in-memory with a TTL
(app.services.rooms); nothing is persisted and no account is needed.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Request

from app.exceptions import AppError
from app.models.mood import EraPreference
from app.models.recommendation import RecommendationRequest, RecommendationResponse
from app.models.together import (
    CreateRoomRequest,
    JoinResult,
    JoinRoomRequest,
    MemberView,
    RoomPickRequest,
    RoomState,
)
from app.routers.recommend import _run_pipeline
from app.services.rooms import ROOM_TTL, Room, RoomError, store

router = APIRouter()


def _state(room: Room) -> RoomState:
    idle = time.time() - room.last_activity
    return RoomState(
        code=room.code,
        members=[
            MemberView(id=m.id, name=m.name, favourite_count=len(m.favourite_ids))
            for m in room.members.values()
        ],
        combined_favourites=len(room.combined_favourites),
        expires_in=max(0, int(ROOM_TTL - idle)),
    )


def _guard(exc: RoomError) -> AppError:
    return AppError(exc.status, exc.message, "ROOM_ERROR")


@router.post("/together/rooms", response_model=JoinResult)
async def create_room(body: CreateRoomRequest):
    """Open a room. The creator joins as its first member, so hosting takes one
    call and their taste is already in the room."""
    try:
        room, member = store.create(body.name, body.favourite_ids)
    except RoomError as exc:
        raise _guard(exc) from exc
    return JoinResult(member_id=member.id, room=_state(room))


@router.post("/together/rooms/{code}/join", response_model=JoinResult)
async def join_room(code: str, body: JoinRoomRequest):
    """Join an existing room, bringing whatever favourites you already have."""
    try:
        room, member = store.join(code, body.name, body.favourite_ids)
    except RoomError as exc:
        raise _guard(exc) from exc
    return JoinResult(member_id=member.id, room=_state(room))


@router.get("/together/rooms/{code}", response_model=RoomState)
async def get_room(code: str):
    """The live room — who's in it and how much taste is pooled. Polled by the
    clients so the room feels alive as people join."""
    try:
        room = store.get(code)
    except RoomError as exc:
        raise _guard(exc) from exc
    return _state(room)


@router.post("/together/rooms/{code}/pick", response_model=RecommendationResponse)
async def room_pick(code: str, body: RoomPickRequest, request: Request):
    """Blend every member's taste into one pick everyone can watch. The engine's
    centroid sits among all the tastes, which is exactly the compromise wanted.
    Engine-only (no per-user LLM key in a shared room)."""
    try:
        room = store.get(code)
    except RoomError as exc:
        raise _guard(exc) from exc

    merged = room.combined_favourites
    rec = RecommendationRequest(
        favourite_ids=merged,
        mood=body.mood,
        time_available=body.time_available,
        time_of_day="evening",
        media_type="surprise",
        era=EraPreference.ANY,
        excluded_ids=[],
    )
    return await _run_pipeline(request, rec, provider=None)
