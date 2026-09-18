const TESTS = [
  {
    name: "L'Odyssée 2026",
    tmdbId: 1062722,
    url: "https://www.justwatch.com/be/film/lodyssee-2026"
  },
  {
    name: "Spider-Man: Brand New Day",
    tmdbId: null,
    url: "https://www.justwatch.com/be/film/untitled-spider-man-sequel"
  },
  {
    name: "Resident Evil 2026",
    tmdbId: 1423191,
    url: "https://www.justwatch.com/be/film/resident-evil"
  }
];

function htmlToText(html) {
  return html
    .replace(/<script[\\s\\S]*?<\\/script>/gi, " ")
    .replace(/<style[\\s\\S]*?<\\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\\s+/g, " ")
    .trim();
}

function extractReleaseDate(text) {
  const anchors = [
    "sera disponible",
    "sera disponible sur",
    "sortie numérique",
    "Digital Release"
  ];

  for (const anchor of anchors) {
    const index = text.toLowerCase().indexOf(anchor.toLowerCase());
    if (index >= 0) {
      const window = text.slice(index, index + 800);
      const iso = window.match(/\\b20\\d{2}-\\d{2}-\\d{2}\\b/);
      if (iso) return iso[0];
      const fr = window.match(/\\b\\d{1,2}\\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\\s+20\\d{2}\\b/i);
      if (fr) return fr[0];
    }
  }

  return null;
}

function extractAvailability(text) {
  const lower = text.toLowerCase();
  return {
    notAvailable:
      lower.includes("n'est pas disponible en streaming") ||
      lower.includes("n’est pas disponible en streaming"),
    hasDigitalOffer:
      lower.includes("location") ||
      lower.includes("achat") ||
      lower.includes("streaming")
  };
}

async function probe(test) {
  const response = await fetch(test.url, {
    headers: {
      "user-agent": "Centralyser-FrenchPulse-lab/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const text = htmlToText(html);
  const titleMatch = text.match(/#\\s*([^|]{2,100})/);

  return {
    name: test.name,
    tmdbId: test.tmdbId,
    url: test.url,
    httpStatus: response.status,
    releaseDate: extractReleaseDate(text),
    ...extractAvailability(text),
    pageTitle: titleMatch ? titleMatch[1].trim() : null
  };
}

for (const test of TESTS) {
  try {
    console.log(JSON.stringify(await probe(test)));
  } catch (error) {
    console.error(JSON.stringify({
      name: test.name,
      url: test.url,
      error: error.message
    }));
  }
}
