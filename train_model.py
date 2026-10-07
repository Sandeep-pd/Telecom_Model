import pandas as pd
import joblib

from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import accuracy_score, classification_report


# --------------------------------
# 1. Load dataset
# --------------------------------

data = pd.read_csv("data/telecom_training.csv")

print("Dataset loaded")
print(data.head())


# --------------------------------
# 2. Separate features and target
# --------------------------------

X = data[
    [
        "cpu",
        "traffic",
        "packet_loss",
        "latency",
        "signal_strength",
        "throughput",
    ]
]

y = data["fault"]


# --------------------------------
# 3. Convert fault names to numbers
# --------------------------------

encoder = LabelEncoder()

y_encoded = encoder.fit_transform(y)

print("\nFault classes:")
print(encoder.classes_)


# --------------------------------
# 4. Split data
# --------------------------------

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y_encoded,
    test_size=0.2,
    random_state=42,
    stratify=y_encoded
)


# --------------------------------
# 5. Create XGBoost model
# --------------------------------

model = XGBClassifier(
    n_estimators=100,
    max_depth=4,
    learning_rate=0.1,
    random_state=42,
    eval_metric="mlogloss"
)


# --------------------------------
# 6. Train
# --------------------------------

print("\nTraining model...")

model.fit(X_train, y_train)

print("Training completed!")


# --------------------------------
# 7. Test model
# --------------------------------

predictions = model.predict(X_test)

accuracy = accuracy_score(y_test, predictions)

print("\nAccuracy:", accuracy)

print("\nClassification Report:")
print(
    classification_report(
        y_test,
        predictions,
        target_names=encoder.classes_,
        zero_division=0
    )
)


# --------------------------------
# 8. Save model + encoder
# --------------------------------

joblib.dump(
    {
        "model": model,
        "encoder": encoder
    },
    "models/fault_model.pkl"
)

print("\nModel saved successfully!")