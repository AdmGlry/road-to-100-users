import { describe, expect, it } from "vitest";

import {
  bodyLengthState,
  countItems,
  countsSummary,
  countWords,
  formatTime,
  itemPhase,
  looksLikeEmail,
  pollPlan,
  preparationProgress,
  quotaLabel,
  safeHttpUrl,
  sendableItems,
  sendButtonLabel,
  sendDurationLabel,
  statusLabel,
} from "@/components/review/review-utils";
import type { ReviewItem } from "@/lib/hunter/application-types";

function item(over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    applicationId: crypto.randomUUID(),
    leadId: crypto.randomUUID(),
    company: {
      name: "ACME",
      city: "Nantes",
      activity: null,
      headcount_label: "10 à 19",
      website: null,
    },
    contact: {
      id: "c1",
      first_name: "Ana",
      last_name: "Lopez",
      role: null,
      email: "ana.lopez@acme.fr",
      source: "pattern_guess",
      confidence: "medium",
    },
    contacts: [],
    subject: "Alternance",
    body: "Bonjour",
    company_insight: null,
    company_insight_source: null,
    claims_unverified: [],
    quality_warnings: [],
    status: "draft",
    approved_at: null,
    scheduled_for: null,
    sent_at: null,
    send_error: null,
    edited_by_user: false,
    ...over,
  };
}

describe("countWords / bodyLengthState", () => {
  it("counts words, ignoring punctuation-only tokens", () => {
    expect(countWords("Bonjour Madame, je suis   étudiant – en BTS.")).toBe(7);
    expect(countWords("")).toBe(0);
    expect(countWords("l'alternance 2027")).toBe(2);
  });
  it("classifies the length against 120–180", () => {
    expect(bodyLengthState(119)).toBe("short");
    expect(bodyLengthState(120)).toBe("ok");
    expect(bodyLengthState(180)).toBe("ok");
    expect(bodyLengthState(181)).toBe("long");
  });
});

describe("safeHttpUrl", () => {
  it("keeps http(s) only", () => {
    expect(safeHttpUrl("https://www.ouest-france.fr/a")).toBe("https://www.ouest-france.fr/a");
    expect(safeHttpUrl("http://example.com")).toBe("http://example.com/");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeHttpUrl("//evil.com")).toBeNull();
    expect(safeHttpUrl("pas une url")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});

describe("looksLikeEmail", () => {
  it("accepts plausible addresses only", () => {
    expect(looksLikeEmail(" rh@acme.fr ")).toBe(true);
    expect(looksLikeEmail("rh@acme")).toBe(false);
    expect(looksLikeEmail("r h@acme.fr")).toBe(false);
  });
});

describe("phases and labels", () => {
  it("derives the phase of a mail", () => {
    expect(itemPhase(item())).toBe("draft");
    expect(itemPhase(item({ send_error: "Échec" }))).toBe("error");
    expect(itemPhase(item({ status: "approved", approved_at: "x" }))).toBe("approved");
    expect(itemPhase(item({ status: "approved", scheduled_for: "2026-10-25T12:00:00Z" }))).toBe(
      "queued",
    );
    expect(itemPhase(item({ status: "replied" }))).toBe("sent");
  });
  it("formats times in French time", () => {
    expect(formatTime("2026-10-25T12:05:00Z")).toBe("13:05"); // CET (winter time)
    expect(formatTime("nope")).toBeNull();
    expect(statusLabel(item({ status: "approved", scheduled_for: "2026-07-01T12:05:00Z" }))).toBe(
      "En file d'attente, envoi vers 14:05",
    );
    expect(statusLabel(item({ status: "sent", sent_at: "2026-07-01T12:05:00Z" }))).toBe(
      "Envoyé à 14:05",
    );
  });
  it("labels the quota and the send button", () => {
    expect(quotaLabel({ remaining: 12, limit: 20 })).toBe(
      "12 envois restants sur 20 (24 h glissantes)",
    );
    expect(quotaLabel({ remaining: 1, limit: 20 })).toBe(
      "1 envoi restant sur 20 (24 h glissantes)",
    );
    expect(quotaLabel({ remaining: -3, limit: 20 })).toBe(
      "0 envoi restant sur 20 (24 h glissantes)",
    );
    expect(sendButtonLabel(3)).toBe("Envoyer les 3 mails validés");
    expect(sendButtonLabel(1)).toBe("Envoyer le mail validé");
  });
  it("estimates the duration of a batch", () => {
    expect(sendDurationLabel(1)).toBe("Il part dans la minute.");
    expect(sendDurationLabel(5)).toBe("Compte environ 2 à 6 min pour l'ensemble.");
  });
  it("summarizes counts", () => {
    const c = countItems([
      item(),
      item({ send_error: "x" }),
      item({ status: "approved", approved_at: "x" }),
      item({ status: "sent" }),
    ]);
    expect(c).toEqual({ toReview: 2, approved: 1, queued: 0, sent: 1, errors: 1 });
    expect(countsSummary(c)).toBe("2 à relire, 1 validé, 1 envoyé");
  });
});

describe("sendableItems", () => {
  it("keeps validated, unqueued mails with a valid recipient", () => {
    const ok = item({ status: "approved", approved_at: "t" });
    const queued = item({ status: "approved", approved_at: "t", scheduled_for: "t" });
    const noContact = item({ status: "approved", approved_at: "t", contact: null });
    const draft = item();
    expect(sendableItems([ok, queued, noContact, draft])).toEqual([ok]);
  });
});

describe("pollPlan / preparationProgress", () => {
  it("polls the preparation first, then the queue, else nothing", () => {
    const preparing = [
      { leadId: "l", companyName: "X", prep_status: "running" as const, prep_error: null },
    ];
    expect(pollPlan({ preparing, items: [] })).toEqual({ kind: "prepare", delay: 5000 });
    expect(pollPlan({ preparing, items: [] }, 2)).toEqual({ kind: "prepare", delay: 20000 });
    const queued = item({ status: "approved", scheduled_for: "t" });
    expect(pollPlan({ preparing: [], items: [queued] })).toEqual({ kind: "queue", delay: 20000 });
    expect(
      pollPlan({
        preparing: [{ leadId: "l", companyName: "X", prep_status: "failed", prep_error: "e" }],
        items: [item()],
      }),
    ).toBeNull();
  });
  it("computes the batch progress", () => {
    const preparing = [
      { leadId: "a", companyName: "A", prep_status: "queued" as const, prep_error: null },
      { leadId: "b", companyName: "B", prep_status: "running" as const, prep_error: null },
    ];
    expect(preparationProgress({ preparing, items: [item(), item({ status: "sent" })] })).toEqual({
      ready: 1,
      total: 3,
      percent: 33,
    });
  });
});
