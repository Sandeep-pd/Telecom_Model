import { ApiClient, ApiError } from "/static/api.js";
import { METRICS, severity } from "/static/severity.js";
import { sanitizeHtmlToText } from "/static/sanitize.js";

const results = document.getElementById("results");
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(name, callback) {
  const row = document.createElement("li");
  try {
    await callback();
    row.className = "pass";
    row.textContent = `PASS ${name}`;
    passed += 1;
  } catch (error) {
    row.className = "fail";
    row.textContent = `FAIL ${name}: ${error.message}`;
    failed += 1;
  }
  results.append(row);
}

function response(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() { return payload; },
  };
}

const sampleCell = {
  id: "CELL-TEST",
  name: "Test cell",
  updatedAt: "2026-10-14T12:00:00Z",
  metrics: { cpu: 50, traffic: 60, loss: 1, lat: 50, sig: -80, tp: 400 },
  prediction: null,
};

await test("severity thresholds and inverse metrics", () => {
  const metric = key => METRICS.find(item => item.key === key);
  assert(severity(metric("cpu"), 69) === 0, "CPU below warning threshold should be normal.");
  assert(severity(metric("cpu"), 70) === 1, "CPU warning threshold should be elevated.");
  assert(severity(metric("cpu"), 90) === 2, "CPU critical threshold should be critical.");
  assert(severity(metric("sig"), -100) === 1, "Weak signal should be elevated.");
  assert(severity(metric("sig"), -105) === 2, "Very weak signal should be critical.");
  assert(severity(metric("tp"), 79) === 2, "Very low throughput should be critical.");
});

await test("RAG answer markup is reduced to safe text", () => {
  const answer = sanitizeHtmlToText(
    '<p>Evidence <strong>from runbook</strong></p><script>window.pwned=true</script><img src=x onerror="window.pwned=true">',
  );
  assert(answer === "Evidence from runbook", "Markup should not be rendered as HTML.");
  assert(!("pwned" in window), "Injected script must not execute.");
});

await test("cells API contract validation", async () => {
  const client = new ApiClient({
    apiBaseUrl: location.origin,
    useMockCells: false,
    cellsEndpoint: "/api/v1/cells",
  }, async () => response({ items: [sampleCell], nextCursor: null, total: 1 }));
  const page = await client.cells();
  assert(page.items[0].id === "CELL-TEST", "Cell ID should be preserved.");
});

await test("analysis client request and response", async () => {
  let sent;
  const client = new ApiClient({
    apiBaseUrl: location.origin,
    predictionEndpoint: "/network/analyze",
  }, async (url, options) => {
    sent = { url, options };
    return response({
      cell_id: "CELL-TEST",
      fault: "congestion",
      confidence: 0.9,
      next_step: "Review traffic.",
      alternatives: [{ fault: "normal", confidence: 0.1 }],
    });
  });
  const result = await client.analyze({ cell_id: "CELL-TEST", cpu: 70 });
  assert(result.fault === "congestion", "Prediction should be returned.");
  assert(JSON.parse(sent.options.body).cell_id === "CELL-TEST", "Cell ID must be sent.");
});

await test("RAG request includes current context", async () => {
  let sent;
  const client = new ApiClient({
    apiBaseUrl: location.origin,
    ragAskEndpoint: "/rag/ask",
  }, async (_url, options) => {
    sent = JSON.parse(options.body);
    return response({
      answer: "Evidence [1]",
      sources: [{ document: "guide.txt", page: null, content: "Evidence", relevance_score: 0.8 }],
      status: "success",
    });
  });
  await client.ask("Why is latency high?", { cellId: "CELL-TEST", fault: "congestion" });
  assert(sent.cell_id === "CELL-TEST" && sent.fault === "congestion", "RAG context was not sent.");
});

await test("HTTP errors are surfaced to callers", async () => {
  const client = new ApiClient({
    apiBaseUrl: location.origin,
    healthEndpoint: "/health",
  }, async () => response({ detail: "Service unavailable" }, false, 503));
  try {
    await client.health();
    throw new Error("Expected the request to fail.");
  } catch (error) {
    assert(error instanceof ApiError && error.status === 503, "HTTP error status should be preserved.");
    assert(error.message === "Service unavailable", "Server detail should be surfaced.");
  }
});

document.getElementById("summary").textContent =
  `${passed} passed, ${failed} failed.`;
