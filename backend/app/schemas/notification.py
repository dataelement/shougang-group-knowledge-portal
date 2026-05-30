from pydantic import BaseModel


class NotificationSummary(BaseModel):
    """Unread / pending counts for the portal header badges.

    - ``todo``: approval tasks pending the current user's action (待办) —
      ``my-tasks`` items whose ``status`` is ``pending``
    - ``messages``: unread messages (消息) — ``unread_count.total``, matching
      the "全部" badge inside the notifications dialog
    - ``total``: sum of the above; drives the aggregate red dot on the avatar
    """

    todo: int = 0
    messages: int = 0
    total: int = 0
