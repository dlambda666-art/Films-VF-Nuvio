import fs from "node:fs/promises";

const BASE = "https://doublagevf.fr";
const candidates = [
  "/api",
  "/api/works",
  "/api/works?limit=10&page=1",
  "/api/works/browse",
  "/api/works/browse?page=1",
  "/api/works/browse?page=1&limit=50",
  "/api/works/browse?skip=0&limit=50",
  "/api/search/universal?q=Predator",
  "/api/search/universal?query=Predator",
  "/api/search?q=Predator",
  "/api/works?search=Predator",
  "/api/works/browse?search=Predator"
];

async function request(path) {
  const r = await fetch(BASE + path, {
    redirect: "follow",
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "Mozilla/5.0 (compatible; Films-VF-Nuvio-API-Diagnostic/1.0)"
    }
  });
  const text = await r.text();
  return {
    path,
    status: r.status,
    finalUrl: r.url,
    contentType: r.headers.get("content-type") || "",
    length: text.length,
    preview: text.slice(0, 1200)
  };
}

async function main() {
  const results = [];
  for (const path of candidates) {
    try {
      const result = await request(path);
      console.log(`\n=== ${path} ===`);
      console.log(`status=${result.status} type=${result.contentType} length=${result.length}`);
      console.log(result.preview.replace(/\s+/g, " ").slice(0, 1000));
      results.push(result);
    } catch (e) {
      console.log(`\n=== ${path} === ERROR ${e.message}`);
      results.push({ path, error: e.message });
    }
  }

  await fs.writeFile(
    "doublagevf-api-diagnostic.json",
    JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2) + "\n"
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
