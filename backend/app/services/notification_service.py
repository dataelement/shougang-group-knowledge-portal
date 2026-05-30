import logging

from app.clients.bisheng import BishengClient
from app.schemas.notification import NotificationSummary

logger = logging.getLogger(__name__)

_PENDING_TASK_STATUS = "pending"


def _as_int(value: object) -> int:
    try:
        return max(0, int(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0


class NotificationService:
    """Aggregate the portal header badge counts from BiSheng.

    Each upstream call is isolated: if one fails we surface 0 for that bucket
    instead of failing the whole badge, so a flaky approval service never hides
    the unread message count (and vice versa).
    """

    def __init__(self, bisheng_client: BishengClient):
        self._bisheng = bisheng_client

    async def get_summary(self) -> NotificationSummary:
        messages = await self._fetch_unread_messages()
        todo = await self._fetch_pending_todo_count()
        return NotificationSummary(
            todo=todo,
            messages=messages,
            total=todo + messages,
        )

    async def _fetch_unread_messages(self) -> int:
        """Total unread messages — matches the dialog's "全部" badge."""
        try:
            response = await self._bisheng.get_json("/api/v1/message/unread_count")
        except Exception:  # noqa: BLE001 - badge must degrade gracefully
            logger.warning("failed to fetch BiSheng unread_count", exc_info=True)
            return 0
        data = response.get("data") if isinstance(response, dict) else None
        if not isinstance(data, dict):
            return 0
        return _as_int(data.get("total"))

    async def _fetch_pending_todo_count(self) -> int:
        """Count approval tasks awaiting the current user (待办).

        ``my-tasks`` returns tasks in every terminal state too (approved /
        rejected / skipped / cancelled), so we count only ``status == pending``
        rather than trusting the response's ``total``.
        """
        try:
            response = await self._bisheng.get_json("/api/v1/approval/my-tasks")
        except Exception:  # noqa: BLE001 - badge must degrade gracefully
            logger.warning("failed to fetch BiSheng my-tasks", exc_info=True)
            return 0
        data = response.get("data") if isinstance(response, dict) else None
        items = data.get("data") if isinstance(data, dict) else data
        if not isinstance(items, list):
            return 0
        return sum(
            1
            for item in items
            if isinstance(item, dict) and item.get("status") == _PENDING_TASK_STATUS
        )
