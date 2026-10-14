export const METRICS = [
  { key: "cpu", label: "CPU utilization", unit: "%", min: 0, max: 100, bad: [70, 90] },
  { key: "traffic", label: "Traffic load", unit: "%", min: 0, max: 100, bad: [70, 90] },
  { key: "loss", label: "Packet loss", unit: "%", min: 0, max: 20, bad: [2, 5] },
  { key: "lat", label: "Latency", unit: " ms", min: 0, max: 500, bad: [100, 200] },
  { key: "sig", label: "Signal strength", unit: " dBm", min: -120, max: -40, bad: [-95, -105], inverse: true },
  { key: "tp", label: "Throughput", unit: " Mbps", min: 0, max: 1000, bad: [200, 80], inverse: true },
];

export function severity(metric, value) {
  if (!Number.isFinite(value)) throw new TypeError("Metric severity requires a finite value.");
  const [warning, critical] = metric.bad;
  if (metric.inverse) return value <= critical ? 2 : value <= warning ? 1 : 0;
  return value >= critical ? 2 : value >= warning ? 1 : 0;
}

export function healthPercent(metric, value) {
  const span = metric.max - metric.min;
  const position = (value - metric.min) / span;
  return Math.max(0, Math.min(100, Math.round(position * 100)));
}

export function severityLabel(level) {
  return ["normal", "elevated", "critical"][level];
}
