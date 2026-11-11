// Accueil de La Taverne de Coco : chiffres réels (data.json) et registre Steam (donnees/steam.json).
// Aucune statistique n'est inventée : en l'absence de données, les valeurs restent « — ».
(function () {
  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const heures = (h) => nf.format(Math.round(h)) + " h";
  const MASQUES = new Set(["realisation", "inspiration"]);

  async function lire(url, defaut) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      return r.ok ? await r.json() : defaut;
    } catch (e) {
      return defaut;
    }
  }

  function dateFr(iso) {
    return new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  }

  async function galeries() {
    const config = await lire("config.json", { jeux: {} });
    const jeu = config.jeux && config.jeux.valheim;
    const chantiers = (jeu && jeu.chantiers) || [];
    const masques = new Set(chantiers.filter((c) => MASQUES.has(c.type)).map((c) => c.id));
    const data = await lire("valheim/data.json", { images: [] });
    const images = (data.images || []).filter((im) => !masques.has(im.chantier));

    const n = images.length;
    $("n-captures").textContent = nf.format(n);
    const actifs = new Set(images.map((im) => im.chantier));
    $("n-constructions").textContent = nf.format(actifs.size);
    const derniere = images.reduce((m, im) => (im.date > m ? im.date : m), "");
    $("n-derniere").textContent = derniere ? dateFr(derniere) : "—";

    const carte = document.querySelector('.carte-jeu[data-jeu="valheim"]');
    if (carte) {
      carte.dataset.captures = n ? n + (n > 1 ? " captures" : " capture") : "Bientôt des images";
      majMesures(carte);
      if (images[0]) {
        const fond = carte.querySelector(".visuel");
        const img = new Image();
        img.onload = () => {
          fond.style.backgroundImage = "url('valheim/" + images[0].miniature + "')";
          fond.classList.add("charge");
        };
        img.src = "valheim/" + images[0].miniature;
      }
    }
    const aTrier = await lire("a-trier/data.json", { images: [] });
    if ((aTrier.images || []).length) $("lien-a-trier").hidden = false;
  }

  function majMesures(carte) {
    const m = carte.querySelector(".mesures");
    if (!m) return;
    m.textContent = [carte.dataset.captures, carte.dataset.heures].filter(Boolean).join(" · ");
  }

  async function steam() {
    const s = await lire("donnees/steam.json", null);
    if (!s || !s.profil) return; // état de secours déjà affiché

    if (s.profil.pseudo) $("steam-pseudo").textContent = s.profil.pseudo;
    if (s.profil.avatar) {
      const av = $("ecu-avatar");
      const test = new Image();
      test.onload = () => {
        av.setAttribute("href", s.profil.avatar);
        av.style.display = "";
        $("ecu-vide").style.display = "none";
      };
      test.src = s.profil.avatar;
    }
    if (s.synchronise_le) {
      const d = new Date(s.synchronise_le);
      if (!isNaN(d)) $("steam-date").textContent = "Relevé le " + d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    }

    const top = Array.isArray(s.top) ? s.top.slice(0, 3) : [];
    if (typeof s.heures_total === "number" && top.length) {
      $("steam-heures").textContent = nf.format(Math.round(s.heures_total));
      const max = Math.max(...top.map((j) => j.heures || 0), 1);
      const liste = $("steam-mondes");
      top.forEach((j, i) => {
        const li = document.createElement("li");
        const rang = document.createElement("span");
        rang.className = "rang";
        rang.textContent = ["I", "II", "III"][i];
        const nom = document.createElement("span");
        nom.className = "nom";
        nom.textContent = j.nom;
        const h = document.createElement("span");
        h.className = "h";
        h.textContent = heures(j.heures || 0);
        const jauge = document.createElement("span");
        jauge.className = "jauge";
        const barre = document.createElement("i");
        barre.style.width = Math.max(4, Math.round(((j.heures || 0) / max) * 100)) + "%";
        jauge.append(barre);
        li.append(rang, nom, h, jauge);
        liste.append(li);
      });
      $("registre-donnees").hidden = false;
      $("registre-vide").hidden = true;
    } else {
      $("registre-vide").textContent = "Bibliothèque Steam privée ou indisponible : les heures ne sont pas affichées.";
    }

    // heures par jeu sur les cartes
    const jeux = s.jeux || {};
    document.querySelectorAll(".carte-jeu[data-appid]").forEach((carte) => {
      const j = jeux[carte.dataset.appid];
      if (!j || typeof j.heures !== "number" || carte.classList.contains("verrou")) return;
      carte.dataset.heures = heures(j.heures);
      majMesures(carte);
    });
    const valheim = jeux["892970"];
    if (valheim && typeof valheim.heures === "number") $("n-heures").textContent = heures(valheim.heures);
  }

  galeries();
  steam();
})();
