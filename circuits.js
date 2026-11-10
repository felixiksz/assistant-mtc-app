"use strict";

/* ============================= Circuits thérapeutiques =============================
   Un circuit = 4 canaux réguliers placés en 2 x 2 : la ligne du haut porte les canaux de main, la ligne du bas les canaux de pied ;
   rond noir = canal yīn, rond blanc = canal yáng ; les traits sont ceux des quatre schémas du cours « Méthode de l'équilibre global »
   (1 : horizontales + diagonales, 2 : verticales + diagonales, 3 : horizontales + verticales, 4 : toutes).
   Données : acupuncture/circuits/circuits.json (cours « Les circuits thérapeutiques », généré par generer.py)
           + acupuncture/circuits/circuits_perso.json (circuits créés et modifications faites dans l'application ; jamais réécrit par le script).
   Dépend de app.js : Store, escapeHtml, dsNorm, sansChinois, Syndromes, DiagSignes, Proposer. */

// retire les caractères chinois d'un texte (le pinyin reste) et les parenthèses devenues vides : « tǔ 土 » → « tǔ », « (气) » → rien
function sansHanzi(t) {
  return String(t || "").replace(/[一-鿿㐀-䶿]+/g, "").replace(/\s*[(（]\s*[)）]/g, "").replace(/[(（]\s+/g, "(").replace(/\s+([)）,;.:])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

const Circuits = {
  CHEMIN_BASE: "acupuncture/circuits/circuits.json",
  CHEMIN_PERSO: "acupuncture/circuits/circuits_perso.json",
  CHEMIN_POINTS: "acupuncture/circuits/points_canaux_perso.json",       // points ajoutés par canal (toi)
  CHEMIN_PROPOSES: "acupuncture/circuits/points_proposes.json",         // points proposés par catégorie classique (actions à valider)
  points: { titre: "Points par canal, ajoutés dans l'application", canaux: {} },
  proposes: null,
  base: null,
  perso: { titre: "Circuits créés ou modifiés dans l'application", circuits: [], surcharges: {} },
  canaux: new Map(),
  liste: [],
  actif: null,
  filtre: null,
  recherche: "",
  edition: null,
  _p: null,
  POSITIONS: [[30, 30], [90, 30], [30, 90], [90, 90]],
  PLACES: ["Haut gauche (main)", "Haut droite (main)", "Bas gauche (pied)", "Bas droite (pied)"],
  LIENS: { 0: ["H", "V"], 1: ["H", "D"], 2: ["V", "D"], 3: ["H", "V"], 4: ["H", "V", "D"] },
  PAIRES: { H: [[0, 1], [2, 3]], V: [[0, 2], [1, 3]], D: [[0, 3], [1, 2]] },
  // nom d'organe ou de canal (sans accent, en minuscules) -> code du canal
  NOM_CODE: { poumon: "P", "gros intestin": "GI", estomac: "E", rate: "Rt", coeur: "C", "intestin grele": "IG", vessie: "V", rein: "Rn", reins: "Rn",
              "enveloppe du coeur": "EC", "trois foyers": "TF", "vesicule biliaire": "VB", foie: "F" },
  NIVEAU_CODES: { "tai yang": ["IG", "V"], "yang ming": ["GI", "E"], "shao yang": ["TF", "VB"], "tai yin": ["P", "Rt"], "shao yin": ["C", "Rn"], "jue yin": ["EC", "F"] },

  // ---------- données
  async ensureLoaded() {
    if (!this._p) {
      this._p = (async () => {
        this.base = await Store.readJSON(this.CHEMIN_BASE);
        try {
          const p = await Store.readJSON(this.CHEMIN_PERSO);
          this.perso = { titre: p.titre || this.perso.titre, circuits: p.circuits || [], surcharges: p.surcharges || {} };
        } catch (e) { /* pas encore de fichier personnel : rien n'a été créé */ }
        try {
          const q = await Store.readJSON(this.CHEMIN_POINTS);
          this.points = { titre: q.titre || this.points.titre, canaux: q.canaux || {} };
        } catch (e) { /* pas encore de points ajoutés */ }
        this.base.canaux.forEach(c => this.canaux.set(c.code, c));
        this.recomposer();
      })();
    }
    try { await this._p; } catch (e) { this._p = null; throw e; }
  },

  recomposer() {
    const surch = this.perso.surcharges || {};
    const vide = { ajouts: [], actions: [], indications: [], indications_groupes: [], syndromes: [], alias: [], notes: [], syndromes_lies: [], niveaux: [], associations: [], formules: [], formules_note: "" };
    const b = this.base.circuits.map(c => ({ ...vide, ...c, ...(surch[c.id] || {}), origine: "cours", modifie: !!surch[c.id], de_base: c }));
    const p = (this.perso.circuits || []).map(c => ({ ...vide, figure: 1, ...c, origine: "perso", modifie: false }));
    this.liste = [...b, ...p];
  },

  parId(id) { return this.liste.find(c => c.id === id) || null; },
  nomCourt(c) { return sansChinois(c.nom).replace(/\s+/g, " ").trim() || c.nom; },
  polarite(code) { const k = this.canaux.get(code); return k ? k.polarite : "yin"; },
  texteRecherche(c) {
    return dsNorm([c.nom, ...(c.alias || []), ...c.grille, ...c.grille.map(k => (this.canaux.get(k) || {}).nom), ...c.actions, ...c.indications, ...(c.indications_groupes || []).map(g => g.titre), ...(c.notes || []), ...(c.associations || []).map(a => a.tableau + " " + Object.values(a.points || {}).flat().join(" "))].join(" "));
  },

  // ---------- dessin : 4 ronds (noir = yīn, blanc = yáng), traits selon le schéma ;
  // o = { taille, etiquettes, surligne (Set de codes), legende, ajouts (canaux ajoutables, en pointillé sous la figure), points ({ code: [points] } d'une association, écrits près de chaque rond) }
  lignesPoints(v) {
    const mots = (Array.isArray(v) ? v : String(v || "").split(/[,;]\s*/)).map(x => String(x).trim()).filter(Boolean);
    const lignes = [];
    mots.forEach(m => { const l = lignes[lignes.length - 1]; if (l && (l + " " + m).length <= 14) lignes[lignes.length - 1] = l + " " + m; else lignes.push(m); });
    return lignes;
  },

  dessin(c, o = {}) {
    const taille = o.taille || 120, fig = this.LIENS[c.figure] ? c.figure : 0;
    const pos = this.POSITIONS, g = c.grille || [], pts = o.points || null, marge = pts ? 27 : 0;
    const police = `font-family="var(--font-body, sans-serif)"`;
    const traits = this.LIENS[fig].flatMap(t => this.PAIRES[t]).map(([a, b]) => `<line x1="${pos[a][0]}" y1="${pos[a][1]}" x2="${pos[b][0]}" y2="${pos[b][1]}" stroke="var(--ink)" stroke-width="3.2" stroke-linecap="round"/>`).join("");
    const rond = (x, y, r, code, o2 = {}) => {
      const yin = this.polarite(code) === "yin";
      const lib = o2.etiquette && code ? `<text x="${x}" y="${y + (r > 12 ? 4.5 : 3)}" text-anchor="middle" font-size="${r > 12 ? (code.length > 1 ? 12 : 14) : 8}" font-weight="700" ${police} fill="${yin ? "var(--bg)" : "var(--ink)"}">${escapeHtml(code)}</text>` : "";
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${yin ? "var(--ink)" : "var(--bg)"}" stroke="var(--ink)" stroke-width="${o2.pointille ? 2.5 : 3}"${o2.pointille ? ` stroke-dasharray="3.5 2.5"` : ""}><title>${escapeHtml((this.canaux.get(code) || {}).nom || code)}</title></circle>${lib}`;
    };
    const ronds = pos.map(([x, y], i) => {
      const code = g[i] || "";
      const anneau = o.surligne && o.surligne.has(code) ? `<circle cx="${x}" cy="${y}" r="21.5" fill="none" stroke="var(--accent)" stroke-width="4"/>` : "";
      return anneau + rond(x, y, 16, code, { etiquette: o.etiquettes });
    }).join("");
    // points d'acupuncture : au-dessus des ronds du haut, au-dessous de ceux du bas
    const etiq = pts ? pos.map(([x, y], i) => {
      const l = this.lignesPoints(pts[g[i]]);
      if (!l.length) return "";
      const y0 = i < 2 ? y - 22 - (l.length - 1) * 8.5 : y + 29;
      return l.map((t, k) => `<text x="${x}" y="${y0 + k * 8.5}" text-anchor="middle" font-size="7.8" font-weight="700" ${police} fill="var(--ink)">${escapeHtml(t)}</text>`).join("");
    }).join("") : "";
    // ajouts possibles : canaux en pointillé sous la figure, « + » devant, trait entre eux quand ils vont ensemble
    const groupes = o.ajouts ? (c.ajouts || []).filter(a => (a.canaux || []).length) : [];
    const aj = groupes.map((a, k) => {
      const n = a.canaux.length, cy = 120 + marge + 30 + k * 52, x0 = 60 - n * 15 + 15;
      const lien = n > 1 ? a.canaux.slice(1).map((_, j) => a.ensemble
        ? `<line x1="${x0 + j * 30}" y1="${cy}" x2="${x0 + (j + 1) * 30}" y2="${cy}" stroke="var(--ink)" stroke-width="2"/>`
        : `<text x="${x0 + j * 30 + 15}" y="${cy + 3}" text-anchor="middle" font-size="7" ${police} fill="var(--ink)">ou</text>`).join("") : "";
      const noeuds = a.canaux.map((code, j) => rond(x0 + j * 30, cy, 11, code, { etiquette: true, pointille: true })).join("");
      const legende = sansHanzi(a.action || "").slice(0, 34);
      const marque = `<text x="60" y="${cy - 17}" text-anchor="middle" font-size="6.6" font-weight="700" letter-spacing="0.6" ${police} fill="var(--ink)">AJOUT POSSIBLE</text>`;
      return `${marque}${lien}${noeuds}<text x="${x0 - 22}" y="${cy + 5}" text-anchor="middle" font-size="15" font-weight="700" ${police} fill="var(--ink)">+</text>` +
        (legende ? `<text x="60" y="${cy + 25}" text-anchor="middle" font-size="7" ${police} fill="var(--ink)" opacity="0.8">${escapeHtml(legende)}</text>` : "");
    }).join("");
    const cote = "";                                   // pas de mention « main » / « pied » : ça va de soi
    const L = 120, H = 120 + marge * 2 + (groupes.length ? groupes.length * 52 + 6 : 0);
    return `<svg class="circ-svg" viewBox="0 ${-marge} ${L} ${H}" width="${taille}" height="${Math.round(taille * H / L)}" role="img" aria-label="Circuit ${escapeHtml(g.join(", "))}">${traits}${ronds}${etiq}${cote}${aj}</svg>`;
  },

  // ---------- canaux d'un syndrome de la base (organes, canaux, six niveaux)
  canauxDeSyndrome(e) {
    const out = new Set();
    const lib = dsNorm(String(e.sousLabel || ""));
    if (e.domaine === "organes" || e.domaine === "canaux") {
      String(e.sousLabel || "").split(/\s[-–]\s/).forEach(n => { const k = this.NOM_CODE[dsNorm(n).trim()]; if (k) out.add(k); });
    } else if (e.domaine === "externes") {
      Object.keys(this.NIVEAU_CODES).forEach(c => { if (lib.includes(c)) this.NIVEAU_CODES[c].forEach(k => out.add(k)); });
    }
    return out;
  },
  syndromesDuCanal(code) { return (Syndromes.entries || []).filter(e => this.canauxDeSyndrome(e).has(code)); },
  cleSynd(e) { return `${e.domaine}/${e.chemin}`; },
  entreeSynd(cle) { return (Syndromes.entries || []).find(e => this.cleSynd(e) === cle) || null; },
  // bouton « retour au circuit » ajouté en tête d'une fiche ouverte depuis un circuit (syndrome, formule, point Tung)
  ajouterRetour(zone, id) {
    const circ = id && this.parId(id);
    if (!zone || !circ) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "edit-toggle-btn circ-retour";
    b.textContent = "← Retour au circuit « " + this.nomCourt(circ) + " »";
    b.addEventListener("click", () => this.ouvrirCircuit(id));
    zone.prepend(b);
  },
  async ouvrirSyndrome(e) {
    const retour = this.actif;
    document.querySelector('.tab-btn[data-tab="syndromes"]').click();
    await Syndromes.showDetail(e);
    this.ajouterRetour(document.getElementById("syn-detail"), retour);
  },

  // ---------- onglet : liste + fiche
  init() {
    document.getElementById("circuit-search").addEventListener("input", e => { this.recherche = e.target.value; this.rendreListe(); });
    document.getElementById("circuit-nouveau").addEventListener("click", () => this.nouveau());
    document.querySelector('.tab-btn[data-tab="circuits"]').addEventListener("click", () => this.ouvert());
    document.addEventListener("click", e => {
      const b = e.target.closest("[data-circ-fiche]"), f = e.target.closest("[data-form]");
      if (b) this.ouvrirCircuit(b.dataset.circFiche);
      else if (f) this.ouvrirFormule(f.dataset.form);
    });
    window.addEventListener("resize", () => { const g = document.querySelector(".circ-graphe"); if (g && g.offsetParent) ModifArbre.tracer(g); });
    this.ensureLoaded().catch(() => { /* les fiches de formules n'afficheront pas de circuit équivalent tant que les données manquent */ });
  },

  async ouvert() {
    try { await this.ensureLoaded(); } catch (e) { document.getElementById("circuit-detail").innerHTML = `<p class="muted">Chargement impossible (${escapeHtml(e.message)}).</p>`; return; }
    this.rendrePuces();
    this.rendreListe();
    if (this.actif && this.parId(this.actif)) this.rendreFiche();
  },

  rendrePuces() {
    const el = document.getElementById("circuit-canaux");
    el.innerHTML = `<button type="button" class="cat-chip${this.filtre ? "" : " active"}" data-k="">Tous (${this.liste.length})</button>` +
      this.base.canaux.map(k => `<button type="button" class="cat-chip${this.filtre === k.code ? " active" : ""}" data-k="${k.code}" title="${escapeHtml(k.nom + " — " + k.canal)}">${k.code}</button>`).join("");
    el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { this.filtre = b.dataset.k || null; this.rendrePuces(); this.rendreListe(); }));
  },

  rendreListe() {
    const ul = document.getElementById("circuit-list"), q = dsNorm(this.recherche.trim());
    const l = this.liste.filter(c => (!this.filtre || c.grille.includes(this.filtre)) && (!q || q.split(/\s+/).every(m => this.texteRecherche(c).includes(m))));
    ul.innerHTML = l.map(c => `<li class="gl-item circ-item${c.id === this.actif ? " selected" : ""}" data-id="${escapeHtml(c.id)}">` +
      `<span class="circ-mini">${this.dessin(c, { taille: 54, etiquettes: true })}</span>` +
      `<span class="circ-titre"><strong>${escapeHtml(this.nomCourt(c))}</strong><span class="muted">${c.grille.join(" · ")}${c.origine === "perso" ? " · créé par toi" : c.modifie ? " · modifié" : ""}</span></span></li>`).join("") || `<li class="muted">Aucun circuit.</li>`;
    ul.querySelectorAll("li[data-id]").forEach(li => li.addEventListener("click", () => this.afficher(li.dataset.id)));
    document.getElementById("circuit-count").textContent = l.length + " circuit(s)";
  },

  afficher(id) { this.actif = id; this.edition = null; this.rendreListe(); this.rendreFiche(); },

  // ---------- indications rangées par catégories (les notes gardent leur découpage ; la liste à plat sert à la recherche et à la proposition)
  indicationsEnTexte(c) {
    const g = c.indications_groupes || [];
    if (!g.length) return (c.indications || []).join("\n");
    return g.map(x => (x.titre ? x.titre.toUpperCase() + " :\n" : "") + x.items.join("\n")).join("\n\n");
  },
  // texte -> { indications (liste à plat), indications_groupes } ; sans aucun titre, pas de groupes (liste simple)
  texteEnIndications(t) {
    const groupes = []; let cur = null, titres = 0;
    String(t || "").split(/\r?\n/).forEach(brut => {
      const l = brut.trim();
      if (!l) { cur = null; return; }
      const maj = l.length <= 40 && /^[A-ZÀ-ÖØ-ÞŒ][A-ZÀ-ÖØ-ÞŒ0-9 '’\-\/]*$/.test(l);
      if (/^[^:]{1,60}:$/.test(l) || maj) {
        let titre = l.replace(/\s*:$/, "").trim();
        if (titre === titre.toUpperCase()) titre = titre.charAt(0) + titre.slice(1).toLowerCase();
        cur = { titre, items: [] }; groupes.push(cur); titres++;
      } else {
        if (!cur) { cur = { titre: "", items: [] }; groupes.push(cur); }
        cur.items.push(l.replace(/[,;]+$/, "").trim());
      }
    });
    const pleins = groupes.filter(g => g.items.length);
    return { indications: pleins.flatMap(g => g.items), indications_groupes: titres ? pleins : [] };
  },
  indicationsHtml(c) {
    const g = c.indications_groupes || [];
    if (!g.length) return this.ul(c.indications);
    return g.map(x => `<div class="circ-indic-groupe">${x.titre ? `<h4 class="circ-indic-titre">${escapeHtml(sansHanzi(x.titre))}</h4>` : ""}${this.ul(x.items)}</div>`).join("");
  },

  ul(items) { return items && items.length ? `<ul class="tcm-list">${items.map(x => `<li>${escapeHtml(sansHanzi(x))}</li>`).join("")}</ul>` : ""; },
  section(titre, html) { return html ? `<section><h3>${titre}</h3>${html}</section>` : ""; },

  rendreFiche() {
    const zone = document.getElementById("circuit-detail"), c = this.parId(this.actif);
    if (!c) { zone.innerHTML = `<p class="muted">Sélectionne un circuit à gauche pour voir sa fiche.</p>`; return; }
    if (this.edition) { this.rendreEdition(c); return; }
        const niveaux = (c.niveaux || []).map(x => {
      const n = dsNorm(sansChinois(x));
      const co = (this.base.niveaux || []).find(y => n.includes(dsNorm(y.nom)));
      return co ? `<details class="circ-niveau"><summary>Fonctions de ${escapeHtml(co.nom)} <span class="muted">(cours p. ${co.page})</span></summary>${this.ul(co.fonctions)}</details>` : "";
    }).join("");
    const astuces = (this.base.astuces || []).filter(a => a.paires.some(p => p.every(k => c.grille.includes(k)))).map(a => `<li>${escapeHtml(sansHanzi(a.texte))}</li>`).join("");
    const ajouts = (c.ajouts || []).map(a => `<li>${a.action ? escapeHtml(sansHanzi(a.action)) + " : " : ""}${escapeHtml(sansHanzi(a.texte || ""))} ${(a.canaux || []).map(k => `<span class="sx-code">${escapeHtml(k)}</span>`).join(" ")}${a.source && /^proposition/.test(a.source) ? ` <span class="circ-pt-tag" title="Proposition de Claude (couple biǎo-lǐ ou même niveau) : à confirmer ou supprimer">à valider</span>` : a.source && /correction/.test(a.source) ? ` <span class="muted">(selon ta correction)</span>` : ""}</li>`).join("");
    const lies = (c.syndromes_lies || []).map(k => { const e = this.entreeSynd(k); return e ? `<button type="button" class="edit-toggle-btn" data-synd="${escapeHtml(k)}">${escapeHtml(sansHanzi(e.nom))}</button>` : `<span class="muted">${escapeHtml(k)} (introuvable)</span>`; }).join(" ");
    const parCanal = c.grille.map(code => {
      const l = this.syndromesDuCanal(code);
      if (!l.length) return "";
      return `<details class="circ-synd"><summary><span class="sx-code">${code}</span> ${escapeHtml((this.canaux.get(code) || {}).nom || "")} <span class="muted">(${l.length})</span></summary><div class="circ-synd-liste">${l.map(e => `<button type="button" class="edit-toggle-btn" data-synd="${escapeHtml(this.cleSynd(e))}">${escapeHtml(sansHanzi(e.nom))}</button>`).join(" ")}</div></details>`;
    }).join("");
    zone.innerHTML = `
      <div class="circ-barre">
        <button type="button" class="edit-toggle-btn" id="circ-edit">✏️ Modifier cette fiche</button>
        ${c.origine === "perso" ? `<button type="button" class="edit-toggle-btn" id="circ-suppr">🗑 Supprimer</button>` : c.modifie ? `<button type="button" class="edit-toggle-btn" id="circ-retablir">↺ Revenir à la version du cours</button>` : ""}
      </div>
      <h2>${escapeHtml(sansHanzi(c.nom))}</h2>
      <div class="circ-haut">
        <div class="circ-grand" id="circ-dessin">${this.dessin(c, { taille: 230, etiquettes: true, legende: true, ajouts: true })}</div>

      </div>
      ${this.section("Syndromes du circuit", this.ul((c.syndromes || []).map(s => s.replace(/^syndromes? du /i, "du ").replace(/^du /, "Syndromes du "))))}
      ${this.section("Syndromes de ta base rattachés à ce circuit", lies ? `<div class="circ-synd-liste">${lies}</div>` : `<p class="muted">Aucun pour l'instant : « Modifier cette fiche » permet d'en rattacher.</p>`)}
      ${this.section("Actions / fonctions du circuit", this.ul(c.actions))}
      ${this.section("Indications", this.indicationsHtml(c))}
      <section><h3>Points des canaux</h3><div id="circ-pts" class="circ-pts-grille"></div></section>
      <section><h3>Ajouts possibles</h3>${ajouts ? `<ul class="tcm-list">${ajouts}</ul><p class="muted">Dessinés en pointillé sous le circuit.</p>` : ""}<div class="circ-barre"><button type="button" class="edit-toggle-btn" id="circ-aj-prop">💡 Proposer des canaux à ajouter</button></div><div id="circ-aj-zone"></div></section>
      ${this.section("Associations de points", (c.associations || []).length
        ? `<div class="cat-chip-row circ-assoc-puces">${c.associations.map((a, i) => `<button type="button" class="cat-chip" data-a="${i}">${escapeHtml(sansHanzi(a.tableau))}</button>`).join("")}</div><div id="circ-assoc-detail" class="circ-assoc-detail"></div>`
        : `<p class="muted">Aucune pour l'instant : « Modifier cette fiche » permet d'ajouter un tableau avec les points de chaque canal.</p>`)}
      ${this.section("Comparaison des associations et des ajouts", this.graphe(c))}
      ${this.section("Formule de pharmacopée équivalente", this.equivalent(c))}
      <section><h3>Points Tung compatibles</h3><div id="circ-tung" class="circ-tung"><p class="muted">Chargement…</p></div></section>
      ${(c.notes || []).length ? this.section("Notes", this.ul(c.notes)) : ""}
      ${niveaux ? this.section("Niveaux", niveaux) : ""}
      ${astuces ? this.section("Astuces du Dr Tán Té Fū (cours, p. 41)", `<ul class="tcm-list">${astuces}</ul>`) : ""}
      <section><h3>Syndromes de ta base portant sur ces canaux</h3><p class="muted">Syndromes des organes, des canaux et des six niveaux dont l'organe ou le niveau est un des quatre canaux.</p>${parCanal || `<p class="muted">Aucun.</p>`}</section>
      <p class="muted">Méthode de l'équilibre global : chaque canal du circuit doit avoir au moins deux connexions (une entrée, une sortie). ${escapeHtml(this.base.regles.changer || "")}</p>`;
    zone.querySelectorAll("[data-synd]").forEach(b => b.addEventListener("click", () => { const e = this.entreeSynd(b.dataset.synd); if (e) this.ouvrirSyndrome(e); }));
    this.assocActive = null;
    zone.querySelectorAll(".circ-assoc-puces [data-a]").forEach(b => b.addEventListener("click", () => { this.assocActive = this.assocActive === +b.dataset.a ? null : +b.dataset.a; this.majAssoc(c); }));
    this.majAssoc(c);
    this.tracerGraphe();
    this.pointsTung(c);
    this.rendrePoints(c);
    document.getElementById("circ-aj-prop").addEventListener("click", () => this.proposerAjouts(c));
    document.getElementById("circ-edit").addEventListener("click", () => this.modifier(c));
    const s = document.getElementById("circ-suppr"); if (s) s.addEventListener("click", () => this.supprimer(c));
    const r = document.getElementById("circ-retablir"); if (r) r.addEventListener("click", () => this.retablir(c));
  },

  // enregistre des champs du circuit (surcharge d'un circuit du cours, ou le circuit créé par toi) puis réaffiche la fiche
  async enregistrerChamps(c, champs) {
    if (c.origine === "perso") { const i = this.perso.circuits.findIndex(x => x.id === c.id); this.perso.circuits[i] = { ...this.perso.circuits[i], ...champs }; }
    else this.perso.surcharges[c.id] = { ...(this.perso.surcharges[c.id] || {}), ...champs };
    try { await Store.writeJSON(this.CHEMIN_PERSO, { titre: this.perso.titre, circuits: this.perso.circuits, surcharges: this.perso.surcharges }); }
    catch (e) { alert("Enregistrement impossible : " + e.message); return; }
    this.recomposer(); this.rendreListe(); this.rendreFiche();
  },
  // ⊕ : ajoute un point d'un canal à un tableau d'association de points du circuit (ou crée un tableau)
  menuAssoc(c, code, point, bouton) {
    const ancien = document.querySelector(".circ-pt-menu");
    if (ancien) { const memeBouton = ancien.previousElementSibling === bouton; ancien.remove(); if (memeBouton) return; }
    const m = document.createElement("div");
    m.className = "circ-pt-menu";
    const ass = c.associations || [];
    m.innerHTML = `<p class="muted">Ajouter ${escapeHtml(point)} à :</p>` + ass.map((a, i) => `<button type="button" class="edit-toggle-btn" data-i="${i}">${escapeHtml(sansHanzi(a.tableau))}</button>`).join(" ") + ` <button type="button" class="edit-toggle-btn" data-i="new">+ Nouveau tableau</button>`;
    bouton.insertAdjacentElement("afterend", m);
    m.querySelectorAll("button").forEach(b => b.addEventListener("click", async () => {
      const copie = JSON.parse(JSON.stringify(ass));
      let cible;
      if (b.dataset.i === "new") {
        const nom = (prompt("Nom du tableau (syndrome ou intitulé) :") || "").trim();
        if (!nom) { m.remove(); return; }
        cible = { tableau: nom, points: {}, note: "" }; copie.push(cible);
      } else cible = copie[+b.dataset.i];
      cible.points = cible.points || {};
      const l = cible.points[code] || (cible.points[code] = []);
      if (!l.includes(point)) l.push(point);
      await this.enregistrerChamps(c, { associations: copie });
    }));
  },

  // ---------- canaux à ajouter : propositions mécaniques à valider (couple biǎo-lǐ et même niveau de chaque canal du circuit)
  BIAOLI: { P: "GI", GI: "P", E: "Rt", Rt: "E", C: "IG", IG: "C", V: "Rn", Rn: "V", EC: "TF", TF: "EC", VB: "F", F: "VB" },
  MEME_NIVEAU: { P: "Rt", Rt: "P", GI: "E", E: "GI", C: "Rn", Rn: "C", IG: "V", V: "IG", EC: "F", F: "EC", TF: "VB", VB: "TF" },
  LIB_NIVEAU: { P: "tài yīn", Rt: "tài yīn", GI: "yáng míng", E: "yáng míng", C: "shào yīn", Rn: "shào yīn", IG: "tài yáng", V: "tài yáng", EC: "jué yīn", F: "jué yīn", TF: "shào yáng", VB: "shào yáng" },
  candidatsAjout(c) {
    const dans = new Set(c.grille), deja = new Set((c.ajouts || []).flatMap(a => a.canaux || [])), out = new Map();
    c.grille.forEach(k => {
      [[this.BIAOLI[k], `couple biǎo-lǐ de ${k}`], [this.MEME_NIVEAU[k], `même niveau que ${k} (${this.LIB_NIVEAU[k]})`]].forEach(([x, raison]) => {
        if (!x || dans.has(x) || deja.has(x)) return;
        if (!out.has(x)) out.set(x, []);
        out.get(x).push(raison);
      });
    });
    return [...out.entries()].map(([code, raisons]) => ({ code, raisons }));
  },
  proposerAjouts(c) {
    const z = document.getElementById("circ-aj-zone");
    if (z.innerHTML) { z.innerHTML = ""; return; }
    const l = this.candidatsAjout(c);
    z.innerHTML = `<p class="muted circ-pts-avert">Propositions mécaniques : le canal couplé (biǎo-lǐ) ou du même niveau qu'un canal du circuit. Elles ne viennent pas de tes cours : à valider.</p>` +
      (l.length ? `<ul class="circ-pts-prop">${l.map((x, i) => `<li><strong>${escapeHtml(x.code)}</strong> <span class="muted">${escapeHtml((this.canaux.get(x.code) || {}).nom || "")}</span> — ${escapeHtml(x.raisons.join(" ; "))} <button type="button" class="edit-toggle-btn" data-i="${i}">+ Ajouter</button></li>`).join("")}</ul>` : `<p class="muted">Rien à proposer de plus.</p>`);
    z.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", async () => {
      const x = l[+b.dataset.i], nom = ((this.canaux.get(x.code) || {}).nom || x.code).toLowerCase();
      const a = { action: "", texte: `canal ${nom} (${x.code}) — ${x.raisons.join(" ; ")}`, canaux: [x.code], ensemble: false, source: "proposition (à valider)" };
      await this.ajouterAjout(c, a);
    }));
  },
  async ajouterAjout(c, a) {
    const nouveaux = [...(c.ajouts || []), a];
    if (c.origine === "perso") { const i = this.perso.circuits.findIndex(x => x.id === c.id); this.perso.circuits[i] = { ...this.perso.circuits[i], ajouts: nouveaux }; }
    else this.perso.surcharges[c.id] = { ...(this.perso.surcharges[c.id] || {}), ajouts: nouveaux };
    try { await Store.writeJSON(this.CHEMIN_PERSO, { titre: this.perso.titre, circuits: this.perso.circuits, surcharges: this.perso.surcharges }); }
    catch (e) { alert("Enregistrement impossible : " + e.message); return; }
    this.recomposer(); this.rendreListe(); this.rendreFiche();
  },

  // points d'ouverture (confluents) des huit merveilleux vaisseaux, avec leur couple : signalés partout où le point s'affiche
  OUVERTURES: {
    TF5: ["yáng wéi mài", "dài mài (VB 41)"], VB41: ["dài mài", "yáng wéi mài (TF 5)"],
    Rt4: ["chōng mài", "yīn wéi mài (EC 6)"], EC6: ["yīn wéi mài", "chōng mài (Rt 4)"],
    P7: ["rèn mài", "yīn qiāo mài (Rn 6)"], Rn6: ["yīn qiāo mài", "rèn mài (P 7)"],
    IG3: ["dū mài", "yáng qiāo mài (V 62)"], V62: ["yáng qiāo mài", "dū mài (IG 3)"],
  },
  ouverture(point) {
    const k = String(point || "").toUpperCase().replace(/[\s.\-]/g, "").replace(/^SI/, "IG").replace(/^LI/, "GI").replace(/^SP/, "RT").replace(/^UB/, "V").replace(/^BL/, "V").replace(/^KI/, "RN").replace(/^LU/, "P").replace(/^HT/, "C");
    const cle = Object.keys(this.OUVERTURES).find(x => x.toUpperCase() === k);
    return cle ? this.OUVERTURES[cle] : null;
  },
  // nom du point suivi, s'il y a lieu, de « ouvre le … » (couple en infobulle)
  pointHtml(p) {
    const o = this.ouverture(p);
    return escapeHtml(p) + (o ? ` <span class="circ-ouv" title="Point d'ouverture (confluent) du ${escapeHtml(o[0])} ; couple : ${escapeHtml(o[1])}">ouvre le ${escapeHtml(o[0])}</span>` : "");
  },

  // ---------- points par canal : une liste par canal (la même dans tous les circuits qui contiennent ce canal), avec l'action de chaque point
  ptsDe(code) { return this.points.canaux[code] || []; },
  async ecrirePoints() { await Store.writeJSON(this.CHEMIN_POINTS, { titre: this.points.titre, canaux: this.points.canaux }); },
  ligneEnPoint(l) {
    const m = String(l).match(/^\s*([^:：]{1,14}?)\s*[:：]\s*(.*)$/);
    return m ? { point: m[1].trim(), action: m[2].trim() } : { point: String(l).trim(), action: "" };
  },
  rendrePoints(c) {
    const z = document.getElementById("circ-pts");
    if (!z) return;
    const ouvert = this._ptsOuvert || {};
    z.innerHTML = c.grille.map(code => {
      const k = this.canaux.get(code) || {}, l = this.ptsDe(code);
      const li = l.map(x => `<li><button type="button" class="circ-pt-assoc" data-pt="${escapeHtml(x.point)}" title="Ajouter ce point à une association de points du circuit">⊕</button> <strong>${this.pointHtml(x.point)}</strong>${x.action ? " " + escapeHtml(sansHanzi(x.action)) : ""}${x.statut === "propose" ? ` <span class="circ-pt-tag" title="Proposition de Claude : à confirmer ou corriger (modifier la ligne la valide)">à valider</span>` : ""}</li>`).join("");
      return `<div class="circ-pts-carte" data-k="${escapeHtml(code)}"><div class="circ-pts-tete"><span><strong>${escapeHtml(code)}</strong> <span class="muted">${escapeHtml(k.nom || "")}</span></span>` +
        `<span class="circ-pts-btns"><button type="button" class="edit-toggle-btn" data-act="edit">✏️ Modifier</button> <button type="button" class="edit-toggle-btn" data-act="prop">💡 Proposer</button></span></div>` +
        (li ? `<ul class="circ-pts-liste">${li}</ul>` : `<p class="muted">Aucun point pour l'instant.</p>`) + `<div class="circ-pts-zone"></div></div>`;
    }).join("");
    z.querySelectorAll(".circ-pts-carte").forEach(carte => {
      const code = carte.dataset.k, zone = carte.querySelector(".circ-pts-zone");
      carte.querySelector('[data-act="edit"]').addEventListener("click", () => this.editerPoints(c, code, carte, zone));
      carte.querySelector('[data-act="prop"]').addEventListener("click", () => this.proposerPoints(c, code, zone));
      carte.querySelectorAll(".circ-pt-assoc").forEach(b => b.addEventListener("click", () => this.menuAssoc(c, code, b.dataset.pt, b)));
      if (ouvert[code]) this.proposerPoints(c, code, zone, true);
    });
  },
  editerPoints(c, code, carte, zone) {
    const l = this.ptsDe(code);
    zone.innerHTML = `<label class="circ-pts-edit">Un point par ligne : « C8 : clarifie le feu vide »<textarea rows="${Math.max(4, l.length + 2)}">${escapeHtml(l.map(x => x.point + (x.action ? " : " + x.action : "")).join("\n"))}</textarea></label>` +
      `<p class="muted circ-pts-statut"></p><div class="circ-barre"><button type="button" class="edit-toggle-btn" data-s="ok">💾 Enregistrer</button> <button type="button" class="edit-toggle-btn" data-s="non">Annuler</button></div>`;
    zone.querySelector('[data-s="non"]').addEventListener("click", () => { zone.innerHTML = ""; });
    zone.querySelector('[data-s="ok"]').addEventListener("click", async () => {
      const anciens = this.ptsDe(code);
      const nv = this.lignes(zone.querySelector("textarea").value).map(x => this.ligneEnPoint(x)).filter(x => x.point).map(x => {
        const a = anciens.find(y => y.point === x.point && y.action === x.action);      // ligne inchangée : garde son statut (une proposition reste « à valider »)
        return { ...x, statut: a ? a.statut : "toi" };
      });
      this.points.canaux[code] = nv;
      if (!nv.length) delete this.points.canaux[code];
      try { await this.ecrirePoints(); } catch (e) { zone.querySelector(".circ-pts-statut").textContent = "Enregistrement impossible : " + e.message; return; }
      this.rendrePoints(c);
    });
  },
  async proposerPoints(c, code, zone, sansBascule) {
    this._ptsOuvert = this._ptsOuvert || {};
    if (!sansBascule && this._ptsOuvert[code]) { this._ptsOuvert[code] = false; zone.innerHTML = ""; return; }
    this._ptsOuvert[code] = true;
    if (!this.proposes) {
      try { this.proposes = await Store.readJSON(this.CHEMIN_PROPOSES); } catch (e) { zone.innerHTML = `<p class="muted">Propositions indisponibles (${escapeHtml(e.message)}).</p>`; return; }
    }
    const deja = new Set(this.ptsDe(code).map(x => x.point));
    const l = ((this.proposes.canaux || {})[code] || []).filter(x => !deja.has(x.point));
    zone.innerHTML = `<p class="muted circ-pts-avert">Propositions par catégorie classique ; les actions sont à valider (elles ne viennent pas de tes cours).</p>` +
      (l.length ? `<ul class="circ-pts-prop">${l.map((x, i) => `<li><strong>${this.pointHtml(x.point)}</strong> <span class="muted">${escapeHtml(x.categorie)}</span>${x.action ? " — " + escapeHtml(x.action) : ""} <button type="button" class="edit-toggle-btn" data-i="${i}">+ Ajouter</button></li>`).join("")}</ul>` : `<p class="muted">Rien à proposer de plus pour ce canal (ou pas encore de propositions).</p>`);
    zone.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", async () => {
      const x = l[+b.dataset.i];
      (this.points.canaux[code] = this.points.canaux[code] || []).push({ point: x.point, action: x.action, statut: "propose" });
      try { await this.ecrirePoints(); } catch (e) { alert("Enregistrement impossible : " + e.message); return; }
      this.rendrePoints(c);
    }));
  },

  // points de Maître Tung dont tous les canaux sont dans le circuit : on peut les ajouter sans déséquilibrer le réseau
  async pointsTung(c) {
    const el = document.getElementById("circ-tung");
    if (!el) return;
    try { await Tung.ensureLoaded(); } catch (e) { el.innerHTML = `<p class="muted">Points Tung indisponibles (${escapeHtml(e.message)}).</p>`; return; }
    const r = Tung.compatibles(c.grille, (c.ajouts || []).map(a => a.canaux || []));
    const bt = f => `<li class="circ-tung-ligne"><button type="button" class="edit-toggle-btn" data-tung-fiche="${escapeHtml(f.id)}" title="${escapeHtml(Tung.localisation(f) || "Localisation non précisée dans les sources")}">${escapeHtml(f.nom)}${(f.numeros || []).length ? " " + escapeHtml(f.numeros.join("/")) : ""} <span class="muted">${f.canaux.codes.join("+")}</span></button> <span class="circ-tung-action">${escapeHtml(sansHanzi(Tung.action(f)))}</span></li>`;
    el.innerHTML = (r.ok.length ? `<p class="muted">Leurs canaux sont déjà dans le circuit : ils s'y ajoutent sans le déséquilibrer. Survole un nom pour voir la localisation.</p><ul class="circ-tung-liste">${r.ok.map(bt).join("")}</ul>` : `<p class="muted">Aucun point Tung dont le canal soit dans ce circuit pour l'instant (les canaux se renseignent dans l'onglet Points Tung).</p>`) +
      (r.avec.length ? `<p class="muted">Avec un des ajouts possibles du circuit :</p><ul class="circ-tung-liste">${r.avec.map(bt).join("")}</ul>` : "") +
      (r.collectifs.length ? `<p class="muted">Points qui agissent sur un ensemble de canaux à la fois (ici, les six fu) : à juger selon l'équilibre voulu, car ils touchent aussi les canaux absents du circuit.</p><div class="circ-synd-liste">${r.collectifs.map(f => `<button type="button" class="edit-toggle-btn" data-tung-fiche="${escapeHtml(f.id)}" title="${escapeHtml(Tung.localisation(f) || "Voir la fiche et le schéma")}">${escapeHtml(f.nom)}${(f.numeros || []).length ? " " + escapeHtml(f.numeros.join("/")) : ""}</button>`).join(" ")}</div>` : "");
  },

  // graphe de comparaison (même principe que l'arbre des modifications d'une formule) : à gauche les tableaux et les ajouts,
  // à droite les points (par canal) et les canaux ajoutés ; un point utilisé par plusieurs tableaux reçoit plusieurs traits
  graphe(c) {
    const assoc = c.associations || [], ajouts = (c.ajouts || []).filter(a => (a.canaux || []).length);
    if (!assoc.length && !ajouts.length) return "";
    const points = new Map();
    assoc.forEach((a, i) => Object.entries(a.points || {}).forEach(([code, l]) => (l || []).forEach(p => {
      const k = String(p).trim();
      if (!k) return;
      if (!points.has(k)) points.set(k, { code, n: new Set() });
      points.get(k).n.add(i);
    })));
    const nomCanal = k => (this.canaux.get(k) || {}).nom || "";
    const codes = [...new Set([...c.grille, ...[...points.values()].map(v => v.code)])].filter(k => [...points.values()].some(v => v.code === k));
    const canauxAj = [...new Set(ajouts.flatMap(a => a.canaux))];
    const gauche = assoc.map((a, i) => {
      const liens = Object.values(a.points || {}).flat().map(x => String(x).trim()).filter(Boolean).map(x => x + ":+").join(",");
      return `<div class="pm-cond" data-id="a${i}" data-liens="${escapeHtml(liens)}"><div class="pm-si"><span class="pm-si-t">Tableau</span><span class="pm-cond-t">${escapeHtml(sansHanzi(a.tableau))}</span></div>${a.note ? `<div class="pm-principe">${escapeHtml(sansHanzi(a.note))}</div>` : ""}</div>`;
    }).join("") + ajouts.map((a, j) => `<div class="pm-cond circ-ajout-cond" data-id="j${j}" data-liens="${escapeHtml(a.canaux.map(k => k + ":-").join(","))}"><div class="pm-si"><span class="pm-si-t">Ajout</span><span class="pm-cond-t">${escapeHtml(sansHanzi(a.action || a.texte || ""))}</span></div><div class="pm-principe">${escapeHtml(sansHanzi(a.texte || ""))}</div></div>`).join("");
    const droite = codes.map(k => `<div class="pm-groupe">${escapeHtml(k)} · ${escapeHtml(nomCanal(k))}</div>` +
      [...points].filter(([, v]) => v.code === k).map(([pt, v]) => `<div class="pm-sub pm-ajout${v.n.size > 1 ? " circ-commun" : ""}" data-id="s${escapeHtml(pt)}:+" data-cle="${escapeHtml(pt)}:+"><strong>${escapeHtml(pt)}</strong>${v.n.size > 1 ? ` <span class="circ-x">× ${v.n.size}</span>` : ""}</div>`).join("")).join("") +
      (canauxAj.length ? `<div class="pm-groupe">Canaux ajoutés</div>` + canauxAj.map(k => `<div class="pm-sub circ-ajout-canal" data-id="s${escapeHtml(k)}:-" data-cle="${escapeHtml(k)}:-"><span class="pm-sens">+ ajout</span> <strong>${escapeHtml(k)}</strong> <span class="muted">${escapeHtml(nomCanal(k))}</span></div>`).join("") : "");
    return `<div class="circ-graphe"><p class="muted pf-legende">Trait plein : point de l'association · trait pointillé : canal ajouté · × n : point commun à plusieurs tableaux. Survole un tableau, un ajout ou un point pour voir ses liens.</p>` +
      `<div class="pm-mm"><svg class="pf-traits" aria-hidden="true"></svg><div class="pm-gauche">${gauche}</div><div class="pm-droite">${droite}</div></div></div>`;
  },
  tracerGraphe() {
    const g = document.querySelector(".circ-graphe");
    if (!g) return;
    ModifArbre.survol(g);
    ModifArbre.tracer(g);
    setTimeout(() => { if (g.isConnected) ModifArbre.tracer(g); }, 250);
  },

  // formule de pharmacopée équivalente à un circuit (facultatif) : liens dans les deux sens
  nomFormule(id) {
    const f = Formules.byId && Formules.byId.get(id);
    if (f) return { nom: f.pinyin, fr: f.nom_fr || "" };
    const v = Formules.varParId && Formules.varParId.get(id);
    return v ? { nom: v.nom, fr: "" } : null;
  },
  equivalent(c) {
    const l = (c.formules || []);
    if (!l.length) return "";
    return `<div class="circ-synd-liste">${l.map(id => { const n = this.nomFormule(id); return `<button type="button" class="edit-toggle-btn" data-form="${escapeHtml(id)}">${escapeHtml(n ? n.nom : id)}${n && n.fr ? ` <span class="muted">${escapeHtml(n.fr)}</span>` : ""}</button>`; }).join(" ")}</div>${c.formules_note ? `<p class="muted">${escapeHtml(c.formules_note)}</p>` : ""}`;
  },
  async ouvrirFormule(id) {
    const f = Formules.byId.get(id), v = Formules.varParId.get(id), retour = this.actif;
    if (!f && !v) return;
    document.querySelector('.tab-btn[data-tab="formules"]').click();
    if (f) await Formules.showDetail(f); else await Formules.showVariation(v);
    this.ajouterRetour(document.getElementById("formule-detail"), retour);
  },
  async ouvrirCircuit(id) {
    document.querySelector('.tab-btn[data-tab="circuits"]').click();
    await this.ouvert();
    this.filtre = null; this.recherche = ""; document.getElementById("circuit-search").value = "";
    this.rendrePuces(); this.afficher(id);
  },
  // bloc « Circuit équivalent » pour la fiche d'une formule (ou d'une variation)
  blocFormule(id) {
    const l = this.liste.filter(c => (c.formules || []).includes(id));
    if (!l.length) return "";
    return `<section class="circ-equiv"><h3>Circuit équivalent</h3><div class="circ-synd-liste">${l.map(c => `<button type="button" class="edit-toggle-btn" data-circ-fiche="${escapeHtml(c.id)}">${escapeHtml(this.nomCourt(c))} <span class="muted">${c.grille.join(" · ")}</span></button>`).join(" ")}</div></section>`;
  },

  // une association = un tableau (syndrome) et les points de chaque canal du circuit ; un seul tableau est affiché à la fois, sur le dessin
  majAssoc(c) {
    const a = this.assocActive != null ? (c.associations || [])[this.assocActive] : null;
    document.getElementById("circ-dessin").innerHTML = this.dessin(c, { taille: 230, etiquettes: true, legende: true, ajouts: true, points: a ? a.points : null });
    document.querySelectorAll(".circ-assoc-puces [data-a]").forEach(b => b.classList.toggle("active", a && +b.dataset.a === this.assocActive));
    const det = document.getElementById("circ-assoc-detail");
    if (!det) return;
    if (!a) { det.innerHTML = `<p class="muted">Choisis un tableau : ses points s'écrivent sur le dessin.</p>`; return; }
    const e = a.synd ? this.entreeSynd(a.synd) : null;
    det.innerHTML = `<p>${e ? `<button type="button" class="edit-toggle-btn" data-synd="${escapeHtml(a.synd)}">${escapeHtml(sansHanzi(a.tableau))}</button>` : `<strong>${escapeHtml(sansHanzi(a.tableau))}</strong>`}</p>` +
      `<p>${Object.entries(a.points || {}).map(([k, v]) => `<span class="sx-code">${escapeHtml(k)}</span> ${v.map(p => this.pointHtml(p)).join(", ")}`).join(" · ")}</p>` + (a.note ? `<p class="muted">${escapeHtml(sansHanzi(a.note))}</p>` : "");
    det.querySelectorAll("[data-synd]").forEach(b => b.addEventListener("click", () => { const en = this.entreeSynd(b.dataset.synd); if (en) this.ouvrirSyndrome(en); }));
  },

  // ---------- création / modification
  lignes(t) { return String(t || "").split("\n").map(x => x.trim()).filter(Boolean); },
  ajoutsEnTexte(a) { return (a || []).map(x => (x.action ? x.action + " : " : "") + (x.texte || "")).join("\n"); },
  texteEnAjouts(t, originaux) {
    return this.lignes(t).map(l => {
      const o = (originaux || []).find(x => this.ajoutsEnTexte([x]) === l);       // ligne inchangée : on garde l'ajout tel quel (source, canaux)
      if (o) return o;
      const i = l.indexOf(" : ");
      const action = i > 0 ? l.slice(0, i) : "", texte = i > 0 ? l.slice(i + 3) : l;
      const codes = [...new Set((texte.match(/\b(?:P|GI|E|Rt|C|IG|V|Rn|EC|TF|VB|F)\b/g) || []))];
      return { action, texte, canaux: codes, ensemble: /ensemble/i.test(texte), source: "toi" };
    });
  },

  nouveau() {
    this.ensureLoaded().then(() => {
      this.actif = "(nouveau)";
      this.edition = { nouveau: true, nom: "", alias: "", grille: ["", "", "", ""], figure: 1, syndromes: "", actions: "", indications: "", ajouts: "", notes: "", syndromes_lies: [], niveaux: "", associations: [], formules: [], formules_note: "" };
      this.rendreListe();
      document.getElementById("circuit-detail").innerHTML = "";
      this.rendreEdition({ id: "(nouveau)", origine: "perso" });
    }).catch(e => { document.getElementById("circuit-detail").innerHTML = `<p class="muted">Chargement impossible (${escapeHtml(e.message)}).</p>`; });
  },

  modifier(c) {
    this.actif = c.id;
    this.edition = { nouveau: false, nom: c.nom, alias: (c.alias || []).join("\n"), grille: [...c.grille], figure: c.figure, syndromes: (c.syndromes || []).join("\n"),
                     actions: (c.actions || []).join("\n"), indications: this.indicationsEnTexte(c), ajouts: this.ajoutsEnTexte(c.ajouts),
                     notes: (c.notes || []).join("\n"), syndromes_lies: [...(c.syndromes_lies || [])], niveaux: (c.niveaux || []).join("\n"),
                     associations: (c.associations || []).map(a => ({ tableau: a.tableau, synd: a.synd, note: a.note || "", points: Object.fromEntries(Object.entries(a.points || {}).map(([k, v]) => [k, (v || []).join(", ")])) })),
                     formules: [...(c.formules || [])], formules_note: c.formules_note || "" };
    this.rendreFiche();
  },

  rendreEdition(c) {
    const d = this.edition, zone = document.getElementById("circuit-detail");
    const opts = v => `<option value="">— choisir —</option>` + this.base.canaux.map(k => `<option value="${k.code}"${v === k.code ? " selected" : ""}>${k.code} — ${escapeHtml(k.nom)} (${escapeHtml(k.canal)})</option>`).join("");
    const figure = n => `<label class="circ-fig"><input type="radio" name="circ-fig" value="${n}"${+d.figure === n ? " checked" : ""}> <span class="circ-fig-img" data-fig="${n}"></span> <span>${n === 0 ? "Boucle<br><small>sans schéma</small>" : "Schéma " + n + "<br><small>" + this.LIENS[n].map(t => ({ H: "horizontales", V: "verticales", D: "diagonales" })[t]).join(" + ") + "</small>"}</span></label>`;
    zone.innerHTML = `
      <h2>${d.nouveau ? "Nouveau circuit" : "Modifier : " + escapeHtml(this.nomCourt(c))}</h2>
      <form class="circ-form" id="circ-form">
        <label>Nom du circuit<input type="text" id="ce-nom" value="${escapeHtml(d.nom)}" placeholder="ex : tài yīn / yáng míng"></label>
        <label>Autres intitulés (un par ligne)<textarea id="ce-alias" rows="2">${escapeHtml(d.alias)}</textarea></label>
        <fieldset><legend>Les 4 canaux (ligne du haut : main ; ligne du bas : pied)</legend>
          <div class="circ-selects">${this.PLACES.map((p, i) => `<label>${p}<select data-i="${i}">${opts(d.grille[i])}</select></label>`).join("")}</div>
          <p class="muted" id="ce-alerte"></p>
        </fieldset>
        <fieldset><legend>Schéma de liaison</legend><div class="circ-figs">${[1, 2, 3, 4, 0].map(figure).join("")}</div></fieldset>
        <div class="circ-apercu" id="ce-apercu"></div>
        <label>Syndromes du circuit (un par ligne)<textarea id="ce-syndromes" rows="3">${escapeHtml(d.syndromes)}</textarea></label>
        <label>Actions / fonctions (une par ligne)<textarea id="ce-actions" rows="5">${escapeHtml(d.actions)}</textarea></label>
        <label>Indications (une par ligne ; pour les ranger par catégories, écris le titre sur une ligne seule, terminé par « : » ou en majuscules, puis les indications dessous ; une ligne vide referme la catégorie)<textarea id="ce-indications" rows="12">${escapeHtml(d.indications)}</textarea></label>
        <label>Ajouts possibles (un par ligne, « action : texte »)<textarea id="ce-ajouts" rows="2">${escapeHtml(d.ajouts)}</textarea></label>
        <label>Notes (une par ligne)<textarea id="ce-notes" rows="2">${escapeHtml(d.notes)}</textarea></label>
        <fieldset class="circ-assoc-form"><legend>Associations de points (un tableau = une association, à l'intérieur de ce circuit)</legend>
          <div id="ce-assoc"></div>
          <button type="button" class="edit-toggle-btn" id="ce-assoc-add">+ Ajouter une association</button>
          <datalist id="ce-synd-noms">${(Syndromes.entries || []).map(e => `<option value="${escapeHtml(e.nom)}">`).join("")}</datalist>
        </fieldset>
        <fieldset><legend>Formule de pharmacopée équivalente (facultatif)</legend>
          <div id="ce-form-lies" class="prop-choisis"></div>
          <input type="search" id="ce-form-search" placeholder="Ajouter une formule (pinyin, nom français)" autocomplete="off">
          <ul id="ce-form-sugg" class="prop-sugg"></ul>
          <label>Note sur l'équivalence<input type="text" id="ce-form-note" value="${escapeHtml(d.formules_note || "")}"></label>
        </fieldset>
        <fieldset><legend>Syndromes de ta base rattachés à ce circuit</legend>
          <div id="ce-lies" class="prop-choisis"></div>
          <input type="search" id="ce-synd-search" placeholder="Ajouter un syndrome (nom, organe, canal…)" autocomplete="off">
          <ul id="ce-synd-sugg" class="prop-sugg"></ul>
        </fieldset>
        <p id="ce-statut" class="muted" aria-live="polite"></p>
        <div class="circ-barre"><button type="submit" class="edit-toggle-btn">💾 Enregistrer</button> <button type="button" class="edit-toggle-btn" id="ce-annuler">Annuler</button></div>
      </form>`;
    const lire = () => {
      d.nom = document.getElementById("ce-nom").value;
      ["alias", "syndromes", "actions", "indications", "ajouts", "notes"].forEach(k => { d[k] = document.getElementById("ce-" + k).value; });
      zone.querySelectorAll(".circ-selects select").forEach(s => { d.grille[+s.dataset.i] = s.value; });
      const r = zone.querySelector('input[name="circ-fig"]:checked'); if (r) d.figure = +r.value;
    };
    const apercu = () => {
      lire();
      const g = d.grille;
      const ok = g.every(Boolean) && new Set(g).size === 4;
      document.getElementById("ce-apercu").innerHTML = this.dessin({ grille: g.map(x => x || ""), figure: d.figure }, { taille: 160, etiquettes: true, legende: true });
      zone.querySelectorAll(".circ-fig-img").forEach(el => { el.innerHTML = this.dessin({ grille: g.map(x => x || ""), figure: +el.dataset.fig }, { taille: 56 }); });
      const al = [];
      if (g.some(Boolean) && !ok) al.push("Choisis 4 canaux différents.");
      [0, 1].forEach(i => { if (g[i] && this.canaux.get(g[i]) && this.canaux.get(g[i]).membre !== "main") al.push(this.PLACES[i] + " : " + g[i] + " est un canal de pied."); });
      [2, 3].forEach(i => { if (g[i] && this.canaux.get(g[i]) && this.canaux.get(g[i]).membre !== "pied") al.push(this.PLACES[i] + " : " + g[i] + " est un canal de main."); });
      document.getElementById("ce-alerte").textContent = al.join(" ");
      assoc();
    };
    // associations de points : un champ par canal du circuit (et par canal ajouté)
    const assoc = () => {
      const cont = document.getElementById("ce-assoc");
      const codes = [...new Set([...d.grille.filter(Boolean), ...this.texteEnAjouts(d.ajouts).flatMap(a => a.canaux), ...d.associations.flatMap(a => Object.keys(a.points))])];
      cont.innerHTML = d.associations.map((a, i) => `<div class="circ-assoc-ligne" data-i="${i}">
        <label>Tableau<input type="text" list="ce-synd-noms" data-champ="tableau" value="${escapeHtml(a.tableau)}" placeholder="nom d'un syndrome de ta base, ou ton intitulé"></label>
        <div class="circ-assoc-pts">${codes.map(k => `<label>${escapeHtml(k)}<input type="text" data-pt="${escapeHtml(k)}" value="${escapeHtml(a.points[k] || "")}" placeholder="P7, P9"></label>`).join("")}</div>
        <label>Note<input type="text" data-champ="note" value="${escapeHtml(a.note || "")}"></label>
        <button type="button" class="edit-toggle-btn" data-suppr="${i}">Retirer cette association</button></div>`).join("") || `<p class="muted">Aucune association.</p>`;
      cont.querySelectorAll(".circ-assoc-ligne").forEach(l => {
        const a = d.associations[+l.dataset.i];
        l.querySelectorAll("input").forEach(inp => inp.addEventListener("input", () => { if (inp.dataset.pt) a.points[inp.dataset.pt] = inp.value; else a[inp.dataset.champ] = inp.value; }));
        l.querySelector("[data-suppr]").addEventListener("click", () => { d.associations.splice(+l.dataset.i, 1); assoc(); });
      });
    };
    document.getElementById("ce-assoc-add").addEventListener("click", () => { d.associations.push({ tableau: "", note: "", points: {} }); assoc(); });
    document.getElementById("ce-ajouts").addEventListener("change", () => { lire(); assoc(); });
    zone.querySelectorAll("select, input[name=circ-fig]").forEach(el => el.addEventListener("change", apercu));
    document.getElementById("ce-nom").addEventListener("input", lire);
    apercu();
    const puces = () => {
      const el = document.getElementById("ce-lies");
      el.innerHTML = d.syndromes_lies.map(k => { const e = this.entreeSynd(k); return `<span class="chosen-item">${escapeHtml(e ? e.nom : k)}<button type="button" data-k="${escapeHtml(k)}" aria-label="Retirer">✕</button></span>`; }).join("") || `<span class="muted">Aucun.</span>`;
      el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { d.syndromes_lies = d.syndromes_lies.filter(x => x !== b.dataset.k); puces(); }));
    };
    puces();
    document.getElementById("ce-synd-search").addEventListener("input", ev => {
      const ul = document.getElementById("ce-synd-sugg"), q = dsNorm(ev.target.value.trim());
      if (!q) { ul.innerHTML = ""; return; }
      const l = (Syndromes.entries || []).filter(e => !d.syndromes_lies.includes(this.cleSynd(e)) && q.split(/\s+/).every(m => dsNorm(e.nom + " " + e.sousLabel).includes(m))).slice(0, 12);
      ul.innerHTML = l.map(e => `<li data-k="${escapeHtml(this.cleSynd(e))}"><strong>${escapeHtml(e.nom)}</strong> <span class="muted">${escapeHtml((Syndromes.domaineLabels || {})[e.domaine] || "")}${e.sousLabel ? " · " + escapeHtml(e.sousLabel) : ""}</span></li>`).join("") || `<li class="muted">Aucun résultat.</li>`;
      ul.querySelectorAll("li[data-k]").forEach(li => li.addEventListener("click", () => { d.syndromes_lies.push(li.dataset.k); document.getElementById("ce-synd-search").value = ""; ul.innerHTML = ""; puces(); }));
    });
    const pf = () => {
      const el = document.getElementById("ce-form-lies");
      el.innerHTML = d.formules.map(id => { const n = this.nomFormule(id); return `<span class="chosen-item">${escapeHtml(n ? n.nom : id)}<button type="button" data-k="${escapeHtml(id)}" aria-label="Retirer">✕</button></span>`; }).join("") || `<span class="muted">Aucune.</span>`;
      el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { d.formules = d.formules.filter(x => x !== b.dataset.k); pf(); }));
    };
    pf();
    document.getElementById("ce-form-note").addEventListener("input", ev => { d.formules_note = ev.target.value; });
    document.getElementById("ce-form-search").addEventListener("input", ev => {
      const ul = document.getElementById("ce-form-sugg"), q = dsNorm(ev.target.value.trim());
      if (!q) { ul.innerHTML = ""; return; }
      const tout = [...(Formules.index || []).map(f => ({ id: f.id, nom: f.pinyin, fr: f.nom_fr || "" })), ...(Formules.variations || []).map(v => ({ id: v.id, nom: v.nom, fr: "variation" }))];
      const l = tout.filter(x => !d.formules.includes(x.id) && q.split(/\s+/).every(m => dsNorm(x.nom + " " + x.fr).includes(m))).slice(0, 12);
      ul.innerHTML = l.map(x => `<li data-k="${escapeHtml(x.id)}"><strong>${escapeHtml(x.nom)}</strong> <span class="muted">${escapeHtml(x.fr)}</span></li>`).join("") || `<li class="muted">Aucun résultat.</li>`;
      ul.querySelectorAll("li[data-k]").forEach(li => li.addEventListener("click", () => { d.formules.push(li.dataset.k); document.getElementById("ce-form-search").value = ""; ul.innerHTML = ""; pf(); }));
    });
    document.getElementById("ce-annuler").addEventListener("click", () => { this.edition = null; if (d.nouveau) { this.actif = null; this.rendreListe(); } this.rendreFiche(); });
    document.getElementById("circ-form").addEventListener("submit", ev => { ev.preventDefault(); lire(); this.sauver(c); });
  },

  async sauver(c) {
    const d = this.edition, statut = document.getElementById("ce-statut");
    const g = d.grille;
    if (!d.nom.trim()) { statut.textContent = "Le nom du circuit est obligatoire."; return; }
    if (!g.every(Boolean) || new Set(g).size !== 4) { statut.textContent = "Choisis 4 canaux différents."; return; }
    const champs = { nom: d.nom.trim(), alias: this.lignes(d.alias), grille: [...g], figure: +d.figure, syndromes: this.lignes(d.syndromes), actions: this.lignes(d.actions),
                     ...this.texteEnIndications(d.indications), ajouts: this.texteEnAjouts(d.ajouts, c.ajouts), notes: this.lignes(d.notes), syndromes_lies: [...d.syndromes_lies], niveaux: this.lignes(d.niveaux),
                     associations: (d.associations || []).map(a => {
                       const nom = dsNorm((a.tableau || "").trim()), e = (Syndromes.entries || []).find(x => dsNorm(x.nom) === nom);
                       const o = { tableau: (a.tableau || "").trim(), points: Object.fromEntries(Object.entries(a.points || {}).map(([k, v]) => [k, String(v).split(/[,;]\s*/).map(x => x.trim()).filter(Boolean)]).filter(([, v]) => v.length)), note: (a.note || "").trim() };
                       if (e) o.synd = this.cleSynd(e); else if (a.synd && this.entreeSynd(a.synd) && dsNorm(this.entreeSynd(a.synd).nom) === nom) o.synd = a.synd;
                       return o;
                     }).filter(a => a.tableau && Object.keys(a.points).length),
                     formules: [...(d.formules || [])], formules_note: (d.formules_note || "").trim() };
    let id = c.id;
    if (d.nouveau) {
      id = "perso_" + dsNorm(champs.nom).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) + "_" + Date.now().toString(36);
      this.perso.circuits.push({ id, ...champs });
    } else if (c.origine === "perso") {
      const i = this.perso.circuits.findIndex(x => x.id === c.id);
      this.perso.circuits[i] = { id: c.id, ...champs };
    } else {
      const defaut = { alias: [], syndromes: [], actions: [], indications: [], indications_groupes: [], ajouts: [], notes: [], syndromes_lies: [], niveaux: [], associations: [], formules: [], formules_note: "" };
      const diff = {};
      Object.keys(champs).forEach(k => { const ref = c.de_base[k] !== undefined ? c.de_base[k] : defaut[k]; if (JSON.stringify(champs[k]) !== JSON.stringify(ref)) diff[k] = champs[k]; });
      if (Object.keys(diff).length) this.perso.surcharges[c.id] = diff; else delete this.perso.surcharges[c.id];
    }
    statut.textContent = "Enregistrement…";
    try { await Store.writeJSON(this.CHEMIN_PERSO, { titre: this.perso.titre, circuits: this.perso.circuits, surcharges: this.perso.surcharges }); }
    catch (e) { statut.textContent = "Enregistrement impossible : " + e.message; return; }
    this.recomposer();
    this.edition = null;
    this.actif = id;
    this.rendrePuces(); this.rendreListe(); this.rendreFiche();
  },

  async supprimer(c) {
    if (!confirm("Supprimer le circuit « " + this.nomCourt(c) + " » ? Cette action est définitive.")) return;
    this.perso.circuits = this.perso.circuits.filter(x => x.id !== c.id);
    try { await Store.writeJSON(this.CHEMIN_PERSO, { titre: this.perso.titre, circuits: this.perso.circuits, surcharges: this.perso.surcharges }); } catch (e) { alert("Suppression impossible : " + e.message); return; }
    this.recomposer(); this.actif = null; this.rendrePuces(); this.rendreListe(); this.rendreFiche();
  },

  async retablir(c) {
    if (!confirm("Revenir à la version du cours pour « " + this.nomCourt(c) + " » ? Tes modifications de cette fiche seront perdues.")) return;
    delete this.perso.surcharges[c.id];
    try { await Store.writeJSON(this.CHEMIN_PERSO, { titre: this.perso.titre, circuits: this.perso.circuits, surcharges: this.perso.surcharges }); } catch (e) { alert("Impossible : " + e.message); return; }
    this.recomposer(); this.rendreListe(); this.rendreFiche();
  }
};

/* ============================= Proposer : face « circuits » =============================
   À partir des syndromes du diagnostic (et des canaux que tu ajoutes à la main), l'outil repère les canaux impliqués à rééquilibrer
   et classe les circuits qui en couvrent le plus (méthode de l'équilibre global : le circuit doit inclure au moins deux des plaintes). */
const CircuitsProposition = {
  extra: new Set(),       // canaux ajoutés à la main
  exclus: new Set(),      // canaux déduits du diagnostic mais écartés

  impliques() {
    const prov = new Map();       // code -> noms des syndromes qui l'impliquent
    (Proposer.diag || []).forEach(c => {
      const sd = Proposer.sd(c);
      if (!sd) return;
      Circuits.canauxDeSyndrome(sd.entry).forEach(k => { if (!prov.has(k)) prov.set(k, []); prov.get(k).push(Proposer.nomDiag(c)); });
    });
    return prov;
  },

  classer(choix, prov) {
    const mots = Proposer.jetons((Proposer.diag || []).map(c => Proposer.nomDiag(c)).join(" "));
    const res = [];
    Circuits.liste.forEach(c => {
      const inter = c.grille.filter(k => choix.has(k));
      if (!inter.length) return;
      const extras = c.grille.filter(k => !choix.has(k));
      const lien = (c.syndromes_lies || []).some(k => (Proposer.diag || []).some(d => String(d).split("#")[0] === k));
      const jt = Proposer.jetons([...c.indications, ...c.actions].join(" "));
      const commun = [...mots].filter(t => jt.has(t));
      const texte = mots.size ? commun.length / mots.size : 0;
      const astuces = (Circuits.base.astuces || []).filter(a => a.paires.some(p => p.every(k => c.grille.includes(k)) && p.some(k => choix.has(k))));
      const score = 100 * inter.length / choix.size + 5 * inter.length - 2 * extras.length + (lien ? 60 : 0) + 20 * texte + 4 * astuces.length;
      res.push({ c, inter, extras, lien, commun, astuces, score });
    });
    res.sort((a, b) => b.score - a.score);
    return res.slice(0, 8);
  },

  async rendre(zone) {
    try { await Circuits.ensureLoaded(); } catch (e) { zone.innerHTML = `<p class="muted">Circuits indisponibles (${escapeHtml(e.message)}).</p>`; return; }
    const prov = this.impliques();
    const choix = new Set([...prov.keys(), ...this.extra]);
    this.exclus.forEach(k => choix.delete(k));
    const puces = Circuits.base.canaux.map(k => {
      const actif = choix.has(k.code), deduit = prov.has(k.code);
      return `<button type="button" class="cat-chip${actif ? " active" : ""}" data-k="${k.code}" title="${escapeHtml(k.nom + " — " + k.canal + (deduit ? " · déduit du diagnostic : " + [...new Set(prov.get(k.code))].join(", ") : ""))}">${k.code}</button>`;
    }).join("");
    let html = `<div class="prop-bloc"><strong>Canaux impliqués à rééquilibrer</strong> <span class="muted">${prov.size ? "déduits des syndromes du diagnostic" : "aucun syndrome d'organe, de canal ou de niveau dans le diagnostic"} ; clique pour ajouter ou retirer un canal</span><div class="cat-chip-row circ-puces">${puces}</div></div>`;
    if (!choix.size) {
      zone.innerHTML = html + `<p class="muted">Choisis un diagnostic (un syndrome d'organe, de canal ou de niveau) ou des canaux ci-dessus pour obtenir des circuits.</p>`;
      this.brancher(zone);
      return;
    }
    const classement = this.classer(choix, prov);
    html += `<p class="muted prop-avert">Aide à la réflexion et à la révision, pas une prescription. Méthode de l'équilibre global : le circuit doit inclure au moins deux des trois plaintes majeures du patient. ${escapeHtml(Circuits.base.regles.changer || "")}</p>`;
    if (!classement.length) html += `<p class="muted">Aucun circuit de ta base ne couvre au moins deux de ces canaux.</p>`;
    html += classement.map(r => this.carte(r, choix, prov)).join("");
    zone.innerHTML = html;
    this.brancher(zone);
  },

  carte(r, choix, prov) {
    const c = r.c, n = choix.size;
    const raisons = [`<span class="prop-raison">couvre ${r.inter.length} / ${n} canal(aux) impliqué(s) : ${r.inter.map(k => escapeHtml(k)).join(", ")}</span>`];
    if (n >= 2 && r.inter.length < 2) raisons.push(`<span class="prop-raison">couvre un seul des canaux impliqués : couverture partielle</span>`);
    if (r.extras.length) raisons.push(`<span class="prop-raison">ajoute pour fermer la boucle : ${r.extras.map(k => escapeHtml(k)).join(", ")}</span>`);
    if (r.lien) raisons.push(`<span class="prop-raison">rattaché à ce syndrome dans ta base</span>`);
    if (r.commun.length) raisons.push(`<span class="prop-raison">indications proches : ${escapeHtml(r.commun.slice(0, 6).join(", "))}</span>`);
    const synd = r.inter.map(k => `${k} ← ${[...new Set(prov.get(k) || [])].join(", ") || "canal ajouté"}`).join(" · ");
    return `<article class="prop-carte circ-prop">
      <div class="circ-prop-dessin">${Circuits.dessin(c, { taille: 120, etiquettes: true, surligne: choix })}</div>
      <div class="circ-prop-corps">
        <header><strong class="prop-nom">${escapeHtml(Circuits.nomCourt(c))}</strong> <span class="muted">${c.grille.join(" · ")}</span></header>
        <div class="prop-raisons">${raisons.join("")}</div>
        ${synd ? `<p class="muted">${escapeHtml(synd)}</p>` : ""}
        ${c.indications.length ? `<p class="circ-prop-ind"><span class="cm-etiq">Indications</span> ${escapeHtml(sansHanzi(c.indications.slice(0, 2).join(" · ")))}</p>` : ""}
        ${(c.associations || []).filter(a => a.synd && (Proposer.diag || []).some(d => String(d).split("#")[0] === a.synd)).map(a => `<p class="circ-prop-ass"><span class="cm-etiq">Association de points</span> ${escapeHtml(sansHanzi(a.tableau))} : ${Object.entries(a.points || {}).map(([k, v]) => `<span class="sx-code">${escapeHtml(k)}</span> ${escapeHtml(v.join(", "))}`).join(" · ")}</p>`).join("")}
        ${r.astuces.map(a => `<p class="circ-prop-ast"><span class="cm-etiq">Astuce du Dr Tán Té Fū</span> ${escapeHtml(sansHanzi(a.texte))}</p>`).join("")}
        ${(c.formules || []).length ? `<p class="circ-prop-ast"><span class="cm-etiq">Formule équivalente</span> ${c.formules.map(id => { const n = Circuits.nomFormule(id); return `<button type="button" class="edit-toggle-btn" data-form="${escapeHtml(id)}">${escapeHtml(n ? n.nom : id)}</button>`; }).join(" ")}</p>` : ""}
        <footer><button type="button" class="edit-toggle-btn" data-circ="${escapeHtml(c.id)}">Fiche du circuit</button></footer>
      </div></article>`;
  },

  brancher(zone) {
    zone.querySelectorAll(".circ-puces [data-k]").forEach(b => b.addEventListener("click", () => {
      const k = b.dataset.k, prov = this.impliques();
      if (prov.has(k)) { if (this.exclus.has(k)) this.exclus.delete(k); else this.exclus.add(k); }
      else if (this.extra.has(k)) this.extra.delete(k); else this.extra.add(k);
      this.rendre(zone);
    }));
    zone.querySelectorAll("[data-circ]").forEach(b => b.addEventListener("click", async () => {
      document.querySelector('.tab-btn[data-tab="circuits"]').click();
      await Circuits.ouvert();
      Circuits.filtre = null; Circuits.recherche = ""; document.getElementById("circuit-search").value = "";
      Circuits.rendrePuces(); Circuits.afficher(b.dataset.circ);
    }));
  },

  // bascule Formules / Circuits dans l'onglet « Proposer une formule »
  init() {
    Proposer.vue = "formules";
    const section = document.getElementById("tab-proposer");
    const rendreFormules = Proposer.rendre;
    Proposer.rendre = function (...a) {
      if (this.vue === "circuits") return CircuitsProposition.rendre(document.getElementById("prop-res"));
      return rendreFormules.apply(this, a);
    };
    const carte = Proposer.carte;
    Proposer.carte = function (...a) {
      const h = carte.apply(this, a), r = a[0], id = r.v ? r.v.id : r.f.id;
      const eq = Circuits.liste.filter(c => (c.formules || []).includes(id));
      if (!eq.length) return h;
      const bloc = `<p class="circ-prop-ast"><span class="cm-etiq">Circuit équivalent</span> ${eq.map(c => `<button type="button" class="edit-toggle-btn" data-circ-fiche="${escapeHtml(c.id)}">${escapeHtml(Circuits.nomCourt(c))} <span class="muted">${c.grille.join(" · ")}</span></button>`).join(" ")}</p>`;
      return /<\/article>\s*$/.test(h) ? h.replace(/<\/article>\s*$/, bloc + "</article>") : h + bloc;
    };
    section.querySelectorAll(".prop-vues [data-vue]").forEach(b => b.addEventListener("click", () => {
      Proposer.vue = b.dataset.vue;
      section.dataset.vue = Proposer.vue;
      section.querySelectorAll(".prop-vues [data-vue]").forEach(x => x.classList.toggle("active", x === b));
      Proposer.ouvert();
    }));
  }
};

Circuits.init();
CircuitsProposition.init();
