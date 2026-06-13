from datetime import datetime, timezone


def now_iso() -> str:
    """Return the current UTC time as an ISO 8601 string with a `Z` suffix.

    Matches the format produced by JavaScript's `Date.prototype.toISOString()`
    (e.g. `2024-01-01T00:00:00.000Z`), so timestamps are byte-for-byte
    compatible with the `@pulse/agent` npm package.
    """
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
