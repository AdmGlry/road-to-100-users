import { describe, expect, it } from "vitest";

import {
  domainNameMatch,
  hostnameOf,
  isDirectoryDomain,
  pickOfficialWebsite,
  registrableDomain,
} from "@/lib/hunter/domains";
import type { WebResult } from "@/lib/integrations/websearch";

const r = (url: string, title = ""): WebResult => ({ url, title, snippet: "" });

describe("registrableDomain", () => {
  it("strips subdomains, paths and www", () => {
    expect(registrableDomain("https://www.acme.fr/contact")).toBe("acme.fr");
    expect(registrableDomain("shop.acme.com")).toBe("acme.com");
    expect(registrableDomain("ACME.FR.")).toBe("acme.fr");
  });
  it("handles multi-label public suffixes", () => {
    expect(registrableDomain("https://www.acme.co.uk")).toBe("acme.co.uk");
    expect(registrableDomain("mairie.nantes.gouv.fr")).toBe("nantes.gouv.fr");
  });
  it("refuses IPs, localhost and garbage", () => {
    expect(registrableDomain("http://127.0.0.1/")).toBeNull();
    expect(registrableDomain("https://[::1]/")).toBeNull();
    expect(registrableDomain("localhost")).toBeNull();
    expect(registrableDomain("intranet")).toBeNull();
    expect(registrableDomain("")).toBeNull();
    expect(hostnameOf("foo.local")).toBeNull();
  });
});

describe("isDirectoryDomain", () => {
  it("flags directories, social networks, job boards and media", () => {
    expect(isDirectoryDomain("https://www.societe.com/societe/acme-123")).toBe(true);
    expect(isDirectoryDomain("fr.linkedin.com")).toBe(true);
    expect(isDirectoryDomain("annuaire-entreprises.data.gouv.fr")).toBe(true);
    expect(isDirectoryDomain("fr.indeed.com")).toBe(true);
    expect(isDirectoryDomain("indeed.fr")).toBe(true);
    expect(isDirectoryDomain("www.google.de")).toBe(true);
    expect(isDirectoryDomain("www.ouest-france.fr")).toBe(true);
    expect(isDirectoryDomain("acme.fr")).toBe(false);
  });
});

describe("domainNameMatch", () => {
  it("scores domains that look like the company name", () => {
    expect(domainNameMatch("acmeconseil.fr", "ACME CONSEIL SAS")).toBe(3);
    expect(domainNameMatch("acme-conseil.fr", "Acme Conseil")).toBe(3);
    expect(domainNameMatch("ca-atlantique-vendee.fr", "Crédit Agricole Atlantique Vendée")).toBe(2);
    expect(domainNameMatch("bnp.fr", "BNP")).toBe(1);
    expect(domainNameMatch("random.fr", "ACME CONSEIL")).toBe(0);
  });
});

describe("pickOfficialWebsite", () => {
  it("skips directories and picks the company's own domain", () => {
    const picked = pickOfficialWebsite(
      [
        r("https://www.societe.com/societe/acme-conseil-901234567.html", "ACME CONSEIL"),
        r("https://www.linkedin.com/company/acme-conseil", "Acme Conseil | LinkedIn"),
        r("https://www.acme-conseil.fr/a-propos", "Acme Conseil – cabinet de conseil à Nantes"),
      ],
      "ACME CONSEIL",
    );
    expect(picked).toEqual({ website: "https://www.acme-conseil.fr", domain: "acme-conseil.fr" });
  });

  it("never picks a media article about the company", () => {
    expect(
      pickOfficialWebsite(
        [r("https://www.ouest-france.fr/acme-conseil-recrute", "Acme Conseil recrute à Nantes")],
        "ACME CONSEIL",
      ),
    ).toBeNull();
  });

  it("returns null when no domain matches the name", () => {
    expect(
      pickOfficialWebsite([r("https://www.unrelated.fr/", "Acme Conseil")], "ACME CONSEIL"),
    ).toBeNull();
    expect(pickOfficialWebsite([], "ACME")).toBeNull();
  });

  it("ignores non-http URLs and forces https", () => {
    expect(pickOfficialWebsite([r("ftp://acme.fr/")], "Acme")).toBeNull();
    expect(pickOfficialWebsite([r("http://acmeconseil.fr/")], "Acme Conseil")).toEqual({
      website: "https://acmeconseil.fr",
      domain: "acmeconseil.fr",
    });
  });
});
