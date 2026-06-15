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
- Module RollCodex: 0.1.59

## Utilisation

1. Activer le module dans le monde Foundry.
2. Ouvrir les parametres du module RollCodex.
3. Verifier que l'adresse RollCodex pointe sur `https://rollcodex.app`, puis lancer la connexion.
4. Choisir le registre, le systeme, la campagne et la table dans RollCodex.
5. Envoyer une capture manuelle ou laisser les captures de fin de session actives.
6. Relire puis importer les donnees dans RollCodex.

Les mondes deja connectes gardent leur connexion locale active lors de la mise
a jour du module. Seuls les mondes sans connexion ni demande de liaison en cours
recoivent automatiquement l'adresse publique par defaut.

Le module envoie des captures VTT a relire. RollCodex ne transforme pas automatiquement ces donnees en narration et ne pretend pas deduire un contexte de jeu absent des logs.

## Metriques live locales

Le module fournit aussi un kikimeter local dans Foundry. Il lit les messages et
jets de la session en cours, puis affiche des compteurs volatils par speaker ou
acteur : jets, degats, soins, critiques et activite recente.

Ces metriques ne sont pas envoyees en direct a RollCodex et n'ecrivent pas dans
les evenements importes. Elles peuvent etre remises a zero depuis le panneau
RollCodex ou depuis le menu des parametres du module.

## Mapping Foundry

Les fiches Actor et Item disposent d'un bouton RollCodex dans leur en-tete.
Il permet de stocker localement, dans les flags Foundry du monde :

- le type d'acteur : PJ, PNJ, monstre, invocation, environnement ;
- l'alias speaker a utiliser dans les metriques ;
- la classe, sous-classe, race/espece et niveau quand le systeme ne les expose pas clairement ;
- le type d'action d'un item : attaque, degats, soin, sauvegarde, test, sort, ressource ou utilitaire.

Ce mapping aide le kikimeter local. Il est aussi joint aux captures comme
contexte de revue afin que RollCodex puisse proposer des rapprochements, sans
les appliquer automatiquement comme verite definitive.

## Support

Les questions et incidents peuvent etre ouverts depuis l'onglet Issues du depot GitHub.
