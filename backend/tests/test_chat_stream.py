import asyncio
import json

from app.services.chat_stream import ChatStreamObserver, safe_chat_stream


def test_error_only_stream_is_not_observed_as_success():
    observer = ChatStreamObserver()
    observer.feed(
        b'event: error\ndata: {"status_code":500,"status_message":"Server error"}\n\n'
    )

    assert observer.has_answer is False


def test_fragmented_answer_event_is_observed_once_complete():
    observer = ChatStreamObserver()
    observer.feed(b'event: message\ndata: {"category":"agent_answer","type":"stream","message":{"msg":"hel')
    assert observer.has_answer is False

    observer.feed(b'lo"}}\n\n')
    assert observer.has_answer is True


def test_upstream_exception_becomes_safe_error_event():
    async def broken_stream():
        if False:
            yield b""
        raise RuntimeError("provider token=secret failed")

    async def consume():
        observer = ChatStreamObserver()
        chunks = [chunk async for chunk in safe_chat_stream(broken_stream(), observer)]
        return observer, chunks

    observer, chunks = asyncio.run(consume())
    payload = b"".join(chunks).decode("utf-8")

    assert payload.startswith("event: error\n")
    data = json.loads(payload.split("data: ", 1)[1])
    assert data["status_message"] == "网络连接失败"
    assert data["kind"] == "network"
    assert data["title"] == "网络连接失败"
    assert data["reason"] == "连接问答服务超时或中断，请稍后重试。"
    assert data["retryable"] is True
    assert "token=secret" not in payload
    assert observer.has_answer is False


def test_upstream_exception_after_partial_answer_is_not_retryable():
    async def broken_stream():
        yield b'event: message\ndata: {"category":"agent_answer","type":"stream","message":{"msg":"partial"}}\n\n'
        raise RuntimeError("provider token=secret failed")

    async def consume():
        observer = ChatStreamObserver()
        chunks = [chunk async for chunk in safe_chat_stream(broken_stream(), observer)]
        return observer, chunks

    observer, chunks = asyncio.run(consume())
    error_payload = json.loads(chunks[-1].decode("utf-8").split("data: ", 1)[1])

    assert observer.has_answer is True
    assert error_payload["retryable"] is False
    assert "token=secret" not in chunks[-1].decode("utf-8")
