def test_public_home_bootstrap_returns_cached_payload(client, seeded_db):
    response = client.get("/api/public/home-bootstrap")
    assert response.status_code == 200

    payload = response.json()
    assert {"settings", "home_modules", "posts"} <= payload.keys()
    assert payload["posts"]["page"] == 1
    assert payload["posts"]["page_size"] == 10
    assert "etag" in response.headers
    assert "s-maxage" in response.headers["cache-control"]


def test_public_home_bootstrap_supports_etag_revalidation(client, seeded_db):
    first_response = client.get("/api/public/home-bootstrap")
    assert first_response.status_code == 200

    second_response = client.get(
        "/api/public/home-bootstrap",
        headers={"If-None-Match": first_response.headers["etag"]},
    )
    assert second_response.status_code == 304


def test_public_posts_list_sets_cache_headers(client, seeded_db):
    response = client.get("/api/posts")
    assert response.status_code == 200
    assert "etag" in response.headers
    assert "s-maxage" in response.headers["cache-control"]


def test_public_search_sets_cache_headers(client, seeded_db):
    response = client.get("/api/search?q=python")
    assert response.status_code == 200
    assert "etag" in response.headers
    assert "s-maxage" in response.headers["cache-control"]


def test_public_topics_set_cache_headers(client, seeded_db):
    response = client.get("/api/topics")
    assert response.status_code == 200
    assert "etag" in response.headers
    assert "s-maxage" in response.headers["cache-control"]


def test_public_feeds_set_cache_headers(client, seeded_db):
    response = client.get("/api/feeds/all.xml")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/xml")
    assert "etag" in response.headers
    assert "s-maxage" in response.headers["cache-control"]
