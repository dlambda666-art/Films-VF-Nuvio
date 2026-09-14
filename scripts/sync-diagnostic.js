const BASE = "https://doublagevf.fr";

const candidates = [
  "/api/works/browse?skip=0&limit=50",
  "/api/works/browse?page=1&limit=50",
  "/api/search/universal?q=Predator",
  "/api/works?search=Predator",
  "/api/search?q=Predator"
];

async function test(path) {
  const url = `${BASE}${path}`;
  const started = Date.now();

  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Films-VF-Nuvio diagnostic"
      }
    });

    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();

    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}

    const result = {
      url,
      status: response.status,
      content_type: contentType,
      length: text.length,
      duration_ms: Date.now() - started,
      is_json: !!json,
      json_type: json === null ? null : Array.isArray(json) ? "array" : typeof json,
      top_level_keys:
        json && typeof json === "object" && !Array.isArray(json)
          ? Object.keys(json).slice(0, 40)
          : [],
      array_lengths:
        json && typeof json === "object"
          ? Object.fromEntries(
              Object.entries(json)
                .filter(([, value]) => Array.isArray(value))
                .map(([key, value]) => [key, value.length])
            )
          : {},
      preview: text.slice(0, 1200)
    };

    if (Array.isArray(json)) {
      result.first_item_keys =
        json[0] && typeof json[0] === "object" ? Object.keys(json[0]).slice(0, 40) : [];
      result.first_items = json.slice(0, 3);
    } else if (json && typeof json === "object") {
      for (const key of Object.keys(json)) {
        if (Array.isArray(json[key]) && json[key][0] && typeof json[key][0] === "object") {
          result.first_item_keys = Object.keys(json[key][0]).slice(0, 40);
          result.first_items = json[key].slice(0, 3);
          break;
        }
      }
    }

    console.log(
      `${response.status} ${contentType} ${text.length} bytes — ${path}`
    );

    return result;
  } catch (error) {
    const result = {
      url,
      status: null,
      content_type: "",
      length: 0,
      duration_ms: Date.now() - started,
      error: String(error)
    };

    console.log(`ERROR — ${path} — ${error}`);
    return result;
  }
}

const results = [];

for (const path of candidates) {
  results.push(await test(path));
}

const output = {
  generated_at: new Date().toISOString(),
  base: BASE,
  candidates,
  results
};

const fs = await import("node:fs/promises");
await fs.writeFile(
  "doublagevf-diagnostic.json",
  JSON.stringify(output, null, 2),
  "utf8"
);

console.log("\nDiagnostic terminé.");
console.log("Résultat écrit dans doublagevf-diagnostic.json");
