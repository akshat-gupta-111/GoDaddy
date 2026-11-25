"""Rule-based match scoring, so "navy bottle" finds "blue water bottle"."""

import re

# Phrases are replaced before single words, longest first.
SYNONYMS = {
    "water bottle": "bottle", "flask": "bottle", "sipper": "bottle", "thermos": "bottle",
    "phone charger": "charger", "laptop charger": "charger", "power adapter": "charger", "adapter": "charger",
    "identity card": "idcard", "id card": "idcard", "student card": "idcard", "college id": "idcard",
    "backpack": "bag", "rucksack": "bag", "schoolbag": "bag",
    "hooded sweatshirt": "hoodie", "sweatshirt": "hoodie",
    "mobile phone": "phone", "mobile": "phone", "smartphone": "phone", "cellphone": "phone",
    "ear buds": "earphones", "earbuds": "earphones", "headphones": "earphones", "airpods": "earphones",
    "spectacles": "glasses", "specs": "glasses",
    "keychain": "keys", "key": "keys", "purse": "wallet", "notebooks": "notebook",
    "navy": "blue", "sky": "blue", "gray": "grey", "silver": "grey", "charcoal": "grey",
    "maroon": "red", "crimson": "red", "beige": "brown", "tan": "brown", "violet": "purple",
}
_PATTERN = re.compile(r"\b(" + "|".join(sorted(map(re.escape, SYNONYMS), key=len, reverse=True)) + r")\b")
STOPWORDS = {"a", "an", "the", "my", "of", "on", "in", "at", "with", "and", "it", "is", "near", "i"}
UNKNOWN = {"unknown", "none", "na", "n a", "not sure", "no brand"}
WEIGHTS = {"item": 40, "colour": 20, "brand": 10, "place": 15, "description": 15}


def tokens(text):
    cleaned = " ".join(re.findall(r"\w+", (text or "").casefold()))
    return set(_PATTERN.sub(lambda m: SYNONYMS[m.group(1)], cleaned).split()) - STOPWORDS


def _known(text):
    return " ".join(re.findall(r"\w+", (text or "").casefold())) not in UNKNOWN | {""}


def _similarity(wanted, actual):
    """Share of the shorter side's words that also appear on the other side."""
    a, b = tokens(wanted), tokens(actual)
    return len(a & b) / min(len(a), len(b)) if a and b else 0.0


def score(query, candidate):
    """Return 0-100. Only fields present in the query (and known on both sides) count.

    Returns 0 if the query names an item or free text and neither matches.
    """
    everything = " ".join(str(candidate.get(f) or "") for f in WEIGHTS)
    parts = {}
    for field, weight in WEIGHTS.items():
        wanted, actual = query.get(field), candidate.get(field)
        if not _known(wanted) or not _known(actual):
            continue
        parts[field] = (weight, _similarity(wanted, actual))

    text = query.get("text")
    if tokens(text):
        words = tokens(text)
        parts["text"] = (40, len(words & tokens(everything)) / len(words))

    if not parts:
        return 0
    subject = [parts[f][1] for f in ("item", "text") if f in parts]
    if subject and not any(subject):
        return 0
    total = sum(w for w, _ in parts.values())
    return round(100 * sum(w * s for w, s in parts.values()) / total)


def time_conflict(lost, found):
    """True when the item was found before it could have been lost."""
    start, seen = lost.get("from_time"), found.get("from_time")
    return bool(start and seen and seen < start)
