import { describe, expect, it, vi } from "vitest";

import {
  decodeEntities,
  defaultPageFetcher,
  discoverLinks,
  extractEmails,
  findEmailsOnWebsite,
  isAllowedUrl,
  isPublicAddress,
  isRecruitingAddress,
  MAX_PAGES,
  type PageFetcher,
  type PageFetchResult,
} from "@/lib/integrations/website";

const html = (body: string): PageFetchResult => ({
  status: 200,
  location: null,
  contentType: "text/html; charset=utf-8",
  body,
});
const notFound: PageFetchResult = { status: 404, location: null, contentType: null, body: "" };
const redirect = (location: string): PageFetchResult => ({
  status: 301,
  location,
  contentType: null,
  body: "",
});

describe("isPublicAddress", () => {
  it("refuses private, loopback, link-local, CGNAT, multicast and reserved ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "64:ff9b::a00:1",
      "2001:db8::1",
      "ff02::1",
      "not-an-ip",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
  it("accepts public addresses", () => {
    for (const ip of [
      "93.184.216.34",
      "172.32.0.1",
      "8.8.8.8",
      "2606:4700::1111",
      "::ffff:8.8.8.8",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});

describe("isAllowedUrl", () => {
  it("only https on the company's registrable domain, no IP, no credentials, no odd port", () => {
    expect(isAllowedUrl(new URL("https://www.acme.fr/contact"), "acme.fr")).toBe(true);
    expect(isAllowedUrl(new URL("https://jobs.acme.fr/"), "acme.fr")).toBe(true);
    expect(isAllowedUrl(new URL("http://acme.fr/"), "acme.fr")).toBe(false);
    expect(isAllowedUrl(new URL("https://acme.fr.evil.com/"), "acme.fr")).toBe(false);
    expect(isAllowedUrl(new URL("https://127.0.0.1/"), "acme.fr")).toBe(false);
    expect(isAllowedUrl(new URL("https://user:pw@acme.fr/"), "acme.fr")).toBe(false);
    expect(isAllowedUrl(new URL("https://acme.fr:8443/"), "acme.fr")).toBe(false);
  });
});

describe("extractEmails", () => {
  it("decodes mailto, entities and [at]/[dot] obfuscations; keeps only the company domain", () => {
    const page = `
      <a href="mailto:recrutement@acme.fr?subject=Candidature">Écrivez-nous</a>
      <p>contact&#64;acme&#46;fr</p>
      <p>rh [at] acme [dot] fr</p>
      <p>jobs(at)groupe.acme.fr</p>
      <p>ami@gmail.com, noreply@acme.fr, dpo@acme.fr, logo@2x.png</p>
      <a href="mailto:Jean.Dupont%40acme.fr">Jean</a>`;
    expect(extractEmails(page, "acme.fr")).toEqual([
      "recrutement@acme.fr",
      "contact@acme.fr",
      "rh@acme.fr",
      "jobs@groupe.acme.fr",
      "jean.dupont@acme.fr",
    ]);
  });
  it("decodes numeric and named entities", () => {
    expect(decodeEntities("a&#x40;b&period;fr &amp; &commat;")).toBe("a@b.fr & @");
  });
  it("recognises recruiting local parts", () => {
    expect(isRecruitingAddress("recrutement@acme.fr")).toBe(true);
    expect(isRecruitingAddress("rh.nantes@acme.fr")).toBe(true);
    expect(isRecruitingAddress("jobs@acme.fr")).toBe(true);
    expect(isRecruitingAddress("contact@acme.fr")).toBe(false);
    expect(isRecruitingAddress("thomas@acme.fr")).toBe(false);
  });
});

describe("discoverLinks", () => {
  it("keeps same-site https contact/careers links", () => {
    const links = discoverLinks(
      `<a href="/nous-rejoindre">x</a><a href="https://www.acme.fr/contact?x=1#top">c</a>
       <a href="https://evil.com/contact">e</a><a href="/produits">p</a><a href="/mentions.pdf">m</a>`,
      new URL("https://www.acme.fr/"),
      "acme.fr",
    );
    expect(links).toEqual(["https://www.acme.fr/nous-rejoindre", "https://www.acme.fr/contact"]);
  });
});

describe("findEmailsOnWebsite", () => {
  it("follows a same-domain redirect, discovers the careers page and stops on a recruiting address", async () => {
    const fetchPage = vi.fn<PageFetcher>(async (url) => {
      const u = url.toString();
      if (u === "https://acme.fr/") return redirect("https://www.acme.fr/");
      if (u === "https://www.acme.fr/") {
        return html(`<a href="/carrieres">Carrières</a> contact@acme.fr`);
      }
      if (u === "https://www.acme.fr/carrieres") return html("Écrivez à recrutement@acme.fr");
      return notFound;
    });
    const found = await findEmailsOnWebsite("acme.fr", { fetchPage });
    expect(found).toEqual([
      { email: "contact@acme.fr", page: "https://www.acme.fr/" },
      { email: "recrutement@acme.fr", page: "https://www.acme.fr/carrieres" },
    ]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("refuses redirects to another domain or to http", async () => {
    const fetchPage = vi.fn<PageFetcher>(async (url) => {
      if (url.hostname === "acme.fr") return redirect("https://evil.com/");
      if (url.hostname === "www.acme.fr") return redirect("http://www.acme.fr/");
      return html("x@evil.com");
    });
    expect(await findEmailsOnWebsite("acme.fr", { fetchPage })).toEqual([]);
    expect(fetchPage.mock.calls.map(([u]) => u.hostname)).toEqual(["acme.fr", "www.acme.fr"]);
  });

  it("stops after too many redirects", async () => {
    let n = 0;
    const fetchPage = vi.fn<PageFetcher>(async () => redirect(`https://acme.fr/r${n++}`));
    expect(await findEmailsOnWebsite("acme.fr", { fetchPage })).toEqual([]);
    // 2 home attempts × (1 + 2 redirects)
    expect(fetchPage).toHaveBeenCalledTimes(6);
  });

  it("fetches at most MAX_PAGES pages and survives fetch errors", async () => {
    const fetchPage = vi.fn<PageFetcher>(async (url) => {
      if (url.pathname === "/") return html("rien");
      throw new Error("ECONNRESET");
    });
    expect(await findEmailsOnWebsite("acme.fr", { fetchPage })).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it("ignores non-HTML answers and invalid domains", async () => {
    const fetchPage = vi.fn<PageFetcher>(async () => ({
      status: 200,
      location: null,
      contentType: "application/pdf",
      body: "rh@acme.fr",
    }));
    expect(await findEmailsOnWebsite("acme.fr", { fetchPage })).toEqual([]);
    expect(await findEmailsOnWebsite("127.0.0.1", { fetchPage })).toEqual([]);
    expect(await findEmailsOnWebsite("localhost", { fetchPage })).toEqual([]);
  });

  it("respects the overall deadline", async () => {
    let t = 0;
    const fetchPage = vi.fn<PageFetcher>(async () => {
      t += 10_000;
      return html("rien");
    });
    await findEmailsOnWebsite("acme.fr", { fetchPage, now: () => t });
    expect(fetchPage.mock.calls.length).toBeLessThan(MAX_PAGES);
  });
});

describe("defaultPageFetcher", () => {
  it("refuses http and hostnames resolving to private addresses (checked in the socket lookup)", async () => {
    await expect(defaultPageFetcher(new URL("http://example.com/"))).rejects.toThrow("https only");
    await expect(defaultPageFetcher(new URL("https://localhost/"))).rejects.toMatchObject({
      code: "EBLOCKED",
    });
  });
});
