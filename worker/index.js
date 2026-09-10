const EXPECTED_MODEL = "SmolLM2-360M-Instruct-q4f16_1-MLC";
const EXPECTED_PROMPT = "Explain why the Moon has phases in one sentence.";

function response(body, status, origin) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function validPayload(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (data.schemaVersion !== 1 || typeof data.sessionId !== "string") return false;
  if (data.model !== EXPECTED_MODEL || data.prompt !== EXPECTED_PROMPT || data.maxTokens !== 48) return false;
  if (!Array.isArray(data.runOrder) || data.runOrder.length !== 6) return false;
  if (!Array.isArray(data.runs) || data.runs.length !== 6) return false;

  const conditions = data.runs.map(run => run?.condition);
  if (conditions.filter(value => value === "baseline").length !== 3) return false;
  if (conditions.filter(value => value === "tuned").length !== 3) return false;
  if (conditions.some((value, index) => value !== data.runOrder[index])) return false;

  return data.runs.every((run, index) =>
    run.run === index + 1 &&
    Number.isFinite(run.timeMs) && run.timeMs > 0 && run.timeMs < 600000 &&
    typeof run.response === "string" && run.response.length > 0 && run.response.length <= 2000
  );
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map(value => value.trim());

    if (!allowedOrigins.includes(origin)) {
      return response({ error: "Origin not allowed" }, 403, "null");
    }

    if (request.method === "OPTIONS") return response({}, 204, origin);
    if (request.method !== "POST" || new URL(request.url).pathname !== "/results") {
      return response({ error: "Not found" }, 404, origin);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rateLimit = await env.SUBMISSIONS.limit({ key: ip });
    if (!rateLimit.success) return response({ error: "Too many submissions" }, 429, origin);

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 100000) return response({ error: "Payload too large" }, 413, origin);

    let data;
    try {
      data = await request.json();
    } catch {
      return response({ error: "Invalid JSON" }, 400, origin);
    }

    if (!validPayload(data)) return response({ error: "Invalid experiment result" }, 400, origin);

    const airtable = await fetch(env.AIRTABLE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!airtable.ok) return response({ error: "Storage failed" }, 502, origin);
    return response({ saved: true }, 200, origin);
  },
};
