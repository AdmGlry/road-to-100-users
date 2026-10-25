/**
 * LIVE test: runs the real LLM on the 3 reference CVs (SPEC §5 acceptance
 * "Aucun champ n'est inventé"). Skipped unless LLM_API_KEY is set, e.g.:
 *
 *   LLM_API_KEY=... LLM_MODEL_FAST=... LLM_MODEL_SMART=... npx vitest run tests/live
 *
 * Costs a few cents per run. Never logs CV content or model output.
 */
import { describe, expect, it } from "vitest";

import { normalizeForMatch } from "@/lib/profile/grounding";
import { extractProfileFromText } from "@/lib/profile/extract";
import { extractCvText } from "@/lib/profile/parse-cv";

import { CV_FIXTURES, readCvPdf, readExpected } from "../fixtures/cv";

const norm = (v: string | null) => (v === null ? null : normalizeForMatch(v));

describe.skipIf(!process.env.LLM_API_KEY)("extract_profile (live LLM)", () => {
  it.each(CV_FIXTURES)(
    "extracts %s without inventing anything",
    async (name) => {
      const expected = readExpected(name);
      const cvText = await extractCvText(readCvPdf(name));
      const started = Date.now();

      const { profile, removedCount } = await extractProfileFromText(cvText);

      expect(Date.now() - started).toBeLessThan(20_000); // SPEC §5: < 20 s
      expect(removedCount).toBe(0);
      expect(norm(profile.full_name)).toBe(norm(expected.full_name));
      expect(profile.email?.toLowerCase()).toBe(expected.email);
      expect(profile.phone?.replace(/\D/g, "")).toBe(expected.phone?.replace(/\D/g, ""));
      expect(norm(profile.city)).toBe(norm(expected.city));
      expect(profile.experiences).toHaveLength(expected.experiences.length);
      expect(profile.education).toHaveLength(expected.education.length);
      expect(profile.languages.map((l) => norm(l.language))).toEqual(
        expected.languages.map((l) => norm(l.language)),
      );
      // Every expected skill is found (the model may split/merge a few differently).
      const skills = new Set(profile.skills.map(normalizeForMatch));
      const found = expected.skills.filter((s) => skills.has(normalizeForMatch(s)));
      expect(found.length).toBeGreaterThanOrEqual(Math.ceil(expected.skills.length * 0.8));
    },
    60_000,
  );
});
