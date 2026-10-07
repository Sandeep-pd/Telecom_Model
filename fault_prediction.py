import joblib
import pandas as pd
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from xgboost import XGBClassifier


MODEL_CANDIDATES = [
    Path("models/fault_model.pkl"),
    Path("fault_model.pkl"),
    Path(__file__).resolve().parent / "models" / "fault_model.pkl",
]
DATA_CANDIDATES = [
    Path("telecom_traning.csv"),
    Path("data/telecom_training.csv"),
    Path("data/telecom_traning.csv"),
    Path(__file__).resolve().parent / "telecom_traning.csv",
]


def _resolve_existing_path(candidates):
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def _train_default_model():
    data_path = _resolve_existing_path(DATA_CANDIDATES)
    if not data_path.exists():
        raise FileNotFoundError("No telecom training dataset found.")

    data = pd.read_csv(data_path)
    features = [
        "cpu",
        "traffic",
        "packet_loss",
        "latency",
        "signal_strength",
        "throughput",
    ]
    target = "fault"

    encoder = LabelEncoder()
    y_encoded = encoder.fit_transform(data[target])

    X_train, _, y_train, _ = train_test_split(
        data[features],
        y_encoded,
        test_size=0.2,
        random_state=42,
        stratify=y_encoded,
    )

    model = XGBClassifier(
        n_estimators=100,
        max_depth=4,
        learning_rate=0.1,
        random_state=42,
        eval_metric="mlogloss",
    )
    model.fit(X_train, y_train)

    model_dir = _resolve_existing_path([Path("models"), Path(__file__).resolve().parent / "models"])
    if not model_dir.exists():
        model_dir.mkdir(parents=True, exist_ok=True)

    model_path = model_dir / "fault_model.pkl"
    joblib.dump({"model": model, "encoder": encoder}, model_path)
    return {"model": model, "encoder": encoder}


def _load_model_bundle():
    model_path = _resolve_existing_path(MODEL_CANDIDATES)
    if model_path.exists():
        try:
            saved_model = joblib.load(model_path)
            return saved_model["model"], saved_model["encoder"]
        except Exception:
            pass

    trained_bundle = _train_default_model()
    return trained_bundle["model"], trained_bundle["encoder"]


model, encoder = _load_model_bundle()


def predict_fault(
    cpu,
    traffic,
    packet_loss,
    latency,
    signal_strength,
    throughput
):

    data = pd.DataFrame(
        [[
            cpu,
            traffic,
            packet_loss,
            latency,
            signal_strength,
            throughput
        ]],
        columns=[
            "cpu",
            "traffic",
            "packet_loss",
            "latency",
            "signal_strength",
            "throughput"
        ]
    )

    prediction = model.predict(data)[0]
    probabilities = model.predict_proba(data)[0]
    confidence = max(probabilities)
    fault = encoder.inverse_transform([prediction])[0]

    return {
        "fault": fault,
        "confidence": round(float(confidence), 3)
    }