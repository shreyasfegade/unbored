from pydantic import BaseModel, Field
from app.models.taste import UserTasteVector

class TasteProfileStore(BaseModel):
    version: int = 1
    profiles: list[UserTasteVector] = Field(default_factory=list)
