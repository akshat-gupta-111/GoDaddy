/**
 * BLUE.Matching — Smart Matching Engine with Mandatory Time Eligibility Filter
 *
 * CRITICAL RULE:
 *   Found.from MUST be strictly greater than Lost.to (found.from > lost.to)
 *   comparing complete date-and-time timestamps before any similarity scoring.
 */
(function (global) {
  const BLUE = (global.BLUE = global.BLUE || {});

  const STOP_WORDS = new Set([
    "the", "and", "with", "for", "from", "near", "inside", "around", "this",
    "that", "item", "lost", "found", "was", "were", "has", "have", "on", "in", "at", "a", "an",
  ]);

  function tokenize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  }

  function tokenOverlapScore(textA, textB) {
    const a = new Set(tokenize(textA));
    const b = new Set(tokenize(textB));
    if (a.size === 0 || b.size === 0) return 0;

    let hits = 0;
    a.forEach((word) => {
      if (b.has(word)) {
        hits += 1;
      } else {
        for (const cand of b) {
          if (cand.includes(word) || word.includes(cand)) {
            hits += 0.65;
            break;
          }
        }
      }
    });

    const unionSize = new Set([...a, ...b]).size;
    return Math.min(1, hits / Math.max(1, unionSize * 0.72));
  }

  /**
   * Mandatory Time Filter: Found.from > Lost.to (complete timestamps).
   */
  function isTimeEligible(lostReport, foundReport) {
    if (!lostReport || !foundReport) return false;
    if (!lostReport.to || !foundReport.from) return false;

    const lostToMs = new Date(lostReport.to).getTime();
    const foundFromMs = new Date(foundReport.from).getTime();

    if (Number.isNaN(lostToMs) || Number.isNaN(foundFromMs)) return false;
    return foundFromMs > lostToMs;
  }

  function scoreEligiblePair(sourceReport, candidateReport) {
    const matchedAttributes = [];

    // 1. Item Name (30 pts)
    const itemScore = tokenOverlapScore(sourceReport.item, candidateReport.item);
    const itemPts = itemScore * 30;
    if (itemScore >= 0.5) matchedAttributes.push("Item Name");

    // 2. Category (15 pts)
    const catA = String(sourceReport.category || BLUE.Api.inferCategory(sourceReport.item)).toLowerCase();
    const catB = String(candidateReport.category || BLUE.Api.inferCategory(candidateReport.item)).toLowerCase();
    let catPts = 0;
    if (catA && catB && catA === catB) {
      catPts = 15;
      matchedAttributes.push("Category");
    }

    // 3. Brand (15 pts)
    const b1 = String(sourceReport.brand || "").trim().toLowerCase();
    const b2 = String(candidateReport.brand || "").trim().toLowerCase();
    let brandPts = 0;
    if (
      b1 &&
      b2 &&
      b1 !== "unknown" &&
      b2 !== "unknown" &&
      b1 !== "i don't know" &&
      b2 !== "i don't know"
    ) {
      if (b1 === b2) {
        brandPts = 15;
        matchedAttributes.push("Brand");
      } else if (b1.includes(b2) || b2.includes(b1)) {
        brandPts = 10;
        matchedAttributes.push("Brand");
      }
    }

    // 4. Colour (15 pts)
    const colourScore = tokenOverlapScore(sourceReport.colour, candidateReport.colour);
    const colourPts = colourScore * 15;
    if (colourScore >= 0.45) matchedAttributes.push("Colour");

    // 5. Location (15 pts)
    const locScore = tokenOverlapScore(sourceReport.location, candidateReport.location);
    const locPts = locScore * 15;
    if (locScore >= 0.5) matchedAttributes.push("Location");

    // 6. Description (10 pts)
    const descScore = tokenOverlapScore(sourceReport.description, candidateReport.description);
    const descPts = descScore * 10;
    if (descScore >= 0.25) matchedAttributes.push("Description");

    matchedAttributes.push("Time Eligible (Found > Lost)");

    const percentage = Math.min(
      99,
      Math.round(itemPts + catPts + brandPts + colourPts + locPts + descPts)
    );

    return {
      report: candidateReport,
      percentage,
      matchedAttributes,
    };
  }

  function findMatches(sourceReport, candidatePool, minThreshold = 40) {
    const activeCandidates = (candidatePool || []).filter(
      (c) => c.reportId !== sourceReport.reportId && c.type !== sourceReport.type && c.status === "active"
    );

    // Step 1: Mandatory Time Eligibility Filter (Found.from > Lost.to)
    const timeEligible = activeCandidates.filter((cand) => {
      if (sourceReport.type === "lost") {
        return isTimeEligible(sourceReport, cand);
      }
      return isTimeEligible(cand, sourceReport);
    });

    // Step 2: Similarity Scoring on eligible reports only
    return timeEligible
      .map((cand) => scoreEligiblePair(sourceReport, cand))
      .filter((match) => match.percentage >= minThreshold)
      .sort((a, b) => b.percentage - a.percentage);
  }

  function countDatasetPotentialMatches(allReports, minThreshold = 60) {
    const lost = allReports.filter((r) => r.type === "lost" && r.status === "active");
    const found = allReports.filter((r) => r.type === "found" && r.status === "active");
    let count = 0;

    for (const l of lost) {
      for (const f of found) {
        if (!isTimeEligible(l, f)) continue;
        const scored = scoreEligiblePair(l, f);
        if (scored.percentage >= minThreshold) {
          count += 1;
        }
      }
    }
    return count;
  }

  BLUE.Matching = {
    isTimeEligible,
    scoreEligiblePair,
    findMatches,
    countDatasetPotentialMatches,
  };
})(window);
