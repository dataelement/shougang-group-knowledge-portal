import json
import logging
from collections.abc import AsyncIterator
from typing import Any

logger = logging.getLogger(__name__)

_SAFE_STREAM_ERROR_MESSAGE = "连接问答服务超时或中断，请稍后重试。"


class ChatStreamObserver:
    def __init__(self) -> None:
        self._buffer = b""
        self.has_answer = False
        self.has_error = False

    def feed(self, chunk: bytes) -> None:
        self._buffer += chunk
        self._buffer = self._buffer.replace(b"\r\n", b"\n")
        events = self._buffer.split(b"\n\n")
        self._buffer = events.pop() or b""
        for event in events:
            self._consume_event(event)

    def finish(self) -> None:
        if self._buffer.strip():
            self._consume_event(self._buffer)
        self._buffer = b""

    def mark_error(self) -> None:
        self.has_error = True

    def _consume_event(self, event: bytes) -> None:
        event_name = ""
        data_lines: list[bytes] = []
        for line in event.splitlines():
            if line.startswith(b"event:"):
                event_name = line[len(b"event:") :].strip().decode("utf-8", errors="ignore")
            elif line.startswith(b"data:"):
                data_lines.append(line[len(b"data:") :].lstrip(b" "))
        if not data_lines:
            return
        try:
            payload = json.loads(b"\n".join(data_lines))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return
        if not isinstance(payload, dict):
            return
        status_code = payload.get("status_code")
        if event_name == "error" or (status_code is not None and status_code != 200):
            self.has_error = True
            return
        if self._contains_answer(payload):
            self.has_answer = True

    @staticmethod
    def _contains_answer(payload: dict[str, Any]) -> bool:
        category = payload.get("category")
        if category not in {"agent_answer", "stream"}:
            if not payload.get("final"):
                return False
            response_message = payload.get("responseMessage")
            return isinstance(response_message, dict) and bool(str(response_message.get("text") or "").strip())
        message = payload.get("message")
        if isinstance(message, str):
            return bool(message.strip())
        if not isinstance(message, dict):
            return False
        return any(bool(str(message.get(key) or "").strip()) for key in ("content", "msg", "text"))


def build_safe_stream_error_event(
    message: str = _SAFE_STREAM_ERROR_MESSAGE,
    *,
    had_output: bool = False,
) -> bytes:
    payload = {
        "status_code": 502,
        "status_message": "网络连接失败",
        "data": {},
        "kind": "network",
        "title": "网络连接失败",
        "reason": message,
        "retryable": not had_output,
    }
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"event: error\ndata: {body}\n\n".encode("utf-8")


async def safe_chat_stream(
    upstream: AsyncIterator[bytes],
    observer: ChatStreamObserver,
) -> AsyncIterator[bytes]:
    try:
        async for chunk in upstream:
            observer.feed(chunk)
            yield chunk
        observer.finish()
    except Exception:
        logger.exception("upstream chat stream failed")
        observer.mark_error()
        yield build_safe_stream_error_event(had_output=observer.has_answer)
