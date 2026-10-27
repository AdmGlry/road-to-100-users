/**
 * Landing copy (French, tutoiement). Every claim must stay true to what the
 * product does today (docs/HANDOFF.md): no invented figures, no testimonial.
 * Copy rule (DESIGN.md "Landing"): no hyphen in sentences, French compounds
 * that need one are rewritten.
 */

/** In-page sections of the floating navigation (ids of the landing sections). */
export const NAV_LINKS = [
  { href: "#fonctionnement", id: "fonctionnement", label: "Comment ça marche" },
  { href: "#garanties", id: "garanties", label: "Garanties" },
  { href: "#questions", id: "questions", label: "Questions" },
] as const;

export const HERO = {
  titleLines: ["20 candidatures spontanées", "en moins de 15 minutes."],
  subtitle:
    "Spontané trouve les entreprises près de chez toi qui n'ont publié aucune offre, rédige pour chacune un mail tiré de ton CV et range les réponses. Tu relis, tu valides, le mail part de ton Gmail.",
  cta: "Commencer avec Google",
  proof: "Bêta fermée pour les étudiants de l'IAE Nantes. Rien ne part sans ton clic.",
} as const;

export const PROBLEM = {
  title: "Les offres publiées, tout le monde y répond.",
  problem:
    "Une annonce d'alternance attire des candidats de toute la région. Les PME de ta ville qui n'ont rien publié, presque personne ne leur écrit. Leur écrire une par une prend des soirées : trouver l'entreprise, le bon contact, une accroche qui tient la route.",
  solution:
    "Spontané fait la recherche et le premier jet. Toi, tu gardes la main sur chaque mot qui part.",
} as const;

export type BenefitKey = "companies" | "mail" | "gmail" | "replies";

export const BENEFITS: readonly { key: BenefitKey; title: string; body: string }[] = [
  {
    key: "companies",
    title: "Des entreprises que personne ne démarche",
    body: "Spontané fouille le registre public des entreprises autour de toi et note chacune sur 100, avec deux ou trois raisons claires.",
  },
  {
    key: "mail",
    title: "Un mail qui part de ton parcours",
    body: "Chaque phrase vient de ton CV ou d'une source publique sur l'entreprise. Un contrôle automatique vérifie que chaque élément de ton profil cité dans la candidature existe bien.",
  },
  {
    key: "gmail",
    title: "Envoyé depuis ton Gmail, CV joint",
    body: "Une fois validé, le mail part de ta propre adresse avec ton CV en PDF. Les envois sont espacés et plafonnés à 20 par jour.",
  },
  {
    key: "replies",
    title: "Les réponses rangées pour toi",
    body: "Spontané lit seulement les réponses à tes candidatures et met ton tableau à jour. Sans réponse au bout de 7 jours, une relance t'est proposée.",
  },
];

/** Fictional companies of the "companies" benefit visual (labelled as such). */
export const SAMPLE_COMPANIES = [
  { name: "Atelier Loire Conseil", city: "Nantes", score: 87 },
  { name: "Brévin Logistique", city: "Orvault", score: 74 },
  { name: "Maison Garnier Fils", city: "Rezé", score: 61 },
] as const;

/** The real tracker columns (SPEC §8.4), drawn as the path a reply takes. */
export const TRACK = ["Envoyé", "Réponse reçue", "Entretien"] as const;

export const TAGLINE = [
  "Ta prochaine alternance n'est publiée nulle part.",
  "Spontané t'aide à frapper à la bonne porte.",
] as const;

export const STEPS = [
  {
    title: "Dépose ton CV et dis ce que tu cherches",
    body: "Alternance ou stage, métier, ville et rayon. Spontané lit ton CV et te montre ce qu'il a compris. Tu corriges ce qui ne va pas.",
  },
  {
    title: "Choisis tes entreprises",
    body: "Tu reçois jusqu'à 30 entreprises notées sur 100 avec leurs raisons. Tu coches celles qui te parlent, Spontané trouve un contact et prépare un mail pour chacune.",
  },
  {
    title: "Relis, valide, c'est parti",
    body: "Tu modifies, tu régénères ou tu ignores. Les mails validés partent de ton Gmail et les réponses arrivent dans ton tableau de suivi.",
  },
] as const;

export type RuleKey = "truth" | "consent" | "quota" | "gmail";

export const RULES: readonly { key: RuleKey; title: string; body: string }[] = [
  {
    key: "truth",
    title: "Rien n'est inventé",
    body: "L'IA n'écrit que ce qui figure dans ton profil ou dans une source publique sur l'entreprise. Aucune expérience, aucun diplôme, aucune compétence que tu n'as pas.",
  },
  {
    key: "consent",
    title: "Tu valides chaque mail",
    body: "Aucun envoi automatique. Tu relis, tu ajustes si besoin, et rien ne part sans ton clic. Les relances non plus.",
  },
  {
    key: "quota",
    title: "20 envois au maximum par jour",
    body: "Un plafond appliqué par nos serveurs, avec au moins 30 secondes entre deux envois, pour protéger ta boîte Gmail et ta réputation.",
  },
  {
    key: "gmail",
    title: "Ton Gmail, juste ce qu'il faut",
    body: "Spontané envoie tes candidatures et ne lit que les réponses qu'elles reçoivent. Tes accès sont chiffrés et tu peux les retirer depuis ton compte Google.",
  },
];

export const FAQ = [
  {
    q: "Spontané envoie des mails sans mon accord ?",
    a: "Non. Chaque mail attend ta validation. Tu le relis, tu le modifies si besoin, et rien ne part sans ton clic. C'est pareil pour les relances.",
  },
  {
    q: "D'où viennent les entreprises ?",
    a: "Du registre public des entreprises françaises, via l'API Recherche d'entreprises de l'État. Spontané garde celles qui sont proches de toi et dont l'activité colle à ce que tu cherches.",
  },
  {
    q: "Comment Spontané trouve à qui écrire ?",
    a: "Il cherche d'abord les adresses publiées sur le site de l'entreprise. Sinon, il propose les formats d'adresse les plus probables à partir du nom du dirigeant, après avoir vérifié que le domaine reçoit bien des mails. Tu peux toujours changer de contact ou saisir le tien.",
  },
  {
    q: "Mon CV est joint au mail ?",
    a: "Oui. Le mail part de ton Gmail avec ton CV en PDF en pièce jointe. Il apparaît dans tes messages envoyés, comme n'importe quel mail que tu écris.",
  },
  {
    q: "Que lit Spontané dans ma boîte Gmail ?",
    a: "Uniquement les réponses aux candidatures envoyées avec Spontané. Le reste de ta boîte n'est jamais lu. Tes accès sont chiffrés et tu peux les retirer depuis ton compte Google quand tu veux.",
  },
  {
    q: "L'IA peut inventer une expérience pour faire joli ?",
    a: "Non. Elle n'écrit que ce qui figure dans ton profil ou dans une source publique sur l'entreprise. Un contrôle automatique vérifie chaque candidature avant que tu la voies, et tu as le dernier mot.",
  },
  {
    q: "Pourquoi 20 envois au maximum par jour ?",
    a: "Pour protéger ta boîte Gmail. Beaucoup de mails envoyés d'un coup depuis une adresse personnelle finissent en spam. Les envois sont aussi espacés d'au moins 30 secondes.",
  },
  {
    q: "Et si une entreprise me répond ?",
    a: "Spontané range la réponse dans ton tableau de suivi : entretien, refus ou demande d'informations. Si un entretien est proposé, tu reçois un mail pour ne pas le rater.",
  },
  {
    q: "Qui peut utiliser Spontané ?",
    a: "Pour l'instant, les étudiants de l'IAE Nantes qui cherchent une alternance ou un stage, en bêta fermée. Il te faut un compte Google pour te connecter et envoyer depuis ton Gmail.",
  },
] as const;

export const CLOSING = {
  titleLines: ["Commence par ton CV.", "Le reste prend un quart d'heure."],
  reassurance: "Rien ne part sans ton clic. 20 envois au maximum par jour.",
} as const;
