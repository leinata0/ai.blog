"""Shared visitor-account operations used by both admin and self-service paths."""
from __future__ import annotations

from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from app.models import Comment, FollowedTopic, PostLike, ReadingHistory, User


def purge_user(db: Session, user: User) -> None:
    """Delete a user and clean up their data.

    Comments are anonymized (kept with user_id=NULL); likes, followed topics,
    and reading history are removed. FK cascade/SET NULL is unreliable here
    (SQLite doesn't enforce FKs by default, and prod adds these columns as bare
    columns via schema_compat), so cleanup is explicit. Does NOT commit — the
    caller owns the transaction.
    """
    db.execute(update(Comment).where(Comment.user_id == user.id).values(user_id=None))
    db.execute(delete(PostLike).where(PostLike.user_id == user.id))
    db.execute(delete(FollowedTopic).where(FollowedTopic.user_id == user.id))
    db.execute(delete(ReadingHistory).where(ReadingHistory.user_id == user.id))
    db.delete(user)
