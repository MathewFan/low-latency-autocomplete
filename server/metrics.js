// Fixed labels only: never retain search text, client IDs, IPs, or unbounded series.
const buckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5];
export class Metrics {
  requests = { success: 0, invalid: 0, failure: 0 };
  cache = { hit: 0, miss: 0, coalesced: 0 };
  backend = { prefix: 0, fuzzy: 0 };
  overload = 0;
  backendErrors = 0;
  inflight = 0;
  cacheEntries = 0;
  count = 0;
  sum = 0;
  histogram = buckets.map(() => 0);
  observeRequest(status, seconds) {
    this.requests[
      status < 400 ? "success" : status < 500 ? "invalid" : "failure"
    ]++;
    this.count++;
    this.sum += seconds;
    for (let i = 0; i < buckets.length; i++)
      if (seconds <= buckets[i]) this.histogram[i]++;
  }
  render() {
    const lines = [];
    const header = (name, type, help) =>
      lines.push(
        `# HELP autocomplete_${name} ${help}`,
        `# TYPE autocomplete_${name} ${type}`,
      );
    const counter = (name, label, values, help) => {
      header(name, "counter", help);
      for (const [value, total] of Object.entries(values))
        lines.push(`autocomplete_${name}{${label}="${value}"} ${total}`);
    };
    counter(
      "requests_total",
      "outcome",
      this.requests,
      "Suggestion HTTP requests by outcome.",
    );
    counter("cache_total", "result", this.cache, "Search cache decisions.");
    counter(
      "backend_total",
      "operation",
      this.backend,
      "Repository retrieval calls, not MongoDB wire commands.",
    );
    for (const [name, total, help, type] of [
      [
        "overload_total",
        this.overload,
        "Rejected distinct searches at capacity.",
        "counter",
      ],
      [
        "backend_errors_total",
        this.backendErrors,
        "Failed retrieval or ranking operations.",
        "counter",
      ],
      [
        "inflight",
        this.inflight,
        "Distinct searches currently in flight.",
        "gauge",
      ],
      [
        "cache_entries",
        this.cacheEntries,
        "Resident cache entries including expired entries not yet accessed.",
        "gauge",
      ],
    ]) {
      header(name, type, help);
      lines.push(`autocomplete_${name} ${total}`);
    }
    header(
      "http_duration_seconds",
      "histogram",
      "Server handling duration of suggestion requests.",
    );
    buckets.forEach((bound, i) =>
      lines.push(
        `autocomplete_http_duration_seconds_bucket{le="${bound}"} ${this.histogram[i]}`,
      ),
    );
    lines.push(
      `autocomplete_http_duration_seconds_bucket{le="+Inf"} ${this.count}`,
      `autocomplete_http_duration_seconds_sum ${this.sum}`,
      `autocomplete_http_duration_seconds_count ${this.count}`,
    );
    return lines.join("\n") + "\n";
  }
}
