import fs from "node:fs/promises";

const BASE = "https://doublagevf.fr";
const INDEX_FILE = "vf-index.json";
const FULL_SYNC = process.env.FULL_SYNC === "1";
const PAGE_COUNT = Number(process.env.PAGE_COUNT || (FULL_SYNC ? 428 : 12));
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 350);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function stripHtml(v) {
  return v.replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ").replace(/ /g," ")
    .replace(/&/g,"&").replace(/'/g,"'")
    .replace(/"/g,'"').replace(/\s+/g," ").trim();
}

async function fetchText(url) {
  const r = await fetch(url,{headers:{
    "user-agent":"Films-VF-Nuvio/1.0 (+https://github.com/dlambda666-art/Films-VF-Nuvio)"
  }});
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

function extractWorkLinks(html) {
  const found = new Map();
  const re = /href=["'](\/work\/[^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const title = stripHtml(m[2]);
    if (title && title.length <= 200) found.set(m[1],{href:m[1],title});
  }
  return [...found.values()];
}

function extractYear(text) {
  const m = text.match(/\bFilm\s+(19\d{2}|20\d{2})\b/i);
  return m ? Number(m[1]) : null;
}

function extractTmdbId(html,text) {
  const patterns = [
    /themoviedb\.org\/movie\/(\d+)/i,
    /tmdb(?:_id|Id|ID)?["':=\s]+(\d{2,10})/i,
    /["']tmdb["']\s*:\s*["']?(\d{2,10})/i
  ];
  for (const p of patterns) {
    const m = html.match(p) || text.match(p);
    if (m) return Number(m[1]);
  }
  return null;
}

async function fetchWork(item) {
  const html = await fetchText(BASE + item.href);
  const text = stripHtml(html);
  if (!/\bFilm\s+(19\d{2}|20\d{2})\b/i.test(text)) return null;
  if (!/Doublage français\s*\(\s*\d+/i.test(text)) return null;
  const tmdbId = extractTmdbId(html,text);
  if (!tmdbId) return null;
  return {
    tmdb_id: tmdbId, title: item.title, year: extractYear(text),
    vf_confirmed: true, vf_country: null, source: "DoublageVF",
    confidence: 1, status: "confirmed", last_verified: new Date().toISOString()
  };
}

async function mapConcurrent(items) {
  const results=[]; let cursor=0;
  async function worker() {
    while (true) {
      const i=cursor++;
      if (i>=items.length) return;
      try { const r=await fetchWork(items[i]); if(r) results.push(r); }
      catch(e){ console.warn("Skipped:",items[i].href,e.message); }
      await sleep(REQUEST_DELAY_MS);
    }
  }
  await Promise.all(Array.from({length:CONCURRENCY},worker));
  return results;
}

async function main() {
  let existing={version:1,updated_at:null,items:[]};
  try { existing=JSON.parse(await fs.readFile(INDEX_FILE,"utf8")); } catch {}
  const byTmdb=new Map((existing.items||[])
    .filter(x=>Number.isInteger(Number(x.tmdb_id)))
    .map(x=>[Number(x.tmdb_id),x]));

  for(let page=1;page<=PAGE_COUNT;page++){
    console.log(`Scanning DoublageVF works page ${page}/${PAGE_COUNT}`);
    let html;
    try { html=await fetchText(`${BASE}/works?page=${page}`); }
    catch(e){ console.warn("Page skipped:",e.message); continue; }
    const works=extractWorkLinks(html);
    console.log(`  ${works.length} works found`);
    for(const r of await mapConcurrent(works))
      byTmdb.set(r.tmdb_id,{...(byTmdb.get(r.tmdb_id)||{}),...r});
  }

  const items=[...byTmdb.values()].filter(x=>x.vf_confirmed===true)
    .sort((a,b)=>Number(b.year||0)-Number(a.year||0)||String(a.title||"").localeCompare(String(b.title||""),"fr"));

  await fs.writeFile(INDEX_FILE,JSON.stringify({
    version:1,updated_at:new Date().toISOString(),items
  },null,2)+"\n");
  console.log(`VF index updated: ${items.length} confirmed films`);
}
main().catch(e=>{console.error(e);process.exit(1);});
