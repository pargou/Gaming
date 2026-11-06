(function () {
  const TYPES = {
    chateau: { un: "Château", plusieurs: "Châteaux" },
    village: { un: "Village", plusieurs: "Villages" },
    interieur: { un: "Intérieurs", plusieurs: "Intérieurs" },
    realisation: { un: "Réalisations", plusieurs: "Réalisations" },
    inspiration: { un: "Inspirations", plusieurs: "Inspirations" },
    autre: { un: "À trier", plusieurs: "À trier" },
  };
  const ORDRE = ["chateau", "village", "interieur", "realisation", "inspiration", "autre"];
  const ROMAIN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

  const jeuId = document.body.dataset.jeu;
  const $ = (sel) => document.querySelector(sel);
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
    const jeu = config.jeux[jeuId];

    let chantiers = jeu ? jeu.chantiers.slice() : [];
    const connus = new Set(chantiers.map((c) => c.id));
    // images dont le chantier n'existe pas (ou plus) dans la config
    const orphelines = donnees.images.filter((im) => !connus.has(im.chantier));
    if (orphelines.length) chantiers.push({ id: "__autres", nom: "À trier", type: "autre" });

    chantiers.sort(
      (a, b) => ORDRE.indexOf(a.type) - ORDRE.indexOf(b.type) || (a.numero || 99) - (b.numero || 99)
    );

    const parChantier = {};
    donnees.images.forEach((im) => {
      const cle = connus.has(im.chantier) ? im.chantier : "__autres";
      (parChantier[cle] = parChantier[cle] || []).push(im);
    });

    // chiffres de l'en-tête
    const actifs = chantiers.filter((c) => (parChantier[c.id] || []).length);
    $("#nb-images").textContent = donnees.images.length;
    $("#nb-chantiers").textContent = actifs.filter((c) => c.type === "chateau" || c.type === "village").length;
    const derniere = donnees.images.reduce((max, im) => (im.date > max ? im.date : max), "");
    $("#derniere").textContent = derniere ? dateFr(derniere) : "—";

    const contenu = $("#contenu");
    if (!donnees.images.length) {
      contenu.append(
        el("div", { class: "vide" }, [
          el("h2", { texte: "Le bot n'est pas encore passé" }),
          el("p", { texte: "Les screens postés sur Discord apparaîtront ici après son prochain passage." }),
        ])
      );
      return;
    }

    // filtres par type
    const types = ORDRE.filter((t) => actifs.some((c) => c.type === t));
    const barre = $("#filtres");
    const boutons = [];
    const ajouterFiltre = (type, libelle, nb) => {
      const b = el("button", { class: "filtre", type: "button", "aria-pressed": type === "tout" ? "true" : "false" }, [
        document.createTextNode(libelle),
        el("span", { texte: nb }),
      ]);
      b.addEventListener("click", () => filtrer(type));
      b.dataset.type = type;
      boutons.push(b);
      barre.append(b);
    };
    if (types.length > 1) {
      ajouterFiltre("tout", "Tout", donnees.images.length);
      types.forEach((t) => {
        const nb = actifs.filter((c) => c.type === t).reduce((s, c) => s + parChantier[c.id].length, 0);
        ajouterFiltre(t, TYPES[t].plusieurs, nb);
      });
    } else {
      barre.remove();
    }

    // sections
    const ordreVisionneuse = [];
    const sections = [];
    actifs.forEach((c) => {
      const images = parChantier[c.id];
      const tete = el("div", { class: "chantier-tete" }, [
        el("span", {
          class: "chantier-type",
          texte: TYPES[c.type].un + (c.numero && ROMAIN[c.numero] ? " " + ROMAIN[c.numero] : ""),
        }),
        el("h2", { texte: c.nom }),
        c.detail ? el("span", { class: "etiquette", texte: c.detail }) : null,
        el("span", { class: "compte", texte: images.length + (images.length > 1 ? " images" : " image") }),
      ]);
      const mur = el("div", { class: "mur" });
      images.forEach((im) => {
        const index = ordreVisionneuse.length;
        ordreVisionneuse.push({ ...im, nomChantier: c.nom });
        const img = el("img", {
          src: im.miniature,
          alt: im.legende || c.nom,
          loading: "lazy",
          decoding: "async",
          width: im.largeur,
          height: im.hauteur,
        });
        img.addEventListener("load", () => img.classList.add("charge"));
        const v = el("button", { class: "vignette", type: "button", "aria-label": "Agrandir" }, [img]);
        v.addEventListener("click", () => ouvrir(index));
        mur.append(v);
      });
      const s = el("section", { class: "chantier", id: c.id }, [tete, mur]);
      s.dataset.type = c.type;
      sections.push(s);
      contenu.append(s);
    });

    function filtrer(type) {
      boutons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === type)));
      sections.forEach((s) => (s.hidden = type !== "tout" && s.dataset.type !== type));
    }

    // visionneuse
    const vis = $("#visionneuse");
    const grande = vis.querySelector("img");
    const infos = vis.querySelector(".infos");
    let courant = 0;
    function afficher() {
      const im = ordreVisionneuse[courant];
      grande.src = im.image;
      grande.alt = im.legende || im.nomChantier;
      infos.replaceChildren(
        el("strong", { texte: im.nomChantier }),
        document.createTextNode(" · " + dateFr(im.date) + (im.legende ? " · " + im.legende : ""))
      );
    }
    function ouvrir(i) {
      courant = i;
      afficher();
      vis.classList.add("ouverte");
      document.body.style.overflow = "hidden";
    }
    function fermer() {
      vis.classList.remove("ouverte");
      document.body.style.overflow = "";
    }
    const pas = (d) => {
      courant = (courant + d + ordreVisionneuse.length) % ordreVisionneuse.length;
      afficher();
    };
    vis.querySelector(".fermer").addEventListener("click", fermer);
    vis.querySelector(".prec").addEventListener("click", () => pas(-1));
    vis.querySelector(".suiv").addEventListener("click", () => pas(1));
    vis.addEventListener("click", (e) => e.target === vis && fermer());
    document.addEventListener("keydown", (e) => {
      if (!vis.classList.contains("ouverte")) return;
      if (e.key === "Escape") fermer();
      if (e.key === "ArrowLeft") pas(-1);
      if (e.key === "ArrowRight") pas(1);
    });
  }

  init();
})();
