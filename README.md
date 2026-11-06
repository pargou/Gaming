# Galeries de jeux

Site de galeries de mes constructions dans les jeux, alimenté automatiquement depuis Discord.

## Comment ça marche

1. Je poste mes screens sur Discord, dans le salon du chantier ou dans `#vrac`.
2. Chaque jour, GitHub Actions lance `scripts/sync_discord.py` avec le token du bot.
3. Le script range chaque image :
   - **mot-clé dans le message** (ex. « orion », « kaisa », « interieur ») → ce chantier ;
   - sinon **salon d'origine** → le chantier lié à ce salon ;
   - sinon → `a-trier/`.
4. Les images et `data.json` sont enregistrés dans le dépôt, puis OVH redéploie le site.

## Ajouter un chantier ou un jeu

Tout se règle dans `config.json` : un bloc par jeu, un bloc par chantier avec ses salons et ses mots-clés.
Pour un nouveau jeu, on ajoute aussi un dossier `<jeu>/index.html` (copie de `valheim/index.html`).

## Lancer le tri à la main

Onglet **Actions** → « Tri des screens Discord » → **Run workflow**.

## Le token du bot

Il est stocké dans *Settings → Secrets and variables → Actions* sous le nom `DISCORD_TOKEN`.
Il n'est jamais écrit dans le code.
