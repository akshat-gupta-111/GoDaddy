import os
import secrets
from pathlib import Path

from flask import Flask, g, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

import api
import chatbot
import db  # api imports image_storage, which loads .env
from services import ApiError

FRONTEND = Path(__file__).resolve().parent / "frontend"
# Only our own scripts and styles; photos come from Cloudinary.
CONTENT_POLICY = (
    "default-src 'self'; img-src 'self' data: blob: https://res.cloudinary.com; "
    "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
)


def _secret_key(folder):
    """Use SECRET_KEY from .env, or create one once and keep it next to the database."""
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    path = Path(folder) / "secret_key"
    try:
        with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as file:
            file.write(secrets.token_hex(32))
    except FileExistsError:
        pass
    key = path.read_text().strip()
    if not key:
        raise RuntimeError(f"{path} is empty. Delete it and restart.")
    return key


def create_app(db_path=db.DB_PATH):
    app = Flask(__name__)
    db.init_db(db_path)
    app.config.update(
        DB_PATH=db_path,
        SECRET_KEY=_secret_key(Path(db_path).parent),
        MAX_CONTENT_LENGTH=6 * 1024 * 1024,
    )
    app.register_blueprint(api.bp)

    app.register_blueprint(chatbot.bp)

    @app.teardown_appcontext
    def close_db(_error):
        conn = g.pop("db", None)
        if conn is not None:
            conn.close()

    @app.errorhandler(ApiError)
    def api_error(error):
        payload = {"error": str(error)}
        if error.fields:
            payload["fields"] = error.fields
        return jsonify(payload), error.status

    @app.errorhandler(HTTPException)
    def http_error(error):
        if request.path.startswith("/api/"):
            return jsonify(error=error.description), error.code
        return error

    @app.get("/")
    def index():
        return send_from_directory(FRONTEND, "index.html")

    @app.get("/<any(css, js):folder>/<path:name>")
    def asset(folder, name):
        return send_from_directory(FRONTEND / folder, name)

    @app.after_request
    def security_headers(response):
        response.headers.setdefault("Content-Security-Policy", CONTENT_POLICY)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        return response

    return app


if __name__ == "__main__":
    create_app().run(port=5001)
