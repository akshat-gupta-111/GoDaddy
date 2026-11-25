import importlib.util
import os
import secrets
from pathlib import Path

from flask import Flask, g, jsonify, request
from werkzeug.exceptions import HTTPException

import api
import db  # api imports image_storage, which loads .env
from services import ApiError


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

    # The chatbot team adds a "chatbot" package that exposes a Flask blueprint named bp.
    if importlib.util.find_spec("chatbot") is not None:
        from chatbot import bp as chatbot_bp

        app.register_blueprint(chatbot_bp)

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
        return "Lost and Found is running."

    return app


if __name__ == "__main__":
    create_app().run(port=5001)
