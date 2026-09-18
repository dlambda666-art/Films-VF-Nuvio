const TESTS = [
  {
    name: "L'Odyssée 2026",
    tmdbId: 1368337,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/lodyssee-2026" },
      { locale: "fr", url: "https://www.justwatch.com/fr/film/lodyssee-2026" }
    ],
    expectedYear: 2026,
    expectedTitle: "l'odyssée"
  },
  {
    name: "Spider-Man: Brand New Day",
    tmdbId: 969681,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/untitled-spider-man-sequel" }
    ],
    expectedYear: 2026,
    expectedTitle: "spider-man: brand new day"
  },
  {
    name: "Resident Evil 2026",
    tmdbId: 1423191,
    urls: [
      { locale: "be", url: "https://www.justwatch.com/be/film/resident-evil" }
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
    lower.includes("n'est pas disponible pour le pays belgique") ||
    lower.includes("n’est pas disponible pour le pays belgique") ||
    lower.includes("nous n'avons trouvé aucune option de streaming dans belgique") ||
    lower.includes("nous n’avons trouvé aucune option de streaming dans belgique");

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

async function fetchPage(candidate) {
  const response = await fetch(candidate.url, {
    headers: { "user-agent": "Centralyser-FrenchPulse-lab/2.0" }
  });

  if (!response.ok) {
    return {
      locale: candidate.locale,
      url: candidate.url,
      httpStatus: response.status,
      error: `${response.status} ${response.statusText}`
    };
  }

  const html = await response.text();
  const text = htmlToText(html);
  const heading = extractHeading(text);
  const availability = extractAvailability(text);
  const digitalRelease = extractDigitalReleaseDate(text);

  const titleMatch = heading
    ? normalize(heading.title).includes(normalize(candidate.expectedTitle)) ||
      normalize(candidate.expectedTitle).includes(normalize(heading.title))
    : false;

  const yearMatch = heading?.year === candidate.expectedYear;

  return {
    locale: candidate.locale,
    url: candidate.url,
    httpStatus: response.status,
    pageTitle: heading?.title || null,
    pageYear: heading?.year || null,
    titleMatch,
    yearMatch,
    ...availability,
    digitalReleaseDate: digitalRelease?.date || null,
    digitalReleaseMatchedAnchor: digitalRelease?.matchedAnchor || null
  };
}

for (const test of TESTS) {
  const results = [];

  for (const candidate of test.urls) {
    const result = await fetchPage({
      ...candidate,
      expectedYear: test.expectedYear,
      expectedTitle: test.expectedTitle
    });
    results.push(result);

    if (result.httpStatus === 200 && result.titleMatch && result.yearMatch) break;
  }

  console.log(JSON.stringify({
    name: test.name,
    tmdbId: test.tmdbId,
    results
  }));
}
