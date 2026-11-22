"""unique notification key

Revision ID: 5b2d7e41c9a0
Revises: 017ff6a1a3c8
Create Date: 2026-11-22 01:10:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5b2d7e41c9a0"
down_revision: str | Sequence[str] | None = "017ff6a1a3c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Keep the newest row per data.key, then make the key unique."""
    op.execute("""
        DELETE FROM notifications a
        USING notifications b
        WHERE a.data->>'key' = b.data->>'key' AND a.id < b.id
        """)
    op.execute(
        "CREATE UNIQUE INDEX uq_notifications_key ON notifications ((data->>'key'))"
    )


def downgrade() -> None:
    """Allow duplicate keys again."""
    op.execute("DROP INDEX uq_notifications_key")
