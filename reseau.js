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
  fenetre: { ouvert: false, reduit: false, x: null, y: null },

  // ---------- mémoire locale
  lire(cle, defaut) { try { const v = JSON.parse(localStorage.getItem(cle) || "null"); return v == null ? defaut : v; } catch (e) { return defaut; } },
  ecrire(cle, v) { try { localStorage.setItem(cle, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
  sauver() { this.etat.maj = Date.now(); this.ecrire(this.CLE_ETAT, this.etat); this.majLanceur(); },

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
  ordonne() {
    const c = this.etat.circuit && typeof Circuits !== "undefined" ? Circuits.parId(this.etat.circuit) : null;
    const grille = c ? c.grille : [];
    const rang = k => { const i = grille.indexOf(k); if (i >= 0) return i; const j = this.ORDRE_CANAUX.indexOf(k); return j >= 0 ? 100 + j : 999; };
    return [...this.etat.points].sort((a, b) =>
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
    this.etat.points.push({ id, point: nom, canal: p.canal || this.canalDe(nom), cote: "", raison: p.raison || "", source: p.source || "", tung: !!p.tung });
    this.sauver();
    this.ouvrir();
    this.surligner(id);
  },
  retirer(id) { this.etat.points = this.etat.points.filter(x => x.id !== id); this.sauver(); this.rendre(); },
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
    f.setAttribute("role", "dialog"); f.setAttribute("aria-label", "Réseau de la patiente");
    document.body.appendChild(f);
    this.majLanceur();
  },
  majLanceur() {
    const b = document.getElementById("reseau-lanceur");
    if (!b) return;
    const n = this.etat.points.length;
    b.textContent = "📋 Réseau" + (n ? " (" + n + ")" : "") + (this.etat.verrou ? " 🔒" : "");
    b.title = "Réseau de la patiente : points choisis et raisons";
  },
  ouvrir() { this.fenetre.ouvert = true; this.ecrire(this.CLE_FENETRE, this.fenetre); this.rendre(); },
  fermer() { this.fenetre.ouvert = false; this.ecrire(this.CLE_FENETRE, this.fenetre); this.rendre(); },
  reduire() { this.fenetre.reduit = !this.fenetre.reduit; this.ecrire(this.CLE_FENETRE, this.fenetre); this.rendre(); },

  // ---------- résumé texte (à copier dans le dossier)
  resume() {
    const c = this.etat.circuit && typeof Circuits !== "undefined" ? Circuits.parId(this.etat.circuit) : null;
    const d = new Date().toLocaleDateString("fr-FR");
    const l = ["Réseau — " + (this.etat.patiente || "patiente") + " — " + d + (this.etat.verrou ? " (arrêté)" : ""), c ? "Circuit : " + Circuits.nomCourt(c) + " (" + c.grille.join(", ") + ")" : "Circuit : non choisi", ""];
    this.ordonne().forEach(p => l.push("• " + p.point + (p.cote ? " (" + p.cote + ")" : "") + (p.raison ? " : " + p.raison : "")));
    return l.join("\n");
  },

  // ---------- schéma : le circuit avec les points choisis écrits près de chaque canal
  schema() {
    const c = this.etat.circuit && typeof Circuits !== "undefined" ? Circuits.parId(this.etat.circuit) : null;
    if (!c) return `<p class="muted">Choisis un circuit pour voir le schéma.</p>`;
    const pts = {}, horsGrille = {}, tung = [];
    this.ordonne().forEach(p => {
      if (p.tung) { tung.push(p.point); return; }                       // les points Tung ne s'écrivent pas près des canaux : ils sont listés à la fin
      const k = p.canal;
      if (!k) return;
      if (c.grille.includes(k)) (pts[k] = pts[k] || []).push(p.point.replace(/\s+/g, ""));
      else (horsGrille[k] = horsGrille[k] || []).push(p.point.replace(/\s+/g, ""));
    });
    const extras = Object.keys(horsGrille).filter(k => Circuits.canaux.has(k));
    const pseudo = { grille: c.grille, figure: c.figure, ajouts: extras.map(k => ({ canaux: [k], action: "" })) };
    const svg = Circuits.dessin(pseudo, { taille: 230, etiquettes: true, points: pts, ajouts: !!extras.length });
    const hors = Object.entries(horsGrille).map(([k, l]) => `<span class="sx-code">${escapeHtml(k)}</span> ${escapeHtml(l.join(", "))}`).join(" · ");
    return `<div class="reseau-schema">${svg}</div>` + (hors ? `<p class="muted reseau-hors">Hors des quatre canaux : ${hors}</p>` : "") + (tung.length ? `<p class="reseau-hors reseau-tung"><strong>Points Tung</strong><br>${tung.map(escapeHtml).join("<br>")}</p>` : "");
  },

  rendre() {
    this.creer();
    const f = document.getElementById("reseau-fenetre");
    f.hidden = !this.fenetre.ouvert;
    f.classList.toggle("reseau-reduit", !!this.fenetre.reduit);
    if (!this.fenetre.ouvert) return;
    if (this.fenetre.x != null) { f.style.left = this.fenetre.x + "px"; f.style.top = this.fenetre.y + "px"; f.style.right = "auto"; f.style.bottom = "auto"; }
    const e = this.etat, verrou = e.verrou, dis = verrou ? " disabled" : "";
    const circuits = typeof Circuits !== "undefined" && Circuits.liste ? Circuits.liste : [];
    const lignes = this.ordonne().map(p => `<li class="reseau-ligne" data-id="${escapeHtml(p.id)}">
        <div class="reseau-ligne-tete"><span class="sx-code">${escapeHtml(p.canal || "?")}</span> ${p.tung ? `<strong>${escapeHtml(p.point)}</strong>` : `<a href="#" class="circ-ptlien" data-pt-fiche="${escapeHtml(p.point)}" title="Ouvrir la fiche du point dans un nouvel onglet"><strong>${escapeHtml(p.point)}</strong></a>`}
          <select class="reseau-cote" aria-label="Côté"${dis}>${["", "D", "G", "D + G"].map(v => `<option value="${v}"${p.cote === v ? " selected" : ""}>${v || "côté ?"}</option>`).join("")}</select>
          ${verrou ? "" : `<button type="button" class="reseau-x" data-x="${escapeHtml(p.id)}" title="Retirer du réseau" aria-label="Retirer ${escapeHtml(p.point)} du réseau">✕</button>`}</div>
        <textarea class="reseau-raison" rows="2" placeholder="Raison du choix…"${dis}>${escapeHtml(p.raison)}</textarea>
      </li>`).join("");
    const arch = this.archives.map((a, i) => `<li><span>${escapeHtml(a.nom)} <span class="muted">— ${escapeHtml(a.date)}, ${a.etat.points.length} point(s)</span></span> <button type="button" class="edit-toggle-btn" data-ouvrir="${i}">Ouvrir</button> <button type="button" class="edit-toggle-btn" data-suppr="${i}" aria-label="Supprimer ce réseau enregistré">🗑</button></li>`).join("");
    f.innerHTML = `
      <div class="reseau-tete" id="reseau-tete"><strong>📋 Réseau${e.patiente ? " — " + escapeHtml(e.patiente) : ""}${verrou ? " 🔒" : ""}</strong>
        <span><button type="button" class="reseau-ic" id="reseau-reduire" title="${this.fenetre.reduit ? "Agrandir" : "Réduire"}" aria-label="${this.fenetre.reduit ? "Agrandir" : "Réduire"}">${this.fenetre.reduit ? "▢" : "—"}</button><button type="button" class="reseau-ic" id="reseau-fermer" title="Fermer (le réseau est conservé)" aria-label="Fermer">✕</button></span></div>
      <div class="reseau-corps">
        <label class="reseau-champ">Patiente (initiales ou repère)<input type="text" id="reseau-nom" value="${escapeHtml(e.patiente)}" placeholder="ex. M.D."${dis}></label>
        <label class="reseau-champ">Circuit<select id="reseau-circuit"${dis}><option value="">— choisir —</option>${circuits.map(c => `<option value="${escapeHtml(c.id)}"${e.circuit === c.id ? " selected" : ""}>${escapeHtml(Circuits.nomCourt(c))} (${c.grille.join(" ")})</option>`).join("")}</select></label>
        <div id="reseau-schema">${this.schema()}</div>
        <p id="reseau-avis" class="muted reseau-avis" aria-live="polite"></p>
        <ul class="reseau-liste">${lignes || `<li class="muted">Aucun point retenu : utilise le bouton ✓ à côté d'un point, ou tape-le ci-dessous.</li>`}</ul>
        ${verrou ? "" : `<form id="reseau-ajout" class="reseau-ajout"><input type="text" id="reseau-point" placeholder="Ajouter un point (ex. TF5, Rt 4)" autocomplete="off"><button type="submit" class="edit-toggle-btn">+ Ajouter</button></form>`}
        <div class="reseau-actions">
          <button type="button" class="edit-toggle-btn" id="reseau-verrou">${verrou ? "🔓 Rouvrir le réseau" : "🔒 Arrêter le réseau (définitif)"}</button>
          <button type="button" class="edit-toggle-btn" id="reseau-copier">📄 Copier le résumé</button>
          <button type="button" class="edit-toggle-btn" id="reseau-enreg">💾 Enregistrer</button>
          <button type="button" class="edit-toggle-btn" id="reseau-nouveau">Nouveau</button>
        </div>
        ${arch ? `<details class="reseau-archives"><summary>Réseaux enregistrés (${this.archives.length})</summary><ul>${arch}</ul></details>` : ""}
        <p class="muted reseau-confid">Données gardées uniquement dans ce navigateur : jamais envoyées au dépôt ni synchronisées.</p>
      </div>`;
    this.brancher(f);
  },

  brancher(f) {
    const q = s => f.querySelector(s);
    q("#reseau-fermer").addEventListener("click", () => this.fermer());
    q("#reseau-reduire").addEventListener("click", () => this.reduire());
    q("#reseau-nom").addEventListener("input", ev => { this.etat.patiente = ev.target.value; this.sauver(); const t = q("#reseau-tete strong"); if (t) t.textContent = "📋 Réseau" + (this.etat.patiente ? " — " + this.etat.patiente : "") + (this.etat.verrou ? " 🔒" : ""); });
    q("#reseau-circuit").addEventListener("change", ev => { this.etat.circuit = ev.target.value || null; this.sauver(); q("#reseau-schema").innerHTML = this.schema(); });
    f.querySelectorAll(".reseau-ligne").forEach(l => {
      const id = l.dataset.id;
      l.querySelector(".reseau-raison").addEventListener("input", ev => this.maj(id, { raison: ev.target.value }));
      l.querySelector(".reseau-cote").addEventListener("change", ev => this.maj(id, { cote: ev.target.value }));
    });
    f.querySelectorAll("[data-x]").forEach(b => b.addEventListener("click", () => this.retirer(b.dataset.x)));
    const form = q("#reseau-ajout");
    if (form) form.addEventListener("submit", ev => { ev.preventDefault(); const i = q("#reseau-point"); const v = i.value.trim(); if (!v) return; i.value = ""; this.ajouter({ point: v, source: "saisi" }); });
    q("#reseau-verrou").addEventListener("click", () => { this.etat.verrou = !this.etat.verrou; this.sauver(); this.rendre(); });
    q("#reseau-copier").addEventListener("click", async () => {
      const t = this.resume();
      try { await navigator.clipboard.writeText(t); this.avertir("Résumé copié."); } catch (e) { window.prompt("Copie le résumé :", t); }
    });
    q("#reseau-enreg").addEventListener("click", () => {
      if (!this.etat.points.length) { this.avertir("Rien à enregistrer."); return; }
      const nom = (this.etat.patiente || "Sans nom").trim();
      this.archives.unshift({ nom, date: new Date().toLocaleString("fr-FR"), etat: JSON.parse(JSON.stringify(this.etat)) });
      this.archives = this.archives.slice(0, 50);
      this.ecrire(this.CLE_ARCHIVES, this.archives);
      this.rendre(); this.avertir("Réseau enregistré.");
    });
    q("#reseau-nouveau").addEventListener("click", () => {
      if (this.etat.points.length && !confirm("Commencer un nouveau réseau ? Le réseau en cours sera effacé de la fenêtre (enregistre-le d'abord si besoin).")) return;
      this.etat = { patiente: "", circuit: null, verrou: false, points: [] };
      this.sauver(); this.rendre();
    });
    f.querySelectorAll("[data-ouvrir]").forEach(b => b.addEventListener("click", () => {
      if (this.etat.points.length && !confirm("Remplacer le réseau en cours par celui-ci ?")) return;
      this.etat = JSON.parse(JSON.stringify(this.archives[+b.dataset.ouvrir].etat));
      this.sauver(); this.rendre();
    }));
    f.querySelectorAll("[data-suppr]").forEach(b => b.addEventListener("click", () => {
      if (!confirm("Supprimer ce réseau enregistré ?")) return;
      this.archives.splice(+b.dataset.suppr, 1);
      this.ecrire(this.CLE_ARCHIVES, this.archives); this.rendre();
    }));
    // déplacement par la barre de titre (souris ou doigt)
    const tete = q("#reseau-tete");
    tete.addEventListener("pointerdown", ev => {
      if (ev.target.closest("button")) return;
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
  },

  init() {
    this.etat = { patiente: "", circuit: null, verrou: false, points: [], ...this.lire(this.CLE_ETAT, {}) };
    this.archives = this.lire(this.CLE_ARCHIVES, []);
    this.fenetre = { ouvert: false, reduit: false, x: null, y: null, ...this.lire(this.CLE_FENETRE, {}) };
    this.creer();
    this.rendre();
    // bouton ✓ générique : <button data-reseau='{"point":"TF5","raison":"…"}'>
    document.addEventListener("click", ev => {
      const b = ev.target.closest("[data-reseau]");
      if (!b) return;
      ev.preventDefault();
      try { const d = JSON.parse(b.dataset.reseau); (Array.isArray(d) ? d : [d]).forEach(x => this.ajouter(x)); } catch (e) { /* attribut illisible */ }
    });
    // la liste des circuits n'est connue qu'une fois Circuits chargé : on réaffiche alors
    if (typeof Circuits !== "undefined") Circuits.ensureLoaded().then(() => { if (this.fenetre.ouvert) this.rendre(); }).catch(() => {});
  },
};

Reseau.init();
