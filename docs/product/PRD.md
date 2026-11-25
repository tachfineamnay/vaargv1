# VAARG̈ V1 — Product Requirements Document

**Version :** 1.0 — référence produit et technique pour les IDE  
**Date :** 25 novembre 2026  
**Pilote :** Roaring 20s Paris  
**Signature :** VAARG̈ OS  
**Statut :** spécification de conception ; aucune certification d'implémentation ni autorisation de mise en production implicite.

## 0. Instructions de lecture et de réalisation

Ce PRD consolide les décisions prises pendant le cadrage VAARG V1 et les arbitrages techniques délégués au concepteur. Il remplace les propositions antérieures contradictoires pour la V1, notamment l'exclusion initiale du swarm et le report de la mémoire client. Il ne remplace pas les PRD A/C/D de VAARG̈ OS.

- **ACTÉ** : frontend indépendant, Shopify comme moteur commercial, Storefront API pour commencer, navigation adaptative et dialogue unifiés, A2UI, design existant à conserver, mémoire client durable et marketing personnalisé, swarm hiérarchique Hermes + Hatchet, clés directes Gemini/DeepSeek pour les essais.
- **ARBITRAGE TECHNIQUE** : architecture, stack, contrats et limites ci-dessous. Le fondateur a délégué ces choix ; les compatibilités et performances doivent être démontrées.
- **À VÉRIFIER** : accès Shopify réel, droits clients/commandes, gravure, identité post-achat, design de référence exact, modèles autorisés, comportement de Hermes et des SDK sur les versions installées, ressources d'hébergement.
- **HORS V1** : usine de génération et publication de boutiques, SaaS multi-marchands complet, autre moteur de commerce, facturation SaaS, autonomie illimitée.

Les IDE ne doivent pas inventer un accès externe ni une preuve de test. Une fonctionnalité simulée doit être identifiée comme telle. Un blocage externe ne justifie pas l'abandon des travaux indépendants, mais interdit la certification du parcours concerné. Ne pas pousser, fusionner ou basculer le domaine de production sans instruction explicite. Les travaux sont locaux ou auto-hébergés, sans CI externe imposée.

## 1. Vision, objectifs et utilisateurs

Créer une boutique premium qui connaît son catalogue, révèle progressivement les univers et produits, comprend les intentions, adapte les prochaines sections et conserve une relation client utile après l'achat. Shopify traite les transactions ; VAARG maîtrise l'expérience, la mémoire et l'intelligence commerciale.

Objectifs : faciliter la découverte, réduire les frictions, améliorer la pertinence des recommandations, fidéliser et permettre au marchand d'exploiter les données autorisées. Les gains de conversion ne sont pas garantis ; les mesurer sur une base de référence comparable.

Utilisateurs : visiteur anonyme ; acheteur identifié ; client récurrent ; marchand propriétaire ; opérateur support/marketing autorisé. Le client n'a qu'un interlocuteur conversationnel, même lorsque plusieurs sous-agents travaillent.

### 1.1 Indicateurs

Mesurer, selon les autorisations : découverte vers fiche, ajout au panier, checkout démarré, commandes confirmées, panier moyen, réachat, taux de conversion, satisfaction, pertinence des recommandations, coût par session agentique, taux d'erreur, délais d'inférence, désabonnements et incidents de délivrabilité. Distinguer attribution observée et causalité. Ne pas confondre clic checkout et vente.

### 1.2 Périmètre et jalons de disponibilité

Un seul produit, un seul dépôt, une seule V1. Les jalons ci-dessous ne sont pas des PRD distincts.

| Jalon | Capacités | Conditions |
|---|---|---|
| Démarrage | vitrine, catalogue, collections, fiches, recherche, navigation adaptative, dialogue, panier, redirection Shopify ; tests swarm | Storefront API autorisée ; fixtures réalistes si accès absent, clairement signalées |
| V1 complète | compte acheteur, historique commercial, profil/mémoire persistants, mini-CRM, marketing/newsletters et support | Admin et Customer Account API autorisées, droits sur données clients, fournisseur email et consentements |
| Production | ensemble du périmètre V1 certifié, exploitation et rollback | parcours réels et gates de recette réussis ; accord du fondateur et du marchand |

Un lancement public limité à la vitrine serait une décision de périmètre spécifique, pas une certification V1 complète. Les fonctions indisponibles sont désactivées de manière explicite, jamais présentées comme opérationnelles.

## 2. Expérience et design

Conserver la direction artistique explorée (luxe patrimonial moderne, Art Déco mesuré, identité Roaring 20s Paris). Ne pas relancer le benchmark ni imposer une nouvelle charte. Reprendre les maquettes de référence effectivement fournies ; leur absence bloque seulement la fidélité graphique exacte. Ne pas utiliser les prix, avis ou produits fictifs des mocks comme données commerciales.

### UX-01 — Home progressive

Header élégant et explicatif, navigation, recherche, compte et panier immédiatement accessibles. Dès le premier écran, tiles/Bento représentant les grandes familles de produits. Au scroll, progression du général au particulier : univers, collections, sélections, caractéristiques, fiches et accessoires. Contenu initial utile et rendu serveur, même si IA indisponible. Pas de scroll hijacking, de chatbot obligatoire, de déplacement du contenu en cours de lecture.

### UX-02 — Navigation et adaptation

La navigation classique est complète : catégories, listes, filtres, tri, recherche, détail, retour, URL stables. Chaque clic ou signal pertinent enrichit le contexte commun. Adapter les zones à venir sans désorienter ; préserver le focus, le scroll, les filtres explicites et le panier. Une action claire permet de revenir à une découverte générale ou de désactiver la personnalisation. Le dialogue peut actualiser simultanément la sélection et la composition A2UI.

### UX-03 — Personal Shopper

Assistant discret et accessible, conversation persistante pendant la session, suggestions interactives, comparaison, recherche guidée, sélection selon critères, explication des recommandations. Demander une précision seulement si utile. Les actions commerciales sont explicites, les états de chargement/erreur/annula