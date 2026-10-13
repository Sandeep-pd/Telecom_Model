const metricConfig = [
  { id: "cpu", label: "CPU utilization", display: value => `${value}%`, health: value => value },
  { id: "traffic", label: "Traffic load", display: value => `${value}%`, health: value => value },
  { id: "packet-loss", label: "Packet loss", display: value => `${Number(value).toFixed(1)}%`, health: value => Number(value) * 10 },
  { id: "latency", label: "Latency", display: value => `${value} ms`, health: value => Number(value) / 3 },
  { id: "signal-strength", label: "Signal strength", display: value => `${value} dBm`, health: value => (Number(value) + 120) / 0.9 },
  { id: "throughput", label: "Throughput", display: value => `${value} Mbps`, health: value => Math.min(Number(value) / 10, 100) },
];

const form = document.querySelector("#analysis-form");
const analyzeButton = document.querySelector("#analyze-button");
const errorBox = document.querySelector("#form-error");
const metricInputs = metricConfig.map(metric => document.getElementById(metric.id));

function formatValue(id, value) {
  return id === "signal-strength" ? String(value).replace("-", "−") : String(value);
}

function updateMetricDisplays() {
  metricConfig.forEach((metric, index) => {
    const input = metricInputs[index];
    const value = input.value;
    const output = document.getElementById(`${metric.id}-value`);
    const range = Number(input.max) - Number(input.min);
    const progress = ((Number(value) - Number(input.min)) / range) * 100;
    output.textContent = formatValue(metric.id, value);
    input.style.setProperty("--range-fill", `${progress}%`);

    const health = Math.max(0, Math.min(100, metric.health(value)));
    const performanceMetric = metric.id === "signal-strength" || metric.id === "throughput";
    const tone = performanceMetric
      ? health >= 50 ? "#3fc6a5" : health >= 25 ? "#e9c76c" : "#e4a34b"
      : health >= 75 ? "#e4a34b" : health >= 50 ? "#e9c76c" : "#3fc6a5";
    const row = document.getElementById(`health-${metric.id}`);
    row.querySelector(".health-bar span").style.width = `${health}%`;
    row.querySelector(".health-bar span").style.background = tone;
    row.querySelector("output").textContent = metric.display(value);
  });
}

function renderHealthMetrics() {
  const container = document.getElementById("health-metrics");
  container.innerHTML = metricConfig.map(metric => `
    <div class="health-row" id="health-${metric.id}">
      <span>${metric.label}</span>
      <span class="health-bar" aria-hidden="true"><span></span></span>
      <output></output>
    </div>
  `).join("");
  updateMetricDisplays();
}

function setApiStatus(online, detail) {
  const label = online ? "Connected" : "Unavailable";
  document.getElementById("api-status").textContent = label;
  document.getElementById("api-note").textContent = detail;
  document.getElementById("sidebar-status").textContent = label;
  const indicator = document.getElementById("sidebar-status-indicator");
  indicator.classList.toggle("online", online);
  indicator.classList.toggle("offline", !online);
}

async function checkApiHealth() {
  try {
    const response = await fetch("/health", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Health check returned ${response.status}.`);
    const health = await response.json();
    if (health.status !== "healthy") throw new Error("The prediction service did not report a healthy status.");
    setApiStatus(true, "Ready to analyze");
  } catch (error) {
    setApiStatus(false, "Start the API to enable analysis");
  }
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = "";
  errorBox.hidden = true;
}

function setLoading(loading) {
  analyzeButton.disabled = loading;
  analyzeButton.querySelector(".button-label").textContent = loading ? "Analyzing network…" : "Analyze network";
}

function statusForPrediction(fault, confidence) {
  if (fault.toLowerCase() === "normal") return { label: "HEALTHY", className: "normal", summary: "Operating normally" };
  if (confidence >= 0.7) return { label: "ATTENTION", className: "warning", summary: "Issue detected" };
  return { label: "REVIEW", className: "check", summary: "Review recommended" };
}

async function updateRecommendation(fault) {
  const recommendation = document.getElementById("recommendation-text");
  recommendation.classList.remove("guidance-error");
  if (fault.toLowerCase() === "normal") {
    recommendation.textContent = "No immediate action required. Continue monitoring this cell.";
    return;
  }

  recommendation.textContent = "Looking up fault guidance…";
  try {
    const response = await fetch(`/rag/search?fault=${encodeURIComponent(fault)}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Guidance lookup failed (${response.status}).`);
    const result = await response.json();
    if (typeof result.knowledge !== "string") {
      throw new Error("The guidance service returned an unexpected response.");
    }
    const actions = result.knowledge.match(/(?:^|\n)Recommended actions:\s*([\s\S]*?)(?=\n\s*\n|$)/i);
    if (!actions?.[1]?.trim()) {
      throw new Error("No recommended actions were found for this fault.");
    }
    recommendation.textContent = actions[1].trim();
  } catch (error) {
    recommendation.classList.add("guidance-error");
    const detail = error instanceof Error ? ` ${error.message}` : "";
    recommendation.textContent = `Fault guidance is unavailable; the prediction is still available.${detail}`;
  }
}

function displayResult(result) {
  const fault = String(result.fault);
  const confidence = Number(result.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("The prediction service returned an invalid confidence value.");
  }

  const status = statusForPrediction(fault, confidence);
  document.getElementById("result-empty").hidden = true;
  document.getElementById("result-content").hidden = false;
  const pill = document.getElementById("result-status-pill");
  pill.className = `result-pill ${status.className}`;
  document.getElementById("result-status-label").textContent = status.label;
  document.getElementById("predicted-fault").textContent = fault.replaceAll("_", " ");
  document.getElementById("result-confidence").textContent = `${Math.round(confidence * 100)}%`;
  document.getElementById("confidence-fill").style.width = `${confidence * 100}%`;
  document.getElementById("result-cell").textContent = result.cell_id;
  document.getElementById("summary-cell").textContent = result.cell_id;
  document.getElementById("summary-status").textContent = status.summary;
  document.getElementById("summary-status-note").textContent = `Latest result: ${fault.replaceAll("_", " ")}`;
  document.getElementById("summary-confidence").firstChild.textContent = Math.round(confidence * 100);
}

async function analyzeNetwork(event) {
  event.preventDefault();
  clearError();
  if (!form.reportValidity()) return;

  const cellId = document.getElementById("cell-id").value.trim();
  if (!cellId) {
    showError("Enter a cell identifier before running an analysis.");
    document.getElementById("cell-id").focus();
    return;
  }

  const payload = { cell_id: cellId };
  metricConfig.forEach((metric, index) => {
    const apiKey = metric.id === "packet-loss" ? "packet_loss" :
      metric.id === "signal-strength" ? "signal_strength" : metric.id;
    payload[apiKey] = Number(metricInputs[index].value);
  });

  setLoading(true);
  try {
    const response = await fetch("/network/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let detail = `Analysis failed (${response.status}).`;
      try {
        const body = await response.json();
        if (typeof body.detail === "string") detail = body.detail;
      } catch {
        // Use the HTTP status when the service response is not JSON.
      }
      throw new Error(detail);
    }
    const result = await response.json();
    if (typeof result.fault !== "string" || result.cell_id !== cellId) {
      throw new Error("The prediction service returned an unexpected response.");
    }
    displayResult(result);
    await updateRecommendation(result.fault);
  } catch (error) {
    showError(error instanceof Error ? error.message : "Could not analyze this network. Please try again.");
  } finally {
    setLoading(false);
  }
}

function loadSample() {
  const sample = { cpu: 92, traffic: 95, "packet-loss": 2, latency: 70, "signal-strength": -70, throughput: 40 };
  Object.entries(sample).forEach(([id, value]) => {
    document.getElementById(id).value = value;
  });
  document.getElementById("cell-id").value = "cell-001";
  updateMetricDisplays();
  clearError();
}

document.getElementById("current-date").textContent = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
}).format(new Date());

renderHealthMetrics();
metricInputs.forEach(input => input.addEventListener("input", updateMetricDisplays));
form.addEventListener("submit", analyzeNetwork);
document.getElementById("sample-button").addEventListener("click", loadSample);
checkApiHealth();
