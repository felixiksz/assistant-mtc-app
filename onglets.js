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
    const vis = [this.barre, document.getElementById("fenetre-bar")].find(e => e && !e.hidden);
    const h = vis ? Math.ceil(vis.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty("--haut-onglets", h + "px");         // la barre est collée en haut de l'écran seulement quand on défile ; au repos elle est sous l'en-tête
  },

  // ☰ de la barre fixe : menu de l'application et choix du circuit, accessibles où que l'on soit dans la page
  basculerMenuRapide(e, seulCircuits) {
    e.stopPropagation();
    let p = document.getElementById("menu-rapide");
    if (!p) {
      p = document.createElement("div"); p.id = "menu-rapide"; p.hidden = true; document.body.appendChild(p);
      document.addEventListener("click", ev => { if (!p.hidden && !ev.target.closest("#menu-rapide, #onglet-menu-btn, .fen-liste-btn")) p.hidden = true; });
      document.addEventListener("keydown", ev => { if (ev.key === "Escape") p.hidden = true; });
      p.addEventListener("click", ev => {
        const bc = ev.target.closest("[data-mr-circ]"), bt = ev.target.closest("[data-mr-tab]");
      if (ev.target.closest("[data-mr-nouveau]")) { p.hidden = true; document.querySelector('.tab-btn[data-tab="circuits"]').click(); Circuits.ouvert().then(() => Circuits.nouveau()); return; }
        if (bc) { p.hidden = true; Circuits.ouvrirCircuit(bc.dataset.mrCirc); }
        else if (bt) { p.hidden = true; const orig = document.querySelector('#menu-panneau .tab-btn[data-tab="' + bt.dataset.mrTab + '"]'); if (orig) orig.click(); }
      });
    }
    if (!p.hidden) { p.hidden = true; return; }
    this.remplirMenuRapide(p, seulCircuits);
    const r = e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : null;
    p.style.left = seulCircuits && r ? Math.max(6, Math.min(r.left, innerWidth - p.offsetWidth - 6)) + "px" : "";
    p.style.top = r ? Math.round(r.bottom) + "px" : "";
    p.style.maxHeight = r ? "calc(100vh - " + Math.round(r.bottom) + "px - 1rem)" : "";
    p.hidden = false;
  },
  remplirMenuRapide(p, seulCircuits) {
    const circ = typeof Circuits !== "undefined" && Circuits.liste && Circuits.liste.length ? Circuits.liste : [];
    const groupes = seulCircuits ? [] : [...document.querySelectorAll("#menu-panneau .menu-groupe")].map(g => `<div class="mr-groupe"><div class="menu-titre">${escapeHtml(g.querySelector(".menu-titre").textContent)}</div>` +
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
    const sec = Fenetre.courante();
    Fenetre.rendreSections(sec);
    if (sec) { this.barre.hidden = true; Fenetre.rendre(sec); this.ajusterBarre(); return; }
    Fenetre.cacher();
    this.barre.hidden = false;                                  // toujours visible : le ☰ (menu, choix du circuit) doit rester accessible même sans onglet ouvert
    this.barre.innerHTML = `<button type="button" class="onglet-menu" id="onglet-menu-btn" title="Menu et choix du circuit" aria-label="Menu et choix du circuit">☰</button>` + `<button type="button" class="onglet-t${this.actif === null ? " actif" : ""}" data-o="" title="Retour à la vue du module">${escapeHtml(this.etiquetteModule())}</button>` +
      this.liste.filter(o => !Fenetre.deItem(o)).map(o => `<span class="onglet-t${this.actif === o.id ? " actif" : ""}" data-o="${escapeHtml(o.id)}"><button type="button" class="onglet-nom" data-o="${escapeHtml(o.id)}" title="${escapeHtml(o.titre)}">${escapeHtml(o.genre)} ${escapeHtml(o.titre)}</button><button type="button" class="onglet-x" data-x="${escapeHtml(o.id)}" aria-label="Fermer l'onglet">✕</button></span>`).join("") + (this.enLigne() ? `<span class="onglet-sync" title="Onglets synchronisés avec tes autres appareils (via ton dépôt GitHub)">🔄</span>` : "");
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
    const tc = document.getElementById("tab-circuits"); if (tc) tc.classList.remove("circ-onglet");
    if (this.vues) { this.vues.hidden = true; this.vues.querySelectorAll(".vue-travail").forEach(z => { z.hidden = true; }); }
    this.rendreBarre();
    if (!sansBarre) window.scrollTo(0, this._y.module || 0);
    if (!this._restauration) this.memoriser();
  },

  activer(id) {
    const o = this.liste.find(x => x.id === id);
    if (!o) return;
    if (o.desc && o.desc.kind === "circ") return this.activerCircuit(o);
    this.memoriserDefilement();
    this.actif = id;
    const tc0 = document.getElementById("tab-circuits"); if (tc0) tc0.classList.remove("circ-onglet");
    document.body.classList.add("vue-doc");
    this.vues.hidden = false;
    this.vues.querySelectorAll(".vue-travail").forEach(z => { z.hidden = z !== o.zone; });
    this.rendreBarre();
    window.scrollTo(0, this._y[id] || 0);
    o.charger();
    this.memoriser();
  },

  // ---------- onglets : réordonner, épingler, fermer les autres
  deplacer(id, avantId) {
    const i = this.liste.findIndex(x => x.id === id);
    if (i < 0 || id === avantId || !this.liste.some(x => x.id === avantId)) return;
    const [o] = this.liste.splice(i, 1);
    this.liste.splice(this.liste.findIndex(x => x.id === avantId), 0, o);
    this.memoriser(); this.rendreBarre();
  },
  epingler(id) { const o = this.liste.find(x => x.id === id); if (!o) return; o.desc.epingle = !o.desc.epingle; this.memoriser(); this.rendreBarre(); },
  fermerAutres(id, droiteSeulement) {
    const cible = this.liste.find(x => x.id === id); if (!cible) return;
    const f = Fenetre.deItem(cible), ic = this.liste.indexOf(cible);
    this.liste.filter((x, i) => x !== cible && Fenetre.deItem(x) === f && !x.desc.epingle && (!droiteSeulement || i > ic)).forEach(x => this.fermer(x.id));
    this.activer(id);
  },
  menuOnglet(ev, id) {
    ev.preventDefault();
    const o = this.liste.find(x => x.id === id); if (!o) return;
    let m = document.getElementById("onglet-ctx");
    if (!m) {
      m = document.createElement("div"); m.id = "onglet-ctx"; m.hidden = true; document.body.appendChild(m);
      document.addEventListener("click", () => { m.hidden = true; });
      document.addEventListener("keydown", e => { if (e.key === "Escape") m.hidden = true; });
    }
    m.innerHTML = [["epingler", o.desc.epingle ? "Détacher l'onglet" : "Épingler l'onglet"], ["fermer", "Fermer"], ["autres", "Fermer les autres"], ["droite", "Fermer à droite"]].map(([k, l]) => `<button type="button" data-a="${k}"${k === "fermer" && o.desc.epingle ? " disabled" : ""}>${l}</button>`).join("");
    m.style.left = Math.max(4, Math.min(ev.clientX, innerWidth - 200)) + "px"; m.style.top = Math.max(4, Math.min(ev.clientY, innerHeight - 170)) + "px";
    m.hidden = false;
    m.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      const a = b.dataset.a;
      if (a === "epingler") this.epingler(id); else if (a === "fermer") this.fermer(id); else if (a === "autres") this.fermerAutres(id, false); else if (a === "droite") this.fermerAutres(id, true);
    }));
  },

  // un onglet de circuit : le module Circuits, avec la fiche de ce circuit
  async activerCircuit(o) {
    this.memoriserDefilement();
    document.body.classList.remove("vue-doc");
    if (this.vues) { this.vues.hidden = true; this.vues.querySelectorAll(".vue-travail").forEach(z => { z.hidden = true; }); }
    const b = document.querySelector('#menu-panneau .tab-btn[data-tab="circuits"]');
    if (b) b.click();                                                     // affiche le module (remet la vue du module)
    await Circuits.ensureLoaded(); await Circuits.ouvert();
    this.actif = o.id;
    const tc = document.getElementById("tab-circuits"); if (tc) tc.classList.add("circ-onglet");
    Circuits.afficher(o.desc.id);
    this.rendreBarre();
    window.scrollTo(0, this._y[o.id] || 0);
    this.memoriser();
  },
  // une prescription : un onglet à part (on peut en ouvrir plusieurs) ; son contenu reste dans ce navigateur
  ouvrirPrescription(id, opt = {}) {
    id = id || ("p" + Date.now().toString(36));
    const cle = "presc:" + id, etat = { ...Prescription.defaut(), ...(opt.etat || {}), ajouts: [...((opt.etat || {}).ajouts || [])] };
    const titre = () => { const f = etat.formule && Formules.byId.get(etat.formule); return "Prescription" + (f ? " — " + (f.pinyin || etat.formule) : ""); };
    return this.ouvrir(cle, titre(), "℞", async zone => {
      const o = this.liste.find(x => x.id === cle);
      await Prescription.rendre(zone, etat, () => { if (o) { o.titre = titre(); o.desc.titre = o.titre; o.desc.etat = etat; } this.rendreBarre(); this.memoriser(); });
    }, { kind: "presc", id, etat, fenetre: opt.fenetre }, opt.differe);
  },
  // comparaison de deux circuits : un onglet à part, plusieurs possibles
  ouvrirComparaisonCircuits(id, opt = {}) {
    id = id || ("c" + Date.now().toString(36));
    const cle = "cmpc:" + id, etat = { ...ComparaisonCircuits.defaut(), ...(opt.etat || {}) };
    const nom = k => { const c = k && typeof Circuits !== "undefined" ? Circuits.parId(k) : null; return c ? Circuits.nomCourt(c) : ""; };
    const titre = () => "Comparaison" + (etat.a || etat.b ? " — " + [nom(etat.a), nom(etat.b)].filter(Boolean).join(" / ") : "");
    return this.ouvrir(cle, titre(), "⇄", async zone => {
      const o = this.liste.find(x => x.id === cle);
      await ComparaisonCircuits.rendre(zone, etat, () => { if (o) { o.titre = titre(); o.desc.titre = o.titre; o.desc.etat = etat; } this.rendreBarre(); this.memoriser(); });
    }, { kind: "cmpc", id, etat, fenetre: opt.fenetre }, opt.differe);
  },
  async ouvrirCircuit(id, opt = {}) {
    await Circuits.ensureLoaded();
    const c = Circuits.parId(id);
    if (!c) return;
    const cle = "circ:" + id, titre = Circuits.nomCourt(c);
    let o = this.liste.find(x => x.id === cle);
    if (!o) {
      o = { id: cle, titre, genre: "◎", zone: document.createElement("article"), charge: async () => {}, pret: true,
            desc: { kind: "circ", id, titre, fenetre: opt.fenetre || (this._restauration ? null : Fenetre.courante()) || "acupuncture" } };
      o.recharger = async () => {}; o.charger = async () => {};
      this.liste.push(o);
    }
    if (opt.differe) { this.rendreBarre(); this.memoriser(); return; }
    return this.activer(cle);
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
    const o = { id, titre, genre, zone, charge, desc: { ...desc, titre, fenetre: (desc && desc.fenetre) || (this._restauration ? null : Fenetre.courante()) || null }, pret: false };
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
    if (d.kind === "circ") return "circ:" + d.id;
    if (d.kind === "presc") return "presc:" + d.id;
    if (d.kind === "cmpc") return "cmpc:" + d.id;
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
    etat.onglets = (etat.onglets || []).filter(d => d.kind !== "presc" && d.kind !== "cmpc");            // poids, budget, formule d'une patiente : jamais synchronisés
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
    for (const o of [...this.liste]) if (!ids.has(o.id) && !(o.desc && (o.desc.kind === "presc" || o.desc.kind === "cmpc"))) this.fermer(o.id);
    for (const v of voulus) {
      const x = v.x;
      try {
        if (x.kind === "synd") await this.ouvrirSyndrome(x.entry, { differe: true, fenetre: x.fenetre });
        else if (x.kind === "pt") await this.ouvrirPoint(x.id, { differe: true, fenetre: x.fenetre });
        else if (x.kind === "tung") await this.ouvrirTung(x.id, { differe: true, titre: x.titre, fenetre: x.fenetre });
        else if (x.kind === "form") await this.ouvrirFormule(x.id, { differe: true, fenetre: x.fenetre });
        else if (x.kind === "circ") await this.ouvrirCircuit(x.id, { differe: true, fenetre: x.fenetre });
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
    // la bonne structure s'affiche tout de suite (fenêtre et module où l'on était), sans attendre le chargement des bases : les fiches ouvertes s'ajoutent ensuite
    try {
      if (local && local.module && local.module !== "formules") { const b0 = document.querySelector('.menu-onglets .tab-btn[data-tab="' + local.module + '"]'); if (b0) b0.click(); }
    } catch (e) { /* module indisponible */ }
    this.rendreBarre();
    // attend que les bases (points, formules, syndromes) soient chargées
    for (let i = 0; i < 60; i++) {
      const pret = (typeof Points !== "undefined" && (Points.entries || []).length) && (typeof Formules !== "undefined" && Formules.byId && Formules.byId.size) && (typeof Syndromes !== "undefined" && (Syndromes.entries || []).length);
      if (pret) break;
      await new Promise(r => setTimeout(r, 400));
    }
    // l'état le plus récent l'emporte : celui de ce navigateur ou celui qu'un autre appareil a enregistré dans le dépôt
    const distant = await this.lireDistant();
    let m = distant && (!local || (distant.maj || 0) > (local.maj || 0)) ? distant : local;
    this._maj = (m && m.maj) || 0;
    if (!m) { this.demarrerSynchro(); return; }
    if (local && m !== local) m = { ...m, onglets: [...(m.onglets || []), ...(local.onglets || []).filter(d => d.kind === "presc" || d.kind === "cmpc")] };
    this._restauration = true;
    for (const d of (m.onglets || [])) {
      try {
        if (d.kind === "synd") await this.ouvrirSyndrome(d.entry, { differe: true, fenetre: d.fenetre });
        else if (d.kind === "pt") await this.ouvrirPoint(d.id, { differe: true, fenetre: d.fenetre });
        else if (d.kind === "tung") await this.ouvrirTung(d.id, { differe: true, titre: d.titre, fenetre: d.fenetre });
        else if (d.kind === "form") await this.ouvrirFormule(d.id, { differe: true, fenetre: d.fenetre });
        else if (d.kind === "circ") await this.ouvrirCircuit(d.id, { differe: true, fenetre: d.fenetre });
        else if (d.kind === "presc") await this.ouvrirPrescription(d.id, { differe: true, etat: d.etat, fenetre: d.fenetre });
        else if (d.kind === "cmpc") await this.ouvrirComparaisonCircuits(d.id, { differe: true, etat: d.etat, fenetre: d.fenetre });
      } catch (e) { /* fiche disparue : on l'ignore */ }
    }
    // retrouve le module et le circuit où l'on était
    try {
      if (m.module && m.module !== "formules") {
        const b = document.querySelector('.menu-onglets .tab-btn[data-tab="' + m.module + '"]');
        if (b) b.click();
        if (m.module === "circuits" && typeof Circuits !== "undefined") { await Circuits.ensureLoaded(); await Circuits.ouvert(); }
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
    }, { kind: "synd", fenetre: opt.fenetre, entry: { id: entry.id, domaine: entry.domaine, chemin: entry.chemin, nom: entry.nom, sousLabel: entry.sousLabel } }, opt.differe);
  },

  ouvrirPoint(texte, opt = {}) {
    const cle = String(texte || "").toUpperCase().replace(/[\s.\-]/g, "");
    const norm = k => String(k).toUpperCase().replace(/[\s.\-]/g, "");
    const alias = { SI: "IG", LI: "GI", SP: "RT", UB: "V", BL: "V", KI: "RN", LU: "P", HT: "C", ST: "E", GB: "VB", LR: "F", LV: "F", CV: "RM", GV: "DM", PC: "EC", SJ: "TF" };
    const m = cle.match(/^([A-Z]+)(\d+)$/);
    const cherche = m ? (alias[m[1]] || m[1]) + m[2] : cle;
    const entry = (Points.entries || []).find(e => norm(e.id) === cherche);
    if (!entry) {
      // pas un point de canal : peut-être un point Tung écrit par son nom
      if (typeof Tung !== "undefined") return Tung.ensureLoaded().then(() => { const f = Tung.parNom(texte); if (f) return this.ouvrirTung(f.id, opt); if (!opt.differe) alert("Point " + texte + " : pas de fiche dans ta base de points."); }).catch(() => { if (!opt.differe) alert("Point " + texte + " : pas de fiche dans ta base de points."); });
      if (!opt.differe) alert("Point " + texte + " : pas de fiche dans ta base de points.");
      return;
    }
    return this.ouvrir("pt:" + norm(entry.id), entry.id + (entry.data.pinyin ? " " + entry.data.pinyin : ""), "📍", async (zone, recharger) => {
      zone.innerHTML = Points.htmlDetail(entry);
      Store.hydrateImages(zone);
      addEditControls(zone, "reference/points_canaux/" + entry.canal + ".json", entry.data, { arrayItem: true, matchField: "point", matchValue: entry.id, editorFn: openPointEditor, onSaved: async () => { await recharger(); } });
    }, { kind: "pt", fenetre: opt.fenetre, id: entry.id }, opt.differe);
  },

  ouvrirTung(id, opt = {}) {
    return this.ouvrir("tung:" + id, opt.titre || (Tung.parId(id) || {}).nom || id, "☯", async zone => {
      await Tung.ensureLoaded();
      Tung.rendreFicheDans(zone, id, false);       // avec les boutons de modification : ils écrivent dans cet onglet
      Store.hydrateImages(zone);
    }, { kind: "tung", fenetre: opt.fenetre, id }, opt.differe);
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
    }, { kind: "form", fenetre: opt.fenetre, id }, opt.differe);
  }
};

/* ============================= Fenêtres : une par section du menu =============================
   Une fenêtre regroupe les modules d'une section (en onglets) et les fiches ouvertes depuis ces modules (aussi en onglets).
   Pour l'instant : la section Acupuncture (Points, Circuits, Points Tung). Les autres sections gardent la barre d'avant. */
const Fenetre = {
  SECTIONS: {
    formules: { nom: "Formules", mods: [["formules", "Formules"], ["comparer", "Comparer"], ["proposer", "Prescrire"]] },
    diagnostic: { nom: "Diagnostic", mods: [["syndromes", "Syndromes"], ["diag-signes", "Diagnostic par signes"], ["cas-pratique", "Cas cliniques"], ["tableaux-psy", "Tableaux Psy"]] },
    acupuncture: { nom: "Acupuncture", mods: [["points", "Points"], ["circuits", "Circuits"], ["tung", "Points Tung"], ["proposer-circuits", "Proposer un circuit"]] },
    theorie: { nom: "Théorie", mods: [["psy", "Principes Taoïstes"]] }
  },
  moduleCourant() {
    const p = document.querySelector(".tab-panel.active"), m = p ? p.id.replace(/^tab-/, "") : null;
    return m === "proposer" && typeof Proposer !== "undefined" && Proposer.vue === "circuits" ? "proposer-circuits" : m;      // la proposition de circuits est un onglet d'Acupuncture
  },
  // ouvre un module : « proposer-circuits » est le module Prescrire réglé sur la proposition de circuits
  allerModule(m) {
    const reel = m === "proposer-circuits" ? "proposer" : m;
    const b = document.querySelector('#menu-panneau .tab-btn[data-tab="' + reel + '"]');
    if (!b) return;
    if (reel === "proposer") { const v = m === "proposer-circuits" ? "circuits" : "formules"; if (typeof Proposer !== "undefined" && Proposer.vue !== v) { const t = document.querySelector('#tab-proposer .prop-vues [data-vue="' + v + '"]'); if (t) t.click(); } }
    b.click();
    Onglets.rendreBarre();
  },
  deModule(m) { return Object.keys(this.SECTIONS).find(k => this.SECTIONS[k].mods.some(x => x[0] === m)) || null; },
  // fenêtre d'une fiche ouverte (celle d'où elle a été ouverte ; à défaut : les points et les points Tung sont de l'Acupuncture)
  deItem(o) {
    const d = o.desc || {};
    return d.fenetre || (d.kind === "pt" || d.kind === "tung" ? "acupuncture" : d.kind === "synd" ? "diagnostic" : d.kind === "form" ? "formules" : null);
  },
  // fenêtre affichée en ce moment (null = une section pas encore migrée)
  courante() {
    if (Onglets.actif === null) return this.deModule(this.moduleCourant());
    const o = Onglets.liste.find(x => x.id === Onglets.actif);
    return o ? this.deItem(o) : null;
  },
  barre() {
    let b = document.getElementById("fenetre-bar");
    if (!b) {
      b = document.createElement("div"); b.id = "fenetre-bar"; b.className = "onglets-travail fenetre-bar"; b.setAttribute("role", "tablist"); b.hidden = true;
      Onglets.barre.insertAdjacentElement("afterend", b);
    }
    return b;
  },
  cacher() { const b = document.getElementById("fenetre-bar"); if (b) b.hidden = true; },
  boutonOnglet(zone, ouvrir) {
    if (!zone || zone.querySelector(".ouvrir-onglet")) return;
    let c = zone.querySelector(".edit-flottante, .barre-flottante");
    if (!c) { c = document.createElement("div"); c.className = "barre-flottante"; zone.prepend(c); }
    const b = document.createElement("button");
    b.type = "button"; b.className = "edit-toggle-btn ouvrir-onglet"; b.textContent = "⧉";
    b.title = "Ouvrir cette fiche dans un nouvel onglet"; b.setAttribute("aria-label", "Ouvrir cette fiche dans un nouvel onglet");
    b.addEventListener("click", ouvrir);
    c.prepend(b);
  },
  // les quatre sections, en onglets sous l'en-tête
  rendreSections(sec) {
    const n = document.getElementById("sections-bar");
    if (!n) return;
    n.innerHTML = Object.entries(this.SECTIONS).map(([k, S]) => `<button type="button" class="sec-btn${k === sec ? " actif" : ""}" data-sec="${k}">${escapeHtml(S.nom)}</button>`).join("");
    n.querySelectorAll("[data-sec]").forEach(b => b.addEventListener("click", () => this.aller(b.dataset.sec)));
  },
  // ouvre une section : le dernier module qu'on y avait, sinon le premier
  aller(sec) {
    const S = this.SECTIONS[sec];
    let m = null; try { m = localStorage.getItem("fenetre_dernier_" + sec); } catch (e) { /* stockage indisponible */ }
    if (!m || !S.mods.some(x => x[0] === m)) m = S.mods[0][0];
    this.allerModule(m);
  },
  // fiches qu'on peut ouvrir depuis le « + » de la section
  sourcesPlus(sec) {
    if (sec === "formules") return typeof Formules !== "undefined" && (Formules.index || []).length ? "formules" : null;
    if (sec === "diagnostic") return typeof Syndromes !== "undefined" && (Syndromes.entries || []).length ? "syndromes" : null;
    if (sec === "acupuncture") return typeof Points !== "undefined" && (Points.entries || []).length ? "points" : null;
    return null;
  },
  menuPlus(e, sec) {
    e.stopPropagation();
    let p = document.getElementById("fen-plus-pop");
    if (!p) {
      p = document.createElement("div"); p.id = "fen-plus-pop"; p.hidden = true; document.body.appendChild(p);
      document.addEventListener("click", ev => { if (!p.hidden && !ev.target.closest("#fen-plus-pop, .fen-plus")) p.hidden = true; });
      document.addEventListener("keydown", ev => { if (ev.key === "Escape") p.hidden = true; });
    }
    if (!p.hidden) { p.hidden = true; return; }
    const src = this.sourcesPlus(sec);
    const norm = t => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const tous = src === "formules" ? [{ lib: "℞ Nouvelle prescription (formule, ajouts, budget)", ouvrir: () => Onglets.ouvrirPrescription() }, ...Formules.index.map(f => ({ lib: (f.pinyin || f.id) + (f.nom_fr ? " — " + f.nom_fr : ""), ouvrir: () => Onglets.ouvrirFormule(f.id) }))]
      : src === "syndromes" ? Syndromes.entries.map(x => ({ lib: x.nom + (x.sousLabel ? " — " + x.sousLabel : ""), ouvrir: () => Onglets.ouvrirSyndrome(x) }))
      : [{ lib: "⇄ Comparer deux circuits", ouvrir: () => Onglets.ouvrirComparaisonCircuits() }].concat(typeof Circuits !== "undefined" && Circuits.liste ? Circuits.liste.map(c => ({ lib: "◎ " + Circuits.nomCourt(c) + " " + c.grille.join(" · "), ouvrir: () => Onglets.ouvrirCircuit(c.id) })) : []).concat(Points.entries.map(x => ({ lib: x.id + (x.data && x.data.pinyin ? " " + x.data.pinyin : ""), ouvrir: () => Onglets.ouvrirPoint(x.id) })));
    p.innerHTML = `<input type="search" id="fen-plus-q" placeholder="Chercher une fiche à ouvrir dans un onglet" autocomplete="off"><div id="fen-plus-res"></div>`;
    const res = p.querySelector("#fen-plus-res"), q = p.querySelector("#fen-plus-q");
    const dessiner = () => {
      const t = norm(q.value), l = tous.filter(x => !t || norm(x.lib).includes(t)).slice(0, 40);
      res.innerHTML = l.map((x, i) => `<button type="button" class="mr-lien" data-i="${i}">${escapeHtml(x.lib)}</button>`).join("") || `<span class="muted">Aucune fiche.</span>`;
      res.querySelectorAll("[data-i]").forEach(b => b.addEventListener("click", () => { p.hidden = true; l[+b.dataset.i].ouvrir(); }));
    };
    q.addEventListener("input", dessiner); dessiner();
    const r = e.currentTarget.getBoundingClientRect();
    p.style.left = Math.max(6, Math.min(r.left, innerWidth - 24 * 16 - 6)) + "px";
    p.style.top = Math.round(r.bottom) + "px";
    p.hidden = false;
    q.focus();
  },
  rendre(sec) {
    const b = this.barre(), S = this.SECTIONS[sec], mod = this.moduleCourant(), surModule = Onglets.actif === null;
    if (surModule && mod) { try { localStorage.setItem("fenetre_dernier_" + sec, mod); } catch (e) { /* stockage indisponible */ } }
    const libelle = (id, nom) => {
      return nom;
    };
    b.hidden = false;
    b.innerHTML = S.mods.map(([id, nom]) => `<button type="button" class="onglet-t onglet-mod${surModule && mod === id ? " actif" : ""}" data-fm="${id}">${escapeHtml(libelle(id, nom))}</button>`).join("") +
      (Onglets.liste.some(o => this.deItem(o) === sec) ? `<span class="onglet-sep"></span>` : "") +
      Onglets.liste.filter(o => this.deItem(o) === sec).map((o, i) => ({ o, i })).sort((a, b) => (b.o.desc.epingle ? 1 : 0) - (a.o.desc.epingle ? 1 : 0) || a.i - b.i).map(({ o }) => `<span class="onglet-t${Onglets.actif === o.id ? " actif" : ""}${o.desc.epingle ? " epingle" : ""}" data-o="${escapeHtml(o.id)}" draggable="true"><button type="button" class="onglet-nom" data-o="${escapeHtml(o.id)}" title="${escapeHtml(o.titre)} — clic droit (ou appui long) : épingler, fermer…">${o.desc.epingle ? "📌 " : ""}${escapeHtml(o.genre)} ${escapeHtml(o.titre)}</button>${o.desc.epingle ? "" : `<button type="button" class="onglet-x" data-x="${escapeHtml(o.id)}" aria-label="Fermer l'onglet">✕</button>`}</span>`).join("") +
      (this.sourcesPlus(sec) ? `<button type="button" class="onglet-menu fen-plus" title="Ouvrir une fiche dans un nouvel onglet" aria-label="Ouvrir une fiche dans un nouvel onglet">+</button>` : "") +
      (Onglets.enLigne() ? `<span class="onglet-sync" title="Onglets synchronisés avec tes autres appareils (via ton dépôt GitHub)">🔄</span>` : "");
    const pl = b.querySelector(".fen-plus"); if (pl) pl.addEventListener("click", e => this.menuPlus(e, sec));
    b.querySelectorAll("[data-fm]").forEach(x => x.addEventListener("click", () => this.allerModule(x.dataset.fm)));
    b.querySelectorAll("[data-o]").forEach(x => x.addEventListener("click", () => Onglets.activer(x.dataset.o)));
    // onglets de fiches : glisser pour réordonner, clic droit (ou appui long) pour épingler ou fermer
    b.querySelectorAll(".onglet-t[data-o]").forEach(t => {
      t.addEventListener("contextmenu", e => Onglets.menuOnglet(e, t.dataset.o));
      t.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", t.dataset.o); e.dataTransfer.effectAllowed = "move"; t.classList.add("glisse"); });
      t.addEventListener("dragend", () => t.classList.remove("glisse"));
      t.addEventListener("dragover", e => { e.preventDefault(); t.classList.add("cible"); });
      t.addEventListener("dragleave", () => t.classList.remove("cible"));
      t.addEventListener("drop", e => { e.preventDefault(); t.classList.remove("cible"); Onglets.deplacer(e.dataTransfer.getData("text/plain"), t.dataset.o); });
    });
    b.querySelectorAll("[data-x]").forEach(x => x.addEventListener("click", e => { e.stopPropagation(); Onglets.fermer(x.dataset.x); }));
  }
};

// la barre suit le module affiché, d'où qu'il soit changé (menu, recherche, restauration au démarrage) : pas de structure transitoire
(() => {
  let t = null;
  const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => Onglets.rendreBarre(), 30); });
  document.querySelectorAll(".tab-panel").forEach(p => mo.observe(p, { attributes: true, attributeFilter: ["class"] }));
})();

Onglets.init();
// onglet majeur : la liste à gauche, l'article à droite ; un bouton ⧉ sur l'article l'ouvre dans un nouvel onglet
(() => {
  const brancher = (obj, nom, zoneId, ouvrir) => {
    if (typeof obj === "undefined" || !obj[nom]) return;
    const orig = obj[nom].bind(obj);
    obj[nom] = async function (x, li) { const r = await orig(x, li); Fenetre.boutonOnglet(document.getElementById(zoneId), () => ouvrir(x)); return r; };
  };
  brancher(typeof Formules !== "undefined" ? Formules : undefined, "showDetail", "formule-detail", f => Onglets.ouvrirFormule(f.id));
  brancher(typeof Formules !== "undefined" ? Formules : undefined, "showVariation", "formule-detail", v => Onglets.ouvrirFormule(v.id));
  brancher(typeof Syndromes !== "undefined" ? Syndromes : undefined, "showDetail", "syn-detail", e => Onglets.ouvrirSyndrome(e));
  brancher(typeof Points !== "undefined" ? Points : undefined, "showDetail", "pts-detail", e => Onglets.ouvrirPoint(e.id));
})();
// Points Tung : la fiche affichée à droite peut s'ouvrir dans son propre onglet (⧉), comme les autres
if (typeof Tung !== "undefined" && Tung.rendreDetail) {
  const rd = Tung.rendreDetail.bind(Tung);
  Tung.rendreDetail = function (...a) {
    const r = rd(...a);
    const id = Tung.actif;
    if (id && id !== "(nouveau)" && Tung.vue === "fiches" && !Tung.edition && Tung.parId(id)) Fenetre.boutonOnglet(document.getElementById("tung-detail"), () => Onglets.ouvrirTung(id));
    return r;
  };
}
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

/* ============ Palette de commandes (Ctrl+K) : une recherche qui ouvre directement une fiche dans un onglet, ou change de section ============ */
const Palette = {
  sel: 0, res: [], index: null,
  norm(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); },
  async construire() {
    const e = [];
    const add = (groupe, lib, detail, texte, action) => e.push({ groupe, lib, detail, n: this.norm(lib + " " + detail + " " + (texte || "")), action });
    Object.entries(Fenetre.SECTIONS).forEach(([k, S]) => S.mods.forEach(([m, nom]) => add("Aller à", S.nom + " › " + nom, "", "section module", () => { const b = document.querySelector('#menu-panneau .tab-btn[data-tab="' + m + '"]'); if (b) b.click(); })));
    try { if (typeof Circuits !== "undefined") { await Circuits.ensureLoaded(); Circuits.liste.forEach(c => add("Circuits", Circuits.nomCourt(c), c.grille.join(" · ") + ((c.mots_cles || []).length ? " — " + c.mots_cles.slice(0, 2).join(" ; ") : ""), Circuits.texteRecherche(c), () => Onglets.ouvrirCircuit(c.id))); } } catch (x) { /* circuits indisponibles */ }
    try { if (typeof Tung !== "undefined") { await Tung.ensureLoaded(); Tung.liste.forEach(f => add("Points Tung", f.nom + ((f.numeros || []).length ? " " + f.numeros.join("/") : ""), "", (f.alias || []).join(" "), () => Onglets.ouvrirTung(f.id))); } } catch (x) { /* Tung indisponible */ }
    add("Aller à", "Comparer deux circuits", "comparaison, circuits", "comparer circuit", () => Onglets.ouvrirComparaisonCircuits());
    add("Aller à", "Nouvelle prescription", "formule, ajouts, budget", "prescrire ordonnance", () => Onglets.ouvrirPrescription());
    if (typeof Formules !== "undefined") (Formules.index || []).forEach(f => add("Formules", f.pinyin || f.id, f.nom_fr || "", f.indications_syndrome, () => Onglets.ouvrirFormule(f.id)));
    if (typeof Syndromes !== "undefined") (Syndromes.entries || []).forEach(s => add("Syndromes", s.nom, s.sousLabel || "", "", () => Onglets.ouvrirSyndrome(s)));
    if (typeof Points !== "undefined") (Points.entries || []).forEach(p => add("Points", p.id, (p.data && p.data.pinyin) || "", "", () => Onglets.ouvrirPoint(p.id)));
    this.index = e;
  },
  async ouvrir() {
    let p = document.getElementById("palette");
    if (!p) {
      p = document.createElement("div"); p.id = "palette"; p.hidden = true;
      p.innerHTML = `<div class="pal-boite" role="dialog" aria-label="Palette de commandes"><input type="search" id="pal-q" placeholder="Chercher une fiche, un circuit, un symptôme, une section…" autocomplete="off"><ul id="pal-res" role="listbox"></ul><p class="pal-aide muted">↑ ↓ pour choisir · Entrée pour ouvrir dans un onglet · Échap pour fermer</p></div>`;
      document.body.appendChild(p);
      p.addEventListener("click", ev => { if (ev.target === p) this.fermer(); });
      p.querySelector("#pal-q").addEventListener("input", () => { this.sel = 0; this.chercher(); });
      p.querySelector("#pal-q").addEventListener("keydown", ev => {
        if (ev.key === "ArrowDown") { ev.preventDefault(); this.sel = Math.min(this.res.length - 1, this.sel + 1); this.afficher(); }
        else if (ev.key === "ArrowUp") { ev.preventDefault(); this.sel = Math.max(0, this.sel - 1); this.afficher(); }
        else if (ev.key === "Enter") { ev.preventDefault(); this.valider(this.sel); }
        else if (ev.key === "Escape") { ev.preventDefault(); this.fermer(); }
      });
    }
    p.hidden = false;
    const q = p.querySelector("#pal-q"); q.value = ""; q.focus();
    this.sel = 0; this.res = [];
    p.querySelector("#pal-res").innerHTML = `<li class="muted pal-vide">Chargement…</li>`;
    if (!this.index) await this.construire();
    this.chercher();
  },
  fermer() { const p = document.getElementById("palette"); if (p) p.hidden = true; },
  chercher() {
    const mots = this.norm(document.getElementById("pal-q").value).split(/\s+/).filter(Boolean);
    this.res = (this.index || []).filter(x => mots.every(m => x.n.includes(m))).slice(0, 40);
    if (!mots.length) this.res = (this.index || []).filter(x => x.groupe === "Aller à" || x.groupe === "Circuits").slice(0, 25);
    this.afficher();
  },
  afficher() {
    const ul = document.getElementById("pal-res");
    let g = "";
    ul.innerHTML = this.res.map((x, i) => (x.groupe !== g ? (g = x.groupe, `<li class="pal-groupe" role="presentation">${escapeHtml(g)}</li>`) : "") + `<li role="option" class="pal-item${i === this.sel ? " sel" : ""}" data-i="${i}" aria-selected="${i === this.sel}"><strong>${escapeHtml(x.lib)}</strong>${x.detail ? ` <span class="muted">${escapeHtml(x.detail)}</span>` : ""}</li>`).join("") || `<li class="muted pal-vide">Rien trouvé.</li>`;
    ul.querySelectorAll(".pal-item").forEach(li => { li.addEventListener("click", () => this.valider(+li.dataset.i)); li.addEventListener("mousemove", () => { if (this.sel !== +li.dataset.i) { this.sel = +li.dataset.i; ul.querySelectorAll(".pal-item").forEach(x => x.classList.toggle("sel", +x.dataset.i === this.sel)); } }); });
    const s = ul.querySelector(".pal-item.sel"); if (s) s.scrollIntoView({ block: "nearest" });
  },
  valider(i) { const x = this.res[i]; if (!x) return; this.fermer(); x.action(); },
  init() {
    document.addEventListener("keydown", ev => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); this.ouvrir(); }
      else if (ev.key === "Escape") this.fermer();
    });
  }
};
Palette.init();
