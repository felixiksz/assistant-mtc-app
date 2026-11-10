"use strict";

/* ============================= Onglets de travail =============================
   Comme dans un navigateur : ouvrir un syndrome, un point, une formule ou un point Tung depuis un circuit (ou ailleurs) l'ouvre dans un NOUVEL onglet,
   au même niveau que la vue d'où l'on vient, qui reste intacte (circuit, position de défilement, brouillon en cours).
   Le premier onglet est toujours la vue du module en cours ; les onglets ouverts restent quand on change de module et se ferment avec ✕.
   Ils sont mémorisés dans ce navigateur (stockage local) et reviennent à la réouverture, avec le module et le circuit où l'on était.
   Les fiches ouvertes ici se modifient sur place (« ✏️ Modifier cette fiche »), comme dans leur module.
   Dépend de app.js : Store, escapeHtml, Syndromes, Points, Formules, SubstanceNature, Sinolux, Animaux, ProchesFormules ; de tung.js : Tung ; de circuits.js : Circuits. */

const Onglets = {
  liste: [],        // { id, titre, genre, zone, charge }
  actif: null,      // null = vue du module ; sinon id d'un onglet de travail
  _y: {},           // position de défilement mémorisée par vue

  init() {
    this.barre = document.getElementById("onglets-travail");
    this.vues = document.getElementById("vues-travail");
    // un clic sur le menu des modules revient à la vue du module (les onglets restent ouverts)
    document.addEventListener("click", e => { if (e.target.closest(".menu-onglets .tab-btn")) this.voirModule(true); });
    document.addEventListener("click", e => {
      const p = e.target.closest("[data-pt-fiche]");
      if (p) { e.preventDefault(); this.ouvrirPoint(p.dataset.ptFiche); }
    });
  },

  // nom de la vue du module (premier onglet)
  etiquetteModule() {
    let t = (document.getElementById("menu-courant") || {}).textContent || "Module";
    if (typeof Circuits !== "undefined" && document.getElementById("tab-circuits").classList.contains("active") && Circuits.actif) {
      const c = Circuits.parId(Circuits.actif);
      if (c) t += " — " + Circuits.nomCourt(c);
    }
    return t;
  },

  rendreBarre() {
    if (!this.barre) return;
    this.barre.hidden = !this.liste.length;
    if (!this.liste.length) return;
    this.barre.innerHTML = `<button type="button" class="onglet-t${this.actif === null ? " actif" : ""}" data-o="" title="Retour à la vue du module">${escapeHtml(this.etiquetteModule())}</button>` +
      this.liste.map(o => `<span class="onglet-t${this.actif === o.id ? " actif" : ""}" data-o="${escapeHtml(o.id)}"><button type="button" class="onglet-nom" data-o="${escapeHtml(o.id)}" title="${escapeHtml(o.titre)}">${escapeHtml(o.genre)} ${escapeHtml(o.titre)}</button><button type="button" class="onglet-x" data-x="${escapeHtml(o.id)}" aria-label="Fermer l'onglet">✕</button></span>`).join("");
    this.barre.querySelectorAll("[data-o]").forEach(b => b.addEventListener("click", () => { const id = b.dataset.o; if (!id) this.voirModule(); else this.activer(id); }));
    this.barre.querySelectorAll("[data-x]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); this.fermer(b.dataset.x); }));
  },

  memoriserDefilement() { this._y[this.actif === null ? "module" : this.actif] = window.scrollY; },

  voirModule(sansBarre) {
    if (this.actif !== null) this.memoriserDefilement();
    this.actif = null;
    document.body.classList.remove("vue-doc");
    if (this.vues) { this.vues.hidden = true; this.vues.querySelectorAll(".vue-travail").forEach(z => { z.hidden = true; }); }
    this.rendreBarre();
    if (!sansBarre) window.scrollTo(0, this._y.module || 0);
    if (!this._restauration) this.memoriser();
  },

  activer(id) {
    const o = this.liste.find(x => x.id === id);
    if (!o) return;
    this.memoriserDefilement();
    this.actif = id;
    document.body.classList.add("vue-doc");
    this.vues.hidden = false;
    this.vues.querySelectorAll(".vue-travail").forEach(z => { z.hidden = z !== o.zone; });
    this.rendreBarre();
    window.scrollTo(0, this._y[id] || 0);
    o.charger();
    this.memoriser();
  },

  fermer(id) {
    const i = this.liste.findIndex(x => x.id === id);
    if (i < 0) return;
    this.liste[i].zone.remove();
    this.liste.splice(i, 1);
    delete this._y[id];
    if (this.actif === id) {
      const voisin = this.liste[i] || this.liste[i - 1];
      if (voisin) this.activer(voisin.id); else this.voirModule();
    } else this.rendreBarre();
    this.memoriser();
  },

  // ouvre (ou réactive) un onglet ; charge(zone) remplit la zone, en lecture seule
  async ouvrir(id, titre, genre, charge, desc, differe) {
    const deja = this.liste.find(x => x.id === id);
    if (deja) { if (!differe) this.activer(id); return; }
    const zone = document.createElement("article");
    zone.className = "vue-travail formule-detail";
    zone.hidden = true;
    zone.innerHTML = `<p class="muted">Chargement…</p>`;
    this.vues.appendChild(zone);
    const o = { id, titre, genre, zone, charge, desc: { ...desc, titre }, pret: false };
    o.recharger = async () => { zone.innerHTML = `<p class="muted">Chargement…</p>`; await charge(zone, o.recharger); };
    o.charger = async () => {
      if (o.pret) return;
      o.pret = true;
      try { await charge(zone, o.recharger); } catch (e) { zone.innerHTML = `<p class="muted">Impossible d'afficher cette fiche (${escapeHtml(e.message)}).</p>`; }
    };
    this.liste.push(o);
    if (differe) { this.rendreBarre(); this.memoriser(); return; }
    this.activer(id);
    await o.charger();
  },

  // ---------- mémoire des onglets : ils reviennent quand on ferme puis rouvre le navigateur (stockage local de ce navigateur)
  CLE_MEMOIRE: "onglets_travail_v1",
  memoriser() {
    try {
      const tab = document.querySelector(".menu-onglets .tab-btn.active");
      localStorage.setItem(this.CLE_MEMOIRE, JSON.stringify({
        onglets: this.liste.map(x => x.desc), actif: this.actif === null ? null : (this.liste.find(x => x.id === this.actif) || {}).id || null,
        module: tab ? tab.dataset.tab : null, circuit: typeof Circuits !== "undefined" ? Circuits.actif : null,
      }));
    } catch (e) { /* stockage indisponible (navigation privée…) : les onglets ne seront simplement pas retrouvés */ }
  },
  async restaurer() {
    let m = null;
    try { m = JSON.parse(localStorage.getItem(this.CLE_MEMOIRE) || "null"); } catch (e) { return; }
    if (!m) return;
    // attend que les bases (points, formules, syndromes) soient chargées
    for (let i = 0; i < 60; i++) {
      const pret = (typeof Points !== "undefined" && (Points.entries || []).length) && (typeof Formules !== "undefined" && Formules.byId && Formules.byId.size) && (typeof Syndromes !== "undefined" && (Syndromes.entries || []).length);
      if (pret) break;
      await new Promise(r => setTimeout(r, 400));
    }
    this._restauration = true;
    for (const d of (m.onglets || [])) {
      try {
        if (d.kind === "synd") await this.ouvrirSyndrome(d.entry, { differe: true });
        else if (d.kind === "pt") await this.ouvrirPoint(d.id, { differe: true });
        else if (d.kind === "tung") await this.ouvrirTung(d.id, { differe: true, titre: d.titre });
        else if (d.kind === "form") await this.ouvrirFormule(d.id, { differe: true });
      } catch (e) { /* fiche disparue : on l'ignore */ }
    }
    // retrouve le module et le circuit où l'on était
    try {
      if (m.module && m.module !== "formules") {
        const b = document.querySelector('.menu-onglets .tab-btn[data-tab="' + m.module + '"]');
        if (b) b.click();
        if (m.module === "circuits" && m.circuit && typeof Circuits !== "undefined") {
          await Circuits.ensureLoaded(); await Circuits.ouvert();
          if (Circuits.parId(m.circuit)) Circuits.afficher(m.circuit);
        }
      }
    } catch (e) { /* module indisponible */ }
    this._restauration = false;
    const a = m.actif && this.liste.find(x => x.id === m.actif);
    if (a) this.activer(a.id); else { this.voirModule(true); this.memoriser(); }
  },

  // ---------- les différents types de fiches
  ouvrirSyndrome(entry, opt = {}) {
    return this.ouvrir("synd:" + entry.domaine + "/" + entry.chemin, entry.nom, "🩺", async (zone, recharger) => {
      const d = await Store.readJSON(`syndromes/${entry.domaine}/${entry.chemin}`);
      zone.innerHTML = Syndromes.renderSyndrome(d, entry.domaine);
      addEditControls(zone, "syndromes/" + entry.domaine + "/" + entry.chemin, d, { onSaved: async parsed => { await Syndromes.apresSauvegarde(entry, parsed); await recharger(); } });
    }, { kind: "synd", entry: { id: entry.id, domaine: entry.domaine, chemin: entry.chemin, nom: entry.nom, sousLabel: entry.sousLabel } }, opt.differe);
  },

  ouvrirPoint(texte, opt = {}) {
    const cle = String(texte || "").toUpperCase().replace(/[\s.\-]/g, "");
    const norm = k => String(k).toUpperCase().replace(/[\s.\-]/g, "");
    const alias = { SI: "IG", LI: "GI", SP: "RT", UB: "V", BL: "V", KI: "RN", LU: "P", HT: "C", ST: "E", GB: "VB", LR: "F", LV: "F", CV: "RM", GV: "DM", PC: "EC", SJ: "TF" };
    const m = cle.match(/^([A-Z]+)(\d+)$/);
    const cherche = m ? (alias[m[1]] || m[1]) + m[2] : cle;
    const entry = (Points.entries || []).find(e => norm(e.id) === cherche);
    if (!entry) { if (!opt.differe) alert("Point " + texte + " : pas de fiche dans ta base de points."); return; }
    return this.ouvrir("pt:" + norm(entry.id), entry.id + (entry.data.pinyin ? " " + entry.data.pinyin : ""), "📍", async (zone, recharger) => {
      zone.innerHTML = Points.htmlDetail(entry);
      Store.hydrateImages(zone);
      addEditControls(zone, "reference/points_canaux/" + entry.canal + ".json", entry.data, { arrayItem: true, matchField: "point", matchValue: entry.id, editorFn: openPointEditor, onSaved: async () => { await recharger(); } });
    }, { kind: "pt", id: entry.id }, opt.differe);
  },

  ouvrirTung(id, opt = {}) {
    return this.ouvrir("tung:" + id, opt.titre || (Tung.parId(id) || {}).nom || id, "☯", async zone => {
      await Tung.ensureLoaded();
      Tung.rendreFicheDans(zone, id, false);       // avec les boutons de modification : ils écrivent dans cet onglet
      Store.hydrateImages(zone);
    }, { kind: "tung", id }, opt.differe);
  },

  ouvrirFormule(id, opt = {}) {
    const f = Formules.byId.get(id), v = Formules.varParId.get(id);
    if (!f && !v) return;
    const nom = f ? (f.pinyin || f.nom || id) : v.nom;
    return this.ouvrir("form:" + id, nom, "🌿", async (zone, recharger) => {
      await SubstanceNature.ensureLoaded(); await Sinolux.ensureLoaded(); await Animaux.ensureLoaded();
      if (f) {
        const d = await Store.readJSON("formules/" + f.chemin);
        zone.innerHTML = Formules.renderFormule(d);
        Store.hydrateImages(zone);
        ProchesFormules.remplir(zone, d);
        ModifArbre.remplir(zone, d);
        addEditControls(zone, "formules/" + f.chemin, d, { onSaved: async parsed => { await Formules.apresSauvegarde(f, parsed); await recharger(); } });
      } else {
        const parent = Formules.byId.get(v.parent), fp = await Store.readJSON("formules/" + parent.chemin);
        zone.innerHTML = Formules.renderVariation(v, parent, fp);
        zone.querySelectorAll("[data-parent]").forEach(b => b.addEventListener("click", () => this.ouvrirFormule(parent.id)));
      }
    }, { kind: "form", id }, opt.differe);
  }
};

Onglets.init();
Onglets.restaurer();
