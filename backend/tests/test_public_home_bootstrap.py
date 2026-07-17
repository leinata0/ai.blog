def test_public_home_bootstrap_returns_cached_payload(client, seeded_db):
    response = client.get("/api/public/home-bootstrap")
    assert response.status_code == 200

    payload = response.json()
    assert {"settings", "home_modules", "posts"} <= payload.keys()
    assert payload["posts"]["page"] == 1
    assert payload["posts"]["page_size"] == 10
    assert "etag" in response.headers
    assert "s-maxage" in response.headers["cache-control"]


def test_public_home_bootstrap_includes_full_modules_by_default(client, seeded_db, monkeypatch):
    import app.main as main_mod

    original_builder = main_mod.build_home_modules_payload
    calls = []

    def tracked_builder(db):
        calls.append(db)
        return original_builder(db)

    monkeypatch.setattr(main_mod, "build_home_modules_payload", tracked_builder)

    response = client.get("/api/public/home-bootstrap")

    assert response.status_code == 200
    assert len(calls) == 1
    assert response.json()["home_modules"]["topic_pulse"]["description"]


def test_public_home_bootstrap_can_skip_aggregated_modules(client, seeded_db, monkeypatch):
    import app.main as main_mod

    def fail_if_called(_db):
        raise AssertionError("full home module aggregation must not run")

    monkeypatch.setattr(main_mod, "build_home_modules_payload", fail_if_called)

    response = client.get("/api/public/home-bootstrap?include_modules=false")

    assert response.status_code == 200
    payload = response.json()
    assert {"settings", "home_modules", "posts"} <= payload.keys()
    modules = payload["home_modules"]
    assert modules["hero"]["image"] == (
        payload["settings"]["hero_image"] or payload["settings"]["avatar_url"] or ""
    )
    assert modules["latest_weekly"] == []
    assert modules["latest_daily"] == []
    assert modules["featured_series"] == []
    assert modules["topic_pulse"]["items"] == []
    assert modules["continue_reading"]["items"] == []
    assert modules["subscription_cta"]["email_enabled"] is False
    assert modules["subscription_cta"]["web_push_enabled"] is False


def test_public_home_bootstrap_supports_etag_revalidation(client, seeded_db):
    first_response = client.get("/api/public/home-bootstrap")
    assert first_response.status_code == 200

    second_response = client.get(
        "/api/public/home-bootstrap",
        headers={"If-None-Match": first_response.headers["etag"]},
    )
    assert second_response.status_code == 304


def test_lightweight_public_home_bootstrap_supports_etag_revalidation(client, seeded_db):
    url = "/api/public/home-bootstrap?include_modules=false"
    first_response = client.get(url)
    assert first_response.status_code == 200

    second_response = client.get(
        url,
        headers={"If-None-Match": first_response.headers["etag"]},
    )
    assert second_response.status_code == 304


def test_public_home_bootstrap_etags_are_isolated_by_module_variant(client, seeded_db):
    from app.schemas import HomeBootstrapOut

    full_response = client.get("/api/public/home-bootstrap")
    lightweight_response = client.get("/api/public/home-bootstrap?include_modules=false")

    assert full_response.status_code == 200
    assert lightweight_response.status_code == 200
    assert full_response.headers["etag"] != lightweight_response.headers["etag"]
    HomeBootstrapOut.model_validate(full_response.json())
    HomeBootstrapOut.model_validate(lightweight_response.json())

    lightweight_with_full_etag = client.get(
        "/api/public/home-bootstrap?include_modules=false",
        headers={"If-None-Match": full_response.headers["etag"]},
    )
    full_with_lightweight_etag = client.get(
        "/api/public/home-bootstrap",
        headers={"If-None-Match": lightweight_response.headers["etag"]},
    )

    assert lightweight_with_full_etag.status_code == 200
    assert full_with_lightweight_etag.status_code == 200


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
