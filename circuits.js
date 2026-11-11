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
  CHEMIN_WJY: "acupuncture/circuits/wang_ju_yi.json",                   // tes notes « Recettes de Wang Ju Yi »
  wjy: null,
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
  LIENS: { 1: ["H", "D"], 2: ["V", "D"], 3: ["H", "V"], 4: ["H", "V", "D"] },
  // les quatre schémas d'interrelation du yīn yáng ; chacun est la conséquence des connexions réelles entre les quatre canaux (tableau des systèmes), jamais un choix libre
  NOM_SCHEMA: { 1: "sablier", 2: "papillon", 3: "carré", 4: "enveloppe" },
  DESC_SCHEMA: { 1: "horizontales + diagonales", 2: "verticales + diagonales", 3: "horizontales + verticales", 4: "horizontales + verticales + diagonales" },
  // paires de positions reliées (parmi les 6 possibles) selon les connexions entre canaux
  liensReels(g) {
    return Object.values(this.PAIRES).flat().filter(([a, b]) => (this.SYSTEMES[g[a]] || []).includes(g[b]));
  },
  // schéma = types de liens (horizontal, vertical, diagonal) dont les DEUX paires sont reliées ; null si cela ne donne aucun des quatre schémas
  figureDe(g) {
    if (!g || g.length !== 4 || !g.every(Boolean)) return null;
    const ok = t => this.PAIRES[t].every(([a, b]) => (this.SYSTEMES[g[a]] || []).includes(g[b]));
    const H = ok("H"), V = ok("V"), D = ok("D");
    if (H && V && D) return 4;
    if (H && D) return 1;
    if (V && D) return 2;
    if (H && V) return 3;
    return null;
  },
  PAIRES: { H: [[0, 1], [2, 3]], V: [[0, 2], [1, 3]], D: [[0, 3], [1, 2]] },
  // RM et DM : l'axe du corps ; ils ne comptent pas parmi les quatre canaux du circuit mais s'associent à n'importe lequel
  AXE: ["RM", "DM"],
  NOM_AXE: { RM: "Rèn mài (axe antérieur)", DM: "Dū mài (axe postérieur)", VX: "Points des 8 merveilleux vaisseaux ouverts, hors des canaux du circuit" },
  nomCanalOuAxe(k) { return (this.canaux.get(k) || {}).nom || this.NOM_AXE[k] || ""; },
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
        try { this.wjy = await Store.readJSON(this.CHEMIN_WJY); } catch (e) { /* pas de recettes */ }
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
    this.liste.forEach(x => { x.figure = this.figureDe(x.grille) || 3; });        // le schéma découle des connexions entre les canaux
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
    const taille = o.taille || 120, fig = this.LIENS[c.figure] ? c.figure : 3;
    const pos = this.POSITIONS, g = c.grille || [], pts = o.points || null, marge = 0;
    const rayon = pts ? 24 : 16;
    const police = `font-family="var(--font-body, sans-serif)"`;
    const paires = (g.length === 4 && g.every(Boolean)) ? this.liensReels(g) : this.LIENS[fig].flatMap(t => this.PAIRES[t]);
    const traits = paires.map(([a, b]) => `<line x1="${pos[a][0]}" y1="${pos[a][1]}" x2="${pos[b][0]}" y2="${pos[b][1]}" stroke="var(--ink)" stroke-width="3.2" stroke-linecap="round"/>`).join("");
    const rond = (x, y, r, code, o2 = {}) => {
      const yin = this.polarite(code) === "yin", col = code ? this.couleurCanal(code) : "var(--ink)";
      const lib = o2.etiquette && code && !o2.sansNom ? `<text x="${x}" y="${y + (r > 12 ? 4.5 : 3)}" text-anchor="middle" font-size="${r > 12 ? (code.length > 1 ? 12 : 14) : 8}" font-weight="700" ${police} fill="${this.texteRond(code)}">${escapeHtml(code)}</text>` : "";
      const fond = code ? (yin ? col : "var(--bg)") : (yin ? "var(--ink)" : "var(--bg)");
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fond}" stroke="${col}" stroke-width="${o2.pointille ? 2.5 : 3}"${o2.pointille ? ` stroke-dasharray="3.5 2.5"` : ""}><title>${escapeHtml((this.canaux.get(code) || {}).nom || code)}</title></circle>${lib}`;
    };
    // points dans un rond : pastilles empilées (4 au plus ; au-delà, « +n »), colorées selon le mouvement du point
    const contenu = (code, x, y, r) => {
      const liste = [...new Set(((pts && pts[code]) || []).map(t => this.clePoint(t)).filter(Boolean))], max = r < 20 ? 3 : 4;
      const aff = liste.length > max ? [...liste.slice(0, max - 1), "+" + (liste.length - max + 1)] : liste;
      const hP = 8.4, ec = 1.4, tot = aff.length * hP + Math.max(0, aff.length - 1) * ec, yin = this.polarite(code) === "yin";
      const code_ = aff.length <= (r < 20 ? 2 : 3) && code ? `<text x="${x}" y="${y - r + 8.5}" text-anchor="middle" font-size="6.4" font-weight="700" ${police} fill="${this.texteRond(code)}" opacity="0.9">${escapeHtml(code)}</text>` : "";
      const y0 = aff.length <= (r < 20 ? 2 : 3) ? y - tot / 2 + 4.5 : y - tot / 2;
      const pil = aff.map((t, k) => {
        const mv = this._mouv ? this._mouv.get(this.cleP(t)) : "", fond = mv ? this.COULEUR_MOUV[mv] : "var(--bg)", w = Math.max(14, t.length * 4.2 + 5);
        return `<g><title>${escapeHtml(t + (mv ? " — " + this.NOM_MOUV[mv] : ""))}</title><rect x="${x - w / 2}" y="${y0 + k * (hP + ec)}" width="${w}" height="${hP}" rx="2.2" fill="${fond}" stroke="#1d1d1b" stroke-width="0.6"/>` +
          `<text x="${x}" y="${y0 + k * (hP + ec) + 6.4}" text-anchor="middle" font-size="6.6" font-weight="700" ${police} fill="${mv === "eau" ? "#FFFFFF" : "#1d1d1b"}">${escapeHtml(t)}</text></g>`;
      }).join("");
      return code_ + pil;
    };
    const ronds = pos.map(([x, y], i) => {
      const code = g[i] || "";
      const anneau = o.surligne && o.surligne.has(code) ? `<circle cx="${x}" cy="${y}" r="21.5" fill="none" stroke="var(--accent)" stroke-width="4"/>` : "";
      if (!pts) return anneau + rond(x, y, rayon, code, { etiquette: o.etiquettes });
      return anneau + rond(x, y, rayon, code, { etiquette: false, sansNom: true }) + contenu(code, x, y, rayon);
    }).join("");
    // points d'acupuncture : au-dessus des ronds du haut, au-dessous de ceux du bas
    const etiq = pts && false ? pos.map(([x, y], i) => {
      const l = this.lignesPoints(pts[g[i]]);
      if (!l.length) return "";
      const y0 = i < 2 ? y - 22 - (l.length - 1) * 8.5 : y + 29;
      return l.map((t, k) => `<text x="${x}" y="${y0 + k * 8.5}" text-anchor="middle" font-size="7.8" font-weight="700" ${police} fill="var(--ink)">${escapeHtml(t)}</text>`).join("");
    }).join("") : "";
    // points de l'axe (RM, DM) : une ligne chacun sous la figure
    const axe = pts ? this.AXE.filter(k => (pts[k] || []).length) : [];
    const axeH = axe.length ? axe.length * 10 + 6 : 0;
    const axeSvg = axe.map((k, i) => `<text x="60" y="${120 + marge + 4 + i * 10}" text-anchor="middle" font-size="7.8" font-weight="700" ${police} fill="var(--ink)">${k} : ${escapeHtml(this.lignesPoints(pts[k]).join(" "))}</text>`).join("");
    // ajouts possibles : canaux en pointillé sous la figure, « + » devant, trait entre eux quand ils vont ensemble
    const groupes = o.ajouts ? (c.ajouts || []).filter(a => (a.canaux || []).length) : [];
    const grosse = a => !!pts && a.canaux.some(k => ((pts[k]) || []).length);
    // hauteur d'un groupe d'ajouts : « AJOUT POSSIBLE », les ronds (grosses bulles s'ils portent des points), la légende éventuelle
    const hGroupe = a => grosse(a) ? (a.action ? 69 : 55) : (a.action ? 60 : 48);
    const hautGroupe = k => 122 + marge + axeH + groupes.slice(0, k).reduce((s, a) => s + hGroupe(a), 0);
    const yGroupe = k => hautGroupe(k) + 8 + (grosse(groupes[k]) ? 23 : 17);
    const espGroupe = a => grosse(a) ? 40 : 30;
    // largeur : les groupes de grosses bulles (3 canaux par exemple) dépassent les 120 de la figure
    const debGroupe = a => 60 - (a.canaux.length - 1) * espGroupe(a) / 2 - (grosse(a) ? 36 : 28), finGroupe = a => 60 + (a.canaux.length - 1) * espGroupe(a) / 2 + (grosse(a) ? 22 : 14);
    const debord = groupes.reduce((m, a) => Math.max(m, -debGroupe(a), finGroupe(a) - 120), 0);
    const aj = groupes.map((a, k) => {
      const n = a.canaux.length, big = grosse(a), esp = espGroupe(a), cy = yGroupe(k), x0 = 60 - (n - 1) * esp / 2;
      const lien = n > 1 ? a.canaux.slice(1).map((_, j) => a.ensemble
        ? `<line x1="${x0 + j * esp}" y1="${cy}" x2="${x0 + (j + 1) * esp}" y2="${cy}" stroke="var(--ink)" stroke-width="2"/>`
        : `<text x="${x0 + j * esp + esp / 2}" y="${cy + 3}" text-anchor="middle" font-size="7" ${police} fill="var(--ink)">ou</text>`).join("") : "";
      const noeuds = a.canaux.map((code, j) => {
        const x = x0 + j * esp;
        if (!big) return rond(x, cy, 11, code, { etiquette: true, pointille: true });
        return rond(x, cy, 18, code, { etiquette: false, sansNom: true, pointille: true }) + (((pts[code]) || []).length ? contenu(code, x, cy, 18) : `<text x="${x}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="700" ${police} fill="${this.texteRond(code)}">${escapeHtml(code)}</text>`);
      }).join("");
      const legende = sansHanzi(a.action || "").slice(0, 34);
      const marque = `<text x="60" y="${cy - (big ? 23 : 17)}" text-anchor="middle" font-size="6.6" font-weight="700" letter-spacing="0.6" ${police} fill="var(--ink)">AJOUT POSSIBLE</text>`;
      return `${marque}${lien}${noeuds}<text x="${x0 - (big ? 28 : 22)}" y="${cy + 5}" text-anchor="middle" font-size="15" font-weight="700" ${police} fill="var(--ink)">+</text>` +
        (legende ? `<text x="60" y="${cy + (big ? 31 : 25)}" text-anchor="middle" font-size="7" ${police} fill="var(--ink)" opacity="0.8">${escapeHtml(legende)}</text>` : "");
    }).join("");
    const cote = "";                                   // pas de mention « main » / « pied » : ça va de soi
    const L = 120, H = 120 + marge * 2 + axeH + (groupes.length ? 2 + groupes.reduce((s, a) => s + hGroupe(a), 0) + 4 : 0);
    const px = Math.max(pts ? 4 : 0, Math.ceil(debord));                                // marge de chaque côté quand des points sont écrits : les noms longs (TF5 TF10 TF23…) ne sont jamais coupés
    return `<svg class="circ-svg" viewBox="${-px} ${-marge} ${L + 2 * px} ${H}" width="${Math.round(taille * (L + 2 * px) / L)}" height="${Math.round(taille * H / L)}" role="img" aria-label="Circuit ${escapeHtml(g.join(", "))}${this.NOM_SCHEMA[this.figureDe(g)] ? " (schéma " + this.NOM_SCHEMA[this.figureDe(g)] + ")" : ""}">${traits}${ronds}${etiq}${axeSvg}${cote}${aj}</svg>`;
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
  ouvrirSyndrome(e) { return Onglets.ouvrirSyndrome(e); },          // s'ouvre dans un nouvel onglet : le circuit reste en place

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

  afficher(id) { this.actif = id; this.edition = null; this.rendreListe(); this.rendreFiche(); if (typeof Onglets !== "undefined") { Onglets.rendreBarre(); Onglets.memoriser(); } },

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

  // fiche d'un circuit en onglets (le bandeau reste visible en haut de l'écran)
  ONGLETS_FICHE: ["Indications", "Points", "Tableaux et réseau", "Syndromes et formules"],
  get ongletFiche() { if (this._ongletFiche == null) { let v = 0; try { v = +localStorage.getItem("circ-onglet-fiche") || 0; } catch (e) { /* stockage indisponible */ } this._ongletFiche = v >= 0 && v < this.ONGLETS_FICHE.length ? v : 0; } return this._ongletFiche; },
  onglet(i, html) { return `<div class="circ-onglet" data-o="${i}"${i === this.ongletFiche ? "" : " hidden"}>${html}</div>`; },
  choisirOnglet(i) {
    this._ongletFiche = i;
    try { localStorage.setItem("circ-onglet-fiche", String(i)); } catch (e) { /* stockage indisponible */ }
    const zone = document.getElementById("circuit-detail");
    zone.querySelectorAll(".circ-onglet").forEach(d => { d.hidden = +d.dataset.o !== i; });
    zone.querySelectorAll(".circ-onglet-btn").forEach(b => b.classList.toggle("actif", +b.dataset.o === i));
    if (i === 2) this.tracerGraphe();                                       // le graphe se trace quand son onglet est visible
    window.scrollTo({ top: 0 });
  },

  rendreFiche() {
    const zone = document.getElementById("circuit-detail"), c = this.parId(this.actif);
    document.getElementById("tab-circuits").classList.toggle("fiche-seule", !!c);          // fiche ouverte : la liste disparaît (on choisit un autre circuit avec le ☰ de la barre fixe)
    if (!c) { zone.innerHTML = `<p class="muted">Sélectionne un circuit à gauche pour voir sa fiche.</p>`; return; }
    if (this.edition) { this.rendreEdition(c); return; }
        const niveaux = (c.niveaux || []).map(x => {
      const n = dsNorm(sansChinois(x));
      const co = (this.base.niveaux || []).find(y => n.includes(dsNorm(y.nom)));
      return co ? `<details class="circ-niveau"><summary>Fonctions de ${escapeHtml(co.nom)} <span class="muted">(cours p. ${co.page})</span></summary>${this.ul(co.fonctions)}</details>` : "";
    }).join("");
    const astuces = (this.base.astuces || []).filter(a => a.paires.some(p => p.every(k => c.grille.includes(k)))).map(a => `<li>${escapeHtml(sansHanzi(a.texte))}</li>`).join("");
    const ajouts = (c.ajouts || []).map(a => {
      const prop = a.source && /^proposition/.test(a.source), txt = sansHanzi(a.texte || "");
      const liens = (a.canaux || []).map(k => c.grille.filter(g => (this.SYSTEMES[k] || []).includes(g)));
      const fleches = (a.canaux || []).map((k, i) => `<span class="sx-code" title="${escapeHtml(txt)}">${escapeHtml(k)}</span>${liens[i].length ? ` <span class="circ-fleche" title="Connecté à ces canaux du circuit (6 systèmes)">→ ${liens[i].map(escapeHtml).join(" · ")}</span>` : ""}`).join(" ");
      const libre = !prop && txt ? ` <span class="muted">${escapeHtml(txt)}</span>` : "";
      const tag = prop && !/vérifié/.test(a.source) ? ` <span class="circ-pt-tag" title="Proposition à confirmer ou supprimer">à valider</span>` : (a.source && /correction/.test(a.source) ? ` <span class="muted" title="Selon ta correction">✓</span>` : "");
      return `<li>${a.action ? escapeHtml(sansHanzi(a.action)) + " : " : ""}${fleches}${libre}${tag}</li>`;
    }).join("");
    const lies = (c.syndromes_lies || []).map(k => { const e = this.entreeSynd(k); return e ? `<button type="button" class="edit-toggle-btn" data-synd="${escapeHtml(k)}">${escapeHtml(sansHanzi(e.nom))}</button>` : `<span class="muted">${escapeHtml(k)} (introuvable)</span>`; }).join(" ");
    const parCanal = c.grille.map(code => {
      const l = this.syndromesDuCanal(code);
      if (!l.length) return "";
      return `<details class="circ-synd"><summary><span class="sx-code">${code}</span> ${escapeHtml((this.canaux.get(code) || {}).nom || "")} <span class="muted">(${l.length})</span></summary><div class="circ-synd-liste">${l.map(e => `<button type="button" class="edit-toggle-btn" data-synd="${escapeHtml(this.cleSynd(e))}">${escapeHtml(sansHanzi(e.nom))}</button>`).join(" ")}</div></details>`;
    }).join("");
    zone.innerHTML = `
      <div class="circ-barre barre-flottante">
        <button type="button" class="edit-toggle-btn" id="circ-edit" title="Modifier cette fiche" aria-label="Modifier cette fiche">✏️</button>
        ${c.origine === "perso" ? `<button type="button" class="edit-toggle-btn" id="circ-suppr" title="Supprimer ce circuit" aria-label="Supprimer ce circuit">🗑</button>` : c.modifie ? `<button type="button" class="edit-toggle-btn" id="circ-retablir" title="Revenir à la version du cours" aria-label="Revenir à la version du cours">↺</button>` : ""}
      </div>
      <div class="circ-bandeau">
        <span class="circ-mini-bandeau" aria-hidden="true">${this.dessin(c, { taille: 76, etiquettes: true })}</span>
        <h2>${escapeHtml(sansHanzi(c.nom))}</h2>
        <div class="circ-onglets" role="tablist">${this.ONGLETS_FICHE.map((n, i) => `<button type="button" role="tab" class="circ-onglet-btn${i === this.ongletFiche ? " actif" : ""}" data-o="${i}">${n}</button>`).join("")}</div>
      </div>
      ${this.onglet(0, this.section("Syndromes du circuit", this.ul((c.syndromes || []).map(s => s.replace(/^syndromes? du /i, "du ").replace(/^du /, "Syndromes du ")))) +
        this.section("Actions / fonctions du circuit", this.ul(c.actions)) +
        this.section("Indications", this.indicationsHtml(c)) +
        ((c.notes || []).length ? this.section("Notes", this.ul(c.notes)) : "") +
        (niveaux ? this.section("Niveaux", niveaux) : "") +
        (astuces ? this.section("Astuces du Dr Tán Té Fū (cours, p. 41)", `<ul class="tcm-list">${astuces}</ul>`) : ""))}
      ${this.onglet(1, `<section><h3>Points des canaux</h3><div id="circ-pts" class="circ-pts"></div></section>
        <section><h3>Ajouts possibles</h3>${ajouts ? `<ul class="tcm-list">${ajouts}</ul>` : ""}${this.candidatsAjout(c).length ? `<div class="circ-barre"><button type="button" class="edit-toggle-btn" id="circ-aj-prop">💡 Proposer des canaux à ajouter</button></div>` : ""}<div id="circ-aj-zone"></div></section>
        <section><h3>Points Tung compatibles</h3><div id="circ-tung" class="circ-tung"><p class="muted">Chargement…</p></div></section>`)}
      ${this.onglet(2, `<div class="circ-haut"><div class="circ-grand" id="circ-dessin">${this.dessin(c, { taille: 230, etiquettes: true, legende: true, ajouts: true })}</div></div>` +
        this.section("Associations de points", this.assocTableHtml(c) + this.wjyChipsHtml(c) + `<div id="circ-assoc-detail" class="circ-assoc-detail"></div>`) +
        this.section("Comparaison des associations et des ajouts", this.graphe(c)))}
      ${this.onglet(3, `<section><h3>Syndromes de ta base rattachés à ce circuit</h3>${lies ? `<div class="circ-synd-liste">${lies}</div>` : ""}</section>` +
        this.section("Formule de pharmacopée équivalente", this.equivalent(c)) +
        `<section><h3>Syndromes de ta base portant sur ces canaux</h3>${parCanal}</section>`)}`;
    zone.querySelectorAll(".circ-onglet-btn").forEach(b => b.addEventListener("click", () => this.choisirOnglet(+b.dataset.o)));
    zone.querySelectorAll("[data-synd]").forEach(b => b.addEventListener("click", () => { const e = this.entreeSynd(b.dataset.synd); if (e) this.ouvrirSyndrome(e); }));
    this.assocActive = null;
    zone.querySelectorAll(".circ-ass-ligne").forEach(r => r.addEventListener("click", ev => {
      if (ev.target.closest("[data-reseau], a")) return;
      const k = r.dataset.k, v = k[0] === "w" ? k : +k.slice(1);
      this.assocActive = this.assocActive === v ? null : v;
      this.majAssoc(c);
    }));
    this.majAssoc(c);
    if (this.ongletFiche === 2) this.tracerGraphe();
    this.brancherNotes(zone);
    this.pointsTung(c);
    this.rendrePoints(c);
    if (!this._mouvPret) this.chargerInter().then(() => { if (this.actif === c.id && document.getElementById("circ-dessin")) this.majAssoc(c); });
    this.crayonsChamps(zone, c);
    this.annoterCroisements(zone);
    const ajp = document.getElementById("circ-aj-prop"); if (ajp) ajp.addEventListener("click", () => this.proposerAjouts(c));
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

  // ---------- recettes de Wang Ju Yi (tes notes) : intégrées là où les canaux des points sont déjà dans le circuit (RM et DM = axe du corps, sans effet sur l'équilibre)
  recettesWjy(c) {
    const res = { liste: [], citees: [] };
    if (!this.wjy) return res;
    const g = new Set(c.grille), aj = new Set((c.ajouts || []).flatMap(a => a.canaux || []));
    this.wjy.recettes.forEach(r => {
      const ks = Object.keys(r.canaux);
      if (ks.every(k => g.has(k))) res.liste.push({ r, ajout: [] });
      else if (ks.every(k => g.has(k) || aj.has(k))) res.liste.push({ r, ajout: ks.filter(k => !g.has(k)) });
      else if ((r.circuits_cites || []).includes(c.id)) res.citees.push({ r, manque: ks.filter(k => !g.has(k)) });
    });
    return res;
  },
  nomRecette(r) { return r.points.join(" – "); },
  recetteHtml(w, sansOk) {
    const r = w.r;
    const notes = (this.wjy.notes_groupes || {})[r.groupe] || [];
    return `<p><strong>${r.points.map(p => this.pointHtml(p)).join(" – ")}</strong> <span class="circ-pt-tag circ-pt-base" title="${escapeHtml(this.wjy.source || "")}">Wang Ju Yi</span> <span class="muted">${escapeHtml(r.groupe)}</span>${r.vaisseaux ? ` <span class="muted">(${escapeHtml(r.vaisseaux)})</span>` : ""}</p>` +
      (w.ajout && w.ajout.length ? `<p class="muted">Utilise ${escapeHtml(w.ajout.join(", "))} : un des ajouts possibles de ce circuit.</p>` : "") +
      (w.manque && w.manque.length ? `<p class="muted">${escapeHtml(w.manque.join(", "))} n'est pas dans ce circuit : non intégrée, à toi de juger.</p>` : "") +
      (sansOk ? "" : `<p><button type="button" class="circ-pt-choisir" data-reseau="${escapeHtml(JSON.stringify(r.points.map(p => ({ point: p, raison: "Wang Ju Yi " + r.points.join(" – ") + (r.puces[0] ? " : " + r.puces[0] : ""), source: "Wang Ju Yi" }))))}" title="Ajouter les points de cette recette au réseau de la patiente" aria-label="Ajouter les points de cette recette au réseau de la patiente">✓</button></p>`) +
      this.ul(r.puces) + (notes.length ? `<p class="muted">${notes.map(escapeHtml).join(" · ")}</p>` : "") +
      ((r.lectures || []).length ? `<p class="muted">Lu autrement que tes notes : ${r.lectures.map(l => `« ${escapeHtml(l.note)} » → ${escapeHtml(l.lu)}`).join(" ; ")} (faute probable dans tes notes).</p>` : "");
  },
  // tableau unique des associations (les tiennes et celles de Wang Ju Yi) : les points, l'indication principale, « WJY » discret, ✓ pour le réseau ; un clic déplie
  assocTableHtml(c) {
    const res = this.recettesWjy(c);
    this._wjyListe = res.liste;
    const ok = lst => `<button type="button" class="circ-pt-choisir" data-reseau="${escapeHtml(JSON.stringify(lst))}" title="Choisir ces points pour le réseau de la patiente" aria-label="Choisir ces points pour le réseau de la patiente">✓</button>`;
    const ligne = (cle, pts, ind, wjy, lst) => `<tr class="circ-ass-ligne" data-k="${cle}"><td class="circ-ass-p">${escapeHtml(pts)}</td><td class="circ-ass-i">${escapeHtml(ind)}</td><td class="circ-ass-s">${wjy ? "WJY" : ""}</td><td class="circ-ass-ok">${ok(lst)}</td></tr>` +
      `<tr class="circ-ass-det" data-k="${cle}" hidden><td colspan="4"></td></tr>`;
    const siennes = (c.associations || []).map((a, i) => {
      const pts = [...new Set(Object.values(a.points || {}).flat().map(p => this.clePoint(p)).filter(Boolean))];
      const lst = Object.entries(a.points || {}).flatMap(([k, v]) => v.map(p => ({ point: this.clePoint(p), canal: k, raison: sansHanzi(a.tableau), source: "ton tableau" })));
      return ligne("a" + i, pts.join(" · "), sansHanzi(a.tableau), false, lst);
    });
    const wjy = res.liste.map((w, i) => ligne("w" + i, this.nomRecette(w.r) + (w.ajout.length ? " +" + w.ajout.join("+") : ""), w.r.puces[0] || w.r.groupe || "", true,
      w.r.points.map(p => ({ point: p, raison: "Wang Ju Yi " + w.r.points.join(" – ") + (w.r.puces[0] ? " : " + w.r.puces[0] : ""), source: "Wang Ju Yi" }))));
    const tout = [...siennes, ...wjy];
    return tout.length ? `<table class="circ-assoc-table"><tbody>${tout.join("")}</tbody></table>` : "";
  },
  wjyChipsHtml(c) {
    const res = this.recettesWjy(c);
    this._wjyListe = res.liste;
    if (!res.liste.length && !res.citees.length) return "";
    const citees = res.citees.length ? `<details class="circ-wjy-citees"><summary>Citées dans tes notes pour ce circuit mais non intégrées (un canal du couple n'y est pas) — ${res.citees.length}</summary>${res.citees.map(w => `<details><summary>${escapeHtml(this.nomRecette(w.r))}</summary>${this.recetteHtml(w)}</details>`).join("")}</details>` : "";
    const regles = (this.wjy.regles_generales || []).length ? `<details class="circ-wjy-citees"><summary>Règles de Wang Ju Yi (tes notes)</summary>${this.ul(this.wjy.regles_generales)}</details>` : "";
    return citees || regles ? `<div class="circ-wjy">${citees}${regles}</div>` : "";
  },

  // petit crayon près du titre d'une rubrique : ouvre le formulaire de modification limité à ce seul champ
  CHAMPS_CIRCUIT: { "syndromes du circuit": "ce-syndromes", "actions / fonctions du circuit": "ce-actions", "indications": "ce-indications", "ajouts possibles": "ce-ajouts",
                    "associations de points": "ce-assoc", "formule de pharmacopee equivalente": "ce-form-lies", "syndromes de ta base rattaches a ce circuit": "ce-lies", "notes": "ce-notes" },
  crayonsChamps(zone, c) {
    zone.querySelectorAll("section > h3").forEach(h => {
      const id = this.CHAMPS_CIRCUIT[dsNorm(h.textContent.replace(/\s*✏️\s*$/, "")).trim()];
      if (!id || h.querySelector(".edit-champ")) return;
      const b = document.createElement("button");
      b.type = "button"; b.className = "edit-champ"; b.textContent = "✏️"; b.title = "Modifier ce champ seul"; b.setAttribute("aria-label", "Modifier ce champ seul");
      b.addEventListener("click", () => { this.modifier(c); this.edition.champ = id; this.rendreFiche(); });
      h.appendChild(b);
    });
  },

  // ---------- canaux à ajouter : le circuit doit garder son équilibre statique ET dynamique (cours « Méthode de l'équilibre global »)
  // statique : le canal ajouté a la même polarité (yīn / yáng) et le même membre (main / pied) qu'un canal du circuit : il se range sur la même place des quatre
  // dynamique : le canal ajouté a au moins deux connexions (une entrée, une sortie) avec les canaux du circuit, selon le tableau des 6 systèmes
  SYSTEMES: {
    P: ["Rt", "V", "GI", "F"], GI: ["E", "F", "P", "Rn"], E: ["GI", "EC", "Rt"], Rt: ["P", "IG", "E", "TF", "C"], C: ["Rn", "VB", "IG", "Rt"], IG: ["V", "Rt", "C", "F"],
    V: ["IG", "P", "Rn"], Rn: ["C", "TF", "V", "GI", "EC"], EC: ["F", "E", "TF", "Rn"], TF: ["VB", "Rn", "EC", "Rt"], VB: ["TF", "C", "F"], F: ["EC", "GI", "VB", "IG", "P"],
  },
  placeStatique(code) {
    const k = this.canaux.get(code) || {};
    return (k.polarite === "yang" ? "yáng" : "yīn") + " de " + (k.membre === "pied" ? "pied" : "main");
  },
  candidatsAjout(c) {
    const g = c.grille, deja = new Set((c.ajouts || []).flatMap(a => a.canaux || [])), out = [];
    Object.keys(this.SYSTEMES).forEach(x => {
      if (g.includes(x) || deja.has(x)) return;
      const kx = this.canaux.get(x) || {};
      const memePlace = g.filter(k => { const kk = this.canaux.get(k) || {}; return kk.polarite === kx.polarite && kk.membre === kx.membre; });
      if (!memePlace.length) return;                                                    // équilibre statique
      const liens = g.filter(k => this.SYSTEMES[x].includes(k));
      if (liens.length < 2) return;                                                    // équilibre dynamique
      out.push({ code: x, memePlace, liens, raisons: [`même place que ${memePlace.join(", ")} (${this.placeStatique(x)})`, `relié à ${liens.join(" et ")} (6 systèmes)`] });
    });
    return out;
  },
  proposerAjouts(c) {
    const z = document.getElementById("circ-aj-zone");
    if (z.innerHTML) { z.innerHTML = ""; return; }
    const l = this.candidatsAjout(c);
    z.innerHTML = ""+
      (l.length ? `<ul class="circ-pts-prop">${l.map((x, i) => `<li><span class="sx-code" title="${escapeHtml(((this.canaux.get(x.code) || {}).nom || "") + " : " + x.raisons.join(" ; "))}">${escapeHtml(x.code)}</span> <span class="circ-fleche" title="Connecté à ces canaux du circuit (6 systèmes)">→ ${x.liens.map(escapeHtml).join(" · ")}</span> <button type="button" class="edit-toggle-btn" data-i="${i}" title="Ajouter à la liste" aria-label="Ajouter à la liste">+</button></li>`).join("")}</ul>` : `<p class="muted">Aucun autre canal ne garde l'équilibre statique et dynamique de ce circuit.</p>`);
    z.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true;                                                     // pas de double clic
      const x = l[+b.dataset.i], nom = ((this.canaux.get(x.code) || {}).nom || x.code).toLowerCase();
      const a = { action: "", texte: `canal ${nom} (${x.code}) — ${x.raisons.join(" ; ")}`, canaux: [x.code], ensemble: false, source: "proposition (équilibre statique et dynamique vérifié)" };
      await this.ajouterAjout(c, a);
    }));
  },
  async ajouterAjout(c, a) {
    const dejaLa = new Set((c.ajouts || []).flatMap(x => x.canaux || []));
    if ((a.canaux || []).length && a.canaux.every(k => dejaLa.has(k))) { this.rendreFiche(); return; }      // ce canal est déjà un ajout possible du circuit
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
  pointBase(p) { return String(p || "").replace(/\s*\(.*$/, "").trim(); },        // « TF 5 (yang WM) » -> « TF 5 »
  ouverture(point) {
    const k = this.pointBase(point).toUpperCase().replace(/[\s.\-]/g, "").replace(/^SI/, "IG").replace(/^LI/, "GI").replace(/^SP/, "RT").replace(/^UB/, "V").replace(/^BL/, "V").replace(/^KI/, "RN").replace(/^LU/, "P").replace(/^HT/, "C");
    const cle = Object.keys(this.OUVERTURES).find(x => x.toUpperCase() === k);
    return cle ? this.OUVERTURES[cle] : null;
  },
  // nom du point suivi, s'il y a lieu, de « ouvre le … » (couple en infobulle)
  pointHtml(p) {
    const o = this.ouverture(p);
    return `<a href="#" class="circ-ptlien" data-pt-fiche="${escapeHtml(this.pointBase(p))}" title="Ouvrir la fiche du point dans un nouvel onglet">${escapeHtml(p)}</a>` + (o ? ` <span class="circ-ouv" title="Point d'ouverture (confluent) du ${escapeHtml(o[0])} ; couple : ${escapeHtml(o[1])}">ouvre le ${escapeHtml(o[0])}</span>` : "");
  },

  // ---------- intersections avec les huit merveilleux vaisseaux (ta base de points : lignes « jiāo huì-intersection avec … »)
  VAISSEAUX_INTER: [[/chong\s*mai/, "chōng mài"], [/dai\s*mai/, "dài mài"], [/yin\s*wei\s*mai/, "yīn wéi mài"], [/yang\s*wei\s*mai/, "yáng wéi mài"],
                    [/yin\s*qiao\s*mai/, "yīn qiāo mài"], [/yang\s*qiao\s*mai/, "yáng qiāo mài"], [/ren\s*mai/, "rèn mài"], [/du\s*mai/, "dū mài"]],
  // couleurs des cinq mouvements (fond des pastilles de points)
  COULEUR_MOUV: { bois: "#97C459", feu: "#F09595", terre: "#FAC775", metal: "#FFFFFF", eau: "#1d1d1b" },
  NOM_MOUV: { bois: "bois", feu: "feu", terre: "terre", metal: "métal", eau: "eau" },
  // mouvement de chaque canal (wǔ xíng) : eau = rein-vessie, bois = foie-vésicule biliaire, feu = cœur-intestin grêle, enveloppe du cœur-trois foyers, terre = rate-estomac, métal = poumon-gros intestin
  MOUV_CANAL: { P: "metal", GI: "metal", E: "terre", Rt: "terre", C: "feu", IG: "feu", V: "eau", Rn: "eau", EC: "feu", TF: "feu", VB: "bois", F: "bois" },
  // couleurs des canaux, comme dans le jeu (module Circuits) : terre jaune, bois vert, feu rouge, eau bleu ; le métal (P, GI) prend la couleur de l'encre
  COULEUR_CANAL: { E: "#d9a400", Rt: "#d9a400", VB: "#2f9a3c", F: "#2f9a3c", C: "#e0261b", IG: "#e0261b", EC: "#e0261b", TF: "#e0261b", V: "#1f5fd6", Rn: "#1f5fd6" },
  couleurCanal(code) { return this.COULEUR_CANAL[code] || "var(--ink)"; },
  // texte posé dans le rond d'un canal : blanc sur un rond plein (yīn), couleur du canal sur un rond cerclé (yáng)
  texteRond(code) { return this.polarite(code) === "yin" ? (this.COULEUR_CANAL[code] ? "#fff" : "var(--bg)") : this.couleurCanal(code); },
  mouvementDe(p) {
    for (const l of String(p.categories_point || "").split(/\n+/)) {
      const n = l.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (/mer de l'eau|des cereales/.test(n)) continue;
      if (/jing-puits|ying-jaillissement|shu-riviere|jing-fleuve|he-reunion|^\W*point\s+(bois|feu|terre|metal|eau)\b/.test(n)) {
        const m = n.match(/\b(bois|feu|terre|metal|eau)\b/);
        if (m) return m[1];
      }
    }
    return "";
  },
  // niveaux (yīn yáng) -> [canal de main, canal de pied] : pour lire « les canaux du zù jué yīn et du zú shào yīn »
  NIVEAU_CANAL: { "tai yin": ["P", "Rt"], "shao yin": ["C", "Rn"], "jue yin": ["EC", "F"], "yang ming": ["GI", "E"], "tai yang": ["IG", "V"], "shao yang": ["TF", "VB"] },
  codeDuPoint(pt) { const k = this.cleP(this.pointBase(pt)).match(/^[A-Z]+/); return k ? ({ RT: "Rt", RN: "Rn" }[k[0]] || k[0]) : ""; },
  // pour chaque point : { v: vaisseaux, c: canaux } avec lesquels il est en intersection (jiāo huì) ; canaux et vaisseaux, c'est la même chose pour l'équilibre
  chargerInter() {
    if (!this._inter) {
      this._inter = (async () => {
        const m = new Map();
        this._mouv = new Map();
        let cours = {};
        try { cours = (await Store.readJSON("reference/points_canaux/intersections_cours.json")).points || {}; } catch (e) { /* pas de fichier : la base seule */ }
        const coursN = Object.fromEntries(Object.entries(cours).map(([k, v]) => [this.cleP(k), v]));
        const ajoute = (e, liste, x) => { if (x && !liste.includes(x)) liste.push(x); };
        await Promise.all(["P", "GI", "E", "Rt", "C", "IG", "V", "Rn", "EC", "TF", "VB", "F", "RM", "DM"].map(async k => {
          (await this.dbCanal(k)).forEach(p => {
            const mv = this.mouvementDe(p);
            if (mv) this._mouv.set(this.cleP(p.point), mv);
            const e = { v: [], c: [] };
            String(p.categories_point || "").split(/\n+/).forEach(l => {
              const n = l.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
              if (!/jiao\s*hui|intersection/.test(n)) return;
              this.VAISSEAUX_INTER.forEach(([re, nom]) => { if (re.test(n)) ajoute(e, e.v, nom); });
              Object.entries(this.NIVEAU_CANAL).forEach(([niv, [main, pied]]) => {
                const re = new RegExp("\\b(zu|zou|shou)\\s+" + niv.replace(" ", "\\s+") + "\\b", "g");
                for (const mm of n.matchAll(re)) ajoute(e, e.c, mm[1] === "shou" ? main : pied);
              });
              if (/tous les canaux yang/.test(n)) ["GI", "IG", "TF", "E", "V", "VB"].forEach(x => ajoute(e, e.c, x));
            });
            const cc = coursN[this.cleP(p.point)];
            if (cc) { (cc.canaux || []).forEach(x => ajoute(e, e.c, x)); (cc.vaisseaux || []).forEach(x => ajoute(e, e.v, x)); }
            const own = this.codeDuPoint(p.point);
            e.c = e.c.filter(x => x !== own);
            if (e.v.length || e.c.length) m.set(this.cleP(p.point), e);
          });
        }));
        this._mouvPret = true;
        return m;
      })();
    }
    return this._inter;
  },
  // ajoute « croise le … » après le nom d'un point qui est en intersection avec un merveilleux vaisseau (hors celui qu'il ouvre déjà : « ouvre le … »)
  async annoterCroisements(racine) {
    if (!racine) return;
    const m = await this.chargerInter();
    racine.querySelectorAll("a.circ-ptlien[data-pt-fiche]").forEach(a => {
      if (a.dataset.inter) return;
      a.dataset.inter = "1";
      const li = a.closest("li");
      if (li && /ouvert par|intersection|fait aussi partie/.test(li.textContent)) return;                 // la proposition le dit déjà dans sa catégorie
      const e = m.get(this.cleP(this.pointBase(a.dataset.ptFiche)));
      if (!e) return;
      const ouv = this.ouverture(a.dataset.ptFiche), l = [...e.c, ...e.v.filter(x => !ouv || x !== ouv[0])];
      if (!l.length) return;
      let ref = a;
      while (ref.nextElementSibling && ref.nextElementSibling.classList.contains("circ-ouv")) ref = ref.nextElementSibling;
      ref.insertAdjacentHTML("afterend", ` <span class="circ-ouv circ-croise" title="Point d'intersection (jiāo huì) : il fait aussi partie de ces canaux et vaisseaux, d'après ta base de points et tes cours">croise ${escapeHtml(l.join(", "))}</span>`);
    });
  },

  // ---------- points par canal : une liste par canal (la même dans tous les circuits qui contiennent ce canal), avec l'action de chaque point
  // un point est « retenu » (★) quand tu l'as marqué ; ceux que tu as saisis toi-même le sont d'office, tant que tu n'as pas choisi
  retenu(x) { return x.retenu === undefined ? x.statut === "toi" : !!x.retenu; },
  ptsDe(code) { return this.points.canaux[code] || []; },
  async ecrirePoints() { await Store.writeJSON(this.CHEMIN_POINTS, { titre: this.points.titre, canaux: this.points.canaux }); },
  ligneEnPoint(l) {
    const m = String(l).match(/^\s*([^:：]{1,14}?)\s*[:：]\s*(.*)$/);
    return m ? { point: m[1].trim(), action: m[2].trim() } : { point: String(l).trim(), action: "" };
  },
  // préférence « actions affichées » par canal (mémorisée dans ce navigateur)
  actionsVisibles() { try { return JSON.parse(localStorage.getItem("circ_actions_visibles") || "{}") || {}; } catch (e) { return {}; } },
  // 💬 : champ de commentaire en ligne (Entrée enregistre, Échap annule) ; le commentaire reste attaché au point et apparaît dans le graphe de comparaison
  // 💬 dans un tableau d'association : la remarque s'écrit entre parenthèses après le point (« TF5 (yang WM) ») et ne s'affiche dans le graphe que pour ce tableau
  commenterAssoc(c, i, k, j, bouton) {
    const a = (c.associations || [])[i];
    if (!a || bouton.parentNode.querySelector(".circ-com-input")) return;
    const p = a.points[k][j], base = p.replace(/\s*\([^)]*\)/g, "").trim();
    const inp = document.createElement("input");
    inp.type = "text"; inp.className = "circ-com-input"; inp.value = this.commentairesDe(p).join(" ; "); inp.placeholder = "Remarque sur " + base + " dans ce tableau";
    bouton.insertAdjacentElement("afterend", inp);
    inp.focus();
    let fini = false;
    const fin = async ok => {
      if (fini) return;
      fini = true;
      const v = inp.value.trim().replace(/[()]/g, ""), nouveau = v ? `${base} (${v})` : base;
      if (!ok || nouveau === p) { this.majAssoc(this.parId(c.id)); return; }
      const assoc = c.associations.map((x, n) => n === i ? { ...x, points: { ...x.points, [k]: x.points[k].map((q, m) => m === j ? nouveau : q) } } : x);
      await this.enregistrerChamps(c, { associations: assoc });
      this.assocActive = i; this.majAssoc(this.parId(c.id));
    };
    inp.addEventListener("keydown", ev => { if (ev.key === "Enter") fin(true); else if (ev.key === "Escape") fin(false); });
    inp.addEventListener("blur", () => fin(true));
  },
  // ⓘ : affiche ou masque les actions d'un seul point (utile au toucher, où il n'y a pas de survol)
  brancherInfos(racine) {
    racine.querySelectorAll(".circ-info").forEach(b => { if (b.dataset.branche) return; b.dataset.branche = "1"; b.addEventListener("click", ev => { ev.stopPropagation(); const li = b.closest("li"), o = li.classList.toggle("act-ouvert"); b.setAttribute("aria-expanded", String(o)); }); });
  },
  rendrePoints(c) {
    const z = document.getElementById("circ-pts");
    if (!z) return;
    const ouvert = this._ptsOuvert || {};
    const supp = [...new Set((c.ajouts || []).flatMap(a => a.canaux || []))].filter(k => !c.grille.includes(k));
    const cartes = [...c.grille, ...supp, ...this.AXE, ...(this.vaisseauxOuverts(c).length || this.ptsDe("VX").length ? ["VX"] : [])].map(code => {
      const k = this.canaux.get(code) || { nom: this.NOM_AXE[code] }, l = this.ptsAffiches(code, c), axe = this.AXE.includes(code) || code === "VX", ajout = !axe && !c.grille.includes(code);
      const lis = l.map(x => ({ r: this.retenu(x), h: `<li><button type="button" class="circ-pt-etoile${this.retenu(x) ? " actif" : ""}" data-point="${escapeHtml(x.point)}" title="${this.retenu(x) ? "Favori : cliquer pour le retirer des favoris" : "Ajouter aux favoris"}" aria-label="Mettre ${escapeHtml(x.point)} en favori" aria-pressed="${this.retenu(x)}">${this.retenu(x) ? "★" : "☆"}</button> <button type="button" class="circ-pt-choisir" data-reseau="${escapeHtml(JSON.stringify({ point: x.point, canal: x.canal || code, raison: x.action || "", source: "points du canal " + code, circuit: c.id }))}" title="Choisir ce point pour le réseau de la patiente" aria-label="Choisir ${escapeHtml(x.point)} pour le réseau de la patiente">✓</button> <strong>${this.pointHtml(x.point)}</strong>${x.canal ? ` <span class="sx-code" title="Canal du point">${escapeHtml(x.canal)}</span>` : ""}${x.commentaire ? ` <span class="circ-com" title="Ton commentaire">${escapeHtml(x.commentaire)}</span>` : ""}${x.categorie ? ` <span class="circ-cat">${escapeHtml(x.categorie)}</span>` : ""}${x.action || x.statut === "base" ? ` <button type="button" class="circ-info" aria-expanded="false" title="Afficher ou masquer les actions de ce point" aria-label="Afficher ou masquer les actions de ce point">ⓘ</button>` : ""}${x.statut === "propose" ? ` <span class="circ-pt-tag" title="Proposition de Claude : à confirmer ou corriger (modifier la ligne la valide)">à valider</span>` : ""}<span class="circ-act">${x.action ? escapeHtml(sansHanzi(x.action)) : ""}${x.statut === "base" ? ` <span class="circ-pt-tag circ-pt-base" title="Repris de ta base de points (Points des canaux)">base</span>` : ""}</span></li>` }));
      const ret = lis.filter(o => o.r), dis = lis.filter(o => !o.r), rend = a => a.map(o => o.h).join("");
      return `<div class="circ-pts-carte${ajout ? " circ-pts-ajout" : ""}${axe ? " circ-pts-axe" : ""}${this.actionsVisibles()[code] ? " actions-visibles" : ""}" data-k="${escapeHtml(code)}"><div class="circ-pts-tete"><span><strong>${escapeHtml(code === "VX" ? "8MV" : code)}</strong> <span class="muted">${escapeHtml(k.nom || "")}${ajout ? " — ajout possible" : ""}</span></span>` +
        `<span class="circ-pts-btns"><button type="button" class="edit-toggle-btn" data-act="actions" title="Afficher ou masquer les actions de tous les points de ce canal" aria-label="Afficher ou masquer les actions de tous les points de ce canal">👁</button> <button type="button" class="edit-toggle-btn" data-act="edit" title="Modifier les points de ce canal" aria-label="Modifier les points de ce canal">✏️</button> <button type="button" class="edit-toggle-btn" data-act="prop" title="Proposer des points" aria-label="Proposer des points">💡</button></span></div>` +
        (lis.length ? (ret.length ? `<ul class="circ-pts-liste">${rend(ret)}</ul>` : "") + (dis.length ? `<p class="circ-pts-sep">Disponibles (${dis.length})</p><ul class="circ-pts-liste circ-pts-dispo">${rend(dis)}</ul>` : "") : "") + `<div class="circ-pts-zone"></div></div>`;
    });
    // les quatre canaux du circuit sont placés comme le schéma (carré) ; les ajouts possibles, RM, DM et les vaisseaux dessous
    const vx = this.vaisseauxOuverts(c), bande = vx.length ? `<div class="circ-bande-vx" title="Merveilleux vaisseaux ouverts par un point du circuit : leurs points se proposent dans la carte « 8MV »"><span class="muted">8MV</span> ${vx.map(o => `<span class="circ-vx-puce"><strong>${escapeHtml(o.pt)}</strong> <span class="muted">${escapeHtml(o.vaisseau)}</span></span>`).join("")}</div>` : "";
    z.innerHTML = `<div class="circ-pts-grille">${cartes.slice(0, c.grille.length).join("")}</div>` + bande + (cartes.length > c.grille.length ? `<div class="circ-pts-grille circ-pts-hors">${cartes.slice(c.grille.length).join("")}</div>` : "");
    z.querySelectorAll(".circ-pts-carte").forEach(carte => {
      const code = carte.dataset.k, zone = carte.querySelector(".circ-pts-zone");
      carte.querySelector('[data-act="edit"]').addEventListener("click", () => this.editerPoints(c, code, carte, zone));
      carte.querySelector('[data-act="prop"]').addEventListener("click", () => this.proposerPoints(c, code, zone));
      carte.querySelector('[data-act="actions"]').addEventListener("click", () => {
        const v = this.actionsVisibles(), on = carte.classList.toggle("actions-visibles");
        v[code] = on; try { localStorage.setItem("circ_actions_visibles", JSON.stringify(v)); } catch (e) { /* stockage indisponible */ }
        carte.querySelectorAll(".circ-info").forEach(b => b.setAttribute("aria-expanded", String(on)));
      });
      this.brancherInfos(carte);
      carte.querySelectorAll(".circ-pt-etoile").forEach(b => b.addEventListener("click", async () => {
        let e = this.ptsDe(code).find(y => this.cleP(y.point) === this.cleP(b.dataset.point));
        if (!e) {                                                                        // point standard affiché d'office : il entre dans ta liste quand tu le mets en favori
          const a = this.standardsDe(code).find(y => this.cleP(y.point) === this.cleP(b.dataset.point));
          if (!a) return;
          e = { point: a.point, action: a.action, categorie: a.categorie, statut: "base", retenu: true };
          (this.points.canaux[code] = this.points.canaux[code] || []).push(e);
        }
        e.retenu = !this.retenu(e);
        try { await this.ecrirePoints(); } catch (err) { alert("Enregistrement impossible : " + err.message); }
        this.rendrePoints(c);
      }));
      if (ouvert[code]) this.proposerPoints(c, code, zone, true);
      else this.propositionsCanal(code, c).then(l => {
        const deja = new Set(this.ptsAffiches(code, c).map(x => this.cleP(x.point)));
        if (!l.some(x => !deja.has(this.cleP(x.point)))) { const b = carte.querySelector('[data-act="prop"]'); if (b && carte.isConnected) b.hidden = true; }
      });
    });
    this.marquerSaignees(z);
    this.marquerCategories(z);
    const codesStd = [...c.grille, ...supp];
    if (!codesStd.every(k => (this._dbSync || {})[k])) Promise.all(codesStd.map(k => this.dbCanal(k))).then(() => { if (this.actif === c.id && document.getElementById("circ-pts")) this.rendrePoints(c); });
  },
  // catégorie des points de la liste qui n'en ont pas encore (ajoutés avant, ou saisis à la main) : lue dans ta base de points
  async marquerCategories(z) {
    for (const carte of z.querySelectorAll(".circ-pts-carte")) {
      for (const li of carte.querySelectorAll(".circ-pts-liste li")) {
        if (li.querySelector(".circ-cat")) continue;
        const st = li.querySelector("strong"), nom = this.cleP(this.pointBase(st.innerText));
        const pref = (nom.match(/^[A-Z]+/) || [""])[0], fichier = { RT: "Rt", RN: "Rn" }[pref] || pref;
        const db = await this.dbCanal(fichier);
        const p = db.find(x => this.cleP(x.point) === nom);
        const cats = p ? this.categoriesDe(p) : [];
        if (cats.length && !li.querySelector(".circ-cat")) st.insertAdjacentHTML("afterend", ` <span class="circ-cat">${escapeHtml(cats.join(" ; "))}</span>`);
      }
    }
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
        const m = anciens.find(y => this.cleP(y.point) === this.cleP(x.point));          // le commentaire et la catégorie suivent le point
        return { ...x, statut: a ? a.statut : "toi", ...(m && m.commentaire ? { commentaire: m.commentaire } : {}), ...(m && m.categorie ? { categorie: m.categorie } : {}), ...(m && m.canal ? { canal: m.canal } : {}), ...(m && m.retenu !== undefined ? { retenu: m.retenu } : {}) };
      });
      const vus = new Set();
      const sansDoublon = nv.filter(x => { const k = this.cleP(x.point) + "|" + x.action; if (vus.has(k)) return false; vus.add(k); return true; });
      this.points.canaux[code] = sansDoublon;
      if (!sansDoublon.length) delete this.points.canaux[code];
      try { await this.ecrirePoints(); } catch (e) { zone.querySelector(".circ-pts-statut").textContent = "Enregistrement impossible : " + e.message; return; }
      this.rendrePoints(c);
    });
  },
  // ---------- base de points du jeu (reference/points_canaux/<canal>.json) : propositions, actions et indications en saignée
  async dbCanal(code) {
    this._db = this._db || {};
    if (!this._db[code]) this._db[code] = Store.readJSON("reference/points_canaux/" + code + ".json").then(d => Array.isArray(d) ? d : []).catch(() => []).then(d => { (this._dbSync = this._dbSync || {})[code] = d; return d; });
    return this._db[code];
  },
  // pas de points shù dorsaux (vessie) ni de mù d'un autre canal : seuls les points du canal lui-même, de RM ou de DM sont proposés
  pointAdmis(point, code) {
    const pref = (String(point).toUpperCase().replace(/\s+/g, "").match(/^[A-Z]+/) || [""])[0];
    return pref === code.toUpperCase() || pref === "RM" || pref === "DM";
  },
  cleP(s) { return String(s || "").toUpperCase().replace(/\s+/g, ""); },
  enListe(v) { return Array.isArray(v) ? v : (v ? [v] : []); },
  texteItem(x) { return typeof x === "string" ? x : (x && (x.indication || x.texte || x.note)) || ""; },
  // passages de la fiche du point qui parlent de saignée (technique, notes, associations, indications contemporaines, actions, indications psycho-émotionnelles)
  saigneeDe(p) {
    const re = /saign(ée|ées|er|ez)\b|saignement d['’]/i, out = [];
    const decoupe = t => String(t || "").split(/\n+|(?<=[.!?])\s+(?=[A-ZÉÈÀ])/).map(s => s.trim()).filter(Boolean);
    const ajoute = (t, lib) => decoupe(t).filter(s => re.test(s) && !/^\[Jeu\]/.test(s)).forEach(s => { const v = s.replace(/^\[Jeu\]\s*/, ""); if (!out.some(o => o.texte === v)) out.push({ texte: v, lib }); });
    ajoute(p.methode_travail, "technique");
    ajoute(p.note, "note");
    this.enListe(p.associations).forEach(x => ajoute(this.texteItem(x), "association"));
    this.enListe(p.indications_contemporaines).forEach(x => ajoute(this.texteItem(x), "indication"));
    this.enListe(p.actions).forEach(x => ajoute(this.texteItem(x), "action"));
    this.enListe(p.indications_psycho_emotionnelles).forEach(x => ajoute(this.texteItem(x), "psycho-émotionnel"));
    return out;
  },
  // points de transport (cinq shū antiques), luò de liaison et yuán-source d'un canal : repris de la base et ajoutés d'office à chaque canal d'un circuit
  standardsDe(code) {
    const db = (this._dbSync || {})[code] || [];
    const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return db.filter(p => {
      if (!this.pointAdmis(p.point, code) || this.AXE.includes(code)) return false;
      return String(p.categories_point || "").split(/\n+/).some(l => {
        const n = norm(l);
        if (/mer de l'eau|des cereales|inferieur|intersection|jiao hui/.test(n)) return false;        // ni les hé inférieurs, ni les points d'intersection
        return /jing-puits|ying-jaillissement|shu-riviere|jing-fleuve|he-reunion|yuan-source/.test(n) || (/luo-liaison/.test(n) && !/grand/.test(n));
      });
    }).map(p => ({ point: String(p.point).replace(/\s+/g, ""), categorie: this.categoriesDe(p).join(" ; "), action: this.actionsDe(p).slice(0, 2).join(" ; "), statut: "base", auto: true, retenu: true }));
  },
  numPoint(s) { const m = String(s).match(/(\d+)/); return m ? +m[1] : 0; },
  // liste affichée d'un canal : tes points + les points standard qui n'y sont pas encore (par ordre numérique)
  ptsAffiches(code, c) {
    const l = this.ptsDe(code);
    if (!c || !c.grille.includes(code) && !(c.ajouts || []).some(a => (a.canaux || []).includes(code))) return l;
    const vus = new Set(l.map(x => this.cleP(x.point)));
    const auto = this.standardsDe(code).filter(x => !vus.has(this.cleP(x.point)));
    return [...l, ...auto].map((x, i) => ({ x, i })).sort((a, b) => (this.numPoint(a.x.point) - this.numPoint(b.x.point)) || (a.i - b.i)).map(o => o.x);
  },
  actionsDe(p) { return this.enListe(p.actions).map(a => this.texteItem(a).replace(/^[➢•\-\s]+/, "").replace(/\.$/, "").trim()).filter(Boolean); },
  // catégories « utiles » d'un point de la base (cinq points shu, yuán, luò, xī, hé…)
  categoriesDe(p) {
    const lib = String(p.categories_point || "").split(/\n+/).map(s => s.replace(/^[\s\-•🖇️⊞]*Point\s*/u, "").trim()).filter(s => /jǐng|yíng|shū-rivière|jīng-fleuve|hé-réunion|huì-réunion|yuán|luò|xì|mù|bèi|ouverture|mer d|fenêtre du ciel/i.test(s) && !/jiāo huì/i.test(s));
    return lib;
  },
  // mù-collecteurs des organes des canaux, situés sur RM (ex. RM12 pour l'estomac, RM14 pour le cœur) : proposés avec le canal correspondant
  ORGANE_MU: { P: /poumon/i, GI: /gros intestin/i, E: /estomac/i, Rt: /rate/i, C: /mù-collecteur d[ue] c(œ|oe)ur/i, IG: /intestin grêle/i, V: /vessie/i, Rn: /reins?\b/i,
               EC: /enveloppe du c(œ|oe)ur/i, TF: /trois foyers/i, VB: /vésicule/i, F: /foie/i },
  async pointsAxe(code) {
    const re = this.ORGANE_MU[code];
    if (!re) return [];
    const axe = [...(await this.dbCanal("RM")), ...(await this.dbCanal("DM"))];
    return axe.filter(p => String(p.categories_point || "").split(/\n+/).some(l => /mù-collecteur/i.test(l) && re.test(l)));
  },
  // points d'un merveilleux vaisseau, situés sur un canal du circuit, quand le point d'ouverture de ce vaisseau est lui aussi sur un canal du circuit
  // (ex. circuit avec TF et VB : TF5 ouvre le yáng wéi mài, donc VB35, VB20… et TF15 sont proposés avec lui)
  vaisseauxOuverts(c) {
    if (!c) return [];
    const canaux = new Set([...c.grille, ...(c.ajouts || []).flatMap(a => a.canaux || [])]);
    return Object.entries(this.OUVERTURES).filter(([pt]) => canaux.has((pt.match(/^[A-Za-z]+/) || [""])[0])).map(([pt, v]) => ({ pt, vaisseau: v[0] }));
  },
  // équilibre statique : un canal est admis s'il a la polarité et le membre d'un des canaux du circuit
  staticOk(x, c) {
    const kx = this.canaux.get(x);
    if (!kx) return false;
    return [...c.grille, ...(c.ajouts || []).flatMap(a => a.canaux || [])].some(k => { const kk = this.canaux.get(k) || {}; return kk.polarite === kx.polarite && kk.membre === kx.membre; });
  },
  // points d'un vaisseau ouvert, situés sur un canal DU circuit (ils s'ajoutent à la carte de ce canal)
  async pointsVaisseaux(code, c) {
    const ouverts = this.vaisseauxOuverts(c);
    if (!ouverts.length) return [];
    const m = await this.chargerInter(), db = await this.dbCanal(code), out = [];
    db.forEach(p => {
      const e = m.get(this.cleP(p.point)), lies = e ? ouverts.filter(o => e.v.includes(o.vaisseau) && this.cleP(o.pt) !== this.cleP(p.point)) : [];     // le point d'ouverture lui-même est déjà proposé comme tel
      if (lies.length) out.push({ p, lies });
    });
    return out;
  },
  // points d'un vaisseau ouvert, situés sur un canal HORS du circuit : carte « Vaisseaux » (équilibre statique respecté ; pas besoin d'être sur le canal du point d'ouverture)
  async propositionsVX(c) {
    const ouverts = this.vaisseauxOuverts(c);
    if (!ouverts.length) return [];
    const m = await this.chargerInter(), du = new Set([...c.grille, ...(c.ajouts || []).flatMap(a => a.canaux || [])]), out = [];
    for (const k of ["P", "GI", "E", "Rt", "C", "IG", "V", "Rn", "EC", "TF", "VB", "F"]) {
      if (du.has(k) || !this.staticOk(k, c)) continue;
      (await this.dbCanal(k)).forEach(p => {
        const e = m.get(this.cleP(p.point)), lies = e ? ouverts.filter(o => e.v.includes(o.vaisseau)) : [];
        if (lies.length) out.push({ point: String(p.point).replace(/\s+/g, ""), categorie: lies.map(o => `croise le ${o.vaisseau} (ouvert par ${o.pt})`).join(" ; "), action: this.actionsDe(p).slice(0, 2).join(" ; "), saignee: this.saigneeDe(p), indic: p, canal: k });
      });
    }
    return out;
  },
  async propositionsCanal(code, c) {
    if (code === "VX") return this.propositionsVX(c);
    const axe = this.AXE.includes(code), propre = await this.dbCanal(code), db = propre;
    if (db.length) {
      const fait = p => ({ point: String(p.point).replace(/\s+/g, ""), categorie: this.categoriesDe(p).join(" ; "), action: this.actionsDe(p).slice(0, 2).join(" ; "), saignee: this.saigneeDe(p), indic: p });
      // RM et DM sont sur la ligne médiane : neutres, tous leurs points peuvent entrer dans n'importe quel circuit
      const base = db.filter(p => this.pointAdmis(p.point, code)).map(fait).filter(x => axe || x.categorie || x.saignee.length);
      (await this.pointsVaisseaux(code, c)).forEach(({ p, lies }) => {
        const txt = lies.map(o => `croise le ${o.vaisseau} (ouvert par ${o.pt})`).join(" ; "), nom = this.cleP(p.point);
        const ex = base.find(x => this.cleP(x.point) === nom);
        if (ex) ex.categorie = [ex.categorie, txt].filter(Boolean).join(" ; ");
        else base.push({ point: String(p.point).replace(/\s+/g, ""), categorie: txt, action: this.actionsDe(p).slice(0, 2).join(" ; "), saignee: this.saigneeDe(p), indic: p, vaisseau: true });
      });
      if (axe) return base;
      // points d'intersection : un point d'intersection fait partie de tous les canaux qu'il croise ; on les regroupe à part (repliés)
      const m = await this.chargerInter(), vus = new Set(base.map(x => this.cleP(x.point))), inters = [];
      propre.forEach(p => {
        const e = m.get(this.cleP(p.point));
        if (!e || vus.has(this.cleP(p.point))) return;
        vus.add(this.cleP(p.point));
        inters.push({ ...fait(p), categorie: "intersection avec " + [...e.c, ...e.v].join(", "), inter: true });
      });
      for (const k of ["P", "GI", "E", "Rt", "C", "IG", "V", "Rn", "EC", "TF", "VB", "F"]) {
        if (k === code) continue;
        (await this.dbCanal(k)).forEach(p => {
          const e = m.get(this.cleP(p.point));
          if (!e || !e.c.includes(code) || vus.has(this.cleP(p.point))) return;
          vus.add(this.cleP(p.point));
          inters.push({ ...fait(p), categorie: `point de ${k} qui fait aussi partie de ${code} (intersection)`, inter: true, canal: k });
        });
      }
      return [...base, ...inters];
    }
    if (!this.proposes) { try { this.proposes = await Store.readJSON(this.CHEMIN_PROPOSES); } catch (e) { return []; } }
    return ((this.proposes.canaux || {})[code] || []).map(x => ({ ...x, saignee: [], repli: true })).filter(x => this.pointAdmis(x.point, code));
  },
  // 🩸 à côté des points de la liste qui ont des indications en saignée dans la base
  async marquerSaignees(z) {
    for (const carte of z.querySelectorAll(".circ-pts-carte")) {
      const code = carte.dataset.k;
      if (code === "VX") continue;
      const db = await this.dbCanal(code);
      if (!db.length) continue;
      carte.querySelectorAll(".circ-pts-liste li").forEach(li => {
        const nom = this.cleP(li.querySelector("strong").childNodes[0].textContent), p = db.find(x => this.cleP(x.point) === nom);
        const s = p ? this.saigneeDe(p) : [];
        if (s.length && !li.querySelector(".circ-sai")) li.insertAdjacentHTML("beforeend", ` <details class="circ-sai"><summary title="Indications en saignée de ta base">🩸 saignée</summary>${s.map(x => `<p>${escapeHtml(sansHanzi(x.texte)).slice(0, 400)} <span class="muted">(${escapeHtml(x.lib)})</span></p>`).join("")}</details>`);
      });
    }
  },
  async proposerPoints(c, code, zone, sansBascule) {
    this._ptsOuvert = this._ptsOuvert || {};
    if (!sansBascule && this._ptsOuvert[code]) { this._ptsOuvert[code] = false; zone.innerHTML = ""; return; }
    this._ptsOuvert[code] = true;
    zone.innerHTML = `<p class="muted">Chargement…</p>`;
    const deja = new Set(this.ptsAffiches(code, c).map(x => this.cleP(x.point)));
    const tous = await this.propositionsCanal(code, c);
    const l = tous.filter(x => !deja.has(this.cleP(x.point)));
    const repli = tous.some(x => x.repli);
    const INFO = `<button type="button" class="circ-info" aria-expanded="false" title="Afficher ou masquer les actions de ce point" aria-label="Afficher ou masquer les actions de ce point">ⓘ</button>`;
    const ligne = (x, i) => `<li><strong>${this.pointHtml(x.point)}</strong>${x.canal && code !== x.canal ? ` <span class="sx-code" title="Canal du point">${escapeHtml(x.canal)}</span>` : ""} <span class="muted">${escapeHtml(x.categorie || "")}</span>${x.action ? " " + INFO : ""} <button type="button" class="edit-toggle-btn" data-i="${i}" title="Ajouter à la liste" aria-label="Ajouter à la liste">+</button> <button type="button" class="edit-toggle-btn" data-reseau="${escapeHtml(JSON.stringify({ point: x.point, canal: x.canal || code, raison: x.action || "", source: "proposition", circuit: c.id }))}" title="Choisir ce point pour le réseau de la patiente" aria-label="Choisir ce point pour le réseau de la patiente">✓</button>${x.action ? ` <span class="circ-act">${escapeHtml(sansHanzi(x.action))}</span>` : ""}` +
      (x.saignee.length ? `<details class="circ-sai"><summary>🩸 saignée</summary>${x.saignee.map(s => `<p>${escapeHtml(sansHanzi(s.texte)).slice(0, 400)} <span class="muted">(${escapeHtml(s.lib)})</span></p>`).join("")}</details>` : "") + `</li>`;
    const indexes = l.map((x, i) => ({ x, i })), normaux = indexes.filter(o => !o.x.inter), inters = indexes.filter(o => o.x.inter);
    zone.innerHTML = (repli ? `<p class="muted circ-pts-avert">Base de points indisponible : propositions par catégorie classique, actions à valider (elles ne viennent pas de tes cours).</p>` : "") +
      (normaux.length ? `<ul class="circ-pts-prop">${normaux.map(o => ligne(o.x, o.i)).join("")}</ul>` : "") +
      (inters.length ? `<details class="circ-inter"><summary>Points d'intersection (${inters.length}) : ils font partie de tous les canaux qu'ils croisent</summary><ul class="circ-pts-prop">${inters.map(o => ligne(o.x, o.i)).join("")}</ul></details>` : "");
    this.annoterCroisements(zone);
    this.brancherInfos(zone);
    if (this.actionsVisibles()[code]) zone.classList.add("actions-visibles");
    zone.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true;                                                     // pas de double clic
      const x = l[+b.dataset.i];
      if (this.ptsDe(code).some(y => this.cleP(y.point) === this.cleP(x.point))) { this.rendrePoints(c); return; }      // déjà dans la liste
      (this.points.canaux[code] = this.points.canaux[code] || []).push({ point: x.point, action: x.action, categorie: x.categorie || "", ...(x.canal ? { canal: x.canal } : {}), statut: x.repli ? "propose" : "base" });
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
    const bt = f => `<li class="circ-tung-ligne"><button type="button" class="edit-toggle-btn" data-tung-fiche="${escapeHtml(f.id)}" title="${escapeHtml(Tung.localisation(f) || "Localisation non précisée dans les sources")}">${escapeHtml(f.nom)}${(f.numeros || []).length ? " " + escapeHtml(f.numeros.join("/")) : ""} <span class="muted">${f.canaux.codes.join("+")}</span></button> <span class="circ-tung-action">${escapeHtml(sansHanzi(Tung.action(f)))}</span> <button type="button" class="circ-pt-choisir" data-reseau="${escapeHtml(JSON.stringify({ point: f.nom + ((f.numeros || []).length ? " " + f.numeros.join("/") : ""), canal: (f.canaux.codes || [])[0] || "", raison: sansHanzi(Tung.action(f)), source: "point Tung", tung: true }))}" title="Choisir ce point pour le réseau de la patiente">✓</button></li>`;
    el.innerHTML = (r.ok.length ? `<p class="muted">Leurs canaux sont déjà dans le circuit : ils s'y ajoutent sans le déséquilibrer. Survole un nom pour voir la localisation.</p><ul class="circ-tung-liste">${r.ok.map(bt).join("")}</ul>` : `<p class="muted">Aucun point Tung dont le canal soit dans ce circuit pour l'instant (les canaux se renseignent dans l'onglet Points Tung).</p>`) +
      (r.avec.length ? `<p class="muted">Avec un des ajouts possibles du circuit :</p><ul class="circ-tung-liste">${r.avec.map(bt).join("")}</ul>` : "") +
      (r.collectifs.length ? `<p class="muted">Points qui agissent sur un ensemble de canaux à la fois (ici, les six fu) : à juger selon l'équilibre voulu, car ils touchent aussi les canaux absents du circuit.</p><div class="circ-synd-liste">${r.collectifs.map(f => `<button type="button" class="edit-toggle-btn" data-tung-fiche="${escapeHtml(f.id)}" title="${escapeHtml(Tung.localisation(f) || "Voir la fiche et le schéma")}">${escapeHtml(f.nom)}${(f.numeros || []).length ? " " + escapeHtml(f.numeros.join("/")) : ""}</button>`).join(" ")}</div>` : "");
  },

  // graphe de comparaison (même principe que l'arbre des modifications d'une formule) : à gauche les tableaux et les ajouts,
  // à droite les points (par canal) et les canaux ajoutés ; un point utilisé par plusieurs tableaux reçoit plusieurs traits
  // clé d'un point : son nom seul (« TF 5 (yang WM) », « TF5 » et « TF 5 » sont le même point) ; les remarques entre parenthèses deviennent ses commentaires
  clePoint(p) { return this.pointBase(p).replace(/\s+/g, ""); },
  commentairesDe(p) { return [...String(p).matchAll(/\(([^)]*)\)/g)].map(m => m[1].trim()).filter(Boolean); },
  // découpe « P7 (x, y), P9 » sur les virgules et points-virgules hors parenthèses
  decouperPoints(s) {
    const out = []; let cur = "", prof = 0;
    for (const ch of String(s || "")) {
      if (ch === "(") prof++; else if (ch === ")") prof = Math.max(0, prof - 1);
      if ((ch === "," || ch === ";") && !prof) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  },
  graphe(c) {
    const assoc = c.associations || [], ajouts = (c.ajouts || []).filter(a => (a.canaux || []).length);
    if (!assoc.length && !ajouts.length) return "";
    const points = new Map();
    assoc.forEach((a, i) => Object.entries(a.points || {}).forEach(([code, l]) => (l || []).forEach(p => {
      const k = this.clePoint(p);
      if (!k) return;
      if (!points.has(k)) points.set(k, { code, n: new Set(), notes: new Set(), parTab: new Map() });
      const v = points.get(k);
      v.n.add(i);
      this.commentairesDe(p).forEach(t => { if (!v.parTab.has(i)) v.parTab.set(i, new Set()); v.parTab.get(i).add(t); });
    })));
    points.forEach((v, k) => { const e = this.ptsDe(v.code).find(x => this.clePoint(x.point) === k); if (e && e.commentaire) v.notes.add(e.commentaire); });   // + le commentaire du point dans la liste du canal
    const nomCanal = k => this.nomCanalOuAxe(k);
    const codes = [...new Set([...c.grille, ...[...points.values()].map(v => v.code)])].filter(k => [...points.values()].some(v => v.code === k));
    const canauxAj = [...new Set(ajouts.flatMap(a => a.canaux))];
    const gauche = assoc.map((a, i) => {
      const liens = [...new Set(Object.values(a.points || {}).flat().map(x => this.clePoint(x)).filter(Boolean))].map(x => x + ":+").join(",");
      return `<div class="pm-cond" data-id="a${i}" data-liens="${escapeHtml(liens)}"><div class="pm-si"><span class="pm-si-t">Tableau</span><span class="pm-cond-t">${escapeHtml(sansHanzi(a.tableau))}</span></div>${a.note ? `<div class="pm-principe">${escapeHtml(sansHanzi(a.note))}</div>` : ""}</div>`;
    }).join("") + ajouts.map((a, j) => `<div class="pm-cond circ-ajout-cond" data-id="j${j}" data-liens="${escapeHtml(a.canaux.map(k => k + ":-").join(","))}"><div class="pm-si"><span class="pm-si-t">Ajout</span><span class="pm-cond-t">${escapeHtml(sansHanzi(a.action || a.texte || ""))}</span></div><div class="pm-principe">${escapeHtml(sansHanzi(a.texte || ""))}</div></div>`).join("");
    const droite = codes.map(k => `<div class="pm-groupe">${escapeHtml(k)} · ${escapeHtml(nomCanal(k))}</div>` +
      [...points].filter(([, v]) => v.code === k).map(([pt, v]) => `<div class="pm-sub pm-ajout${v.n.size > 1 ? " circ-commun" : ""}" data-id="s${escapeHtml(pt)}:+" data-cle="${escapeHtml(pt)}:+"><strong>${escapeHtml(pt)}</strong>${v.n.size > 1 ? ` <span class="circ-x">× ${v.n.size}</span>` : ""}${[...v.parTab].map(([i, s]) => ` <span class="circ-note-pt" data-t="${i}">${escapeHtml([...s].join(" · "))}</span>`).join("")}${v.notes.size ? ` <span class="circ-note-pt">${escapeHtml([...v.notes].join(" · "))}</span>` : ""}</div>`).join("")).join("") +
      (canauxAj.length ? `<div class="pm-groupe">Canaux ajoutés</div>` + canauxAj.map(k => `<div class="pm-sub circ-ajout-canal" data-id="s${escapeHtml(k)}:-" data-cle="${escapeHtml(k)}:-"><span class="pm-sens">+ ajout</span> <strong>${escapeHtml(k)}</strong> <span class="muted">${escapeHtml(nomCanal(k))}</span></div>`).join("") : "");
    return `<div class="circ-graphe"><p class="muted pf-legende">Trait plein : point de l'association · trait pointillé : canal ajouté · × n : point commun à plusieurs tableaux. Survole un tableau, un ajout ou un point pour voir ses liens.</p>` +
      `<div class="pm-mm"><svg class="pf-traits" aria-hidden="true"></svg><div class="pm-gauche">${gauche}</div><div class="pm-droite">${droite}</div></div></div>`;
  },
  // remarque d'un point = visible seulement quand le tableau qui la porte est survolé (ou touché, au doigt)
  brancherNotes(racine) {
    racine.querySelectorAll(".circ-graphe .pm-cond[data-id^='a']").forEach(t => {
      const i = t.dataset.id.slice(1), toggler = on => racine.querySelectorAll(`.circ-graphe .circ-note-pt[data-t="${i}"]`).forEach(s => s.classList.toggle("visible", on));
      t.addEventListener("mouseenter", () => toggler(true));
      t.addEventListener("mouseleave", () => { if (!t.classList.contains("epingle")) toggler(false); });
      t.addEventListener("click", () => { const e = t.classList.toggle("epingle"); toggler(e); });
    });
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
  ouvrirFormule(id) { return Onglets.ouvrirFormule(id); },
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
    const w = typeof this.assocActive === "string" ? (this._wjyListe || [])[+this.assocActive.slice(1)] : null;
    const a = w ? { tableau: this.nomRecette(w.r), points: (() => { const o = { ...w.r.canaux }; (w.r.axe || []).forEach(pt => { const k = (pt.match(/^[A-Za-z]+/) || [""])[0].toUpperCase(); (o[k] = o[k] || []).push(pt); }); return o; })() } : (this.assocActive != null ? (c.associations || [])[this.assocActive] : null);
    document.getElementById("circ-dessin").innerHTML = this.dessin(c, { taille: 230, etiquettes: true, legende: true, ajouts: true, points: a ? a.points : null });
    const cle = typeof this.assocActive === "string" ? this.assocActive : (this.assocActive != null ? "a" + this.assocActive : null);
    document.querySelectorAll(".circ-ass-ligne").forEach(r => r.classList.toggle("actif", r.dataset.k === cle));
    document.querySelectorAll(".circ-ass-det").forEach(r => { r.hidden = r.dataset.k !== cle; });
    const det0 = document.getElementById("circ-assoc-detail");
    if (det0) {                                                                  // le détail s'écrit dans la ligne dépliée
      const cible = cle && document.querySelector(`.circ-ass-det[data-k="${cle}"] td`);
      if (cible) cible.appendChild(det0); else { const tb = document.querySelector(".circ-assoc-table"); if (tb) tb.insertAdjacentElement("afterend", det0); }
    }
    const det = document.getElementById("circ-assoc-detail");
    if (!det) return;
    if (!a) { det.innerHTML = ""; return; }
    if (w) { det.innerHTML = this.recetteHtml(w, true); this.annoterCroisements(det); return; }
    const e = a.synd ? this.entreeSynd(a.synd) : null;
    det.innerHTML = `<p>${e ? `<button type="button" class="edit-toggle-btn" data-synd="${escapeHtml(a.synd)}">${escapeHtml(sansHanzi(a.tableau))}</button>` : `<strong>${escapeHtml(sansHanzi(a.tableau))}</strong>`}</p>` +
      `<p>${Object.entries(a.points || {}).map(([k, v]) => `<span class="sx-code">${escapeHtml(k)}</span> ${v.map((p, j) => this.pointHtml(p) + ` <button type="button" class="circ-com-btn" data-k="${escapeHtml(k)}" data-j="${j}" title="Ajouter une remarque sur ce point, pour ce tableau seulement (elle s'affiche entre parenthèses dans le graphe)" aria-label="Remarque sur ${escapeHtml(p)}">💬</button>`).join(", ")}`).join(" · ")}</p>` + (a.note ? `<p class="muted">${escapeHtml(sansHanzi(a.note))}</p>` : "");
    det.querySelectorAll("[data-synd]").forEach(b => b.addEventListener("click", () => { const en = this.entreeSynd(b.dataset.synd); if (en) this.ouvrirSyndrome(en); }));
    det.querySelectorAll(".circ-com-btn").forEach(b => b.addEventListener("click", () => this.commenterAssoc(c, this.assocActive, b.dataset.k, +b.dataset.j, b)));
    this.annoterCroisements(det);
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
    zone.innerHTML = `
      <h2>${d.nouveau ? "Nouveau circuit" : "Modifier : " + escapeHtml(this.nomCourt(c))}</h2>
      <form class="circ-form" id="circ-form">
        <label>Nom du circuit<input type="text" id="ce-nom" value="${escapeHtml(d.nom)}" placeholder="ex : tài yīn / yáng míng"></label>
        <label>Autres intitulés (un par ligne)<textarea id="ce-alias" rows="2">${escapeHtml(d.alias)}</textarea></label>
        <fieldset><legend>Les 4 canaux (ligne du haut : main ; ligne du bas : pied)</legend>
          <div class="circ-selects">${this.PLACES.map((p, i) => `<label>${p}<select data-i="${i}">${opts(d.grille[i])}</select></label>`).join("")}</div>
          <p class="muted" id="ce-alerte"></p>
        </fieldset>
        <p class="muted" id="ce-schema" aria-live="polite"></p>
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
    };
    const apercu = () => {
      lire();
      const g = d.grille;
      const ok = g.every(Boolean) && new Set(g).size === 4;
      document.getElementById("ce-apercu").innerHTML = this.dessin({ grille: g.map(x => x || ""), figure: d.figure }, { taille: 160, etiquettes: true, legende: true });
      const fg = ok ? this.figureDe(g) : null, sch = document.getElementById("ce-schema");
      if (sch) {
        const liens = ok ? g.map(k => g.filter(x => x !== k && (this.SYSTEMES[k] || []).includes(x)).length) : [];
        sch.innerHTML = !ok ? "" : (fg ? `Schéma déduit des connexions entre ces canaux (systèmes de canaux unis) : <strong>${this.NOM_SCHEMA[fg]}</strong> — ${this.DESC_SCHEMA[fg]}.`
          : `Les connexions de ces quatre canaux ne forment aucun des quatre schémas (sablier, papillon, carré, enveloppe) : vérifie le choix des canaux.`) + (liens.some(n => n < 2) ? " Un canal a moins de deux connexions dans ce circuit." : "");
      }
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
      const codes = [...new Set([...d.grille.filter(Boolean), ...this.texteEnAjouts(d.ajouts).flatMap(a => a.canaux), ...d.associations.flatMap(a => Object.keys(a.points)), ...this.AXE])];
      cont.innerHTML = d.associations.map((a, i) => `<div class="circ-assoc-ligne" data-i="${i}">
        <label>Tableau<input type="text" list="ce-synd-noms" data-champ="tableau" value="${escapeHtml(a.tableau)}" placeholder="nom d'un syndrome de ta base, ou ton intitulé"></label>
        <div class="circ-assoc-pts">${codes.map(k => `<label>${escapeHtml(k)}<input type="text" data-pt="${escapeHtml(k)}" value="${escapeHtml(a.points[k] || "")}" placeholder="P7, P9 (commentaire possible)" title="Entre parenthèses : un commentaire sur le point, par exemple TF5 (yáng wéi mài)"></label>`).join("")}</div>
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
    zone.querySelectorAll("select").forEach(el => el.addEventListener("change", apercu));
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
    if (d.champ) {                                   // un seul champ : les autres restent intacts et cachés
      const cible = document.getElementById(d.champ);
      const form = document.getElementById("circ-form");
      [...form.children].forEach(el => { el.hidden = !(el.matches("#ce-statut, .circ-barre") || (cible && el.contains(cible))); });
      const barre = form.querySelector(".circ-barre");
      if (barre) barre.insertAdjacentHTML("beforeend", ` <button type="button" class="edit-toggle-btn" id="ce-tout">Tous les champs</button>`);
      const tout = document.getElementById("ce-tout");
      if (tout) tout.addEventListener("click", () => { lire(); d.champ = null; this.rendreEdition(c); });
      if (cible && cible.focus) cible.focus();
    }
    document.getElementById("circ-form").addEventListener("submit", ev => { ev.preventDefault(); lire(); this.sauver(c); });
  },

  async sauver(c) {
    const d = this.edition, statut = document.getElementById("ce-statut");
    const g = d.grille;
    if (!d.nom.trim()) { statut.textContent = "Le nom du circuit est obligatoire."; return; }
    if (!g.every(Boolean) || new Set(g).size !== 4) { statut.textContent = "Choisis 4 canaux différents."; return; }
    const champs = { nom: d.nom.trim(), alias: this.lignes(d.alias), grille: [...g], figure: this.figureDe(g) || 3, syndromes: this.lignes(d.syndromes), actions: this.lignes(d.actions),
                     ...this.texteEnIndications(d.indications), ajouts: this.texteEnAjouts(d.ajouts, c.ajouts), notes: this.lignes(d.notes), syndromes_lies: [...d.syndromes_lies], niveaux: this.lignes(d.niveaux),
                     associations: (d.associations || []).map(a => {
                       const nom = dsNorm((a.tableau || "").trim()), e = (Syndromes.entries || []).find(x => dsNorm(x.nom) === nom);
                       const o = { tableau: (a.tableau || "").trim(), points: Object.fromEntries(Object.entries(a.points || {}).map(([k, v]) => [k, this.decouperPoints(v)]).filter(([, v]) => v.length)), note: (a.note || "").trim() };
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
