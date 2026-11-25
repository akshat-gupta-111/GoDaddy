"""Load the mock photos as matching lost and found reports. Run once: python demo_images.py

For each category: 2 items are reported both lost and found (the found photo is an altered
copy, standing in for a second photo), 2 only lost and 2 only found.
"""

import io
import sys
from datetime import datetime, timedelta

from PIL import Image, ImageEnhance

import db
import image_storage
import services
import vision
from seed import PREFIX as SEED_PREFIX, seed

PHOTOS = db.BASE_DIR / "BLUE_item_images_6_distinct_each"
PREFIX = "demo-"
# folder: (item name, description detail, [(colour, brand) for photos 1..6])
CATALOGUE = {
    "backpack": ("backpack", "with a front zip pocket", [("black", "unknown"), ("navy", "unknown"), ("grey", "unknown"), ("maroon", "Puma"), ("purple", "unknown"), ("black", "Adidas")]),
    "charger": ("charger", "wall adapter", [("white", "unknown"), ("black", "unknown"), ("white", "unknown"), ("black", "unknown"), ("white", "unknown"), ("black", "unknown")]),
    "earbuds": ("earbuds", "in a charging case", [("white", "unknown"), ("black", "unknown"), ("blue", "unknown"), ("beige", "unknown"), ("green", "unknown"), ("transparent", "unknown")]),
    "hoodie": ("hoodie", "pullover with a front pocket", [("black", "Nike"), ("grey", "Puma"), ("navy", "GAP"), ("maroon", "unknown"), ("white", "unknown"), ("green", "Adidas")]),
    "id_card": ("ID card", "on a lanyard", [("blue", "unknown"), ("green", "unknown"), ("red", "unknown"), ("navy", "unknown"), ("white", "unknown"), ("teal", "unknown")]),
    "keys": ("keys", "on a ring with a tag", [("black", "unknown"), ("brown", "unknown"), ("blue", "unknown"), ("beige", "unknown"), ("black", "unknown"), ("red", "unknown")]),
    "lunch_box": ("lunch box", "food container with a lid", [("silver", "unknown"), ("blue", "unknown"), ("pink", "unknown"), ("silver", "unknown"), ("navy", "unknown"), ("green", "unknown")]),
    "notebook": ("notebook", "spiral bound", [("brown", "unknown"), ("navy", "unknown"), ("multicolour", "unknown"), ("black", "unknown"), ("beige", "unknown"), ("purple", "unknown")]),
    "umbrella": ("umbrella", "with a curved handle", [("black", "unknown"), ("blue", "unknown"), ("red", "unknown"), ("yellow", "unknown"), ("purple", "unknown"), ("multicolour", "unknown")]),
    "water_bottle": ("water bottle", "reusable bottle", [("silver", "unknown"), ("navy", "unknown"), ("pink", "unknown"), ("blue", "unknown"), ("black", "unknown"), ("green", "unknown")]),
}
PLACES = ["Library", "Canteen", "Main Auditorium", "Sports Complex", "Computer Lab"]


def second_photo(data):
    """Tilt, crop and dim a picture so the two sides are not identical files."""
    image = Image.open(io.BytesIO(data)).convert("RGB")
    image = image.rotate(9, resample=Image.BICUBIC, fillcolor=(244, 244, 244))
    w, h = image.size
    image = image.crop((int(w * .07), int(h * .05), int(w * .94), int(h * .95)))
    image = ImageEnhance.Brightness(image).enhance(0.9)
    out = io.BytesIO()
    image.save(out, "JPEG", quality=80)
    return out.getvalue()


def plan():
    """Yield (key, kind, folder, number) for every report to create."""
    for folder in CATALOGUE:
        for number in range(1, 7):
            if number <= 4:
                yield f"{folder}-{number}-lost", "lost", folder, number
            if number <= 2 or number >= 5:
                yield f"{folder}-{number}-found", "found", folder, number


def load(path=db.DB_PATH, upload=image_storage.upload_image, today=None):
    """Create the missing demo reports and photos. Safe to run again after a failure."""
    if not PHOTOS.is_dir():
        raise SystemExit(f"Photo folder not found: {PHOTOS}")
    seed(path)  # creates the demo users
    today = (today or datetime.now()).replace(minute=0, second=0, microsecond=0)
    conn = db.connect(path)
    added = 0
    try:
        for index, (key, kind, folder, number) in enumerate(plan()):
            report_id = PREFIX + key
            if conn.execute("SELECT 1 FROM reports WHERE report_id = ?", (report_id,)).fetchone():
                continue
            name, detail, variants = CATALOGUE[folder]
            colour, brand = variants[number - 1]
            data = (PHOTOS / folder / f"{folder}_{number}.jpg").read_bytes()
            if kind == "found" and number <= 2:
                data = second_photo(data)
            vectors = vision.features(data)  # fail before uploading anything
            image_id = upload(io.BytesIO(data), f"lost_and_found/{report_id}")
            group = list(CATALOGUE).index(folder) * 6 + number
            day = today - timedelta(days=group % 12 + 2)
            start = day.replace(hour=9 + group % 7)
            if kind == "found":
                start += timedelta(hours=3)
            end = (start + timedelta(hours=2)) if kind == "lost" else None
            with conn:
                conn.execute(
                    "INSERT OR REPLACE INTO items (item_id, item, colour, brand, description, image_id)"
                    " VALUES (?, ?, ?, ?, ?, ?)",
                    (report_id, name, colour, brand, f"{colour.capitalize()} {name}, {detail}", image_id),
                )
                conn.execute(
                    """INSERT INTO reports (report_id, user_id, item_id, report_type, place, from_time, to_time)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (report_id, f"{SEED_PREFIX}u{index % 20 + 1}", report_id, kind, PLACES[group % len(PLACES)],
                     start.strftime(services.TIME_FORMAT), end and end.strftime(services.TIME_FORMAT)),
                )
                services.save_features(conn, report_id, vectors)
            added += 1
            print(f"  {report_id}", file=sys.stderr)
    finally:
        conn.close()
    return added


if __name__ == "__main__":
    print(f"Added {load()} reports with photos.")
