# Passation — état du projet au 2026-10-25

À lire au début de chaque nouvelle session, après `AGENTS.md` et `SPEC.md`.

## Ce qui est en ligne

- Production : https://road-to-100-users.vercel.app (Vercel, équipe « road to users », projet `road-to-100-users`, déploiement auto de `main`, région des fonctions `dub1`).
- Branche de travail : `claude/new-session-7pf86a` → PR vers `main` (squash) une fois la CI verte.
- Sprints faits : 0 (fondations), 1 (profil), 1.5 (coach métiers), 2 (Chasseur : recherche + scoring), refonte visuelle (`DESIGN.md`) + passes mobile/finitions, 3 (Gmail, contacts, rédaction, relecture, envoi). Détail dans `SPEC.md` §15–16.

## Infrastructure

| Service    | Détail                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase   | Projet `road-to-100-users`, id `odoncbvspbeavoksxtrj` (eu-west-1). Migrations appliquées : init, connection_status_function, hunter_search, role_suggestions, sprint3_compose_send, send_queue_cron (pg_cron job `spontane-send-queue`). Vault : secrets `app_url` et `cron_secret` (même valeur que `CRON_SECRET` Vercel). Appliquer les nouvelles migrations via le connecteur Supabase (`apply_migration`) — écrire des migrations **non destructives** (pas de `drop`), l'outil bloque sinon.                                                             |
| Auth       | Google via Supabase. Site URL + redirect URLs configurées sur le domaine Vercel. Client OAuth Google Cloud créé par le propriétaire (mode Test).                                                                                                                                                                                                                                                |
| Vercel env | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (clé publishable), `SUPABASE_SERVICE_KEY` (alias accepté de `SUPABASE_SERVICE_ROLE_KEY`, secret), `APP_URL`, `LLM_PROVIDER=openrouter`, `LLM_API_KEY` (secret, clé OpenRouter), `TOKEN_ENCRYPTION_KEY` et `CRON_SECRET` (sensibles, posés par l'agent), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` (saisis par le propriétaire), `LLM_MODEL_FAST`/`LLM_MODEL_SMART` = liste de repli `poolside/laguna-s-2.1:free,nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-31b-it:free`. |
| LLM        | OpenRouter, modèles gratuits (privacy « free endpoints » activée par le propriétaire). Le routeur `openrouter/free` est à éviter (il tombe parfois sur un modèle de modération). Lents : 20–30 s/appel ; quota gratuit limité (≈50 req/jour sans crédits). Avant la bêta avec de vrais étudiants : modèle payant sans rétention (RGPD, SPEC §15).                                               |
| Réseau     | Depuis le conteneur de dev, `openrouter.ai`, `recherche-entreprises.api.gouv.fr`, `api-adresse.data.gouv.fr`, `x.com` et `*.vercel.app` sont bloqués : tester ces appels réels dans une **Vercel Sandbox** (connecteur Vercel) avec une politique réseau limitée aux domaines nécessaires.                                                                                                      |

## Outillage agents

- `.claude/agents/qa-tester.md` : à lancer avant chaque fusion de sprint (PC 1440×900 + mobile 390×844, clair/sombre, sécurité/RGPD).
- `.claude/skills/` : 10 skills design/QA relus et vendorisés (voir `.claude/skills/README.md` et chaque `SOURCE.md`). Impeccable sans son lanceur binaire (volontaire).
- `DESIGN.md` : système visuel obligatoire pour toute interface.
- Méthode qui marche : poser un contrat (types/signatures) → 2–3 agents en parallèle sur des fichiers disjoints → relecture → `qa-tester` → PR → fusion.

## Décisions du propriétaire à respecter

- La page d'accueil décrit déjà l'envoi Gmail et le suivi (Sprints 3–4) : **laisser tel quel**, ces fonctions doivent être prêtes avant l'arrivée des testeurs.
- Coach métiers guidé (pas de chat libre) ; chat libre éventuel avec le Coach V2.
- Ne jamais coller de secret dans le chat : le propriétaire saisit les clés lui-même dans Vercel/Supabase.

## Prochaine étape : Sprint 4 (SPEC §8, §9)

1. Avant : valider le Sprint 3 en ligne avec un vrai compte Gmail de test (connexion dans Paramètres, préparer 1–2 candidatures, envoi vers une adresse du propriétaire, CV joint visible dans « Messages envoyés »).
2. Construire : cron `sync-replies` (lecture des seuls `gmail_thread_id`), `classify_reply`, relances (`compose_followup`, même thread), Kanban, notification d'entretien, workflow GitHub Actions (`CRON_SECRET` à ajouter aussi en secret GitHub).
3. Recherche web : désactivée (`WEBSEARCH_PROVIDER` absent = `none`). Pour l'activer : crédits OpenRouter (`openrouter`) ou clé Brave Search (`brave` + `BRAVE_SEARCH_API_KEY`).
