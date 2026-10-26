# SPEC.md — Spontané (nom provisoire)

> Plateforme qui aide les étudiants à décrocher une alternance ou un stage.
> **Chasseur** : trouve des entreprises qui n'ont pas publié d'offre et envoie des candidatures spontanées personnalisées.
> **Suivi** : lit les réponses dans Gmail et met à jour le tableau de bord tout seul.
> **Coach** (V2) : simulation d'entretien vocale calée sur l'entreprise.

---

## 1. Objectifs et périmètre

### Objectif de la V1

Permettre à un étudiant d'envoyer **20 candidatures spontanées ciblées et personnalisées en moins de 15 minutes**, puis de suivre les réponses sans rien saisir à la main.

### Utilisateurs de la V1

10 à 50 étudiants (bêta fermée, IAE Nantes). Google limite l'accès Gmail à 100 utilisateurs de test tant que l'application n'est pas vérifiée (voir §6.3).

### Hors périmètre de la V1

- Candidature automatique sur LinkedIn, Indeed, Welcome to the Jungle, APEC ou les sites carrières (interdit par leurs règles, fragile)
- Envoi sans validation humaine
- Paiement, abonnement
- Application mobile
- Outlook / autres boîtes mail que Gmail

### Indicateurs de succès (mesurés dans l'app)

- Temps entre l'upload du CV et le premier envoi : moins de 15 min
- Taux de réponse aux candidatures : objectif 10 % ou plus
- Taux d'entretiens obtenus : objectif 3 % ou plus des mails envoyés
- Taux de mails générés envoyés sans modification : objectif 50 % ou plus (indicateur de qualité de l'IA)

---

## 2. Parcours utilisateur

1. **Inscription** avec Google (Supabase Auth).
2. **Profil** : upload du CV en PDF. L'IA en extrait un profil structuré que l'étudiant vérifie et corrige. Il indique ses préférences de recherche.
3. **Connexion Gmail** : écran dédié qui explique pourquoi on demande l'accès (envoyer les candidatures, lire uniquement les réponses à ces candidatures).
4. **Chasse** : l'étudiant lance une recherche. La plateforme propose une liste d'entreprises notées par compatibilité. Il coche celles qui l'intéressent.
5. **Préparation** : pour chaque entreprise cochée, la plateforme trouve un contact, recherche l'actualité de l'entreprise et rédige un mail.
6. **Relecture et envoi** : l'étudiant relit chaque mail (modifier, régénérer, ignorer) puis valide. Envoi depuis son Gmail, CV en pièce jointe.
7. **Suivi** : tableau Kanban (Envoyé → Réponse reçue → Entretien → Refus / Sans réponse). Mise à jour automatique toutes les heures.
8. **Relance** : 7 jours sans réponse → une relance rédigée est proposée, à valider.
9. **Entretien détecté** → notification par mail à l'étudiant (et, en V2, proposition de simulation avec le Coach).

---

## 3. Architecture

```
Navigateur (Next.js, React)
   │
   ▼
Next.js sur Vercel ── routes serveur / server actions
   │        │            │              │               │
   ▼        ▼            ▼              ▼               ▼
Supabase  API LLM    API Gmail    API Recherche     Recherche web
(Postgres,           (googleapis) d'entreprises     (outil web search
 Auth,                            (data.gouv)        du fournisseur LLM)
 Storage)
   ▲
   │
Cron externe (GitHub Actions, toutes les heures) → POST /api/cron/* (secret)
```

### Arborescence cible

```
app/
  (marketing)/page.tsx            landing
  (app)/layout.tsx                zone connectée
  (app)/onboarding/               étapes profil + Gmail
  (app)/profile/
  (app)/hunter/                   recherche, sélection, relecture
  (app)/tracker/                  kanban + détail candidature
  (app)/settings/                 compte, déconnexion Gmail, suppression
  api/google/oauth/start/route.ts
  api/google/oauth/callback/route.ts
  api/cron/sync-replies/route.ts
  api/cron/followups/route.ts
lib/
  llm/            client.ts, prompts/*.ts, schemas.ts
  integrations/   gmail.ts, companies.ts, websearch.ts, dns.ts
  hunter/         search.ts, scoring.ts, contacts.ts, research.ts, compose.ts, send.ts
  tracker/        sync.ts, classify.ts, followups.ts
  profile/        parse-cv.ts
  crypto.ts       chiffrement des tokens
  quotas.ts
supabase/migrations/
tests/
```

---

## 4. Modèle de données (Postgres / Supabase)

Toutes les tables ont `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`, et une policy RLS `user_id = auth.uid()` (sauf mention).

### `profiles`

| Colonne          | Type                                     | Notes                                              |
| ---------------- | ---------------------------------------- | -------------------------------------------------- |
| user_id          | uuid fk auth.users, unique               |                                                    |
| full_name        | text                                     |                                                    |
| email            | text                                     |                                                    |
| phone            | text null                                |                                                    |
| city             | text                                     |                                                    |
| school           | text                                     |                                                    |
| degree           | text                                     | ex. « Master MSI »                                 |
| contract_type    | enum `alternance`, `stage`, `cdi`, `cdd` |                                                    |
| rhythm           | text null                                | ex. « 3 semaines entreprise / 1 semaine école »    |
| start_date       | date null                                |                                                    |
| target_roles     | text[]                                   | ex. {« Business Analyst », « Chef de projet MOA »} |
| target_sectors   | text[]                                   |                                                    |
| search_radius_km | int default 30                           |                                                    |
| skills           | text[]                                   |                                                    |
| experiences      | jsonb                                    | `[{title, company, start, end, bullets[]}]`        |
| education        | jsonb                                    | `[{degree, school, start, end}]`                   |
| languages        | jsonb                                    | `[{language, level}]`                              |
| pitch            | text                                     | 2–3 phrases, éditable                              |
| cv_storage_path  | text                                     | bucket privé `cvs`                                 |
| cv_text          | text                                     | texte brut extrait                                 |

### `google_connections`

| Colonne           | Type                                | Notes   |
| ----------------- | ----------------------------------- | ------- |
| user_id           | uuid unique                         |         |
| google_email      | text                                |         |
| access_token_enc  | text                                | chiffré |
| refresh_token_enc | text                                | chiffré |
| scopes            | text[]                              |         |
| expires_at        | timestamptz                         |         |
| status            | enum `active`, `expired`, `revoked` |         |
| last_sync_at      | timestamptz null                    |         |

RLS : aucun accès client direct (lecture du statut via une vue `google_connection_status` sans les tokens).

### `searches`

| Colonne       | Type                             | Notes                                            |
| ------------- | -------------------------------- | ------------------------------------------------ |
| user_id       | uuid                             |                                                  |
| params        | jsonb                            | rôles, secteurs, codes NAF, ville, rayon, taille |
| status        | enum `running`, `done`, `failed` |                                                  |
| results_count | int                              |                                                  |

### `companies` (cache partagé, pas de RLS par utilisateur, lecture authentifiée, écriture serveur)

| Colonne                    | Type             | Notes                                            |
| -------------------------- | ---------------- | ------------------------------------------------ |
| siren                      | text unique      |                                                  |
| name                       | text             |                                                  |
| naf_code                   | text             |                                                  |
| naf_label                  | text             |                                                  |
| headcount_range            | text             |                                                  |
| address, postal_code, city | text             |                                                  |
| lat, lng                   | float null       |                                                  |
| website                    | text null        | trouvé par recherche web                         |
| domain                     | text null        |                                                  |
| leaders                    | jsonb            | `[{first_name, last_name, role}]` issus de l'API |
| raw                        | jsonb            | réponse API brute                                |
| enriched_at                | timestamptz null |                                                  |

### `leads` (une entreprise proposée à un utilisateur)

| Colonne     | Type                                                         | Notes               |
| ----------- | ------------------------------------------------------------ | ------------------- |
| user_id     | uuid                                                         |                     |
| search_id   | uuid                                                         |                     |
| company_id  | uuid fk companies                                            |                     |
| fit_score   | int 0–100                                                    |                     |
| fit_reasons | text[]                                                       | 2–3 raisons courtes |
| status      | enum `suggested`, `selected`, `dismissed`, `drafted`, `sent` |                     |

### `contacts`

| Colonne               | Type                                                     | Notes |
| --------------------- | -------------------------------------------------------- | ----- |
| lead_id               | uuid                                                     |       |
| first_name, last_name | text null                                                |       |
| role                  | text null                                                |       |
| email                 | text                                                     |       |
| source                | enum `pattern_guess`, `generic`, `user_input`, `website` |       |
| confidence            | enum `low`, `medium`, `high`                             |       |

### `applications`

| Colonne          | Type                                                                                        | Notes                                      |
| ---------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| user_id          | uuid                                                                                        |                                            |
| lead_id          | uuid                                                                                        |                                            |
| contact_id       | uuid                                                                                        |                                            |
| subject          | text                                                                                        |                                            |
| body             | text                                                                                        |                                            |
| company_insight  | text                                                                                        | l'accroche utilisée (actu de l'entreprise) |
| prompt_version   | text                                                                                        |                                            |
| edited_by_user   | bool                                                                                        |                                            |
| status           | enum `draft`, `approved`, `sent`, `replied`, `interview`, `rejected`, `no_reply`, `bounced` |                                            |
| gmail_message_id | text null                                                                                   |                                            |
| gmail_thread_id  | text null                                                                                   |                                            |
| sent_at          | timestamptz null                                                                            |                                            |
| last_reply_at    | timestamptz null                                                                            |                                            |
| next_followup_at | timestamptz null                                                                            |                                            |
| followup_count   | int default 0                                                                               | max 1 en V1                                |

### `replies`

| Colonne                   | Type                                                                                             | Notes              |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ------------------ |
| application_id            | uuid                                                                                             |                    |
| gmail_message_id          | text unique                                                                                      |                    |
| received_at               | timestamptz                                                                                      |                    |
| from_email                | text                                                                                             |                    |
| snippet                   | text                                                                                             | 200 caractères max |
| classification            | enum `interview`, `rejection`, `info_request`, `positive_other`, `auto_reply`, `bounce`, `other` |                    |
| classification_confidence | float                                                                                            |                    |
| suggested_action          | text                                                                                             |                    |

### `send_log` (quotas)

`user_id`, `application_id`, `sent_at`. Le quota se calcule sur les 24 dernières heures.

### `events` (analytics simples)

`user_id`, `name` (ex. `cv_uploaded`, `search_started`, `mail_sent`, `reply_received`), `props jsonb`.

---

## 5. Module Profil

### 5.1 Upload et parsing

- Upload PDF uniquement, 5 Mo max, stocké dans le bucket privé `cvs/{user_id}/cv.pdf`.
- Extraction du texte côté serveur (`pdf-parse` ou `unpdf`). Si le texte fait moins de 200 caractères (CV scanné) → message clair demandant un PDF texte.
- Appel LLM `extract_profile` → JSON validé par Zod → pré-remplit le formulaire.

### 5.2 Prompt `extract_profile`

```
Tu extrais un profil structuré d'un CV d'étudiant français.
Règles :
- N'invente rien. Si une information est absente, mets null ou une liste vide.
- Garde les intitulés tels qu'ils apparaissent.
- "pitch" : 2 phrases maximum, à la première personne, factuelles, basées uniquement sur le CV.
Réponds uniquement avec un JSON conforme au schéma fourni.
CV :
<<<{cv_text}>>>
```

### 5.3 Écran profil

- Formulaire éditable (toutes les colonnes de `profiles`), sauvegarde automatique.
- Préférences : type de contrat, rythme, date de début, rôles visés (tags), secteurs (tags), ville + rayon.
- Bouton « Remplacer mon CV » (relance le parsing et propose les changements sans écraser les corrections déjà faites).

### Critères d'acceptation

- [ ] Un CV PDF texte donne un profil pré-rempli en moins de 20 secondes.
- [ ] Aucun champ n'est inventé (test avec 3 CV de référence dans `tests/fixtures/`).
- [ ] Le CV n'est accessible qu'à son propriétaire (test RLS + storage policy).

---

## 6. Connexion Gmail

### 6.1 Flux OAuth (séparé de la connexion Supabase)

- `GET /api/google/oauth/start` → redirige vers Google avec `access_type=offline`, `prompt=consent`, `state` signé (anti-CSRF).
- Scopes : `https://www.googleapis.com/auth/gmail.send`, `https://www.googleapis.com/auth/gmail.readonly`, `openid`, `email`.
- `GET /api/google/oauth/callback` → échange le code, chiffre et stocke les tokens dans `google_connections`.
- Rafraîchissement automatique de l'access token avant chaque appel. En cas d'erreur `invalid_grant` → statut `expired`, bannière « Reconnecte ton Gmail ».

### 6.2 Principe de lecture minimale

On ne lit **que les threads des mails envoyés par la plateforme** (via `gmail_thread_id`). Jamais de recherche dans toute la boîte. À afficher clairement sur l'écran de consentement de l'app.

### 6.3 Contraintes Google à connaître (à expliquer au propriétaire)

- Tant que l'application est en mode « Test » dans Google Cloud, seuls 100 utilisateurs ajoutés manuellement peuvent se connecter.
- En mode « Test », **les refresh tokens expirent au bout de 7 jours** : les utilisateurs devront reconnecter Gmail chaque semaine. Prévoir la bannière et un mail de rappel.
- Pour sortir du mode test avec `gmail.readonly` (scope restreint), Google impose une vérification et un audit de sécurité payant. C'est hors périmètre de la V1.

### Critères d'acceptation

- [ ] Connexion, déconnexion et reconnexion Gmail fonctionnent.
- [ ] Les tokens sont chiffrés en base (vérifiable : la colonne ne contient pas de chaîne commençant par `ya29.` ou `1//`).
- [ ] Un token expiré affiche la bannière sans faire planter l'app.

---

## 7. Module Chasseur

### 7.1 Recherche d'entreprises

Source principale : **API Recherche d'entreprises** (`https://recherche-entreprises.api.gouv.fr`), gratuite et sans clé.

- Endpoints à utiliser : `/search` (filtres : `activite_principale` = code NAF, `code_postal` ou `departement`, `tranche_effectif_salarie`, `etat_administratif=A`) et `/near_point` (lat, long, rayon) si disponible. **Vérifier la doc officielle et les limites de débit** (de l'ordre de quelques requêtes par seconde) ; ajouter un limiteur.
- Étape préalable : le LLM convertit les rôles et secteurs visés en une liste de **codes NAF** pertinents (prompt `map_naf`, sortie validée contre une liste de codes NAF stockée dans `lib/data/naf.json`).
- Exclure : entreprises fermées, effectif 0 ou inconnu (option), entreprises déjà contactées par l'utilisateur.
- Source secondaire (optionnelle, sprint 3 ou plus tard) : API de La Bonne Alternance pour les entreprises à fort potentiel d'embauche en alternance. Nécessite une inscription pour obtenir un jeton ; vérifier les conditions d'utilisation.
- Mise en cache dans `companies` (clé SIREN).

### 7.2 Scoring de compatibilité

Deux étapes pour limiter les coûts :

1. **Pré-filtre déterministe** (sans LLM) : distance, taille, correspondance NAF. Garde les 60 meilleures.
2. **Scoring LLM** par lots de 10 (prompt `score_fit`) → `fit_score` 0–100 + 2–3 raisons courtes. On affiche les 30 meilleures.

Prompt `score_fit` :

```
Tu évalues si des entreprises sont de bonnes cibles de candidature spontanée pour cet étudiant.
Profil : {profil résumé : rôles visés, compétences, contrat, ville}
Entreprises : {liste : siren, nom, activité NAF, effectif, ville}
Pour chaque entreprise, donne un score de 0 à 100 et 2 à 3 raisons très courtes (max 8 mots chacune).
Critères : probabilité que l'entreprise ait besoin de ce profil, taille suffisante pour accueillir un alternant/stagiaire, cohérence avec le secteur visé.
Ne suppose aucune information que tu n'as pas. Réponds en JSON.
```

### 7.3 Écran de sélection

- Liste de cartes : nom, activité, ville, distance, effectif, score, raisons.
- Actions : cocher, ignorer, « voir plus ». Bouton « Préparer N candidatures ».
- Filtres : score minimum, taille, distance.

### 7.4 Enrichissement : site, contact, actualité

Pour chaque lead sélectionné (traitement en file, statut visible à l'écran) :

1. **Site web et domaine** : recherche web « {nom} {ville} site officiel » via l'outil de recherche web du fournisseur LLM. Valider que le domaine n'est pas un annuaire (liste d'exclusion : societe.com, pagesjaunes.fr, linkedin.com, pappers.fr, etc.).
2. **Contact** (`lib/hunter/contacts.ts`), par ordre de priorité :
   - a. Adresse de recrutement trouvée sur le site (page carrières, contact, mentions légales) → `source=website`, `confidence=high`.
   - b. Dirigeant issu de l'API (champ dirigeants) + formats probables : `prenom.nom@`, `p.nom@`, `prenom@`, `nom@` → `source=pattern_guess`. Vérifier que le domaine a un enregistrement **MX** (requête DNS). Pas de vérification SMTP (« ping » de boîte mail). `confidence=medium` pour `prenom.nom`, `low` pour les autres.
   - c. Adresses génériques : `recrutement@`, `rh@`, `contact@` → `source=generic`, `confidence=low`.
   - L'utilisateur peut toujours remplacer l'adresse (`source=user_input`).
   - Pour une PME de moins de 50 salariés, privilégier le dirigeant. Au-delà, privilégier recrutement/RH.
3. **Actualité / accroche** (`lib/hunter/research.ts`) : recherche web limitée à 3 résultats récents sur l'entreprise. Le LLM en tire **une seule accroche factuelle** avec sa source (URL). Si rien de fiable → accroche basée sur l'activité de l'entreprise. Jamais d'information inventée.

### 7.5 Rédaction du mail (prompt `compose_application`)

```
Tu rédiges une candidature spontanée par mail, en français, pour un étudiant.
Profil de l'étudiant : {profil complet}
Entreprise : {nom, activité, ville, taille}
Contact : {prénom nom, rôle} ou "inconnu"
Accroche vérifiée : {accroche + source} ou "aucune"
Type de contrat recherché : {alternance/stage}, rythme : {rythme}, début : {date}

Règles :
- 90 à 130 mots (réduit de 120–180 le 2026-10-26 après le premier test réel : trop long sur téléphone). Ton professionnel, direct, sans formules creuses ("dynamique", "motivé", "rigoureux" interdits sans preuve).
- Structure : 1) accroche liée à l'entreprise ; 2) qui je suis et ce que je cherche (contrat, rythme, date) ; 3) deux preuves concrètes tirées du profil, liées à l'activité de l'entreprise ; 4) appel à l'action simple (échange de 15 minutes).
- N'invente AUCUNE expérience, compétence, diplôme ou chiffre absent du profil.
- N'utilise l'accroche que si elle est fournie ; sinon, parle de l'activité de l'entreprise.
- Objet : moins de 70 caractères, précis (ex. "Alternance Business Analyst – sept. 2027 – {Entreprise}").
- Si le contact est connu : "Bonjour {Prénom} {Nom}," ; sinon "Bonjour,".
- Signature : prénom nom, formation, école, téléphone si présent.
Réponds en JSON : { "subject": string, "body": string, "claims_used": string[] }
```

`claims_used` liste les éléments du profil utilisés. Un contrôle automatique vérifie que chaque élément existe bien dans le profil ; sinon, régénération (1 fois max) puis signalement à l'utilisateur.

### 7.6 Écran de relecture et envoi

- Vue en liste : entreprise, contact (avec badge de confiance), objet, corps éditable.
- Actions par mail : modifier, régénérer, changer de contact, ignorer, valider.
- Bouton « Envoyer les N mails validés ». Affiche le quota restant (20 par 24 h).
- Envoi : `users.messages.send` en MIME (texte brut + version HTML simple), CV PDF en pièce jointe nommé `CV_{Prenom}_{Nom}.pdf`. Stocker `gmail_message_id` et `gmail_thread_id`.
- Espacement des envois : 30 à 90 secondes aléatoires entre deux mails (file côté serveur), pour un comportement naturel.
- Gestion d'erreur : échec d'envoi → statut `draft` conservé + message clair.

### Critères d'acceptation

- [ ] Une recherche « Business Analyst, alternance, Nantes, 30 km » renvoie au moins 20 entreprises pertinentes notées.
- [ ] Chaque mail généré fait 90 à 130 mots et ne contient aucune affirmation absente du profil (test sur 10 générations).
- [ ] Le quota de 20 envois par 24 h est appliqué côté serveur (test unitaire + test d'intégration).
- [ ] Un mail envoyé apparaît dans « Messages envoyés » du Gmail de l'utilisateur, avec le CV joint.
- [ ] Une entreprise déjà contactée n'est plus proposée.

---

## 8. Module Suivi

### 8.1 Synchronisation (cron toutes les heures)

`POST /api/cron/sync-replies` (en-tête `Authorization: Bearer ${CRON_SECRET}`) :

1. Pour chaque utilisateur avec Gmail `active` et au moins une candidature `sent` des 60 derniers jours.
2. Pour chaque `gmail_thread_id` concerné : `users.threads.get` (format `metadata` d'abord, `full` seulement pour les nouveaux messages reçus).
3. Nouveau message dont l'expéditeur n'est pas l'utilisateur → insérer dans `replies` → classification LLM.
4. Mettre à jour le statut de la candidature selon la classification.
5. Mettre à jour `last_sync_at`. Traiter les utilisateurs par lots ; reprendre proprement en cas d'erreur sur un utilisateur.

### 8.2 Classification (prompt `classify_reply`)

```
Classe cette réponse à une candidature spontanée.
Catégories : interview (proposition d'entretien ou d'appel), rejection, info_request (demande de documents ou de précisions), positive_other, auto_reply (absence, accusé de réception automatique), bounce (adresse invalide), other.
Donne : category, confidence (0-1), suggested_action (1 phrase en français pour l'étudiant).
Message : <<<{texte du message, signature et historique retirés, 2000 caractères max}>>>
```

Règles de mise à jour :

- `interview` → statut `interview` + **mail de notification** à l'étudiant (via Resend ou via son propre Gmail en s'envoyant le mail à lui-même).
- `rejection` → `rejected`.
- `bounce` → `bounced` + proposer un autre contact.
- `auto_reply` → pas de changement de statut.
- `info_request`, `positive_other`, `other` → `replied`.

### 8.3 Relances

`POST /api/cron/followups` (une fois par jour) :

- Candidatures `sent`, sans réponse, envoyées il y a 7 jours ou plus, `followup_count = 0` → générer une relance (prompt `compose_followup`, 50 à 80 mots, dans le même thread) en brouillon.
- L'utilisateur la valide depuis le tableau de bord. Envoi dans le même thread (`threadId` + en-têtes `In-Reply-To` / `References`).
- Après 21 jours sans réponse et une relance → statut `no_reply`.

### 8.4 Tableau de bord

- Kanban : Envoyé · Réponse reçue · Entretien · Refus · Sans réponse (glisser-déposer pour corriger manuellement).
- Détail d'une candidature : mail envoyé, réponses (extraits), classification, action suggérée, bouton « Ouvrir dans Gmail ».
- Bandeau de statistiques : envoyés, taux de réponse, entretiens, relances en attente.

### Critères d'acceptation

- [ ] Une réponse reçue dans Gmail apparaît dans le tableau de bord en moins d'une heure.
- [ ] Classification correcte sur au moins 9 des 10 exemples de `tests/fixtures/replies/`.
- [ ] Une relance s'envoie dans le même fil de discussion Gmail.
- [ ] Le cron est idempotent : deux exécutions de suite ne créent aucun doublon.

---

## 9. Tâches planifiées

- Vercel Hobby limite les crons. Solution V1 : **GitHub Actions** (`.github/workflows/cron.yml`) qui appelle les endpoints avec `curl` et le secret `CRON_SECRET` :
  - `sync-replies` : toutes les heures
  - `followups` : tous les jours à 9 h (heure de Paris)
  - `token-reminder` : tous les jours, prévient les utilisateurs dont la connexion Gmail expire bientôt (mode test Google)
- Chaque endpoint a un délai max ; au-delà, il traite un lot et reprend au prochain appel.

---

## 10. Module Coach (V2, sprint 9)

- Point de départ : une candidature au statut `interview` ou une offre collée à la main.
- Le LLM prépare 8 questions : 3 générales (parcours, motivation), 3 liées au poste, 2 liées à l'entreprise (à partir de `company_insight` et de la recherche web).
- **Version simple d'abord** : dans le navigateur, reconnaissance vocale (Web Speech API, compatible Chrome/Edge) + réponse du recruteur IA lue à voix haute (synthèse vocale du navigateur). Une question à la fois, une relance possible par question.
- Version avancée (plus tard) : API vocale temps réel d'un fournisseur LLM ou service d'appel téléphonique.
- Fin de session : débrief par question (ce qui était bien, ce qui manquait, une reformulation proposée), note globale, 3 axes de progrès. Sauvegarde dans une table `coach_sessions`.

---

## 11. Exigences non fonctionnelles

- **Coûts LLM** : utiliser un modèle rapide et peu cher pour l'extraction, le NAF, le scoring et la classification, et un modèle plus fort pour la rédaction des mails. Configurables : `LLM_MODEL_FAST`, `LLM_MODEL_SMART`. Logger le nombre de tokens par appel dans `events` pour suivre le coût par utilisateur.
- **Performance** : le scoring de 60 entreprises prend moins de 60 s ; afficher la progression.
- **Accessibilité** : interface utilisable au clavier, contrastes suffisants, responsive mobile.
- **RGPD** :
  - Page « Politique de confidentialité » : données collectées, finalités, durée de conservation (12 mois après la dernière connexion), droits.
  - Export des données (JSON) et suppression du compte depuis les paramètres.
  - Pour les contacts recruteurs : uniquement des adresses professionnelles, utilisées pour une candidature individuelle, jamais revendues ni partagées entre utilisateurs (`contacts` est lié à l'utilisateur, pas au cache partagé).
- **Observabilité** : logs structurés sans données personnelles ; page d'administration minimale (protégée par une liste d'e-mails admin) avec le nombre d'utilisateurs, de mails envoyés, d'erreurs de cron.

---

## 12. Variables d'environnement (`.env.example`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://<domaine>/api/google/oauth/callback
TOKEN_ENCRYPTION_KEY=          # 32 octets en base64
LLM_PROVIDER=anthropic         # ou openai
LLM_API_KEY=
LLM_MODEL_FAST=
LLM_MODEL_SMART=
CRON_SECRET=
RESEND_API_KEY=                # optionnel, notifications
ADMIN_EMAILS=                  # liste séparée par des virgules
APP_URL=
```

---

## 13. Sprints

Sprints d'une semaine. Chaque sprint se termine par une démo testable en ligne (déploiement Vercel de prévisualisation).

| Sprint | Objectif                             | Livrable démontrable                                                    |
| ------ | ------------------------------------ | ----------------------------------------------------------------------- |
| 0      | Fondations                           | App déployée, connexion Google, base Supabase avec migrations et RLS    |
| 1      | Profil                               | Upload du CV → profil pré-rempli, éditable, préférences sauvegardées    |
| 2      | Chasseur : recherche et scoring      | Liste de 30 entreprises notées, sélectionnables                         |
| 3      | Chasseur : contact, rédaction, envoi | Connexion Gmail + mails relus et envoyés avec CV joint                  |
| 4      | Suivi                                | Kanban mis à jour automatiquement, relances, notification d'entretien   |
| 5      | Fondations réelles + bêta minimale   | Envoi réel validé, IA rapide sans conservation, adresses trouvées, RGPD |
| 6      | Pilote automatique + Radar           | 5 candidatures prêtes chaque matin, validées d'un geste sur téléphone   |
| 7      | Réponds en un geste                  | Réponse au recruteur (créneau, documents) préparée, validée d'un geste  |
| 8      | Bêta testeurs + mémoires             | 10 testeurs, taux d'entretiens mesuré, apprentissage de ce qui marche   |
| 9      | Coach (V2)                           | Simulation vocale dans le navigateur + débrief                          |

Feuille de route décidée le 2026-10-26 avec le propriétaire (analyse concurrence : LazyApply, Simplify, Jobea, Kandi, JobKraken). Positionnement : **le marché caché + l'IA qui s'occupe de tout jusqu'à l'entretien, avec validation d'un geste** — jamais de robot sur les job boards (interdit par leurs conditions, risque pour les comptes des étudiants, incompatible avec les partenariats écoles). Les avantages difficiles à copier à construire : les résultats mesurés (quelle candidature mène à un entretien), la mémoire des formats d'adresse par domaine, les partenariats écoles.

### Sprint 0 — Fondations

- Initialiser Next.js + TypeScript strict + Tailwind + shadcn/ui + ESLint + Prettier + Vitest.
- Client Supabase (navigateur et serveur), connexion Google via Supabase Auth, middleware de protection de la zone `(app)`.
- Migration initiale : toutes les tables du §4, enums, RLS, bucket `cvs` privé.
- `lib/llm/client.ts` : fonction `generateJson<T>(prompt, zodSchema, model)` avec relance automatique si le JSON est invalide (2 essais max).
- `lib/crypto.ts` : chiffrer/déchiffrer (AES-256-GCM) + tests.
- `.env.example`, README avec la checklist de configuration (Supabase, Google Cloud, Vercel).
- **Fini quand** : connexion Google fonctionnelle sur l'URL Vercel, lint/typecheck/tests verts.

### Sprint 1 — Profil

- §5 complet : upload, extraction, prompt `extract_profile`, formulaire éditable, préférences.
- 3 CV d'exemple anonymisés dans `tests/fixtures/cv/` + tests du parsing.
- **Fini quand** : critères d'acceptation du §5 validés.

### Sprint 2 — Chasseur : recherche et scoring

- `lib/integrations/companies.ts` (API Recherche d'entreprises + limiteur de débit + cache).
- Prompt `map_naf` + `lib/data/naf.json`.
- Pré-filtre déterministe + prompt `score_fit` par lots.
- Écran de recherche et de sélection (§7.3), progression affichée.
- **Fini quand** : la recherche de référence renvoie au moins 20 entreprises pertinentes notées en moins de 60 s.

### Sprint 3 — Chasseur : contact, rédaction, envoi

- OAuth Gmail (§6) + écran de consentement expliqué.
- `websearch.ts`, `dns.ts` (vérification MX), `contacts.ts`, `research.ts`.
- Prompt `compose_application` + contrôle des `claims_used`.
- Écran de relecture (§7.6), file d'envoi espacée, quotas, journalisation dans `send_log`.
- **Fini quand** : critères d'acceptation du §7 validés avec un vrai compte Gmail de test.

### Sprint 4 — Suivi

- Cron `sync-replies`, prompt `classify_reply`, règles de statut.
- Cron `followups`, prompt `compose_followup`, envoi dans le même thread.
- Kanban, détail d'une candidature, statistiques.
- Notification d'entretien.
- Workflow GitHub Actions (§9).
- **Fini quand** : critères d'acceptation du §8 validés.

### Sprint 5 — Fondations réelles + bêta minimale

Rien de nouveau tant que le socle n'est pas prouvé en ligne.

- Test réel des Sprints 3–4 avec le Gmail du propriétaire (envoi, CV joint, réponse classée, relance dans le même fil) ; corrections.
- IA payante rapide sans conservation des données (`LLM_DENY_DATA_COLLECTION=true`, modèles choisis pour la vitesse) ; objectif : une préparation de mail < 10 s.
- Recherche automatique du site et des adresses : essai comparé sur 20 entreprises réelles (recherche web payante vs context.dev) ; on garde la source qui donne une adresse utile pour ≥ 70 % des entreprises, derrière une variable d'environnement (`lib/integrations/`).
- RGPD minimum : politique de confidentialité et conditions d'utilisation (IA, sous-traitants, recruteurs, durée de conservation), export JSON, suppression de compte (révocation Google + CV + toutes les lignes), purge des données après 12 mois d'inactivité.
- Onboarding guidé en 3 étapes (CV → préférences → Gmail), rappel de reconnexion Gmail (mode test Google, §6.3).
- **Fini quand** : un mail réel est parti avec CV joint et sa réponse a déplacé la carte ; préparation d'un mail < 10 s ; adresse trouvée pour ≥ 70 % des entreprises de la recherche de référence ; export et suppression de compte testés.

### Sprint 6 — Pilote automatique + Radar

La promesse : « Chaque matin, 5 candidatures sont prêtes ; tu valides d'un geste en 30 secondes ; Spontané envoie, relance et te prévient quand tu as un entretien. »

- Préparation de nuit (cron) : pour chaque étudiant qui l'a activée, nouvelles entreprises de sa recherche enregistrée → contacts → mails, dans la limite de son quota et d'un nombre choisi par jour (5 par défaut).
- Radar : priorité aux entreprises qui montrent un signal public de recrutement ou de croissance — offre d'alternance récente (API La Bonne Alternance, conditions d'usage à respecter), nouvel établissement ou effectif en hausse (API Recherche d'entreprises), actualité (recherche web) — avec l'accroche datée correspondante dans le mail.
- Écran de validation mobile façon cartes : glisser à droite = envoyer (c'est la validation explicite de l'étudiant), à gauche = passer, toucher = lire/modifier. Les relances proposées passent par le même écran.
- Application installable (PWA) + notifications sur le téléphone : « 5 candidatures prêtes », « Entretien proposé par X ».
- Aucun envoi sans le geste de validation ; quota 20 / 24 h et espacement inchangés.
- **Fini quand** : sur 5 jours consécutifs, un étudiant test reçoit chaque matin une notification avec 5 candidatures prêtes dont ≥ 4 envoyables sans modification, et les valide en moins d'une minute sur téléphone.

### Sprint 7 — Réponds en un geste

L'IA accompagne jusqu'à l'entretien, pas seulement jusqu'à l'envoi.

- Réponse « entretien » : détection des créneaux proposés dans la réponse du recruteur, brouillon de réponse (« Jeudi 14 h me convient… »), notification « On répond jeudi 14 h ? » ; un geste = envoi dans le même fil ; fichier calendrier (.ics) proposé, sans accès à l'agenda Google.
- Réponse « demande d'informations » : brouillon prêt, l'étudiant joint le document demandé.
- Même règles que les relances : validation explicite, quota, jamais d'invention (aucune disponibilité ou information absente de ce que l'étudiant a indiqué).
- **Fini quand** : une réponse d'entretien de test produit un brouillon correct avec le bon créneau, envoyé dans le même fil après un geste, et l'événement est ajoutable à l'agenda.

### Sprint 8 — Bêta testeurs + mémoires

- 10 testeurs (IAE Nantes) pendant 2 semaines ; corrections issues de leurs retours.
- Page admin minimale + statistiques (§4 `events`) : envoyés, réponses, entretiens, rebonds, par étudiant et global.
- Mémoire « ce qui marche » : à partir des résultats suivis (réponse, entretien), statistiques agrégées et anonymes sur les mails (longueur, type d'accroche, taille d'entreprise, jour d'envoi) pour améliorer les prompts et conseiller l'étudiant. Aucune donnée personnelle partagée entre étudiants.
- Mémoire des formats d'adresse par domaine (ex. `prenom.nom`) apprise des envois réussis et des rebonds, partagée entre étudiants **sous forme de format uniquement**, jamais d'adresse ni de nom ; validation par l'agent `gdpr-reviewer` avant mise en production.
- **Fini quand** : 10 testeurs ont envoyé au moins 5 candidatures chacun sans aide ; le taux d'entretiens est mesuré et affiché dans l'admin.

### Sprint 9 — Coach (V2)

- §10 complet, version navigateur.
- Lien depuis une carte « Entretien » du Kanban.
- **Fini quand** : une simulation de 8 questions se déroule entièrement à la voix et produit un débrief sauvegardé.

### Plus tard (après preuves en bêta)

- **Copilote Chrome** (façon Simplify) : sur une offre ouverte par l'étudiant lui-même (Indeed, Welcome to the Jungle, sites carrières), un bouton remplit le formulaire, génère la lettre et ajoute la candidature au Suivi ; c'est l'étudiant qui clique sur « Envoyer ». LinkedIn exclu. Aucune navigation ni candidature automatique par robot.
- **Réseau des anciens** : avec une école partenaire et le consentement explicite des anciens, « 2 anciens de l'IAE travaillent chez Acme » + mail de mise en relation validé par l'étudiant.
- Offres publiées utilisées comme **signal** (badge « Recrute en alternance », accroche), pas comme catalogue d'annonces.

---

## 14. Prompts à donner à Codex

Donne-les **un par un**, dans l'ordre. Attends que chaque sprint soit terminé, testé et commité avant de passer au suivant.

**Démarrage (une seule fois)**

> Lis AGENTS.md et SPEC.md en entier. Ne code rien pour l'instant. Résume-moi en français ce que tu as compris du produit, liste les questions ou ambiguïtés que tu vois dans la spec, et propose la liste des comptes et clés que je dois créer avant le sprint 0, avec les étapes pour chacun.

**Sprint 0**

> Implémente le Sprint 0 de SPEC.md (§13) en respectant AGENTS.md. Crée la migration complète du §4 avec les RLS. À la fin : vérifie lint, typecheck et tests, mets à jour la section Avancement de SPEC.md, et donne-moi en français une checklist pas à pas pour configurer Supabase, Google Cloud (connexion Google) et Vercel, puis pour tester que tout fonctionne.

**Sprint 1**

> Implémente le Sprint 1 (module Profil, §5). Ajoute 3 CV d'exemple fictifs dans tests/fixtures/cv/ et les tests associés. Vérifie chaque critère d'acceptation du §5 et dis-moi comment je peux les tester moi-même dans le navigateur.

**Sprint 2**

> Implémente le Sprint 2 (Chasseur : recherche et scoring, §7.1 à §7.3). Commence par vérifier la documentation actuelle de l'API Recherche d'entreprises et adapte le code si les paramètres diffèrent de la spec ; signale-moi tout écart. Montre-moi le résultat de la recherche de référence « Business Analyst, alternance, Nantes, 30 km ».

**Sprint 3**

> Implémente le Sprint 3 (OAuth Gmail §6, puis §7.4 à §7.6). Donne-moi d'abord la checklist pour activer l'API Gmail dans Google Cloud, configurer l'écran de consentement en mode Test et m'ajouter comme utilisateur de test. Le quota et la validation humaine avant envoi sont obligatoires. Termine par un test d'envoi réel vers une adresse à moi.

**Sprint 4**

> Implémente le Sprint 4 (module Suivi, §8 et §9). Ajoute 10 exemples de réponses dans tests/fixtures/replies/ (entretien, refus, absence, adresse invalide, demande d'infos…) et teste la classification. Vérifie que les crons sont idempotents. Explique-moi comment configurer le secret CRON_SECRET dans GitHub et Vercel.

**Sprint 5**

> Implémente le Sprint 5 (Fondations réelles + bêta minimale, §13). Commence par me guider pour le test réel Gmail et diagnostique via les logs ; puis IA rapide sans conservation, essai comparé de la recherche de contacts sur 20 entreprises, pages RGPD en français clair adaptées à ce que l'app fait réellement, export et suppression de compte, onboarding.

**Sprint 6**

> Implémente le Sprint 6 (Pilote automatique + Radar, §13). Aucun envoi sans le geste de validation. Explique-moi comment installer l'app sur mon téléphone et activer les notifications.

**Sprint 7**

> Implémente le Sprint 7 (Réponds en un geste, §13). Teste avec des réponses d'entretien fictives contenant différents formats de créneaux.

**Sprint 8**

> Implémente le Sprint 8 (Bêta testeurs + mémoires, §13). Fais valider les mémoires partagées par l'agent `gdpr-reviewer`. Donne-moi une checklist de lancement pour 10 testeurs (ce que je dois leur envoyer, ce que je dois surveiller).

**Sprint 9**

> Implémente le Sprint 9 (Coach, §10) en version navigateur. Préviens-moi des limites de compatibilité navigateur et propose un message à afficher aux utilisateurs concernés.

**Quand quelque chose ne marche pas**

> Voici ce que je fais, ce que j'attends et ce qui se passe à la place : [décris]. Voici le message d'erreur : [colle]. Trouve la cause, explique-la-moi simplement, corrige-la et ajoute un test pour que ça ne revienne pas.

---

## 15. Décisions prises (écarts par rapport à la spec)

- Next.js 16 : le middleware s'appelle désormais `proxy.ts`.
- `contacts` et `replies` ont une colonne `user_id` (RLS plus simple et plus sûre).
- `applications` : colonnes `scheduled_for` (file d'envoi traitée chaque minute, via `pg_cron` Supabase au Sprint 3), `followup_subject`, `followup_body`, `send_error`.
- La vue `google_connection_status` est remplacée par une fonction `google_connection_status()` (appel `supabase.rpc`), mêmes garanties, sans alerte du linter Supabase. L'enum du statut Gmail s'appelle `google_connection_state`.
- `send_log` est conservé si une candidature est supprimée (sinon on pourrait contourner le quota).
- Le fichier CV dans Storage doit être supprimé explicitement lors de la suppression de compte (pas de cascade SQL vers Storage).
- Fournisseur LLM : OpenRouter (`LLM_PROVIDER=openrouter`) avec le routeur gratuit `openrouter/free` pendant le développement, au choix du propriétaire. ⚠️ Les modèles gratuits peuvent conserver/utiliser les prompts : à réserver aux tests (CV fictifs ou du propriétaire) ; passer à un modèle payant sans rétention avant la bêta avec de vrais étudiants (RGPD). Notification d'entretien : via le Gmail de l'étudiant (pas de Resend) sauf avis contraire.

- Sprint 3 : API Gmail via `google-auth-library` + `@googleapis/gmail` (paquets officiels issus de `googleapis`, plus légers). File d'envoi : `pg_cron` + `pg_net` appellent `POST /api/cron/send-queue` chaque minute quand un mail validé est dû (URL et secret lus dans Supabase Vault : `app_url`, `cron_secret`) ; l'écran de relecture traite aussi la file tant qu'il est ouvert. Quota atomique via `reserve_send_slot()` (verrou par utilisateur + insertion `send_log`). Nouvelles colonnes : `leads.prep_status/prep_error/prep_started_at`, `applications.claims_used/claims_unverified/quality_warnings/company_insight_source/approved_at/send_claimed_at`, une candidature par lead. Recherche web configurable (`WEBSEARCH_PROVIDER` = `none` par défaut, `openrouter` (crédits payants) ou `brave`) : sans recherche web, pas de site donc pas d'adresse devinée, l'étudiant saisit le destinataire et l'accroche porte sur l'activité. Un envoi interrompu dont on ne sait pas s'il est parti n'est jamais renvoyé automatiquement (retour en brouillon + message). Durcissement après QA : un trigger (`applications_guard_client_write`) limite les écritures client sur `applications` aux passages brouillon ↔ validé (colonnes d'envoi, ids Gmail et mails envoyés en lecture seule hors rôle service) ; régénération plafonnée à 30 / 24 h par étudiant ; un mail validé en cours de modification non enregistrée est exclu de l'envoi ; « Préparer » limité à 20 entreprises à la fois ; reconnexion Gmail = révocation de l'ancien accès.

- Sprint 4 : tâches planifiées par `pg_cron` + `pg_net` dans Supabase (même mécanisme que la file d'envoi, secrets Vault `app_url`/`cron_secret`) au lieu de GitHub Actions : `spontane-sync-replies` toutes les heures, `spontane-followups` chaque jour à 07:10 UTC ; aucun secret GitHub à poser. Kanban : menu « Déplacer vers » (clavier et tactile) au lieu du glisser-déposer. Les relances comptent dans le quota de 20 envois / 24 h et respectent l'espacement de 30 s (vérifié dans `reserve_send_slot`, sous le même verrou que le quota, pour tous les envois). Une relance n'est jamais envoyée sans `In-Reply-To`, ni si une réponse non encore synchronisée est arrivée dans le fil. Brouillon de relance non validé : ignoré au bout de 14 jours. Classification : règles d'abord (rebond définitif ≠ retard / boîte pleine / blocage anti-spam ; refus envoyés par des outils de recrutement ; « a quitté l'entreprise » ; demande de ne plus être contacté), sinon `classify_reply@1`. RGPD : le texte des réponses envoyé à l'IA est coupé avant l'historique et la signature, limité à 1000 caractères, sans e-mails, téléphones ni liens ; `LLM_DENY_DATA_COLLECTION=true` (OpenRouter) n'utilise que des fournisseurs sans conservation — obligatoire avant de vrais utilisateurs. Une adresse qui a rebondi est supprimée et le mail revient en relecture. Rotation équitable des crons (`google_connections.sync_attempted_at`, `applications.replies_checked_at`, `followup_checked_at`).

## 16. Avancement

_(mis à jour par l'agent à la fin de chaque sprint)_

- [x] Sprint 0 — Fondations (2026-10-25) : Next.js 16 + Tailwind + shadcn/ui + Vitest, connexion Google via Supabase, `proxy.ts` (ex-middleware), migration initiale + RLS + bucket `cvs` (19 tests SQL), `lib/crypto.ts`, `lib/llm/client.ts`, `lib/env.ts`, CI GitHub Actions.
- [x] Sprint 1 — Profil (2026-10-25) : upload direct navigateur → Storage, extraction PDF (unpdf), prompt `extract_profile@1` + garde-fou déterministe qui retire toute valeur absente du CV, formulaire éditable à sauvegarde automatique, préférences, remplacement du CV avec revue champ par champ, 3 CV fictifs + tests. Critère « < 20 s » et test réel du LLM à valider en ligne (`tests/live/`).
- [x] Sprint 1.5 — Coach métiers (2026-10-25) : prompt `suggest_roles@1`, suggestions guidées (raisons tirées du profil, point d'attention, questions de challenge), ajout en un clic aux cibles du Chasseur.
- [x] Sprint 2 — Chasseur : recherche et scoring (2026-10-25) : API Recherche d'entreprises (near_point + search, limiteur 5 req/s), géocodage, `map_naf@1`, pré-filtre déterministe (60), `score_fit@2` par lots de 10, 30 meilleures en leads, écran avec progression, filtres, sélection ; plafond de 10 recherches / 24 h par étudiant. Test réel « Business Analyst, alternance, Nantes, 30 km » : 150 entreprises trouvées, 60 pré-sélectionnées, notation IA OK. ⚠️ Avec les modèles gratuits OpenRouter, une recherche prend 1 à 3 min (critère « < 60 s » atteignable seulement avec un modèle payant rapide).
- [x] Sprint 3 — Chasseur : contact, rédaction, envoi (2026-10-25) : OAuth Gmail (state signé + nonce, tokens chiffrés, expiration → bannière), écran de consentement expliqué dans Paramètres, site/contacts (site officiel, adresses du site, formats probables si MX, génériques), accroche vérifiée (URL issue des résultats, sinon activité), `compose_application@1` + contrôle automatique des `claims_used`/longueur/objet/mots creux avec 1 régénération puis signalement, écran de relecture (modifier, régénérer, changer de contact, ignorer, valider), confirmation finale, file espacée 30–90 s, quota 20/24 h atomique. ⚠️ À valider en ligne avec un vrai compte Gmail de test (critères §7 « mail dans Messages envoyés avec CV joint »).
- [x] Sprint 4 — Suivi (2026-10-26) : synchronisation horaire des seuls fils de l'app, classification (règles + `classify_reply@1`, 11 exemples dans `tests/fixtures/replies/`), statuts automatiques sans écraser une correction manuelle, notification d'entretien (mail à soi-même, une seule fois), relances `compose_followup@1` en brouillon à J+7 envoyées dans le même fil après validation, `no_reply` à J+21, tableau Kanban (onglets sur mobile, 5 colonnes sur PC), détail, « Synchroniser maintenant », statistiques. Crons idempotents (testés). ⚠️ À valider en ligne avec un vrai compte Gmail (réponse reçue → carte déplacée en moins d'une heure, relance dans le même fil).
- [ ] Sprint 5 — Fondations réelles + bêta minimale
- [ ] Sprint 6 — Pilote automatique + Radar
- [ ] Sprint 7 — Réponds en un geste
- [ ] Sprint 8 — Bêta testeurs + mémoires
- [ ] Sprint 9 — Coach (V2)
