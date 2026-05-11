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

## Release automatisee

Le workflow GitHub Actions `.github/workflows/foundry-release.yml` publie les assets GitHub et notifie l API Foundry.

Configuration une seule fois:

```bash
gh secret set FOUNDRY_RELEASE_TOKEN --repo Fernail/foundry-rollcodex
```

Coller le token de release Foundry quand la commande le demande. Ne jamais commiter ce token.

Pour publier une nouvelle version:

1. Mettre a jour `version` et `download` dans `module.json`.
2. Commiter le changement sur `main`.
3. Creer et pousser le tag correspondant, par exemple `v0.1.10`.
4. Le workflow cree ou met a jour la release GitHub, attache `module.json` et `rollcodex-v<version>.zip`, puis publie la version aupres de Foundry si `FOUNDRY_RELEASE_TOKEN` est configure.

Dry-run Foundry manuel:

```bash
gh workflow run foundry-release.yml --repo Fernail/foundry-rollcodex -f tag=v0.1.10 -f dry_run=true
```
