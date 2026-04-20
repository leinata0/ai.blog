import logging
from time import perf_counter

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base

from app.env import clean_env, get_database_url

DATABASE_URL = get_database_url()
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
db_logger = logging.getLogger("blog.db")
DB_TIMING_LOG_MIN_MS = float(clean_env("DB_TIMING_LOG_MIN_MS", "30") or "30")


@event.listens_for(engine, "before_cursor_execute")
def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    conn.info.setdefault("query_start_time", []).append(perf_counter())


@event.listens_for(engine, "after_cursor_execute")
def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    start_times = conn.info.get("query_start_time") or []
    if not start_times:
        return

    elapsed_ms = (perf_counter() - start_times.pop()) * 1000
    if elapsed_ms < DB_TIMING_LOG_MIN_MS:
        return

    compact_statement = " ".join(str(statement or "").split())
    if len(compact_statement) > 240:
        compact_statement = f"{compact_statement[:237]}..."

    db_logger.info("query_timing duration_ms=%.1f sql=%s", elapsed_ms, compact_statement)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
