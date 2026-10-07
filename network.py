from fastapi import APIRouter

try:
    from app.ml.fault_prediction import predict_fault
    from app.agents.diagnosis_agent import diagnose_network
    from app.agents.decision_agent import make_recommendation
    from app.rag.retriever import search_knowledge
except ModuleNotFoundError:
    from fault_prediction import predict_fault
    from diagnosis_agent import diagnose_network
    from decision_agent import make_recommendation
    from retriever import search_knowledge


router = APIRouter()


@router.post("/network/analyze")
def analyze_network(data: dict):

    # -----------------------------
    # 1. Get network values
    # -----------------------------

    cell_id = data["cell_id"]

    cpu = data["cpu"]
    traffic = data["traffic"]
    packet_loss = data["packet_loss"]
    latency = data["latency"]
    signal_strength = data["signal_strength"]
    throughput = data["throughput"]

    # -----------------------------
    # 2. ML prediction
    # -----------------------------

    prediction = predict_fault(
        cpu,
        traffic,
        packet_loss,
        latency,
        signal_strength,
        throughput
    )

    fault = prediction["fault"]
    confidence = prediction["confidence"]

    # -----------------------------
    # 3. Diagnosis
    # -----------------------------

    diagnosis = diagnose_network(
        fault,
        cpu,
        traffic,
        packet_loss,
        latency
    )

    # -----------------------------
    # 4. RAG
    # -----------------------------

    knowledge = search_knowledge(fault)

    # -----------------------------
    # 5. Recommendation
    # -----------------------------

    recommendation = make_recommendation(fault)

    # -----------------------------
    # 6. Status
    # -----------------------------

    if fault == "normal":
        status = "NORMAL"
    elif confidence >= 0.70:
        status = "WARNING"
    else:
        status = "CHECK"

    # -----------------------------
    # 7. Return result
    # -----------------------------

    return {
        "cell_id": cell_id,
        "status": status,
        "prediction": {
            "fault": fault,
            "confidence": confidence
        },
        "diagnosis": diagnosis,
        "knowledge": knowledge,
        "recommendation": recommendation
    }