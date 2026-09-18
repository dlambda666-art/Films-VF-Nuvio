const TESTS = [
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
    name: "Resident Evil 2026",
    tmdbId: 1423191,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/resident-evil", scope: "be" },
      { locale: "fr", url: "https://www.justwatch.com/fr/film/resident-evil", scope: "fr" }
    ],
    expectedYear: 2026,
    expectedTitle: "resident evil"
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
    /(?:\b(?:abonnement|streaming)\b[^\n]{0,120}\d[,.]\d{2}\s*€)/i.test(text);

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

async function fetchPage(candidate, test) {
  const response = await fetch(candidate.url, {
    headers: { "user-agent": "Centralyser-FrenchPulse-lab/3.0" }
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

function deriveRadar(result, now = new Date()) {
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
      reason: "explicit_legal_offer_detected",
      digitalReleaseReached: true
    };
  }

  return {
    status: "unknown",
    reason: "valid_page_but_availability_not_confirmed",
    digitalReleaseReached: null
  };
}

for (const test of TESTS) {
  const results = [];

  for (const candidate of test.urls) {
    const result = await fetchPage(candidate, test);
    results.push(result);

    if (result.validPage && result.scope === "be") break;
  }

  const selected = [...results].reverse().find(x => x.validPage) || results[results.length - 1];
  const radar = selected
    ? deriveRadar(selected)
    : { status: "unresolved", reason: "no_result" };

  console.log(JSON.stringify({
    name: test.name,
    tmdbId: test.tmdbId,
    selectedScope: selected?.scope || null,
    selectedValidPage: selected?.validPage || false,
    selectedNotAvailable: selected?.notAvailable ?? null,
    selectedDigitalReleaseDate: selected?.digitalReleaseDate || null,
    radar,
    results
  }));
}
