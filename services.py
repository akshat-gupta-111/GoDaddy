"""Report logic shared by the HTTP API and the chatbot. Each call needs an open connection."""

import json
import re
import uuid
from collections import Counter
from datetime import datetime

import image_storage
import matching
import vision

ITEM_FIELDS = ("item", "colour", "brand", "description")
REQUIRED = ("report_type", "item", "colour", "brand", "place", "description")
LIMITS = {"item": 80, "colour": 40, "brand": 60, "place": 100, "description": 1000, "text": 300}
TIME_FORMAT = "%Y-%m-%dT%H:%M"
MIN_SCORE = 30
# Share of the score decided by the photos when both reports have one.
PHOTO_WEIGHT = 0.6
# When the user's report has a photo, candidates without one are ranked lower, so that a
# match confirmed by details and picture comes first. Their shown score is unchanged.
NO_PHOTO_FACTOR = 0.7
# If the item names do not match at all, the photos must be this alike.
PHOTO_ONLY_SCORE = 80
# Items are handed in at the Lost and Found department, so only its (mock) numbers
# are ever shown. Reporters are never put in touch with each other.
DEPARTMENT_CONTACTS = (
    {"label": "Lost and Found Desk 1", "phone": "00000 00001"},
    {"label": "Lost and Found Desk 2", "phone": "00000 00002"},
)
CONTACT_PATTERN = re.compile(
    r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"
    # 10 to 15 digits with spaces, dots, brackets or hyphens, but not a date such as 2026-11-24 17:00
    r"|(?<![\d-])(?!\d{4}-\d{2}-\d{2})\+?\(?\d(?:[ .()-]*\d){9,14}(?!\d)"
)

_SELECT = """SELECT r.report_id, r.user_id, r.report_type, r.place, r.from_time, r.to_time,
                    r.status, i.item_id, i.item, i.colour, i.brand, i.description, i.image_id
             FROM reports r JOIN items i ON i.item_id = r.item_id"""


class ApiError(Exception):
    def __init__(self, message, status=400, fields=None):
        super().__init__(message)
        self.status = status
        self.fields = fields


def redact(text):
    """Hide emails and phone numbers typed by users."""
    return CONTACT_PATTERN.sub("[contact removed]", text)


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
        values[field] = value if field.endswith("_time") else redact(value)
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


def department_contacts(found_something):
    """The numbers to pop up when a searched item was found, otherwise an empty list."""
    return [dict(c) for c in DEPARTMENT_CONTACTS] if found_something else []


def public_report(row, user_id):
    """The shape sent to clients. Never includes the reporter's identity."""
    keys = ("report_id", "report_type", "item", "colour", "brand", "place",
            "from_time", "to_time", "description", "status")
    report = {k: row[k] for k in keys}
    for key in ("item", "colour", "brand", "place", "description"):
        report[key] = redact(report[key])
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


def create_report(conn, user_id, data, report_id=None):
    """Save a report. Calling again with the same report_id returns the saved one."""
    require_profile(conn, user_id)
    values, errors = clean_report(data)
    for field in REQUIRED:
        if field not in values:
            errors.setdefault(field, "This field is required.")
    if errors:
        raise ApiError("Check the highlighted fields.", 400, errors)
    item_id, report_id = uuid.uuid4().hex, report_id or uuid.uuid4().hex
    with conn:  # both rows are saved, or neither
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute(
            "SELECT 1 FROM reports WHERE report_id = ? AND user_id = ?", (report_id, user_id)
        ).fetchone():
            return public_report(get_row(conn, report_id), user_id)
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


def insights(conn):
    """Top 3 most-lost items and top 3 hotspots, over all lost reports."""
    rows = conn.execute(_SELECT + " WHERE r.report_type = 'lost'").fetchall()
    items, places, labels, names = Counter(), Counter(), {}, {}
    for row in map(dict, rows):
        row.update(item=redact(row["item"]), place=redact(row["place"]))
        # Group synonyms ("flask", "water bottle") but show a name someone typed.
        item = " ".join(sorted(matching.tokens(row["item"]))) or row["item"].casefold()
        labels.setdefault(item, row["item"])
        items[item] += 1
        place = row["place"].casefold()
        names.setdefault(place, row["place"])
        places[place] += 1
    totals = conn.execute(
        """SELECT COALESCE(SUM(report_type = 'found'), 0),
                  COALESCE(SUM(status = 'reunited'), 0),
                  COALESCE(SUM(status = 'open'), 0) FROM reports"""
    ).fetchone()
    return {
        "total_found": totals[0],
        "total_reunited": totals[1],
        "total_open": totals[2],
        "total_lost": len(rows),
        "top_items": [{"item": labels[v], "count": c} for v, c in items.most_common(3)],
        "hotspots": [{"place": names[v], "count": c} for v, c in places.most_common(3)],
    }


def _open_rows(conn, report_type):
    return conn.execute(
        _SELECT + " WHERE r.report_type = ? AND r.status = 'open' ORDER BY r.rowid DESC", (report_type,)
    ).fetchall()


def _limit(value, default=10):
    try:
        return max(1, min(int(value), 50))
    except (TypeError, ValueError, OverflowError):
        return default


def save_features(conn, report_id, features):
    """Store (or with None, remove) photo features. The caller manages the transaction."""
    if features is None:
        conn.execute("DELETE FROM image_features WHERE report_id = ?", (report_id,))
    else:
        conn.execute(
            "INSERT OR REPLACE INTO image_features (report_id, model, features) VALUES (?, ?, ?)",
            (report_id, vision.MODEL_NAME, json.dumps(features)),
        )


def _all_features(conn):
    rows = conn.execute(
        "SELECT report_id, features FROM image_features WHERE model = ?", (vision.MODEL_NAME,)
    )
    return {row["report_id"]: json.loads(row["features"]) for row in rows}


def _prefer_colour(colour, entries, row_of):
    """Keep only entries in the wanted colour, if there are any; otherwise keep them all."""
    wanted = matching.tokens(colour)
    same = [e for e in entries if wanted & matching.tokens(row_of(e)["colour"])]
    return same or entries


def matches(conn, user_id, report_id, limit=10):
    """Open reports of the opposite type, best first."""
    mine = dict(own_row(conn, user_id, report_id))
    if mine["status"] != "open":
        return []
    other = "found" if mine["report_type"] == "lost" else "lost"
    photos = _all_features(conn)
    my_photo = photos.get(report_id)
    scored = []
    for row in _open_rows(conn, other):
        if row["user_id"] == user_id:
            continue  # your own report is never a match for you
        theirs = dict(row)
        lost, found = (mine, theirs) if other == "found" else (theirs, mine)
        if matching.time_conflict(lost, found):
            continue
        value = matching.score(mine, theirs)
        rank = None
        image_score = None
        their_photo = photos.get(row["report_id"])
        if my_photo and their_photo:
            image_score = vision.similarity(my_photo, their_photo)
            if value == 0 and image_score < PHOTO_ONLY_SCORE:
                continue
            value = round((1 - PHOTO_WEIGHT) * value + PHOTO_WEIGHT * image_score)
        elif my_photo:
            rank = value * NO_PHOTO_FACTOR
        if value >= MIN_SCORE:
            scored.append((value if rank is None else rank, value, image_score, row))
    scored.sort(key=lambda entry: (entry[0], entry[3]["image_id"] is not None), reverse=True)
    scored = _prefer_colour(mine["colour"], scored, lambda entry: entry[3])

    return [{**public_report(row, user_id), "score": value, "image_score": image_score}
            for _, value, image_score, row in scored[: _limit(limit)]]


def search(conn, user_id, filters, semantic=None, include_own=True):
    """Drill down through open reports. Every filter is optional and affects ranking.

    semantic(conn, query, rows) may return {report_id: score} to match by meaning. It is used
    only when the word rules find nothing, so it cannot push unrelated items above real hits.
    """
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
            query[field] = redact(value.strip())

    found = []
    rows = _open_rows(conn, report_type)
    if not include_own:
        rows = [row for row in rows if row["user_id"] != user_id]
    scores = {row["report_id"]: matching.score(query, dict(row)) for row in rows} if query else {}
    if semantic and query and not any(v >= MIN_SCORE for v in scores.values()):
        scores = semantic(conn, query, rows) or scores
    for row in rows:
        value = scores.get(row["report_id"], 0) if query else None
        if value is None or value >= MIN_SCORE:
            found.append((value, row))
    if "colour" in query:
        found = _prefer_colour(query["colour"], found, lambda pair: pair[1])
    if query:
        # On equal scores, show reports that have a photo first.
        found.sort(key=lambda pair: (pair[0], pair[1]["image_id"] is not None), reverse=True)

    facets = {}
    for field in ("item", "colour", "brand", "place"):
        counts = Counter(redact(row[field]).casefold() for _, row in found)
        facets[field] = [{"value": v, "count": c} for v, c in counts.most_common(8)]
    results = [{**public_report(row, user_id), "score": value}
               for value, row in found[: _limit(filters.get("limit"), 5)]]
    # Browsing without any search words is not "finding" something.
    contacts = department_contacts(bool(query and results))
    return {"total": len(found), "results": results, "facets": facets, "contacts": contacts}
