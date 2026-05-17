## 0.1.39 (2026-05-18)

- Fix: le GM n apparaissait pas dans le classement quand il jouait des
  PNJ/monstres, parce que les mesures `target_role='players_only'`
  excluaient TOUS les events avec `route_to_gm=true` (y compris les
  actions de PNJ controles par le GM). Le filtre `players_only` inclut
  maintenant les actions de tout acteur (PJ ou PNJ) et n exclut que les
  rolls "purs" GM (chat `/roll` sans acteur, `actor_kind='unknown'`).
  Aligne sur le besoin metier "actions a la table", pas "exclure le GM".

## 0.1.38 (2026-05-18)

- Fix: les messages de degats en D&D5e v3+/v4+ etaient classes en
  `event_type='attack'` au lieu de `'damage'` car `flags.dnd5e.roll.type`
  ou `flags.dnd5e.activity.type` pouvait pointer sur l Attack activity
  parente. `inferActionType` verifie maintenant en priorite si les rolls
  contiennent un DamageRoll (constructor / damage types) sans d20, et
  force `damage` dans ce cas. Sinon les mesures filtrees sur
  `filter_event_type:['damage']` rejetaient silencieusement tous les
  messages de degats.
- Debug logging: passer `globalThis.RollCodexDebug = true` dans la
  console Foundry pour voir, pour chaque message traite, le type
  d evenement, le bucket, et la liste des mesures matchees vs rejetees
  avec la raison (filter / no_field_value).

## 0.1.36 (2026-05-18)

- Fix critique: `extractRollFigures` ne forward qu un sous-ensemble des
  champs (total, count, nat20, damageHint, healHint) alors que
  `rollcodex-measures.js` attend en plus `actionType`, `actionName`,
  `rollNatural`, `isCritical`, `isFumble`. Sans `actionType`, tous les
  events arrivaient avec `event_type='roll'` et etaient rejetes par le
  filtre `filter_event_type:['attack']` des mesures type "Attaque
  moyenne". Les jets de PJ ne montaient donc jamais le classement live.
  Forward complet ajoute, plus `rollTotal`/`rollCount` alias pour la
  compat directe.

## 0.1.34 (2026-05-18)

- Fix: le panneau live se rafraichissait AVANT que `processMessageForMeasures`
  n ait stocke l evenement (deux hooks `createChatMessage` distincts dans
  rollcodex.js et rollcodex-measures.js). Du coup chaque jet apparaissait avec
  un message de decalage, et le GM ne montait jamais dans le classement quand
  il jouait des NPC. Ajout de `throttledRefreshLivePanels()` en fin de
  `processMessageForMeasures` pour declencher un re-render apres l ajout.
- Comportement confirme: tous les acteurs non-PJ (npc/monster/unknown) sont
  mappes sur le bucket GM (`getGmMetricBucket`), le GM apparait donc dans le
  classement avec son nom Foundry des qu il roule une attaque sur un NPC,
  pour toute mesure dont `target_role` est `all` ou `gm_only`/`npcs_only`.

## 0.1.33 (2026-05-18)

- Fix: les jets effectues par le GM en tant que personnage joueur (Milo
  Vernet, etc.) n etaient jamais attribues au PC dans le panneau live. La
  fonction `inferActorKind` n etait pas exposee sous le nom
  `globalThis.inferRollCodexActorKind` attendu par `rollcodex-measures.js`,
  donc tous les events tombaient dans le bucket GM et le ranking restait
  fige sur la baseline du profil. Export ajoute, les deltas live se
  calculent maintenant correctement.

## 0.1.32 (2026-05-18)

- Mode reduit enrichi: affiche la mesure selectionnee avec valeur globale
  et delta, plus le top 5 du classement avec delta par participant.
- Mode reduit style chrome natif Foundry (fond noir semi-transparent
  rgba(0,0,0,0.55) + backdrop-filter blur, bordure grise fine
  rgba(60,60,60,0.85), border-radius 5px, boutons hover orange Foundry).
- Bandeau de stats du mode etendu reduit a msg + jets (dmg et crit retires
  car peu pertinents en KPI hauts niveau).
- Icones des mesures retirees du selecteur (les cles type "flame"/"target"
  s affichaient en texte brut illisible).

## 0.1.30 (2026-05-18)

- Panneau flottant repense en paysage, aligne sur Roll20: header avec badge
  connecte/offline (pastille verte si en ligne), sous-titre registre/table,
  bandeau de statistiques (msg, jets, dmg, crit) et boutons en grille
  compacte.
- Bloc mesure dedie avec selecteur + valeur globale ("GLOBAL 10.8") et delta
  colore (+1.3 vert si positif, rouge si negatif).
- Classement avec delta par participant et zebra rows pour la lisibilite.
- Mode compact simplifie: titre + scope + badge de statut sur une seule ligne.

## 0.1.19 (2026-05-17)

- Fix: l ouverture du popup de connexion etait bloquee dans Foundry car
  window.open etait appele apres plusieurs await (sha256Hex, fetchConnectionConfig,
  game.settings.set) — le geste utilisateur etait perdu. Le popup est maintenant
  ouvert immediatement sur about:blank puis navigue vers RollCodex apres le
  travail asynchrone.

## 0.1.15 (2026-05-17)

- Classement live (leaderboard) dans le panneau flottant, aligné Roll20
- Sélecteur de mesure dans le panneau live
- Classement visible même en mode compact
- Badge statut compressé, bouton "Oub." (Forget)
- Alignement labels, actions et UI Roll20
- Correctifs CSS et micro-alignements

---
Voir l'historique complet dans le repo pour les détails techniques.