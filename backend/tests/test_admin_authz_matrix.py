"""Every /api/admin/** route must be behind get_current_admin.

The admin surface is 60+ endpoints that delete posts and users, rewrite API keys
and burn provider quota; the auth dependency is the only thing in front of them.
Spot-checking a handful of endpoints means a newly added route that forgets the
dependency ships silently, so this walks the live route table instead.

Note: `app.main` is imported inside the tests on purpose. `app.rate_limit`
decides at import time whether limits are enabled (`PYTEST_CURRENT_TEST` is only
set while a test runs), so importing the app during collection would switch rate
limiting on for the whole session and break unrelated suites.
"""

import pytest

# The login endpoint mints the token, so it is unauthenticated by design.
PUBLIC_ADMIN_PATHS = {"/api/admin/login"}

# Path params are filled with values that must never be reached without a token:
# a 401/403 has to happen before any lookup.
PATH_PARAM_SAMPLES = {
    "filename": "sample.png",
    "post_id": "1",
    "job_id": "1",
    "source_id": "1",
    "instance_id": "1",
    "series_id": "1",
    "profile_id": "1",
    "comment_id": "1",
    "user_id": "1",
    "run_id": "1",
    "tag_id": "1",
    "channel_id": "1",
    "target_id": "1",
    "snapshot_id": "1",
    "review_id": "1",
}


def _walk_routes(router, seen):
    """Yield every APIRoute reachable from `router`, at any nesting depth.

    Two different FastAPI route layouts have to work here:

    * <= 0.136 flattened `include_router()` results straight into `app.routes`,
      so a single pass over `.routes` saw every endpoint.
    * >= 0.137 nests each included router under an `_IncludedRouter` wrapper.
      That wrapper exposes the real `APIRouter` as `.original_router` and has
      **no `.routes` attribute of its own**, so walking only `.routes` — even
      recursively — falls off the tree and finds *zero* admin routes.

    That second case is the trap: the per-route assertions below just iterate
    whatever this yields, so an empty walk turns the only guard proving 60+
    admin endpoints declare `get_current_admin` into a silent no-op. Following
    `original_router` as well as `routes` keeps the walk correct on both
    layouts, and `MIN_ADMIN_ROUTES` below fails loudly if a future layout
    change breaks it again.

    Paths on the nested routes are already absolute (the router prefix is
    baked in), so callers can filter on `/api/admin` either way.
    """
    from fastapi.routing import APIRoute

    if id(router) in seen:
        return
    seen.add(id(router))

    nested = getattr(router, "original_router", None)
    if nested is not None:
        yield from _walk_routes(nested, seen)

    for route in getattr(router, "routes", []):
        if isinstance(route, APIRoute):
            if id(route) not in seen:
                seen.add(id(route))
                yield route
        else:
            yield from _walk_routes(route, seen)


# Floor for the discovered admin surface. Every check below iterates the list
# returned by `_admin_routes()`, so a walk that finds nothing turns all of them
# into silent no-ops instead of failures — exactly what happened when FastAPI
# 0.137 changed the route layout. Asserting the floor inside the helper means a
# broken walk goes red in *every* consumer, not just the one that counts. Raise
# this if the admin surface grows a lot; never lower it to make a walk pass.
MIN_ADMIN_ROUTES = 60


def _admin_routes():
    from app.main import app

    routes = []
    for route in _walk_routes(app, set()):
        if not route.path.startswith("/api/admin"):
            continue
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            routes.append((method, route.path, route))
    assert len(routes) >= MIN_ADMIN_ROUTES, (
        f"route walk found only {len(routes)} /api/admin routes (expected "
        f">= {MIN_ADMIN_ROUTES}). The walk is broken, probably by a FastAPI "
        "router-layout change — fix _walk_routes rather than lowering the floor, "
        "otherwise every authz check in this file silently passes on nothing."
    )
    return routes


def _concrete_path(path: str) -> str:
    resolved = path
    for name, value in PATH_PARAM_SAMPLES.items():
        resolved = resolved.replace(f"{{{name}}}", value).replace(f"{{{name}:path}}", value)
    return resolved


def test_admin_route_table_is_discoverable():
    routes = _admin_routes()

    assert len(routes) >= MIN_ADMIN_ROUTES
    unresolved = [path for _method, path, _route in routes if "{" in _concrete_path(path)]
    assert unresolved == [], f"add a PATH_PARAM_SAMPLES entry for: {unresolved}"


def test_every_admin_endpoint_rejects_unauthenticated_requests(client):
    leaked = []
    for method, path, _route in _admin_routes():
        if path in PUBLIC_ADMIN_PATHS:
            continue
        response = client.request(method, _concrete_path(path), json={})
        if response.status_code not in (401, 403):
            leaked.append(f"{method} {path} -> {response.status_code}")

    assert leaked == [], f"admin endpoints reachable without a token: {leaked}"


def test_every_admin_endpoint_declares_the_admin_dependency(client):
    """Belt and braces: the dependency must be declared, not just happen to 401."""
    from app.auth import get_current_admin

    missing = []
    for method, path, route in _admin_routes():
        if path in PUBLIC_ADMIN_PATHS:
            continue
        dependency_calls = {dependency.call for dependency in route.dependant.dependencies}
        if get_current_admin not in dependency_calls:
            missing.append(f"{method} {path}")

    assert missing == [], f"admin endpoints without get_current_admin: {missing}"


def test_only_login_is_exempt(client):
    """If an endpoint is intentionally made public, this list has to change with it."""
    from app.auth import get_current_admin

    public = []
    for method, path, route in _admin_routes():
        dependency_calls = {dependency.call for dependency in route.dependant.dependencies}
        if get_current_admin not in dependency_calls:
            public.append(path)

    assert set(public) == PUBLIC_ADMIN_PATHS


def test_login_stays_reachable_without_a_token(client):
    response = client.post(
        "/api/admin/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert response.status_code == 200
    assert response.json()["access_token"]
