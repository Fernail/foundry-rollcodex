## 0.1.30 (2026-05-18)

- Panneau flottant repense en paysage, aligne sur Roll20: header avec badge
  connecte/offline (pastille verte si en ligne), sous-titre registre/table,
  bandeau de statistiques (msg, jets, dmg, crit) et boutons en grille compacte.
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