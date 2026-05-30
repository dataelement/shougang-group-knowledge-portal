from fastapi.testclient import TestClient

from app.main import app


def _task(status):
    return {"task_id": 1, "status": status}


class FakeBishengClient:
    def __init__(self, *, unread=None, my_tasks=None, fail_paths=None):
        self._unread = unread
        self._my_tasks = my_tasks
        self._fail_paths = set(fail_paths or [])
        self.calls = []

    async def get_json(self, path: str, params=None):
        self.calls.append(path)
        if path in self._fail_paths:
            raise RuntimeError("upstream boom")
        if path == "/api/v1/message/unread_count":
            return {"status_code": 200, "data": self._unread}
        if path == "/api/v1/approval/my-tasks":
            return {"status_code": 200, "data": self._my_tasks}
        raise AssertionError(f"Unexpected path: {path}")

    async def aclose(self):
        pass


class FakePortalAuthService:
    def __init__(self, client):
        self._client = client

    def require_session(self, _request):
        return object()

    def create_bisheng_client(self, _session):
        return self._client


class NoSessionPortalAuthService(FakePortalAuthService):
    def require_session(self, _request):
        from app.services.portal_auth_service import PortalAuthError

        raise PortalAuthError("请先登录", status_code=401)


def _call_summary(fake_auth):
    with TestClient(app) as client:
        previous = getattr(client.app.state, "portal_auth_service", None)
        client.app.state.portal_auth_service = fake_auth
        try:
            return client.get("/api/v1/portal/notifications/summary")
        finally:
            if previous is not None:
                client.app.state.portal_auth_service = previous


def test_summary_uses_total_unread_and_pending_only_todo():
    # my-tasks reports total=5 across mixed statuses, but only 2 are pending;
    # messages come from unread_count.total (matches the dialog's 全部 badge).
    fake = FakeBishengClient(
        unread={"total": 12, "notify": 7, "approve": 5},
        my_tasks={
            "total": 5,
            "data": [
                _task("pending"),
                _task("approved"),
                _task("pending"),
                _task("rejected"),
                _task("skipped"),
            ],
        },
    )
    response = _call_summary(FakePortalAuthService(fake))

    assert response.status_code == 200
    data = response.json()["data"]
    assert data == {"messages": 12, "todo": 2, "total": 14}


def test_summary_degrades_when_one_upstream_fails():
    # Approval service down -> todo falls back to 0, messages still surface.
    fake = FakeBishengClient(
        unread={"total": 12, "notify": 7, "approve": 5},
        my_tasks={"data": [_task("pending")], "total": 1},
        fail_paths=["/api/v1/approval/my-tasks"],
    )
    response = _call_summary(FakePortalAuthService(fake))

    assert response.status_code == 200
    data = response.json()["data"]
    assert data == {"messages": 12, "todo": 0, "total": 12}


def test_summary_requires_login():
    fake = FakeBishengClient()
    response = _call_summary(NoSessionPortalAuthService(fake))
    assert response.status_code == 401
