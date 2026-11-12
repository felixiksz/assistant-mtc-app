"use strict";

/* ============================= Réseau de la patiente (fenêtre flottante) =============================
   Pour construire un réseau en consultation : une fenêtre qui reste au-dessus de tout (déplaçable, réductible), où l'on retient les points choisis,
   avec la raison du choix, et où le circuit s'affiche en schéma avec ces points écrits près de chaque canal.
   Les points s'ajoutent avec le bouton ✓ (cartes de points, propositions, recettes de Wang Ju Yi, fiches de points) ou en les tapant dans la fenêtre.
   « Arrêter le réseau » le verrouille (marqué définitif). Plusieurs réseaux peuvent être gardés.
   Données de patiente : gardées UNIQUEMENT dans ce navigateur (stockage local), jamais écrites dans le dépôt ni synchronisées.
   Dépend de app.js : escapeHtml ; de circuits.js : Circuits (dessin du circuit). */

const Reseau = {
  CLE_ETAT: "reseau_patiente_v1",
  CLE_ARCHIVES: "reseau_archives_v1",
  CLE_FENETRE: "reseau_fenetre_v1",
  etat: { patiente: "", circuit: null, verrou: false, points: [] },
  archives: [],
  hist: [], futur: [],                 // annuler / rétablir (en mémoire seulement)
  fenetre: { ouvert: false, reduit: false, x: null, y: null },

  // ---------- mémoire locale
  lire(cle, defaut) { try { const v = JSON.parse(localStorage.getItem(cle) || "null"); return v == null ? defaut : v; } catch (e) { return defaut; } },
  ecrire(cle, v) { try { localStorage.setItem(cle, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
  sauver() { this.etat.maj = Date.now(); this.ecrire(this.CLE_ETAT, this.etat); this.majLanceur(); },

  snap() { this.hist.push(JSON.stringify(this.etat)); if (this.hist.length > 60) this.hist.shift(); this.futur = []; },
  annuler() { if (!this.hist.length) return; this.futur.push(JSON.stringify(this.etat)); this.etat = JSON.parse(this.hist.pop()); this.sauver(); this.rendre(); },
  refaire() { if (!this.futur.length) return; this.hist.push(JSON.stringify(this.etat)); this.etat = JSON.parse(this.futur.pop()); this.sauver(); this.rendre(); },
  // points favoris (★) des canaux du circuit, d'un clic : ils s'ajoutent tous, ceux déjà présents sont ignorés
  ajouterFavoris() {
    const c = this.etat.circuit && typeof Circuits !== "undefined" ? Circuits.parId(this.etat.circuit) : null;
    if (!c) { this.avertir("Choisis d'abord un circuit."); return; }
    if (this.etat.verrou) { this.avertir("Le réseau est arrêté."); return; }
    const codes = [...new Set([...c.grille, ...(c.ajouts || []).flatMap(a => a.canaux || []), ...Circuits.AXE])];
    const liste = codes.flatMap(k => Circuits.ptsAffiches(k, c).filter(x => Circuits.retenu(x)).map(x => ({ point: x.point, canal: x.canal || k, raison: x.action || "", source: "favoris" })));
    const nouveaux = liste.filter(x => !this.etat.points.some(p => this.cleP(p.point) === this.cleP(x.point)));
    if (!nouveaux.length) { this.avertir(liste.length ? "Tes favoris sont déjà tous dans le réseau." : "Aucun point favori (★) dans les canaux de ce circuit."); return; }
    this.snap();
    nouveaux.forEach(x => this.etat.points.push({ id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), point: String(x.point).replace(/\s+/g, ""), canal: x.canal || this.canalDe(x.point), cote: "", raison: x.raison, source: x.source, tung: false }));
    this.sauver(); this.rendre(); this.avertir(nouveaux.length + " point(s) favori(s) ajouté(s).");
  },
  cleP(s) { return String(s || "").toUpperCase().replace(/[\s.\-]/g, ""); },
  ALIAS: { SI: "IG", LI: "GI", SP: "RT", UB: "V", BL: "V", KI: "RN", LU: "P", HT: "C", ST: "E", GB: "VB", LR: "F", LV: "F", CV: "RM", GV: "DM", PC: "EC", SJ: "TF" },
  canalDe(point) {
    const m = this.cleP(point).match(/^([A-Z]+)\d/);
    if (!m) return "";
    const k = this.ALIAS[m[1]] || m[1];
    const sigles = { RN: "Rn", RT: "Rt" };
    return sigles[k] || k;
  },

  // ---------- ordre d'affichage : par canal (ceux du circuit d'abord, dans l'ordre du schéma), puis par numéro ; les points Tung à la fin, par numéro
  ORDRE_CANAUX: ["P", "GI", "E", "Rt", "C", "IG", "V", "Rn", "EC", "TF", "VB", "F", "RM", "DM"],
  numeroDe(point) {
    const d = String(point).match(/(\d+)\.(\d+)/);                 // numéro Tung : 22.06
    if (d) return parseFloat(d[1] + "." + d[2].padStart(2, "0"));
    const n = String(point).match(/(\d+)\s*$/) || String(point).match(/(\d+)/);
    return n ? parseInt(n[1], 10) : 1e9;
  },
  ordonne(e) {
    e = e || this.etat;
    const c = e.circuit && typeof Circuits !== "undefined" ? Circuits.parId(e.circuit) : null;
    const grille = c ? c.grille : [];
    const rang = k => { const i = grille.indexOf(k); if (i >= 0) return i; const j = this.ORDRE_CANAUX.indexOf(k); return j >= 0 ? 100 + j : 999; };
    return [...e.points].sort((a, b) =>
      (a.tung ? 1 : 0) - (b.tung ? 1 : 0) ||
      (a.tung ? 0 : rang(a.canal) - rang(b.canal)) ||
      this.numeroDe(a.point) - this.numeroDe(b.point) ||
      String(a.point).localeCompare(String(b.point), "fr"));
  },

  // ---------- ajouter / retirer
  ajouter(p) {
    if (this.etat.verrou) { this.ouvrir(); this.avertir("Le réseau est arrêté : déverrouille-le pour ajouter un point."); return; }
    const nom = String(p.point || "").trim();
    if (!nom) return;
    const deja = this.etat.points.find(x => this.cleP(x.point) === this.cleP(nom));
    if (!this.etat.circuit && p.circuit) this.etat.circuit = p.circuit;
    if (!this.etat.circuit && typeof Circuits !== "undefined" && document.getElementById("tab-circuits") && document.getElementById("tab-circuits").classList.contains("active") && Circuits.actif && Circuits.parId(Circuits.actif)) this.etat.circuit = Circuits.actif;
    if (deja) { this.ouvrir(); this.avertir(nom + " est déjà dans le réseau."); this.surligner(deja.id); return; }
    const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    this.snap();
    this.etat.points.push({ id, point: nom, canal: p.canal || (p.tung ? "" : this.canalDe(nom)), cote: "", raison: p.raison || "", source: p.source || "", tung: !!p.tung });
    this.sauver();
    this.ouvrir();
    this.surligner(id);
  },
  // ---------- consultation : le diagnostic (syndromes) et les formules, à côté du circuit et des points
  aContenu(e) { e = e || this.etat; return !!((e.points || []).length || (e.diagnostic || []).length || (e.formules || []).length); },
  syndDe(k) { return typeof Syndromes !== "undefined" ? (Syndromes.entries || []).find(x => x.domaine + "/" + x.chemin === k) || null : null; },
  formDe(id) { return typeof Formules !== "undefined" && Formules.byId ? Formules.byId.get(id) || null : null; },
  ajouterA(champ, k, nom) {
    if (this.etat.verrou) { this.ouvrir(); this.avertir("La consultation est arrêtée : déverrouille-la pour la modifier."); return; }
    const l = this.etat[champ] = this.etat[champ] || [];
    if (l.includes(k)) { this.ouvrir(); this.avertir(nom + " est déjà dans la consultation."); return; }
    this.snap(); l.push(k); this.sauver(); this.ouvrir();
  },
  ajouterDiagnostic(entry) { if (entry) this.ajouterA("diagnostic", entry.domaine + "/" + entry.chemin, entry.nom); },
  ajouterFormule(id) { const f = this.formDe(id); this.ajouterA("formules", id, f ? (f.pinyin || id) : id); },
  choisirCircuit(id) {
    if (this.etat.verrou) { this.ouvrir(); this.avertir("La consultation est arrêtée : déverrouille-la pour la modifier."); return; }
    if (this.etat.circuit !== id) { this.snap(); this.etat.circuit = id; this.sauver(); }
    this.ouvrir();
  },
  retirerDe(champ, k) { this.snap(); this.etat[champ] = (this.etat[champ] || []).filter(x => x !== k); this.sauver(); this.rendre(); },
  // bouton « ＋ Consultation » des fiches
  bouton(action, titre) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "cmp-add consult-add"; b.textContent = "＋ Consultation"; b.title = titre || "Ajouter à la consultation en cours";
    b.addEventListener("click", ev => { ev.stopPropagation(); action(); });
    return b;
  },
  // ce que le diagnostic suggère : les circuits que le traitement des syndromes désigne (ou que tu leur as rattachés), et les formules de leur pharmacopée
  async suggestions() {
    const diag = this.etat.diagnostic || [], res = { circuits: [], formules: [] };
    if (!diag.length) return res;
    try {
      if (typeof Circuits !== "undefined") {
        const m = await Circuits.syndromesParCircuit();
        Circuits.liste.forEach(c => { if (diag.some(k => (m.get(c.id) || []).includes(k) || (c.syndromes_lies || []).includes(k))) res.circuits.push(c.id); });
      }
    } catch (e) { /* circuits indisponibles */ }
    const cle = t => normalizeSearch(sansChinois(String(t || ""))), parNom = new Map();
    (Formules.index || []).forEach(f => { if (f.pinyin) parNom.set(cle(f.pinyin), f.id); });
    await Promise.all(diag.map(async k => {
      let d; try { d = await Store.readJSON("syndromes/" + k); } catch (e) { return; }
      (function marche(o) { if (Array.isArray(o)) o.forEach(marche); else if (o && typeof o === "object") { if (typeof o.nom_pinyin === "string") { const id = parNom.get(cle(o.nom_pinyin)); if (id && !res.formules.includes(id)) res.formules.push(id); } Object.values(o).forEach(marche); } })(d);
    }));
    return res;
  },

  // ---------- points Tung : reconnus par leur nom, un alias ou un numéro (Shui Jin, 77.08…)
  codePoint(t) { return /^[A-Za-z]{1,3}\s?\.?\s?\d{1,2}$/.test(String(t).trim()); },
  nomTung(f) { return f.nom + ((f.numeros || []).length ? " " + f.numeros.join("/") : ""); },
  async suggererTung(t) {
    if (typeof Tung === "undefined") return [];
    try { await Tung.ensureLoaded(); } catch (e) { return []; }
    const n = dsNorm(t), m = n.split(/\s+/).filter(Boolean);
    if (!m.length) return [];
    const cle = Tung.cleNom(t);
    const sc = f => {
      const noms = [f.nom, ...(f.alias || []), ...(f.numeros || [])].map(x => Tung.cleNom(x));
      if (noms.some(x => x === cle)) return 0;
      if (noms.some(x => x.startsWith(cle))) return 1;
      const h = dsNorm([f.nom, f.zh, f.trad, ...(f.numeros || []), ...(f.alias || [])].join(" "));
      return m.every(x => h.includes(x)) ? 2 : 9;
    };
    return Tung.liste.map(f => ({ f, s: sc(f) })).filter(x => x.s < 9).sort((a, b) => a.s - b.s || a.f.nom.localeCompare(b.f.nom, "fr")).slice(0, 8).map(x => x.f);
  },
  ajouterTung(f) {
    this.ajouter({ point: this.nomTung(f), canal: ((f.canaux || {}).codes || [])[0] || "", raison: typeof Tung.action === "function" ? sansHanzi(Tung.action(f)) : "", source: "point Tung", tung: true });
  },
  retirer(id) { this.snap(); this.etat.points = this.etat.points.filter(x => x.id !== id); this.sauver(); this.rendre(); },
  maj(id, champs) { const x = this.etat.points.find(y => y.id === id); if (x) { Object.assign(x, champs); this.sauver(); } },
  surligner(id) { setTimeout(() => { const l = document.querySelector('#reseau-fenetre [data-id="' + id + '"]'); if (l) { l.classList.add("reseau-nouveau"); l.scrollIntoView({ block: "nearest" }); setTimeout(() => l.classList.remove("reseau-nouveau"), 1600); } }, 60); },
  avertir(t) { const a = document.getElementById("reseau-avis"); if (a) { a.textContent = t; setTimeout(() => { if (a.textContent === t) a.textContent = ""; }, 3500); } },

  // ---------- fenêtre
  creer() {
    if (document.getElementById("reseau-fenetre")) return;
    const bouton = document.createElement("button");
    bouton.type = "button"; bouton.id = "reseau-lanceur"; bouton.className = "reseau-lanceur";
    bouton.addEventListener("click", () => (this.fenetre.ouvert ? this.fermer() : this.ouvrir()));
    document.body.appendChild(bouton);
    const f = document.createElement("div");
    f.id = "reseau-fenetre"; f.className = "reseau-fenetre"; f.hidden = true;
    f.setAttribute("role", "dialog"); f.setAttribute("aria-label", "Consultation : diagnostic, circuit et points, formule");
    document.body.appendChild(f);
    this.majLanceur();
  },
  majLanceur() {
    const b = document.getElementById("reseau-lanceur");
    if (!b) return;
    const n = this.etat.points.length, na = this.archives.length, nd = (this.etat.diagnostic || []).length, nf = (this.etat.formules || []).length;
    b.textContent = "📋 Consultation" + [nd ? nd + " synd." : "", n ? n + " pt" + (n > 1 ? "s" : "") : "", nf ? nf + " form." : ""].filter(Boolean).map(x => " · " + x).join("") + (this.etat.verrou ? " 🔒" : "");
    b.title = "Consultation en cours : " + nd + " syndrome(s), " + n + " point(s), " + nf + " formule(s)" + (na ? " ; " + na + " consultation(s) enregistrée(s)" : "");
  },
  large() { return window.matchMedia("(min-width: 1100px)").matches; },
  ouvrir() { this.fenetre.ouvert = true; this.ecrire(this.CLE_FENETRE, this.fenetre); this.rendre(); },
  fermer() { this.fenetre.ouvert = false; this.ecrire(this.CLE_FENETRE, this.fenetre); this.rendre(); },
  reduire() { this.fenetre.reduit = !this.fenetre.reduit; this.ecrire(this.CLE_FENETRE, this.fenetre); this.rendre(); },

  // ---------- résumé texte (à copier dans le dossier)
  resume(e) {
    e = e || this.etat;
    const c = e.circuit && typeof Circuits !== "undefined" ? Circuits.parId(e.circuit) : null;
    const d = new Date().toLocaleDateString("fr-FR");
    const l = ["Consultation — " + (e.patiente || "patiente") + " — " + d + (e.verrou ? " (arrêtée)" : "")];
    if ((e.diagnostic || []).length) l.push("Diagnostic : " + e.diagnostic.map(k => { const s = this.syndDe(k); return s ? sansChinois(s.nom) : k; }).join(" ; "));
    l.push(c ? "Circuit : " + Circuits.nomCourt(c) + " (" + c.grille.join(", ") + ")" : "Circuit : non choisi");
    if ((e.points || []).length) l.push("");
    this.ordonne(e).forEach(p => l.push("• " + p.point + (p.cote ? " (" + p.cote + ")" : "") + (p.raison ? " : " + p.raison : "")));
    if ((e.formules || []).length) l.push("", "Formule(s) : " + e.formules.map(id => { const f = this.formDe(id); return f ? (f.pinyin || id) : id; }).join(" ; "));
    return l.join("\n");
  },

  // ---------- schéma : le circuit avec les points choisis écrits près de chaque canal
  schema() {
    const c = this.etat.circuit && typeof Circuits !== "undefined" ? Circuits.parId(this.etat.circuit) : null;
    if (!c) return `<p class="muted">Choisis un circuit pour voir le schéma.</p>`;
    const pts = {}, horsGrille = {}, tung = [], libelles = {};
    this.ordonne().forEach(p => {
      const k = p.canal;
      if (p.tung) {
        // un point Tung rattaché à un canal s'écrit à la place de ce canal, comme les autres points (son nom sans le numéro) ; sans canal, il est listé sous le schéma
        if (!k || !Circuits.canaux.has(k)) { tung.push(p.point); return; }
        const court = p.point.replace(/\s+\d[\d./]*$/, "").trim() || p.point;
        libelles[Circuits.clePoint(p.point)] = court.length > 16 ? court.slice(0, 15) + "…" : court;
        if (c.grille.includes(k)) (pts[k] = pts[k] || []).push(p.point); else (horsGrille[k] = horsGrille[k] || []).push(p.point);
        return;
      }
      if (!k) return;
      if (c.grille.includes(k)) (pts[k] = pts[k] || []).push(p.point.replace(/\s+/g, ""));
      else (horsGrille[k] = horsGrille[k] || []).push(p.point.replace(/\s+/g, ""));
    });
    const extras = Object.keys(horsGrille).filter(k => Circuits.canaux.has(k));
    // tous les ajouts possibles du circuit sont dessinés (rond pointillé vide s'ils n'ont pas de point), plus les canaux hors circuit qui portent des points
    const groupes = (c.ajouts || []).filter(x => (x.canaux || []).length).map(x => ({ canaux: x.canaux, ensemble: x.ensemble, action: "" }));
    const dessines = new Set(groupes.flatMap(x => x.canaux));
    const pseudo = { grille: c.grille, figure: c.figure, ajouts: [...groupes, ...extras.filter(k => !dessines.has(k)).map(k => ({ canaux: [k], action: "" }))] };
    ["RM", "DM"].forEach(k => { if (horsGrille[k]) pts[k] = horsGrille[k]; });                 // l'axe s'écrit sous le dessin
    extras.forEach(k => { pts[k] = horsGrille[k]; });                                             // un canal ajouté devient une bulle, avec ses points dedans
    const svg = Circuits.dessin(pseudo, { taille: 180, etiquettes: true, points: pts, libelles, ajouts: !!pseudo.ajouts.length });
    const hors = Object.entries(horsGrille).filter(([k]) => k !== "RM" && k !== "DM" && !extras.includes(k)).map(([k, l]) => `<span class="sx-code">${escapeHtml(k)}</span> ${escapeHtml(l.join(", "))}`).join(" · ");
    return `<div class="reseau-schema">${svg}</div>` + (hors ? `<p class="muted reseau-hors">Hors des quatre canaux : ${hors}</p>` : "") + (tung.length ? `<p class="reseau-hors reseau-tung"><strong>Points Tung sans canal</strong><br>${tung.map(escapeHtml).join("<br>")}</p>` : "");
  },

  vue: "reseau",          // onglet de la fenêtre : « reseau » (en cours) ou « archives » (enregistrés)

  // réseau en cours identique à son enregistrement ? (pour ne rien perdre sans demander)
  identique(a, b) { const n = x => JSON.stringify({ ...x, maj: 0, archiveId: 0 }); return n(a) === n(b); },
  // garde le réseau en cours parmi les enregistrés (mis à jour s'il en vient déjà)
  archiver() {
    const e = this.etat;
    if (!this.aContenu(e)) return null;
    const existant = e.archiveId ? this.archives.find(a => a.id === e.archiveId) : null;
    if (existant && this.identique(existant.etat, e)) return existant;
    const id = e.archiveId || "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const entree = { id, nom: (e.patiente || "Sans nom").trim(), date: new Date().toLocaleString("fr-FR"), etat: { ...JSON.parse(JSON.stringify(e)), archiveId: id } };
    if (existant) this.archives.splice(this.archives.indexOf(existant), 1);
    this.archives.unshift(entree);
    this.archives = this.archives.slice(0, 50);
    this.ecrire(this.CLE_ARCHIVES, this.archives);
    this.etat.archiveId = id; this.sauver();
    return entree;
  },

  rendre() {
    this.creer();
    const f = document.getElementById("reseau-fenetre");
    f.hidden = !this.fenetre.ouvert;
    // sur grand écran, la consultation peut rester ancrée à droite, sur toute la hauteur : le reste de la page se resserre à côté
    const large = this.large(), ancree = large && !!this.fenetre.ancre && this.fenetre.ouvert;
    this._large = large;
    document.body.classList.toggle("consult-ancree", ancree);
    f.classList.toggle("ancree", ancree);
    f.classList.toggle("reseau-reduit", !!this.fenetre.reduit && !ancree);
    if (!this.fenetre.ouvert) return;
    if (ancree) { f.style.left = f.style.top = f.style.right = f.style.bottom = ""; f.style.width = f.style.height = ""; }
    else if (this.fenetre.x != null) { f.style.left = this.fenetre.x + "px"; f.style.top = this.fenetre.y + "px"; f.style.right = "auto"; f.style.bottom = "auto"; }
    const e = this.etat, verrou = e.verrou, dis = verrou ? " disabled" : "";
    const circuits = typeof Circuits !== "undefined" && Circuits.liste ? Circuits.liste : [];
    const nbA = this.archives.length, nbP = e.points.length;
    const COTES = [["D", "D"], ["G", "G"], ["D + G", "D+G"]];
    const lignes = this.ordonne().map(p => `<li class="reseau-ligne" data-id="${escapeHtml(p.id)}">
        <div class="reseau-ligne-tete"><span class="sx-code">${escapeHtml(p.canal || "?")}</span> ${p.tung ? `<strong>${escapeHtml(p.point)}</strong>` : `<a href="#" class="circ-ptlien" data-pt-fiche="${escapeHtml(p.point)}" title="Ouvrir la fiche du point dans un nouvel onglet"><strong>${escapeHtml(p.point)}</strong></a>`}
          ${p.canal === "RM" || p.canal === "DM" ? `<span class="muted reseau-median">ligne médiane</span>` : `<span class="reseau-cotes" role="group" aria-label="Côté">${COTES.map(([v, l]) => `<button type="button" class="reseau-cote-btn${p.cote === v ? " on" : ""}" data-cote="${v}" aria-pressed="${p.cote === v}"${dis}>${l}</button>`).join("")}</span>`}
          ${verrou ? "" : `<button type="button" class="reseau-x" data-x="${escapeHtml(p.id)}" title="Retirer du réseau" aria-label="Retirer ${escapeHtml(p.point)} du réseau">✕</button>`}</div>
        <textarea class="reseau-raison" rows="1" placeholder="Raison du choix…"${dis}>${escapeHtml(p.raison)}</textarea>
      </li>`).join("");
    const nomCirc = a => { const c = a.circuit && typeof Circuits !== "undefined" ? Circuits.parId(a.circuit) : null; return c ? Circuits.nomCourt(c) : ""; };
    const arch = this.archives.map((a, i) => `<li class="reseau-arch${e.archiveId === a.id ? " en-cours" : ""}">
        <div class="reseau-arch-texte"><strong>${escapeHtml(a.nom)}</strong>${a.etat.verrou ? " 🔒" : ""}${e.archiveId === a.id ? ` <span class="reseau-arch-tag">en cours</span>` : ""}
          <span class="muted">${escapeHtml(a.date)} · ${(a.etat.diagnostic || []).length ? a.etat.diagnostic.length + " syndrome(s) · " : ""}${a.etat.points.length} point(s)${nomCirc(a.etat) ? " · " + escapeHtml(nomCirc(a.etat)) : ""}${(a.etat.formules || []).length ? " · " + a.etat.formules.length + " formule(s)" : ""}</span>
          <span class="reseau-arch-pts">${this.ordonne(a.etat).map(p => escapeHtml(p.point)).join(" · ")}</span></div>
        <div class="reseau-arch-btns"><button type="button" class="reseau-ic2" data-ouvrir="${i}" title="Ouvrir ce réseau" aria-label="Ouvrir ce réseau">↗</button><button type="button" class="reseau-ic2" data-copier="${i}" title="Copier le résumé" aria-label="Copier le résumé">📄</button><button type="button" class="reseau-ic2" data-suppr="${i}" title="Supprimer" aria-label="Supprimer ce réseau enregistré">🗑</button></div></li>`).join("");
    const blocs = { diag: true, circ: true, form: true, ...(this.fenetre.blocs || {}) };
    const diag = e.diagnostic || [], forms = e.formules || [];
    const puceS = k => { const s = this.syndDe(k); return `<span class="consult-chip"><button type="button" class="consult-nom" data-diag-o="${escapeHtml(k)}" title="Ouvrir la fiche dans un onglet">${escapeHtml(s ? sansChinois(s.nom) : k)}</button>${verrou ? "" : `<button type="button" class="consult-x" data-diag-x="${escapeHtml(k)}" aria-label="Retirer du diagnostic">✕</button>`}</span>`; };
    const puceF = id => { const fo = this.formDe(id); return `<span class="consult-chip"><button type="button" class="consult-nom" data-form-o="${escapeHtml(id)}" title="Ouvrir la fiche dans un onglet">${escapeHtml(fo ? (fo.pinyin || id) : id)}</button><button type="button" class="consult-x" data-form-rx="${escapeHtml(id)}" title="Prescrire : format et prix selon le budget" aria-label="Prescrire cette formule">℞</button>${verrou ? "" : `<button type="button" class="consult-x" data-form-x="${escapeHtml(id)}" aria-label="Retirer la formule">✕</button>`}</span>`; };
    const bloc = (cle, titre, n, corps) => `<details class="consult-bloc" data-bloc="${cle}"${blocs[cle] ? " open" : ""}><summary>${titre} <span class="reseau-n">${n}</span></summary>${corps}</details>`;
    const corpsEnCours = `
        <div class="reseau-rang">
          <input type="text" id="reseau-nom" class="reseau-nom" value="${escapeHtml(e.patiente)}" placeholder="Patiente (initiales)" aria-label="Patiente (initiales ou repère)"${dis}>
        </div>
        ${bloc("diag", "1 · Diagnostic", diag.length, `
          <div class="consult-chips">${diag.map(puceS).join("") || `<span class="muted">Aucun syndrome : cherche-le ci-dessous, ou utilise « ＋ Consultation » sur une fiche.</span>`}</div>
          ${verrou ? "" : `<input type="search" id="consult-synd-q" class="consult-q" placeholder="Ajouter un syndrome…" autocomplete="off" aria-label="Ajouter un syndrome au diagnostic"><ul id="consult-synd-sugg" class="prop-sugg reseau-sugg"></ul>`}`)}
        ${bloc("circ", "2 · Circuit et points", nbP, `
          <div id="consult-sugg-circ" class="consult-sugg"></div>
          <div class="reseau-rang"><select id="reseau-circuit" aria-label="Circuit"${dis}><option value="">Circuit…</option>${circuits.map(c => `<option value="${escapeHtml(c.id)}"${e.circuit === c.id ? " selected" : ""}>${escapeHtml(Circuits.nomCourt(c))} (${c.grille.join(" ")})</option>`).join("")}</select></div>
          <details class="reseau-schema-d"${this.fenetre.schemaFerme ? "" : " open"}><summary>Schéma</summary><div id="reseau-schema">${this.schema()}</div></details>
          <ul class="reseau-liste">${lignes || `<li class="muted reseau-vide">Aucun point : utilise le ✓ à côté d'un point, ou tape-le ci-dessous.</li>`}</ul>
          ${verrou ? "" : `<form id="reseau-ajout" class="reseau-ajout"><input type="text" id="reseau-point" placeholder="Ajouter un point (ex. TF5, Rt 4, Shui Jin)" autocomplete="off"><button type="submit" class="reseau-ic2" title="Ajouter" aria-label="Ajouter ce point">＋</button></form><ul id="reseau-sugg" class="prop-sugg reseau-sugg"></ul>`}`)}
        ${bloc("form", "3 · Formule", forms.length, `
          <div id="consult-sugg-form" class="consult-sugg"></div>
          <div class="consult-chips">${forms.map(puceF).join("") || `<span class="muted">Aucune formule.</span>`}</div>
          ${verrou ? "" : `<input type="search" id="consult-form-q" class="consult-q" placeholder="Ajouter une formule…" autocomplete="off" aria-label="Ajouter une formule"><ul id="consult-form-sugg" class="prop-sugg reseau-sugg"></ul>`}`)}
        <p id="reseau-avis" class="muted reseau-avis" aria-live="polite"></p>
        <div class="reseau-barre">
          <button type="button" class="reseau-ic2" id="reseau-annuler" title="Annuler la dernière modification (Ctrl+Z)" aria-label="Annuler"${this.hist.length ? "" : " disabled"}>↶</button>
          <button type="button" class="reseau-ic2" id="reseau-refaire" title="Rétablir (Ctrl+Y)" aria-label="Rétablir"${this.futur.length ? "" : " disabled"}>↷</button>
          <button type="button" class="reseau-ic2" id="reseau-favoris" title="Ajouter d'un clic tes points favoris (★) des canaux du circuit" aria-label="Ajouter les points favoris"${verrou ? " disabled" : ""}>★</button>
          <span class="reseau-barre-vide"></span>
          <button type="button" class="reseau-ic2" id="reseau-enreg" title="Enregistrer cette consultation" aria-label="Enregistrer cette consultation">💾</button>
          <button type="button" class="reseau-ic2" id="reseau-copier" title="Copier le résumé" aria-label="Copier le résumé">📄</button>
          <button type="button" class="reseau-ic2" id="reseau-verrou" title="${verrou ? "Rouvrir la consultation" : "Arrêter la consultation (définitif)"}" aria-label="${verrou ? "Rouvrir la consultation" : "Arrêter la consultation"}">${verrou ? "🔓" : "🔒"}</button>
          <button type="button" class="reseau-ic2" id="reseau-nouveau" title="Nouvelle consultation (celle-ci est gardée dans les enregistrées)" aria-label="Nouvelle consultation">🆕</button>
        </div>`;
    const corpsArchives = `<ul class="reseau-archives-liste">${arch || `<li class="muted reseau-vide">Aucune consultation enregistrée. Le bouton 💾 de l'onglet « En cours » la garde, et « Nouveau » la garde aussi avant de repartir à zéro.</li>`}</ul>`;
    f.innerHTML = `
      <div class="reseau-tete" id="reseau-tete"><strong>📋 Consultation${e.patiente ? " — " + escapeHtml(e.patiente) : ""}${verrou ? " 🔒" : ""}</strong>
        <span>${large ? `<button type="button" class="reseau-ic" id="reseau-ancrer" title="${ancree ? "Détacher : fenêtre flottante, déplaçable" : "Ancrer à droite, sur toute la hauteur"}" aria-label="${ancree ? "Détacher la consultation" : "Ancrer la consultation à droite"}" aria-pressed="${ancree}">${ancree ? "⇱" : "⇥"}</button>` : ""}<button type="button" class="reseau-ic" id="reseau-reduire"${ancree ? " hidden" : ""} title="${this.fenetre.reduit ? "Agrandir" : "Réduire"}" aria-label="${this.fenetre.reduit ? "Agrandir" : "Réduire"}">${this.fenetre.reduit ? "▢" : "—"}</button><button type="button" class="reseau-ic" id="reseau-fermer" title="Fermer (la consultation est conservée)" aria-label="Fermer">✕</button></span></div>
      <div class="reseau-onglets" role="tablist">
        <button type="button" role="tab" class="reseau-onglet${this.vue === "reseau" ? " actif" : ""}" data-vue="reseau">En cours <span class="reseau-n">${nbP}</span></button>
        <button type="button" role="tab" class="reseau-onglet${this.vue === "archives" ? " actif" : ""}" data-vue="archives">Enregistrés <span class="reseau-n">${nbA}</span></button>
      </div>
      <div class="reseau-corps">
        ${this.vue === "archives" ? corpsArchives : corpsEnCours}
        <p class="muted reseau-confid">Données gardées uniquement dans ce navigateur : jamais envoyées au dépôt ni synchronisées.</p>
      </div>`;
    this.brancher(f);
    f.querySelectorAll(".reseau-raison").forEach(t => { t.style.height = "auto"; t.style.height = Math.max(t.scrollHeight, 28) + "px"; });
    if (this.vue === "reseau" && typeof Circuits !== "undefined" && Circuits.annoterCroisements) Circuits.annoterCroisements(f);
    if (typeof Circuits !== "undefined" && Circuits.chargerInter && !Circuits._mouvPret) Circuits.chargerInter().then(() => { const z = document.getElementById("reseau-schema"); if (z) z.innerHTML = this.schema(); });
  },

  brancher(f) {
    const q = s => f.querySelector(s);
    q("#reseau-fermer").addEventListener("click", () => this.fermer());
    q("#reseau-reduire").addEventListener("click", () => this.reduire());
    const anc = q("#reseau-ancrer"); if (anc) anc.addEventListener("click", () => { this.fenetre.ancre = !this.fenetre.ancre; this.ecrire(this.CLE_FENETRE, this.fenetre); this.rendre(); });
    f.querySelectorAll("[data-vue]").forEach(b => b.addEventListener("click", () => { this.vue = b.dataset.vue; this.rendre(); }));
    // déplacement par la barre de titre (souris ou doigt)
    const tete = q("#reseau-tete");
    tete.addEventListener("pointerdown", ev => {
      if (ev.target.closest("button") || f.classList.contains("ancree")) return;
      const r = f.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top;
      tete.setPointerCapture(ev.pointerId);
      const bouge = e2 => {
        const x = Math.max(0, Math.min(window.innerWidth - 80, e2.clientX - dx)), y = Math.max(0, Math.min(window.innerHeight - 40, e2.clientY - dy));
        f.style.left = x + "px"; f.style.top = y + "px"; f.style.right = "auto"; f.style.bottom = "auto";
        this.fenetre.x = x; this.fenetre.y = y;
      };
      const fin = () => { tete.removeEventListener("pointermove", bouge); tete.removeEventListener("pointerup", fin); this.ecrire(this.CLE_FENETRE, this.fenetre); };
      tete.addEventListener("pointermove", bouge); tete.addEventListener("pointerup", fin);
    });
    const copier = async t => { try { await navigator.clipboard.writeText(t); this.avertir("Résumé copié."); } catch (e) { window.prompt("Copie le résumé :", t); } };
    if (this.vue === "archives") {
      f.querySelectorAll("[data-ouvrir]").forEach(b => b.addEventListener("click", () => {
        const cible = this.archives[+b.dataset.ouvrir];
        if (!cible) return;
        if (this.etat.archiveId !== cible.id) this.archiver();          // le réseau en cours n'est pas perdu
        this.etat = { patiente: "", circuit: null, verrou: false, points: [], diagnostic: [], formules: [], ...JSON.parse(JSON.stringify(cible.etat)), archiveId: cible.id };
        this.vue = "reseau"; this.sauver(); this.rendre();
      }));
      f.querySelectorAll("[data-copier]").forEach(b => b.addEventListener("click", () => { const a = this.archives[+b.dataset.copier]; if (a) copier(this.resume(a.etat)); }));
      f.querySelectorAll("[data-suppr]").forEach(b => b.addEventListener("click", () => {
        const a = this.archives[+b.dataset.suppr];
        if (!a || !confirm("Supprimer le réseau enregistré « " + a.nom + " » ? Cela ne peut pas être annulé.")) return;
        this.archives.splice(+b.dataset.suppr, 1);
        if (this.etat.archiveId === a.id) { delete this.etat.archiveId; this.sauver(); }
        this.ecrire(this.CLE_ARCHIVES, this.archives); this.rendre();
      }));
      return;
    }
    q("#reseau-nom").addEventListener("input", ev => { this.etat.patiente = ev.target.value; this.sauver(); const t = q("#reseau-tete strong"); if (t) t.textContent = "📋 Consultation" + (this.etat.patiente ? " — " + this.etat.patiente : "") + (this.etat.verrou ? " 🔒" : ""); });
    q("#reseau-circuit").addEventListener("change", ev => { this.etat.circuit = ev.target.value || null; this.sauver(); q("#reseau-schema").innerHTML = this.schema(); });
    f.querySelectorAll(".consult-bloc").forEach(b => b.addEventListener("toggle", () => { this.fenetre.blocs = { ...(this.fenetre.blocs || {}), [b.dataset.bloc]: b.open }; this.ecrire(this.CLE_FENETRE, this.fenetre); }));
    f.querySelectorAll("[data-diag-o]").forEach(b => b.addEventListener("click", () => { const s = this.syndDe(b.dataset.diagO); if (s) Onglets.ouvrirSyndrome(s); }));
    f.querySelectorAll("[data-diag-x]").forEach(b => b.addEventListener("click", () => this.retirerDe("diagnostic", b.dataset.diagX)));
    f.querySelectorAll("[data-form-o]").forEach(b => b.addEventListener("click", () => Onglets.ouvrirFormule(b.dataset.formO)));
    f.querySelectorAll("[data-form-x]").forEach(b => b.addEventListener("click", () => this.retirerDe("formules", b.dataset.formX)));
    f.querySelectorAll("[data-form-rx]").forEach(b => b.addEventListener("click", () => Onglets.ouvrirPrescription(null, { etat: { formule: b.dataset.formRx } })));
    const chercher = (champId, listeId, trouver, ajouter) => {
      const ch = q(champId), ul = q(listeId);
      if (!ch) return;
      ch.addEventListener("input", () => {
        const mots = dsNorm(ch.value.trim()).split(/\s+/).filter(Boolean);
        if (!mots.length) { ul.innerHTML = ""; return; }
        const l = trouver(mots).slice(0, 8);
        ul.innerHTML = l.map((x, i) => `<li data-i="${i}"><strong>${escapeHtml(x.titre)}</strong> <span class="muted">${escapeHtml(x.sous || "")}</span></li>`).join("") || `<li class="muted">Aucun résultat.</li>`;
        ul.querySelectorAll("li[data-i]").forEach(li => li.addEventListener("click", () => ajouter(l[+li.dataset.i])));
      });
      ch.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); const p = ul.querySelector("li[data-i]"); if (p) p.click(); } });
    };
    chercher("#consult-synd-q", "#consult-synd-sugg",
      mots => (Syndromes.entries || []).filter(s => !(this.etat.diagnostic || []).includes(s.domaine + "/" + s.chemin) && mots.every(m => dsNorm(s.nom + " " + (s.sousLabel || "")).includes(m))).map(s => ({ titre: sansChinois(s.nom), sous: (Syndromes.domaineLabels[s.domaine] || "") + (s.sousLabel ? " · " + s.sousLabel : ""), s })),
      x => this.ajouterDiagnostic(x.s));
    chercher("#consult-form-q", "#consult-form-sugg",
      mots => (Formules.index || []).filter(fo => !(this.etat.formules || []).includes(fo.id) && mots.every(m => dsNorm([fo.pinyin, fo.nom_fr, fo.indications_syndrome].join(" ")).includes(m))).map(fo => ({ titre: fo.pinyin || fo.id, sous: fo.nom_fr || fo.categorie_nom || "", fo })),
      x => this.ajouterFormule(x.fo.id));
    // suggestions tirées du diagnostic
    const zc = q("#consult-sugg-circ"), zf = q("#consult-sugg-form");
    if ((this.etat.diagnostic || []).length && !this.etat.verrou) this.suggestions().then(s => {
      const circ = s.circuits.filter(id => id !== this.etat.circuit), form = s.formules.filter(id => !(this.etat.formules || []).includes(id));
      if (zc && zc.isConnected && circ.length) {
        zc.innerHTML = `<span class="muted">Suggéré par le diagnostic :</span> ` + circ.map(id => `<button type="button" class="cat-chip" data-sugg-circ="${escapeHtml(id)}">${escapeHtml(Circuits.nomCourt(Circuits.parId(id)))}</button>`).join(" ");
        zc.querySelectorAll("[data-sugg-circ]").forEach(b => b.addEventListener("click", () => this.choisirCircuit(b.dataset.suggCirc)));
      }
      if (zf && zf.isConnected && form.length) {
        zf.innerHTML = `<span class="muted">Suggéré par le diagnostic :</span> ` + form.map(id => `<button type="button" class="cat-chip" data-sugg-form="${escapeHtml(id)}">＋ ${escapeHtml((this.formDe(id) || {}).pinyin || id)}</button>`).join(" ");
        zf.querySelectorAll("[data-sugg-form]").forEach(b => b.addEventListener("click", () => this.ajouterFormule(b.dataset.suggForm)));
      }
    }).catch(() => {});
    const sd = q(".reseau-schema-d"); if (sd) sd.addEventListener("toggle", () => { this.fenetre.schemaFerme = !sd.open; this.ecrire(this.CLE_FENETRE, this.fenetre); });
    f.querySelectorAll(".reseau-ligne").forEach(l => {
      const id = l.dataset.id, ta = l.querySelector(".reseau-raison"); ta.dataset.avant = ta.value;
      let pris = false;
      ta.addEventListener("input", ev => { if (!pris) { pris = true; const av = JSON.parse(JSON.stringify(this.etat)); const p0 = av.points.find(x => x.id === id); if (p0) p0.raison = ta.dataset.avant || ""; this.hist.push(JSON.stringify(av)); this.futur = []; } this.maj(id, { raison: ev.target.value }); ta.style.height = "auto"; ta.style.height = Math.max(ta.scrollHeight, 28) + "px"; });
      l.querySelectorAll(".reseau-cote-btn").forEach(b => b.addEventListener("click", () => {
        const p = this.etat.points.find(x => x.id === id); if (!p) return;
        this.snap();
        this.maj(id, { cote: p.cote === b.dataset.cote ? "" : b.dataset.cote });                // un second clic retire le côté
        l.querySelectorAll(".reseau-cote-btn").forEach(c => { const on = c.dataset.cote === (this.etat.points.find(x => x.id === id) || {}).cote; c.classList.toggle("on", on); c.setAttribute("aria-pressed", String(on)); });
      }));
    });
    f.querySelectorAll("[data-x]").forEach(b => b.addEventListener("click", () => this.retirer(b.dataset.x)));
    const form = q("#reseau-ajout");
    if (form) {
      const champ = q("#reseau-point"), sg = q("#reseau-sugg");
      const dejaTung = f => this.etat.points.some(p => p.tung && this.cleP(p.point) === this.cleP(this.nomTung(f)));
      const montrer = async () => {
        const t = champ.value.trim();
        if (!t || this.codePoint(t)) { sg.innerHTML = ""; return; }
        const l = await this.suggererTung(t);
        sg.innerHTML = l.filter(f => !dejaTung(f)).map(f => `<li data-t="${escapeHtml(f.id)}"><strong>${escapeHtml(f.nom)}</strong> <span class="muted">${escapeHtml((f.numeros || []).join(" · "))}${((f.canaux || {}).codes || []).length ? " · " + f.canaux.codes.join("+") : ""} · point Tung</span></li>`).join("");
        sg.querySelectorAll("li[data-t]").forEach(li => li.addEventListener("click", () => { const f = Tung.parId(li.dataset.t); champ.value = ""; sg.innerHTML = ""; if (f) this.ajouterTung(f); }));
      };
      champ.addEventListener("input", montrer);
      form.addEventListener("submit", async ev => {
        ev.preventDefault();
        const v = champ.value.trim(); if (!v) return;
        if (!this.codePoint(v)) {                                           // pas un code de canal : c'est peut-être un point Tung
          const l = await this.suggererTung(v), exact = l.find(f => this.nomTung(f) && this.cleP(f.nom) === this.cleP(v)) || (typeof Tung !== "undefined" && Tung.parNom ? Tung.parNom(v) : null);
          const f = exact || (l.length === 1 ? l[0] : null);
          if (f) { champ.value = ""; sg.innerHTML = ""; this.ajouterTung(f); return; }
          if (l.length > 1) { await montrer(); this.avertir(l.length + " points Tung correspondent : choisis dans la liste."); return; }
        }
        champ.value = ""; sg.innerHTML = "";
        this.ajouter({ point: v, source: "saisi" });
      });
    }
    q("#reseau-annuler").addEventListener("click", () => this.annuler());
    q("#reseau-refaire").addEventListener("click", () => this.refaire());
    q("#reseau-favoris").addEventListener("click", () => this.ajouterFavoris());
    q("#reseau-verrou").addEventListener("click", () => { this.snap(); this.etat.verrou = !this.etat.verrou; this.sauver(); this.rendre(); });
    q("#reseau-copier").addEventListener("click", () => copier(this.resume()));
    q("#reseau-enreg").addEventListener("click", () => {
      if (!this.aContenu()) { this.avertir("Rien à enregistrer."); return; }
      this.archiver(); this.rendre(); this.avertir("Consultation enregistrée.");
    });
    q("#reseau-nouveau").addEventListener("click", () => {
      const garde = this.aContenu() ? this.archiver() : null;                               // la consultation en cours est gardée dans les enregistrées
      this.etat = { patiente: "", circuit: null, verrou: false, points: [], diagnostic: [], formules: [] };
      this.sauver(); this.rendre();
      if (garde) this.avertir("Consultation précédente gardée dans « Enregistrés ».");
    });
  },

  init() {
    this.etat = { patiente: "", circuit: null, verrou: false, points: [], diagnostic: [], formules: [], ...this.lire(this.CLE_ETAT, {}) };
    this.archives = this.lire(this.CLE_ARCHIVES, []);
    this.fenetre = { ouvert: false, reduit: false, x: null, y: null, ...this.lire(this.CLE_FENETRE, {}) };
    if (this.fenetre.ancre === undefined) { this.fenetre.ancre = true; if (this.large()) this.fenetre.ouvert = true; this.ecrire(this.CLE_FENETRE, this.fenetre); }   // première fois : ancrée et visible sur grand écran
    window.addEventListener("resize", () => { if (this.large() !== this._large) this.rendre(); });
    this.creer();
    this.rendre();
    // bouton ✓ générique : <button data-reseau='{"point":"TF5","raison":"…"}'>
    document.addEventListener("click", ev => {
      const b = ev.target.closest("[data-reseau]");
      if (!b) return;
      ev.preventDefault();
      try { const d = JSON.parse(b.dataset.reseau); (Array.isArray(d) ? d : [d]).forEach(x => this.ajouter(x)); } catch (e) { /* attribut illisible */ }
    });
    document.addEventListener("keydown", ev => {
      if (!this.fenetre.ouvert || !(ev.ctrlKey || ev.metaKey) || ev.target.closest("input, textarea, select, [contenteditable]")) return;
      if (!ev.target.closest("#reseau-fenetre")) return;
      const k = ev.key.toLowerCase();
      if (k === "z" && !ev.shiftKey) { ev.preventDefault(); this.annuler(); } else if (k === "y" || (k === "z" && ev.shiftKey)) { ev.preventDefault(); this.refaire(); }
    });
    // la liste des circuits n'est connue qu'une fois Circuits chargé : on réaffiche alors
    if (typeof Circuits !== "undefined") Circuits.ensureLoaded().then(() => { if (this.fenetre.ouvert) this.rendre(); }).catch(() => {});
  },
};

Reseau.init();
