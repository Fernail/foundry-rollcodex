# RollCodex Foundry VTT

Module Foundry VTT officiel pour connecter un monde Foundry a RollCodex et envoyer des captures VTT relues avant import.

## Installation

Manifest Foundry:

```text
https://github.com/Fernail/foundry-rollcodex/releases/latest/download/module.json
```

## Compatibilite

- Foundry VTT minimum: 12
- Foundry VTT verifie: 14.361
- Module RollCodex: 0.1.9

## Securite

La liaison doit etre lancee depuis un compte MJ dans Foundry. Le secret actif reste stocke cote client dans Foundry, et la page RollCodex demande une preuve locale via la fenetre ouverte par le module avant d'autoriser la connexion.

## Release

La release GitHub publie deux assets attendus par Foundry:

- `module.json`
- `rollcodex-v0.1.9.zip`
