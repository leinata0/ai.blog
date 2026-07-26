"""在读 body 之前就把过大的请求挡掉。

处理器里的 ``file.file.read(MAX_UPLOAD_SIZE + 1)`` 只挡住了**内存**：Starlette 在进入
handler 之前就已经把整个 multipart 落到临时文件了，磁盘那一下早就发生过。uvicorn 自己
没有请求体上限，所以一个 5GB 的 body 能把容器磁盘写满，handler 读不读它都一样。JSON 路径
更直接 —— ``request.json()`` 会把整个 body 读进内存，而公开端点（订阅、评论）是不需要
认证的。

写成纯 ASGI 中间件而不是 ``@app.middleware("http")``：这样能在 body 被消费之前介入，
并且能包住 receive 通道，chunked 请求（没有 Content-Length，光看请求头拦不住）也算得出
实际收了多少字节。
"""

from __future__ import annotations

import json
import logging

from starlette.datastructures import Headers

logger = logging.getLogger("blog.request_limits")

# 上传路由：图片上限 + multipart 框架开销（边界串、每个 part 的头）。
UPLOAD_BODY_LIMIT_SLACK_BYTES = 1024 * 1024
# 其余路由只收 JSON。最大的一份合法 body 是周报（约 9000 字正文加来源列表），
# UTF-8 下也就几百 KB，4MB 留了一个量级的余量。
DEFAULT_MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024


def _payload(limit: int) -> bytes:
    return json.dumps(
        {"detail": f"Request body is too large (limit {limit} bytes)", "code": "http_413"}
    ).encode()


def _start_message(limit: int) -> dict:
    return {
        "type": "http.response.start",
        "status": 413,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(_payload(limit))).encode()),
        ],
    }


class RequestBodySizeLimitMiddleware:
    """超过上限的请求一律 413，且不让 body 落到内存或磁盘。

    ``upload_limits`` 是 ``{路径: 上限}``，用于那几个确实要收文件的路由；其余路径统一走
    ``default_limit``。
    """

    def __init__(self, app, *, default_limit: int, upload_limits: dict[str, int] | None = None):
        self.app = app
        self.default_limit = default_limit
        self.upload_limits = dict(upload_limits or {})

    def limit_for(self, path: str) -> int:
        return self.upload_limits.get(path, self.default_limit)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self.limit_for(scope.get("path", ""))
        declared = Headers(scope=scope).get("content-length")
        if declared is not None:
            try:
                declared_length = int(declared)
            except ValueError:
                declared_length = -1  # 畸形头：交给下面的流式计数
            if declared_length > limit:
                # 声明就超了：连 app 都不用叫醒。
                logger.warning(
                    "request_body_too_large path=%s limit=%s declared=%s",
                    scope.get("path", ""),
                    limit,
                    declared,
                )
                await self._respond_413(send, limit)
                return

        # 没有 Content-Length（chunked）或者头是假的，就一边收一边数。
        state = {"received": 0, "too_large": False, "started": False}

        async def counting_receive():
            message = await receive()
            if message["type"] == "http.request":
                state["received"] += len(message.get("body", b""))
                if state["received"] > limit:
                    state["too_large"] = True
                    # 不再往下游喂 body。装成客户端断开，multipart 解析器会就地收摊，
                    # 而不是继续把剩下的几个 G 写进临时文件。
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message):
            if message["type"] == "http.response.start":
                state["started"] = True
                await send(message if not state["too_large"] else _start_message(limit))
                return
            if message["type"] == "http.response.body" and state["too_large"]:
                # body 被我们截断之后，下游给出的答复不是真话，统一改写成 413。
                if message.get("more_body"):
                    return
                await send({"type": "http.response.body", "body": _payload(limit), "more_body": False})
                return
            await send(message)

        try:
            await self.app(scope, counting_receive, guarded_send)
        except Exception:
            # 断流是我们自己造成的，下游因此抛出的异常不是服务端故障。其他异常照常上抛
            # （main.py 注册的 500 处理器仍然负责它们）。
            if not state["too_large"]:
                raise

        if state["too_large"]:
            logger.warning(
                "request_body_too_large path=%s limit=%s received=%s",
                scope.get("path", ""),
                limit,
                state["received"],
            )
            if not state["started"]:
                await self._respond_413(send, limit)

    async def _respond_413(self, send, limit: int) -> None:
        await send(_start_message(limit))
        await send({"type": "http.response.body", "body": _payload(limit), "more_body": False})
