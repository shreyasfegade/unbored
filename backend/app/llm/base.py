"""Provider-agnostic LLM interface.

A provider's only job is to turn a (system, user) prompt pair into a single
string of generated text, or ``None`` if generation failed for any reason
(timeout, rate limit, bad response). All the product logic — prompt building,
caching, validation, fallbacks — lives one layer up in
:class:`app.services.why_now.WhyNowService`, so swapping providers never
touches that logic.
"""

from __future__ import annotations

import abc


class LLMProvider(abc.ABC):
    """Base class for a text-generation backend."""

    #: Stable identifier, e.g. "gemini" or "deepseek".
    name: str = "base"
    #: Human-readable model id, e.g. "gemini-2.0-flash".
    model: str = ""

    @abc.abstractmethod
    async def generate(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.7,
        max_tokens: int = 120,
    ) -> str | None:
        """Return generated text, or ``None`` on any failure."""

    @property
    def label(self) -> str:
        """Display label combining provider and model."""
        return f"{self.name} · {self.model}" if self.model else self.name

    async def close(self) -> None:  # pragma: no cover - default no-op
        """Release any held resources (HTTP clients, etc.)."""
