from fastapi import FastAPI
from pydantic import BaseModel

from fault_prediction import predict_fault
from app.rag import search_knowledge


app = FastAPI(
    title="TeleComAI",
    description="Telecom Network Fault Prediction API",
    version="1.0"
)


class NetworkMetrics(BaseModel):
    cell_id: str
    cpu: float
    traffic: float
    packet_loss: float
    latency: float
    signal_strength: float
    throughput: float


@app.get("/")
def home():
    return {
        "message": "Welcome to TeleComAI"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy"
    }


@app.post("/network/analyze")
def analyze_network(data: NetworkMetrics):

    result = predict_fault(
        data.cpu,
        data.traffic,
        data.packet_loss,
        data.latency,
        data.signal_strength,
        data.throughput
    )

    return {
        "cell_id": data.cell_id,
        "fault": result["fault"],
        "confidence": result["confidence"],
        "metrics": {
            "cpu": data.cpu,
            "traffic": data.traffic,
            "packet_loss": data.packet_loss,
            "latency": data.latency,
            "signal_strength": data.signal_strength,
            "throughput": data.throughput
        }
    }


# RAG endpoint
@app.get("/rag/search")
def rag_search(fault: str):

    knowledge = search_knowledge(fault)

    return {
        "fault": fault,
        "knowledge": knowledge
    }