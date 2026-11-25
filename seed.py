"""Add 150 fake reports. Run once: python seed.py

Fake users have @example.test emails, made-up phone numbers and no usable password.
"""

import random
from datetime import datetime, timedelta

import db
import llm

PREFIX = "seed-"
# name: (weight, brands, description detail)
ITEMS = {
    "water bottle": (24, ["Milton", "Cello", "Decathlon"], "with stickers on the side"),
    "ID card": (20, ["unknown"], "in a clear plastic holder"),
    "charger": (18, ["Dell", "HP", "Samsung", "Apple"], "with the cable wrapped around it"),
    "earphones": (12, ["boAt", "Sony", "JBL"], "in a small case"),
    "bag": (9, ["Wildcraft", "Skybags", "American Tourister"], "with two zip pockets"),
    "keys": (7, ["unknown"], "on a ring with a tag"),
    "hoodie": (6, ["H&M", "Puma", "unknown"], "medium size"),
    "notebook": (5, ["Classmate", "unknown"], "with handwritten notes"),
    "calculator": (4, ["Casio"], "scientific, with a slide cover"),
    "umbrella": (3, ["unknown"], "folding type"),
    "glasses": (3, ["Lenskart", "unknown"], "with a thin frame"),
}
COLOURS = ["black", "blue", "navy", "grey", "white", "red", "green"]
PLACES = {"Library": 34, "Canteen": 24, "Main Auditorium": 14, "Sports Complex": 8,
          "Computer Lab": 7, "Parking Area": 5, "Hostel Block": 5, "Classroom Block A": 3}


def seed(path=db.DB_PATH, count=150, today=None):
    """Return the number of reports added (0 if the data is already there)."""
    db.init_db(path)
    random_ = random.Random(2026)
    today = (today or datetime.now()).replace(minute=0, second=0, microsecond=0)
    conn = db.connect(path)
    try:
        if conn.execute("SELECT 1 FROM reports WHERE report_id LIKE ?", (PREFIX + "%",)).fetchone():
            return 0
        with conn:
            for n in range(1, 21):
                conn.execute(
                    """INSERT OR IGNORE INTO users (user_id, email, password_hash, user_name, roll_no, year, phone)
                       VALUES (?, ?, '!', ?, ?, ?, ?)""",
                    (f"{PREFIX}u{n}", f"student{n}@example.test", f"Demo Student {n}",
                     f"DEMO{n:03d}", n % 4 + 1, f"00000{n:05d}"),
                )
            for n in range(1, count + 1):
                name = random_.choices(list(ITEMS), [v[0] for v in ITEMS.values()])[0]
                _, brands, detail = ITEMS[name]
                kind = "lost" if n % 5 < 3 else "found"
                colour = random_.choice(COLOURS)
                brand = random_.choice(brands)
                place = random_.choices(list(PLACES), list(PLACES.values()))[0]
                start = (today - timedelta(days=random_.randint(1, 30))).replace(hour=random_.randint(8, 18))
                end = (start + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M") if kind == "lost" else None
                conn.execute(
                    "INSERT INTO items (item_id, item, colour, brand, description) VALUES (?, ?, ?, ?, ?)",
                    (f"{PREFIX}i{n}", name, colour, brand, f"{colour.capitalize()} {name} {detail}"),
                )
                conn.execute(
                    """INSERT INTO reports (report_id, user_id, item_id, report_type, place, from_time, to_time)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (f"{PREFIX}r{n}", f"{PREFIX}u{random_.randint(1, 20)}", f"{PREFIX}i{n}", kind, place,
                     start.strftime("%Y-%m-%dT%H:%M"), end),
                )
        return count
    finally:
        conn.close()


def warm_search_cache(path=db.DB_PATH):
    """Compute search vectors now, so the first chat search is not slow."""
    conn = db.connect(path)
    try:
        rows = conn.execute(
            """SELECT r.report_id, r.place, i.item, i.colour, i.brand, i.description
               FROM reports r JOIN items i ON i.item_id = r.item_id WHERE r.status = 'open'"""
        ).fetchall()
        llm.semantic_scores(conn, {"item": "bag"}, rows)
    finally:
        conn.close()


if __name__ == "__main__":
    print(f"Added {seed()} fake reports to {db.DB_PATH}")
    try:
        warm_search_cache()
        print("Search cache ready.")
    except llm.LLMError as error:
        print(f"Search cache skipped: {error}")
