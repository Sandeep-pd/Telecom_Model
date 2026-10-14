from pathlib import Path
import asyncio
import json
import logging
import os
import time

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from fault_prediction import predict_fault
from decision_agent import make_recommendation
from app.rag import knowledge_base_status, retrieve_knowledge, search_knowledge


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
logger = logging.getLogger(__name__)

app = FastAPI(
    title="TeleComAI",
    description="Telecom Network Fault Prediction API",
    version="1.0"
)
allowed_origins = [
    origin.strip()
    for origin in os.environ.get("TELCOAI_CORS_ORIGINS", "").split(",")
    if origin.strip()
]
if allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Accept", "Content-Type"],
    )
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

latest_telemetry = None
latest_telemetry_at = None
telemetry_version = 0
telemetry_lock = asyncio.Lock()


class NetworkMetrics(BaseModel):
    cell_id: str
    cpu: float
    traffic: float
    packet_loss: float
    latency: float
    signal_strength: float
    throughput: float


class AgentTelemetry(BaseModel):
    snr: float
    nn: float
    nr: float
    bn: float
    br: float
    mn: int
    mb: int
    insight: str | None = None


class AnalysisAlternative(BaseModel):
    fault: str
    confidence: float


class AnalysisResponse(BaseModel):
    cell_id: str
    fault: str
    confidence: float
    next_step: str
    alternatives: list[AnalysisAlternative]
    metrics: dict[str, float]


class RagAskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    cell_id: str | None = Field(default=None, max_length=64)
    fault: str | None = Field(default=None, max_length=100)
    top_k: int = Field(default=5, ge=1, le=10)


class RagSource(BaseModel):
    document: str
    page: int | None = None
    content: str
    relevance_score: float | None = None


class RagAskResponse(BaseModel):
    question: str
    answer: str
    cell_id: str | None
    fault: str | None
    sources: list[RagSource]
    status: str


def _frontend_config() -> dict[str, str | bool]:
    return {
        "apiBaseUrl": os.environ.get("TELCOAI_API_BASE_URL", ""),
        "healthEndpoint": os.environ.get("TELCOAI_HEALTH_ENDPOINT", "/health"),
        "predictionEndpoint": os.environ.get(
            "TELCOAI_PREDICTION_ENDPOINT", "/network/analyze"
        ),
        "cellsEndpoint": os.environ.get(
            "TELCOAI_CELLS_ENDPOINT", "/api/v1/cells"
        ),
        "ragAskEndpoint": os.environ.get("TELCOAI_RAG_ASK_ENDPOINT", "/rag/ask"),
        "ragStatusEndpoint": os.environ.get(
            "TELCOAI_RAG_STATUS_ENDPOINT", "/rag/status"
        ),
        "mockCellsEndpoint": os.environ.get(
            "TELCOAI_MOCK_CELLS_ENDPOINT", "/static/mock-data/cells.json"
        ),
        "useMockCells": os.environ.get("TELCOAI_USE_MOCK_CELLS", "true").lower()
        in {"1", "true", "yes", "on"},
    }


@app.get("/")
def home():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api-config.js", response_class=PlainTextResponse)
def api_config():
    config = json.dumps(_frontend_config())
    return PlainTextResponse(
        f"window.TELCOAI_CONFIG = Object.freeze({config});",
        media_type="application/javascript",
    )


@app.get("/health")
def health():
    return {
        "status": "healthy"
    }


@app.post("/telemetry")
async def ingest_telemetry(data: AgentTelemetry):
    global latest_telemetry, latest_telemetry_at, telemetry_version
    async with telemetry_lock:
        latest_telemetry = {
            "snr": data.snr,
            "nn": data.nn,
            "nr": data.nr,
            "bn": data.bn,
            "br": data.br,
            "mn": data.mn,
            "mb": data.mb,
            "insight": data.insight,
        }
        latest_telemetry_at = time.monotonic()
        telemetry_version += 1
    return {"status": "accepted"}


@app.websocket("/ws/metrics")
async def metrics_stream(websocket: WebSocket):
    await websocket.accept()
    connected_at = time.monotonic()
    sent_version = 0
    try:
        while True:
            await asyncio.sleep(1)
            async with telemetry_lock:
                metrics = latest_telemetry.copy() if latest_telemetry is not None else None
                received_at = latest_telemetry_at
                version = telemetry_version
            now = time.monotonic()
            if metrics is None:
                if now - connected_at > 3:
                    await websocket.close(code=1013, reason="Telemetry source inactive")
                    return
                continue
            assert received_at is not None
            if now - received_at > 3:
                await websocket.close(code=1013, reason="Telemetry source inactive")
                return
            if version == sent_version:
                metrics["insight"] = None
            else:
                sent_version = version
            await websocket.send_json(metrics)
    except WebSocketDisconnect:
        pass


@app.post("/network/analyze")
def analyze_network(data: NetworkMetrics) -> AnalysisResponse:

    result = predict_fault(
        data.cpu,
        data.traffic,
        data.packet_loss,
        data.latency,
        data.signal_strength,
        data.throughput
    )

    return AnalysisResponse(
        cell_id=data.cell_id,
        fault=result["fault"],
        confidence=result["confidence"],
        next_step=make_recommendation(result["fault"]),
        alternatives=result["alternatives"],
        metrics={
            "cpu": data.cpu,
            "traffic": data.traffic,
            "packet_loss": data.packet_loss,
            "latency": data.latency,
            "signal_strength": data.signal_strength,
            "throughput": data.throughput
        },
    )


@app.get("/rag/status")
def rag_status():
    try:
        return knowledge_base_status()
    except (OSError, ValueError, RuntimeError) as exc:
        logger.exception("Knowledge index status check failed")
        raise HTTPException(
            status_code=503,
            detail="The knowledge index is currently unavailable.",
        ) from exc


@app.post("/rag/ask", response_model=RagAskResponse)
def rag_ask(data: RagAskRequest) -> RagAskResponse:
    question = data.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="Question must not be blank.")

    query = " ".join(value for value in (data.fault, question) if value)
    try:
        results = retrieve_knowledge(query, top_k=data.top_k, fault=data.fault)
    except (OSError, ValueError, RuntimeError) as exc:
        logger.exception("Knowledge retrieval failed")
        raise HTTPException(
            status_code=503,
            detail="Knowledge retrieval is temporarily unavailable.",
        ) from exc

    sources = [
        RagSource(
            document=str(document.metadata.get("document", "Unknown document")),
            page=None,
            content=document.page_content,
            relevance_score=score,
        )
        for document, score in results
    ]
    if not sources:
        return RagAskResponse(
            question=question,
            answer="The knowledge base does not contain sufficient evidence to answer this question.",
            cell_id=data.cell_id,
            fault=data.fault,
            sources=[],
            status="insufficient_evidence",
        )

    cited_passages = "\n\n".join(
        f"[{index}] {source.content}"
        for index, source in enumerate(sources, start=1)
    )
    return RagAskResponse(
        question=question,
        answer=(
            "The indexed knowledge base provides the following relevant guidance. "
            "It does not confirm a root cause:\n\n"
            f"{cited_passages}"
        ),
        cell_id=data.cell_id,
        fault=data.fault,
        sources=sources,
        status="success",
    )


# RAG endpoint
@app.get("/rag/search")
def rag_search(fault: str):

    knowledge = search_knowledge(fault)

    return {
        "fault": fault,
        "knowledge": knowledge
    }