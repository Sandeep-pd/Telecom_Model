# TeleComAI

TeleComAI is a telecom fault analysis application with a FastAPI service and a
responsive network-operations dashboard. The dashboard is served from `static/`
and uses the teal theme, system light/dark mode, and the cells, prediction, and
RAG APIs described below.

## Setup and run

From the project root in PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/` for the dashboard or
`http://127.0.0.1:8000/docs` for the FastAPI documentation.

The server returns frontend settings from `/api-config.js`. Configure endpoints
and the cells fixture using environment variables; no API credentials belong
in browser code:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TELCOAI_API_BASE_URL` | same origin | API origin used by the frontend |
| `TELCOAI_HEALTH_ENDPOINT` | `/health` | Prediction service health check |
| `TELCOAI_PREDICTION_ENDPOINT` | `/network/analyze` | Fault prediction |
| `TELCOAI_CELLS_ENDPOINT` | `/api/v1/cells` | Cells list and cell details |
| `TELCOAI_RAG_ASK_ENDPOINT` | `/rag/ask` | Question-answer RAG |
| `TELCOAI_RAG_STATUS_ENDPOINT` | `/rag/status` | Knowledge index status |
| `TELCOAI_USE_MOCK_CELLS` | `true` | Load the local fixture until the cells API ships |
| `TELCOAI_MOCK_CELLS_ENDPOINT` | `/static/mock-data/cells.json` | Local cells fixture |
| `TELCOAI_CORS_ORIGINS` | empty | Comma-separated browser origins allowed for cross-origin API use |

Set `TELCOAI_USE_MOCK_CELLS=false` once `GET /api/v1/cells` and
`GET /api/v1/cells/{cellId}` are available. The fixture follows the agreed API
contract and is only a UI development aid; it is not live network data. When
using a separate API origin, set `TELCOAI_API_BASE_URL` and configure that
backend's CORS policy to allow the dashboard origin.

## Prediction API

`POST /network/analyze` accepts the six metrics and a cell ID:

```json
{
  "cell_id": "CELL-1001",
  "cpu": 82,
  "traffic": 94,
  "packet_loss": 6,
  "latency": 240,
  "signal_strength": -78,
  "throughput": 90
}
```

The response contains `cell_id`, `fault`, `confidence` (0-1), `next_step`,
`alternatives` (fault/confidence pairs), and the submitted `metrics`. The
current classifier and recommendation rules are local project components;
recommendations are rule-based from `decision_agent.py`.

## Cells API contract

The live cells service is not implemented in this project yet. The dashboard
expects:

- `GET /api/v1/cells` -> `{ items, nextCursor, total }`
- `GET /api/v1/cells/{cellId}` -> one item

Each item has `id`, `name`, `updatedAt`, `metrics` (`cpu`, `traffic`, `loss`,
`lat`, `sig`, `tp`), and `prediction` (null or `fault`, `confidence`,
`predictedAt`). The dashboard derives the cells-needing-review count from
`prediction.fault !== "Healthy"`.

## RAG API

`POST /rag/ask` accepts a question with optional cell/fault context and `top_k`
(1-10, default 5):

```json
{
  "question": "Why is this cell experiencing high latency and packet loss?",
  "cell_id": "CELL-1001",
  "fault": "congestion",
  "top_k": 5
}
```

The response has `question`, `answer`, `cell_id`, `fault`, `sources`, and
`status`. Sources include the actual knowledge filename, `page` (null when
unavailable), passage content, and normalized BM25 relevance. Unknown page
numbers are not fabricated. If no matching passages exist, the API returns an
explicit insufficient-evidence status. Retrieval failures are logged server
side and return a generic 503 response.

The existing `GET /rag/search?fault=CONGESTION` endpoint and its
`{ fault, knowledge }` response are retained for compatibility.

The current RAG implementation is a local BM25 retriever over the text
knowledge file. This repository contains no configured vector database,
reranker, or LLM. Accordingly, `/rag/ask` returns cited, extractive guidance
and does not claim a confirmed root cause; a configured LLM-backed answer step
can be added when its provider and credentials are supplied.

## Tests

Run backend contract and compatibility tests:

```powershell
python -m unittest discover -s tests -v
```

With the server running, open `http://127.0.0.1:8000/static/tests.html` for
browser checks of API client contracts and severity thresholds.

## Optional radio performance monitor

The separately supplied `telecom-dashboard` monitor uses
`ws://127.0.0.1:8000/ws/metrics`. Its producer posts `snr`, `nn`, `nr`, `bn`,
`br`, `mn`, and `mb`, plus optional `insight`, to `/telemetry` once per second.
This radio telemetry feed is distinct from the network-operations dashboard
above.
