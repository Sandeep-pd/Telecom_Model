import { ApiClient, ApiError } from "/static/api.js";
import { METRICS, healthPercent, severity, severityLabel } from "/static/severity.js";
import { sanitizeHtmlToText } from "/static/sanitize.js";

const api = new ApiClient();
const $ = id => document.getElementById(id);
const presets = {
  healthy: { cpu: 35, traffic: 40, loss: 0.5, lat: 30, sig: -70, tp: 620 },
  congested: { cpu: 82, traffic: 94, loss: 6, lat: 240, sig: -78, tp: 90 },
  weak: { cpu: 40, traffic: 35, loss: 8, lat: 160, sig: -110, tp: 60 },
  hw: { cpu: 96, traffic: 25, loss: 3, lat: 120, sig: -72, tp: 300 },
};
const state = {
  cells: [],
  currentCell: null,
  metrics: { ...presets.healthy },
  prediction: null,
  history: [],
  cellRequest: null,
  analysisRequest: null,
  kbRequest: null,
  refreshTimer: null,
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function setApiStatus(status, text) {
  const badge = $("apiStatus");
  badge.className = `pill ${status}`;
  badge.replaceChildren(node("span", `dot ${status}`), node("span", "", text));
}

function renderSliders() {
  const container = $("sliders");
  container.replaceChildren();
  for (const metric of METRICS) {
    const wrapper = node("div", "sl");
    const label = node("label");
    label.htmlFor = `s-${metric.key}`;
    label.append(node("span", "", metric.label));
    label.append(node("b", "", `${state.metrics[metric.key]}${metric.unit}`));
    const input = node("input");
    input.type = "range";
    input.id = `s-${metric.key}`;
    input.min = metric.min;
    input.max = metric.max;
    input.step = metric.key === "loss" ? 0.5 : metric.key === "lat" ? 5 : 1;
    input.value = state.metrics[metric.key];
    input.setAttribute("aria-label", metric.label);
    input.addEventListener("input", () => {
      state.metrics[metric.key] = Number(input.value);
      label.querySelector("b").textContent = `${input.value}${metric.unit}`;
      schedulePaint();
    });
    wrapper.append(label, input);
    container.append(wrapper);
  }
  paint();
}

let paintTimer = null;
function schedulePaint() {
  clearTimeout(paintTimer);
  paintTimer = setTimeout(paint, 100);
}

function renderHealth() {
  const bars = $("bars");
  bars.replaceChildren();
  for (const metric of METRICS) {
    const row = node("div", "b");
    const track = node("div", "t");
    const fill = node("i");
    fill.dataset.metric = metric.key;
    track.append(fill);
    const label = node("span", "", metric.label);
    const value = node("span", "n");
    value.dataset.metric = metric.key;
    row.append(label, track, value);
    bars.append(row);
  }
}

function paint() {
  for (const metric of METRICS) {
    const value = state.metrics[metric.key];
    const input = $(`s-${metric.key}`);
    if (input && Number(input.value) !== value) input.value = value;
    const level = severity(metric, value);
    const barFill = $("bars").querySelector(`i[data-metric="${metric.key}"]`);
    const barValue = $("bars").querySelector(`span.n[data-metric="${metric.key}"]`);
    if (barFill) {
      barFill.style.width = `${Math.max(3, healthPercent(metric, value))}%`;
      barFill.style.background = `var(--${["ok", "warn", "bad"][level]})`;
      barFill.setAttribute("aria-label", `${severityLabel(level)} severity`);
    }
    if (barValue) barValue.textContent = `${value}${metric.unit}`;
  }
  renderAlerts();
}

function renderAlerts() {
  const alerts = METRICS
    .map(metric => ({ metric, level: severity(metric, state.metrics[metric.key]) }))
    .filter(entry => entry.level > 0)
    .sort((left, right) => right.level - left.level);
  const container = $("alerts");
  container.replaceChildren();
  if (!alerts.length) {
    container.append(node("p", "sub", "No alerts. All metrics are within the configured thresholds."));
    return;
  }
  for (const { metric, level } of alerts) {
    const row = node("div", "alert");
    row.append(node("span", `dot ${level === 2 ? "bad" : "warn"}`));
    const text = node("div");
    text.append(node("b", "", `${metric.label}: ${severityLabel(level)}`));
    text.append(node("p", "sub", `${state.metrics[metric.key]}${metric.unit} on ${state.currentCell?.id || "selected cell"}`));
    row.append(text);
    container.append(row);
  }
}

function faultLabel(fault) {
  if (/^(normal|healthy)$/i.test(fault)) return "Healthy";
  return fault.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function faultTone(fault, confidence = 1) {
  return /^(normal|healthy)$/i.test(fault) ? "ok" : confidence >= 0.7 ? "warn" : "bad";
}

function predictionStatus(prediction) {
  if (!prediction) return "No prediction";
  return faultLabel(prediction.fault);
}

function formatTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderCellSummary() {
  const cell = state.currentCell;
  $("kCell").textContent = cell?.id || "No cell selected";
  const prediction = state.prediction || cell?.prediction;
  $("kStatus").textContent = predictionStatus(prediction);
  $("kConf").textContent = prediction
    ? `${Math.round(prediction.confidence * 100)}%`
    : "—";
  $("kLast").textContent = formatTime(
    state.prediction?.predictedAt || cell?.prediction?.predictedAt,
  );
}

function renderCells() {
  const body = $("cells");
  const select = $("cellSel");
  body.replaceChildren();
  select.replaceChildren();
  if (!state.cells.length) {
    body.append(tableMessage(state.cellsError || "No cells are available.", 3));
    select.disabled = true;
    select.append(new Option("No cells available", ""));
    $("kReview").textContent = state.cellsError ? "—" : "0";
    $("cellDetailStatus").textContent = state.cellsError
      ? `Cell service error: ${state.cellsError}`
      : "No cells are available.";
    return;
  }
  select.disabled = false;
  $("cellDetailStatus").textContent = "Select a cell to load its current metrics.";
  for (const cell of state.cells) {
    const option = new Option(`${cell.id}${cell.name ? ` · ${cell.name}` : ""}`, cell.id);
    option.selected = cell.id === state.currentCell?.id;
    select.append(option);

    const row = node("tr", "cell");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Load cell ${cell.id}`);
    const name = node("td", "", cell.id);
    const status = node("td");
    const fault = cell.prediction?.fault || "No prediction";
    const pill = node("span", `pill ${cell.prediction ? faultTone(fault, cell.prediction.confidence) : "warn"}`, faultLabel(fault));
    status.append(pill);
    const load = node("td", "", `${cell.metrics.traffic}%`);
    row.append(name, status, load);
    const activate = () => loadCell(cell.id);
    row.addEventListener("click", activate);
    row.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
    body.append(row);
  }
  $("kReview").textContent = state.cells.filter(cell => cell.prediction?.fault !== "Healthy").length;
}

function tableMessage(message, columns) {
  const row = node("tr");
  const cell = node("td", "sub", message);
  cell.colSpan = columns;
  row.append(cell);
  return row;
}

async function loadCells() {
  $("cells").replaceChildren(tableMessage("Loading cells…", 3));
  try {
    const result = await api.cells();
    state.cells = result.items;
    state.cellsError = "";
    renderCells();
    if (!state.cells.length) {
      state.currentCell = null;
      renderCellSummary();
      showResultState("empty", "Select a cell before running an analysis.");
      return;
    }
    const existing = state.cells.find(cell => cell.id === state.currentCell?.id);
    await loadCell(existing?.id || state.cells[0].id);
  } catch (error) {
    state.cellsError = error.message || "Cells could not be loaded.";
    state.cells = [];
    renderCells();
    renderCellSummary();
    showResultState("error", `Cells could not be loaded: ${state.cellsError}`);
  }
}

async function loadCell(cellId) {
  if (!cellId) return;
  state.cellRequest?.abort();
  const controller = new AbortController();
  state.cellRequest = controller;
  $("cellSel").value = cellId;
  $("cellDetailStatus").textContent = `Loading ${cellId}…`;
  $("cells").setAttribute("aria-busy", "true");
  try {
    const cell = await api.cell(cellId, state.cells, { signal: controller.signal });
    if (controller.signal.aborted) return;
    state.currentCell = cell;
    $("cellDetailStatus").textContent = `Loaded latest data for ${cell.id}.`;
    state.prediction = null;
    state.metrics = { ...cell.metrics };
    renderSliders();
    renderCellSummary();
    renderCells();
    suggest(faultLabel(cell.prediction?.fault || ""));
    showResultState("empty", "Run an analysis to see the predicted fault, confidence and next step.");
  } catch (error) {
    if (error.name === "AbortError") return;
    $("cellDetailStatus").textContent = `Could not load ${cellId}: ${error.message}`;
    $("cells").replaceChildren(tableMessage(`Could not load ${cellId}: ${error.message}`, 3));
    setApiStatus("bad", "Cell details unavailable");
  } finally {
    if (state.cellRequest === controller) $("cells").removeAttribute("aria-busy");
  }
}

function updateCellAfterAnalysis(result, metrics) {
  const prediction = {
    fault: /^(normal|healthy)$/i.test(result.fault) ? "Healthy" : result.fault,
    confidence: result.confidence,
    predictedAt: new Date().toISOString(),
  };
  const existingIndex = state.cells.findIndex(cell => cell.id === result.cell_id);
  const current = {
    ...(state.cells[existingIndex] || { id: result.cell_id, name: result.cell_id, updatedAt: prediction.predictedAt }),
    metrics,
    prediction,
  };
  if (existingIndex < 0) state.cells.unshift(current);
  else state.cells[existingIndex] = current;
  state.currentCell = current;
  renderCells();
}

function showResultState(kind, message = "") {
  const result = $("result");
  result.setAttribute("aria-busy", kind === "loading" ? "true" : "false");
  result.replaceChildren();
  const pill = $("rPill");
  pill.className = `pill ${kind === "result" ? "ok" : kind === "error" ? "bad" : "warn"}`;
  pill.textContent = ({
    empty: "Waiting",
    loading: "Analyzing…",
    error: "Error",
    result: "Complete",
  })[kind];
  if (kind === "empty") {
    result.append(node("div", "empty", message || "Run an analysis to see the predicted fault, confidence and next step."));
    return;
  }
  if (kind === "loading") {
    result.append(node("div", "empty", "Contacting the prediction service…"));
    return;
  }
  if (kind === "error") {
    result.append(node("div", "empty error-state", message));
    return;
  }
}

function renderPrediction(result) {
  showResultState("result");
  const host = $("result");
  host.append(node("p", "sub", `Predicted condition for ${result.cell_id}`));
  host.append(node("div", "fault", faultLabel(result.fault)));
  const confidenceRow = node("div", "row confidence-line");
  confidenceRow.append(node("span", "", "Model confidence"));
  confidenceRow.append(node("b", "", `${Math.round(result.confidence * 100)}%`));
  host.append(confidenceRow);
  const meter = node("div", "meter");
  const fill = node("i");
  fill.style.width = `${result.confidence * 100}%`;
  meter.append(fill);
  host.append(meter);
  const next = node("div", "next");
  next.append(node("b", "", "Suggested next step"));
  next.append(document.createElement("br"), document.createTextNode(result.next_step));
  host.append(next);

  const alternatives = node("ul", "why");
  alternatives.append(node("li", "", "Other likelihoods"));
  for (const alternative of result.alternatives) {
    if (!alternative || typeof alternative.fault !== "string" ||
        !Number.isFinite(alternative.confidence)) continue;
    const item = node("li");
    item.append(node("span", "", faultLabel(alternative.fault)));
    item.append(node("span", "", `${Math.round(alternative.confidence * 100)}%`));
    alternatives.append(item);
  }
  host.append(alternatives);
}

function predictionPayload() {
  return {
    cell_id: $("cellSel").value.trim(),
    cpu: state.metrics.cpu,
    traffic: state.metrics.traffic,
    packet_loss: state.metrics.loss,
    latency: state.metrics.lat,
    signal_strength: state.metrics.sig,
    throughput: state.metrics.tp,
  };
}

async function analyzeNetwork() {
  if (!state.currentCell || !$("cellSel").value) {
    showResultState("error", "Select a cell before running an analysis.");
    return;
  }
  state.analysisRequest?.abort();
  const controller = new AbortController();
  state.analysisRequest = controller;
  $("run").disabled = true;
  $("run").textContent = "Analyzing network…";
  showResultState("loading");
  try {
    const payload = predictionPayload();
    const result = await api.analyze(payload, { signal: controller.signal });
    if (controller.signal.aborted) return;
    if (result.cell_id && result.cell_id !== payload.cell_id) {
      throw new ApiError("The prediction API returned a result for a different cell.");
    }
    result.cell_id = payload.cell_id;
    state.prediction = { ...result, predictedAt: new Date().toISOString() };
    updateCellAfterAnalysis(result, state.metrics);
    renderPrediction(result);
    renderCellSummary();
    state.history.unshift({
      cell: result.cell_id,
      fault: faultLabel(result.fault),
      confidence: result.confidence,
      latency: state.metrics.lat,
      time: formatTime(new Date().toISOString()),
    });
    state.history = state.history.slice(0, 12);
    drawHistory();
    suggest(faultLabel(result.fault));
  } catch (error) {
    if (error.name !== "AbortError") showResultState("error", error.message || "Analysis failed. Please try again.");
  } finally {
    if (state.analysisRequest === controller) {
      $("run").disabled = false;
      $("run").textContent = "Analyse network";
    }
  }
}

function drawHistory() {
  const list = $("hist");
  list.replaceChildren();
  if (!state.history.length) list.append(node("li", "", "No analyses yet."));
  for (const entry of state.history) {
    const item = node("li");
    const label = node("span");
    label.append(document.createTextNode(`${entry.cell} · ${entry.fault}`));
    label.append(node("small", "", entry.time));
    item.append(label, node("b", "", `${Math.round(entry.confidence * 100)}%`));
    list.append(item);
  }
  const points = state.history.slice().reverse();
  const svg = $("spark");
  svg.replaceChildren();
  if (points.length < 2) {
    $("sparkNote").textContent = points.length ? "Run one more analysis to see a trend." : "No data yet.";
    return;
  }
  const maxLatency = Math.max(...points.map(point => point.latency), 1);
  const coordinates = points.map((point, index) => {
    const x = index / (points.length - 1) * 296 + 2;
    const y = 84 - point.latency / maxLatency * 76;
    return `${x},${y}`;
  }).join(" ");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "var(--brand)");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("vector-effect", "non-scaling-stroke");
  line.setAttribute("points", coordinates);
  svg.append(line);
  $("sparkNote").textContent = `Latest ${points.at(-1).latency} ms · peak ${maxLatency} ms`;
}

function renderSources(sources) {
  const host = $("srcs");
  host.replaceChildren();
  if (!sources.length) {
    host.append(node("p", "sub", "No sources were retrieved."));
    return;
  }
  sources.forEach((source, index) => {
    const card = node("article", "src");
    const header = node("div", "row");
    const title = source.document || source.title || "Source";
    header.append(node("b", "", `${index + 1}. ${title}`));
    header.append(node("span", "sub", source.page == null ? "Page not supplied" : `Page ${source.page}`));
    card.append(header);
    card.append(node("p", "", source.content || source.snippet || ""));
    if (Number.isFinite(source.relevance_score ?? source.score)) {
      const value = source.relevance_score ?? source.score;
      const percent = value <= 1 ? value * 100 : value;
      const track = node("div", "rel");
      const fill = node("i");
      fill.style.width = `${clamp(percent, 0, 100)}%`;
      track.append(fill);
      card.append(track);
      card.append(node("small", "sub", `Relevance ${Math.round(percent)}%`));
    } else {
      card.append(node("small", "sub", "Relevance score unavailable"));
    }
    host.append(card);
  });
}

async function askKnowledge(question = $("q").value) {
  const query = question.trim();
  if (!query) {
    $("ans").textContent = "Enter a question to search the knowledge base.";
    $("q").focus();
    return;
  }
  state.kbRequest?.abort();
  const controller = new AbortController();
  state.kbRequest = controller;
  $("q").value = query;
  $("ask").disabled = true;
  $("ask").textContent = "Searching…";
  $("ans").textContent = "Searching the indexed knowledge base…";
  $("srcs").textContent = "Retrieving sources…";
  try {
    const result = await api.ask(query, {
      cellId: state.currentCell?.id,
      fault: state.prediction?.fault || state.currentCell?.prediction?.fault,
    }, { signal: controller.signal });
    if (controller.signal.aborted) return;
    $("ans").textContent = sanitizeHtmlToText(result.answer) ||
      "The knowledge base returned an empty answer.";
    renderSources(result.sources);
  } catch (error) {
    if (error.name !== "AbortError") {
      $("ans").textContent = `The knowledge assistant could not answer: ${error.message || "Please try again."}`;
      $("srcs").textContent = "Sources are unavailable because the request failed.";
    }
  } finally {
    if (state.kbRequest === controller) {
      $("ask").disabled = false;
      $("ask").textContent = "Ask";
    }
  }
}

function suggest(fault) {
  const own = fault && fault !== "Healthy"
    ? [`How do I resolve ${fault.toLowerCase()}?`]
    : ["How do I improve network reliability?"];
  const suggestions = [...own, "What are the latency and packet loss thresholds?", "How do I tune handover parameters?"];
  const host = $("sugg");
  host.replaceChildren();
  for (const question of suggestions) {
    const button = node("button", "chip", question);
    button.type = "button";
    button.addEventListener("click", () => askKnowledge(question));
    host.append(button);
  }
}

async function checkServices() {
  try {
    await api.health();
    setApiStatus("ok", "Prediction API connected");
  } catch (error) {
    setApiStatus("bad", error.message || "Prediction API unavailable");
  }
  try {
    const status = await api.ragStatus();
    $("kbStat").className = `pill ${status.status === "ready" ? "ok" : "warn"}`;
    $("kbStat").textContent = status.status === "ready"
      ? `${status.documents_indexed} passages indexed · ${status.retrieval}`
      : "Knowledge index unavailable";
  } catch (error) {
    $("kbStat").className = "pill bad";
    $("kbStat").textContent = `Knowledge index error: ${error.message}`;
  }
}

for (const button of document.querySelectorAll(".chip[data-p]")) {
  button.addEventListener("click", () => {
    state.metrics = { ...presets[button.dataset.p] };
    renderSliders();
  });
}
$("cellSel").addEventListener("change", event => loadCell(event.target.value));
$("run").addEventListener("click", analyzeNetwork);
$("ask").addEventListener("click", () => askKnowledge());
$("q").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    askKnowledge();
  }
});
$("clear").addEventListener("click", () => {
  state.history = [];
  drawHistory();
});
$("auto").addEventListener("click", event => {
  const enabled = state.refreshTimer === null;
  if (enabled) {
    state.refreshTimer = setInterval(analyzeNetwork, 15000);
    analyzeNetwork();
  } else {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
  event.currentTarget.textContent = `Auto-refresh: ${enabled ? "every 15s" : "off"}`;
  event.currentTarget.setAttribute("aria-pressed", String(enabled));
});
$("today").textContent = new Intl.DateTimeFormat(undefined, {
  weekday: "long", month: "long", day: "numeric", year: "numeric",
}).format(new Date());
renderHealth();
renderSliders();
drawHistory();
suggest("");
checkServices();
loadCells();
