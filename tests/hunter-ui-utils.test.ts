import { describe, expect, it } from "vitest";

import {
  annuaireUrl,
  clampRadius,
  companiesCountLabel,
  countSelected,
  DEFAULT_FILTERS,
  formatDistance,
  hasActiveFilters,
  isStaleSearch,
  mergeLeads,
  nextPollDelay,
  POLL_HIDDEN_INTERVAL_MS,
  POLL_INTERVAL_MS,
  POLL_MAX_INTERVAL_MS,
  prepareLabel,
  progressPercent,
  scoreBand,
  scoreText,
  STALE_SEARCH_MS,
  stepLabel,
  stepStates,
  toLeadFilters,
  visibleLeads,
  type LeadStatus,
} from "@/components/hunter/hunter-utils";

describe("scoreBand / scoreText", () => {
  it("maps scores to bands at the 85/70/50 thresholds", () => {
    expect(scoreBand(100)).toBe("excellent");
    expect(scoreBand(85)).toBe("excellent");
    expect(scoreBand(84)).toBe("good");
    expect(scoreBand(70)).toBe("good");
    expect(scoreBand(69)).toBe("fair");
    expect(scoreBand(50)).toBe("fair");
    expect(scoreBand(49)).toBe("low");
    expect(scoreBand(0)).toBe("low");
  });

  it("treats null, undefined and NaN as unscored", () => {
    expect(scoreBand(null)).toBe("unscored");
    expect(scoreBand(undefined)).toBe("unscored");
    expect(scoreBand(Number.NaN)).toBe("unscored");
  });

  it("always carries a text label (not color only)", () => {
    expect(scoreText(87)).toBe("87/100 · Excellent");
    expect(scoreText(72.4)).toBe("72/100 · Très bon");
    expect(scoreText(null)).toBe("Non noté");
  });
});

describe("formatting", () => {
  it("formats distances in French", () => {
    expect(formatDistance(4)).toBe("à 4 km");
    expect(formatDistance(12.6)).toBe("à 13 km");
    expect(formatDistance(0.3)).toBe("à moins d'1 km");
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(-1)).toBeNull();
  });

  it("builds the annuaire link only for a valid SIREN", () => {
    expect(annuaireUrl("552 100 554")).toBe(
      "https://annuaire-entreprises.data.gouv.fr/entreprise/552100554",
    );
    expect(annuaireUrl("12345")).toBeNull();
    expect(annuaireUrl("55210055a")).toBeNull();
    expect(annuaireUrl(undefined)).toBeNull();
    expect(annuaireUrl(552100554)).toBeNull();
  });

  it("pluralizes labels", () => {
    expect(prepareLabel(0)).toBe("Préparer 0 candidature");
    expect(prepareLabel(1)).toBe("Préparer 1 candidature");
    expect(prepareLabel(3)).toBe("Préparer 3 candidatures");
    expect(companiesCountLabel(0)).toBe("Aucune entreprise");
    expect(companiesCountLabel(1)).toBe("1 entreprise");
    expect(companiesCountLabel(30)).toBe("30 entreprises");
  });

  it("clamps the radius to 5–100 km", () => {
    expect(clampRadius(2)).toBe(5);
    expect(clampRadius(250)).toBe(100);
    expect(clampRadius(29.6)).toBe(30);
    expect(clampRadius(Number.NaN)).toBe(30);
  });
});

describe("search progress", () => {
  it("marks previous steps done and the current one current", () => {
    expect(stepStates(undefined)).toEqual(["current", "pending", "pending", "pending"]);
    expect(stepStates("naf")).toEqual(["current", "pending", "pending", "pending"]);
    expect(stepStates("prefilter")).toEqual(["done", "done", "current", "pending"]);
    expect(stepStates("scoring")).toEqual(["done", "done", "done", "current"]);
    expect(stepStates("done")).toEqual(["done", "done", "done", "done"]);
  });

  it("labels steps in French, with counts while scoring", () => {
    expect(stepLabel("naf")).toBe("Analyse de ton profil");
    expect(stepLabel("fetch")).toBe("Recherche des entreprises");
    expect(stepLabel("scoring", { step: "scoring", done: 20, total: 60 })).toBe(
      "Notation par l'IA (20/60)",
    );
    expect(stepLabel("scoring", { step: "scoring" })).toBe("Notation par l'IA");
    expect(stepLabel("scoring", { step: "scoring", done: 70, total: 60 })).toBe(
      "Notation par l'IA (60/60)",
    );
  });

  it("computes a monotonic progress percentage", () => {
    const values = [
      progressPercent(undefined),
      progressPercent({ step: "naf" }),
      progressPercent({ step: "fetch" }),
      progressPercent({ step: "prefilter" }),
      progressPercent({ step: "scoring", done: 0, total: 60 }),
      progressPercent({ step: "scoring", done: 30, total: 60 }),
      progressPercent({ step: "scoring", done: 60, total: 60 }),
      progressPercent({ step: "done" }),
    ];
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
    expect(values.at(-1)).toBe(100);
    expect(progressPercent({ step: "scoring", done: 5, total: 0 })).toBe(35);
  });

  it("detects a stale running search", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    expect(isStaleSearch(new Date(now - STALE_SEARCH_MS - 1).toISOString(), now)).toBe(true);
    expect(isStaleSearch(new Date(now - 60_000).toISOString(), now)).toBe(false);
    expect(isStaleSearch("not a date", now)).toBe(false);
  });
});

describe("nextPollDelay", () => {
  it("polls every 1.5 s when visible and healthy", () => {
    expect(nextPollDelay({ hidden: false, consecutiveErrors: 0 })).toBe(POLL_INTERVAL_MS);
  });

  it("slows down while the tab is hidden", () => {
    expect(nextPollDelay({ hidden: true, consecutiveErrors: 0 })).toBe(POLL_HIDDEN_INTERVAL_MS);
  });

  it("backs off exponentially on errors, capped", () => {
    expect(nextPollDelay({ hidden: false, consecutiveErrors: 1 })).toBe(3000);
    expect(nextPollDelay({ hidden: false, consecutiveErrors: 2 })).toBe(6000);
    expect(nextPollDelay({ hidden: false, consecutiveErrors: 5 })).toBe(POLL_MAX_INTERVAL_MS);
    expect(nextPollDelay({ hidden: false, consecutiveErrors: 100 })).toBe(POLL_MAX_INTERVAL_MS);
    expect(nextPollDelay({ hidden: true, consecutiveErrors: 3 })).toBe(12_000);
  });
});

describe("filters", () => {
  it("omits neutral values", () => {
    expect(toLeadFilters(DEFAULT_FILTERS)).toEqual({});
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(toLeadFilters({ minScore: 70, size: "small", maxDistanceKm: 20 })).toEqual({
      minScore: 70,
      size: "small",
      maxDistanceKm: 20,
    });
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, size: "large" })).toBe(true);
  });

  const leads = [
    { id: "a", status: "suggested" as LeadStatus, fit_score: 90, distance_km: 3 },
    { id: "b", status: "selected" as LeadStatus, fit_score: 72, distance_km: 25 },
    { id: "c", status: "dismissed" as LeadStatus, fit_score: 60, distance_km: 8 },
    { id: "d", status: "suggested" as LeadStatus, fit_score: null, distance_km: null },
  ];

  it("hides dismissed leads unless they are pending an undo", () => {
    expect(visibleLeads(leads).map((l) => l.id)).toEqual(["a", "b", "d"]);
    expect(visibleLeads(leads, { undoIds: new Set(["c"]) }).map((l) => l.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("applies optimistic overrides", () => {
    const result = visibleLeads(leads, { overrides: { a: "dismissed", c: "suggested" } });
    expect(result.map((l) => l.id)).toEqual(["b", "c", "d"]);
    expect(result.find((l) => l.id === "c")?.status).toBe("suggested");
  });

  it("re-applies score and distance filters client side", () => {
    expect(
      visibleLeads(leads, { filters: { ...DEFAULT_FILTERS, minScore: 70 } }).map((l) => l.id),
    ).toEqual(["a", "b"]);
    expect(
      visibleLeads(leads, { filters: { ...DEFAULT_FILTERS, maxDistanceKm: 10 } }).map((l) => l.id),
    ).toEqual(["a", "d"]);
  });

  it("counts selected leads with overrides", () => {
    expect(countSelected(leads)).toBe(1);
    expect(countSelected(leads, { a: "selected", b: "suggested" })).toBe(1);
    expect(countSelected(leads, { a: "selected", d: "selected" })).toBe(3);
  });

  it("merges fetched leads by id", () => {
    const known = new Map([["a", { id: "a", v: 1 }]]);
    const merged = mergeLeads(known, [
      { id: "a", v: 2 },
      { id: "b", v: 1 },
    ]);
    expect(merged.get("a")?.v).toBe(2);
    expect(merged.size).toBe(2);
    expect(known.get("a")?.v).toBe(1);
  });
});
