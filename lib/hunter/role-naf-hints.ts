/**
 * Hand-written map: common student target roles → typical NAF rév. 2 codes.
 *
 * Keywords match whole words/phrases; a trailing "*" makes the last word a prefix
 * (e.g. "developpeu*" matches "développeuse").
 *
 * Used to pre-select candidates for the `map_naf` prompt and as a fallback when
 * the LLM is unavailable. Keywords are matched on normalized text (lowercase,
 * no accents, see normalizeText in lib/hunter/naf.ts). Every code is checked
 * against lib/data/naf.json in tests.
 */
export type RoleNafHint = { id: string; keywords: string[]; codes: string[] };

export const ROLE_NAF_HINTS: readonly RoleNafHint[] = [
  {
    id: "business_analyst",
    keywords: [
      "business analyst",
      "analyste metier",
      "analyste fonctionnel",
      "moa",
      "amoa",
      "consultant fonctionnel",
      "product owner",
      "consultant si",
      "systemes d information",
    ],
    codes: ["62.02A", "62.01Z", "70.22Z", "64.19Z", "65.12Z", "66.19B", "62.09Z"],
  },
  {
    id: "data",
    keywords: ["data", "donnees", "business intelligence", "bi", "statisti*", "machine learning"],
    codes: ["62.02A", "62.01Z", "63.11Z", "70.22Z", "73.20Z", "64.19Z", "62.09Z", "72.19Z"],
  },
  {
    id: "developer",
    keywords: [
      "developpeu*",
      "developer",
      "dev",
      "full stack",
      "fullstack",
      "front end",
      "frontend",
      "back end",
      "backend",
      "logiciel*",
      "software",
      "devops",
      "ingenieur informatique",
      "informatique",
      "web",
    ],
    codes: ["62.01Z", "62.02A", "58.29C", "58.29A", "63.11Z", "63.12Z", "62.09Z"],
  },
  {
    id: "cybersecurity",
    keywords: ["cyber*", "securite informatique", "securite des systemes", "pentest", "soc"],
    codes: ["62.02A", "62.03Z", "62.09Z", "80.20Z", "62.01Z"],
  },
  {
    id: "marketing",
    keywords: ["marketing", "growth", "chef de produit", "product marketing", "brand", "marque"],
    codes: ["73.11Z", "73.12Z", "70.21Z", "73.20Z", "70.22Z", "47.91B", "58.29C"],
  },
  {
    id: "communication",
    keywords: ["communication", "community manager", "relations presse", "contenu", "evenementiel"],
    codes: ["70.21Z", "73.11Z", "73.12Z", "74.10Z", "59.11B", "58.13Z"],
  },
  {
    id: "sales",
    keywords: [
      "commercial",
      "business developer",
      "business development",
      "vente",
      "vendeur",
      "sales",
      "charge d affaires",
      "account manager",
      "key account",
    ],
    codes: ["46.90Z", "46.69B", "46.51Z", "46.18Z", "70.22Z", "62.02A"],
  },
  {
    id: "hr",
    keywords: [
      "rh",
      "ressources humaines",
      "recrut*",
      "recruteur",
      "talent",
      "paie",
      "human resources",
      "charge de formation",
    ],
    codes: ["78.10Z", "78.20Z", "78.30Z", "70.22Z", "85.59A", "69.20Z"],
  },
  {
    id: "finance",
    keywords: [
      "finance",
      "financ*",
      "controle de gestion",
      "controleur de gestion",
      "audit",
      "tresorerie",
      "banque",
      "assurance",
      "risk",
      "risques",
    ],
    codes: ["64.19Z", "64.20Z", "64.30Z", "66.12Z", "66.19B", "65.12Z", "69.20Z", "70.10Z"],
  },
  {
    id: "accounting",
    keywords: ["comptab*", "comptable", "expert comptable", "accounting"],
    codes: ["69.20Z", "70.22Z", "64.19Z", "82.11Z"],
  },
  {
    id: "supply_chain",
    keywords: [
      "supply chain",
      "logistique",
      "logisticien",
      "transport*",
      "approvisionnement",
      "adv",
      "administration des ventes",
      "entrepot",
    ],
    codes: ["52.10B", "52.29A", "52.29B", "49.41A", "49.41B", "46.90Z"],
  },
  {
    id: "purchasing",
    keywords: ["achat*", "acheteur", "procurement", "sourcing"],
    codes: ["46.90Z", "70.22Z", "46.69B", "46.18Z", "46.14Z"],
  },
  {
    id: "legal",
    keywords: ["juridique", "juriste", "droit", "legal", "avocat", "compliance", "conformite"],
    codes: ["69.10Z", "70.22Z", "66.22Z", "65.12Z", "64.19Z"],
  },
  {
    id: "design*",
    keywords: ["ux", "ui", "design*", "designer", "graphiste", "graphisme", "webdesign"],
    codes: ["74.10Z", "62.01Z", "73.11Z", "58.29C", "63.12Z"],
  },
  {
    id: "project_manager",
    keywords: ["chef de projet", "project manager", "pmo", "gestion de projet", "consultant"],
    codes: ["70.22Z", "62.02A", "71.12B", "62.01Z"],
  },
];

/** Generic codes used when nothing else matches (consulting, IT services, advertising, accounting). */
export const GENERIC_FALLBACK_CODES: readonly string[] = ["70.22Z", "62.02A", "73.11Z", "69.20Z"];
