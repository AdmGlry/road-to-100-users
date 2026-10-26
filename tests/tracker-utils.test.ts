import { describe, expect, it } from "vitest";

import {
  cardsByColumn,
  classificationLabel,
  followupLengthState,
  lastSyncLabel,
  percentLabel,
  relativeTime,
  syncAnnouncement,
} from "@/components/tracker/tracker-utils";
import type { TrackerCard } from "@/lib/tracker/types";

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("relativeTime", () => {
  it("prints French relative dates", () => {
    expect(relativeTime(ago(10_000), NOW)).toBe("à l'instant");
    expect(relativeTime(ago(12 * 60_000), NOW)).toBe("il y a 12 min");
    expect(relativeTime(ago(3 * 3_600_000), NOW)).toBe("il y a 3 h");
    expect(relativeTime(ago(30 * 3_600_000), NOW)).toBe("hier");
    expect(relativeTime(ago(5 * 86_400_000), NOW)).toBe("il y a 5 jours");
    expect(relativeTime("2026-10-03T10:00:00.000Z", NOW)).toBe("le 3 oct.");
    expect(relativeTime("2025-10-03T10:00:00.000Z", NOW)).toBe("le 3 oct. 2025");
    expect(relativeTime(null, NOW)).toBeNull();
    expect(relativeTime("nope", NOW)).toBeNull();
  });

  it("labels the last sync", () => {
    expect(lastSyncLabel(null, NOW)).toBe("Pas encore synchronisé");
    expect(lastSyncLabel(ago(4 * 60_000), NOW)).toBe("Dernière synchronisation : il y a 4 min");
  });
});

describe("misc", () => {
  it("formats rates, labels and announcements", () => {
    expect(percentLabel(0.4)).toBe("40 %");
    expect(percentLabel(Number.NaN)).toBe("0 %");
    expect(classificationLabel("interview")).toBe("Entretien proposé");
    expect(classificationLabel(null)).toBe("Réponse à classer");
    expect(syncAnnouncement(0)).toContain("aucune");
    expect(syncAnnouncement(1)).toContain("1 nouvelle réponse");
    expect(syncAnnouncement(3)).toContain("3 nouvelles réponses");
    expect(followupLengthState(49)).toBe("short");
    expect(followupLengthState(65)).toBe("ok");
    expect(followupLengthState(81)).toBe("long");
  });

  it("groups cards by column", () => {
    const cards = [
      { applicationId: "1", column: "sent" },
      { applicationId: "2", column: "interview" },
      { applicationId: "3", column: "sent" },
    ] as TrackerCard[];
    const grouped = cardsByColumn(cards);
    expect(grouped.sent.map((c) => c.applicationId)).toEqual(["1", "3"]);
    expect(grouped.interview).toHaveLength(1);
    expect(grouped.no_reply).toEqual([]);
  });
});
