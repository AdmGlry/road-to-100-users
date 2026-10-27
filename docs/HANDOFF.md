# Passation — état du projet au 2026-10-27

À lire au début de chaque nouvelle session, après `AGENTS.md` et `SPEC.md`.

## Ce qui est en ligne

- Production : https://road-to-100-users.vercel.app (Vercel, équipe « road to users », projet `road-to-100-users`, déploiement auto de `main`, région des fonctions `dub1`).
- Branche de travail : une branche `claude/…` repartie de `main` → PR vers `main` (squash) une fois la CI verte. Sprints 3 et 4 fusionnés (PR #7 et #8, 2026-10-26).
- Sprints faits : 0 (fondations), 1 (profil), 1.5 (coach métiers), 2 (Chasseur : recherche + scoring), refonte visuelle (`DESIGN.md`) + passes mobile/finitions, 3 (Gmail, contacts, rédaction, relecture, envoi), 4 (Suivi : réponses, relances, Kanban). Détail dans `SPEC.md` §15–16.

## Infrastructure

| Service    | Détail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase   | Projet `road-to-100-users`, id `odoncbvspbeavoksxtrj` (eu-west-1). Migrations appliquées : init, connection_status_function, hunter_search, role_suggestions, sprint3_compose_send, send_queue_cron (job pg_cron `spontane-send-queue`, chaque minute), applications_client_guard, sprint4_tracker (jobs `spontane-sync-replies` toutes les heures et `spontane-followups` à 07:10 UTC). Vault : secrets `app_url` et `cron_secret` (même valeur que `CRON_SECRET` Vercel). Appliquer les nouvelles migrations via le connecteur Supabase (`apply_migration`) — écrire des migrations **non destructives** (pas de `drop`), l'outil bloque sinon. |
| Auth       | Google via Supabase. Site URL + redirect URLs configurées sur le domaine Vercel. Client OAuth Google Cloud créé par le propriétaire (mode Test).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Vercel env | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (clé publishable), `SUPABASE_SERVICE_KEY` (alias accepté de `SUPABASE_SERVICE_ROLE_KEY`, secret), `APP_URL`, `LLM_PROVIDER=openrouter`, `LLM_API_KEY` (secret, clé OpenRouter), `TOKEN_ENCRYPTION_KEY` et `CRON_SECRET` (sensibles, posés par l'agent), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` (saisis par le propriétaire), `LLM_MODEL_FAST`/`LLM_MODEL_SMART` = liste de repli `poolside/laguna-s-2.1:free,nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-31b-it:free`.                                                                         |
| LLM        | OpenRouter, modèles gratuits (privacy « free endpoints » activée par le propriétaire). Le routeur `openrouter/free` est à éviter (il tombe parfois sur un modèle de modération). Lents : 20–30 s/appel ; quota gratuit limité (≈50 req/jour sans crédits). Avant la bêta avec de vrais étudiants : modèle payant sans rétention (RGPD, SPEC §15).                                                                                                                                                                                                                                                                                                 |
| Réseau     | Depuis le conteneur de dev, `openrouter.ai`, `recherche-entreprises.api.gouv.fr`, `api-adresse.data.gouv.fr`, `x.com` et `*.vercel.app` sont bloqués : tester ces appels réels dans une **Vercel Sandbox** (connecteur Vercel) avec une politique réseau limitée aux domaines nécessaires.                                                                                                                                                                                                                                                                                                                                                        |

## Outillage agents

- `.claude/agents/qa-tester.md` : à lancer avant chaque fusion de sprint (PC 1440×900 + mobile 390×844, clair/sombre, sécurité/RGPD).
- `.claude/agents/email-deliverability.md` (risques spam/rebonds des envois Gmail) et `gdpr-reviewer.md` (RGPD) : relecteurs en lecture seule, adaptés de VoltAgent/awesome-claude-code-subagents (MIT). À lancer quand un sprint touche aux envois ou aux données personnelles.
- `.claude/skills/` : 10 skills design/QA relus et vendorisés (voir `.claude/skills/README.md` et chaque `SOURCE.md`). Impeccable sans son lanceur binaire (volontaire).
- `DESIGN.md` : système visuel obligatoire pour toute interface.
- Méthode qui marche : poser un contrat (types/signatures) → 2–3 agents en parallèle sur des fichiers disjoints → relecture → `qa-tester` → PR → fusion.

## Décisions du propriétaire à respecter

- La page d'accueil décrit déjà l'envoi Gmail et le suivi (Sprints 3–4) : **laisser tel quel**, ces fonctions doivent être prêtes avant l'arrivée des testeurs.
- Coach métiers guidé (pas de chat libre) ; chat libre éventuel avec le Coach V2.
- Ne jamais coller de secret dans le chat : le propriétaire saisit les clés lui-même dans Vercel/Supabase.

## Sprint 3 : état au moment de la passation (à reprendre en priorité)

En production depuis le 2026-10-26 (PR #7, squash). Les 3 migrations du sprint sont appliquées ; job `spontane-send-queue` actif ; advisors Supabase sans nouvelle alerte bloquante (`pg_net` dans `public` : extension Supabase non déplaçable, accepté ; `google_connection_status()` exécutable par `authenticated` : voulu). Passe `qa-tester` + skills design : aucun bloquant ; mineurs laissés : espacement 30 s non atomique entre deux workers (quota intact), signature envoyée au LLM (nom/téléphone), barre « Préparer » un peu haute sur mobile, `md:text-sm` des champs sur iPad.

Reste à faire :

1. Google Cloud : client OAuth dédié à Gmail (`776420792899-…`, ID + secret dans Vercel), accepté par Google le 2026-10-26. À confirmer dans **ce** projet : API Gmail activée, scopes `gmail.send` + `gmail.readonly` + `openid` + `email`, mode Test avec le propriétaire en utilisateur test. Ancien client (`286601366079-…`, Supabase Auth) : secret à remplacer dans Supabase (Authentication → Providers → Google) puis à supprimer.
2. Test réel : connecter Gmail dans Paramètres, préparer 1–2 candidatures, envoyer vers une adresse du propriétaire, vérifier le CV joint dans « Messages envoyés ». Erreurs : logs Vercel (`get_runtime_errors` puis `get_runtime_logs`).

Variables Vercel déjà en place pour ce sprint : `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.

## Sprint 4 : état au moment de la passation

En production depuis le 2026-10-26 (PR #8, squash ; migration `sprint4_tracker` appliquée, advisors Supabase sans nouvelle alerte). Relectures faites : `qa-tester`, `gdpr-reviewer`, `email-deliverability` ; bloquants et importants corrigés (données envoyées à l'IA réduites, espacement 30 s pour tous les envois, tri des rebonds, rotation des crons, garde client étendue).

Laissé pour plus tard (noté par les relecteurs) : mémoriser les adresses ayant rebondi au lieu de les supprimer + baisser la confiance des autres adresses devinées ; compteur de rebonds et alerte ; confiance des adresses dans la confirmation d'envoi ; contrôle « n'invente rien » automatique sur les relances ; nouvelle tentative d'une notification d'entretien échouée ; en-tête de la fenêtre de détail un peu haut sur mobile ; purge / durée de conservation des réponses (Sprint 5).

## Prochaine étape : Sprint 5 (feuille de route SPEC §13, décidée le 2026-10-26)

Ordre : Sprint 5 Fondations réelles + bêta minimale → 6 Pilote automatique + Radar → 7 Réponds en un geste → 8 Bêta testeurs + mémoires → 9 Coach. Positionnement : marché caché + l'IA s'occupe de tout jusqu'à l'entretien, validation d'un geste ; jamais de robot sur les job boards.

Sprint 5, en attente du propriétaire :

1. Test réel Gmail des Sprints 3–4 (connexion dans Paramètres, 1 candidature vers son adresse, réponse « entretien », synchronisation).
2. Crédit OpenRouter pour un modèle payant rapide + `LLM_DENY_DATA_COLLECTION=true` dans Vercel (saisis par le propriétaire).
3. Compte context.dev gratuit (clé saisie dans Vercel par le propriétaire) pour l'essai comparé de recherche de contacts.

Recherche web : désactivée (`WEBSEARCH_PROVIDER` absent = `none`). Pour l'activer : crédits OpenRouter (`openrouter`) ou clé Brave Search (`brave` + `BRAVE_SEARCH_API_KEY`).

## Mise à jour du 2026-10-27

- **Context.dev** (PR #10, fusionnée) : site officiel + page recrutement/contact des entreprises, avant la recherche web ; `CONTEXT_DEV_API_KEY` saisie par le propriétaire dans Vercel (production). Migration `company_pages` appliquée.
- **Page d'accueil refaite** (PR #11, branche `claude/sprint-3-gmail`, CI verte, **en attente de l'accord du propriétaire pour fusionner**) : skill `landing-page-design` (elayadesign) appliqué en entier, uniquement sur les pages marketing (`DESIGN.md` « Landing »). Les liens « Confidentialité » et « Conditions » du pied de page sont affichés « (bientôt) » : à brancher sur les pages RGPD du Sprint 5.
- **Décisions du propriétaire** :
  - rester sur les modèles gratuits OpenRouter pour l'instant (pas de budget) : le point « IA payante » du Sprint 5 attend ;
  - ne PAS faire le « Garant » (attestation d'un référent) ni le « Radar des réponses » (taux de réponse collectifs) proposés dans les rapports de recherche. Le « Radar » du Sprint 6 (signaux publics de recrutement) reste prévu ;
  - extension Chrome « copilote » et scraping Apify : non décidés, ne rien faire.
- **Reste du Sprint 5 à coder maintenant** : RGPD minimum (politique de confidentialité, conditions d'utilisation, export JSON, suppression de compte avec révocation Google + CV + toutes les lignes, purge après 12 mois d'inactivité), puis onboarding guidé en 3 étapes (CV → préférences → Gmail) et rappel de reconnexion Gmail.
- **En attente du propriétaire** : test réel Gmail (réponse + « Synchroniser maintenant »), corriger la ville du profil (« France ») et tester Context.dev sur 2 candidatures, configuration SMTP Brevo dans Supabase Auth.
