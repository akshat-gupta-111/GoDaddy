"""Run with: python -m unittest discover tests"""

import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import image_storage  # noqa: E402
import services  # noqa: E402
from app import create_app  # noqa: E402


class ApiTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.client = create_app(os.path.join(folder.name, "test.db")).test_client()
        self.owner = self.user("owner@example.test", "R1")
        self.finder = self.user("finder@example.test", "R2")

    def user(self, email, roll):
        r = self.client.post("/api/signup", json={"email": email, "password": "password123"})
        headers = {"Authorization": "Bearer " + r.get_json()["token"]}
        r = self.client.put("/api/profile", headers=headers, json={
            "user_name": "Test " + roll, "roll_no": roll, "year": 2, "phone": "0000000000"})
        self.assertEqual(r.status_code, 200)
        return headers

    def report(self, kind, headers, **changes):
        data = {"item": "bottle", "colour": "blue", "brand": "unknown", "place": "Library",
                "description": "steel water bottle", **changes}
        return self.client.post(f"/api/reports/{kind}", headers=headers, json=data)

    def test_auth(self):
        login = lambda p: self.client.post("/api/login", json={"email": "OWNER@example.test", "password": p})
        self.assertEqual(login("password123").status_code, 200)
        self.assertEqual(login("wrong-password").status_code, 401)
        again = self.client.post("/api/signup", json={"email": "owner@example.test", "password": "password123"})
        self.assertEqual(again.status_code, 409)
        self.assertEqual(self.client.get("/api/profile").status_code, 401)
        self.assertEqual(self.client.get("/api/profile", headers={"Authorization": "Bearer x"}).status_code, 401)

    def test_profile_required_and_unique_roll(self):
        r = self.client.post("/api/signup", json={"email": "new@example.test", "password": "password123"})
        headers = {"Authorization": "Bearer " + r.get_json()["token"]}
        self.assertEqual(self.report("lost", headers).status_code, 403)
        r = self.client.put("/api/profile", headers=headers, json={
            "user_name": "N", "roll_no": "r1", "year": 1, "phone": "0000000000"})
        self.assertEqual(r.status_code, 409)

    def test_validation(self):
        r = self.report("lost", self.owner, item=" ", from_time="yesterday")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(set(r.get_json()["fields"]), {"item", "from_time"})
        self.assertEqual(self.report("lost", self.owner, from_time="2026-11-25T12:00",
                                     to_time="2026-11-25T11:00").status_code, 400)
        self.assertEqual(self.client.post("/api/search", headers=self.owner, data="x").status_code, 400)

    def test_match_contact_and_reunite(self):
        lost = self.report("lost", self.owner, colour="navy", description="navy bottle").get_json()["report"]
        self.report("found", self.finder, item="water bottle")
        self.report("found", self.finder, item="charger", colour="white", description="usb charger")
        url = f"/api/reports/{lost['report_id']}"
        matches = self.client.get(url + "/matches", headers=self.owner).get_json()["matches"]
        self.assertEqual([m["item"] for m in matches], ["water bottle"])
        self.assertGreaterEqual(matches[0]["score"], 70)
        self.assertEqual(matches[0]["contact"]["phone"], "0000000000")
        self.assertNotIn("user_id", matches[0])
        self.assertEqual(self.client.get(url + "/matches", headers=self.finder).status_code, 403)
        self.assertEqual(self.client.post(url + "/reunite", headers=self.finder).status_code, 403)
        done = self.client.post(url + "/reunite", headers=self.owner)
        self.assertEqual(done.get_json()["report"]["status"], "reunited")

    def test_no_contact_for_place_only_or_impossible_match(self):
        vague = dict(item="unknown", colour="unknown", description="unknown")
        lost = self.report("lost", self.owner, **vague).get_json()["report"]
        self.report("found", self.finder, item="umbrella", colour="red", description="red umbrella")
        url = f"/api/reports/{lost['report_id']}/matches"
        for match in self.client.get(url, headers=self.owner).get_json()["matches"]:
            self.assertIsNone(match["contact"])
        lost = self.report("lost", self.owner, from_time="2026-11-25T12:00").get_json()["report"]
        self.report("found", self.finder, from_time="2026-11-24T12:00")
        url = f"/api/reports/{lost['report_id']}/matches"
        self.assertEqual(self.client.get(url, headers=self.owner).get_json()["matches"], [])

    def test_bad_text_and_ids(self):
        bad = "\ud800password"
        r = self.client.post("/api/signup", json={"email": "z@example.test", "password": bad})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.report("lost", self.owner, item="\ud800").status_code, 400)
        for report_id in ({"a": 1}, ["x"], None):
            with self.assertRaises(services.ApiError):
                services.matches(None, "u", report_id)

    def test_search_drill_down(self):
        self.report("found", self.finder, item="hoodie", colour="gray", description="hoodie")
        self.report("found", self.finder, item="hoodie", colour="black", description="hoodie", place="Canteen")
        search = lambda **q: self.client.post("/api/search", headers=self.owner, json=q).get_json()
        broad = search(item="sweatshirt")
        self.assertEqual(broad["total"], 2)
        self.assertEqual({f["value"] for f in broad["facets"]["colour"]}, {"gray", "black"})
        narrow = search(item="hoodie", colour="grey", place="library")
        self.assertEqual(narrow["results"][0]["colour"], "gray")
        self.assertNotIn("contact", narrow["results"][0])
        self.assertEqual(search(item="umbrella")["total"], 0)
        self.assertEqual(search()["total"], 2)

    def test_draft(self):
        post = lambda **d: self.client.post("/api/chat/draft", headers=self.owner, json=d).get_json()
        self.assertEqual(post()["next_field"], "report_type")
        full = dict(report_type="found", item="keys", colour="grey", brand="unknown",
                    place="Gym", description="two keys", from_time="2026-11-25T10:00")
        self.assertTrue(post(**full)["ready"])
        self.assertEqual(post(**{**full, "report_type": "lost"})["next_field"], "to_time")

    def test_image(self):
        report_id = self.report("found", self.finder).get_json()["report"]["report_id"]
        url = f"/api/reports/{report_id}/image"
        send = lambda h: self.client.post(url, headers=h, data={"image": (io.BytesIO(b"x"), "a.jpg")})
        with mock.patch.object(image_storage, "upload_image", side_effect=["lost_and_found/a", "lost_and_found/b"]), \
             mock.patch.object(image_storage, "delete_image") as delete, \
             mock.patch.object(image_storage, "image_url", side_effect=lambda i: i and "https://img.test/" + i):
            self.assertEqual(send(self.owner).status_code, 403)
            self.assertTrue(send(self.finder).get_json()["report"]["image_url"].endswith("/a"))
            self.assertTrue(send(self.finder).get_json()["report"]["image_url"].endswith("/b"))
            delete.assert_called_once_with("lost_and_found/a")
        self.assertEqual(self.client.post(url, headers=self.finder).status_code, 400)


if __name__ == "__main__":
    unittest.main()
