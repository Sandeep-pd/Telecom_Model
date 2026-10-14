/**
 * @typedef {{cpu:number, traffic:number, loss:number, lat:number, sig:number, tp:number}} CellMetrics
 * @typedef {{fault:string, confidence:number, predictedAt:string}|null} CellPrediction
 * @typedef {{id:string, name:string, updatedAt:string, metrics:CellMetrics, prediction:CellPrediction}} CellItem
 * @typedef {{items:CellItem[], nextCursor:string|null, total:number}} CellsPage
 * @typedef {{cell_id:string, cpu:number, traffic:number, packet_loss:number, latency:number, signal_strength:number, throughput:number}} AnalysisRequest
 * @typedef {{cell_id:string, fault:string, confidence:number, next_step:string, alternatives:Array<{fault:string, confidence:number}>}} AnalysisResponse
 * @typedef {{document:string, page:number|null, content:string, relevance_score:number|null}} RagSource
 * @typedef {{answer:string, sources:RagSource[], status:string}} RagAnswer
 */

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateCell(item) {
  const metricKeys = ["cpu", "traffic", "loss", "lat", "sig", "tp"];
  if (!isObject(item) || typeof item.id !== "string" || !item.id ||
      typeof item.name !== "string" || typeof item.updatedAt !== "string" ||
      !Object.hasOwn(item, "prediction") ||
      !isObject(item.metrics) || !metricKeys.every(key => Number.isFinite(item.metrics[key])) ||
      (item.prediction !== null && (!isObject(item.prediction) ||
        typeof item.prediction.fault !== "string" ||
        !Number.isFinite(item.prediction.confidence) ||
        item.prediction.confidence < 0 || item.prediction.confidence > 1 ||
        typeof item.prediction.predictedAt !== "string"))) {
    throw new ApiError("The cells service returned an invalid cell record.");
  }
  return item;
}

export class ApiClient {
  constructor(config = globalThis.TELCOAI_CONFIG, fetchImpl = globalThis.fetch.bind(globalThis)) {
    if (!isObject(config) || typeof config.apiBaseUrl !== "string") {
      throw new ApiError("API configuration is missing. Check the /api-config.js endpoint.");
    }
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  url(endpoint) {
    return new URL(endpoint, this.config.apiBaseUrl || globalThis.location.origin).toString();
  }

  async request(endpoint, options = {}) {
    let response;
    try {
      response = await this.fetchImpl(this.url(endpoint), {
        ...options,
        headers: { Accept: "application/json", ...options.headers },
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new ApiError("The API could not be reached.");
    }
    if (!response.ok) {
      let message = `Request failed (${response.status}).`;
      try {
        const payload = await response.json();
        if (typeof payload.detail === "string") message = payload.detail;
      } catch {
        // Keep the status-based message for non-JSON server errors.
      }
      throw new ApiError(message, response.status);
    }
    try {
      return await response.json();
    } catch {
      throw new ApiError("The API returned invalid JSON.", response.status);
    }
  }

  async health(options = {}) {
    const result = await this.request(this.config.healthEndpoint, options);
    if (result.status !== "healthy") throw new ApiError("The prediction service is not healthy.");
    return result;
  }

  /** @returns {Promise<CellsPage>} */
  async cells(options = {}) {
    const endpoint = this.config.useMockCells
      ? this.config.mockCellsEndpoint
      : this.config.cellsEndpoint;
    const result = await this.request(endpoint, options);
    if (!isObject(result) || !Array.isArray(result.items) ||
        !Number.isFinite(result.total) ||
        !(result.nextCursor === null || typeof result.nextCursor === "string")) {
      throw new ApiError("The cells service returned an invalid response.");
    }
    return { ...result, items: result.items.map(validateCell) };
  }

  async cell(cellId, knownItems = [], options = {}) {
    if (this.config.useMockCells) {
      const cell = knownItems.find(item => item.id === cellId);
      if (!cell) throw new ApiError(`Cell ${cellId} was not found in the configured mock data.`, 404);
      return validateCell(cell);
    }
    const endpoint = this.config.cellsEndpoint.replace(/\/$/, "") +
      `/${encodeURIComponent(cellId)}`;
    return validateCell(await this.request(endpoint, options));
  }

  /** @param {AnalysisRequest} payload @returns {Promise<AnalysisResponse>} */
  async analyze(payload, options = {}) {
    const result = await this.request(this.config.predictionEndpoint, {
      ...options,
      method: "POST",
      headers: { "Content-Type": "application/json", ...options.headers },
      body: JSON.stringify(payload),
    });
    if (!isObject(result) || typeof result.cell_id !== "string" ||
        typeof result.fault !== "string" ||
        !Number.isFinite(result.confidence) || result.confidence < 0 ||
        result.confidence > 1 || typeof result.next_step !== "string" ||
        !Array.isArray(result.alternatives) ||
        !result.alternatives.every(item => isObject(item) &&
          typeof item.fault === "string" && Number.isFinite(item.confidence) &&
          item.confidence >= 0 && item.confidence <= 1)) {
      throw new ApiError("The prediction API returned an invalid response.");
    }
    return result;
  }

  /** @param {string} question @param {{cellId?:string, fault?:string}} context @returns {Promise<RagAnswer>} */
  async ask(question, context, options = {}) {
    const result = await this.request(this.config.ragAskEndpoint, {
      ...options,
      method: "POST",
      headers: { "Content-Type": "application/json", ...options.headers },
      body: JSON.stringify({
        question,
        cell_id: context.cellId || undefined,
        fault: context.fault || undefined,
        top_k: 5,
      }),
    });
    if (!isObject(result) || typeof result.answer !== "string" ||
        !Array.isArray(result.sources) || typeof result.status !== "string" ||
        !result.sources.every(source => isObject(source) &&
          typeof source.document === "string" && typeof source.content === "string" &&
          (source.page === null || Number.isInteger(source.page)) &&
          (source.relevance_score === null || Number.isFinite(source.relevance_score)))) {
      throw new ApiError("The knowledge assistant returned an invalid response.");
    }
    return result;
  }

  async ragStatus(options = {}) {
    const result = await this.request(this.config.ragStatusEndpoint, options);
    if (!isObject(result) || typeof result.status !== "string" ||
        !Number.isFinite(result.documents_indexed)) {
      throw new ApiError("The knowledge index returned an invalid status.");
    }
    return result;
  }
}
