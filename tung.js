"use strict";

/* ============================= Points de Maître Tung =============================
   Fiches de points et de groupes (Dao Ma), fusionnées entre plusieurs sources mais gardées source par source ; protocoles D/G ; théorie par mouvement ; cas cliniques.
   Données : tung/tung.json (généré par data/tung/generer.py à partir de Goodman, des notes de gynécologie et de Tan)
           + tung/tung_perso.json (fiches créées et compléments faits dans l'application ; jamais réécrit par le script).
   Dépend de app.js : Store, escapeHtml, dsNorm. */

const Tung = {
  CHEMIN_BASE: "tung/tung.json",
  CHEMIN_PERSO: "tung/tung_perso.json",
  base: null,
  perso: { titre: "Fiches Tung créées ou complétées dans l'application", fiches: [], ajouts: {}, protocoles: [] },
  liste: [],
  protos: [],
  vue: "fiches",            // fiches | protocoles | mouvements
  actif: null,
  zone: null,
  canal: null,
  CODES: ["P", "GI", "E", "Rt", "C", "IG", "V", "Rn", "EC", "TF", "VB", "F"],
  recherche: "",
  edition: null,
  _p: null,

  async ensureLoaded() {
    if (!this._p) {
      this._p = (async () => {
        this.base = await Store.readJSON(this.CHEMIN_BASE);
        try {
          const p = await Store.readJSON(this.CHEMIN_PERSO);
          this.perso = { titre: p.titre || this.perso.titre, fiches: p.fiches || [], ajouts: p.ajouts || {}, protocoles: p.protocoles || [] };
        } catch (e) { /* pas encore de fichier personnel */ }
        this.recomposer();
      })();
    }
    try { await this._p; } catch (e) { this._p = null; throw e; }
  },

  recomposer() {
    const aj = this.perso.ajouts || {};
    const b = this.base.fiches.map(f => {
      const a = aj[f.id];
      const blocs = [...f.blocs];
      if (a && a.champs && a.champs.length) blocs.push({ source: "perso", page: "", champs: a.champs, titre: a.source || "" });
      const canaux = a && a.canaux !== undefined ? { codes: a.canaux, statut: "toi", source: "" } : (f.canaux || { codes: [], statut: "", source: "" });
      return { ...f, nomBase: f.nom, numerosBase: f.numeros || [], nom: (a && a.nom) || f.nom, numeros: a && Array.isArray(a.numeros) ? a.numeros : f.numeros, alias: [...(f.alias || []), ...((a && a.alias) || [])], images: [...(f.images || []), ...((a && a.images) || [])], imagesPerso: (a && a.images) || [], blocs, canaux, origine: "base", complete: !!a };
    });
    const p = (this.perso.fiches || []).map(f => ({ zh: "", trad: "", numeros: [], alias: [], membres: [], images: [], a_verifier: [], canaux: { codes: [], statut: "", source: "" }, ...f, imagesPerso: f.images || [], origine: "perso" }));
    this.liste = [...b, ...p];
    // familles : les points cités avec leur fiche dans « membres » sont rangés sous la fiche du groupe, dans l'ordre du groupe (celui des numéros)
    this.liste.forEach(f => { f.enfants = []; });
    this.liste.forEach(f => (f.membres || []).forEach(m => {
      const id = Array.isArray(m) ? m[1] : null, e = id ? this.liste.find(x => x.id === id) : null;
      if (e && e !== f && !e.parent && !f.parent) { e.parent = f.id; f.enfants.push(e.id); }
    }));
    this.protos = [...this.base.protocoles.map(x => ({ ...x, origine: "base" })), ...(this.perso.protocoles || []).map(x => ({ ...x, origine: "perso" }))];
  },

  parId(id) { return this.liste.find(f => f.id === id) || null; },
  // un nom écrit dans une liste de points (« Shui Jin », « Zhong Bai 11.23 », « 77.08 ») : retrouve la fiche Tung par son nom, ses alias, son numéro ou son identifiant
  cleNom(x) { return String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, ""); },
  parNom(texte) {
    const k = this.cleNom(texte);
    if (!k) return null;
    return this.liste.find(f => this.cleNom(f.nom) === k || (f.alias || []).some(x => this.cleNom(x) === k) || (f.numeros || []).some(n => this.cleNom(n) === k) ||
      ((f.numeros || []).length && this.cleNom(f.nom + " " + f.numeros[0]) === k) || this.cleNom(f.id) === k) || null;
  },
  zoneNom(n) { const z = (this.base.zones || []).find(x => x.n === n); return z ? z.nom : ""; },
  srcCourt(s) { return s === "perso" ? "" : ((this.base.sources[s] || {}).court || s); },
  texteRecherche(f) {
    const ch = f.blocs.flatMap(b => b.champs.map(c => [c.k, ...(Array.isArray(c.v) ? c.v : [c.v])].join(" ")));
    return dsNorm([f.nom, f.zh, f.trad, ...(f.numeros || []), ...((f.canaux || {}).codes || []), ...(f.alias || []), ...(f.membres || []).map(m => m[0] || m), ...ch].join(" "));
  },
  ul(items) { return items && items.length ? `<ul class="tcm-list">${items.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""; },
  lignes(t) { return String(t || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean); },

  // ---------- onglet
  init() {
    document.getElementById("tung-search").addEventListener("input", e => { this.recherche = e.target.value; this.rendreListe(); });
    document.getElementById("tung-nouveau").addEventListener("click", () => this.nouveau());
    const bd = document.getElementById("tung-dossier"), fd = document.getElementById("tung-dossier-fichiers");
    if (bd && fd) { bd.addEventListener("click", () => fd.click()); fd.addEventListener("change", () => { const l = [...fd.files]; fd.value = ""; if (l.length) this.importerDossier(l); }); }
    document.querySelector('.tab-btn[data-tab="tung"]').addEventListener("click", () => this.ouvert());
    document.addEventListener("click", async e => {
      const b = e.target.closest("[data-tung-fiche]");
      if (b && b.closest("#tab-tung")) this.afficher(b.dataset.tungFiche, "fiches");
      else if (b) { if (typeof Onglets !== "undefined") Onglets.ouvrirTung(b.dataset.tungFiche); }
    });
  },

  async ouvert() {
    try { await this.ensureLoaded(); } catch (e) { document.getElementById("tung-detail").innerHTML = `<p class="muted">Chargement impossible (${escapeHtml(e.message)}).</p>`; return; }
    this.rendrePuces(); this.rendreListe();
    if (this.actif) this.rendreDetail();
  },

  rendrePuces() {
    const vues = [["fiches", "Points et groupes"], ["protocoles", "Protocoles D/G"], ["mouvements", "Mouvements"]];
    document.getElementById("tung-vues").innerHTML = vues.map(([k, l]) => `<button type="button" class="cat-chip${this.vue === k ? " active" : ""}" data-v="${k}">${l}</button>`).join("");
    document.querySelectorAll("#tung-vues button").forEach(b => b.addEventListener("click", () => { this.vue = b.dataset.v; this.actif = null; this.edition = null; this.rendrePuces(); this.rendreListe(); this.rendreDetail(); }));
    const z = document.getElementById("tung-zones");
    if (this.vue !== "fiches") { z.innerHTML = ""; return; }
    const nc = k => this.liste.filter(f => ((f.canaux || {}).codes || []).includes(k)).length;
    const n = k => this.liste.filter(f => f.zone === k).length;
    z.innerHTML = `<button type="button" class="cat-chip${this.zone ? "" : " active"}" data-z="">Toutes</button>` +
      this.base.zones.filter(x => n(x.n)).map(x => `<button type="button" class="cat-chip${this.zone === x.n ? " active" : ""}" data-z="${x.n}" title="${escapeHtml(x.nom)}">${x.n} · ${escapeHtml(x.nom)}</button>`).join("") +
      (this.liste.some(f => !f.zone) ? `<button type="button" class="cat-chip${this.zone === "?" ? " active" : ""}" data-z="?">Sans numéro</button>` : "") +
      `<div class="tung-canaux-filtre muted">Canal :</div>` + this.CODES.filter(nc).map(k => `<button type="button" class="cat-chip${this.canal === k ? " active" : ""}" data-c="${k}">${k} (${nc(k)})</button>`).join("") +
      `<button type="button" class="cat-chip${this.canal === "?" ? " active" : ""}" data-c="?">Canal inconnu</button>`;
    z.querySelectorAll("button[data-z]").forEach(b => b.addEventListener("click", () => { this.zone = b.dataset.z || null; this.rendrePuces(); this.rendreListe(); }));
    z.querySelectorAll("button[data-c]").forEach(b => b.addEventListener("click", () => { this.canal = this.canal === b.dataset.c ? null : b.dataset.c; this.rendrePuces(); this.rendreListe(); }));
  },

  rendreListe() {
    const ul = document.getElementById("tung-list"), q = dsNorm(this.recherche.trim()), mots = q ? q.split(/\s+/) : [];
    let html = "", n = 0;
    if (this.vue === "fiches") {
      const ok = f => (!this.zone || (this.zone === "?" ? !f.zone : f.zone === this.zone)) && (!this.canal || (this.canal === "?" ? !((f.canaux || {}).codes || []).length : ((f.canaux || {}).codes || []).includes(this.canal))) && mots.every(m => this.texteRecherche(f).includes(m));
      const ligne = (f, enfant) => `<li class="gl-item tung-item${enfant ? " tung-enfant" : ""}${f.id === this.actif ? " selected" : ""}" data-id="${escapeHtml(f.id)}"><strong>${enfant ? "↳ " : ""}${escapeHtml(f.nom)}</strong>` +
        `<span class="muted">${escapeHtml((f.numeros || []).join(" · ") || "sans numéro")}${((f.canaux || {}).codes || []).length ? " · canal " + (f.canaux.collectif ? "six fu" + f.canaux.codes.filter(k => !["GI", "E", "IG", "V", "VB", "TF"].includes(k)).map(k => "+" + k).join("") : f.canaux.codes.join("+")) : ""}${f.type === "groupe" ? " · groupe" : ""}${f.origine === "perso" ? "" : f.complete ? " · complété" : ""}</span>` +
        `<span class="tung-srcs">${[...new Set(f.blocs.map(b => b.source))].filter(s => s !== "perso").map(s => `<span class="sx-code">${escapeHtml(this.srcCourt(s))}</span>`).join("")}</span></li>`;
      const racines = this.liste.filter(f => !f.parent);
      racines.forEach(f => {
        const enf = (f.enfants || []).map(id => this.parId(id)).filter(Boolean);
        const montre = ok(f) ? enf : enf.filter(ok);
        if (ok(f) || montre.length) { html += ligne(f, false) + montre.map(e => ligne(e, true)).join(""); n += 1 + montre.length; }
      });
    } else if (this.vue === "protocoles") {
      const l = this.protos.filter(p => mots.every(m => dsNorm([p.nom, p.mouvement, p.indication].join(" ")).includes(m)));
      n = l.length;
      html = l.map(p => `<li class="gl-item tung-item${p.id === this.actif ? " selected" : ""}" data-id="${escapeHtml(p.id)}"><strong>${escapeHtml(p.nom)}</strong><span class="muted">${escapeHtml(p.mouvement || "")}</span></li>`).join("");
    } else {
      const l = this.base.mouvements.filter(m => mots.every(x => dsNorm(m.nom).includes(x)));
      n = l.length;
      html = l.map(m => `<li class="gl-item tung-item${m.id === this.actif ? " selected" : ""}" data-id="${escapeHtml(m.id)}"><strong>${escapeHtml(m.nom)}</strong></li>`).join("");
    }
    ul.innerHTML = html || `<li class="muted">Aucun résultat.</li>`;
    ul.querySelectorAll("li[data-id]").forEach(li => li.addEventListener("click", () => this.afficher(li.dataset.id)));
    document.getElementById("tung-count").textContent = n + (this.vue === "fiches" ? " fiche(s)" : this.vue === "protocoles" ? " protocole(s)" : " mouvement(s)");
  },

  afficher(id, vue) {
    if (vue && vue !== this.vue) { this.vue = vue; this.rendrePuces(); }
    this.actif = id; this.edition = null; this.rendreListe(); this.rendreDetail();
  },

  // zone où s'affichent la fiche et son formulaire : le panneau Tung, ou l'onglet de travail dans lequel on modifie la fiche
  zoneDetail() { return this._ctx ? this._ctx.zone : document.getElementById("tung-detail"); },

  rendreDetail() {
    if (this._ctx && !this.edition) {          // fin d'une modification faite dans un onglet : on réaffiche la fiche dans cet onglet
      const { zone, id } = this._ctx;
      this._ctx = null;
      this.rendreFicheDans(zone, id, false);
      Store.hydrateImages(zone);
      return;
    }
    const z = this.zoneDetail();
    if (this.edition) return;
    if (!this.actif) { z.innerHTML = `<p class="muted">Sélectionne une fiche à gauche, ou crée la tienne avec « + Nouveau ».</p>`; return; }
    if (this.vue === "fiches") this.rendreFiche(z);
    else if (this.vue === "protocoles") this.rendreProtocole(z);
    else this.rendreMouvement(z);
    Store.hydrateImages(z);
  },

  img(f, retirable) {
    const rel = "tung/images/" + f, gh = Store.mode === "github";
    const a = `<a class="tung-img" ${gh ? `data-gh-rel="${rel}" href="#"` : `href="data/${rel}"`} target="_blank" rel="noopener"><img loading="lazy" alt="Schéma" ${gh ? "" : `src="data/${rel}"`}></a>`;
    return retirable ? `<span class="tung-img-wrap">${a}<button type="button" class="tung-img-x" data-img-x="${escapeHtml(f)}" title="Retirer cette image de la fiche" aria-label="Retirer cette image de la fiche">✕</button></span>` : a;
  },

  // ---------- images ajoutées à une fiche (photo, schéma) : réduites puis rangées dans tung/images/, et notées dans ton fichier personnel
  async reduireImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    try {
      const bmp = await createImageBitmap(file), ech = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * ech); cv.height = Math.round(bmp.height * ech);
      const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise(ok => cv.toBlob(ok, "image/jpeg", 0.85));
      return blob && (ech < 1 || blob.size < file.size) ? blob : file;
    } catch (e) { return file; }
  },
  imagesDe(f) { return f.origine === "perso" ? (this.perso.fiches.find(x => x.id === f.id) || {}).images || [] : ((this.perso.ajouts || {})[f.id] || {}).images || []; },
  poserImages(f, liste) {
    if (f.origine === "perso") { const x = this.perso.fiches.find(y => y.id === f.id); if (x) x.images = liste; return; }
    const aj = this.perso.ajouts[f.id] = this.perso.ajouts[f.id] || { alias: [], champs: [], source: "" };
    if (liste.length) aj.images = liste; else delete aj.images;
    if (!liste.length && !(aj.champs || []).length && !(aj.alias || []).length && aj.canaux === undefined) delete this.perso.ajouts[f.id];
  },
  async ajouterImages(f, fichiers, statut) {
    const dire = m => { if (statut) statut.textContent = m; };
    const liste = [...this.imagesDe(f)];
    let n = 0;
    for (const file of fichiers) {
      if (!/^image\//.test(file.type)) { dire("« " + file.name + " » n'est pas une image."); continue; }
      n++; dire("Envoi de l'image " + n + " sur " + fichiers.length + "…");
      const blob = await this.reduireImage(file);
      const ext = blob.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";
      const nom = "perso_" + String(f.id).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40) + "_" + Date.now().toString(36) + n + "." + ext;
      try { await Store.writeBinary("tung/images/" + nom, blob); } catch (e) { dire("Image non enregistrée : " + e.message); return false; }
      liste.push(nom);
    }
    if (!n) return false;
    this.poserImages(f, liste);
    try { await this.ecrire(); } catch (e) { dire("Image envoyée, mais la fiche n'a pas pu être mise à jour : " + e.message); return false; }
    return true;
  },
  // ---------- un dossier d'images d'un coup : chaque image va dans la fiche dont elle porte le nom (nom du fichier, ou nom de son sous-dossier)
  cleImage(nom) {
    let s = String(nom || "").replace(/\.[A-Za-z0-9]+$/, "");
    s = s.replace(/[\s_.\-]*(?:\(\d+\)|\d{1,2})$/, "").replace(/[\s_\-]*(?:localisation|loc|image|img|schema|photo)$/i, "");      // « Shui Jin 2 », « shui_jin-loc »
    return this.cleNom(s);
  },
  fichePourImage(fichier) {
    const chemin = (fichier.webkitRelativePath || fichier.name).split("/"), nomFichier = chemin[chemin.length - 1], dossier = chemin.length > 1 ? chemin[chemin.length - 2] : "";
    const brut = this.cleNom(nomFichier.replace(/\.[A-Za-z0-9]+$/, "")), propre = this.cleImage(nomFichier), dos = this.cleImage(dossier);
    const cles = f => [f.nom, ...(f.alias || []), ...(f.numeros || []), f.id, ...((f.numeros || []).length ? [f.nom + " " + f.numeros[0]] : [])].map(x => this.cleNom(x)).filter(Boolean);
    const cherche = k => k ? this.liste.find(f => cles(f).includes(k)) : null;
    return cherche(brut) || cherche(propre) || cherche(dos) || (propre.length > 4 ? this.liste.find(f => cles(f).some(x => x.length > 4 && propre.startsWith(x))) : null) || null;
  },
  async importerDossier(fichiers) {
    try { await this.ensureLoaded(); } catch (e) { alert("Fiches Tung indisponibles : " + e.message); return; }
    const images = fichiers.filter(x => /^image\//.test(x.type) || /\.(jpe?g|png|webp|gif)$/i.test(x.name));
    if (!images.length) { alert("Ce dossier ne contient aucune image."); return; }
    const parFiche = new Map(), sans = [];
    images.forEach(x => { const f = this.fichePourImage(x); if (f) { if (!parFiche.has(f.id)) parFiche.set(f.id, []); parFiche.get(f.id).push(x); } else sans.push(x.webkitRelativePath || x.name); });
    const resume = () => parFiche.size + " fiche(s) reconnue(s), " + [...parFiche.values()].reduce((s, l) => s + l.length, 0) + " image(s)" + (sans.length ? " ; " + sans.length + " image(s) sans fiche : " + sans.slice(0, 8).join(", ") + (sans.length > 8 ? "…" : "") : "");
    if (!parFiche.size) { alert("Aucune image ne porte le nom d'un point Tung.\n" + resume() + "\n\nNomme chaque image comme le point (ex. Shui Jin.png, Shui Jin 2.png) ou range-les dans un sous-dossier du nom du point."); return; }
    if (!confirm("Envoyer ces images dans les fiches ?\n" + resume())) return;
    const zone = document.getElementById("tung-detail"), avis = t => { if (zone) zone.insertAdjacentHTML("afterbegin", ""); const s = document.getElementById("tung-dossier"); if (s) s.textContent = t; };
    let fait = 0, deja = 0, echec = 0, n = 0;
    const total = images.length - sans.length;
    for (const [id, liste] of parFiche) {
      const f = this.parId(id); if (!f) continue;
      const imgs = [...this.imagesDe(f)];
      for (const file of liste) {
        n++; avis("📁 " + n + "/" + total);
        const nom = "perso_" + String(f.id).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40) + "_" + this.cleNom(file.name.replace(/\.[A-Za-z0-9]+$/, "")).slice(0, 24) + "_" + file.size.toString(36);
        if (imgs.some(x => x.startsWith(nom))) { deja++; continue; }                                       // déjà envoyée avec ce dossier
        const blob = await this.reduireImage(file), ext = blob.type === "image/jpeg" ? "jpg" : ((file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "png");
        try { await Store.writeBinary("tung/images/" + nom + "." + ext, blob); imgs.push(nom + "." + ext); fait++; } catch (e) { echec++; }
      }
      this.poserImages(f, imgs);
    }
    try { await this.ecrire(); } catch (e) { alert("Images envoyées, mais les fiches n'ont pas pu être mises à jour : " + e.message); }
    avis("📁 Images");
    this.recomposer(); this.rendreListe(); this.rendreDetail();
    alert(fait + " image(s) ajoutée(s)" + (deja ? ", " + deja + " déjà présente(s)" : "") + (echec ? ", " + echec + " en échec" : "") + (sans.length ? ".\nSans fiche : " + sans.slice(0, 10).join(", ") + (sans.length > 10 ? "…" : "") : "."));
  },
  async retirerImage(f, nom) {
    if (!confirm("Retirer cette image de la fiche ?")) return false;
    this.poserImages(f, this.imagesDe(f).filter(x => x !== nom));
    try { await this.ecrire(); } catch (e) { alert("Impossible : " + e.message); return false; }
    return true;
  },

  // abréviations des sources, écrites seulement quand une information ne vient pas de la source dominante du champ
  ABBR: { goodman: "Go", gyneco: "Gy", tan: "Ta", elotus: "eL", perso: "" },
  etiquette(it) {
    if (it.source === "perso") return "";
    const s = it.source, nom = s === "perso" ? "Tes ajouts" + (it.titre ? " — " + it.titre : "") : ((this.base.sources[s] || {}).nom || s);
    return `<span class="tung-tag" title="${escapeHtml(nom + (it.page ? ", p. " + it.page : "") + (it.langue === "en" ? " (texte en anglais)" : ""))}">${this.ABBR[s] || s}${it.page ? " " + escapeHtml(it.page) : ""}${it.langue === "en" ? " · EN" : ""}</span>`;
  },

  // un seul bloc par rubrique : les informations de toutes les sources sont mises ensemble ; seule la source qui diffère du reste de la rubrique est abrégée
  champsFusionnes(f) {
    const NORM = { "Fonctions": "Action", "Localisation / équivalence": "Localisation" };
    const ORDRE = ["Membres", "Localisation", "Action", "Indications", "Technique", "Logique / correspondance", "Associations", "Avec", "Usage"];
    const m = new Map();
    f.blocs.forEach(b => b.champs.forEach(c => {
      const k = NORM[c.k] || c.k;
      if (!m.has(k)) m.set(k, []);
      (Array.isArray(c.v) ? c.v : [c.v]).forEach(x => m.get(k).push({ text: x, source: b.source, page: b.page, titre: b.titre, langue: b.langue }));
    }));
    const cles = [...m.keys()].sort((a, b) => { const x = ORDRE.indexOf(a), y = ORDRE.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
    const sources = [...new Set(f.blocs.map(b => b.source))];
    const principale = sources.find(s => s !== "perso") || sources[0];
    const liste = sources.filter(s => s !== "perso").map(s => { const b = f.blocs.filter(x => x.source === s); const pg = b.map(x => x.page).filter(Boolean).join(", "); return `<span class="tung-tag-leg">${this.ABBR[s] || s} = ${escapeHtml((this.base.sources[s] || {}).court || s)}${pg ? " p. " + escapeHtml(pg) : ""}${b.some(x => x.langue === "en") ? " (anglais)" : ""}</span>`; });
    const champs = cles.map(k => {
      const items = m.get(k), cnt = {};
      items.forEach(x => { cnt[x.source] = (cnt[x.source] || 0) + 1; });
      const dom = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || sources.indexOf(a) - sources.indexOf(b))[0];
      const tete = dom !== principale ? this.etiquette(items.find(x => x.source === dom)) : "";
      const ligne = x => escapeHtml(x.text) + (x.source !== dom ? " " + this.etiquette(x) : "");
      return `<div class="tung-champ"><h4>${escapeHtml(k)} ${tete}</h4>${items.length > 1 ? `<ul class="tcm-list">${items.map(x => `<li>${ligne(x)}</li>`).join("")}</ul>` : `<p>${ligne(items[0])}</p>`}</div>`;
    }).join("");
    return (liste.length ? `<p class="tung-sources muted">Sources : ${liste.join(" · ")}. Une abréviation n'est écrite que là où l'information ne vient pas de la même source que le reste de la rubrique.</p>` : "") + champs;
  },

  champ(c, langue) {
    const v = Array.isArray(c.v) ? c.v : [c.v];
    return `<div class="tung-champ"><h4>${escapeHtml(c.k)}</h4>${v.length > 1 ? this.ul(v) : `<p>${escapeHtml(v[0])}</p>`}</div>`;
  },

  rendreFiche(z, lecture) {
    const f = this.parId(this.actif);
    if (!f) { z.innerHTML = ""; return; }
    const membres = (f.membres || []).map(m => { const t = Array.isArray(m) ? m[0] : m, id = Array.isArray(m) ? m[1] : null; return id ? `<button type="button" class="cat-chip" data-tung-fiche="${escapeHtml(id)}">${escapeHtml(t)}</button>` : `<span class="cat-chip tung-membre">${escapeHtml(t)}</span>`; }).join("");
    const blocs = this.champsFusionnes(f);
    const prot = this.protos.filter(p => JSON.stringify(p.etapes).includes('"id":"' + f.id + '"'));
    const cas = (this.base.cas || []).filter(c => (c.ids || []).includes(f.id));
    const casHtml = cas.map(c => `<details class="tung-cas"><summary><strong>${escapeHtml(c.titre)}</strong> <span class="muted">(Tan, p. ${c.pages[0]}${c.pages.length > 1 ? "–" + c.pages[c.pages.length - 1] : ""})</span></summary>` +
      [["Patient", c.patient], ["Motif", c.motif], ["Points", c.points.map(p => p.point + (p.cote ? " — " + p.cote : "")).join(" ; ")], ["Traitement", c.traitement], ["Résultat", c.resultat], ["Commentaire", c.commentaire]].filter(x => x[1]).map(x => `<p><strong>${x[0]} :</strong> ${escapeHtml(x[1])}</p>`).join("") +
      (c.a_verifier.length ? `<p class="muted">À vérifier : ${escapeHtml(c.a_verifier.join(" · "))}</p>` : "") + `</details>`).join("");
    z.innerHTML = `
      <div class="circ-barre barre-flottante">
        <button type="button" class="edit-toggle-btn" id="tung-img-add" title="Ajouter une image (photo, schéma)" aria-label="Ajouter une image">📷</button><input type="file" id="tung-img-fichier" accept="image/*" multiple hidden>
        <button type="button" class="edit-toggle-btn" id="tung-edit" title="${f.origine === "perso" ? "Modifier cette fiche" : "Compléter cette fiche"}" aria-label="${f.origine === "perso" ? "Modifier cette fiche" : "Compléter cette fiche"}">✏️</button>
        ${f.origine === "perso" ? `<button type="button" class="edit-toggle-btn" id="tung-suppr" title="Supprimer cette fiche" aria-label="Supprimer cette fiche">🗑</button>` : f.complete ? `<button type="button" class="edit-toggle-btn" id="tung-retablir" title="Retirer mes ajouts" aria-label="Retirer mes ajouts">↺</button>` : ""}
      </div>
      <h2>${escapeHtml(f.nom)} ${f.zh ? `<span class="tung-zh">${escapeHtml(f.zh)}</span>` : ""}</h2>
      <p class="tung-ident">${(f.numeros || []).map(n => `<span class="sx-code">${escapeHtml(n)}</span>`).join(" ")} ${f.zone ? `<span class="muted">zone ${escapeHtml(f.zone)} · ${escapeHtml(this.zoneNom(f.zone))}</span>` : `<span class="muted">zone non précisée</span>`}${f.type === "groupe" ? ` <span class="muted">· groupe de points</span>` : ""}</p>
      ${f.parent && this.parId(f.parent) ? `<p class="muted">Famille : <button type="button" class="tung-lien" data-tung-fiche="${escapeHtml(f.parent)}">${escapeHtml(this.parId(f.parent).nom)}</button></p>` : ""}
      ${this.htmlCanaux(f)}
      ${f.trad ? `<p class="muted">${escapeHtml(f.trad)}</p>` : ""}
      ${(f.alias || []).length ? `<p class="muted">Aussi : ${escapeHtml(f.alias.join(" ; "))}</p>` : ""}
      ${membres ? `<div class="cat-chip-row">${membres}</div>` : ""}
      <p id="tung-img-statut" class="muted" aria-live="polite"></p>
      ${(f.images || []).length ? `<div class="tung-imgs">${f.images.map(i => this.img(i, !lecture && (f.imagesPerso || []).includes(i))).join("")}</div>` : ""}
      ${blocs}
      ${prot.length ? `<section><h3>Dans les protocoles</h3><div class="circ-synd-liste">${prot.map(p => `<button type="button" class="edit-toggle-btn" data-tung-proto="${escapeHtml(p.id)}">${escapeHtml(p.nom)}</button>`).join(" ")}</div></section>` : ""}
      ${casHtml ? `<section><h3>Cas cliniques du livre de Tan</h3><p class="muted">Résumés traduits en français, pas le texte du livre.</p>${casHtml}</section>` : ""}
      ${(f.a_verifier || []).length ? `<section><h3>À vérifier</h3>${this.ul(f.a_verifier)}</section>` : ""}`;
    z.querySelectorAll("[data-tung-proto]").forEach(b => b.addEventListener("click", () => this.afficher(b.dataset.tungProto, "protocoles")));
    if (lecture) {
      z.querySelectorAll(".circ-barre, [data-tung-proto]").forEach(x => { const sec = x.closest("section"); (sec || x).remove(); });
      return;
    }
    const dansOnglet = z !== document.getElementById("tung-detail");
    const ctx = () => { this._ctx = dansOnglet ? { zone: z, id: f.id } : null; };
    z.querySelector("#tung-edit").addEventListener("click", () => { ctx(); this.modifier(f); });
    const apresImage = () => { ctx(); this.recomposer(); this.actif = f.id; this.rendreDetail(); };
    const fi = z.querySelector("#tung-img-fichier");
    z.querySelector("#tung-img-add").addEventListener("click", () => fi.click());
    fi.addEventListener("change", async () => { const l = [...fi.files]; fi.value = ""; if (l.length && await this.ajouterImages(f, l, z.querySelector("#tung-img-statut"))) apresImage(); });
    z.querySelectorAll("[data-img-x]").forEach(b => b.addEventListener("click", async () => { if (await this.retirerImage(f, b.dataset.imgX)) apresImage(); }));
    const s = z.querySelector("#tung-suppr"); if (s) s.addEventListener("click", () => { ctx(); this.supprimer(f); });
    const r = z.querySelector("#tung-retablir"); if (r) r.addEventListener("click", () => { ctx(); this.retablir(f); });
  },

  // texte d'une rubrique (première source qui la donne)
  rubrique(f, noms, max) {
    for (const b of f.blocs) for (const c of b.champs) if (noms.some(n => c.k === n || c.k.startsWith(n))) { const v = Array.isArray(c.v) ? c.v : [c.v]; return (max ? v.slice(0, max) : v).join(" ; "); }
    return "";
  },
  action(f) { const x = this.rubrique(f, ["Action"]) || this.rubrique(f, ["Indications"], 3); return x.length > 170 ? x.slice(0, 167).replace(/\s+\S*$/, "") + "…" : x; },
  localisation(f) { return this.rubrique(f, ["Localisation"]) || ""; },

  htmlCanaux(f) {
    const c = f.canaux || {}, l = c.codes || [];
    if (!l.length) return `<p class="muted tung-canal">Canal : non renseigné — le crayon ✏️ permet de le choisir.</p>`;
    if (c.collectif) { const FU = ["GI", "E", "IG", "V", "VB", "TF"], autres = l.filter(k => !FU.includes(k)); return `<p class="tung-canal"><strong>Canal :</strong> <span class="sx-code">les six fu</span> ${autres.map(k => `<span class="sx-code">${escapeHtml(k)}</span>`).join(" ")} <span class="muted">(les six fu ensemble${autres.length ? ", et " + autres.join(", ") : ""}${c.statut === "toi" ? "" : " — d'après la source"})</span></p>`; }
    const st = c.statut === "deduit" ? "déduit, à valider" : c.statut === "toi" ? "" : "d'après la source", note = [st, c.statut === "toi" ? "" : (c.source ? escapeHtml(c.source) : "")].filter(Boolean).join(" — ");
    return `<p class="tung-canal"><strong>Canal :</strong> ${l.map(k => `<span class="sx-code">${escapeHtml(k)}</span>`).join(" ")}${note ? ` <span class="muted">(${note})</span>` : ""}</p>`;
  },

  // points Tung compatibles avec un circuit : tous leurs canaux sont dans le circuit (le réseau reste équilibré) ; « avec ajout » si un canal d'ajout possible est nécessaire
  compatibles(grille, ajouts) {
    const g = new Set(grille), a = new Set((ajouts || []).flat());
    const ok = [], avec = [], collectifs = [];
    (this.liste || []).forEach(f => {
      const l = (f.canaux || {}).codes || [];
      if (!l.length) return;
      if (f.canaux.collectif) { if (l.some(k => g.has(k))) collectifs.push(f); return; }
      if (l.every(k => g.has(k))) ok.push(f); else if (l.every(k => g.has(k) || a.has(k))) avec.push(f);
    });
    return { ok, avec, collectifs };
  },

  // fiche en lecture seule dans une zone à part (onglet de travail)
  rendreFicheDans(zone, id, lecture) {
    const sauve = this.actif;
    this.actif = id;
    try { this.rendreFiche(zone, !!lecture); } finally { this.actif = sauve; }
  },

  cellule(c) { return !c ? "" : typeof c === "string" ? escapeHtml(c) : `<button type="button" class="tung-lien" data-tung-fiche="${escapeHtml(c.id)}">${escapeHtml(c.t)}</button>`; },

  rendreProtocole(z) {
    const p = this.protos.find(x => x.id === this.actif);
    if (!p) { z.innerHTML = ""; return; }
    const etapes = (p.etapes || []).map((e, i) => `<table class="tung-dg"><thead><tr><th>D</th><th>G</th></tr></thead><tbody>` +
      e.rows.map(r => `<tr><td>${this.cellule(r[0])}</td><td>${this.cellule(r[1])}</td></tr>`).join("") +
      ((e.centre || []).length ? `<tr class="tung-centre"><td colspan="2">${e.centre.map(c => this.cellule(c)).join(" · ")}</td></tr>` : "") + `</tbody></table>`).join("");
    z.innerHTML = `
      <div class="circ-barre">${p.origine === "perso" ? `<button type="button" class="edit-toggle-btn" id="tung-pedit">✏️ Modifier</button><button type="button" class="edit-toggle-btn" id="tung-psuppr">🗑 Supprimer</button>` : ""}</div>
      <h2>${escapeHtml(p.nom)}</h2>
      <p class="muted">${p.mouvement ? "Mouvement : " + escapeHtml(p.mouvement) : ""}${p.page ? " · " + escapeHtml(this.srcCourt("gyneco")) + ", p. " + escapeHtml(String(p.page)) : ""}</p>
      ${p.indication ? `<p>${escapeHtml(p.indication)}</p>` : ""}
      <p class="muted">D = droite, G = gauche ; la ligne du bas, quand il y en a une, est le centre (ligne médiane).</p>
      ${etapes}
      ${(p.notes || []).length ? `<section><h3>Notes</h3>${this.ul(p.notes)}</section>` : ""}
      ${(p.images || []).length ? `<div class="tung-imgs">${p.images.map(i => this.img(i)).join("")}</div>` : ""}`;
    const pe = document.getElementById("tung-pedit"); if (pe) pe.addEventListener("click", () => this.modifierProto(p));
    const ps = document.getElementById("tung-psuppr"); if (ps) ps.addEventListener("click", () => this.supprimerProto(p));
  },

  rendreMouvement(z) {
    const m = this.base.mouvements.find(x => x.id === this.actif);
    if (!m) { z.innerHTML = ""; return; }
    const prot = this.protos.filter(p => dsNorm(p.mouvement || "").replace("metal", "metal") === dsNorm(m.nom));
    z.innerHTML = `<h2>${escapeHtml(m.nom)}</h2><p class="muted">${escapeHtml((this.base.sources.gyneco || {}).nom)} — p. ${m.page}</p>${this.ul(m.lignes)}
      ${(m.formules || []).length ? `<section><h3>Formules et substances citées</h3>${m.formules.map(f => `<details open><summary><strong>${escapeHtml(f.nom)}</strong></summary>${this.ul(f.lignes)}</details>`).join("")}</section>` : ""}
      ${prot.length ? `<section><h3>Protocoles</h3><div class="circ-synd-liste">${prot.map(p => `<button type="button" class="edit-toggle-btn" data-tung-proto="${escapeHtml(p.id)}">${escapeHtml(p.nom)}</button>`).join(" ")}</div></section>` : ""}`;
    z.querySelectorAll("[data-tung-proto]").forEach(b => b.addEventListener("click", () => this.afficher(b.dataset.tungProto, "protocoles")));
  },

  // ---------- édition d'une fiche
  nouveau() {
    this.ensureLoaded().then(() => {
      if (this.vue === "protocoles") { this.edition = { proto: true, nouveau: true, nom: "", mouvement: "", indication: "", rows: "", centre: "", notes: "" }; this.actif = "(nouveau)"; this.rendreListe(); this.rendreEditionProto(); return; }
      this.vue = "fiches"; this.rendrePuces();
      this.edition = { nouveau: true, canaux: [], nom: "", zh: "", numeros: "", zone: "", type: "point", alias: "", membres: "", localisation: "", indications: "", technique: "", associations: "", notes: "", source: "" };
      this.actif = "(nouveau)"; this.rendreListe(); this.rendreEdition({ origine: "perso" });
    }).catch(e => { document.getElementById("tung-detail").innerHTML = `<p class="muted">Chargement impossible (${escapeHtml(e.message)}).</p>`; });
  },

  champsDe(b) { const g = k => { const c = (b ? b.champs : []).find(x => x.k === k); return c ? (Array.isArray(c.v) ? c.v : [c.v]) : []; }; return g; },

  modifier(f) {
    this.actif = f.id;
    const perso = f.origine === "perso";
    const bl = perso ? f.blocs.find(b => b.source === "perso") : (f.blocs.find(b => b.source === "perso") || null);
    const g = this.champsDe(bl);
    const a = (this.perso.ajouts || {})[f.id] || {};
    this.edition = { nouveau: false, canaux: [...((f.canaux || {}).codes || [])], nom: f.nom, zh: f.zh || "", numeros: (f.numeros || []).join(", "), zone: f.zone || "", type: f.type || "point",
      alias: (perso ? f.alias : (a.alias || [])).join("\n"), membres: (f.membres || []).map(m => Array.isArray(m) ? m[0] : m).join("\n"),
      localisation: g("Localisation").join("\n"), indications: g("Indications").join("\n"), technique: g("Technique").join("\n"), associations: g("Associations").join("\n"), notes: g("Notes").join("\n"),
      source: bl ? (bl.titre || "") : (a.source || "") };
    this.rendreEdition(f);
  },

  rendreEdition(f) {
    const d = this.edition, z = this.zoneDetail(), complet = f.origine === "perso";
    const T = (id, lib, rows, val, ph = "") => `<label>${lib}<textarea id="te-${id}" rows="${rows}" placeholder="${escapeHtml(ph)}">${escapeHtml(val)}</textarea></label>`;
    z.innerHTML = `<h2>${d.nouveau ? "Nouvelle fiche Tung" : (complet ? "Modifier : " : "Compléter : ") + escapeHtml(f.nom)}</h2>
      ${complet ? "" : `<p class="muted">Les informations des livres ne sont pas modifiées : ce que tu écris ici s'ajoute à ces informations.</p>`}
      <form class="circ-form" id="tung-form">
        <label>Nom (titre de la fiche)<input type="text" id="te-nom" value="${escapeHtml(d.nom)}"></label>
        <label>Numéro(s) Tung (séparés par des virgules, ex. 88.01, 88.02)<input type="text" id="te-numeros" value="${escapeHtml(d.numeros)}"></label>
        ${complet ? `<label>Caractères chinois (facultatif)<input type="text" id="te-zh" value="${escapeHtml(d.zh)}"></label>
        <label>Zone<select id="te-zone"><option value="">— non précisée / déduite du numéro —</option>${this.base.zones.map(x => `<option value="${x.n}"${d.zone === x.n ? " selected" : ""}>${x.n} · ${escapeHtml(x.nom)}</option>`).join("")}</select></label>
        <label>Type<select id="te-type"><option value="point"${d.type === "point" ? " selected" : ""}>Point</option><option value="groupe"${d.type === "groupe" ? " selected" : ""}>Groupe de points (Dao Ma)</option></select></label>
        ${T("membres", "Points du groupe (un par ligne)", 3, d.membres)}` : ""}
        <fieldset><legend>Canal de rattachement (pour les circuits)</legend><div class="tung-cases">${this.CODES.map(k => `<label class="tung-case"><input type="checkbox" data-canal="${k}"${(d.canaux || []).includes(k) ? " checked" : ""}> ${k}</label>`).join("")}</div>
          <p class="muted">À cocher quand le point agit sur ce canal : il pourra alors être proposé comme ajout dans les circuits qui contiennent ce canal.</p></fieldset>
        ${T("alias", "Autres noms (un par ligne)", 2, d.alias)}
        ${T("localisation", "Localisation", 3, d.localisation)}
        ${T("indications", "Indications (une par ligne)", 4, d.indications)}
        ${T("technique", "Technique (angle, profondeur, côté)", 2, d.technique)}
        ${T("associations", "Associations de points (une par ligne)", 3, d.associations)}
        ${T("notes", "Notes", 3, d.notes)}
        <label>Source de ces informations (cours, livre, page…)<input type="text" id="te-source" value="${escapeHtml(d.source)}"></label>
        <p id="te-statut" class="muted" aria-live="polite"></p>
        <div class="circ-barre"><button type="submit" class="edit-toggle-btn">💾 Enregistrer</button> <button type="button" class="edit-toggle-btn" id="te-annuler">Annuler</button></div>
      </form>`;
    document.getElementById("te-annuler").addEventListener("click", () => { const n = d.nouveau; this.edition = null; if (n) this.actif = null; this.rendreListe(); this.rendreDetail(); });
    document.getElementById("tung-form").addEventListener("submit", ev => { ev.preventDefault(); this.sauver(f); });
  },

  async ecrire() { await Store.writeJSON(this.CHEMIN_PERSO, { titre: this.perso.titre, fiches: this.perso.fiches, ajouts: this.perso.ajouts, protocoles: this.perso.protocoles }); },

  async sauver(f) {
    const v = id => { const e = document.getElementById("te-" + id); return e ? e.value : ""; }, statut = document.getElementById("te-statut"), d = this.edition;
    const complet = d.nouveau || f.origine === "perso";
    if (!v("nom").trim()) { statut.textContent = "Le nom est obligatoire."; return; }
    const champs = [["Localisation", this.lignes(v("localisation"))], ["Indications", this.lignes(v("indications"))], ["Technique", this.lignes(v("technique"))],
                    ["Associations", this.lignes(v("associations"))], ["Notes", this.lignes(v("notes"))]]
      .filter(x => x[1].length).map(([k, l]) => ({ k, v: l.length > 1 ? l : l[0] }));
    const alias = this.lignes(v("alias")), source = v("source").trim();
    const canaux = [...document.querySelectorAll("#tung-form [data-canal]:checked")].map(x => x.dataset.canal);
    let id = f.id;
    if (complet) {
      const numeros = v("numeros").split(/[,;]\s*/).map(x => x.trim()).filter(Boolean);
      const fiche = { id: d.nouveau ? "perso_" + dsNorm(v("nom")).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) + "_" + Date.now().toString(36) : f.id,
        nom: v("nom").trim(), zh: v("zh").trim(), numeros, zone: v("zone") || (numeros[0] && /^\d\d\./.test(numeros[0]) ? numeros[0].slice(0, 2) : null), type: v("type") || "point",
        alias, membres: this.lignes(v("membres")).map(t => [t, null]), images: f.images || [], blocs: [{ source: "perso", page: "", titre: source, champs }], a_verifier: [], canaux: { codes: canaux, statut: canaux.length ? "toi" : "", source: "" } };
      id = fiche.id;
      if (d.nouveau) this.perso.fiches.push(fiche); else this.perso.fiches[this.perso.fiches.findIndex(x => x.id === f.id)] = fiche;
    } else {
      const o = { alias, champs, source };
      const nomNouveau = v("nom").trim(), numNouveaux = v("numeros").split(/[,;]\s*/).map(x => x.trim()).filter(Boolean);
      if (nomNouveau !== (f.nomBase || f.nom)) o.nom = nomNouveau;                                                   // titre changé : on garde l'original dans les livres
      if (JSON.stringify(numNouveaux) !== JSON.stringify(f.numerosBase || f.numeros || [])) o.numeros = numNouveaux;
      const orig = (f.canaux || {}).statut === "toi" ? null : (f.canaux || {}).codes || [];
      if (!(orig && JSON.stringify(canaux) === JSON.stringify(orig))) o.canaux = canaux;
      const imgs = ((this.perso.ajouts || {})[f.id] || {}).images || [];
      if (imgs.length) o.images = imgs;
      if (champs.length || alias.length || o.canaux || imgs.length || o.nom !== undefined || o.numeros !== undefined) this.perso.ajouts[f.id] = o; else delete this.perso.ajouts[f.id];
    }
    
    statut.textContent = "Enregistrement…";
    try { await this.ecrire(); } catch (e) { statut.textContent = "Enregistrement impossible : " + e.message; return; }
    this.recomposer(); this.edition = null; this.actif = id; this.rendrePuces(); this.rendreListe(); this.rendreDetail();
  },

  async supprimer(f) {
    if (!confirm("Supprimer la fiche « " + f.nom + " » ? Cette action est définitive.")) return;
    this.perso.fiches = this.perso.fiches.filter(x => x.id !== f.id);
    try { await this.ecrire(); } catch (e) { alert("Suppression impossible : " + e.message); return; }
    this.recomposer(); this.actif = null; this.rendrePuces(); this.rendreListe(); this.rendreDetail();
  },

  async retablir(f) {
    if (!confirm("Retirer tes ajouts sur « " + f.nom + " » ?")) return;
    delete this.perso.ajouts[f.id];
    try { await this.ecrire(); } catch (e) { alert("Impossible : " + e.message); return; }
    this.recomposer(); this.rendreListe(); this.rendreDetail();
  },

  // ---------- protocoles créés par toi : une ligne « droite ; gauche » par rangée
  modifierProto(p) {
    this.actif = p.id;
    const e = (p.etapes || [])[0] || { rows: [], centre: [] }, t = c => (c && c.t) || c || "";
    this.edition = { proto: true, nouveau: false, nom: p.nom, mouvement: p.mouvement || "", indication: p.indication || "", rows: e.rows.map(r => t(r[0]) + " ; " + t(r[1])).join("\n"), centre: (e.centre || []).map(t).join(", "), notes: (p.notes || []).join("\n") };
    this.rendreEditionProto(p);
  },

  rendreEditionProto(p) {
    const d = this.edition, z = this.zoneDetail();
    z.innerHTML = `<h2>${d.nouveau ? "Nouveau protocole" : "Modifier : " + escapeHtml(d.nom)}</h2>
      <form class="circ-form" id="tung-pform">
        <label>Nom<input type="text" id="tp-nom" value="${escapeHtml(d.nom)}"></label>
        <label>Mouvement (facultatif)<input type="text" id="tp-mouv" value="${escapeHtml(d.mouvement)}" placeholder="Bois, Feu, Terre, Métal, Eau"></label>
        <label>Indication (facultatif)<input type="text" id="tp-ind" value="${escapeHtml(d.indication)}"></label>
        <label>Points : une rangée par ligne, « droite ; gauche »<textarea id="tp-rows" rows="6">${escapeHtml(d.rows)}</textarea></label>
        <label>Points du centre (séparés par des virgules)<input type="text" id="tp-centre" value="${escapeHtml(d.centre)}"></label>
        <label>Notes (une par ligne)<textarea id="tp-notes" rows="3">${escapeHtml(d.notes)}</textarea></label>
        <p id="tp-statut" class="muted"></p>
        <div class="circ-barre"><button type="submit" class="edit-toggle-btn">💾 Enregistrer</button> <button type="button" class="edit-toggle-btn" id="tp-annuler">Annuler</button></div>
      </form>`;
    document.getElementById("tp-annuler").addEventListener("click", () => { const n = d.nouveau; this.edition = null; if (n) this.actif = null; this.rendreListe(); this.rendreDetail(); });
    document.getElementById("tung-pform").addEventListener("submit", async ev => {
      ev.preventDefault();
      const g = id => document.getElementById(id).value, nom = g("tp-nom").trim();
      if (!nom) { document.getElementById("tp-statut").textContent = "Le nom est obligatoire."; return; }
      const rows = this.lignes(g("tp-rows")).map(l => { const [a, b] = l.split(/\s*;\s*/); return [(a || "").trim(), (b || "").trim()]; });
      const id = d.nouveau ? "perso_proto_" + Date.now().toString(36) : p.id;
      const proto = { id, nom, mouvement: g("tp-mouv").trim(), indication: g("tp-ind").trim(), etapes: [{ rows, centre: g("tp-centre").split(/[,;]\s*/).map(x => x.trim()).filter(Boolean) }], notes: this.lignes(g("tp-notes")), images: [] };
      if (d.nouveau) this.perso.protocoles.push(proto); else this.perso.protocoles[this.perso.protocoles.findIndex(x => x.id === p.id)] = proto;
      try { await this.ecrire(); } catch (e) { document.getElementById("tp-statut").textContent = "Enregistrement impossible : " + e.message; return; }
      this.recomposer(); this.edition = null; this.actif = id; this.rendreListe(); this.rendreDetail();
    });
  },

  async supprimerProto(p) {
    if (!confirm("Supprimer le protocole « " + p.nom + " » ?")) return;
    this.perso.protocoles = this.perso.protocoles.filter(x => x.id !== p.id);
    try { await this.ecrire(); } catch (e) { alert("Suppression impossible : " + e.message); return; }
    this.recomposer(); this.actif = null; this.rendreListe(); this.rendreDetail();
  }
};

Tung.init();
