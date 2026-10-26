/**
 * Geocoding of the student's city with the French government address API
 * (Base Adresse Nationale, no key). SERVER ONLY.
 *
 * Primary host: https://api-adresse.data.gouv.fr/search/ ; the same API is also
 * served by the IGN Géoplateforme (https://data.geopf.fr/geocodage/search), used
 * as a second try. Never throws: returns null when the city cannot be located.
 */
import { z } from "zod";

import { isValidPoint } from "@/lib/hunter/geo";

export const GEOCODE_URLS = [
  "https://api-adresse.data.gouv.fr/search/",
  "https://data.geopf.fr/geocodage/search",
] as const;
const TIMEOUT_MS = 8_000;

export type GeocodeResult = {
  lat: number;
  lng: number;
  city: string | null;
  postcode: string | null;
  /** Département code ("44", "2A", "974"), from the API context or the postcode. */
  departement: string | null;
};

export type GeocodeOptions = { fetch?: typeof fetch; timeoutMs?: number; urls?: readonly string[] };

const featureSchema = z.looseObject({
  geometry: z.looseObject({ coordinates: z.tuple([z.number(), z.number()]).rest(z.number()) }),
  properties: z
    .looseObject({
      city: z.string().nullish().catch(null),
      name: z.string().nullish().catch(null),
      postcode: z.string().nullish().catch(null),
      citycode: z.string().nullish().catch(null),
      context: z.string().nullish().catch(null),
      score: z.number().nullish().catch(null),
    })
    .catch({ city: null, name: null, postcode: null, citycode: null, context: null, score: null }),
});
const responseSchema = z.looseObject({ features: z.array(z.unknown()).catch([]) });

/** "44000" → "44", "20090" → "2A", "20200" → "2B", "97400" → "974". */
export function departementFromPostcode(postcode: string | null | undefined): string | null {
  if (!postcode || !/^\d{5}$/.test(postcode)) return null;
  if (postcode.startsWith("97") || postcode.startsWith("98")) return postcode.slice(0, 3);
  if (postcode.startsWith("20")) return Number(postcode) < 20200 ? "2A" : "2B";
  return postcode.slice(0, 2);
}

/** First 5-digit postcode written in a free-text city ("44000 Nantes" → "44000"). */
export function extractPostcode(value: string): string | null {
  return /\b(\d{5})\b/.exec(value)?.[1] ?? null;
}

/** "Saint-Herblain" → "saint herblain" (accents, case and punctuation ignored). */
function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The API always returns its best guess, even for "France" or a typo far from
 * any commune (e.g. "France" → Le Lamentin, Martinique). Keep a result only
 * when the commune name matches what the student typed, or the API is sure.
 */
export function isPlausibleMatch(
  query: string,
  name: string | null,
  score: number | null,
): boolean {
  const q = normalizeName(query.replace(/\b\d{5}\b/, ""));
  const n = normalizeName(name ?? "");
  if (q && n && (n === q || n.startsWith(`${q} `) || q.startsWith(`${n} `))) return true;
  return typeof score === "number" && score >= 0.8;
}

function departementFromContext(context: string | null | undefined): string | null {
  const first = context?.split(",")[0]?.trim();
  return first && /^(\d{2,3}|2A|2B)$/.test(first) ? first : null;
}

async function tryUrl(
  base: string,
  city: string,
  opts: GeocodeOptions,
): Promise<GeocodeResult | null> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const qs = new URLSearchParams({
    q: city.replace(/\b\d{5}\b/, "").trim() || city,
    type: "municipality",
    limit: "1",
  });
  const postcode = extractPostcode(city);
  if (postcode) qs.set("postcode", postcode);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await doFetch(`${base}?${qs.toString()}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = responseSchema.safeParse(await res.json());
    if (!body.success || body.data.features.length === 0) return null;
    const feature = featureSchema.safeParse(body.data.features[0]);
    if (!feature.success) return null;
    const [lng, lat] = feature.data.geometry.coordinates;
    if (!isValidPoint({ lat, lng })) return null;
    const p = feature.data.properties;
    if (!postcode && !isPlausibleMatch(city, p.city ?? p.name ?? null, p.score ?? null))
      return null;
    return {
      lat,
      lng,
      city: p.city ?? p.name ?? null,
      postcode: p.postcode ?? null,
      departement: departementFromContext(p.context) ?? departementFromPostcode(p.postcode),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function geocodeCity(
  city: string,
  opts: GeocodeOptions = {},
): Promise<GeocodeResult | null> {
  const q = city.trim();
  if (q.length < 2) return null;
  for (const base of opts.urls ?? GEOCODE_URLS) {
    const result = await tryUrl(base, q, opts);
    if (result) return result;
  }
  return null;
}
