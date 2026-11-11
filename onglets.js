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
    window.addEventListener("resize", () => this.ajusterBarre());
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

  // la barre est fixée en haut de l'écran : on décale la page de sa hauteur, et les éléments flottants (crayon, liste latérale) se placent dessous
  ajusterBarre() {
    const h = this.barre && !this.barre.hidden ? Math.ceil(this.barre.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty("--haut-onglets", h + "px");
    document.body.style.paddingTop = h ? h + "px" : "";
  },

  // ☰ de la barre fixe : menu de l'application et choix du circuit, accessibles où que l'on soit dans la page
  basculerMenuRapide(e) {
    e.stopPropagation();
    let p = document.getElementById("menu-rapide");
    if (!p) {
      p = document.createElement("div"); p.id = "menu-rapide"; p.hidden = true; document.body.appendChild(p);
      document.addEventListener("click", ev => { if (!p.hidden && !ev.target.closest("#menu-rapide, #onglet-menu-btn")) p.hidden = true; });
      document.addEventListener("keydown", ev => { if (ev.key === "Escape") p.hidden = true; });
      p.addEventListener("click", ev => {
        const bc = ev.target.closest("[data-mr-circ]"), bt = ev.target.closest("[data-mr-tab]");
      if (ev.target.closest("[data-mr-nouveau]")) { p.hidden = true; document.querySelector('.tab-btn[data-tab="circuits"]').click(); Circuits.ouvert().then(() => Circuits.nouveau()); return; }
        if (bc) { p.hidden = true; Circuits.ouvrirCircuit(bc.dataset.mrCirc); }
        else if (bt) { p.hidden = true; const orig = document.querySelector('#menu-panneau .tab-btn[data-tab="' + bt.dataset.mrTab + '"]'); if (orig) orig.click(); }
      });
    }
    if (!p.hidden) { p.hidden = true; return; }
    this.remplirMenuRapide(p);
    p.hidden = false;
  },
  remplirMenuRapide(p) {
    const circ = typeof Circuits !== "undefined" && Circuits.liste && Circuits.liste.length ? Circuits.liste : [];
    const groupes = [...document.querySelectorAll("#menu-panneau .menu-groupe")].map(g => `<div class="mr-groupe"><div class="menu-titre">${escapeHtml(g.querySelector(".menu-titre").textContent)}</div>` +
      [...g.querySelectorAll(".tab-btn")].map(b => `<button type="button" class="mr-lien" data-mr-tab="${escapeHtml(b.dataset.tab)}">${escapeHtml((b.title || b.textContent).trim())}</button>`).join("") + `</div>`).join("");
    p.innerHTML = (circ.length ? `<div class="mr-groupe"><div class="menu-titre">Circuits</div><input type="search" id="mr-filtre" placeholder="Chercher un circuit" autocomplete="off"><button type="button" class="mr-lien" data-mr-nouveau>+ Nouveau circuit</button><div class="mr-circuits" id="mr-circuits"></div></div>` : "") + groupes;
    const liste = p.querySelector("#mr-circuits"), filtre = p.querySelector("#mr-filtre");
    const dessiner = () => {
      const t = (filtre ? filtre.value : "").toLowerCase();
      liste.innerHTML = circ.filter(x => !t || (Circuits.nomCourt(x) + " " + x.grille.join(" ")).toLowerCase().includes(t)).map(x => `<button type="button" class="mr-lien${Circuits.actif === x.id ? " actif" : ""}" data-mr-circ="${escapeHtml(x.id)}">${escapeHtml(Circuits.nomCourt(x))} <span class="muted">${x.grille.join(" · ")}</span></button>`).join("") || `<span class="muted">Aucun circuit.</span>`;
    };
    if (filtre) { dessiner(); filtre.addEventListener("input", dessiner); }
  },

  rendreBarre() {
    if (!this.barre) return;
    this.barre.hidden = !this.liste.length;
    if (!this.liste.length) { this.ajusterBarre(); return; }
    this.barre.innerHTML = `<button type="button" class="onglet-menu" id="onglet-menu-btn" title="Menu et choix du circuit" aria-label="Menu et choix du circuit">☰</button>` + `<button type="button" class="onglet-t${this.actif === null ? " actif" : ""}" data-o="" title="Retour à la vue du module">${escapeHtml(this.etiquetteModule())}</button>` +
      this.liste.map(o => `<span class="onglet-t${this.actif === o.id ? " actif" : ""}" data-o="${escapeHtml(o.id)}"><button type="button" class="onglet-nom" data-o="${escapeHtml(o.id)}" title="${escapeHtml(o.titre)}">${escapeHtml(o.genre)} ${escapeHtml(o.titre)}</button><button type="button" class="onglet-x" data-x="${escapeHtml(o.id)}" aria-label="Fermer l'onglet">✕</button></span>`).join("") + (this.enLigne() ? `<span class="onglet-sync" title="Onglets synchronisés avec tes autres appareils (via ton dépôt GitHub)">🔄</span>` : "");
    document.getElementById("onglet-menu-btn").addEventListener("click", e => this.basculerMenuRapide(e));
    this.barre.querySelectorAll("[data-o]").forEach(b => b.addEventListener("click", () => { const id = b.dataset.o; if (!id) this.voirModule(); else this.activer(id); }));
    this.barre.querySelectorAll("[data-x]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); this.fermer(b.dataset.x); }));
    this.ajusterBarre();
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

  // ---------- mémoire et synchronisation des onglets
  // Local : les onglets sont gardés dans ce navigateur (ils reviennent quand on ferme puis rouvre).
  // Entre appareils : avec la connexion GitHub, la liste est aussi écrite dans app/onglets_synchro.json de ton dépôt de données ;
  // chaque appareil la relit à l'ouverture, quand il redevient actif et toutes les minutes. Le dernier appareil qui modifie les onglets l'emporte.
  CLE_MEMOIRE: "onglets_travail_v1",
  FICHIER_SYNCHRO: "app/onglets_synchro.json",
  _maj: 0,
  _envoi: null,

  appareilId() {
    try {
      let id = localStorage.getItem("onglets_appareil_id");
      if (!id) { id = "app_" + Math.random().toString(36).slice(2, 10); localStorage.setItem("onglets_appareil_id", id); }
      return id;
    } catch (e) { return "app_sans_stockage"; }
  },
  enLigne() { return typeof Store !== "undefined" && Store.mode === "github"; },
  idDesc(d) {
    const n = k => String(k).toUpperCase().replace(/[\s.\-]/g, "");
    if (d.kind === "synd") return "synd:" + d.entry.domaine + "/" + d.entry.chemin;
    if (d.kind === "pt") return "pt:" + n(d.id);
    if (d.kind === "tung") return "tung:" + d.id;
    if (d.kind === "form") return "form:" + d.id;
    return "";
  },
  etat() {
    const tab = document.querySelector(".menu-onglets .tab-btn.active");
    return {
      maj: this._maj, appareil: this.appareilId(), onglets: this.liste.map(x => x.desc),
      actif: this.actif === null ? null : ((this.liste.find(x => x.id === this.actif) || {}).id || null),
      module: tab ? tab.dataset.tab : null, circuit: typeof Circuits !== "undefined" ? Circuits.actif : null,
    };
  },
  memoriser(sansEnvoi) {
    if (!sansEnvoi && !this._restauration) this._maj = Date.now();
    try { localStorage.setItem(this.CLE_MEMOIRE, JSON.stringify(this.etat())); } catch (e) { /* stockage indisponible (navigation privée…) */ }
    if (!sansEnvoi && this.enLigne() && !this._restauration) this.planifierEnvoi();
  },
  planifierEnvoi() {
    clearTimeout(this._envoi);
    this._envoi = setTimeout(() => { this._envoi = null; this.envoyer(); }, 3000);   // regroupe les changements rapprochés (un envoi = un enregistrement dans le dépôt)
  },
  async envoyer() {
    if (!this.enLigne()) return;
    const etat = this.etat();
    try { await Store.writeJSON(this.FICHIER_SYNCHRO, etat); }
    catch (e) {
      try { await Store._ghGet(this.FICHIER_SYNCHRO).catch(() => null); await Store.writeJSON(this.FICHIER_SYNCHRO, etat); }   // un autre appareil a écrit entre-temps : on relit et on réessaie une fois
      catch (e2) { /* hors ligne ou droits insuffisants : la mémoire locale reste valable */ }
    }
  },
  async lireDistant() {
    try { const d = await Store.readJSON(this.FICHIER_SYNCHRO); return d && Array.isArray(d.onglets) ? d : null; } catch (e) { return null; }
  },

  // met la liste d'onglets d'accord avec celle d'un autre appareil (sans changer la vue affichée, sauf si l'onglet affiché a été fermé là-bas)
  async adopterListe(d) {
    const voulus = (d.onglets || []).map(x => ({ x, id: this.idDesc(x) })).filter(v => v.id);
    const ids = new Set(voulus.map(v => v.id));
    this._restauration = true;
    for (const o of [...this.liste]) if (!ids.has(o.id)) this.fermer(o.id);
    for (const v of voulus) {
      const x = v.x;
      try {
        if (x.kind === "synd") await this.ouvrirSyndrome(x.entry, { differe: true });
        else if (x.kind === "pt") await this.ouvrirPoint(x.id, { differe: true });
        else if (x.kind === "tung") await this.ouvrirTung(x.id, { differe: true, titre: x.titre });
        else if (x.kind === "form") await this.ouvrirFormule(x.id, { differe: true });
      } catch (e) { /* fiche disparue */ }
    }
    this._restauration = false;
    this._maj = d.maj || this._maj;
    this.memoriser(true);
    this.rendreBarre();
  },
  async synchroniser() {
    if (!this.enLigne() || this._envoi || this._restauration) return;
    const d = await this.lireDistant();
    if (d && d.appareil !== this.appareilId() && (d.maj || 0) > this._maj) await this.adopterListe(d);
  },
  demarrerSynchro() {
    if (!this.enLigne()) return;
    setInterval(() => this.synchroniser(), 60000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") this.synchroniser(); });
  },

  async restaurer() {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(this.CLE_MEMOIRE) || "null"); } catch (e) { /* illisible : on repart du distant */ }
    // attend que les bases (points, formules, syndromes) soient chargées
    for (let i = 0; i < 60; i++) {
      const pret = (typeof Points !== "undefined" && (Points.entries || []).length) && (typeof Formules !== "undefined" && Formules.byId && Formules.byId.size) && (typeof Syndromes !== "undefined" && (Syndromes.entries || []).length);
      if (pret) break;
      await new Promise(r => setTimeout(r, 400));
    }
    // l'état le plus récent l'emporte : celui de ce navigateur ou celui qu'un autre appareil a enregistré dans le dépôt
    const distant = await this.lireDistant();
    const m = distant && (!local || (distant.maj || 0) > (local.maj || 0)) ? distant : local;
    this._maj = (m && m.maj) || 0;
    if (!m) { this.demarrerSynchro(); return; }
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
    const a = m.actif && this.liste.find(x => x.id === m.actif);
    if (a) this.activer(a.id); else this.voirModule(true);
    this._restauration = false;
    this.memoriser(true);
    this.demarrerSynchro();
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

/* ============ Sections repliables : le titre (h3) de chaque section d'une fiche la replie ou la déplie ============
   Vaut pour toutes les fiches (circuits, formules, syndromes, points, Tung…). L'état est mémorisé par titre de section, sur cet appareil. */
const Replier = {
  CLE: "mtc_sections_repliees",
  repliees() { try { return new Set(JSON.parse(localStorage.getItem(this.CLE) || "[]")); } catch (e) { return new Set(); } },
  enregistrer(s) { try { localStorage.setItem(this.CLE, JSON.stringify([...s])); } catch (e) { /* stockage indisponible */ } },
  // titres de sections d'une fiche (pas ceux d'un formulaire en cours de modification)
  titres() {
    return [...document.querySelectorAll("section > h3:first-child:not([data-repliable])")].filter(h => !h.closest("form, .circ-edition, [contenteditable], .reseau-fenetre, #reseau-fenetre"));
  },
  preparer() {
    const r = this.repliees();
    this.titres().forEach(h => {
      h.dataset.repliable = "1";
      h.setAttribute("role", "button"); h.tabIndex = 0;
      const s = h.parentElement, cle = h.textContent.trim();
      if (r.has(cle)) s.classList.add("replie");
      h.setAttribute("aria-expanded", String(!s.classList.contains("replie")));
      h.title = "Replier ou déplier cette section";
    });
  },
  basculer(h) {
    const s = h.parentElement, on = s.classList.toggle("replie"), r = this.repliees(), cle = h.textContent.trim();
    if (on) r.add(cle); else r.delete(cle);
    this.enregistrer(r);
    h.setAttribute("aria-expanded", String(!on));
    if (!on && s.querySelector(".circ-graphe") && typeof Circuits !== "undefined" && Circuits.tracerGraphe) setTimeout(() => Circuits.tracerGraphe(), 30);       // le graphe se retrace quand il redevient visible
  },
  init() {
    document.addEventListener("click", e => {
      const h = e.target.closest("h3[data-repliable]");
      if (h && !e.target.closest("a, button, input, select, textarea")) this.basculer(h);
    });
    document.addEventListener("keydown", e => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("h3[data-repliable]")) { e.preventDefault(); this.basculer(e.target); }
    });
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => this.preparer(), 40); }).observe(document.body, { childList: true, subtree: true });
    this.preparer();
  }
};
Replier.init();
