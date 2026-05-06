import os

from slowapi import Limiter
from slowapi.util import get_remote_address

# Disable rate limiting in test environment
is_test = os.environ.get("APP_ENV") == "test" or os.environ.get("PYTEST_CURRENT_TEST")

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["60/minute"] if not is_test else [],
    enabled=not is_test,
)
