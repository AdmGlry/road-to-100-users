# AGENTS.md — Règles pour l'agent de code

Ce dépôt contient **Spontané** (nom provisoire) : une plateforme qui aide les étudiants à décrocher une alternance ou un stage grâce à la candidature spontanée automatisée (module Chasseur), au suivi automatique des réponses via Gmail (module Suivi) et, plus tard, à un coach d'entretien vocal (module Coach).

La spécification complète est dans `SPEC.md`. **Lis-la avant toute tâche.** Ne code que le sprint demandé.

## Contexte du propriétaire

- Le propriétaire du projet n'est pas développeur. Explique chaque étape importante en français simple à la fin de ta réponse : ce que tu as fait, comment le tester, ce qu'il doit configurer lui-même (clés, comptes, variables d'environnement).
- Quand une action manuelle est nécessaire (créer un projet Google Cloud, une base Supabase…), donne une checklist pas à pas.

## Stack imposée

- Next.js (App Router) + TypeScript strict
- Tailwind CSS + shadcn/ui pour l'interface
- Supabase : Postgres, Auth (Google), Storage (CV en PDF), Row Level Security activée sur toutes les tables
- API Gmail via `googleapis` (OAuth séparé de l'auth Supabase, voir SPEC §6)
- LLM via une couche d'abstraction unique `lib/llm/` (fournisseur et modèle configurables par variables d'environnement)
- Validation des données avec Zod, y compris des sorties JSON du LLM
- Déploiement sur Vercel ; tâches planifiées via un endpoint protégé appelé par un cron externe (SPEC §9)

## Conventions

- Code, noms de variables, tables et commits en anglais. Interface utilisateur et textes générés en français.
- Un dossier par module : `app/(app)/profile`, `app/(app)/hunter`, `app/(app)/tracker`, `app/(app)/coach`.
- Logique métier dans `lib/` (pas dans les composants). Appels externes isolés dans `lib/integrations/` (gmail, companies, websearch, dns).
- Tous les prompts LLM dans `lib/llm/prompts/`, un fichier par prompt, versionnés (constante `PROMPT_VERSION`).
- Migrations SQL dans `supabase/migrations/`. Jamais de modification manuelle du schéma sans migration.
- Pas de secret dans le code. Toute nouvelle variable d'environnement est ajoutée à `.env.example` avec un commentaire.

## Règles de sécurité et RGPD (non négociables)

- Les tokens Google (access et refresh) sont chiffrés au repos (AES-256-GCM, clé `TOKEN_ENCRYPTION_KEY`) et ne quittent jamais le serveur.
- RLS : un utilisateur ne voit que ses propres lignes. Le rôle service n'est utilisé que côté serveur (cron, routes API).
- Aucun mail n'est envoyé sans validation explicite de l'utilisateur en V1. Plafond de 20 envois par utilisateur et par jour, appliqué côté serveur.
- Le LLM ne doit jamais inventer d'expérience, de diplôme ou de compétence absents du profil. Chaque prompt de génération le rappelle explicitement.
- Suppression de compte = suppression de toutes les données (profil, CV, mails, tokens) et révocation du token Google.
- Ne jamais logger le contenu des mails, des CV ou des tokens.

## Qualité

- Chaque sprint se termine avec : `npm run lint`, `npm run typecheck` et `npm test` qui passent.
- Tests unitaires (Vitest) pour la logique métier : parsing, scoring, devinette d'adresses mail, classification, quotas.
- Les intégrations externes sont mockées dans les tests.
- Mets à jour la section « Avancement » en bas de `SPEC.md` à la fin de chaque sprint.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
