"""HTTP routes. All paths start with /api and exchange JSON."""

import io
import re
import sqlite3
import time
import uuid
from functools import wraps

from flask import Blueprint, current_app, g, jsonify, request
from itsdangerous import BadData, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

import db
import image_storage
import services
import vision
from services import ApiError

bp = Blueprint("api", __name__, url_prefix="/api")

TOKEN_SECONDS = 7 * 24 * 3600
EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
PHONE = re.compile(r"\+?\d{10,15}")


def get_db():
    if "db" not in g:
        g.db = db.connect(current_app.config["DB_PATH"])
    return g.db


def _serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="auth")


def login_required(view):
    """Set g.user_id from the "Authorization: Bearer <token>" header."""

    @wraps(view)
    def wrapped(*args, **kwargs):
        scheme, _, token = request.headers.get("Authorization", "").partition(" ")
        try:
            if scheme.lower() != "bearer":
                raise BadData("missing token")
            claims = _serializer().loads(token, max_age=TOKEN_SECONDS)
            user_id, token_id = claims["u"], claims["j"]
        except (BadData, KeyError, TypeError, UnicodeError):
            raise ApiError("Please log in.", 401)
        row = get_db().execute(
            """SELECT 1 FROM users WHERE user_id = ?
               AND NOT EXISTS (SELECT 1 FROM revoked_tokens WHERE token_id = ?)""",
            (user_id, token_id),
        ).fetchone()
        if not row:
            raise ApiError("Please log in.", 401)
        g.user_id, g.token_id = user_id, token_id
        return view(*args, **kwargs)

    return wrapped


def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Send a JSON object.")
    if any(isinstance(v, str) and not services.is_valid_text(v) for v in data.values()):
        raise ApiError("Text contains invalid characters.")
    return data


def _user(user_id):
    row = get_db().execute(
        "SELECT user_id, email, user_name, roll_no, year, phone FROM users WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    user = dict(row)
    user["profile_complete"] = all(user[k] is not None for k in ("user_name", "roll_no", "year", "phone"))
    return user


def _session(user_id, status=200):
    token = _serializer().dumps({"u": user_id, "j": uuid.uuid4().hex})
    return jsonify(token=token, user=_user(user_id)), status


def _credentials():
    data = body()
    email, password = data.get("email"), data.get("password")
    if not isinstance(email, str) or not isinstance(password, str):
        raise ApiError("Email and password are required.")
    return email.strip(), password


@bp.post("/signup")
def signup():
    email, password = _credentials()
    errors = {}
    if len(email) > 254 or not EMAIL.fullmatch(email):
        errors["email"] = "Enter a valid email address."
    if not 8 <= len(password) <= 128:
        errors["password"] = "Use 8 to 128 characters."
    if errors:
        raise ApiError("Check the highlighted fields.", 400, errors)
    user_id = uuid.uuid4().hex
    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO users (user_id, email, password_hash) VALUES (?, ?, ?)",
                # pbkdf2 works on every Python build; scrypt is missing on macOS system Python.
                (user_id, email, generate_password_hash(password, method="pbkdf2:sha256")),
            )
    except sqlite3.IntegrityError:
        raise ApiError("An account with this email already exists.", 409)
    return _session(user_id, 201)


@bp.post("/login")
def login():
    email, password = _credentials()
    row = get_db().execute(
        "SELECT user_id, password_hash FROM users WHERE email = ?", (email,)
    ).fetchone()
    if row is None or len(password) > 128 or not check_password_hash(row["password_hash"], password):
        raise ApiError("Wrong email or password.", 401)
    return _session(row["user_id"])


@bp.post("/logout")
@login_required
def logout():
    """Invalidate this token only; other devices stay logged in."""
    now = int(time.time())
    with get_db() as conn:
        conn.execute("DELETE FROM revoked_tokens WHERE expires_at < ?", (now,))
        conn.execute(
            "INSERT OR IGNORE INTO revoked_tokens (token_id, expires_at) VALUES (?, ?)",
            (g.token_id, now + TOKEN_SECONDS),
        )
    return jsonify(ok=True)


@bp.get("/profile")
@login_required
def get_profile():
    return jsonify(user=_user(g.user_id))


@bp.put("/profile")
@login_required
def put_profile():
    data = body()
    errors = {}
    name, roll, year, phone = (data.get(k) for k in ("user_name", "roll_no", "year", "phone"))
    name = name.strip() if isinstance(name, str) else ""
    roll = roll.strip() if isinstance(roll, str) else ""
    phone = re.sub(r"[\s-]", "", phone) if isinstance(phone, str) else ""
    if not 1 <= len(name) <= 80:
        errors["user_name"] = "Enter your name (up to 80 characters)."
    if not 1 <= len(roll) <= 30:
        errors["roll_no"] = "Enter your roll number (up to 30 characters)."
    if type(year) is not int or not 1 <= year <= 6:
        errors["year"] = "Choose a year from 1 to 6."
    if not PHONE.fullmatch(phone):
        errors["phone"] = "Enter 10 to 15 digits."
    if errors:
        raise ApiError("Check the highlighted fields.", 400, errors)
    try:
        with get_db() as conn:
            conn.execute(
                "UPDATE users SET user_name = ?, roll_no = ?, year = ?, phone = ? WHERE user_id = ?",
                (name, roll, year, phone, g.user_id),
            )
    except sqlite3.IntegrityError:
        raise ApiError("This roll number is already registered.", 409)
    return jsonify(user=_user(g.user_id))


def _create(report_type):
    data = {**body(), "report_type": report_type}
    return jsonify(report=services.create_report(get_db(), g.user_id, data)), 201


@bp.post("/reports/lost")
@login_required
def report_lost():
    return _create("lost")


@bp.post("/reports/found")
@login_required
def report_found():
    return _create("found")


@bp.get("/reports/mine")
@login_required
def mine():
    return jsonify(reports=services.my_reports(get_db(), g.user_id))


@bp.get("/reports/<report_id>")
@login_required
def one_report(report_id):
    row = services.get_row(get_db(), report_id)
    return jsonify(report=services.public_report(row, g.user_id))


@bp.get("/reports/<report_id>/matches")
@login_required
def report_matches(report_id):
    found = services.matches(get_db(), g.user_id, report_id, request.args.get("limit", 10))
    return jsonify(matches=found, contacts=services.department_contacts(bool(found)))


@bp.post("/reports/<report_id>/reunite")
@login_required
def report_reunite(report_id):
    return jsonify(report=services.reunite(get_db(), g.user_id, report_id))


def _discard(image_id):
    """Best-effort cleanup; a failure leaves an unused file on Cloudinary."""
    # Demo photos have fixed ids that other copies of the database may also use.
    if image_id and not image_id.startswith(f"{image_storage.FOLDER}/demo-"):
        try:
            image_storage.delete_image(image_id)
        except image_storage.StorageError:
            current_app.logger.warning("Could not delete image %s", image_id)


def attach_image(report_id):
    """Upload the "image" form file to the user's report and index it for matching."""
    conn = get_db()
    row = services.own_row(conn, g.user_id, report_id)
    file = request.files.get("image")
    if file is None:
        raise ApiError("Send the photo as multipart form field 'image'.")
    data = file.stream.read(image_storage.MAX_BYTES + 1)
    try:
        image_id = image_storage.upload_image(io.BytesIO(data))
    except image_storage.InvalidImage as error:
        raise ApiError(str(error))
    except image_storage.StorageError as error:
        _discard(error.image_id)
        raise ApiError("Image upload failed. Try again.", 502)
    try:
        features = vision.features(data)
    except vision.VisionError as error:
        # The photo is still saved; matching falls back to text for this report.
        current_app.logger.warning("%s", error)
        features = None
    try:
        with conn:
            # Re-read under a write lock so two uploads cannot both replace the same old image.
            conn.execute("BEGIN IMMEDIATE")
            old = services.get_row(conn, report_id)["image_id"]
            conn.execute("UPDATE items SET image_id = ? WHERE item_id = ?", (image_id, row["item_id"]))
            services.save_features(conn, report_id, features)
    except Exception:
        _discard(image_id)
        raise
    _discard(old)
    report = services.public_report(services.get_row(conn, report_id), g.user_id)
    return report, features is not None


@bp.post("/reports/<report_id>/image")
@login_required
def report_image(report_id):
    report, analysed = attach_image(report_id)
    return jsonify(report=report, image_analysed=analysed)


@bp.post("/search")
@login_required
def search():
    return jsonify(services.search(get_db(), g.user_id, body()))


@bp.get("/insights")
@login_required
def insights():
    return jsonify(services.insights(get_db()))


@bp.post("/chat/draft")
@login_required
def chat_draft():
    return jsonify(services.draft(body()))
