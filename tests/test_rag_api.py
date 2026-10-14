import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from langchain_core.documents import Document

from main import app


class RagApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_successful_question_returns_cited_retrieval(self):
        document = Document(
            page_content="High network utilization can increase latency.",
            metadata={"document": "telecom_knowledge.txt"},
        )
        with patch("main.retrieve_knowledge", return_value=[(document, 0.89)]) as retrieve:
            response = self.client.post(
                "/rag/ask",
                json={
                    "question": "Why is latency high?",
                    "cell_id": "CELL-1001",
                    "fault": "congestion",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "success")
        self.assertIn("[1]", payload["answer"])
        self.assertEqual(payload["sources"][0]["document"], "telecom_knowledge.txt")
        self.assertIsNone(payload["sources"][0]["page"])
        self.assertEqual(payload["sources"][0]["relevance_score"], 0.89)
        retrieve.assert_called_once()

    def test_empty_retrieval_reports_insufficient_evidence(self):
        with patch("main.retrieve_knowledge", return_value=[]):
            response = self.client.post(
                "/rag/ask",
                json={"question": "Question with no indexed evidence"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "insufficient_evidence")
        self.assertEqual(response.json()["sources"], [])
        self.assertIn("sufficient evidence", response.json()["answer"].lower())

    def test_question_retrieves_passages_from_the_local_index(self):
        response = self.client.post(
            "/rag/ask",
            json={
                "question": "Why is latency high and packet loss increasing?",
                "fault": "congestion",
                "top_k": 5,
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "success")
        self.assertTrue(payload["sources"])
        self.assertIn("[1]", payload["answer"])
        self.assertEqual(payload["sources"][0]["document"], "telecom_knowledge.txt")

    def test_rag_status_reports_local_index(self):
        response = self.client.get("/rag/status")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ready")
        self.assertGreater(response.json()["documents_indexed"], 0)

    def test_prediction_response_includes_recommendations_and_alternatives(self):
        response = self.client.post(
            "/network/analyze",
            json={
                "cell_id": "CELL-1001",
                "cpu": 82,
                "traffic": 94,
                "packet_loss": 6,
                "latency": 240,
                "signal_strength": -78,
                "throughput": 90,
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIsInstance(payload["next_step"], str)
        self.assertTrue(payload["next_step"])
        self.assertIsInstance(payload["alternatives"], list)

    def test_question_is_required(self):
        response = self.client.post("/rag/ask", json={})
        self.assertEqual(response.status_code, 422)

    def test_invalid_top_k_is_rejected(self):
        for top_k in (0, 11):
            with self.subTest(top_k=top_k):
                response = self.client.post(
                    "/rag/ask",
                    json={"question": "What causes packet loss?", "top_k": top_k},
                )
                self.assertEqual(response.status_code, 422)

    def test_question_over_maximum_length_is_rejected(self):
        response = self.client.post(
            "/rag/ask",
            json={"question": "x" * 1001},
        )
        self.assertEqual(response.status_code, 422)

    def test_blank_question_is_rejected(self):
        response = self.client.post(
            "/rag/ask",
            json={"question": "   "},
        )
        self.assertEqual(response.status_code, 422)

    def test_retrieval_failure_is_reported_without_internal_details(self):
        with patch("main.retrieve_knowledge", side_effect=RuntimeError("private detail")):
            response = self.client.post(
                "/rag/ask",
                json={"question": "What causes congestion?"},
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json()["detail"],
            "Knowledge retrieval is temporarily unavailable.",
        )
        self.assertNotIn("private detail", response.text)

    def test_legacy_fault_search_contract_remains_available(self):
        with patch("main.search_knowledge", return_value="Legacy fault guidance"):
            response = self.client.get("/rag/search", params={"fault": "CONGESTION"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"fault": "CONGESTION", "knowledge": "Legacy fault guidance"},
        )


if __name__ == "__main__":
    unittest.main()
