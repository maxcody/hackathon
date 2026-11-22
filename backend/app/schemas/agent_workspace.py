"""Request and response shapes for user-created agents."""

from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints


class AgentCreate(BaseModel):
    """Settings provided when creating an agent."""

    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
    ]
    instructions: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=4000)
    ] = ""


class ChatInput(BaseModel):
    """One user message."""

    message: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8000)
    ]


class ChatMessage(BaseModel):
    """A stored user or assistant message."""

    role: Literal["user", "assistant"]
    content: str


class AgentSummary(BaseModel):
    """An agent in the workspace list."""

    id: str
    name: str


class WorkspaceAgent(AgentSummary):
    """A user-created agent and its conversation."""

    instructions: str
    messages: list[ChatMessage]
