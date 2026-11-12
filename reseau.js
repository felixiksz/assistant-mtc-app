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
    const n = this.etat.points.length, na = this.archives.length;
    b.textContent = "📋 Réseau" + (n ? " · " + n + " pt" + (n > 1 ? "s" : "") : "") + (this.etat.verrou ? " 🔒" : "");
    b.title = "Réseau de la patiente : " + n + " point(s) dans le réseau en cours" + (na ? " ; " + na + " réseau(x) enregistré(s)" : "");
  },
  ouvrir() { this.fenetre.ouvert = true; this.ecrire(this.CLE_FENETRE, this.fenetre); this.rendre(); },
  fermer() { this.fenetre.ouvert = false; this.ecrire(this.CLE_FENETRE, this.fenetre); this.rendre(); },
  reduire() { this.fenetre.reduit = !this.fenetre.reduit; this.ecrire(this.CLE_FENETRE, this.fenetre); this.rendre(); },

  // ---------- résumé texte (à copier dans le dossier)
  resume(e) {
    e = e || this.etat;
    const c = e.circuit && typeof Circuits !== "undefined" ? Circuits.parId(e.circuit) : null;
    const d = new Date().toLocaleDateString("fr-FR");
    const l = ["Réseau — " + (e.patiente || "patiente") + " — " + d + (e.verrou ? " (arrêté)" : ""), c ? "Circuit : " + Circuits.nomCourt(c) + " (" + c.grille.join(", ") + ")" : "Circuit : non choisi", ""];
    this.ordonne(e).forEach(p => l.push("• " + p.point + (p.cote ? " (" + p.cote + ")" : "") + (p.raison ? " : " + p.raison : "")));
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
    // tous les ajouts possibles du circuit sont dessinés (rond pointillé vide s'ils n'ont pas de point), plus les canaux hors circuit qui portent des points
    const groupes = (c.ajouts || []).filter(x => (x.canaux || []).length).map(x => ({ canaux: x.canaux, ensemble: x.ensemble, action: "" }));
    const dessines = new Set(groupes.flatMap(x => x.canaux));
    const pseudo = { grille: c.grille, figure: c.figure, ajouts: [...groupes, ...extras.filter(k => !dessines.has(k)).map(k => ({ canaux: [k], action: "" }))] };
    ["RM", "DM"].forEach(k => { if (horsGrille[k]) pts[k] = horsGrille[k]; });                 // l'axe s'écrit sous le dessin
    extras.forEach(k => { pts[k] = horsGrille[k]; });                                             // un canal ajouté devient une bulle, avec ses points dedans
    const svg = Circuits.dessin(pseudo, { taille: 180, etiquettes: true, points: pts, ajouts: !!pseudo.ajouts.length });
    const hors = Object.entries(horsGrille).filter(([k]) => k !== "RM" && k !== "DM" && !extras.includes(k)).map(([k, l]) => `<span class="sx-code">${escapeHtml(k)}</span> ${escapeHtml(l.join(", "))}`).join(" · ");
    return `<div class="reseau-schema">${svg}</div>` + (hors ? `<p class="muted reseau-hors">Hors des quatre canaux : ${hors}</p>` : "") + (tung.length ? `<p class="reseau-hors reseau-tung"><strong>Points Tung</strong><br>${tung.map(escapeHtml).join("<br>")}</p>` : "");
  },

  vue: "reseau",          // onglet de la fenêtre : « reseau » (en cours) ou « archives » (enregistrés)

  // réseau en cours identique à son enregistrement ? (pour ne rien perdre sans demander)
  identique(a, b) { const n = x => JSON.stringify({ ...x, maj: 0, archiveId: 0 }); return n(a) === n(b); },
  // garde le réseau en cours parmi les enregistrés (mis à jour s'il en vient déjà)
  archiver() {
    const e = this.etat;
    if (!e.points.length) return null;
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
    f.classList.toggle("reseau-reduit", !!this.fenetre.reduit);
    if (!this.fenetre.ouvert) return;
    if (this.fenetre.x != null) { f.style.left = this.fenetre.x + "px"; f.style.top = this.fenetre.y + "px"; f.style.right = "auto"; f.style.bottom = "auto"; }
    const e = this.etat, verrou = e.verrou, dis = verrou ? " disabled" : "";
    const circuits = typeof Circuits !== "undefined" && Circuits.liste ? Circuits.liste : [];
    const nbA = this.archives.length, nbP = e.points.length;
    const COTES = [["D", "D"], ["G", "G"], ["D + G", "D+G"]];
    const lignes = this.ordonne().map(p => `<li class="reseau-ligne" data-id="${escapeHtml(p.id)}">
        <div class="reseau-ligne-tete"><span class="sx-code">${escapeHtml(p.canal || "?")}</span> ${p.tung ? `<strong>${escapeHtml(p.point)}</strong>` : `<a href="#" class="circ-ptlien" data-pt-fiche="${escapeHtml(p.point)}" title="Ouvrir la fiche du point dans un nouvel onglet"><strong>${escapeHtml(p.point)}</strong></a>`}
          <span class="reseau-cotes" role="group" aria-label="Côté">${COTES.map(([v, l]) => `<button type="button" class="reseau-cote-btn${p.cote === v ? " on" : ""}" data-cote="${v}" aria-pressed="${p.cote === v}"${dis}>${l}</button>`).join("")}</span>
          ${verrou ? "" : `<button type="button" class="reseau-x" data-x="${escapeHtml(p.id)}" title="Retirer du réseau" aria-label="Retirer ${escapeHtml(p.point)} du réseau">✕</button>`}</div>
        <textarea class="reseau-raison" rows="1" placeholder="Raison du choix…"${dis}>${escapeHtml(p.raison)}</textarea>
      </li>`).join("");
    const nomCirc = a => { const c = a.circuit && typeof Circuits !== "undefined" ? Circuits.parId(a.circuit) : null; return c ? Circuits.nomCourt(c) : ""; };
    const arch = this.archives.map((a, i) => `<li class="reseau-arch${e.archiveId === a.id ? " en-cours" : ""}">
        <div class="reseau-arch-texte"><strong>${escapeHtml(a.nom)}</strong>${a.etat.verrou ? " 🔒" : ""}${e.archiveId === a.id ? ` <span class="reseau-arch-tag">en cours</span>` : ""}
          <span class="muted">${escapeHtml(a.date)} · ${a.etat.points.length} point(s)${nomCirc(a.etat) ? " · " + escapeHtml(nomCirc(a.etat)) : ""}</span>
          <span class="reseau-arch-pts">${this.ordonne(a.etat).map(p => escapeHtml(p.point)).join(" · ")}</span></div>
        <div class="reseau-arch-btns"><button type="button" class="reseau-ic2" data-ouvrir="${i}" title="Ouvrir ce réseau" aria-label="Ouvrir ce réseau">↗</button><button type="button" class="reseau-ic2" data-copier="${i}" title="Copier le résumé" aria-label="Copier le résumé">📄</button><button type="button" class="reseau-ic2" data-suppr="${i}" title="Supprimer" aria-label="Supprimer ce réseau enregistré">🗑</button></div></li>`).join("");
    const corpsEnCours = `
        <div class="reseau-rang">
          <input type="text" id="reseau-nom" class="reseau-nom" value="${escapeHtml(e.patiente)}" placeholder="Patiente (initiales)" aria-label="Patiente (initiales ou repère)"${dis}>
          <select id="reseau-circuit" aria-label="Circuit"${dis}><option value="">Circuit…</option>${circuits.map(c => `<option value="${escapeHtml(c.id)}"${e.circuit === c.id ? " selected" : ""}>${escapeHtml(Circuits.nomCourt(c))} (${c.grille.join(" ")})</option>`).join("")}</select>
        </div>
        <details class="reseau-schema-d"${this.fenetre.schemaFerme ? "" : " open"}><summary>Schéma</summary><div id="reseau-schema">${this.schema()}</div></details>
        <p id="reseau-avis" class="muted reseau-avis" aria-live="polite"></p>
        <ul class="reseau-liste">${lignes || `<li class="muted reseau-vide">Aucun point : utilise le ✓ à côté d'un point, ou tape-le ci-dessous.</li>`}</ul>
        ${verrou ? "" : `<form id="reseau-ajout" class="reseau-ajout"><input type="text" id="reseau-point" placeholder="Ajouter un point (ex. TF5, Rt 4)" autocomplete="off"><button type="submit" class="reseau-ic2" title="Ajouter" aria-label="Ajouter ce point">＋</button></form>`}
        <div class="reseau-barre">
          <button type="button" class="reseau-ic2" id="reseau-enreg" title="Enregistrer ce réseau" aria-label="Enregistrer ce réseau">💾</button>
          <button type="button" class="reseau-ic2" id="reseau-copier" title="Copier le résumé" aria-label="Copier le résumé">📄</button>
          <button type="button" class="reseau-ic2" id="reseau-verrou" title="${verrou ? "Rouvrir le réseau" : "Arrêter le réseau (définitif)"}" aria-label="${verrou ? "Rouvrir le réseau" : "Arrêter le réseau"}">${verrou ? "🔓" : "🔒"}</button>
          <button type="button" class="reseau-ic2" id="reseau-nouveau" title="Nouveau réseau (celui-ci est gardé dans les enregistrés)" aria-label="Nouveau réseau">🆕</button>
        </div>`;
    const corpsArchives = `<ul class="reseau-archives-liste">${arch || `<li class="muted reseau-vide">Aucun réseau enregistré. Le bouton 💾 de l'onglet « En cours » garde le réseau, et « Nouveau » le garde aussi avant de repartir à zéro.</li>`}</ul>`;
    f.innerHTML = `
      <div class="reseau-tete" id="reseau-tete"><strong>📋 Réseau${e.patiente ? " — " + escapeHtml(e.patiente) : ""}${verrou ? " 🔒" : ""}</strong>
        <span><button type="button" class="reseau-ic" id="reseau-reduire" title="${this.fenetre.reduit ? "Agrandir" : "Réduire"}" aria-label="${this.fenetre.reduit ? "Agrandir" : "Réduire"}">${this.fenetre.reduit ? "▢" : "—"}</button><button type="button" class="reseau-ic" id="reseau-fermer" title="Fermer (le réseau est conservé)" aria-label="Fermer">✕</button></span></div>
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
    f.querySelectorAll("[data-vue]").forEach(b => b.addEventListener("click", () => { this.vue = b.dataset.vue; this.rendre(); }));
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
    const copier = async t => { try { await navigator.clipboard.writeText(t); this.avertir("Résumé copié."); } catch (e) { window.prompt("Copie le résumé :", t); } };
    if (this.vue === "archives") {
      f.querySelectorAll("[data-ouvrir]").forEach(b => b.addEventListener("click", () => {
        const cible = this.archives[+b.dataset.ouvrir];
        if (!cible) return;
        if (this.etat.archiveId !== cible.id) this.archiver();          // le réseau en cours n'est pas perdu
        this.etat = { patiente: "", circuit: null, verrou: false, points: [], ...JSON.parse(JSON.stringify(cible.etat)), archiveId: cible.id };
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
    q("#reseau-nom").addEventListener("input", ev => { this.etat.patiente = ev.target.value; this.sauver(); const t = q("#reseau-tete strong"); if (t) t.textContent = "📋 Réseau" + (this.etat.patiente ? " — " + this.etat.patiente : "") + (this.etat.verrou ? " 🔒" : ""); });
    q("#reseau-circuit").addEventListener("change", ev => { this.etat.circuit = ev.target.value || null; this.sauver(); q("#reseau-schema").innerHTML = this.schema(); });
    const sd = q(".reseau-schema-d"); if (sd) sd.addEventListener("toggle", () => { this.fenetre.schemaFerme = !sd.open; this.ecrire(this.CLE_FENETRE, this.fenetre); });
    f.querySelectorAll(".reseau-ligne").forEach(l => {
      const id = l.dataset.id, ta = l.querySelector(".reseau-raison");
      ta.addEventListener("input", ev => { this.maj(id, { raison: ev.target.value }); ta.style.height = "auto"; ta.style.height = Math.max(ta.scrollHeight, 28) + "px"; });
      l.querySelectorAll(".reseau-cote-btn").forEach(b => b.addEventListener("click", () => {
        const p = this.etat.points.find(x => x.id === id); if (!p) return;
        this.maj(id, { cote: p.cote === b.dataset.cote ? "" : b.dataset.cote });                // un second clic retire le côté
        l.querySelectorAll(".reseau-cote-btn").forEach(c => { const on = c.dataset.cote === (this.etat.points.find(x => x.id === id) || {}).cote; c.classList.toggle("on", on); c.setAttribute("aria-pressed", String(on)); });
      }));
    });
    f.querySelectorAll("[data-x]").forEach(b => b.addEventListener("click", () => this.retirer(b.dataset.x)));
    const form = q("#reseau-ajout");
    if (form) form.addEventListener("submit", ev => { ev.preventDefault(); const i = q("#reseau-point"); const v = i.value.trim(); if (!v) return; i.value = ""; this.ajouter({ point: v, source: "saisi" }); });
    q("#reseau-verrou").addEventListener("click", () => { this.etat.verrou = !this.etat.verrou; this.sauver(); this.rendre(); });
    q("#reseau-copier").addEventListener("click", () => copier(this.resume()));
    q("#reseau-enreg").addEventListener("click", () => {
      if (!this.etat.points.length) { this.avertir("Rien à enregistrer."); return; }
      this.archiver(); this.rendre(); this.avertir("Réseau enregistré.");
    });
    q("#reseau-nouveau").addEventListener("click", () => {
      const garde = this.etat.points.length ? this.archiver() : null;                      // le réseau en cours est gardé dans les enregistrés
      this.etat = { patiente: "", circuit: null, verrou: false, points: [] };
      this.sauver(); this.rendre();
      if (garde) this.avertir("Réseau précédent gardé dans « Enregistrés ».");
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
