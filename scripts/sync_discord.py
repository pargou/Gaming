#!/usr/bin/env python3
"""
Bot de tri des screens Discord vers les galeries du site.

À chaque passage :
  1. lit les nouveaux messages des salons listés dans config.json (et des salons « vrac ») ;
  2. télécharge les images jointes ;
  3. les range dans le bon chantier : mot-clé dans le message d'abord, sinon salon d'origine,
     sinon dossier « a-trier » ;
  4. met à jour <jeu>/data.json, que lit la galerie.

Le token du bot est lu dans la variable d'environnement DISCORD_TOKEN (secret GitHub),
il n'est jamais écrit dans le dépôt.
"""

import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
CONFIG = RACINE / "config.json"
ETAT = RACINE / "_bot" / "etat.json"
API = "https://discord.com/api/v10"
EXT_IMAGES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
A_TRIER = "a-trier"
TAILLE_MINIATURE = 640

try:
    from PIL import Image  # miniatures si Pillow est installé (c'est le cas dans GitHub Actions)
except ImportError:
    Image = None


# ---------------------------------------------------------------- utilitaires

def normaliser(texte: str) -> str:
    """minuscules, sans accents"""
    texte = unicodedata.normalize("NFD", texte or "").encode("ascii", "ignore").decode()
    return texte.lower()


def mots(texte: str) -> list:
    return [m for m in re.split(r"[^a-z0-9]+", normaliser(texte)) if m]


def lire_json(chemin: Path, defaut):
    if chemin.exists():
        return json.loads(chemin.read_text(encoding="utf-8"))
    return defaut


def ecrire_json(chemin: Path, donnees) -> None:
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text(json.dumps(donnees, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- Discord

class Discord:
    def __init__(self, token: str):
        self.entetes = {
            "Authorization": f"Bot {token}",
            "User-Agent": "DiscordBot (https://github.com/pargou/gaming, 1.0)",
        }

    def get(self, chemin: str):
        for _ in range(5):
            req = urllib.request.Request(API + chemin, headers=self.entetes)
            try:
                with urllib.request.urlopen(req, timeout=30) as rep:
                    return json.loads(rep.read())
            except urllib.error.HTTPError as err:
                if err.code == 429:  # limite de débit : on attend ce que Discord demande
                    attente = float(json.loads(err.read() or b"{}").get("retry_after", 2))
                    time.sleep(attente + 0.5)
                    continue
                if err.code == 403:
                    return None  # salon non visible par le bot
                raise
        raise RuntimeError(f"Discord ne répond plus pour {chemin}")

    def salons(self) -> dict:
        """nom du salon -> id, sur tous les serveurs où le bot est invité"""
        resultat = {}
        for serveur in self.get("/users/@me/guilds") or []:
            for salon in self.get(f"/guilds/{serveur['id']}/channels") or []:
                if salon.get("type") in (0, 5):  # salons texte et annonces
                    resultat[salon["name"]] = salon["id"]
        return resultat

    def nouveaux_messages(self, salon_id: str, apres: str):
        """messages postés après l'id donné, du plus ancien au plus récent"""
        while True:
            lot = self.get(f"/channels/{salon_id}/messages?limit=100&after={apres}")
            if not lot:
                return
            lot.sort(key=lambda m: int(m["id"]))
            yield from lot
            apres = lot[-1]["id"]
            if len(lot) < 100:
                return


def telecharger(url: str, destination: Path) -> bool:
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as rep:
            destination.write_bytes(rep.read())
        return True
    except Exception as err:  # une image ratée ne doit pas bloquer les autres
        print(f"  ! image non récupérée ({err}) : {url}", file=sys.stderr)
        return False


def miniature(source: Path, destination: Path):
    if Image is None or source.suffix.lower() == ".gif":
        return None
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as img:
            largeur, hauteur = img.size
            img = img.convert("RGB")
            img.thumbnail((TAILLE_MINIATURE, TAILLE_MINIATURE * 2))
            img.save(destination, "WEBP", quality=80)
        return largeur, hauteur
    except Exception as err:
        print(f"  ! miniature impossible ({err}) : {source}", file=sys.stderr)
        return None


# ---------------------------------------------------------------- tri

class Trieur:
    def __init__(self, config: dict):
        self.par_salon = {}     # nom de salon -> (jeu, chantier)
        self.par_mot_cle = {}   # mot-clé normalisé -> (jeu, chantier)
        self.generiques = set() # chantiers « thème » (intérieurs, inspis…), moins prioritaires
        for jeu_id, jeu in config["jeux"].items():
            for ch in jeu["chantiers"]:
                if ch.get("type") in ("interieur", "inspiration", "realisation"):
                    self.generiques.add((jeu_id, ch["id"]))
                for salon in ch.get("salons", []):
                    self.par_salon[salon] = (jeu_id, ch["id"])
                for mot in ch.get("mots_cles", []):
                    cle = normaliser(mot)
                    if cle in self.par_mot_cle:
                        raise ValueError(f"Mot-clé « {mot} » utilisé deux fois dans config.json")
                    self.par_mot_cle[cle] = (jeu_id, ch["id"])
        self.vrac = set(config.get("salons_vrac", []))

    def classer(self, salon: str, texte: str):
        """renvoie (jeu, chantier, raison) ; jeu vaut None si l'image reste à trier"""
        trouves = [self.par_mot_cle[m] for m in mots(texte) if m in self.par_mot_cle]
        # un château ou un village cité l'emporte sur un thème (« déco de Kaïsa » -> Kaïsa)
        precis = [t for t in trouves if t not in self.generiques]
        if precis or trouves:
            return (*(precis or trouves)[0], "mot-clé")
        if salon in self.par_salon:
            return (*self.par_salon[salon], "salon")
        return (None, A_TRIER, "à trier")


def est_image(piece: dict) -> bool:
    if (piece.get("content_type") or "").startswith("image/"):
        return True
    return Path(piece.get("filename", "")).suffix.lower() in EXT_IMAGES


# ---------------------------------------------------------------- programme principal

def main() -> int:
    token = os.environ.get("DISCORD_TOKEN", "").strip()
    if not token:
        print("DISCORD_TOKEN manquant : ajoute-le dans Settings > Secrets and variables > Actions.")
        return 1

    config = lire_json(CONFIG, None)
    trieur = Trieur(config)
    etat = lire_json(ETAT, {"dernier_message": {}})
    discord = Discord(token)

    salons_discord = discord.salons()
    a_suivre = sorted(set(trieur.par_salon) | trieur.vrac)
    absents = [s for s in a_suivre if s not in salons_discord]
    if absents:
        print("Salons introuvables ou invisibles pour le bot :", ", ".join(absents))

    galeries = {}  # dossier -> liste d'images (chargée à la demande)

    def galerie(dossier: str) -> list:
        if dossier not in galeries:
            galeries[dossier] = lire_json(RACINE / dossier / "data.json", {"images": []})["images"]
        return galeries[dossier]

    total = 0
    for nom_salon in a_suivre:
        salon_id = salons_discord.get(nom_salon)
        if not salon_id:
            continue
        apres = etat["dernier_message"].get(nom_salon, "0")
        nouveaux = 0
        for msg in discord.nouveaux_messages(salon_id, apres):
            etat["dernier_message"][nom_salon] = msg["id"]
            images = [p for p in msg.get("attachments", []) if est_image(p)]
            if not images:
                continue
            jeu, chantier, raison = trieur.classer(nom_salon, msg.get("content", ""))
            dossier = jeu or A_TRIER
            for i, piece in enumerate(images):
                ext = Path(piece["filename"]).suffix.lower() or ".png"
                nom = f"{msg['id']}-{i}{ext}"
                fichier = RACINE / dossier / "images" / chantier / nom
                if not telecharger(piece["url"], fichier):
                    continue
                vignette = RACINE / dossier / "miniatures" / chantier / (Path(nom).stem + ".webp")
                dims = miniature(fichier, vignette)
                galerie(dossier).append({
                    "id": f"{msg['id']}-{i}",
                    "chantier": chantier,
                    "image": f"images/{chantier}/{nom}",
                    "miniature": f"miniatures/{chantier}/{vignette.name}" if dims else f"images/{chantier}/{nom}",
                    "largeur": dims[0] if dims else piece.get("width"),
                    "hauteur": dims[1] if dims else piece.get("height"),
                    "date": msg["timestamp"][:10],
                    "auteur": (msg.get("author") or {}).get("global_name") or (msg.get("author") or {}).get("username", ""),
                    "legende": (msg.get("content") or "").strip(),
                    "salon": nom_salon,
                    "rangement": raison,
                })
                nouveaux += 1
        if nouveaux:
            print(f"#{nom_salon} : {nouveaux} image(s)")
            total += nouveaux

    for dossier, images in galeries.items():
        images.sort(key=lambda im: int(im["id"].split("-")[0]), reverse=True)
        ecrire_json(RACINE / dossier / "data.json", {"images": images})
    ecrire_json(ETAT, etat)
    print(f"Terminé : {total} nouvelle(s) image(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
