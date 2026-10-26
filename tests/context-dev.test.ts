import { describe, expect, it, vi } from "vitest";

import {
  CONTEXT_DEV_BRAND_ENDPOINT,
  createContextDevClient,
  getCompanySiteFinder,
  lookupName,
  sameDomainUrl,
} from "@/lib/integrations/context-dev";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("context.dev brand lookup", () => {
  it("returns the official site and same-domain careers/contact pages", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        status: "ok",
        brand: {
          domain: "catamania.com",
          links: {
            careers: "https://www.catamania.com/recrutement/",
            contact: "https://www.catamania.com/contact/",
          },
        },
      }),
    );
    const client = createContextDevClient({ apiKey: "k", fetch: fetchMock as typeof fetch });
    expect(await client.find("CATAMANIA")).toEqual({
      website: "https://catamania.com",
      domain: "catamania.com",
      careersUrl: "https://www.catamania.com/recrutement/",
      contactUrl: "https://www.catamania.com/contact/",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CONTEXT_DEV_BRAND_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string)).toEqual({
      type: "by_name",
      name: "CATAMANIA",
      country_gl: "fr",
    });
  });

  it("returns null on not found, directory domains, errors and short names", async () => {
    const notFound = vi.fn(async () => json({ code: "NOT_FOUND" }, 400));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await createContextDevClient({ apiKey: "k", fetch: notFound as typeof fetch }).find("ACME"),
    ).toBeNull();
    const directory = vi.fn(async () => json({ brand: { domain: "societe.com" } }));
    expect(
      await createContextDevClient({ apiKey: "k", fetch: directory as typeof fetch }).find("ACME"),
    ).toBeNull();
    const down = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(
      await createContextDevClient({ apiKey: "k", fetch: down as typeof fetch }).find("ACME"),
    ).toBeNull();
    const never = vi.fn();
    expect(
      await createContextDevClient({ apiKey: "k", fetch: never as typeof fetch }).find("AB"),
    ).toBeNull();
    expect(never).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("drops page links on another domain or not https", () => {
    expect(sameDomainUrl("https://jobs.acme.fr/x", "acme.fr")).toBe("https://jobs.acme.fr/x");
    expect(sameDomainUrl("https://welcometothejungle.com/acme", "acme.fr")).toBeNull();
    expect(sameDomainUrl("http://acme.fr/jobs", "acme.fr")).toBeNull();
    expect(sameDomainUrl("javascript:alert(1)", "acme.fr")).toBeNull();
  });

  it("shortens long names at a word boundary under 30 characters", () => {
    expect(lookupName("  MUTUELLE   FRATERNELLE ASSURANCE (MFA) ")).toBe(
      "MUTUELLE FRATERNELLE ASSURANCE",
    );
    expect(lookupName("ACME").length).toBeLessThanOrEqual(30);
  });

  it("is disabled without CONTEXT_DEV_API_KEY", () => {
    expect(getCompanySiteFinder({})).toBeNull();
    expect(getCompanySiteFinder({ CONTEXT_DEV_API_KEY: "k" })).not.toBeNull();
  });
});
