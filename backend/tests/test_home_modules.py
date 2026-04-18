def test_home_modules_returns_renderable_sections(client, seeded_db):
    response = client.get("/api/home/modules")
    assert response.status_code == 200

    payload = response.json()
    assert {"hero", "latest_weekly", "latest_daily", "featured_series", "topic_pulse", "continue_reading", "subscription_cta"} <= payload.keys()
    assert payload["hero"]["preset"] == "site_hero"
    assert "art_direction_version" in payload["hero"]
    assert isinstance(payload["latest_weekly"], list)
    assert isinstance(payload["latest_daily"], list)
    assert isinstance(payload["featured_series"], list)
    assert isinstance(payload["topic_pulse"]["items"], list)
    assert payload["continue_reading"]["local_only"] is True
    assert payload["subscription_cta"]["primary_to"] == "/feeds"
