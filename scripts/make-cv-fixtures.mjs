/**
 * Generates the reference CV fixtures used by the Profile tests (SPEC §5).
 *
 * Usage (from the repo root):  node scripts/make-cv-fixtures.mjs
 *
 * Writes into tests/fixtures/cv/:
 *   - cv-business-analyst.pdf / .expected.json  (Master MSI, IAE Nantes, alternance)
 *   - cv-marketing.pdf / .expected.json         (Bachelor, stage)
 *   - cv-dev.pdf / .expected.json               (BUT informatique, alternance)
 *   - cv-scanned.pdf                            (almost no text: simulates a scanned CV)
 *
 * All people, e-mails, phone numbers and companies are FICTIONAL. Text is drawn
 * with pdf-lib StandardFonts (WinAnsi encoding): only characters WinAnsi can
 * encode are used (French accents are fine; no typographic apostrophes).
 * The expected JSON is derived from the same data as the PDF, so both always
 * agree. Dates are fixed so the output is reproducible.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as prettier from "prettier";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "tests", "fixtures", "cv");
const FIXED_DATE = new Date("2026-10-25T00:00:00Z");

/** @type {Array<{ file: string; headline: string; extra: Array<[string, string]>; profile: object }>} */
const CVS = [
  {
    file: "cv-business-analyst",
    headline:
      "Recherche d'une alternance Business Analyst à partir de septembre 2026 - rythme 3 semaines entreprise / 1 semaine école",
    extra: [
      ["CENTRES D'INTÉRÊT", "Course à pied, bénévolat dans une association d'aide aux devoirs."],
    ],
    profile: {
      full_name: "Léa Moreau",
      email: "lea.moreau@example.com",
      phone: "06 00 00 00 01",
      city: "Nantes",
      school: "IAE Nantes",
      degree: "Master MSI",
      skills: ["SQL", "Excel", "Power BI", "Jira", "Confluence", "UML", "BPMN", "Scrum"],
      experiences: [
        {
          title: "Assistante chef de projet MOA",
          company: "Banque Exemple Ouest",
          start: "avr. 2025",
          end: "juin 2025",
          bullets: [
            "Rédaction de spécifications fonctionnelles pour une application de gestion de crédits",
            "Animation d'ateliers de recueil des besoins avec les équipes métier",
            "Recette fonctionnelle et suivi des anomalies sous Jira",
          ],
        },
        {
          title: "Vendeuse en librairie",
          company: "Librairie du Centre",
          start: "juil. 2023",
          end: "août 2024",
          bullets: ["Conseil client, gestion de la caisse et des commandes"],
        },
      ],
      education: [
        {
          degree: "Master MSI",
          school: "IAE Nantes",
          start: "sept. 2025",
          end: "juin 2027",
        },
        {
          degree: "Licence Économie-Gestion",
          school: "Nantes Université",
          start: "sept. 2022",
          end: "juin 2025",
        },
      ],
      languages: [
        { language: "Anglais", level: "B2 (TOEIC 850)" },
        { language: "Espagnol", level: "notions" },
      ],
      pitch: null,
    },
  },
  {
    file: "cv-marketing",
    headline: "Recherche un stage de 6 mois en marketing digital à partir de janvier 2027",
    extra: [["CENTRES D'INTÉRÊT", "Photographie, cinéma, voyages en Italie."]],
    profile: {
      full_name: "Hugo Lefèvre",
      email: "hugo.lefevre@example.com",
      phone: "06 00 00 00 02",
      city: "Lyon",
      school: "Exemplia Business School",
      degree: "Bachelor Marketing Digital",
      skills: [
        "Canva",
        "Figma",
        "WordPress",
        "Google Analytics",
        "Meta Ads",
        "SEO",
        "Rédaction web",
      ],
      experiences: [
        {
          title: "Stagiaire marketing digital",
          company: "Maison Exemple Cosmétiques",
          start: "mai 2025",
          end: "juil. 2025",
          bullets: [
            "Création de contenus pour Instagram et TikTok (+35 % d'abonnés en 3 mois)",
            "Suivi des campagnes Meta Ads et reporting hebdomadaire",
          ],
        },
        {
          title: "Équipier polyvalent",
          company: "Restaurant Le Comptoir",
          start: "sept. 2023",
          end: "avr. 2025",
          bullets: ["Service en salle le week-end, encaissement et accueil des clients"],
        },
      ],
      education: [
        {
          degree: "Bachelor Marketing Digital",
          school: "Exemplia Business School",
          start: "sept. 2023",
          end: "juin 2026",
        },
        {
          degree: "Baccalauréat général",
          school: "Lycée Exemple de Lyon",
          start: null,
          end: "juin 2023",
        },
      ],
      languages: [
        { language: "Anglais", level: "C1" },
        { language: "Italien", level: "B1" },
      ],
      pitch: null,
    },
  },
  {
    file: "cv-dev",
    headline:
      "Recherche une alternance de développeuse web full-stack - rythme 2 semaines entreprise / 2 semaines école",
    extra: [
      ["PROJETS", "Application de covoiturage étudiant en React et Node.js (projet tutoré)."],
    ],
    profile: {
      full_name: "Inès Garnier",
      email: "ines.garnier@example.com",
      phone: "06 00 00 00 03",
      city: "Toulouse",
      school: "IUT Exemple de Toulouse",
      degree: "BUT Informatique",
      skills: [
        "JavaScript",
        "TypeScript",
        "React",
        "Node.js",
        "PostgreSQL",
        "Git",
        "Docker",
        "Python",
      ],
      experiences: [
        {
          title: "Développeuse web",
          company: "Startup Exemple SAS",
          start: "avr. 2026",
          end: "juin 2026",
          bullets: [
            "Développement d'une API REST en Node.js et TypeScript",
            "Mise en place de tests automatisés et d'une intégration continue",
          ],
        },
        {
          title: "Animatrice en centre de loisirs",
          company: "Mairie Exemple",
          start: "juil. 2024",
          end: "août 2025",
          bullets: ["Encadrement de groupes de 12 enfants pendant les vacances scolaires"],
        },
      ],
      education: [
        {
          degree: "BUT Informatique",
          school: "IUT Exemple de Toulouse",
          start: "sept. 2024",
          end: "aujourd'hui",
        },
        {
          degree: "Baccalauréat STI2D",
          school: "Lycée Exemple d'Albi",
          start: null,
          end: "juin 2024",
        },
      ],
      languages: [
        { language: "Anglais", level: "B2" },
        { language: "Allemand", level: "A2" },
      ],
      pitch: null,
    },
  },
];

// ---------------------------------------------------------------------------
// Layout helpers

const A4 = [595.28, 841.89];
const MARGIN = 50;

function wrap(text, font, size, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function dateRange(start, end) {
  if (start && end) return `${start} - ${end}`;
  return start ?? end ?? "";
}

async function newDoc(title) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor("Fixture Spontané (fictif)");
  doc.setProducer("scripts/make-cv-fixtures.mjs");
  doc.setCreator("scripts/make-cv-fixtures.mjs");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  return doc;
}

async function renderCv(cv) {
  const p = cv.profile;
  const doc = await newDoc(`CV ${p.full_name}`);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage(A4);
  const width = A4[0] - 2 * MARGIN;
  let y = A4[1] - MARGIN;

  const write = (text, { font = regular, size = 10.5, indent = 0, gap = 4 } = {}) => {
    for (const line of wrap(text, font, size, width - indent)) {
      y -= size;
      page.drawText(line, { x: MARGIN + indent, y, size, font, color: rgb(0.1, 0.1, 0.1) });
      y -= gap;
    }
  };
  const heading = (text) => {
    y -= 10;
    write(text, { font: bold, size: 12, gap: 2 });
    page.drawLine({
      start: { x: MARGIN, y: y - 1 },
      end: { x: MARGIN + width, y: y - 1 },
      thickness: 0.5,
      color: rgb(0.4, 0.4, 0.4),
    });
    y -= 6;
  };

  write(p.full_name, { font: bold, size: 20, gap: 6 });
  write(`${p.email} | ${p.phone} | ${p.city}`);
  write(cv.headline, { font: bold, size: 10.5 });

  heading("FORMATION");
  for (const e of p.education) {
    write(e.degree, { font: bold });
    write(`${e.school} | ${dateRange(e.start, e.end)}`);
  }

  heading("EXPÉRIENCES PROFESSIONNELLES");
  for (const x of p.experiences) {
    write(x.title, { font: bold });
    write(`${x.company} | ${dateRange(x.start, x.end)}`);
    for (const b of x.bullets) write(`- ${b}`, { indent: 10 });
  }

  heading("COMPÉTENCES");
  write(p.skills.join(", "));

  heading("LANGUES");
  write(p.languages.map((l) => `${l.language} : ${l.level}`).join(" ; "));

  for (const [title, text] of cv.extra) {
    heading(title);
    write(text);
  }

  return doc.save({ useObjectStreams: false });
}

/** A "scanned" CV: shapes standing in for a picture, and only a tiny text footer. */
async function renderScanned() {
  const doc = await newDoc("Scan");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(A4);
  page.drawRectangle({
    x: 40,
    y: 40,
    width: A4[0] - 80,
    height: A4[1] - 80,
    color: rgb(0.93, 0.93, 0.9),
  });
  for (let i = 0; i < 30; i++) {
    page.drawRectangle({
      x: 70,
      y: 760 - i * 22,
      width: 200 + ((i * 37) % 250),
      height: 7,
      color: rgb(0.35, 0.35, 0.35),
    });
  }
  page.drawText("Scan 001", { x: 50, y: 20, size: 8, font });
  return doc.save({ useObjectStreams: false });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const cv of CVS) {
    const pdf = await renderCv(cv);
    await writeFile(path.join(OUT_DIR, `${cv.file}.pdf`), pdf);
    const jsonPath = path.join(OUT_DIR, `${cv.file}.expected.json`);
    // Formatted like the rest of the repo so `npm run format:check` stays green.
    const options = (await prettier.resolveConfig(jsonPath)) ?? {};
    const json = await prettier.format(JSON.stringify(cv.profile), {
      ...options,
      filepath: jsonPath,
    });
    await writeFile(jsonPath, json);
    console.log(`wrote ${cv.file}.pdf (${pdf.length} bytes) + ${cv.file}.expected.json`);
  }
  const scanned = await renderScanned();
  await writeFile(path.join(OUT_DIR, "cv-scanned.pdf"), scanned);
  console.log(`wrote cv-scanned.pdf (${scanned.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
