import sys
import os

from typing import TypedDict

from langgraph.graph import StateGraph, START, END

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fault_prediction import predict_fault


# State of our telecom system
class TelecomState(TypedDict):

    cell_id: str

    cpu: float
    traffic: float
    packet_loss: float
    latency: float
    signal_strength: float
    throughput: float

    fault: str
    confidence: float


# ML prediction node
def ml_prediction_node(state):

    print("🤖 ML AGENT STARTED")

    result = predict_fault(
        state["cpu"],
        state["traffic"],
        state["packet_loss"],
        state["latency"],
        state["signal_strength"],
        state["throughput"]
    )

    print("✅ ML Prediction:", result)

    return {
        "fault": result["fault"],
        "confidence": result["confidence"]
    }


# Create LangGraph
builder = StateGraph(TelecomState)


# Add ML node
builder.add_node(
    "ml_prediction",
    ml_prediction_node
)


# START → ML
builder.add_edge(
    START,
    "ml_prediction"
)


# ML → END
builder.add_edge(
    "ml_prediction",
    END
)


# Compile graph
graph = builder.compile()


# Test the graph
if __name__ == "__main__":

    result = graph.invoke({

        "cell_id": "CELL-1001",

        "cpu": 92,
        "traffic": 95,
        "packet_loss": 2,
        "latency": 70,
        "signal_strength": -70,
        "throughput": 40,

        "fault": "",
        "confidence": 0
    })

    print("\n======================")
    print("FINAL RESULT")
    print("======================")

    print(result)