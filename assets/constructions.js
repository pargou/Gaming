// Galerie d'un jeu (La Taverne de Coco) : cartes portrait par construction, puis photos de la construction choisie.
// Tout est généré depuis config.json et <jeu>/data.json, alimentés par le bot Discord :
// une nouvelle construction ou une nouvelle capture apparaît sans modifier cette page.
(function () {
  const TYPES = {
    chateau: { un: "Château", plusieurs: "Châteaux" },
    village: { un: "Village", plusieurs: "Villages" },
    interieur: { un: "Intérieurs", plusieurs: "Intérieurs" },
    autre: { un: "À trier", plusieurs: "À trier" },
  };
  const ORDRE = ["chateau", "village", "interieur", "autre"];
  // Archives personnelles (doublons) : conservées dans les données, jamais affichées
  const MASQUES = new Set(["realisation", "inspiration"]);
  const ROMAIN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

  const jeuId = document.body.dataset.jeu;
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, enfants = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "texte") n.textContent = v;
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    enfants.forEach((e) => e && n.append(e));
    return n;
  };
  const dateFr = (iso) =>
    new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const libelleType = (c) => {
    const t = TYPES[c.type] || TYPES.autre;
    return t.un + (c.numero && ROMAIN[c.numero] ? " " + ROMAIN[c.numero] : "");
  };
  const nbPhotos = (n) => n + (n > 1 ? " photos" : " photo");
  // identifiant Discord du message (avant le tiret) : plus petit = plus ancien
  const ordreId = (im) => {
    try { return BigInt(String(im.id).split("-")[0]) * 100n + BigInt(String(im.id).split("-")[1] || 0); }
    catch (e) { return 0n; }
  };

  async function charger(url, defaut) {
    try {
      const rep = await fetch(url, { cache: "no-store" });
      return rep.ok ? await rep.json() : defaut;
    } catch (e) {
      return defaut;
    }
  }

  async function init() {
    const config = await charger("../config.json", { jeux: {} });
    const donnees = await charger("data.json", { images: [] });
    const jeu = (config.jeux || {})[jeuId];
    if (jeu && jeu.accroche) $("accroche").textContent = jeu.accroche;

    const tous = jeu ? jeu.chantiers : [];
    const idsMasques = new Set(tous.filter((c) => MASQUES.has(c.type)).map((c) => c.id));
    const chantiers = tous.filter((c) => !MASQUES.has(c.type)).map((c) => ({ ...c, type: TYPES[c.type] ? c.type : "autre" }));
    const images = (donnees.images || []).filter((im) => !idsMasques.has(im.chantier));
    const connus = new Set(chantiers.map((c) => c.id));
    if (images.some((im) => !connus.has(im.chantier))) chantiers.push({ id: "__autres", nom: "À trier", type: "autre" });

    const parChantier = {};
    images.forEach((im) => {
      const cle = connus.has(im.chantier) ? im.chantier : "__autres";
      (parChantier[cle] = parChantier[cle] || []).push(im);
    });
    // photos d'une construction : de la plus ancienne à la plus récente
    Object.values(parChantier).forEach((l) => l.sort((a, b) => (ordreId(a) < ordreId(b) ? -1 : ordreId(a) > ordreId(b) ? 1 : 0)));

    const actifs = chantiers
      .filter((c) => (parChantier[c.id] || []).length)
      .sort((a, b) => ORDRE.indexOf(a.type) - ORDRE.indexOf(b.type) || (a.numero || 99) - (b.numero || 99));

    $("nb-images").textContent = images.length;
    $("nb-chantiers").textContent = actifs.length;
    const derniere = images.reduce((m, im) => (im.date > m ? im.date : m), "");
    $("derniere").textContent = derniere ? dateFr(derniere) : "—";

    const grille = $("constructions");
    if (!images.length) {
      $("filtres").remove();
      $("consigne").remove();
      grille.replaceWith(
        el("div", { class: "vide" }, [
          el("h2", { texte: "Le bot n'est pas encore passé" }),
          el("p", { texte: "Les screens postés sur Discord apparaîtront ici après son prochain passage." }),
        ])
      );
      return;
    }

    // ---------- filtres (appliqués aux constructions)
    const barre = $("filtres");
    const boutons = [];
    let filtreCourant = "tout";
    const ajouterFiltre = (type, libelle, nb) => {
      const b = el("button", { class: "filtre", type: "button", "aria-pressed": String(type === "tout") }, [
        document.createTextNode(libelle),
        el("span", { texte: nb }),
      ]);
      b.dataset.type = type;
      b.addEventListener("click", () => filtrer(type));
      boutons.push(b);
      barre.append(b);
    };
    ajouterFiltre("tout", "Tout", actifs.length);
    ["chateau", "village", "interieur"].forEach((t) => {
      const nb = actifs.filter((c) => c.type === t).length;
      ajouterFiltre(t, TYPES[t].plusieurs, nb);
    });
    if (actifs.some((c) => c.type === "autre")) ajouterFiltre("autre", TYPES.autre.plusieurs, actifs.filter((c) => c.type === "autre").length);

    // ---------- cartes portrait
    const cartes = new Map();
    actifs.forEach((c) => {
      const liste = parChantier[c.id];
      const couverture = liste[0]; // première capture réelle de la construction
      const visuel = el("div", { class: "visuel" });
      const pre = new Image();
      pre.onload = () => {
        visuel.style.backgroundImage = 'url("' + couverture.miniature.replace(/"/g, "%22") + '")';
        visuel.classList.add("charge");
      };
      pre.src = couverture.miniature;
      const carte = el(
        "button",
        { class: "construction cadre", type: "button", "aria-expanded": "false", "aria-controls": "detail" },
        [
          visuel,
          el("span", { class: "voile" }, [
            libelleType(c) !== c.nom ? el("span", { class: "rang-type", texte: libelleType(c) }) : null,
            el("span", { class: "titre", texte: c.nom }),
            c.detail ? el("span", { class: "detail", texte: c.detail }) : null,
            el("span", { class: "nb", texte: nbPhotos(liste.length) }),
          ]),
        ]
      );
      carte.dataset.type = c.type;
      carte.dataset.id = c.id;
      carte.addEventListener("click", () => (choisi === c.id ? fermer() : choisir(c.id, true)));
      cartes.set(c.id, carte);
      grille.append(carte);
    });

    // ---------- détail d'une construction
    const detail = $("detail");
    const mur = $("detail-mur");
    let choisi = null;
    let photos = [];

    function choisir(id, defiler) {
      const c = actifs.find((x) => x.id === id);
      if (!c) return;
      choisi = id;
      cartes.forEach((carte, cid) => carte.setAttribute("aria-expanded", String(cid === id)));
      grille.classList.add("choisie");
      $("detail-type").textContent = libelleType(c);
      $("detail-nom").textContent = c.nom;
      const etq = $("detail-etiquette");
      etq.hidden = !c.detail;
      etq.textContent = c.detail || "";
      photos = parChantier[id].map((im) => ({ ...im, nomChantier: c.nom }));
      $("detail-compte").textContent = nbPhotos(photos.length);
      mur.replaceChildren();
      photos.forEach((im, i) => {
        const img = el("img", {
          src: im.miniature,
          alt: im.legende || c.nom + ", photo " + (i + 1),
          loading: "lazy",
          decoding: "async",
          width: im.largeur,
          height: im.hauteur,
        });
        img.addEventListener("load", () => img.classList.add("charge"));
        const v = el("button", { class: "vignette", type: "button", "aria-label": "Agrandir la photo " + (i + 1) }, [img]);
        v.addEventListener("click", () => ouvrir(i));
        mur.append(v);
      });
      detail.hidden = false;
      try { history.replaceState(null, "", "#" + id); } catch (e) {}
      if (defiler) detail.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }

    function fermer() {
      const precedent = cartes.get(choisi);
      choisi = null;
      cartes.forEach((carte) => carte.setAttribute("aria-expanded", "false"));
      grille.classList.remove("choisie");
      detail.hidden = true;
      mur.replaceChildren();
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
      if (precedent) precedent.focus({ preventScroll: true });
    }
    $("detail-fermer").addEventListener("click", fermer);

    function filtrer(type) {
      filtreCourant = type;
      boutons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === type)));
      cartes.forEach((carte) => (carte.hidden = type !== "tout" && carte.dataset.type !== type));
      if (choisi && cartes.get(choisi).hidden) fermer();
    }

    // lien direct : valheim/#chateau-orion
    const ancre = decodeURIComponent(location.hash.slice(1));
    if (ancre && cartes.has(ancre)) choisir(ancre, true);

    // ---------- visionneuse (photos de la construction choisie uniquement)
    const vis = $("visionneuse");
    const grande = vis.querySelector("img");
    const infos = vis.querySelector(".infos");
    let courant = 0;
    let declencheur = null;
    function afficher() {
      const im = photos[courant];
      grande.src = im.image;
      grande.alt = im.legende || im.nomChantier;
      infos.replaceChildren(
        el("strong", { texte: im.nomChantier }),
        document.createTextNode(" · " + (courant + 1) + "/" + photos.length + " · " + dateFr(im.date) + (im.legende ? " · " + im.legende : ""))
      );
    }
    function ouvrir(i) {
      declencheur = document.activeElement;
      courant = i;
      afficher();
      vis.classList.add("ouverte");
      document.body.style.overflow = "hidden";
      vis.querySelector(".fermer").focus();
    }
    function fermerVis() {
      vis.classList.remove("ouverte");
      document.body.style.overflow = "";
      if (declencheur) declencheur.focus({ preventScroll: true });
    }
    const pas = (d) => {
      courant = (courant + d + photos.length) % photos.length;
      afficher();
    };
    vis.querySelector(".fermer").addEventListener("click", fermerVis);
    vis.querySelector(".prec").addEventListener("click", () => pas(-1));
    vis.querySelector(".suiv").addEventListener("click", () => pas(1));
    vis.addEventListener("click", (e) => e.target === vis && fermerVis());
    document.addEventListener("keydown", (e) => {
      if (vis.classList.contains("ouverte")) {
        if (e.key === "Escape") fermerVis();
        if (e.key === "ArrowLeft") pas(-1);
        if (e.key === "ArrowRight") pas(1);
      } else if (e.key === "Escape" && choisi) {
        fermer();
      }
    });
  }

  init();
})();
