"""Exercise cache eligibility on actual HTTP requests and real list routes."""

import pytest
from fastapi import FastAPI, Request, Response
from fastapi.testclient import TestClient

from app.models import Post
from app.public_edge_cache import public_collection_edge_cache


@pytest.fixture
def cache_client():
    app = FastAPI()
    app.middleware("http")(public_collection_edge_cache)

    @app.api_route("/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"])
    async def reply(path: str, request: Request):
        status = int(request.query_params.get("status", "200"))
        headers = {"Cache-Control": request.query_params.get("policy", "public, max-age=60, s-maxage=300")}
        if request.query_params.get("sets_cookie"):
            headers["Set-Cookie"] = "session=private; HttpOnly"
        return Response(
            content='{"items":[]}' if status != 304 else b"",
            status_code=status,
            media_type=request.query_params.get("type", "application/json"),
            headers=headers,
        )

    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize("path", ["/api/discover?content_type=daily_brief", "/api/topics?limit=24", "/api/series"])
def test_anonymous_json_lists_cache_only_on_vercel(cache_client, path):
    response = cache_client.get(path)
    assert response.status_code == 200
    assert response.json() == {"items": []}
    assert response.headers["vercel-cdn-cache-control"] == "public, max-age=60, stale-while-revalidate=120"
    assert response.headers["cache-control"] == "public, max-age=0, must-revalidate"
    assert response.headers["cdn-cache-control"] == "no-store"
    assert response.headers["vercel-cache-tag"] == "public-collections-trial"


@pytest.mark.parametrize("status", [201, 301, 400, 401, 403, 404, 410, 422, 429, 500, 503])
def test_errors_and_redirects_do_not_become_cached_json(cache_client, status):
    response = cache_client.get(f"/api/topics?status={status}", follow_redirects=False)
    assert response.status_code == status
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["vercel-cdn-cache-control"] == "no-store"
    assert "vercel-cache-tag" not in response.headers


@pytest.mark.parametrize("headers", [
    {"Authorization": "Bearer private"}, {"Cookie": "session=private"},
    {"Range": "bytes=0-99"}, {"Authorization": ""}, {"Cookie": ""},
])
def test_credentials_and_partial_requests_bypass(cache_client, headers):
    response = cache_client.get("/api/series", headers=headers)
    assert response.headers["vercel-cdn-cache-control"] == "no-store"
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.parametrize("method", ["HEAD", "POST", "PUT", "DELETE", "OPTIONS"])
def test_only_get_is_eligible_even_if_a_route_later_accepts_mutations(cache_client, method):
    response = cache_client.request(method, "/api/discover")
    assert response.headers["vercel-cdn-cache-control"] == "no-store"


@pytest.mark.parametrize("query", [
    {"sets_cookie": "1"}, {"policy": "private, max-age=10"},
    {"policy": "public, no-store"}, {"policy": "public, no-cache"},
    {"policy": "max-age=60"}, {"type": "text/html"},
])
def test_response_cookie_private_policy_and_non_json_are_respected(cache_client, query):
    response = cache_client.get("/api/topics", params=query)
    assert response.headers["vercel-cdn-cache-control"] == "no-store"
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.parametrize("path", [
    "/api/topics/private", "/api/topics/", "/api/topicsevil", "/api/series/private",
    "/api/admin/posts", "/api/users/me", "/api/posts/secret", "/uploads/cover.png",
])
def test_policy_leaves_unrelated_routes_and_assets_untouched(cache_client, path):
    response = cache_client.get(path)
    assert response.headers["cache-control"] == "public, max-age=60, s-maxage=300"
    assert "vercel-cdn-cache-control" not in response.headers
    assert "cdn-cache-control" not in response.headers


@pytest.mark.parametrize("flag", ["0", "false", "off", "no"])
def test_backend_flag_disables_trial_without_deleting_content(cache_client, monkeypatch, flag):
    monkeypatch.setenv("PUBLIC_EDGE_CACHE_TRIAL", flag)
    response = cache_client.get("/api/topics")
    assert response.json() == {"items": []}
    assert response.headers["vercel-cdn-cache-control"] == "no-store"


def test_real_lists_keep_etag_and_query_isolation(client, seeded_db):
    seeded_db.add_all([
        Post(title="日报缓存隔离", slug="daily-cache-guard", summary="daily", content_md="daily", content_type="daily_brief"),
        Post(title="周报缓存隔离", slug="weekly-cache-guard", summary="weekly", content_md="weekly", content_type="weekly_review"),
    ])
    seeded_db.commit()
    daily_url = "/api/discover?content_type=daily_brief&sections=items,total"
    weekly_url = "/api/discover?content_type=weekly_review&sections=items,total"
    daily = client.get(daily_url)
    weekly = client.get(weekly_url)
    assert daily.status_code == weekly.status_code == 200
    assert daily.headers["etag"] != weekly.headers["etag"]
    for response in [daily, weekly, client.get("/api/topics?limit=24"), client.get("/api/series")]:
        assert response.headers["vercel-cdn-cache-control"] == "public, max-age=60, stale-while-revalidate=120"
    conditional = client.get(daily_url, headers={"If-None-Match": daily.headers["etag"]})
    assert conditional.status_code == 304
    assert conditional.content == b""
    assert conditional.headers["vercel-cdn-cache-control"] == daily.headers["vercel-cdn-cache-control"]


def test_real_list_validation_error_is_no_store(client):
    response = client.get("/api/topics?limit=invalid")
    assert response.status_code == 422
    assert response.headers["vercel-cdn-cache-control"] == "no-store"
