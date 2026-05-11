# RollCodex Foundry VTT

Module Foundry VTT officiel pour connecter un monde Foundry a RollCodex et envoyer des captures VTT relues avant import.

RollCodex aide les MJ a transformer des donnees VTT relues en activite de campagne, tendances et imports exploitables dans leur registre RollCodex.

## Installation

Depuis Foundry, installer le module via le manifest public:

```text
https://github.com/Fernail/foundry-rollcodex/releases/latest/download/module.json
```

Quand le module sera reference dans le catalogue Foundry, l'installation pourra se faire directement depuis l'interface de Foundry.

## Compatibilite

- Foundry VTT minimum: 12
- Foundry VTT verifie: 14.361
- Module RollCodex: 0.1.10

## Utilisation

1. Activer le module dans le monde Foundry.
2. Ouvrir les parametres du module RollCodex.
3. Lancer la connexion vers RollCodex.
4. Choisir le registre, le systeme, la campagne et la table dans RollCodex.
5. Envoyer une capture manuelle ou laisser les captures de fin de session actives.
6. Relire puis importer les donnees dans RollCodex.

Le module envoie des captures VTT a relire. RollCodex ne transforme pas automatiquement ces donnees en narration et ne pretend pas deduire un contexte de jeu absent des logs.

## Support

Les questions et incidents peuvent etre ouverts depuis l'onglet Issues du depot GitHub.
