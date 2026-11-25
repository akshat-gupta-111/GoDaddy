"""Chatbot, logout, insights and seed data. Azure is mocked."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import urllib3

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402
import llm  # noqa: E402
import services  # noqa: E402
from app import create_app  # noqa: E402
from seed import seed  # noqa: E402

DRAFT = dict(report_type="found", item="keys", colour="grey", brand="unknown", place="Gym",
             description="two keys", from_time="2026-11-25T10:00")


def call(name, args=None):
    return {"content": None, "tool_calls": [{"id": "c1", "type": "function", "function": {
        "name": name, "arguments": json.dumps(args or {})}}]}


def say(text):
    return {"content": text}


class ChatbotTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = os.path.join(folder.name, "test.db")
        self.client = create_app(self.path).test_client()
        self.headers = self.user("a@example.test", "R1")
        patcher = mock.patch.object(llm, "embed", side_effect=llm.LLMError("offline"))
        patcher.start()
        self.addCleanup(patcher.stop)

    def user(self, email, roll):
        r = self.client.post("/api/signup", json={"email": email, "password": "password123"})
        headers = {"Authorization": "Bearer " + r.get_json()["token"]}
        self.client.put("/api/profile", headers=headers, json={
            "user_name": "T", "roll_no": roll, "year": 1, "phone": "0000000000"})
        return headers

    def chat(self, replies, headers=None, **extra):
        with mock.patch.object(llm, "chat", side_effect=replies):
            return self.client.post("/api/chat", headers=headers or self.headers,
                                    json={"message": "hi", **extra})

    def mine(self):
        return self.client.get("/api/reports/mine", headers=self.headers).get_json()["reports"]

    def ready(self):
        return self.chat([call("update_draft", DRAFT), say("ok")]).get_json()

    def test_save_needs_a_yes_and_happens_once(self):
        first = self.chat([call("update_draft", DRAFT), say("ok")], message="yes").get_json()
        self.assertIsNone(first["saved_report"])  # nothing had been shown yet
        self.assertTrue(first["awaiting_confirmation"])
        self.assertIn("Gym", first["reply"])
        confirm = dict(draft=first["draft"], confirm_token=first["confirm_token"])
        for message in ("hi", "no", "yes but change the colour", "don't save it"):
            r = self.chat([call("save_report"), say("sure")], message=message, **confirm).get_json()
            self.assertIsNone(r["saved_report"], message)
            self.assertIn("Reply yes", r["reply"])
        self.assertEqual(self.mine(), [])
        for extra in ({"message": "Yes, save it please"}, {"message": "hmm", "confirm": True}):
            done = self.chat([], **extra, **confirm).get_json()  # no model call needed
            self.assertEqual(done["saved_report"]["item"], "keys")
            self.assertEqual(done["draft"], {})
        self.assertEqual(len(self.mine()), 1)

    def test_changed_draft_or_other_user_cannot_use_token(self):
        first = self.ready()
        changed = {**first["draft"], "place": "Library"}
        r = self.chat([say("no")], message="yes", draft=changed,
                      confirm_token=first["confirm_token"]).get_json()
        self.assertIsNone(r["saved_report"])
        self.assertIn("Library", r["reply"])
        other = self.user("b@example.test", "R2")
        for token, headers in ((first["confirm_token"], other), ("junk", self.headers)):
            r = self.chat([say("no")], headers=headers, message="yes", draft=first["draft"],
                          confirm_token=token).get_json()
            self.assertIsNone(r["saved_report"])

    def test_contact_details_never_reach_the_model_or_results(self):
        self.client.post("/api/reports/found", headers=self.headers, json={
            **DRAFT, "description": "call 98765 43210 or me@example.test"})
        with mock.patch.object(llm, "chat", side_effect=[call("search_items", {"item": "keys"}),
                                                          say("ring +91 9876543210")]) as model:
            r = self.client.post("/api/chat", headers=self.user("seeker@example.test", "R9"),
                                 json={"message": "my number is 9876543210, lost keys"})
        sent = json.dumps([c.args[0] for c in model.call_args_list])
        for secret in ("43210", "me@example.test"):
            self.assertNotIn(secret, sent)
            self.assertNotIn(secret, r.get_data(as_text=True))
        self.assertIn("2026-11-25T10:00", r.get_data(as_text=True))  # times are untouched

    def test_old_rows_and_spaced_numbers_are_hidden_everywhere(self):
        seed(self.path, count=1)
        conn = db.connect(self.path)
        with conn:
            conn.execute("UPDATE reports SET report_type = 'lost', place = 'Gym 9876 543 210'")
            conn.execute("UPDATE items SET item = 'bag 98-76-54-32-10'")
        conn.close()
        for path, kwargs in (("/api/search", {"json": {"report_type": "lost"}}), ("/api/insights", None)):
            method = self.client.post if kwargs else self.client.get
            text = method(path, headers=self.headers, **(kwargs or {})).get_data(as_text=True)
            self.assertIn("[contact removed]", text.replace("Contact Removed", "contact removed").lower())
            for secret in ("543 210", "54-32"):
                self.assertNotIn(secret, text)
        self.assertEqual(services.redact("From: 2026-11-24 17:00 to 2026-11-25T10:00"),
                         "From: 2026-11-24 17:00 to 2026-11-25T10:00")

    def test_azure_client_safety_and_retries(self):
        env = {"AZURE_OPENAI_ENDPOINT": "http://x.test", "AZURE_OPENAI_API_KEY": "k"}
        with mock.patch.dict(os.environ, env), self.assertRaises(llm.LLMError):
            llm.chat([], [])
        env["AZURE_OPENAI_ENDPOINT"] = "https://x.test"
        ok = mock.Mock(status=200, data=b'{"choices":[{"message":{"content":"ok"}}]}')
        drop = urllib3.exceptions.ProtocolError("dropped")
        slow = urllib3.exceptions.ReadTimeoutError(None, "u", "slow")
        with mock.patch.dict(os.environ, env), mock.patch.object(llm.time, "sleep"):
            with mock.patch.object(llm._pool, "request", side_effect=[drop, mock.Mock(status=503), ok]) as send:
                self.assertEqual(llm.chat([], [])["content"], "ok")
                self.assertFalse(send.call_args.kwargs["redirect"])
            for failure in (slow, [mock.Mock(status=302)], [mock.Mock(status=401)]):
                with mock.patch.object(llm._pool, "request", side_effect=failure) as send:
                    with self.assertRaises(llm.LLMError):
                        llm.chat([], [])
                    self.assertEqual(send.call_count, 1)


    def test_search_pops_up_department_numbers_and_survives_embedding_failure(self):
        seed(self.path)
        r = self.chat([call("search_items", {"item": "bottle"}), say("which colour?")])
        self.assertEqual(r.status_code, 200)
        results = r.get_json()["results"]
        self.assertTrue(results)
        self.assertNotIn("contact", results[0])
        self.assertEqual(len(r.get_json()["contacts"]), 2)
        for replies in ([say("hello")], [call("search_items", {"item": "umbrellaz"}), say("none")],
                        [call("my_reports"), say("here")]):
            self.assertEqual(self.chat(replies).get_json()["contacts"], [])

    def test_meaning_search_only_when_rules_find_nothing(self):
        seed(self.path)
        with mock.patch.object(llm, "semantic_scores", return_value={"seed-r4": 80}) as meaning:
            self.chat([call("search_items", {"item": "bottle"}), say("x")])
            meaning.assert_not_called()
            r = self.chat([call("search_items", {"item": "power brick", "report_type": "found"}), say("x")])
            meaning.assert_called_once()
            self.assertEqual([x["score"] for x in r.get_json()["results"]], [80])

    def test_bad_input_and_bad_model_output(self):
        for extra in ({"message": ""}, {"message": 5}, {"history": "x"},
                      {"history": [{"role": "system", "content": "x"}]}, {"draft": [1]}):
            self.assertEqual(self.chat([say("x")], **extra).status_code, 400, extra)
        broken = call("search_items")
        broken["tool_calls"][0]["function"]["arguments"] = "{oops"
        replies = [broken, call("find_matches", {"report_id": ["x"]}), call("nope"),
                   call("search_items", {"item": 5}), say("done")]
        self.assertEqual(self.chat(replies).get_json()["reply"], "done")
        self.assertEqual(self.chat(llm.LLMError("down")).status_code, 502)
        self.assertEqual(self.client.post("/api/chat", json={"message": "hi"}).status_code, 401)

    def test_logout(self):
        second = self.client.post("/api/login", json={"email": "a@example.test", "password": "password123"})
        other = {"Authorization": "Bearer " + second.get_json()["token"]}
        self.assertEqual(self.client.post("/api/logout", headers=self.headers).status_code, 200)
        self.assertEqual(self.client.get("/api/profile", headers=self.headers).status_code, 401)
        self.assertEqual(self.client.post("/api/logout", headers=self.headers).status_code, 401)
        self.assertEqual(self.client.get("/api/profile", headers=other).status_code, 200)

    def test_seed_and_insights(self):
        self.assertEqual(seed(self.path), 150)
        self.assertEqual(seed(self.path), 0)
        data = self.client.get("/api/insights", headers=self.headers).get_json()
        self.assertEqual(data["total_lost"], 90)
        self.assertEqual((len(data["top_items"]), len(data["hotspots"])), (3, 3))
        login = self.client.post("/api/login", json={"email": "student1@example.test", "password": "!"})
        self.assertEqual(login.status_code, 401)


    def test_redacts_punctuated_phone_numbers(self):
        for text in ("(202) 555-0100", "202.555.0100", "+91 98765-43210"):
            self.assertIn("[contact removed]", services.redact("call " + text), text)
        keep = "2026-11-24 17:00, 2026-11-25T10:00, room 204, 2 keys"
        self.assertEqual(services.redact(keep), keep)

    def test_one_photo_never_removes_a_text_match(self):
        other = self.user("b@example.test", "R2")
        mine = self.client.post("/api/reports/lost", headers=self.headers, json={
            **DRAFT, "report_type": "lost"}).get_json()["report"]["report_id"]
        theirs = self.client.post("/api/reports/found", headers=other, json={
            **DRAFT, "colour": "red", "place": "Hostel", "description": "tag"}).get_json()["report"]["report_id"]
        url = f"/api/reports/{mine}/matches"
        before = self.client.get(url, headers=self.headers).get_json()["matches"]
        conn = db.connect(self.path)
        with conn:
            services.save_features(conn, mine, {"cnn": [1.0], "colour": [1.0]})
        conn.close()
        after = self.client.get(url, headers=self.headers).get_json()["matches"]
        self.assertEqual([(m["report_id"], m["score"]) for m in after], [(m["report_id"], m["score"]) for m in before])
        self.assertEqual(after[0]["report_id"], theirs)

    def test_own_reports_are_never_offered_as_finds(self):
        self.client.post("/api/reports/found", headers=self.headers, json=DRAFT)
        lost = self.client.post("/api/reports/lost", headers=self.headers, json={
            **DRAFT, "report_type": "lost"}).get_json()["report"]["report_id"]
        r = self.chat([call("search_items", {"item": "keys"}), say("none")]).get_json()
        self.assertEqual((r["results"], r["contacts"]), ([], []))
        data = self.client.get(f"/api/reports/{lost}/matches", headers=self.headers).get_json()
        self.assertEqual(data["matches"], [])
        browse = self.client.post("/api/search", headers=self.headers, json={}).get_json()
        self.assertEqual(browse["total"], 1)  # still listed when browsing

    def test_other_colours_only_when_the_wanted_one_is_missing(self):
        other = self.user("b@example.test", "R2")
        for colour in ("navy", "red", "multicolour"):
            self.client.post("/api/reports/found", headers=other, json={**DRAFT, "item": "umbrella", "colour": colour})
        colours = lambda c: sorted(x["colour"] for x in self.client.post(
            "/api/search", headers=self.headers, json={"item": "umbrella", "colour": c}).get_json()["results"])
        self.assertEqual(colours("blue"), ["navy"])
        self.assertEqual(colours("green"), ["multicolour", "navy", "red"])
        mine = self.client.post("/api/reports/lost", headers=self.headers, json={
            **DRAFT, "report_type": "lost", "item": "umbrella", "colour": "blue"}).get_json()["report"]["report_id"]
        found = self.client.get(f"/api/reports/{mine}/matches", headers=self.headers).get_json()["matches"]
        self.assertEqual([m["colour"] for m in found], ["navy"])

if __name__ == "__main__":
    unittest.main()
