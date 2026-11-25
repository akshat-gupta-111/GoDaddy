"""Minimal Azure OpenAI client. Both endpoints in .env are full request URLs."""

import json
import math
import os
import time
from pathlib import Path

import certifi
import urllib3
from dotenv import load_dotenv

import services

# override=True: this project's .env wins over variables already set in the shell.
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

TIMEOUT_SECONDS = 30
ATTEMPTS = 3
RETRY_STATUS = {429, 500, 502, 503, 504}
# Change this if the embedding model is upgraded behind the same URL.
EMBEDDING_VERSION = "2"
# Cosine similarity mapped linearly onto 0-100 between these two values.
SIMILARITY_FLOOR = 0.20
SIMILARITY_CEILING = 0.60


class LLMError(RuntimeError):
    """Azure is not configured or the request failed."""


# One shared pool keeps connections open: a new connection to Azure can cost several seconds.
_pool = urllib3.PoolManager(cert_reqs="CERT_REQUIRED", ca_certs=certifi.where(), maxsize=8)


def _post(prefix, payload):
    url = os.environ.get(f"{prefix}_ENDPOINT")
    key = os.environ.get(f"{prefix}_API_KEY")
    if not url or not key:
        raise LLMError(f"{prefix}_ENDPOINT and {prefix}_API_KEY must be set in .env.")
    if not url.lower().startswith("https://"):
        raise LLMError(f"{prefix}_ENDPOINT must start with https://")
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json", "api-key": key}
    for attempt in range(1, ATTEMPTS + 1):
        try:
            # No redirects: they would resend the api-key header, possibly to another host.
            response = _pool.request(
                "POST", url, body=body, headers=headers, redirect=False, retries=False,
                timeout=urllib3.Timeout(connect=15, read=TIMEOUT_SECONDS),
            )
            if response.status == 200:
                return json.loads(response.data)
            failure, temporary = str(response.status), response.status in RETRY_STATUS
            cause = None
        except (urllib3.exceptions.HTTPError, OSError, ValueError) as error:
            failure, temporary, cause = type(error).__name__, _is_temporary(error), error
        if not (temporary and attempt < ATTEMPTS):
            raise LLMError(f"Azure request failed ({failure}).") from cause
        time.sleep(attempt)


def _is_temporary(error):
    """Dropped or refused connections are worth retrying; timeouts are not."""
    errors = urllib3.exceptions
    if isinstance(error, errors.NewConnectionError):
        return True
    if isinstance(error, errors.TimeoutError):
        return False
    return isinstance(error, (errors.ProtocolError, errors.SSLError, ConnectionError))


def chat(messages, tools, tool_choice="auto"):
    """Return the assistant message from one chat completion."""
    result = _post("AZURE_OPENAI", {
        "messages": messages, "tools": tools, "tool_choice": tool_choice,
        "temperature": 0.2, "max_tokens": 600,
    })
    try:
        return result["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as error:
        raise LLMError("Azure returned an unexpected response.") from error


def embed(texts):
    result = _post("AZURE_OPENAI_EMBEDDINGS", {"input": texts})
    try:
        vectors = [row["embedding"] for row in sorted(result["data"], key=lambda r: r["index"])]
    except (KeyError, TypeError) as error:
        raise LLMError("Azure returned an unexpected response.") from error
    if len(vectors) != len(texts):
        raise LLMError("Azure returned the wrong number of embeddings.")
    return vectors


def _cosine(a, b):
    size = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return sum(x * y for x, y in zip(a, b)) / size if size else 0.0


def _describe(row):
    return services.redact(f"{row['colour']} {row['item']}. {row['description']}")


def semantic_scores(conn, query, rows):
    """Return {report_id: 0-100} by meaning. Report vectors are computed once and cached."""
    # Place is left out: sharing a location does not make two items alike.
    text = " ".join(query[f] for f in ("colour", "item", "brand", "text") if f in query)
    if not text or not rows:
        return {}
    model = f"{os.environ.get('AZURE_OPENAI_EMBEDDINGS_ENDPOINT')}|{EMBEDDING_VERSION}"
    cached = {
        r["report_id"]: json.loads(r["vector"])
        for r in conn.execute("SELECT report_id, vector FROM embeddings WHERE model = ?", (model,))
    }
    missing = [row for row in rows if row["report_id"] not in cached]
    for start in range(0, len(missing), 100):
        batch = missing[start:start + 100]
        vectors = embed([_describe(row) for row in batch])
        with conn:
            conn.executemany(
                "INSERT OR REPLACE INTO embeddings (report_id, model, vector) VALUES (?, ?, ?)",
                [(row["report_id"], model, json.dumps(v)) for row, v in zip(batch, vectors)],
            )
        cached.update({row["report_id"]: v for row, v in zip(batch, vectors)})
    wanted = embed([text])[0]
    span = SIMILARITY_CEILING - SIMILARITY_FLOOR
    return {
        row["report_id"]: round(100 * max(0.0, min(1.0, (
            _cosine(wanted, cached[row["report_id"]]) - SIMILARITY_FLOOR) / span)))
        for row in rows
    }
