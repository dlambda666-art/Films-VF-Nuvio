import fs from "node:fs/promises";

const BASE = "https://doublagevf.fr";
const candidates = ["/", "/works", "/works?page=1"];

async function fetchText(url) {
  const r = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; Films-VF-Nuvio-Diagnostic/2.0)"
    }
  });
  const text = await r.text();
  return {
    requested: url,
    url: r.url,
    status: r.status,
    type: r.headers.get("content-type") || "",
    text
  };
}

function extractScriptSources(html, baseUrl) {
  const out = new Set();
  const re = /<script[^>]+src=["']([^"']+)["']/gi;
  for (const m of html.matchAll(re)) {
    try { out.add(new URL(m[1], baseUrl).href); } catch {}
  }
  return [...out];
}

function extractAssetSources(html, baseUrl) {
  const out = new Set();
  const re = /<(?:link|script)[^>]+(?:href|src)=["']([^"']+)["']/gi;
  for (const m of html.matchAll(re)) {
    if (/\.(?:js|mjs)(?:\?|$)/i.test(m[1]) || /modulepreload/i.test(m[0])) {
      try { out.add(new URL(m[1], baseUrl).href); } catch {}
    }
  }
  return [...out];
}

function inspectAppJs(text, url) {
  const urls = new Set();
  const patterns = [
    /https?:\/\/[^"'`\s)]+/gi,
    /["'`]\/(?:api|graphql|trpc|v1|v2|v3)\/[^"'`\s)]*/gi,
    /["'`]\/[^"'`\s)]*(?:works|work|oeuvres|search|catalog|catalogue|tmdb)[^"'`\s)]*/gi
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) urls.add(m[0]);
  }

  const interestingStrings = [];
  const stringRe = /["'`]([^"'`\n]{1,220})["'`]/g;
  for (const m of text.matchAll(stringRe)) {
    const s = m[1];
    if (/api|graphql|works|work|oeuvre|search|catalog|supabase|firebase|tmdb/i.test(s)) {
      interestingStrings.push(s);
    }
    if (interestingStrings.length >= 120) break;
  }

  return {
    url,
    length: text.length,
    endpointCandidates: [...urls].slice(0, 150),
    interestingStrings,
    hasFetch: /\bfetch\s*\(/i.test(text),
    hasAxios: /axios/i.test(text),
    hasGraphql: /graphql/i.test(text),
    hasSupabase: /supabase/i.test(text),
    hasFirebase: /firebase/i.test(text),
    hasTmdb: /themoviedb|tmdb/i.test(text)
  };
}

async function main() {
  const pages = [];
  const assetUrls = new Set();

  for (const path of candidates) {
    const r = await fetchText(BASE + path);
    const scripts = extractScriptSources(r.text, r.url);
    const assets = extractAssetSources(r.text, r.url);
    scripts.forEach(x => assetUrls.add(x));
    assets.forEach(x => assetUrls.add(x));

    pages.push({
      path,
      status: r.status,
      finalUrl: r.url,
      contentType: r.type,
      length: r.text.length,
      title: (r.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim(),
      scriptUrls: scripts,
      assetUrls: assets
    });
  }

  const appAssets = [];
  for (const url of assetUrls) {
    try {
      const r = await fetchText(url);
      if (!/javascript|ecmascript|text\/plain/i.test(r.type) && !/\.(?:js|mjs)(?:\?|$)/i.test(url)) continue;
      console.log(`Asset ${url}: ${r.status}, ${r.text.length} bytes`);
      appAssets.push(inspectAppJs(r.text, url));
    } catch (e) {
      appAssets.push({ url, error: e.message });
    }
  }

  await fs.writeFile(
    "doublagevf-diagnostic.json",
    JSON.stringify({
      generated_at: new Date().toISOString(),
      pages,
      assetUrls: [...assetUrls],
      appAssets
    }, null, 2) + "\n"
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
