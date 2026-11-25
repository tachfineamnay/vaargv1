# VAARG̈ V1 — Production Roadmap

**Version 1.0 | 25 novembre 2026 | Pilote : Roaring 20s Paris | Signature : VAARG̈ OS**

Référence normative : `VAARG_V1_PRD_INDUSTRIEL_v1.0.md` (sections 0–16, AC-01 à AC-30). Ce plan transforme le PRD en missions de code ; il ne remplace ni le PRD ni le design existant. Aucun développement, accès fournisseur ou test n'est attesté par ce plan. Les identifiants P00–P11, leurs dépendances et le protocole de transmission sont des choix d'organisation sous mandat technique.

## 1. Doctrine BUILD FIRST

- Un dépôt, une V1, des incréments intégrés. Pas de projet de démonstration ni de refonte graphique. Conserver les maquettes réelles lorsqu'elles sont disponibles. Une seconde configuration fictive sert uniquement à prouver la portabilité et l'isolation, pas à construire un SaaS multi-marchands.
- Arena produit le code et les tests qu'il peut réellement exécuter dans son environnement. DeepSeek Harness intègre et teste localement, notamment Docker et fournisseurs. Codex audite les diffs et certifie les parcours sur un environnement réel. Ces rôles sont des propositions opérationnelles ; les capacités effectives d'Arena doivent être vérifiées, pas supposées.
- Cycle : lire → implémenter un incrément → exécuter tests disponibles → corriger → checkpoint → transférer → test live local. Pas de CI externe. Pas de push, merge, déploiement ou changement de domaine sans autorisation explicite.
- Une mission bloquée par un service externe continue sur ses tâches indépendantes, avec états d'indisponibilité et tests de contrat. Les fixtures sont explicitement fictives ; jamais de prix ou commande inventés en production. Les critères réels dépendants restent BLOCKED/NOT_RUN.
- Pas de fallback IA payant implicite. Aucune clé dans Arena, Git, prompts, screenshots ou artefacts ; injection serveur locale via secrets. Utiliser des données synthétiques dans Arena, aucun export client réel ni transcript privé.

## 2. Source de vérité et persistance anti-compression (OBLIGATOIRE)

Chaque mission utilise des fichiers réels dans la sandbox du dépôt, pas seulement des messages de chat. Chemins relatifs, adaptés à l'environnement réellement disponible :

```
AGENTS.md                         # règles de travail et reprise (préserver l'existant)
docs/product/PRD.md               # copie exacte du PRD v1.0
docs/production/ROADMAP.md         # copie exacte de ce plan
docs/production/STATUS.md          # tableau global P00–P11 et SHA courant
docs/production/missions/Pxx/
  MISSION.md                      # scope, invariants, critères, source SHA
  TASKS.md                        # checklist exhaustive, IDs et dépendances
  PROGRESS.md                     # checkpoint courant, changements, suite
  DECISIONS.md                    # arbitrages, justification, impact PRD
  VALIDATION.md                   # commandes, sorties, statuts, preuves
  HANDOFF.md                      # transfert et instructions de reprise
  evidence/                       # preuves expurgées, petites et reproductibles
```

**Protocole d'exécution :**
1. Avant toute modification : vérifier `pwd`, `git status`, `git rev-parse HEAD` si dépôt existant, lire AGENTS.md, PRD, ROADMAP, STATUS et fichiers de la mission. Ne jamais écraser les changements de l'utilisateur. Si nouveau dépôt, le dire et initialiser seulement si P00 le permet. Si fichiers normatifs absents, demander leur transfert plutôt que les reconstituer approximativement.
2. Écrire MISSION et TASKS avant le code. Décomposer en petites tâches numérotées et noter les préconditions. Les critères PRD ne peuvent être abaissés sans décision explicite. Préserver les sections sources exactes et le hash du PRD.
3. Avant chaque tâche, relire les fichiers de mission et le code touché. Après chaque tâche, même après échec : mettre à jour TASKS et PROGRESS, DECISIONS si nécessaire, VALIDATION si un test a été lancé. Marquer les tâches prouvées seulement. Noter l'action suivante exacte, les fichiers concernés et les blocages.
4. Après compression de contexte, interruption ou changement d'agent : ne pas se fier au souvenir du chat. Relire fichiers et diff Git, recouper l'état réel ; si contradiction, reprendre l'état réel et documenter la correction. Ne pas recommencer depuis zéro.
5. À la fin d'un incrément, écrire HANDOFF avec SHA de base, SHA livré si commit possible, fichiers, migrations, commandes de reprise, dépendances exactes, preuve et prochain pas. Commit local cohérent si autorisé ; aucun push automatique. Le fichier ne peut contenir le hash de son propre commit : donner le SHA final dans le rapport de sortie ou un manifeste externe.
6. Si Git ou téléchargement n'est pas disponible : remettre un patch ou snapshot téléchargeable si l'environnement le permet, avec manifeste des fichiers modifiés/supprimés et checksum SHA-256. Sinon déclarer transfert BLOCKED et fournir les éléments effectivement exportables. Ne pas prétendre avoir transféré le code. Ne jamais inclure `.env`, tokens, données client, node_modules ou caches de build dans l'archive.

La sandbox peut perdre son état entre sessions : exporter les checkpoints et les réintégrer au dépôt local après chaque mission. Une réponse en prose ne remplace pas un artefact. Pas de suppression de fichiers existants non liée à la mission, pas de `git reset --hard`, clean destructif ou force-push.

## 3. Statuts et preuves

- `PASS_REAL` : test exécuté contre les composants réels nécessaires au scénario, avec preuve. Un test unitaire réel prouve l'unité, pas Shopify réel.
- `PASS_SIMULATED` : test exécuté contre des fixtures ou doubles déclarés ; ne lève pas un gate réel.
- `FAIL` : résultat négatif observé. `BLOCKED` : prérequis absent ou accès indisponible. `NOT_RUN` : non exécuté.
- Tâches de code : `TODO`, `IN_PROGRESS`, `IMPLEMENTED`, `VERIFIED`, `BLOCKED`. `IMPLEMENTED` ne signifie pas certifié. Mission : `DELIVERED_FOR_INTEGRATION`, `VERIFIED_LOCAL`, `BLOCKED` ou `FAIL` ; seule la recette finale permet GO production.
- VALIDATION : ID tâche/AC, portée et environnement, commande exacte, code de retour, résultat, chemin preuve, SHA testé, limitation. Ne pas inventer de sorties. Un test qui ne tourne pas faute de Docker reste non exécuté/bloqué ; il est rejoué par l'agent local.

## 4. Missions (un seul codebase, incréments intégrables)

### P00 — Bootstrap industriel
**Dépendances :** PRD et plan ; dépôt existant si disponible.
**Construire :** monorepo pnpm/Turborepo ; Node 24 LTS, TypeScript 5.9 strict, Next 16/React 19, NestJS/Fastify ; applications web/api/worker minimales réellement exécutables, contrats Zod partagés, scripts root install/typecheck/lint/test/build, lockfile, `.env.example` sans secret, Docker de développement et healthchecks. Installer uniquement les dépendances utiles. Vérifier versions stables et compatibilité réelle ; consigner tout écart. Config de boutique pilote isolée, pas de code métier vide fictif. Préparer matrice de capacité Arena et scripts pour validation locale. Examiner tôt la documentation/config réelle de Hermes, A2UI, AG-UI, Hatchet et Hydrogen pour identifier les risques d'intégration ; ne pas les déclarer compatibles sans test.
**Sortie :** web et API minimalement joignables si runtime disponible, worker vérifiable (connectivité Hatchet si disponible), install gelée, build, tests smoke, plan d'intégration local et manifeste versions. Dépendances/images verrouillées au moment de l'intégration réelle ; pas de tag mutable en release.
**Gate :** aucun scaffolding prétendu opérationnel sans exécution. AC-28/29 partiels.

### P01 — Core data, identité, isolation
**Dépendance :** P00.
**Construire :** PostgreSQL 18/Drizzle, Valkey, extensions vector/pg_trgm, schémas identity/brand/privacy/operations/integration et conventions des migrations (PRD §9). UUIDv7 si support vérifié, UTC, décimaux exacts. Stores, memberships, rôles marchand, contexte session anonyme, consentements et permissions par finalité. FK composites store_id, RLS avec rôle runtime non BYPASSRLS, validations Zod, erreurs structurées, auth serveur, audit redacted, inbox/outbox/idempotence. Auth marchande réelle et documentée (choix du fournisseur à motiver ; pas d'auth fictive accessible). Seed deux stores synthétiques. Ne pas créer en avance des tables vides sans usage ; migrations des domaines suivants dans leur mission, suivant conventions.
**Sortie/gate :** fresh install et upgrade peuplé, isolation croisée négative, protection des sessions et rôles, replay/concurrence outbox, secrets absents. AC-24/28/29 partiels. Docker réel côté local si Arena ne l'a pas.

### P02 — Shopify Storefront et catalogue
**Dépendance :** P01.
**Construire :** CommercePort et Shopify adapter (GraphQL Codegen, Hydrogen uniquement si compatible ; sinon client GraphQL autorisé), produits/collections/variants/media/attributes/translations, projection locale avec pagination/checkpoints, prix par marché et disponibilité snapshot, statut de fraîcheur et réconciliation. Storefront suffit pour les premiers appels. Hatchet/worker pour import durable et reprise si runtime disponible ; préparer entrée webhook durable, scopes Admin seulement en P07. Pas de scraping comme contournement des droits.
**Sortie/gate :** contrat et fixtures, appels réels Storefront dès clé disponible, deux marchés si configurés, pagination/reprise, index cohérent, produit supprimé/indisponible traité, aucune écriture catalogue. AC-05/25/27 partiels, AC-11 côté catalogue. Prévoir `NOT_CONFIGURED` sans accès.

### P03 — Boutique et design existant
**Dépendance :** P02 (les fixtures permettent de travailler avant accès réel).
**Construire :** design tokens et composants propriétaires à partir des maquettes existantes, Tailwind/Radix/Motion/CSS Grid/Embla, Storybook. Home SSR progressive (header court, familles visibles, scroll vers détails), collections, fiches, navigation, filtres, tri, recherche initiale, panier UI, assistant discret non bloquant. Routes stables, responsive, états d'erreur/vide/hors stock, focus/clavier, reduced-motion. next-intl, canonical/hreflang/sitemap/JSON-LD selon marchés réels. Aucun prix fictif en mode réel. En l'absence des visuels sources, fidélité graphique BLOCKED, implémentation fonctionnelle possible sur direction existante sans nouvelle recherche.
**Sortie/gate :** Playwright mobile/desktop et axe, rendu indexable, achat navigable sans IA (mutation réelle P06), captures et comparaison visuelle. AC-01/25 partiels.

### P04 — Recherche et adaptation déterministe
**Dépendance :** P02, P03.
**Construire :** SearchPort, PostgreSQL FTS + pg_trgm + pgvector, RRF, embeddings Gemini via provider autorisé (dimension 768 initiale, benchmark, content_hash/reindex versionnés). Filtrer marché, contraintes explicites et références disponibles. SessionPort, interaction_events/intent_signals/recommendations/revisions ; état Valkey + persistance nécessaire, consentement, collecte minimale ; reducer commun comportement/dialogue, séquence, déduplication, contextVersion/revision. Recomposition des zones suivantes, conservation scroll/focus/panier, retour général, annulation et rejet de réponses périmées. Sans embeddings/LLM : recherche lexicale et règles utiles, état dégradé explicite.
**Sortie/gate :** parcours clic/filtre/contexte, tests concurrence hors ordre, pertinence corpus synthétique, latence DB et UI mesurée. AC-02/03/04/05/26 partiels.

### P05 — Swarm Hermes + Hatchet + A2UI/AG-UI
**Dépendance :** P01/P04. Le spike runtime peut commencer plus tôt, l'intégration après P04.
**Construire :** runtime Hermes privé et adapter AgentPort ; maître seul visible, six spécialistes Discovery/Experience/Commerce/Memory/Marketing/Support avec contrats et prompts versionnés ; activer les capacités métier au fil des missions (pas de fonctionnalité fictive). Maximum trois enfants simultanés et profondeur 1, budget atomique global, annulation, traces parent/enfant, sélection explicite Gemini OU DeepSeek direct, fallback non autorisé désactivé et vérifié. ToolBroker authentifié et borné ; aucun terminal, FS hôte, SQL, navigateur libre, Docker socket, secrets ou API Admin arbitraire. Vérifier héritage des outils et mécanisme d'identification enfant ; en cas d'impossibilité, lecture sûre uniquement, mutations proposées exécutées par cas d'utilisation validés. Tester réellement le confinement et les fuites entre sessions. AI SDK auxiliaire seulement si utile, pas deuxième swarm. Bridge AG-UI/SSE réel avec annulation/resync, catalogue A2UI React versionné, validation serveur/client, bornes taille/profondeur, actions autorisées et références résolues ; pas d'HTML/JS arbitraire. Hatchet pour workflows durables, pas chaque clic ; retries bornés, timeout, statut, reprise, erreurs visibles.
**Sortie/gate :** dialogue et navigation contexte commun, une délégation réelle prouvée, provider réel autorisé avec usage/coût, payload A2UI malveillant rejeté, panne IA ne casse pas la boutique. AC-03/04/06/07/08/09/10/27. Sans clés/runtime : tests contrat seulement et gate réel BLOCKED.

### P06 — Commerce et checkout
**Dépendance :** P02/P03 ; P05 pour propositions agentiques (navigation classique indépendante).
**Construire :** cart_links/cart_operations/checkout_attempts, panier Shopify serveur, GID secret protégé, mutations create/add/update/delete sérialisées, clés idempotence et réconciliation des résultats inconnus, revalidation prix/variantes/stock, marchés cohérents, checkoutUrl officiel validé, pas de carte ni paiement parallèle. Comparaison, accessoires et gravure uniquement si règles/options/prix/délai réellement confirmés ; sinon désactivation explicite. Confirmation utilisateur avant mutation issue d'un agent. Ne jamais déduire la commande du redirect.
**Sortie/gate :** panier et checkout test autorisé (confirmation de commande à compléter P07), tests retry/timeout/duplication, vérification gravure et pays/langue. AC-05/11/12/13/25. Tests réels sur dev store ou avec autorisation explicite ; ne pas passer commande réelle sans accord.

### P07 — Compte client et mémoire persistante
**Dépendance :** P01/P02/P05/P06 ; Admin + Customer Account nécessaires aux parcours réels.
**Construire :** OAuth/OIDC Shopify officiellement supporté, vérifications state/PKCE/nonce selon flux, session serveur/rotation/logout, adresses et commandes autorisées. Admin GraphQL minimal, webhooks HMAC raw body, inbox, backfill historique autorisé (couverture visible, 60 jours par défaut et accès élargi si approuvé), retours/remboursements, réconciliation hors ordre. Upsert profil sur identité Shopify stable, commande non rattachée si identité absente, jamais fusion par simple email/chat ni login automatique après achat. CDP : customer_profiles, purchases/items, preferences, memory/evidence, metrics/timeline ; distinctions DECLARED/OBSERVED/INFERRED/TRANSACTION, SELF/GIFT/UNKNOWN, polarité, preuve et date/expiration/finalité ; correction et aversion prioritaires. Memory Agent propose ; Hatchet consolide ; PostgreSQL vérité, vecteurs dérivés, Valkey contexte actif. Retour client authentifié personnalisé et désactivation, droits et propagation effacement/correction sur DB/vecteurs/cache/projections ; raccord segments en P08/P09. Toutes données personnelles minimisées et autorisations vérifiées.
**Sortie/gate :** achat/remboursement synchronisé idempotent, isolation commandes, nouvelle session retrouve profil, achat cadeau non assimilé aux goûts, retrait/effacement. AC-12/14/15/16/17/23/24. Si scopes indisponibles, BLOCKED sur les intégrations réelles et couverture non inventée.

### P08 — Marchand, CDP, segmentation et SAV
**Dépendance :** P07 et P05.
**Construire :** `/merchant` RBAC owner/marketing/support, liste/recherche clients, profil 360° avec preuves, dernier achat, timeline, préférences/aversions, couverture et fraîcheur, notes autorisées, segments et RFM reproductible net des remboursements par devise (pas de somme multidevise implicite), métriques conversion distinguant checkout et vente, état sync/budget. Support : espace acheteur et marchand, commande uniquement autorisée, dossier, règles de retour vérifiées et escalade humaine. Support Agent lecture/proposition, jamais remboursement autonome. Préparer raccord des segments marketing ; conserver les frontières de finalité.
**Sortie/gate :** dashboard réel contre PostgreSQL, contrôle d'accès et scénarios négatifs, calculs et segmentation reproductibles, escalade SAV. AC-18/22/23/24.

### P09 — Marketing agentique et newsletter
**Dépendance :** P07/P08/P05.
**Construire :** Marketing Agent prépare brouillons, variations par segment/individu avec préférences et historique autorisés, React Email, EmailPort (Resend candidat, choix à tester), produits et offres vérifiés. Campaign revision immutable, aperçu, coût/audience éligible, approbation humaine, programmation/annulation, dispatch Hatchet, suppression list et opt-in revalidés à l'envoi ; désabonnement sans login, webhook email authentifié, bounces/complaints, fréquence/fuseau, pas de tracking non autorisé. Séparer transactionnel et marketing, éviter doublon avec Shopify. Un dispatch logique par révision/destinataire ; état UNKNOWN, réconcilier avant retry. Aucun envoi réel par défaut, uniquement boîte de test autorisée ; domaine SPF/DKIM/DMARC avant production.
**Sortie/gate :** deux profils => contenus différents, retrait concurrent => suppression avant dispatch, preuve de non-double envoi et réconciliation, preview/validation marchande. AC-19/20/21/23/29.

### P10 — Release candidate et certification locale
**Dépendance :** toutes missions P00–P09 intégrées ; accès externes pour gates concernés.
**Construire/corriger :** tests intégration et E2E complets, sécurité (CSRF/XSS/SSRF/injection, isolation, RLS, webhook, confinement Hermes), supply chain, secrets et logs expurgés, quotas provider, cancellation, accessibilité, SEO/i18n. k6 avec 100k produits synthétiques/500 sessions simultanées, profil de charge réaliste et infrastructure consignée, mesurer seuils PRD §12 (CWV p75 LCP ≤2,5s INP ≤200ms CLS ≤0,1 ; search p95 ≤200ms hors provider ; API p95 ≤150ms ; premier retour IA utile p95 ≤2s visé). Ne pas charger abusivement Shopify ni fournisseurs ; distinguer tests locaux et réels. Docker images verrouillées, fresh/upgrade DB peuplée, restart worker/Hatchet, replay inbox/outbox, backup chiffré externe, restauration et rollback testés, effacements réappliqués. RPO 24h/RTO 4h objectifs à mesurer. Pino/OTel, health/readiness, alertes. Générer script de certification locale, matrice AC-01..30, runbooks, rapport exact de SHA.
**Sortie/gate :** RC reproductible et audité par Codex sur environnement local/auto-hébergé ; aucune baisse silencieuse des seuils, aucune réussite inventée. AC-01..29 rejoués ; AC-30 préparé. Si manque droits/infra, RC peut être livrée à l'intégration, mais NO-GO V1 complète tant que gate critique non passé.

### P11 — Mise en production contrôlée
**Dépendance :** RC certifiée et accord explicite fondateur/marchand pour les actions externes.
**Préparer :** configuration Coolify réelle, web/api/worker/Hermes privé/Hatchet et dépendances officielles/PG/Valkey, rôles et bases Hatchet séparés, secrets injectés, Cloudflare/DNS/TLS, S3 sauvegardes ; dimensionnement selon mesures (un VPS n'est pas HA). Migration non destructive, plan rollback et restauration, vérification exposition réseau. Tests Shopify et email autorisés, politique de données et textes légaux approuvés, budget IA et limites, marchés/livraison, vérification boutique d'origine intacte. Staging ou test isolé si autorisé, pas de création d'infrastructure ni changement DNS sans accord.
**Gate :** AC-28/30 sur infra réelle, smoke et parcours autorisés, vérification des 30 critères sur SHA/image exacts, décision GO/NO-GO documentée. Basculer uniquement après accord. Si déploiement autorisé, vérifier santé, logs et parcours post-déploiement ; rollback si anomalie critique. Aucun envoi campagne réel automatique à la mise en ligne.

## 5. Matrice de couverture PRD

Les missions mentionnées sont propriétaires de l'implémentation ou d'une preuve partielle ; P10 consolide/rejoue et P11 vérifie les gates de déploiement. Une croix n'est pas un PASS.

| AC | Mission(s) principales | Contrôle |
|---|---|---|
| 01 | P03 | Home SSR sans IA |
| 02 | P04 | Adaptation/scroll |
| 03 | P04/P05 | Contexte partagé |
| 04 | P04/P05 | Révisions obsolètes |
| 05 | P02/P04/P06 | Produits vérifiés |
| 06 | P05 | Validation A2UI |
| 07 | P05 | Délégation réelle |
| 08 | P05 | Confinement |
| 09 | P05 | Provider/fallback |
| 10 | P05/P06 | Dégradation sûre |
| 11 | P06 | Panier réel |
| 12 | P06/P07 | Checkout et commande |
| 13 | P06 | Gravure vérifiée |
| 14 | P07 | Compte acheteur |
| 15 | P07 | Achats/remboursements |
| 16 | P07 | Mémoire au retour |
| 17 | P07 | Provenance/cadeaux |
| 18 | P08 | CDP et métriques |
| 19 | P09 | Variations marketing |
| 20 | P09 | Permissions |
| 21 | P09 | Envoi idempotent |
| 22 | P08 | SAV |
| 23 | P07/P08/P09/P10 | Droits et propagation |
| 24 | P01/P07/P08/P10 | Isolation stores |
| 25 | P03/P06/P07/P10 | Marchés/SEO/accessibilité |
| 26 | P04/P10 | Performance |
| 27 | P02/P05/P07/P09/P10 | Durabilité workflows |
| 28 | P00/P01/P10/P11 | Install/migration/restore |
| 29 | Toutes/P10 | Sécurité et secrets |
| 30 | P11 | Boutique d'origine et domaine |

## 6. Ordre et prérequis externes

Chemin de référence : P00 → P01 → P02 → P03 → P04 → P05 → P06 → P07 → P08 → P09 → P10 → P11. Le test de faisabilité Hermes/A2UI peut être anticipé ; P06 classique peut avancer avant P05. Ne pas ouvrir deux branches modifiant les mêmes migrations ou contrats sans coordination. Le fondateur n'a pas demandé un calendrier en jours : aucune durée arbitraire ni vitesse garantie. La taille des lots s'adapte aux limites réelles d'Arena.

| Prérequis | Quand | Si absent |
|---|---|---|
| Dépôt/accès fichiers | P00 | Créer localement si autorisé, transfert explicite |
| Maquettes exactes | P03 | Fidélité graphique bloquée ; ne pas inventer de charte |
| Storefront API | P02/P06 | Fixtures identifiées, réel bloqué |
| Clé Gemini ou DeepSeek | P05 | Contrats/doubles, aucun fallback caché |
| Admin, Customer Account, droits données | P07 | Compte/historique réel bloqués, visibilité de couverture |
| Options gravure/marchés | P06 | Fonction indisponible explicitement |
| Email/domaine/opt-in | P09/P11 | Préviews, boîte test autorisée uniquement |
| Docker/Coolify/ressources/S3 | P10/P11 | Recette locale selon capacités, déploiement bloqué |
| Politique de données et accord marchand | P11 | NO-GO trafic réel concerné |

## 7. Prompt universel Arena (à joindre à chaque mission)

Utiliser le fichier `VAARG_V1_ARENA_P00_START.md` pour la première mission. Pour les suivantes, conserver son protocole commun, remplacer uniquement le bloc de mission par la section Pxx correspondante de ce plan. Ne pas donner une seule instruction « build everything ». Le prompt est en anglais pour les IDE ; le rapport utilisateur peut rester en français.

**Entrées pour chaque agent :** PRD, ROADMAP, état Git courant ou snapshot exact, fichiers de mission/checkpoint, maquettes si pertinentes. Les références doivent être réellement disponibles dans sa sandbox. Ne pas introduire de nouveaux choix de produit sans demande.

**Retour terminal court attendu :**
```
MISSION / SOURCE_SHA / DELIVERED_SHA (or NO_GIT)
STATUS / IMPLEMENTED_TASKS / REMAINING_TASKS
TESTS_REAL / TESTS_SIMULATED / FAIL / BLOCKED / NOT_RUN
ARTIFACT_OR_PATCH / CHECKPOINT_PATHS
NEXT_EXACT_ACTION / EXTERNAL_BLOCKERS
```
Le détail reste dans les fichiers. Le rapport de chat ne doit pas consommer le budget de code.

## 8. Transfert local et recette

DeepSeek Harness : lire le checkpoint, vérifier SHA et diff, intégrer sans écraser le travail local, exécuter les commandes en attente sur Docker et services autorisés, corriger uniquement la mission, mettre à jour les preuves. Codex : audit indépendant du diff et des invariants, répéter les tests critiques, refuser les PASS sans preuve ; rapporter les écarts et leur impact avant validation. En cas de conflit, réconcilier le code, ne pas appliquer aveuglément une archive plus ancienne. Ne pas utiliser un service externe sans les secrets et droits autorisés, ni remplacer l'intégration par un mock en production.

GO lancement du développement : P00 peut commencer dès disponibilité du PRD et du plan. GO mise en production : seulement après P10/P11 et validation explicite ; aucune échéance ou disponibilité garantie. Les étapes restantes de certification détaillée sont à formaliser et automatiser lors de P10. Un lancement limité à la vitrine nécessite un arbitrage de périmètre explicite ; il n'est pas un GO V1 complète.

---
**VAARG̈ OS — Industrial Adaptive Commerce**
