# TeleComAI

TeleComAI is a FastAPI service for predicting telecom network faults from network metrics and retrieving guidance for recognized faults.

## Requirements

- Windows with Python installed
- The project dependencies listed in `requirements.txt`
- The project data files in `data/`

Run commands from the project root (`F:\Telecom_Model`). The API loads its model and knowledge data using project-relative paths.

## Setup

Open PowerShell in the project root and create/activate a virtual environment:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks script activation, either allow activation for the current user or run the environment's Python directly as shown below.

Install the dependencies:

```powershell
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

## Run the API

From the project root, start the development server:

```powershell
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

If you did not activate the virtual environment, use its Python executable:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Keep this terminal open while making requests. The API is available at `http://127.0.0.1:8000`. Interactive API documentation is at `http://127.0.0.1:8000/docs`.

## Test with Postman

Create requests in Postman using the URLs below. For POST requests, select **Body > raw > JSON** and set the content type to `application/json`.

### Health check

- Method: `GET`
- URL: `http://127.0.0.1:8000/health`
- Expected response:

```json
{
  "status": "healthy"
}
```

### Welcome route

- Method: `GET`
- URL: `http://127.0.0.1:8000/`

### Analyze network metrics

- Method: `POST`
- URL: `http://127.0.0.1:8000/network/analyze`
- Body:

```json
{
  "cell_id": "cell-001",
  "cpu": 92,
  "traffic": 95,
  "packet_loss": 2,
  "latency": 70,
  "signal_strength": -70,
  "throughput": 40
}
```

All six metrics and `cell_id` are required. The metric values must be numbers; `cell_id` must be a string. A successful response contains the cell ID, predicted fault, confidence, and the submitted metrics, for example:

```json
{
  "cell_id": "cell-001",
  "fault": "CONGESTION",
  "confidence": 0.91,
  "metrics": {
    "cpu": 92.0,
    "traffic": 95.0,
    "packet_loss": 2.0,
    "latency": 70.0,
    "signal_strength": -70.0,
    "throughput": 40.0
  }
}
```

The prediction and confidence depend on the loaded model and submitted metrics.

### Search telecom fault knowledge

- Method: `GET`
- URL: `http://127.0.0.1:8000/rag/search`
- In Postman's **Params** tab, add:
  - Key: `fault`
  - Value: `CONGESTION`

Alternatively, send the URL directly as `http://127.0.0.1:8000/rag/search?fault=CONGESTION`.

The response includes the submitted fault and matching guidance:

```json
{
  "fault": "CONGESTION",
  "knowledge": "CONGESTION\n\nPossible causes: ..."
}
```

The knowledge file currently contains these categories: `CONGESTION`, `HIGH CPU`, `HIGH LATENCY`, `PACKET LOSS`, and `LOW THROUGHPUT`. For a category containing spaces, send it as the query parameter value with spaces or underscores, for example `HIGH_LATENCY`.

## Troubleshooting

- **`ModuleNotFoundError` for a dependency:** Activate `.venv` and run `python -m pip install -r requirements.txt`.
- **`ModuleNotFoundError: No module named 'rag'`:** Start the app from the project root with `main:app`. The RAG module is imported as `app.rag`.
- **Port 8000 is already in use:** Choose another port in the Uvicorn command, such as `--port 8001`, and update the Postman URLs accordingly.
- **Postman returns `422 Unprocessable Entity`:** Check that the request uses the correct HTTP method and URL, that the POST body is valid JSON, and that all required fields have the correct types.
