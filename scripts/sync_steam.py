#!/usr/bin/env python3
"""Registre Steam de La Taverne de Coco.

Lancé chaque jour par GitHub Actions (.github/workflows/sync-steam.yml) :
  1. lit la clé STEAM_API_KEY (secret GitHub, jamais écrite nulle part) ;
  2. interroge l'API Web officielle de Steam :
       ISteamUser/GetPlayerSummaries/v0002   (pseudo, avatar)
       IPlayerService/GetOwnedGames/v0001    (temps de jeu, selon la confidentialité du profil)
  3. écrit donnees/steam.json avec uniquement les champs utiles au site,
     et copie l'avatar en donnees/steam-avatar.jpg (aucune dépendance au CDN Steam).

En cas d'échec (clé absente, Steam indisponible, profil privé), le script garde
les dernières données valides et ne fabrique aucune statistique.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
SORTIE = RACINE / "donnees" / "steam.json"
AVATAR = RACINE / "donnees" / "steam-avatar.jpg"
STEAM_ID = os.environ.get("STEAM_ID", "76561198157614505")
# Jeux affichés sur les cartes de l'accueil (appid Steam) : Valheim, Satisfactory
SUIVIS = [int(x) for x in os.environ.get("STEAM_SUIVIS", "892970,526870").split(",") if x.strip()]
API = "https://api.steampowered.com"


def appel(chemin, params, cle):
    url = f"{API}/{chemin}/?" + urllib.parse.urlencode({**params, "key": cle, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": "taverne-de-coco-sync"})
    with urllib.request.urlopen(req, timeout=30) as rep:
        return json.load(rep)


def heures(minutes):
    return round((minutes or 0) / 60, 1)


def construire(resume, bibliotheque, maintenant):
    """Assemble le JSON public à partir des réponses brutes de Steam (fonction pure, testée)."""
    joueurs = (resume or {}).get("response", {}).get("players", [])
    if not joueurs:
        raise ValueError("profil introuvable dans GetPlayerSummaries")
    p = joueurs[0]
    sortie = {
        "synchronise_le": maintenant,
        "steamid": STEAM_ID,
        "profil": {
            "pseudo": p.get("personaname", ""),
            "avatar": "donnees/steam-avatar.jpg",
            "url": f"https://steamcommunity.com/profiles/{STEAM_ID}",
        },
    }
    jeux = (bibliotheque or {}).get("response", {}).get("games")
    if not jeux:
        # Bibliothèque privée ou vide : pas de statistiques, rien d'inventé
        sortie["bibliotheque_visible"] = False
        return sortie
    sortie["bibliotheque_visible"] = True
    sortie["heures_total"] = heures(sum(j.get("playtime_forever", 0) for j in jeux))
    joues = sorted((j for j in jeux if j.get("playtime_forever")), key=lambda j: j["playtime_forever"], reverse=True)
    sortie["top"] = [
        {"appid": j["appid"], "nom": j.get("name", str(j["appid"])), "heures": heures(j["playtime_forever"])}
        for j in joues[:3]
    ]
    par_id = {j["appid"]: j for j in jeux}
    sortie["jeux"] = {}
    for appid in SUIVIS:
        j = par_id.get(appid)
        if not j:
            continue
        entree = {"nom": j.get("name", str(appid)), "heures": heures(j.get("playtime_forever"))}
        if j.get("playtime_2weeks"):
            entree["heures_2_semaines"] = heures(j["playtime_2weeks"])
        if j.get("rtime_last_played"):
            entree["derniere_partie"] = datetime.fromtimestamp(j["rtime_last_played"], timezone.utc).date().isoformat()
        sortie["jeux"][str(appid)] = entree
    return sortie


def telecharger_avatar(url):
    if not url or not url.startswith("https://"):
        return False
    req = urllib.request.Request(url, headers={"User-Agent": "taverne-de-coco-sync"})
    with urllib.request.urlopen(req, timeout=30) as rep:
        contenu = rep.read(2_000_000)
    if not contenu.startswith(b"\xff\xd8"):  # JPEG attendu
        return False
    AVATAR.parent.mkdir(parents=True, exist_ok=True)
    AVATAR.write_bytes(contenu)
    return True


def main():
    cle = os.environ.get("STEAM_API_KEY", "").strip()
    if not cle:
        print("STEAM_API_KEY absent : registre inchangé.")
        return 0
    try:
        resume = appel("ISteamUser/GetPlayerSummaries/v0002", {"steamids": STEAM_ID}, cle)
        biblio = appel(
            "IPlayerService/GetOwnedGames/v0001",
            {"steamid": STEAM_ID, "include_appinfo": 1, "include_played_free_games": 1},
            cle,
        )
        maintenant = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        donnees = construire(resume, biblio, maintenant)
    except Exception as e:  # le message d'erreur ne contient jamais la clé
        print(f"Steam indisponible ({type(e).__name__}) : dernières données conservées.")
        return 0

    ancien = {}
    if SORTIE.exists():
        try:
            ancien = json.loads(SORTIE.read_text(encoding="utf-8"))
        except ValueError:
            ancien = {}
    if not donnees.get("bibliotheque_visible") and ancien.get("bibliotheque_visible"):
        # Profil devenu privé ou réponse vide : on garde les dernières heures valides
        for champ in ("bibliotheque_visible", "heures_total", "top", "jeux"):
            donnees[champ] = ancien.get(champ)
        donnees["note"] = "Heures du dernier relevé valide"

    avatar_url = resume["response"]["players"][0].get("avatarfull")
    try:
        if not telecharger_avatar(avatar_url) and not AVATAR.exists():
            donnees["profil"].pop("avatar", None)
    except Exception:
        if not AVATAR.exists():
            donnees["profil"].pop("avatar", None)

    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text(json.dumps(donnees, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Registre mis à jour : {len(donnees.get('top') or [])} jeux en tête, total {donnees.get('heures_total')} h.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
