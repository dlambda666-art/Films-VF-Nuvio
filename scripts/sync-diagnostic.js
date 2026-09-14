import fs from "node:fs/promises";

const BASE = "https://doublagevf.fr";
const candidates = [
  "/",
  "/works",
  "/works?page=1",
  "/works/1",
  "/works/page/1",
  "/works?p=1",
  "/works?pg=1",
  "/oeuvres",
  "/oeuvres?page=1",
  "/films",
  "/films?page=1"
];

async function fetchText(path) {
  const url = BASE + path;
  const r = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; Films-VF-Nuvio-Diagnostic/1.0)"
    }
  });
  const text = await r.text();
  return { url: r.url, status: r.status, type: r.headers.get("content-type") || "", text };
}

function inspect(html) {
  const hrefs = [];
  const re = /href=["']([^"'#]+)["']/gi;
  for (const m of html.matchAll(re)) {
    if (!hrefs.includes(m[1])) hrefs.push(m[1]);
  }

  const workHrefs = hrefs.filter(x => /\/work\//i.test(x));
  const interesting = hrefs.filter(x =>
    /work|oeuv|film|annuaire|page=|p=|pg=/i.test(x)
  ).slice(0, 80);

  return {
    length: html.length,
    title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g," ").trim(),
    workHrefs: workHrefs.slice(0, 20),
    interesting,
    hasFilm2026: /\bFilm\s+2026\b/i.test(html),
    hasDoublage: /Doublage français/i.test(html),
    hasCloudflare: /cloudflare|just a moment|attention required/i.test(html)
  };
}

async function main() {
  const out = [];
  for (const path of candidates) {
    try {
      const r = await fetchText(path);
      const info = inspect(r.text);
      console.log(`\n=== ${path} ===`);
      console.log(`status=${r.status} final=${r.url}`);
      console.log(`content-type=${r.type} length=${info.length}`);
      console.log(`title=${info.title}`);
      console.log(`work links=${info.workHrefs.length}`);
      console.log(`film2026=${info.hasFilm2026} doublage=${info.hasDoublage} cloudflare=${info.hasCloudflare}`);
      if (info.interesting.length) console.log("interesting hrefs:", info.interesting.join(" | "));
      out.push({ path, ...r, info, text: undefined });
    } catch (e) {
      console.log(`\n=== ${path} ===`);
      console.log(`ERROR ${e.message}`);
      out.push({ path, error: e.message });
    }
  }

  await fs.writeFile(
    "doublagevf-diagnostic.json",
    JSON.stringify(out, null, 2) + "\n"
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
