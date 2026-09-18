import { writeFile } from "node:fs/promises";

const RADAR_OUTPUT = "lab/justwatch-radar.json";
const VF_INDEX_URL = "https://raw.githubusercontent.com/dlambda666-art/Films-VF-Nuvio/main/vf-index.json";

const TESTS = [
  {
    name: "Conjuring : L'Heure du jugement 2025",
    tmdbId: 1038392,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/the-conjuring-lheure-du-jugement", scope: "be" },
      { locale: "fr", url: "https://www.justwatch.com/fr/film/conjuring-lheure-du-jugement", scope: "fr" }
    ],
    expectedYear: 2025,
    expectedTitle: "conjuring l'heure du jugement"
  },
  {
    name: "Les 4 Fantastiques : Premiers Pas 2025",
    tmdbId: 617126,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/the-fantastic-four", scope: "be" },
      { locale: "fr", url: "https://www.justwatch.com/fr/film/the-fantastic-four", scope: "fr" }
    ],
    expectedYear: 2025,
    expectedTitle: "les 4 fantastiques premiers pas"
  },
  {
    name: "Sinners 2025",
    tmdbId: 1233413,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/sinners", scope: "be" },
      { locale: "fr", url: "https://www.justwatch.com/fr/film/sinners", scope: "fr" }
    ],
    expectedYear: 2025,
    expectedTitle: "sinners"
  },
  {
    name: "The Raid / Muru 2022",
    tmdbId: 995885,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/muru", scope: "be" },
      { locale: "fr", url: "https://www.justwatch.com/fr/film/muru", scope: "fr" }
    ],
    expectedYear: 2022,
    expectedTitle: "the raid"
  },
  {
    name: "L'Odyssée 2026",
    tmdbId: 1368337,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/lodyssee-2026", scope: "be" },
      { locale: "fr", url: "https://www.justwatch.com/fr/film/lodyssee-2026", scope: "fr" }
    ],
    expectedYear: 2026,
    expectedTitle: "l'odyssée"
  },
  {
    name: "Spider-Man: Brand New Day",
    tmdbId: 969681,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/untitled-spider-man-sequel", scope: "be" },
      { locale: "fr", url: "https://www.justwatch.com/fr/film/spider-man-4", scope: "fr" }
    ],
    expectedYear: 2026,
    expectedTitle: "spider-man: brand new day"
  },
  {
    name: "Le Sifflet 2026",
    tmdbId: 1193501,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/le-sifflet", scope: "be" },
      { locale: "fr", url: "https://www.justwatch.com/fr/film/whistle-2026", scope: "fr" }
    ],
    expectedYear: 2026,
    expectedTitle: "le sifflet"
  },
  {
    name: "Resident Evil 2026",
    tmdbId: 1423191,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/resident-evil", scope: "be" },
      { locale: "fr", url: "https://www.justwatch.com/fr/film/resident-evil", scope: "fr" }
    ],
    expectedYear: 2026,
    expectedTitle: "resident evil"
  }
,
  {
    name: "Projet Dernière Chance 2026",
    tmdbId: 687163,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/projet-derniere-chance", scope: "be" },
      { locale: "fr", url: "https://www.justwatch.com/fr/film/projet-derniere-chance", scope: "fr" }
    ],
    expectedYear: 2026,
    expectedTitle: "projet dernière chance"
  },
  {
    name: "Mortal Kombat II 2026",
    tmdbId: 931285,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/mortal-kombat-2", scope: "be" },
      { locale: "fr", url: "https://www.justwatch.com/fr/film/mortal-kombat-2", scope: "fr" }
    ],
    expectedYear: 2026,
    expectedTitle: "mortal kombat 2"
  },
  {
    name: "Super Mario Galaxy 2026",
    tmdbId: 1226863,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/super-mario-galaxy-le-film", scope: "be" },
      { locale: "fr", url: "https://www.justwatch.com/fr/film/super-mario-galaxy-le-film", scope: "fr" }
    ],
    expectedYear: 2026,
    expectedTitle: "super mario galaxy le film"
  },
  {
    name: "28 Ans plus tard : Le Temple des morts 2026",
    tmdbId: 1272837,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/28-ans-plus-tard-le-temple-des-morts", scope: "be" },
      { locale: "fr", url: "https://www.justwatch.com/fr/film/28-years-later-the-bone-temple", scope: "fr" }
    ],
    expectedYear: 2026,
    expectedTitle: "28 ans plus tard le temple des morts"
  }
];

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractHeading(text) {
  const m = text.match(/^\s*([^|]+?)\s*\((\d{4})\)/);
  return m ? { title: m[1].trim(), year: Number(m[2]) } : null;
}

function extractAvailability(text) {
  const lower = text.toLowerCase();

  const notAvailable =
    lower.includes("n'est pas disponible en streaming") ||
    lower.includes("n’est pas disponible en streaming") ||
    lower.includes("aucune offre pour") ||
    lower.includes("aucune option de streaming");

  const explicitOffers =
    /(?:\b(?:location|achat)\b[^\n]{0,120}\d[,.]\d{2}\s*€)/i.test(text) ||
    /(?:\b(?:abonnement|streaming)\b[^\n]{0,120}\d[,.]\d{2}\s*€)/i.test(text) ||
    /\bdisponible\s+sur\s+\d+\s+services?\s+de\s+streaming\b/i.test(text) ||
    /\bdisponible\s+sur\s+\d+\s+service[s]?\s+de\s+streaming\b/i.test(text);

  return { notAvailable, hasExplicitOffer: explicitOffers };
}

function extractDigitalReleaseDate(text) {
  const lower = text.toLowerCase();
  const anchors = [
    "sera disponible sur",
    "sera disponible à partir du",
    "sera disponible dès le",
    "sortie numérique",
    "digital release"
  ];

  for (const anchor of anchors) {
    const index = lower.indexOf(anchor);
    if (index < 0) continue;

    const window = text.slice(index, index + 500);

    const iso = window.match(/\b20\d{2}-\d{2}-\d{2}\b/);
    if (iso) return { date: iso[0], matchedAnchor: anchor };

    const fr = window.match(
      /\b\d{1,2}\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+20\d{2}\b/i
    );
    if (fr) return { date: fr[0], matchedAnchor: anchor };
  }

  return null;
}

async function loadVFIndex() {
  const response = await fetch(VF_INDEX_URL, {
    headers: { "user-agent": "Centralyser-FrenchPulse-lab/4.0" }
  });

  if (!response.ok) throw new Error(`VF index ${response.status}`);

  const payload = await response.json();
  const items = Array.isArray(payload) ? payload : payload.items;

  if (!Array.isArray(items)) throw new Error("Invalid VF index format");

  return new Map(
    items
      .filter(item => item && item.tmdb_id != null)
      .map(item => [Number(item.tmdb_id), item])
  );
}

async function fetchPage(candidate, test) {
  const response = await fetch(candidate.url, {
    headers: { "user-agent": "Centralyser-FrenchPulse-lab/4.0" }
  });

  if (!response.ok) {
    return {
      locale: candidate.locale,
      scope: candidate.scope,
      url: candidate.url,
      httpStatus: response.status,
      error: `${response.status} ${response.statusText}`
    };
  }

  const html = await response.text();
  const text = htmlToText(html);
  const heading = extractHeading(text);
  const availability = extractAvailability(text);

  const titleMatch = heading
    ? normalize(heading.title).includes(normalize(test.expectedTitle)) ||
      normalize(test.expectedTitle).includes(normalize(heading.title))
    : false;

  const yearMatch = heading?.year === test.expectedYear;
  const validPage = titleMatch && yearMatch;
  const digitalRelease = validPage ? extractDigitalReleaseDate(text) : null;

  return {
    locale: candidate.locale,
    scope: candidate.scope,
    url: candidate.url,
    httpStatus: response.status,
    pageTitle: heading?.title || null,
    pageYear: heading?.year || null,
    titleMatch,
    yearMatch,
    validPage,
    notAvailable: validPage ? availability.notAvailable : null,
    hasExplicitOffer: validPage ? availability.hasExplicitOffer : null,
    digitalReleaseDate: digitalRelease?.date || null,
    digitalReleaseMatchedAnchor: digitalRelease?.matchedAnchor || null
  };
}

function deriveRadar(result, vfRecord, now = new Date()) {
  if (!vfRecord || vfRecord.vf_confirmed !== true) {
    return {
      status: "unresolved",
      reason: "vf_not_confirmed"
    };
  }

  if (!result.validPage) {
    return {
      status: "unresolved",
      reason: "justwatch_page_not_valid"
    };
  }

  if (result.notAvailable === true) {
    if (result.digitalReleaseDate) {
      const release = new Date(result.digitalReleaseDate + "T00:00:00Z");
      if (!Number.isNaN(release.getTime()) && release > now) {
        return {
          status: "a_surveiller",
          reason: "digital_release_future",
          digitalReleaseReached: false
        };
      }
      return {
        status: "a_surveiller",
        reason: "digital_release_reached_but_not_available",
        digitalReleaseReached: true
      };
    }

    return {
      status: "a_surveiller",
      reason: "not_available_no_date",
      digitalReleaseReached: null
    };
  }

  if (result.hasExplicitOffer === true) {
    return {
      status: "nouveaute_vf",
      reason: "vf_confirmed_and_explicit_legal_offer_detected",
      digitalReleaseReached: true
    };
  }

  return {
    status: "unresolved",
    reason: "valid_page_but_availability_not_confirmed",
    digitalReleaseReached: null
  };
}

const vfIndex = await loadVFIndex();
const radarItems = [];

for (const test of TESTS) {
  const results = [];

  for (const candidate of test.urls) {
    const result = await fetchPage(candidate, test);
    results.push(result);

    if (result.validPage && result.scope === "be") break;
  }

  const selected = [...results].reverse().find(x => x.validPage) || results[results.length - 1];
  const vfRecord = vfIndex.get(test.tmdbId) || null;
  const radar = selected
    ? deriveRadar(selected, vfRecord)
    : { status: "unresolved", reason: "no_result" };

  const item = {
    tmdb_id: test.tmdbId,
    name: test.name,
    vf_confirmed: vfRecord?.vf_confirmed === true,
    vf_source: vfRecord?.source || null,
    justwatch_scope: selected?.scope || null,
    justwatch_url: selected?.url || null,
    justwatch_valid: selected?.validPage === true,
    legal_offer_detected: selected?.hasExplicitOffer === true,
    not_available: selected?.notAvailable ?? null,
    digital_release_date: selected?.digitalReleaseDate || null,
    status: radar.status,
    reason: radar.reason,
    checked_at: new Date().toISOString()
  };

  radarItems.push(item);
  console.log(JSON.stringify({ ...item, results }));
}

const radarDocument = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  source: {
    vf_index: VF_INDEX_URL,
    justwatch: "public JustWatch pages"
  },
  statuses: {
    nouveaute_vf: "VF confirmée + offre légale JustWatch détectée",
    a_surveiller: "VF confirmée + pas encore disponible / sortie digitale future",
    unresolved: "VF non confirmée, page JustWatch non fiable ou disponibilité non confirmée"
  },
  items: radarItems
};

await writeFile(RADAR_OUTPUT, JSON.stringify(radarDocument, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ radarOutput: RADAR_OUTPUT, itemCount: radarItems.length }));
