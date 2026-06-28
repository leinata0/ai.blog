"""Tests for cloud sync of followed topics and reading history."""


def _register(client, email="syncer@example.com", password="secret123"):
    resp = client.post("/api/users/register", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_follow_and_unfollow_topic(client):
    h = _headers(_register(client))
    assert client.get("/api/users/me/topics", headers=h).json() == []

    r = client.post("/api/users/me/topics", json={"topic_key": "llm", "display_title": "大模型"}, headers=h)
    assert r.status_code == 200
    topics = r.json()
    assert len(topics) == 1 and topics[0]["topic_key"] == "llm"

    r2 = client.delete("/api/users/me/topics/llm", headers=h)
    assert r2.status_code == 200
    assert r2.json() == []


def test_merge_topics_idempotent(client):
    h = _headers(_register(client))
    payload = {"topics": [
        {"topic_key": "llm", "display_title": "大模型"},
        {"topic_key": "agents", "display_title": "智能体"},
        {"topic_key": "llm", "display_title": "dup"},  # duplicate in same batch
    ]}
    r1 = client.post("/api/users/me/topics/merge", json=payload, headers=h)
    assert len({t["topic_key"] for t in r1.json()}) == 2
    # merging again does not create duplicates
    r2 = client.post("/api/users/me/topics/merge", json=payload, headers=h)
    assert len(r2.json()) == 2


def test_history_upsert_moves_to_top(client):
    h = _headers(_register(client))
    client.post("/api/users/me/history", json={"slug": "post-a", "title": "A"}, headers=h)
    client.post("/api/users/me/history", json={"slug": "post-b", "title": "B"}, headers=h)
    # re-visit post-a => should move to top (most recent)
    r = client.post("/api/users/me/history", json={"slug": "post-a", "title": "A"}, headers=h)
    history = r.json()
    assert history[0]["slug"] == "post-a"
    assert len([x for x in history if x["slug"] == "post-a"]) == 1


def test_history_capped_at_100(client):
    h = _headers(_register(client))
    items = [{"slug": f"post-{i}", "title": f"T{i}"} for i in range(110)]
    r = client.post("/api/users/me/history/merge", json={"items": items}, headers=h)
    assert len(r.json()) == 100


def test_sync_data_isolated_between_users(client):
    h1 = _headers(_register(client, email="u1@example.com"))
    h2 = _headers(_register(client, email="u2@example.com"))
    client.post("/api/users/me/topics", json={"topic_key": "llm"}, headers=h1)
    assert len(client.get("/api/users/me/topics", headers=h1).json()) == 1
    assert client.get("/api/users/me/topics", headers=h2).json() == []


def test_sync_requires_auth(client):
    assert client.get("/api/users/me/topics").status_code in (401, 403)
    assert client.get("/api/users/me/history").status_code in (401, 403)
