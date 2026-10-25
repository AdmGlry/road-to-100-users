# Spontané (road-to-100-users)

Plateforme qui aide les étudiants à décrocher une alternance ou un stage par la candidature spontanée.
Spécification complète : [`SPEC.md`](./SPEC.md). Règles pour les agents de code : [`AGENTS.md`](./AGENTS.md).

## Stack

Next.js 16 (App Router, TypeScript strict) · Tailwind CSS v4 + shadcn/ui · Supabase (Postgres, Auth, Storage) · Zod · Vitest · Vercel.

## Commandes

```bash
npm install          # installer les dépendances
npm run dev          # lancer en local sur http://localhost:3000
npm run lint         # vérifier le style du code
npm run typecheck    # vérifier les types TypeScript
npm test             # lancer les tests unitaires
bash supabase/tests/run.sh   # tester la migration + les règles RLS (DATABASE_URL requis)
```

## Arborescence

```
app/(marketing)/      page d'accueil publique
app/(app)/            zone connectée (dashboard, profil, chasseur, suivi, paramètres)
app/login, app/auth/  connexion Google via Supabase
lib/supabase/         clients Supabase (navigateur, serveur, service role)
lib/llm/              couche d'abstraction LLM (generateJson + fournisseurs)
lib/crypto.ts         chiffrement AES-256-GCM des tokens Google
lib/env.ts            lecture validée des variables d'environnement
supabase/migrations/  schéma SQL (tables, RLS, bucket cvs)
supabase/tests/       tests SQL des règles RLS
tests/                tests Vitest
```

## Checklist de configuration

### 1. Supabase

1. Ouvre ton projet sur [supabase.com](https://supabase.com) → **SQL Editor** → **New query**.
2. Copie-colle tout le contenu de `supabase/migrations/20261025000000_init.sql`, puis **Run**. Le message doit être « Success. No rows returned ».
3. **Project Settings → API** : note `Project URL`, la clé `anon` et la clé `service_role` (secrète).
4. **Authentication → URL Configuration** :
   - _Site URL_ : l'URL de production Vercel (ex. `https://road-to-100-users.vercel.app`).
   - _Redirect URLs_ : ajoute `http://localhost:3000/**`, `https://road-to-100-users.vercel.app/**` et `https://*.vercel.app/**` (déploiements de prévisualisation).
5. **Authentication → Providers → Google** : active-le et colle le _Client ID_ et le _Client Secret_ créés à l'étape 2. Copie l'URL « Callback URL (for OAuth) » affichée (forme `https://<ref>.supabase.co/auth/v1/callback`) : elle sert à l'étape 2.

### 2. Google Cloud (connexion Google)

1. [console.cloud.google.com](https://console.cloud.google.com) → nouveau projet `spontane`.
2. **APIs et services → Écran de consentement OAuth** : type _Externe_, nom « Spontané », ton e-mail en contact. Statut : _Test_. Dans _Utilisateurs de test_, ajoute ton adresse Gmail.
3. **Identifiants → Créer des identifiants → ID client OAuth** : type _Application Web_.
   - _Origines JavaScript autorisées_ : `http://localhost:3000` et ton URL Vercel.
   - _URI de redirection autorisés_ : l'URL Callback Supabase copiée à l'étape 1.5.
4. Copie le _Client ID_ et le _Client Secret_ dans Supabase (étape 1.5).

> L'API Gmail sera activée au Sprint 3, dans ce même projet Google.

### 3. Vercel

1. **Settings → Environment Variables** : ajoute pour _Production_, _Preview_ et _Development_ :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_URL` (ton URL Vercel)
2. **Deployments** → redéploie le dernier déploiement pour qu'il prenne les variables.

Les autres variables de `.env.example` seront nécessaires aux sprints suivants.

### 4. En local (optionnel)

```bash
cp .env.example .env.local   # puis remplis les valeurs
npm install && npm run dev
```

### 5. Tester que tout fonctionne

1. Ouvre l'URL Vercel → la page d'accueil s'affiche.
2. Clique « Commencer » → « Continuer avec Google » → choisis ton compte.
3. Tu arrives sur le tableau de bord avec « Bonjour <ton e-mail> ».
4. Dans Supabase → **Table Editor → profiles** : une ligne a été créée pour toi.
5. Déconnecte-toi → tu reviens sur l'accueil ; ouvrir `/dashboard` te renvoie vers la page de connexion.
