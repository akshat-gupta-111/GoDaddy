"""Report logic shared by the HTTP API and the chatbot. Each call needs an open connection."""

import uuid
from collections import Counter
from datetime import datetime

import image_storage
import matching

ITEM_FIELDS = ("item", "colour", "brand", "description")
REQUIRED = ("report_type", "item", "colour", "brand", "place", "description")
LIMITS = {"item": 80, "colour": 40, "brand": 60, "place": 100, "description": 1000, "text": 300}
TIME_FORMAT = "%Y-%m-%dT%H:%M"
MIN_SCORE = 30
CONTACT_SCORE = 50

_SELECT = """SELECT r.report_id, r.user_id, r.report_type, r.place, r.from_time, r.to_time,
                    r.status, i.item_id, i.item, i.colour, i.brand, i.description, i.image_id
             FROM reports r JOIN items i ON i.item_id = r.item_id"""


class ApiError(Exception):
    def __init__(self, message, status=400, fields=None):
        super().__init__(message)
        self.status = status
        self.fields = fields


def is_valid_text(value):
    """False for strings SQLite cannot store (unpaired surrogates)."""
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def clean_report(data):
    """Validate any subset of report fields. Return (values, errors)."""
    values, errors = {}, {}
    for field in (*REQUIRED, "from_time", "to_time"):
        raw = data.get(field)
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            continue
        if not isinstance(raw, str) or not is_valid_text(raw):
            errors[field] = "Must be text."
            continue
        value = raw.strip()
        if field == "report_type":
            value = value.lower()
            if value not in ("lost", "found"):
                errors[field] = "Must be 'lost' or 'found'."
                continue
        elif field in ("from_time", "to_time"):
            try:
                value = datetime.strptime(value, TIME_FORMAT).strftime(TIME_FORMAT)
            except ValueError:
                errors[field] = "Use the format YYYY-MM-DDTHH:MM."
                continue
        elif len(value) > LIMITS[field]:
            errors[field] = f"Must be {LIMITS[field]} characters or fewer."
            continue
        values[field] = value
    if values.get("from_time", "") > values.get("to_time", "9999"):
        errors["to_time"] = "Must not be earlier than from_time."
    return values, errors


def draft(data):
    """For one-question-at-a-time chat: say what is still missing. Saves nothing."""
    values, errors = clean_report(data)
    wanted = list(REQUIRED) + ["from_time"]
    if values.get("report_type") == "lost":
        wanted.append("to_time")
    missing = [f for f in wanted if f not in values]
    pending = [f for f in wanted if f in errors or f in missing]
    return {
        "draft": values,
        "missing": missing,
        "errors": errors,
        "next_field": pending[0] if pending else None,
        "ready": not pending and not errors,
    }


def public_report(row, user_id):
    """The shape sent to clients. Never includes the reporter's identity."""
    keys = ("report_id", "report_type", "item", "colour", "brand", "place",
            "from_time", "to_time", "description", "status")
    report = {k: row[k] for k in keys}
    try:
        report["image_url"] = image_storage.image_url(row["image_id"])
    except image_storage.StorageError:
        report["image_url"] = None
    report["is_mine"] = row["user_id"] == user_id
    return report


def require_profile(conn, user_id):
    row = conn.execute(
        "SELECT user_name, roll_no, year, phone FROM users WHERE user_id = ?", (user_id,)
    ).fetchone()
    if row is None or any(row[k] is None for k in row.keys()):
        raise ApiError("Complete your profile before reporting an item.", 403)


def create_report(conn, user_id, data):
    require_profile(conn, user_id)
    values, errors = clean_report(data)
    for field in REQUIRED:
        if field not in values:
            errors.setdefault(field, "This field is required.")
    if errors:
        raise ApiError("Check the highlighted fields.", 400, errors)
    item_id, report_id = uuid.uuid4().hex, uuid.uuid4().hex
    with conn:  # both rows are saved, or neither
        conn.execute(
            "INSERT INTO items (item_id, item, colour, brand, description) VALUES (?, ?, ?, ?, ?)",
            (item_id, *(values[f] for f in ITEM_FIELDS)),
        )
        conn.execute(
            """INSERT INTO reports (report_id, user_id, item_id, report_type, place, from_time, to_time)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (report_id, user_id, item_id, values["report_type"], values["place"],
             values.get("from_time"), values.get("to_time")),
        )
    return public_report(get_row(conn, report_id), user_id)


def get_row(conn, report_id):
    if not isinstance(report_id, str) or not is_valid_text(report_id):
        raise ApiError("Report not found.", 404)
    row = conn.execute(_SELECT + " WHERE r.report_id = ?", (report_id,)).fetchone()
    if row is None:
        raise ApiError("Report not found.", 404)
    return row


def own_row(conn, user_id, report_id):
    row = get_row(conn, report_id)
    if row["user_id"] != user_id:
        raise ApiError("Only the person who made this report can do that.", 403)
    return row


def my_reports(conn, user_id):
    rows = conn.execute(_SELECT + " WHERE r.user_id = ? ORDER BY r.rowid DESC", (user_id,))
    return [public_report(r, user_id) for r in rows.fetchall()]


def reunite(conn, user_id, report_id):
    own_row(conn, user_id, report_id)
    with conn:
        conn.execute("UPDATE reports SET status = 'reunited' WHERE report_id = ?", (report_id,))
    return public_report(get_row(conn, report_id), user_id)


def _open_rows(conn, report_type):
    return conn.execute(
        _SELECT + " WHERE r.report_type = ? AND r.status = 'open' ORDER BY r.rowid DESC", (report_type,)
    ).fetchall()


def _limit(value, default=10):
    try:
        return max(1, min(int(value), 50))
    except (TypeError, ValueError, OverflowError):
        return default


def matches(conn, user_id, report_id, limit=10):
    """Open reports of the opposite type, best first. Contact only for strong matches."""
    mine = dict(own_row(conn, user_id, report_id))
    if mine["status"] != "open":
        return []
    other = "found" if mine["report_type"] == "lost" else "lost"
    scored = []
    for row in _open_rows(conn, other):
        theirs = dict(row)
        lost, found = (mine, theirs) if other == "found" else (theirs, mine)
        if matching.time_conflict(lost, found):
            continue
        value = matching.score(mine, theirs)
        if value >= MIN_SCORE:
            scored.append((value, row))
    scored.sort(key=lambda pair: pair[0], reverse=True)

    results = []
    for value, row in scored[: _limit(limit)]:
        contact = None
        if value >= CONTACT_SCORE and matching.same_item(mine["item"], row["item"]):
            person = conn.execute(
                "SELECT user_name, phone FROM users WHERE user_id = ?", (row["user_id"],)
            ).fetchone()
            contact = dict(person)
        results.append({**public_report(row, user_id), "score": value, "contact": contact})
    return results


def search(conn, user_id, filters):
    """Drill down through open reports. Every filter is optional and affects ranking."""
    report_type = filters.get("report_type") or "found"
    if report_type not in ("lost", "found"):
        raise ApiError("report_type must be 'lost' or 'found'.")
    query = {}
    for field, limit in LIMITS.items():
        value = filters.get(field)
        if value is None:
            continue
        if not isinstance(value, str) or len(value) > limit or not is_valid_text(value):
            raise ApiError(f"{field} must be text of {limit} characters or fewer.")
        if value.strip():
            query[field] = value.strip()

    found = []
    for row in _open_rows(conn, report_type):
        value = matching.score(query, dict(row)) if query else None
        if value is None or value >= MIN_SCORE:
            found.append((value, row))
    if query:
        found.sort(key=lambda pair: pair[0], reverse=True)

    facets = {}
    for field in ("item", "colour", "brand", "place"):
        counts = Counter(row[field].casefold() for _, row in found)
        facets[field] = [{"value": v, "count": c} for v, c in counts.most_common(8)]
    results = [{**public_report(row, user_id), "score": value}
               for value, row in found[: _limit(filters.get("limit"), 5)]]
    return {"total": len(found), "results": results, "facets": facets}
