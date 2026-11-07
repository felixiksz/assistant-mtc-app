"use strict";

/* ============================= Onglets ============================= */
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

/* ============================= Source des données (local ou GitHub) =============================
   Toutes les lectures/écritures de fichiers JSON passent par Store, qui redirige soit vers le disque
   local (File System Access API, via DataDir), soit vers un dépôt GitHub privé (API Contents), selon
   le mode choisi dans Paramètres. Les images restent toujours locales, seul le contenu texte peut
   être synchronisé via GitHub pour un accès multi-appareils. */
const Store = {
  mode: "local", // "local" | "github"
  gh: { owner: "", repo: "", branch: "main", token: "" },
  _shaCache: new Map(),

  init() {
    try {
      const saved = JSON.parse(localStorage.getItem("mtc_store_config") || "null");
      if (saved) {
        this.mode = saved.mode === "github" ? "github" : "local";
        this.gh = Object.assign({ owner: "", repo: "", branch: "main", token: "" }, saved.gh || {});
        return;
      }
    } catch (e) { /* config absente ou invalide, on reste en local */ }
    // Pas de config sauvegardée : si cette copie est hébergée (PWA sur GitHub Pages), il n'y a
    // pas de disque local à lire — on bascule par défaut sur le mode GitHub avec owner/repo
    // pré-remplis. Le token n'est JAMAIS pré-rempli ici : l'utilisatrice doit le coller elle-même.
    if (location.hostname.endsWith("github.io")) {
      this.mode = "github";
      this.gh = { owner: "felixiksz", repo: "Assistant-MTC", branch: "main", token: "" };
      this._needsTokenPrompt = true;
    }
  },

  persist() {
    localStorage.setItem("mtc_store_config", JSON.stringify({ mode: this.mode, gh: this.gh }));
  },

  useLocal() {
    this.mode = "local";
    this.persist();
  },

  useGithub(owner, repo, branch, token) {
    this.gh = { owner: owner.trim(), repo: repo.trim(), branch: (branch || "main").trim(), token: token.trim() };
    this.mode = "github";
    this._shaCache.clear();
    this.persist();
  },

  async readJSON(relPath) {
    if (this.mode === "github") return this._ghGet(relPath);
    const res = await fetch("data/" + relPath, { cache: "no-store" });
    if (!res.ok) throw new Error(relPath + " introuvable (" + res.status + ")");
    return res.json();
  },

  async writeJSON(relPath, obj) {
    if (this.mode === "github") return this._ghPut(relPath, obj);
    return DataDir.writeWholeFile(relPath, JSON.stringify(obj, null, 2));
  },

  async writeArrayItem(relPath, matchField, matchValue, updatedObj) {
    if (this.mode === "github") {
      let arr = [];
      try { arr = await this._ghGet(relPath); } catch (e) { arr = []; }
      const idx = arr.findIndex(x => x[matchField] === matchValue);
      if (idx === -1) arr.push(updatedObj); else arr[idx] = updatedObj;
      return this._ghPut(relPath, arr);
    }
    return DataDir.writeArrayItem(relPath, matchField, matchValue, updatedObj);
  },

  _ghUrl(relPath) {
    return `https://api.github.com/repos/${this.gh.owner}/${this.gh.repo}/contents/${relPath}`;
  },

  _ghHeaders(withJsonBody) {
    const h = { "Authorization": "Bearer " + this.gh.token, "Accept": "application/vnd.github+json" };
    if (withJsonBody) h["Content-Type"] = "application/json";
    return h;
  },

  async _ghGet(relPath) {
    const res = await fetch(this._ghUrl(relPath) + "?ref=" + encodeURIComponent(this.gh.branch), { headers: this._ghHeaders() });
    if (!res.ok) {
      if (res.status === 404) throw new Error("GitHub : " + relPath + " introuvable dans " + this.gh.owner + "/" + this.gh.repo);
      throw new Error("GitHub : erreur " + res.status + " sur " + relPath);
    }
    const data = await res.json();
    this._shaCache.set(relPath, data.sha);
    const text = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
    return JSON.parse(text);
  },

  async _ghPut(relPath, obj) {
    const jsonText = JSON.stringify(obj, null, 2);
    const b64 = btoa(unescape(encodeURIComponent(jsonText)));
    let sha = this._shaCache.get(relPath);
    if (!sha) {
      try {
        const cur = await fetch(this._ghUrl(relPath) + "?ref=" + encodeURIComponent(this.gh.branch), { headers: this._ghHeaders() });
        if (cur.ok) { const cd = await cur.json(); sha = cd.sha; }
      } catch (e) { /* probablement un nouveau fichier */ }
    }
    const body = { message: "Assistant Diagnostic MTC : mise à jour " + relPath, content: b64, branch: this.gh.branch };
    if (sha) body.sha = sha;
    const res = await fetch(this._ghUrl(relPath), { method: "PUT", headers: this._ghHeaders(true), body: JSON.stringify(body) });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error("Échec d'écriture GitHub (" + res.status + ") sur " + relPath + " : " + errText.slice(0, 200));
    }
    const data = await res.json();
    if (data.content && data.content.sha) this._shaCache.set(relPath, data.content.sha);
  },

  async testConnection() {
    await this._ghGet("formules/index.json");
    return true;
  }
};
Store.init();

/* ============================= Édition en place (toutes les fiches) =============================
   Chaque fiche affichée peut être modifiée directement : bouton "Modifier cette fiche" -> zone de
   texte avec le JSON brut -> "Enregistrer" écrit le fichier soit sur le disque local (File System
   Access API, Chrome/Edge), soit dans le dépôt GitHub configuré (voir Store et Paramètres).
   Deux modes : fichier = un seul objet (formules, syndromes, psy, cas pratique), ou fichier = un
   tableau d'objets dont on édite un seul élément (base de points par canal). */
const DataDir = {
  handle: null,
  async pick() {
    if (!window.showDirectoryPicker) {
      throw new Error("Ton navigateur ne supporte pas cette fonction (utilise Chrome ou Edge).");
    }
    if (!this.handle) this.handle = await window.showDirectoryPicker();
    return this.handle;
  },
  async getDirFor(relPath) {
    const root = await this.pick();
    const parts = relPath.split("/");
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i], { create: true });
    return { dir, filename: parts[parts.length - 1] };
  },
  async writeWholeFile(relPath, jsonText) {
    const { dir, filename } = await this.getDirFor(relPath);
    const fh = await dir.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(jsonText);
    await w.close();
  },
  async writeArrayItem(relPath, matchField, matchValue, updatedObj) {
    const { dir, filename } = await this.getDirFor(relPath);
    const fh = await dir.getFileHandle(filename, { create: true });
    let arr = [];
    try { arr = JSON.parse(await (await fh.getFile()).text()); } catch (e) { arr = []; }
    const idx = arr.findIndex(x => x[matchField] === matchValue);
    if (idx === -1) arr.push(updatedObj); else arr[idx] = updatedObj;
    const w = await fh.createWritable();
    await w.write(JSON.stringify(arr, null, 2));
    await w.close();
  }
};

/* ============================= Base de formules ============================= */
/* ===== Nature des substances (chaud / tiède / neutre / frais / froid) : coloration + échelle de la nature de la formule =====
   Données : reference/substances_nature/nature.json (généré par generer.py d'après la pharmacopée du jeu). */
const SubstanceNature = {
  data: null,
  parHanzi: new Map(),
  parCle: new Map(),
  _promesse: null,

  cle(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, ""); },

  async ensureLoaded() {
    if (this.data) return;
    if (!this._promesse) {
      this._promesse = Store.readJSON("reference/substances_nature/nature.json").then(d => {
        this.data = d;
        d.substances.forEach(s => { if (s.hanzi) this.parHanzi.set(s.hanzi, s); this.parCle.set(this.cle(s.pinyin), s); });
      }).catch(() => { /* pas de données : les fiches s'affichent sans nature */ });
    }
    await this._promesse;
  },

  // substance de la composition -> fiche de pharmacopée ({ s, alias }) ou null
  trouver(c) {
    if (!this.data) return null;
    const nom = this.cle(String(c.substance_pinyin || "").replace(/\(.*?\)/g, ""));
    const direct = (c.hanzi && this.parHanzi.get(String(c.hanzi).trim())) || this.parCle.get(nom);
    if (direct) return { s: direct, alias: null };
    const a = this.data.alias[nom];
    const base = a && this.parCle.get(a);
    return base ? { s: base, alias: base.pinyin } : null;
  },

  classe(id) { return (this.data.echelle.find(e => e.id === id) || {}); },

  pastille(c) {
    const r = this.trouver(c);
    if (!r || !r.s.nature) return `<span class="nat nat-inconnue" title="Nature non renseignée dans ta pharmacopée">—</span>`;
    const e = this.classe(r.s.nature);
    const detail = [r.s.nature_brute && "Source : " + r.s.nature_brute, r.s.saveur && "Saveur : " + r.s.saveur, r.s.tropisme && "Tropisme : " + r.s.tropisme,
      r.alias && "(nature de « " + r.alias + " », substance de base)"].filter(Boolean).join(" · ");
    return `<span class="nat nat-${r.s.nature}" title="${escapeHtml(detail)}">${escapeHtml(e.label)}</span>`;
  }
};

const Formules = {
  index: [],
  byId: new Map(),
  activeCategory: null,

  async load() {
    try {
      this.index = await Store.readJSON("formules/index.json");
      this.index.forEach(f => this.byId.set(f.id, f));
    } catch (e) {
      document.getElementById("formule-list").innerHTML =
        `<li class="muted">Base pas encore prête (${e.message}). L'extraction tourne peut-être encore en tâche de fond — recharge la page dans un instant.</li>`;
      return;
    }
    this.renderCategories();
    this.renderList(this.index);
  },

  categories() {
    const map = new Map();
    this.index.forEach(f => map.set(f.categorie_id, f.categorie_nom));
    return [...map.entries()];
  },

  renderCategories() {
    const el = document.getElementById("formule-categories");
    el.innerHTML = "";
    const all = document.createElement("button");
    all.className = "cat-chip active";
    all.textContent = "Toutes (" + this.index.length + ")";
    all.addEventListener("click", () => { this.activeCategory = null; this.applyFilters(); this.highlightCategory(all); });
    el.appendChild(all);
    this.categories().forEach(([id, nom]) => {
      const chip = document.createElement("button");
      chip.className = "cat-chip";
      const n = this.index.filter(f => f.categorie_id === id).length;
      chip.textContent = nom + " (" + n + ")";
      chip.addEventListener("click", () => { this.activeCategory = id; this.applyFilters(); this.highlightCategory(chip); });
      el.appendChild(chip);
    });
  },

  highlightCategory(chip) {
    document.querySelectorAll("#formule-categories .cat-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
  },

  applyFilters() {
    const q = document.getElementById("formule-search").value;
    this.renderList(this.search(q));
  },

  search(query) {
    let pool = this.index;
    if (this.activeCategory) pool = pool.filter(f => f.categorie_id === this.activeCategory);
    const q = (query || "").trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(f =>
      (f.pinyin || "").toLowerCase().includes(q) ||
      (f.nom_fr || "").toLowerCase().includes(q) ||
      (f.indications_syndrome || "").toLowerCase().includes(q) ||
      (f.categorie_nom || "").toLowerCase().includes(q)
    );
  },

  renderList(list) {
    const ul = document.getElementById("formule-list");
    ul.innerHTML = "";
    list.forEach(f => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="fl-pinyin">${escapeHtml(f.pinyin || f.id)}</span>
        <span class="fl-syndrome">${escapeHtml(f.indications_syndrome || "")}</span>`;
      li.addEventListener("click", () => this.showDetail(f, li));
      ul.appendChild(li);
    });
    document.getElementById("formule-count").textContent = list.length + " formule(s)";
  },

  async showDetail(entry, liEl) {
    document.querySelectorAll("#formule-list li").forEach(li => li.classList.remove("selected"));
    if (liEl) liEl.classList.add("selected");
    const detail = document.getElementById("formule-detail");
    detail.innerHTML = "<p class='muted'>Chargement...</p>";
    try {
      const f = await Store.readJSON("formules/" + entry.chemin);
      await SubstanceNature.ensureLoaded();
      detail.innerHTML = this.renderFormule(f);
      addEditControls(detail, "formules/" + entry.chemin, f, {
        onSaved: async (parsed) => {
          const i = this.index.findIndex(e => e.id === entry.id);
          const summary = {
            id: parsed.id || entry.id, pinyin: parsed.pinyin, nom_fr: parsed.nom_fr,
            categorie_id: parsed.categorie_id || entry.categorie_id, categorie_nom: parsed.categorie_nom || entry.categorie_nom,
            indications_syndrome: parsed.indications_syndrome, chemin: entry.chemin
          };
          if (i >= 0) Object.assign(this.index[i], summary); else this.index.push(summary);
          await Store.writeJSON("formules/index.json", this.index);
          this.renderCategories();
          this.applyFilters();
          await this.showDetail(entry, liEl);
        }
      });
    } catch (e) {
      detail.innerHTML = `<p class="muted">Impossible de charger la fiche (${e.message}).</p>`;
    }
  },

  // Affiche l'image "Analyse de la formule" extraite telle quelle de la documentation de cours (schéma
  // des substances groupées par fonction, avec leurs doses/actions et les flèches d'interaction) —
  // un vrai screenshot de la page, pas une reconstruction : plus fidèle et plus rapide à lire.
  renderSchemaImage(relPathFromFormule, categorieId) {
    if (!relPathFromFormule) return "";
    const src = "data/formules/" + categorieId + "/" + relPathFromFormule;
    return `<section><h3>Analyse de la formule</h3>
      <a href="${escapeHtml(src)}" target="_blank" rel="noopener" class="schema-image-link">
        <img src="${escapeHtml(src)}" alt="Analyse de la formule : rôles et interactions des substances" class="schema-image">
      </a>
      <p class="muted" data-aide>Clique sur l'image pour l'agrandir dans un nouvel onglet.</p>
    </section>`;
  },

  renderFormule(f) {
    const comp = (f.composition || []).map(c =>
      `<tr><td>${escapeHtml(c.substance_pinyin || "")}</td><td>${escapeHtml(c.hanzi || "")}</td><td>${escapeHtml(c.dose || "")}</td><td>${escapeHtml(c.role_hierarchique || "")}</td><td>${SubstanceNature.pastille(c)}</td></tr>`
    ).join("");
    const verif = (f.a_verifier && f.a_verifier.length)
      ? `<section><h3>À vérifier contre la source</h3>${f.a_verifier.map(v => `<span class="tag-verifier">⚠ ${escapeHtml(v)}</span>`).join("")}</section>`
      : "";
    const section = (title, content) => content ? `<section><h3>${title}</h3><div class="tcm-text">${formatFormuleField(content)}</div></section>` : "";
    return `
      <h2>${escapeHtml(f.pinyin || f.id)} <span class="hanzi">${escapeHtml(f.hanzi || "")}</span></h2>
      <p class="muted">${escapeHtml(f.categorie_nom || "")}${f.sous_type ? " · " + escapeHtml(f.sous_type) : ""}</p>
      ${f.nom_fr ? `<p><em>${escapeHtml(f.nom_fr)}</em></p>` : ""}
      ${comp ? `<section><h3>Composition</h3><table><thead><tr><th>Substance</th><th>Hanzi</th><th>Dose</th><th>Rôle</th><th>Nature</th></tr></thead><tbody>${comp}</tbody></table></section>` : ""}
      ${this.renderSchemaImage(f.schema_image, f.categorie_id)}
      ${section("Préparation / posologie", f.mode_de_preparation_posologie)}
      ${section("Actions thérapeutiques", f.actions_therapeutiques)}
      ${section("Indications / syndrome", f.indications_syndrome)}
      ${section("Tableau clinique", f.tableau_clinique)}
      ${f.contre_indications_precautions ? `<section><h3>Contre-indications / précautions</h3><div class="tdah-contre-ind">${formatFormuleField(f.contre_indications_precautions)}</div></section>` : ""}
      ${section("Modifications courantes", f.modifications_courantes)}
      ${section("Comparaison avec formules proches", f.comparaison_formules_proches)}
      ${verif}
      <p class="muted">Source : ${escapeHtml(f.source && f.source.fichier || "?")}</p>
    `;
  }
};

document.getElementById("formule-search").addEventListener("input", () => Formules.applyFilters());
Formules.load().then(() => Ajout.populateCategories());

/* ============ Tableaux comparatifs de formules (une famille à la fois) ============
   Données : formules/tableaux/tableaux.json, produit par formules/tableaux/generer_tableaux.py
   (mêmes tableaux que les fichiers Excel du dossier formules/tableaux/xlsx). */
const FormuleTableaux = {
  data: null,
  famille: null,
  champs: new Set(["syndrome", "plantes", "actions"]),
  masquees: new Set(), // ids de formules masquées dans la famille courante
  CHAMPS: [
    ["syndrome", "Syndrome (court)"],
    ["description", "Syndromes (description)"],
    ["plantes", "Plantes + doses"],
    ["actions", "Actions"],
    ["signes", "Signes cliniques"],
    ["ci", "Contre-indications"]
  ],
  PRESETS: [
    ["Plantes + actions", ["syndrome", "plantes", "actions"]],
    ["Syndromes + signes", ["syndrome", "description", "signes", "ci"]],
    ["Tout", ["syndrome", "description", "plantes", "actions", "signes", "ci"]]
  ],

  async ensureLoaded() {
    if (this.data) return;
    const wrap = document.getElementById("tab-comp-wrap");
    try {
      this.data = await Store.readJSON("formules/tableaux/tableaux.json");
      this.famille = this.famille || Object.keys(this.data)[0];
    } catch (e) {
      wrap.innerHTML = `<p class="muted">Tableaux pas encore générés (${escapeHtml(e.message)}).</p>`;
      return;
    }
    this.renderControls();
    this.render();
  },

  chip(host, label, active, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cat-chip" + (active ? " active" : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    host.appendChild(b);
  },

  renderControls() {
    const fam = this.data[this.famille];
    const familles = document.getElementById("tab-comp-familles");
    familles.innerHTML = "";
    Object.entries(this.data).forEach(([id, f]) =>
      this.chip(familles, `${f.titre.charAt(0)}${f.titre.slice(1).toLowerCase()} (${f.formules.length})`, id === this.famille, () => {
        this.famille = id; this.masquees.clear(); this.renderControls(); this.render();
      }));
    const champs = document.getElementById("tab-comp-champs");
    champs.innerHTML = "";
    this.CHAMPS.forEach(([id, label]) =>
      this.chip(champs, (this.champs.has(id) ? "☑ " : "☐ ") + label, this.champs.has(id), () => {
        if (this.champs.has(id)) this.champs.delete(id); else this.champs.add(id);
        this.renderControls(); this.render();
      }));
    const presets = document.getElementById("tab-comp-presets");
    presets.innerHTML = "";
    this.PRESETS.forEach(([label, ids]) =>
      this.chip(presets, label, false, () => { this.champs = new Set(ids); this.renderControls(); this.render(); }));
    const choix = document.getElementById("tab-comp-formules-choix");
    choix.innerHTML = "";
    fam.formules.forEach(f =>
      this.chip(choix, (this.masquees.has(f.id) ? "☐ " : "☑ ") + f.pinyin, !this.masquees.has(f.id), () => {
        if (this.masquees.has(f.id)) this.masquees.delete(f.id); else this.masquees.add(f.id);
        this.renderControls(); this.render();
      }));
  },

  render() {
    const fam = this.data[this.famille];
    if (!fam) return;
    const cols = fam.formules.map((f, i) => i).filter(i => !this.masquees.has(fam.formules[i].id));
    const ncol = cols.length;
    const wrap = document.getElementById("tab-comp-wrap");
    const titre = document.getElementById("tab-comp-print-titre");
    const champsTxt = this.CHAMPS.filter(([id]) => this.champs.has(id)).map(([, l]) => l).join(" · ");
    titre.textContent = `${fam.titre} — ${champsTxt || "aucun champ sélectionné"}`;
    if (!ncol || !this.champs.size) {
      wrap.innerHTML = `<p class="muted">${!ncol ? "Aucune formule affichée." : "Coche au moins un champ à comparer."}</p>`;
      return;
    }
    const head = cols.map(i => {
      const f = fam.formules[i];
      return `<th class="tab-comp-formule" data-id="${escapeHtml(f.id)}" title="Ouvrir la fiche">${escapeHtml(f.pinyin)}${f.hanzi ? `<br><span class="hanzi">${escapeHtml(f.hanzi)}</span>` : ""}</th>`;
    }).join("");
    const section = (t) => `<tr class="tab-comp-section"><th colspan="${ncol + 1}">${escapeHtml(t)}</th></tr>`;
    const xRows = (rows) => rows
      .filter(r => cols.some(i => r.cellules[i]))
      .map(r => `<tr><th>${escapeHtml(r.label)}</th>${cols.map(i => `<td class="tab-comp-x">${r.cellules[i] ? "X" : ""}</td>`).join("")}</tr>`).join("");
    const plantRows = (rows) => rows
      .filter(r => cols.some(i => r.cellules[i]))
      .map(r => `<tr><th>${escapeHtml(r.label)}${r.hanzi ? ` <span class="hanzi">${escapeHtml(r.hanzi)}</span>` : ""}</th>${cols.map(i => `<td class="tab-comp-dose">${escapeHtml(r.cellules[i]).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`).join("");

    let body = "";
    if (this.champs.has("syndrome")) {
      body += `<tr><th>Syndrome</th>${cols.map(i => `<td class="tab-comp-syndrome">${escapeHtml(fam.formules[i].syndrome || "")}</td>`).join("")}</tr>`;
    }
    if (this.champs.has("description")) {
      const cell = (i) => (fam.syndromes && fam.syndromes[i] ? fam.syndromes[i] : [])
        .map(s => `<p><strong>${escapeHtml(s.nom)}</strong>${s.description ? `<br>${escapeHtml(s.description)}` : ""}</p>`).join("");
      body += `<tr><th>Description</th>${cols.map(i => `<td class="tab-comp-syndrome">${cell(i)}</td>`).join("")}</tr>`;
    }
    if (this.champs.has("plantes")) body += section("Plantes — dose  [J = jun, C = chen, Z = zuo, S = shi]") + plantRows(fam.plantes);
    if (this.champs.has("actions") && fam.actions.length) body += section("Actions") + xRows(fam.actions);
    if (this.champs.has("signes") && fam.signes.length) body += section("Signes cliniques") + xRows(fam.signes);
    if (this.champs.has("ci") && fam.contre_indications.length) body += section("Contre-indications / précautions") + xRows(fam.contre_indications);

    wrap.innerHTML = `<table class="tab-comp"><thead><tr><th class="tab-comp-corner">${escapeHtml(fam.code)}</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
    wrap.querySelectorAll("th.tab-comp-formule").forEach(th => th.addEventListener("click", () => {
      const entry = Formules.index.find(f => f.id === th.dataset.id && f.categorie_id === this.famille);
      if (!entry) return;
      document.getElementById("formules-view-fiches").click();
      Formules.showDetail(entry);
    }));
  }
};

// Impression : on n'imprime que le tableau (voir @media print dans style.css), y compris avec Ctrl+P.
function tabCompPrintable() { return document.getElementById("formules-view-tableaux-panel").style.display !== "none"; }
window.addEventListener("beforeprint", () => { if (tabCompPrintable()) document.body.classList.add("print-tab-comp"); });
window.addEventListener("afterprint", () => document.body.classList.remove("print-tab-comp"));
document.getElementById("tab-comp-print").addEventListener("click", () => window.print());

document.getElementById("formules-view-fiches").addEventListener("click", () => {
  document.getElementById("formules-view-fiches").classList.add("active");
  document.getElementById("formules-view-tableaux").classList.remove("active");
  document.getElementById("formules-view-fiches-panel").style.display = "";
  document.getElementById("formules-view-tableaux-panel").style.display = "none";
});
document.getElementById("formules-view-tableaux").addEventListener("click", () => {
  document.getElementById("formules-view-tableaux").classList.add("active");
  document.getElementById("formules-view-fiches").classList.remove("active");
  document.getElementById("formules-view-fiches-panel").style.display = "none";
  document.getElementById("formules-view-tableaux-panel").style.display = "";
  FormuleTableaux.ensureLoaded();
});

/* ============================= Réf. Psy (Farrell) ============================= */
const Psy = {
  entries: [], // {id, kind: "niveau"|"vaisseau", nom, chemin}
  activeSysteme: null,
  rawIndex: null,
  _deepIndexed: false,
  _deepIndexing: false,

  async ensureDeepIndexed() {
    if (this._deepIndexed || this._deepIndexing) return;
    this._deepIndexing = true;
    await Promise.all(this.entries.map(async e => {
      try {
        const d = await Store.readJSON("psycho_emotionnel/" + e.chemin);
        e._searchText = flattenDetailText(d);
      } catch (err) { /* fiche indisponible pour l'instant — la recherche restera limitée au résumé */ }
    }));
    this._deepIndexed = true;
    this._deepIndexing = false;
  },

  async load() {
    try {
      const idx = await Store.readJSON("psycho_emotionnel/index.json");
      this.rawIndex = idx;
      document.querySelector(".psy-status").textContent = idx.statut || "";
      this.entries = [
        ...(idx.niveaux || []).map(n => ({ ...n, kind: "niveau" })),
        ...(idx.vaisseaux || []).map(v => ({ ...v, kind: "vaisseau" }))
      ];
    } catch (e) {
      document.getElementById("psy-list").innerHTML =
        `<li class="muted">Base pas encore prête (${e.message}).</li>`;
      return;
    }
    try {
      const stermanIdx = await Store.readJSON("psycho_emotionnel/sterman_principes/index.json");
      this.stermanRawIndex = stermanIdx;
      this.entries.push(...(stermanIdx.principes || []).map(p => ({ ...p, kind: "sterman", chemin: "sterman_principes/" + p.chemin })));
    } catch (e) { /* pas encore extrait — silencieux, cette section n'apparaît que quand elle existe */ }
    try {
      const yuenIdx = await Store.readJSON("psycho_emotionnel/jeffrey_yuen_principes/index.json");
      this.yuenRawIndex = yuenIdx;
      this.entries.push(...(yuenIdx.principes || []).map(p => ({ ...p, kind: "yuen", chemin: "jeffrey_yuen_principes/" + p.chemin })));
    } catch (e) { /* pas encore distillé — silencieux */ }
    this.renderGroups();
    this.renderList(this.entries);
  },

  // Les 4 systèmes classiques (Sinews / Luo / Divergents / 8 Merveilleux Vaisseaux) — Farrell et
  // Sterman y sont tous deux rattachés, quelle que soit l'autrice, pour retrouver un point d'entrée
  // unique par système plutôt que de garder les deux corpus dans des silos séparés.
  systeme(e) {
    if (e.kind === "niveau") {
      const map = { tendino_musculaire: "Sinews", luo: "Luo", meridiens_distincts: "Divergents", merveilleux_vaisseaux: "8EV" };
      return map[e.id] || "Autre";
    }
    if (e.kind === "vaisseau") return (e.id || "").startsWith("confluence_") ? "Divergents" : "8EV";
    if (e.kind === "sterman" || e.kind === "yuen") {
      const map = { Sinew: "Sinews", Luo: "Luo", Divergent: "Divergents", "8EV": "8EV" };
      return map[e.categorie_source] || "Autre";
    }
    return "Autre";
  },

  // Sous-catégorisation heuristique (mots-clés du titre/résumé) — les fiches Farrell (niveau/vaisseau)
  // sont des profils complets couvrant diagnostic ET traitement, donc regroupées à part ; les principes
  // Sterman/Yuen, plus atomiques, se prêtent mieux à un tri diagnostic vs traitement vs autre.
  sousCategorie(e) {
    if (e.kind === "niveau" || e.kind === "vaisseau") return "Profil clinique (diagnostic + traitement)";
    const hay = [(e.nom || ""), (e.resume_court || "")].join(" ");
    if (/diagnostic|pouls|signe|critère|critere|différenci|differenci|décision|decision|choisir|distinguer/i.test(hay)) return "Diagnostic";
    if (/traitement|protocole|technique|point|piquer|aiguille|puncture|cure|séquence|sequence|ordre d[e']/i.test(hay)) return "Traitement";
    return "Autre";
  },

  renderGroups() {
    const el = document.getElementById("psy-groups");
    el.innerHTML = "";
    const mk = (label, systeme) => {
      const chip = document.createElement("button");
      chip.className = "cat-chip" + (this.activeSysteme === systeme ? " active" : "");
      chip.textContent = label;
      chip.addEventListener("click", () => { this.activeSysteme = systeme; this.renderGroups(); this.applyFilters(); });
      return chip;
    };
    el.appendChild(mk("Tous (" + this.entries.length + ")", null));
    ["Sinews", "Luo", "Divergents", "8EV"].forEach(sys => {
      const n = this.entries.filter(e => this.systeme(e) === sys).length;
      if (n) el.appendChild(mk(sys + " (" + n + ")", sys));
    });
    if (this.activeSysteme === null) el.firstChild.classList.add("active");
  },

  applyFilters() {
    document.getElementById("psy-search").dispatchEvent(new Event("input"));
  },

  search(query) {
    let pool = this.entries;
    if (this.activeSysteme) pool = pool.filter(e => this.systeme(e) === this.activeSysteme);
    const q = (query || "").trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(e => (e.nom || "").toLowerCase().includes(q) || (e.categorie_source || "").toLowerCase().includes(q) || (e.resume_court || "").toLowerCase().includes(q) || (e._searchText || "").includes(q));
  },

  renderList(list) {
    const ul = document.getElementById("psy-list");
    ul.innerHTML = "";
    const bySousCat = new Map();
    list.forEach(e => {
      const sc = this.sousCategorie(e);
      if (!bySousCat.has(sc)) bySousCat.set(sc, []);
      bySousCat.get(sc).push(e);
    });
    const order = ["Profil clinique (diagnostic + traitement)", "Diagnostic", "Traitement", "Autre"];
    [...bySousCat.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b)).forEach(sc => {
      const items = bySousCat.get(sc);
      if (bySousCat.size > 1) {
        const header = document.createElement("li");
        header.className = "psy-list-subheader";
        header.textContent = sc + " (" + items.length + ")";
        ul.appendChild(header);
      }
      items.forEach(e => {
        const li = document.createElement("li");
        const seenKey = e.kind + ":" + e.id;
        const kindLabel = e.kind === "niveau" ? "Farrell — Niveau de latence" : e.kind === "vaisseau" ? "Farrell — Vaisseau / confluence" : e.kind === "yuen" ? "Jeffrey Yuen — " + (e.categorie_source || "Principe clinique") : "Sterman — " + (e.categorie_source || "Principe clinique");
        const unseen = !SeenTracker.isSeen("psy", seenKey);
        li.innerHTML = `${unseen ? '<span class="unseen-dot" title="Jamais ouverte">●</span>' : ""}<span class="fl-pinyin">${escapeHtml(e.nom)}</span>
          <span class="fl-syndrome">${escapeHtml(kindLabel)}</span>`;
        li.addEventListener("click", () => this.showDetail(e, li));
        ul.appendChild(li);
      });
    });
    document.getElementById("psy-count").textContent = list.length + " entrée(s)";
  },

  async showDetail(entry, liEl) {
    document.querySelectorAll("#psy-list li").forEach(li => li.classList.remove("selected"));
    if (liEl) liEl.classList.add("selected");
    const detail = document.getElementById("psy-detail");
    detail.innerHTML = "<p class='muted'>Chargement...</p>";
    detail.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const d = await Store.readJSON("psycho_emotionnel/" + entry.chemin);
      detail.innerHTML = entry.kind === "niveau" ? this.renderNiveau(d) : entry.kind === "vaisseau" ? this.renderVaisseau(d) : this.renderSterman(d);
      SeenTracker.markSeen("psy", entry.kind + ":" + entry.id);
      if (liEl) liEl.querySelector(".unseen-dot")?.remove();
      this.attachSeenToggle(detail, entry, liEl);
      addEditControls(detail, "psycho_emotionnel/" + entry.chemin, d, {
        onSaved: async (parsed) => {
          if (entry.kind === "sterman" || entry.kind === "yuen") {
            const rawIdx = entry.kind === "sterman" ? this.stermanRawIndex : this.yuenRawIndex;
            const indexPath = entry.kind === "sterman" ? "psycho_emotionnel/sterman_principes/index.json" : "psycho_emotionnel/jeffrey_yuen_principes/index.json";
            const cheminPrefix = entry.kind === "sterman" ? "sterman_principes/" : "jeffrey_yuen_principes/";
            const arr = (rawIdx && rawIdx.principes) || [];
            const i = arr.findIndex(x => x.id === entry.id);
            const summary = { id: parsed.id || entry.id, nom: parsed.nom, categorie_source: parsed.categorie_source, resume_court: parsed.resume_court, chemin: entry.chemin.replace(new RegExp("^" + cheminPrefix), "") };
            if (i >= 0) Object.assign(arr[i], summary); else arr.push(summary);
            await Store.writeJSON(indexPath, rawIdx);
            const eIdx = this.entries.findIndex(e => e.id === entry.id && e.kind === entry.kind);
            if (eIdx >= 0) Object.assign(this.entries[eIdx], summary);
            this.renderGroups();
            this.applyFilters();
            await this.showDetail(entry, liEl);
            return;
          }
          const key = entry.kind === "niveau" ? "niveaux" : "vaisseaux";
          if (!this.rawIndex[key]) this.rawIndex[key] = [];
          const arr = this.rawIndex[key];
          const i = arr.findIndex(x => x.id === entry.id);
          const summary = { id: parsed.id || entry.id, nom: parsed.nom, chemin: entry.chemin };
          if (i >= 0) Object.assign(arr[i], summary); else arr.push(summary);
          await Store.writeJSON("psycho_emotionnel/index.json", this.rawIndex);
          const eIdx = this.entries.findIndex(e => e.id === entry.id && e.kind === entry.kind);
          if (eIdx >= 0) Object.assign(this.entries[eIdx], summary);
          this.renderGroups();
          this.applyFilters();
          await this.showDetail(entry, liEl);
        }
      });
    } catch (e) {
      detail.innerHTML = `<p class="muted">Impossible de charger la fiche (${e.message}).</p>`;
    }
  },

  // Ajoute un petit bouton dans l'en-tête sticky pour re-marquer une fiche comme "non-vue"
  // (fait réapparaître le point rouge dans la liste) — pour y revenir volontairement plus tard.
  attachSeenToggle(detail, entry, liEl) {
    const header = detail.querySelector(".psy-sticky-header");
    if (!header) return;
    const seenKey = entry.kind + ":" + entry.id;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "seen-toggle-btn";
    btn.textContent = "○ Marquer comme non-vue";
    btn.addEventListener("click", () => {
      SeenTracker.markUnseen("psy", seenKey);
      if (liEl && !liEl.querySelector(".unseen-dot")) {
        liEl.insertAdjacentHTML("afterbegin", '<span class="unseen-dot" title="Jamais ouverte">●</span>');
      }
      btn.textContent = "✅ Marquée non-vue";
      btn.disabled = true;
    });
    header.appendChild(btn);
  },

  renderNiveau(d) {
    const list = (arr) => arr && arr.length ? `<ul class="tcm-list">${arr.map(x => `<li>${formatArrayEntry(x)}</li>`).join("")}</ul>` : "";
    const dec = d.decision_liberer_vs_maintenir || {};
    const verif = (d.a_verifier && d.a_verifier.length)
      ? `<section><h3>À vérifier contre la source</h3>${d.a_verifier.map(v => `<span class="tag-verifier">⚠ ${escapeHtml(v)}</span>`).join("")}</section>`
      : "";
    return `
      <div class="psy-sticky-header"><h2>${escapeHtml(d.nom)}</h2></div>
      ${d.description_generale ? `<section><h3>Description</h3><div class="tcm-text">${formatTcmText(d.description_generale)}</div></section>` : ""}
      ${d.indications_cliniques ? `<section><h3>Indications cliniques</h3>${list(d.indications_cliniques)}</section>` : ""}
      ${(dec.critere || dec.technique_maintenir || dec.technique_liberer) ? `
      <section class="psy-decision">
        <h3>Maintenir ou libérer la latence ?</h3>
        ${dec.critere ? `<div class="tcm-text">${formatTcmText(dec.critere)}</div>` : ""}
        <div class="psy-retention-grid">
          <div class="psy-box psy-box-maintenir">
            <h4>🔧 Astuces pour MAINTENIR (ressources insuffisantes)</h4>
            <div class="tcm-text">${dec.technique_maintenir ? formatTcmText(dec.technique_maintenir) : '<p class="muted">Non formulé explicitement dans le livre pour ce niveau (voir à_vérifier).</p>'}</div>
          </div>
          <div class="psy-box psy-box-liberer">
            <h4>LIBÉRER (ressources suffisantes)</h4>
            <div class="tcm-text">${dec.technique_liberer ? formatTcmText(dec.technique_liberer) : '<p class="muted">Non formulé explicitement dans le livre pour ce niveau.</p>'}</div>
          </div>
        </div>
      </section>` : ""}
      ${d.points_ou_structures_cles ? `<section><h3>Points / structures clés</h3>${formatPointsTable(d.points_ou_structures_cles)}</section>` : ""}
      ${d.avertissements_precautions ? `<section><h3>Avertissements / précautions</h3><div class="tcm-text">${formatTcmText(d.avertissements_precautions)}</div></section>` : ""}
      ${verif}
      <p class="muted">Source : ${escapeHtml((d.source && d.source.livre) || "?")}${d.source && (d.source.chapitre_ou_page || d.source.chapitre_ou_section) ? " — " + escapeHtml(d.source.chapitre_ou_page || d.source.chapitre_ou_section) : ""}</p>
    `;
  },

  renderVaisseau(d) {
    const list = (arr) => arr && arr.length ? `<ul class="tcm-list">${arr.map(x => `<li>${formatArrayEntry(x)}</li>`).join("")}</ul>` : "";
    const verif = (d.a_verifier && d.a_verifier.length)
      ? `<section><h3>À vérifier contre la source</h3>${d.a_verifier.map(v => `<span class="tag-verifier">⚠ ${escapeHtml(v)}</span>`).join("")}</section>`
      : "";
    const citations = (d.citations_notables && d.citations_notables.length)
      ? `<section><h3>Citations notables</h3>${d.citations_notables.map(c => `<blockquote>${escapeHtml(c)}</blockquote>`).join("")}</section>`
      : "";
    return `
      <div class="psy-sticky-header"><h2>${escapeHtml(d.nom)}</h2></div>
      ${d.signature_emotionnelle ? `<section><h3>Signature émotionnelle</h3><div class="tcm-text">${formatTcmText(d.signature_emotionnelle)}</div></section>` : ""}
      ${d.pathologies_indications ? `<section><h3>Pathologies / indications</h3>${list(d.pathologies_indications)}</section>` : ""}
      ${d.points_cles ? `<section><h3>Points clés</h3>${formatPointsTable(d.points_cles)}</section>` : ""}
      ${citations}
      ${verif}
      <p class="muted">Source : ${escapeHtml((d.source && d.source.livre) || "?")}${d.source && (d.source.chapitre_ou_page || d.source.chapitre_ou_section) ? " — " + escapeHtml(d.source.chapitre_ou_page || d.source.chapitre_ou_section) : ""}</p>
    `;
  },

  renderSterman(d) {
    const list = (arr) => arr && arr.length ? `<ul class="tcm-list">${arr.map(x => `<li>${formatArrayEntry(x)}</li>`).join("")}</ul>` : "";
    const verif = (d.a_verifier && d.a_verifier.length)
      ? `<section><h3>À vérifier contre la source</h3>${d.a_verifier.map(v => `<span class="tag-verifier">⚠ ${escapeHtml(v)}</span>`).join("")}</section>`
      : "";
    return `
      <div class="psy-sticky-header">
        <h2>${escapeHtml(d.nom)}</h2>
        <p class="muted">${escapeHtml(d.categorie_source || "")}${d.source && d.source.livre ? " · " + escapeHtml(d.source.livre) : ""}</p>
      </div>
      ${d.principe_pratiquable ? `<section><h3>Principe</h3><div class="tcm-text">${formatTcmText(d.principe_pratiquable)}</div></section>` : ""}
      ${(d.instructions_mise_en_pratique || d.contexte_utilisation) ? `
      <section class="psy-decision">
        <h3>Mise en pratique</h3>
        <div class="psy-retention-grid">
          <div class="psy-box psy-box-liberer">
            <h4>Dans quel contexte l'utiliser</h4>
            <div class="tcm-text">${d.contexte_utilisation ? formatTcmText(d.contexte_utilisation) : '<p class="muted">Non précisé.</p>'}</div>
          </div>
          <div class="psy-box psy-box-maintenir">
            <h4>🔧 Comment l'appliquer</h4>
            <div class="tcm-text">${d.instructions_mise_en_pratique ? formatTcmText(d.instructions_mise_en_pratique) : '<p class="muted">Non précisé.</p>'}</div>
          </div>
        </div>
      </section>` : ""}
      ${d.points_ou_structures_cles ? `<section><h3>Points / structures clés</h3>${formatPointsTable(d.points_ou_structures_cles)}</section>` : ""}
      ${d.avertissements_precautions ? `<section><h3>Avertissements / précautions</h3><div class="tcm-text">${formatTcmText(d.avertissements_precautions)}</div></section>` : ""}
      ${verif}
      <p class="muted">Source : ${escapeHtml((d.source && d.source.livre) || "?")}${d.source && d.source.chapitre_ou_page ? " — " + escapeHtml(d.source.chapitre_ou_page) : ""}</p>
    `;
  }
};

document.getElementById("psy-search").addEventListener("input", (e) => Psy.renderList(Psy.search(e.target.value)));
Psy.load().then(() => Psy.ensureDeepIndexed());

/* ============================= Tuteur Farrell (quiz) ============================= */
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const Tuteur = {
  pool: [],
  score: { correct: 0, total: 0 },
  current: null,
  history: [],
  historyIndex: -1,
  STORAGE_KEY: "mtc_tuteur_state_v1",

  loadPersisted() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.history) || !saved.history.length) return false;
      this.history = saved.history;
      this.historyIndex = Number.isInteger(saved.historyIndex) ? saved.historyIndex : this.history.length - 1;
      this.score = saved.score || { correct: 0, total: 0 };
      this.current = this.history[this.historyIndex] || this.history[this.history.length - 1];
      return true;
    } catch (e) { return false; }
  },

  persist() {
    try {
      if (this.history.length > 200) { this.history = this.history.slice(-200); this.historyIndex = this.history.length - 1; }
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ history: this.history, historyIndex: this.historyIndex, score: this.score }));
    } catch (e) { /* quota dépassé ou navigation privée — silencieux */ }
  },

  async ensureLoaded() {
    if (this.pool.length) return;
    const details = await Promise.all((Psy.entries || []).map(async e => {
      try {
        const d = await Store.readJSON("psycho_emotionnel/" + e.chemin);
        return Object.assign({}, e, { detail: d });
      } catch (err) { return null; }
    }));
    this.pool = details.filter(Boolean);
  },

  aliasesFor(entry) {
    const nom = entry.detail.nom || entry.nom || "";
    const aliases = [entry.nom];
    const m = nom.match(/^([^(]+)\(([^)]*)\)?/);
    let primary = nom.trim();
    if (m) {
      primary = m[1].trim();
      aliases.push(primary);
      (m[2] || "").split(/[,/]/).forEach(a => {
        const t = a.replace(/^alias\s*:\s*/i, "").trim();
        if (t) aliases.push(t);
      });
    } else {
      aliases.push(primary);
      const colonIdx = primary.indexOf(" : ");
      if (colonIdx > 0) aliases.push(primary.slice(0, colonIdx).trim());
    }
    // noms de vaisseaux de type "X Mai" sont souvent cités dans le texte sans le "Mai" (ex: "le Yang Qiao amène...")
    const stem = primary.replace(/\s+Mai$/i, "").trim();
    if (stem && stem !== primary) aliases.push(stem);
    return [...new Set(aliases.filter(Boolean))].sort((a, b) => b.length - a.length);
  },

  mask(text, entry) {
    let out = text;
    const placeholder = entry.kind === "niveau" ? "[ce niveau]" : entry.kind === "vaisseau" ? "[ce vaisseau/cette confluence]" : "[ce principe]";
    this.aliasesFor(entry).forEach(alias => {
      if (alias.length < 3) return;
      const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(esc, "gi"), placeholder);
    });
    return out;
  },

  pickSnippet(entry) {
    const d = entry.detail;
    const candidates = (entry.kind === "sterman" || entry.kind === "yuen")
      ? [d.principe_pratiquable].filter(Boolean)
      : [d.signature_emotionnelle, d.description_generale].filter(Boolean);
    if (!candidates.length) return null;
    const text = candidates[Math.floor(Math.random() * candidates.length)];
    const sentences = text.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
    return this.mask(sentences, entry);
  },

  buildIdentifyQuestion() {
    const candidates = this.pool.filter(e => e.detail.signature_emotionnelle || e.detail.description_generale || e.detail.principe_pratiquable);
    if (!candidates.length) return null;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const snippet = this.pickSnippet(target);
    if (!snippet) return null;
    let distractors = shuffleArray(this.pool.filter(p => p.kind === target.kind && p.id !== target.id)).slice(0, 3);
    if (distractors.length < 3) {
      const chosenIds = new Set([target.id, ...distractors.map(d => d.id)]);
      const extra = shuffleArray(this.pool.filter(p => !chosenIds.has(p.id))).slice(0, 3 - distractors.length);
      distractors = distractors.concat(extra);
    }
    const options = shuffleArray([target, ...distractors]).map(o => ({ id: o.id, label: o.nom }));
    const promptLabel = (target.kind === "sterman" || target.kind === "yuen") ? "Quel principe clinique correspond à cet énoncé" : "Quel niveau de latence / vaisseau / confluence correspond à cette description";
    return {
      type: "identify",
      prompt: `${promptLabel} ?\n\n« ${snippet} »`,
      options,
      correctId: target.id,
      sourceLabel: (target.detail.source && target.detail.source.livre) || "",
      target
    };
  },

  buildMaintenirLibererQuestion() {
    const candidates = this.pool.filter(e => e.kind === "niveau" && e.detail.decision_liberer_vs_maintenir &&
      e.detail.decision_liberer_vs_maintenir.technique_maintenir && e.detail.decision_liberer_vs_maintenir.technique_liberer);
    if (!candidates.length) return null;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const dec = target.detail.decision_liberer_vs_maintenir;
    const isMaintenir = Math.random() < 0.5;
    const rawText = isMaintenir ? dec.technique_maintenir : dec.technique_liberer;
    const sentences = rawText.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
    return {
      type: "maintenir_liberer",
      prompt: `Niveau : ${target.detail.nom}\n\nCette technique s'applique-t-elle quand on doit MAINTENIR ou LIBÉRER la latence ?\n\n« ${sentences} »`,
      options: [{ id: "maintenir", label: "Maintenir" }, { id: "liberer", label: "Libérer" }],
      correctId: isMaintenir ? "maintenir" : "liberer",
      target,
      criteriaText: dec.critere
    };
  },

  buildContexteApplicationQuestion() {
    const candidates = this.pool.filter(e => (e.kind === "sterman" || e.kind === "yuen") && e.detail.contexte_utilisation && e.detail.instructions_mise_en_pratique);
    if (!candidates.length) return null;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const isContexte = Math.random() < 0.5;
    const rawText = isContexte ? target.detail.contexte_utilisation : target.detail.instructions_mise_en_pratique;
    const sentences = this.mask(rawText.split(/(?<=[.!?])\s+/).slice(0, 2).join(" "), target);
    return {
      type: "contexte_application",
      prompt: `Principe : ${target.detail.nom}\n\nCe texte décrit-il le CONTEXTE d'utilisation (quand s'en servir) ou les INSTRUCTIONS de mise en pratique (comment l'appliquer) ?\n\n« ${sentences} »`,
      options: [{ id: "contexte", label: "Contexte d'utilisation" }, { id: "application", label: "Instructions de mise en pratique" }],
      correctId: isContexte ? "contexte" : "application",
      target,
      criteriaText: null
    };
  },

  // Teste le contenu clinique lui-même plutôt que la forme d'un paragraphe : à partir d'une
  // indication de point (sans son code ni son nom), il faut retrouver à quel niveau/vaisseau
  // ce point appartient — nécessite de connaître le sens clinique, pas juste reconnaître un style de texte.
  buildPointOriginQuestion() {
    const candidates = this.pool.filter(e => (e.kind === "niveau" || e.kind === "vaisseau") &&
      Array.isArray(e.detail.points_ou_structures_cles || e.detail.points_cles) &&
      (e.detail.points_ou_structures_cles || e.detail.points_cles).length);
    if (!candidates.length) return null;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const pointsArr = target.detail.points_ou_structures_cles || target.detail.points_cles;
    const rawPoint = pointsArr[Math.floor(Math.random() * pointsArr.length)];
    const idx = rawPoint.indexOf(":");
    if (idx < 0) return null;
    const indicationRaw = rawPoint.slice(idx + 1).trim();
    const sentence = this.mask(indicationRaw.split(/(?<=[.!?;])\s+/).slice(0, 2).join(" "), target);
    if (!sentence) return null;
    let distractors = shuffleArray(this.pool.filter(p => p.kind === target.kind && p.id !== target.id)).slice(0, 3);
    if (distractors.length < 3) {
      const chosenIds = new Set([target.id, ...distractors.map(d => d.id)]);
      const extra = shuffleArray(this.pool.filter(p => p.kind === target.kind && !chosenIds.has(p.id)));
      distractors = distractors.concat(extra).slice(0, 3);
    }
    if (!distractors.length) return null;
    const options = shuffleArray([target, ...distractors]).map(o => ({ id: o.id, label: o.nom }));
    const label = target.kind === "niveau" ? "niveau de latence" : "vaisseau/confluence";
    return {
      type: "point_origin",
      prompt: `Ce point et son sens clinique appartiennent à quel ${label} ?\n\n« ${sentence} »`,
      options,
      correctId: target.id,
      target,
      sourceLabel: (target.detail.source && target.detail.source.livre) || ""
    };
  },

  async nextQuestion() {
    const quizEl = document.getElementById("tut-quiz");
    quizEl.innerHTML = `<p class="muted">Chargement...</p>`;
    await this.ensureLoaded();
    if (!this.pool.length) { quizEl.innerHTML = `<p class="muted">Base Réf. Psy pas encore prête.</p>`; return; }
    const r = Math.random();
    let q = r < 0.30 ? this.buildIdentifyQuestion()
      : r < 0.50 ? this.buildMaintenirLibererQuestion()
      : r < 0.85 ? this.buildPointOriginQuestion()
      : this.buildContexteApplicationQuestion();
    if (!q) q = this.buildPointOriginQuestion() || this.buildIdentifyQuestion() || this.buildMaintenirLibererQuestion() || this.buildContexteApplicationQuestion();
    if (!q) { quizEl.innerHTML = `<p class="muted">Pas assez de contenu vérifié pour générer une question.</p>`; return; }
    this.history.push(q);
    this.historyIndex = this.history.length - 1;
    this.current = q;
    this.persist();
    this.render(q);
  },

  goTo(index) {
    if (index < 0 || index >= this.history.length) return;
    this.historyIndex = index;
    this.current = this.history[index];
    this.render(this.current);
  },

  goPrev() { this.goTo(this.historyIndex - 1); },
  goNext() { this.goTo(this.historyIndex + 1); },

  render(q) {
    const quizEl = document.getElementById("tut-quiz");
    const isLatest = this.historyIndex === this.history.length - 1;
    const optsHtml = q.options.map(o => `<button type="button" class="tut-option" data-id="${escapeHtml(o.id)}">${escapeHtml(o.label)}</button>`).join("");
    quizEl.innerHTML = `
      <div class="tut-nav">
        <button type="button" id="tut-prev" ${this.historyIndex <= 0 ? "disabled" : ""}>◀ Précédente</button>
        <span class="muted">Question ${this.historyIndex + 1} / ${this.history.length}</span>
        <button type="button" id="tut-next-inline" ${isLatest ? "disabled" : ""}>Suivante ▶</button>
      </div>
      <div class="tut-prompt">${escapeHtml(q.prompt).replace(/\n/g, "<br>")}</div>
      <div class="tut-options">${optsHtml}</div>
      <div id="tut-feedback"></div>
    `;
    document.getElementById("tut-prev").addEventListener("click", () => this.goPrev());
    document.getElementById("tut-next-inline").addEventListener("click", () => this.goNext());
    quizEl.querySelectorAll(".tut-option").forEach(btn => {
      if (!q.answered) btn.addEventListener("click", () => this.answer(btn.dataset.id));
    });
    if (q.answered) this.showFeedback(q);
  },

  answer(chosenId) {
    const q = this.current;
    if (!q || q.answered) return;
    q.answered = true;
    q.chosenId = chosenId;
    q.wasCorrect = chosenId === q.correctId;
    this.score.total++;
    if (q.wasCorrect) this.score.correct++;
    document.getElementById("tut-score").textContent = `Score : ${this.score.correct}/${this.score.total}`;
    this.persist();
    this.showFeedback(q);
  },

  showFeedback(q) {
    document.querySelectorAll(".tut-option").forEach(btn => {
      btn.disabled = true;
      if (btn.dataset.id === q.correctId) btn.classList.add("tut-correct");
      else if (btn.dataset.id === q.chosenId) btn.classList.add("tut-wrong");
    });
    const fb = document.getElementById("tut-feedback");
    let extra = "";
    if (q.type === "identify") {
      extra = `<p class="muted">Réponse : ${escapeHtml(q.target.nom)} — source : ${escapeHtml(q.sourceLabel)}</p>`;
    } else if (q.type === "maintenir_liberer" && q.criteriaText) {
      extra = `<h4 class="sec-sub">Critère de décision (texte source)</h4><div class="tcm-text">${formatTcmText(q.criteriaText)}</div>`;
    } else if (q.type === "contexte_application") {
      const src = q.target.detail.source && q.target.detail.source.livre;
      extra = `<p class="muted">Principe : ${escapeHtml(q.target.nom)}${src ? " — source : " + escapeHtml(src) : ""}</p>`;
    } else if (q.type === "point_origin") {
      extra = `<p class="muted">Réponse : ${escapeHtml(q.target.nom)}${q.sourceLabel ? " — source : " + escapeHtml(q.sourceLabel) : ""}</p>`;
    }
    fb.innerHTML = `<p class="${q.wasCorrect ? "tut-feedback-ok" : "tut-feedback-ko"}">${q.wasCorrect ? "✅ Correct !" : "❌ Pas la bonne réponse."}</p>${extra}`;
  }
};

document.getElementById("tut-next").addEventListener("click", () => Tuteur.nextQuestion());
document.querySelector('.tab-btn[data-tab="tuteur"]').addEventListener("click", () => {
  if (!Tuteur.current && Tuteur.loadPersisted()) {
    document.getElementById("tut-score").textContent = `Score : ${Tuteur.score.correct}/${Tuteur.score.total}`;
    Tuteur.render(Tuteur.current);
  }
});

/* ============================= Syndromes ============================= */
const Syndromes = {
  entries: [], // {id, domaine, nom, sousLabel, chemin}
  activeDomaine: null,
  domaineLabels: { organes: "Organes", externes: "Externes", qi_sang_liquides: "Qi / Sang / Liquides", canaux: "Canaux", merveilleux_vaisseaux: "Merveilleux vaisseaux" },
  rawIndexByDomaine: {},
  _deepIndexed: false,
  _deepIndexing: false,

  async ensureDeepIndexed() {
    if (this._deepIndexed || this._deepIndexing) return;
    this._deepIndexing = true;
    await Promise.all(this.entries.map(async e => {
      try {
        const d = await Store.readJSON(`syndromes/${e.domaine}/${e.chemin}`);
        e._searchText = flattenDetailText(d);
      } catch (err) { /* fiche indisponible pour l'instant */ }
    }));
    this._deepIndexed = true;
    this._deepIndexing = false;
    const champ = document.getElementById("syn-search");
    if (champ && champ.value.trim()) this.applyFilters();       // une recherche déjà saisie profite de l'index complet
  },

  async loadDomaine(domaine, relPath) {
    try {
      const arr = await Store.readJSON(relPath);
      this.rawIndexByDomaine[domaine] = arr;
      return arr.map(e => ({
        id: e.id,
        domaine,
        nom: e.nom_syndrome || e.id,
        chemin: e.chemin || e.chemin_relatif,
        sousLabel: e.organe || e.niveau_ou_couche || e.sous_categorie || e.vaisseau || ""
      }));
    } catch (e) { return []; }
  },

  async load() {
    const [organes, externes, qsl, canaux, mv] = await Promise.all([
      this.loadDomaine("organes", "syndromes/organes/index.json"),
      this.loadDomaine("externes", "syndromes/externes/index.json"),
      this.loadDomaine("qi_sang_liquides", "syndromes/qi_sang_liquides/index.json"),
      this.loadDomaine("canaux", "syndromes/canaux/index.json"),
      this.loadDomaine("merveilleux_vaisseaux", "syndromes/merveilleux_vaisseaux/index.json")
    ]);
    this.entries = [...organes, ...externes, ...qsl, ...canaux, ...mv];
    if (this.entries.length === 0) {
      document.getElementById("syn-list").innerHTML = `<li class="muted">Base pas encore prête — l'extraction tourne peut-être encore en tâche de fond.</li>`;
      return;
    }
    this.renderGroups();
    this.renderList(this.entries);
  },

  renderGroups() {
    const el = document.getElementById("syn-groups");
    el.innerHTML = "";
    const mk = (label, domaine) => {
      const chip = document.createElement("button");
      chip.className = "cat-chip" + (this.activeDomaine === domaine ? " active" : "");
      chip.textContent = label;
      chip.addEventListener("click", () => { this.activeDomaine = domaine; this.renderGroups(); this.applyFilters(); });
      return chip;
    };
    el.appendChild(mk("Tous (" + this.entries.length + ")", null));
    Object.entries(this.domaineLabels).forEach(([id, label]) => {
      el.appendChild(mk(label + " (" + this.entries.filter(e => e.domaine === id).length + ")", id));
    });
    if (this.activeDomaine === null) el.firstChild.classList.add("active");
  },

  applyFilters() {
    document.getElementById("syn-search").dispatchEvent(new Event("input"));
  },

  search(query) {
    let pool = this.entries;
    if (this.activeDomaine) pool = pool.filter(e => e.domaine === this.activeDomaine);
    const q = dsNorm((query || "").trim());
    if (!q) return pool;
    // nom, sous-titre, puis texte complet de la fiche (signes, mécanismes, traitement…) une fois les fiches indexées
    return pool.filter(e => dsNorm(e.nom).includes(q) || dsNorm(e.sousLabel).includes(q) || this.texteNorm(e).includes(q));
  },

  // texte complet de la fiche, normalisé une seule fois (sans accents, minuscules)
  texteNorm(e) {
    if (!e._searchText) return "";
    if (e._searchNormSrc !== e._searchText) { e._searchNorm = dsNorm(e._searchText); e._searchNormSrc = e._searchText; }
    return e._searchNorm;
  },

  // extrait du texte de la fiche autour du mot cherché (null si le mot est déjà dans le nom)
  extrait(e, query) {
    const q = dsNorm((query || "").trim());
    if (!q || dsNorm(e.nom).includes(q) || dsNorm(e.sousLabel).includes(q)) return null;
    const i = this.texteNorm(e).indexOf(q);
    if (i < 0) return null;
    const t = e._searchText;
    const avant = t.slice(Math.max(0, i - 35), i), mot = t.slice(i, i + q.length), apres = t.slice(i + q.length, i + q.length + 45);
    return (i > 35 ? "… " : "") + escapeHtml(avant) + '<mark class="surlignage">' + escapeHtml(mot) + "</mark>" + escapeHtml(apres) + " …";
  },

  // souligne le mot cherché dans la fiche affichée et amène la première occurrence à l'écran
  surligner(racine, query) {
    const q = dsNorm((query || "").trim());
    if (!q) return;
    const noeuds = [];
    const marche = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
    while (marche.nextNode()) noeuds.push(marche.currentNode);
    noeuds.forEach(n => {
      const t = n.nodeValue;
      if (!dsNorm(t).includes(q)) return;
      const frag = document.createElement("span");
      frag.innerHTML = dsMarque(t, query).replace(/<mark class="surlignage">/g, '<mark class="surlignage trouve">');
      n.replaceWith(...frag.childNodes);
    });
    const premier = racine.querySelector("mark.trouve");
    if (premier) premier.scrollIntoView({ block: "center", behavior: "smooth" });
  },

  renderList(list, query) {
    const ul = document.getElementById("syn-list");
    ul.innerHTML = "";
    list.forEach(e => {
      const li = document.createElement("li");
      const ex = this.extrait(e, query);
      li.innerHTML = `<span class="fl-pinyin">${escapeHtml(e.nom)}</span>
        <span class="fl-syndrome">${escapeHtml(this.domaineLabels[e.domaine])}${e.sousLabel ? " · " + escapeHtml(e.sousLabel) : ""}</span>` +
        (ex ? `<span class="fl-extrait">${ex}</span>` : "");
      li.addEventListener("click", () => this.showDetail(e, li));
      ul.appendChild(li);
    });
    document.getElementById("syn-count").textContent = list.length + " syndrome(s)";
  },

  async showDetail(entry, liEl) {
    document.querySelectorAll("#syn-list li").forEach(li => li.classList.remove("selected"));
    if (liEl) liEl.classList.add("selected");
    const detail = document.getElementById("syn-detail");
    detail.innerHTML = "<p class='muted'>Chargement...</p>";
    try {
      const d = await Store.readJSON(`syndromes/${entry.domaine}/${entry.chemin}`);
      detail.innerHTML = this.renderSyndrome(d, entry.domaine);
      this.surligner(detail, document.getElementById("syn-search").value);
      addEditControls(detail, "syndromes/" + entry.domaine + "/" + entry.chemin, d, {
        onSaved: async (parsed) => {
          const arr = this.rawIndexByDomaine[entry.domaine] || (this.rawIndexByDomaine[entry.domaine] = []);
          const i = arr.findIndex(x => x.id === entry.id);
          const patch = { nom_syndrome: parsed.nom_syndrome, organe: parsed.organe, niveau_ou_couche: parsed.niveau_ou_couche, sous_categorie: parsed.sous_categorie };
          if (i >= 0) Object.assign(arr[i], patch); else arr.push({ id: parsed.id || entry.id, chemin: entry.chemin, ...patch });
          await Store.writeJSON(`syndromes/${entry.domaine}/index.json`, arr);
          const eIdx = this.entries.findIndex(e => e.id === entry.id && e.domaine === entry.domaine);
          if (eIdx >= 0) Object.assign(this.entries[eIdx], { nom: parsed.nom_syndrome || entry.nom, sousLabel: parsed.organe || parsed.niveau_ou_couche || parsed.sous_categorie || "" });
          this.renderGroups();
          this.applyFilters();
          await this.showDetail(entry, liEl);
        }
      });
    } catch (e) {
      detail.innerHTML = `<p class="muted">Impossible de charger la fiche (${e.message}).</p>`;
    }
  },

  renderClinicalTable(rows) {
    if (!rows || !rows.length) return "";
    const body = rows.map(r => `<tr><td>${tcmHighlightInline(escapeHtml(r.symptome || ""))}</td><td>${tcmHighlightInline(escapeHtml(r.mecanisme || ""))}</td></tr>`).join("");
    return `<section><h3>Tableau clinique</h3><table><thead><tr><th>Symptôme</th><th>Mécanisme</th></tr></thead><tbody>${body}</tbody></table></section>`;
  },

  renderList_(arr, title) {
    if (!arr || !arr.length) return "";
    return `<section><h3>${title}</h3><ul class="tcm-list">${arr.map(x => `<li>${formatArrayEntry(x)}</li>`).join("")}</ul></section>`;
  },

  renderTraitement(t) {
    if (!t) return "";
    const acZangFu = (t.acupuncture_zang_fu && t.acupuncture_zang_fu.length)
      ? `<h4 class="sec-sub">Acupuncture des zàng fǔ</h4><ul class="tcm-list">${t.acupuncture_zang_fu.map(x => `<li>${tcmHighlightInline(escapeHtml(x))}</li>`).join("")}</ul>` : "";
    const acClassique = (t.acupuncture_classique && t.acupuncture_classique.length)
      ? `<h4 class="sec-sub">Acupuncture classique</h4>` + t.acupuncture_classique.map(c => {
          const groupes = (c.groupes || []).map(g => Array.isArray(g) ? g.join(", ") : g).join(" · ");
          return `<p><strong>${escapeHtml(c.couple_canaux || "")}</strong> : ${escapeHtml(groupes)}</p>`;
        }).join("") : "";
    const commun = (t.pour_toutes_situations && t.pour_toutes_situations.length)
      ? `<h4 class="sec-sub">Pour toutes les situations</h4><p>${escapeHtml(t.pour_toutes_situations.join(", "))}</p>` : "";
    const pharma = (t.pharmacopee && t.pharmacopee.length)
      ? `<h4 class="sec-sub">Pharmacopée</h4><ul class="tcm-list">${t.pharmacopee.map(p => `<li><span class="tcm-formule">${escapeHtml(p.nom_pinyin || "")}</span>${p.nom_fr ? " — " + escapeHtml(p.nom_fr) : ""}</li>`).join("")}</ul>` : "";
    if (!acZangFu && !acClassique && !commun && !pharma) return "";
    return `<section class="psy-decision"><h3>Traitement${t.principe ? " — " + escapeHtml(t.principe) : ""}</h3>${acZangFu}${acClassique}${commun}${pharma}</section>`;
  },

  renderPointsSourced(list) {
    if (!list || !list.length) return "";
    return `<ul class="tcm-list">${list.map(p => {
      const label = [p.groupe, p.points].filter(Boolean).join(" — ");
      const src = p.source_precise ? `<span class="muted"> — source : ${escapeHtml(p.source_precise)}</span>` : "";
      return `<li><strong>${escapeHtml(label)}</strong> — ${tcmHighlightInline(escapeHtml(p.justification || ""))}${src}</li>`;
    }).join("")}</ul>`;
  },

  renderFormulesSourced(list) {
    if (!list || !list.length) return "";
    return `<ul class="tcm-list">${list.map(p => {
      const src = p.source_precise ? `<span class="muted"> — source : ${escapeHtml(p.source_precise)}</span>` : "";
      return `<li><span class="tcm-formule">${escapeHtml(p.nom_pinyin || "")}</span> — ${tcmHighlightInline(escapeHtml(p.justification || ""))}${src}</li>`;
    }).join("")}</ul>`;
  },

  renderTraitementSynthese(t) {
    if (!t) return "";
    const synthese = t.synthese_des_points && t.synthese_des_points.length
      ? `<h4 class="sec-sub">Synthèse des points</h4>${this.renderPointsSourced(t.synthese_des_points)}` : "";
    const baseJeu = t.base_jeu && t.base_jeu.length
      ? `<h4 class="sec-sub">Base Jeu (points des canaux)</h4>${this.renderPointsSourced(t.base_jeu)}` : "";
    const reseau = t.reseau_wang_ju_yi && t.reseau_wang_ju_yi.length
      ? `<h4 class="sec-sub">Réseau (Wang Ju Yi)</h4>${this.renderPointsSourced(t.reseau_wang_ju_yi)}` : "";
    const maciocia = t.maciocia && t.maciocia.length
      ? `<h4 class="sec-sub">Maciocia</h4>${this.renderPointsSourced(t.maciocia)}` : "";
    const pharma = t.pharmacopee_classique && t.pharmacopee_classique.length
      ? `<h4 class="sec-sub">Pharmacopée classique</h4>${this.renderFormulesSourced(t.pharmacopee_classique)}` : "";
    if (!synthese && !baseJeu && !reseau && !maciocia && !pharma) return "";
    const verif = (t.a_verifier && t.a_verifier.length)
      ? t.a_verifier.map(v => `<span class="tag-verifier">⚠ ${escapeHtml(v)}</span>`).join("") : "";
    return `<section class="psy-decision syn-synthese"><h3>Propositions de traitement (plusieurs sources, gardées séparées)${t.principe ? " — " + escapeHtml(t.principe) : ""}</h3>
      <p class="muted"><em>${escapeHtml(t.avertissement || "Chaque proposition est indépendante et indique précisément d'où elle vient — à valider avant usage clinique ou d'examen.")}</em></p>
      ${synthese}${baseJeu}${reseau}${maciocia}${pharma}${verif}</section>`;
  },

  /* ---- Canaux : fiche issue du carnet « Syndromes des canaux » (régulier, luo + shen, tendineux) ---- */
  signeGras(l) {
    const hl = t => tcmHighlightInline(escapeHtml(t));
    const texte = l.symptome || "";
    if (l.cle) return `<strong>${hl(texte)}</strong>`;
    let reste = texte, html = "";
    (l.gras || []).forEach(f => {
      const i = reste.indexOf(f);
      if (i < 0) return;
      html += hl(reste.slice(0, i)) + `<strong>${hl(f)}</strong>`;
      reste = reste.slice(i + f.length);
    });
    return html + hl(reste);
  },

  tableCanal(lignes) {
    if (!lignes || !lignes.length) return "";
    const corps = lignes.map(l => `<tr${l.generique ? ' class="syn-generique"' : ""}><td>${this.signeGras(l)}${l.generique ? ` <span class="tag-gen" title="Signe générique : il décrit le trajet du canal, pas un syndrome précis">trajet</span>` : ""}</td>` +
      `<td>${tcmHighlightInline(escapeHtml(l.mecanisme || ""))}</td></tr>`).join("");
    return `<table><thead><tr><th>Symptôme</th><th>Mécanisme pathologique</th></tr></thead><tbody>${corps}</tbody></table>`;
  },

  renderShen(s) {
    if (!s) return "";
    const patho = (s.pathologique || []).map(p => `<p>${tcmHighlightInline(escapeHtml(p))}</p>`).join("");
    const pv = (s.plenitude ? `<p><strong>Plénitude</strong> : ${tcmHighlightInline(escapeHtml(s.plenitude))}</p>` : "") +
      (s.vide ? `<p><strong>Vide</strong> : ${tcmHighlightInline(escapeHtml(s.vide))}</p>` : "");
    return `<table class="syn-shen"><thead><tr><th>Canal luo sain (shen)</th><th>Canal luo pathologique (shen)</th></tr></thead>` +
      `<tbody><tr><td>${tcmHighlightInline(escapeHtml(s.sain || ""))}</td><td>${patho}${pv}</td></tr></tbody></table>`;
  },

  renderTraitementCanal(sec) {
    const cases = ((sec.acupuncture_classique || {}).cases || []).flat().filter(Boolean);
    const toutes = (sec.pour_toutes_situations || []).filter(Boolean);
    if (!cases.length && !toutes.length) return "";
    return `<div class="syn-trait">${cases.length ? `<p><strong>Acupuncture classique</strong> : ${escapeHtml(cases.join(" · "))}</p>` : ""}` +
      `${toutes.length ? `<p><strong>Pour toutes les situations</strong> : ${escapeHtml(toutes.join(" · "))}</p>` : ""}</div>`;
  },

  // sections d'une fiche de canal (regulier, luo, grand_luo, tendineux) dont une ligne correspond à l'un des signes cochés
  sectionsPourSignes(d, cles) {
    return ["regulier", "luo", "grand_luo", "tendineux"].filter(k => ((d[k] || {}).lignes || []).some(l => {
      if (l.generique || !l.symptome) return false;
      const [txt] = dsSplitSigns(l.symptome);
      return txt && cles.has(dsNormalizeKey(txt));
    }));
  },

  renderCanal(d) {
    const noms = { regulier: "Canal régulier", luo: "Vaisseau liaison (luo)", grand_luo: "Grand vaisseau liaison (grand luo)", tendineux: "Canal tendineux" };
    const sections = ["regulier", "luo", "grand_luo", "tendineux"].filter(k => d[k] && (d[k].lignes || d[k].shen)).map(k => {
      const sec = d[k];
      const trajet = (sec.trajet && sec.trajet.length)
        ? `<details class="syn-trajet"><summary>${escapeHtml(sec.trajet_titre || "Trajet")}</summary><ul class="tcm-list">${sec.trajet.map(t => `<li>${tcmHighlightInline(escapeHtml(t))}</li>`).join("")}</ul></details>` : "";
      return `<section class="syn-canal-section" data-section="${k}"><h3>${noms[k]} <span class="muted">${escapeHtml((sec.titre || "").replace(/^[^(]*/, ""))}</span></h3>` +
        `${trajet}${this.tableCanal(sec.lignes)}${this.renderShen(sec.shen)}${this.renderTraitementCanal(sec)}</section>`;
    }).join("");
    const gen = (d.signes_de_trajet && d.signes_de_trajet.length)
      ? `<p class="muted">Signes génériques de trajet (non discriminants, exclus du diagnostic par signes) : ${d.signes_de_trajet.map(s => escapeHtml(s.symptome)).join(" ; ")}</p>` : "";
    return `<h2>${escapeHtml(d.nom_syndrome || d.id)}</h2>` +
      `<p class="muted">${escapeHtml(d.hanzi || "")} · ${escapeHtml(d.pinyin || "")}</p>${sections}${gen}`;
  },

  /* ---- Merveilleux vaisseaux : une rubrique du tableau validé (symptômes, mécanisme, références) ---- */
  renderMerveilleux(d) {
    const lignes = (d.tableau_clinique || []).map(l => `<tr><td>${tcmHighlightInline(escapeHtml(l.symptome || ""))}</td></tr>`).join("");
    const plan = d.plan ? ` <span class="tag-gen" title="Plan : classique (textes classiques), psycho-émotionnel (Farrell) ou mixte">${escapeHtml(d.plan)}</span>` : "";
    const leg = d.source && d.source.legende ? Object.entries(d.source.legende).map(([k, v]) => `<strong>${escapeHtml(k)}</strong> : ${escapeHtml(v)}`).join("<br>") : "";
    const verif = (d.a_verifier && d.a_verifier.length) ? `<section><h3>À vérifier contre la source</h3>${d.a_verifier.map(v => `<span class="tag-verifier">⚠ ${escapeHtml(v)}</span>`).join("")}</section>` : "";
    return `<h2>${escapeHtml(d.nom_syndrome || d.id)}</h2>` +
      `<p class="muted"><strong>${escapeHtml(d.vaisseau || "")}</strong>${d.titre_vaisseau ? " — " + escapeHtml(d.titre_vaisseau) : ""}${plan}</p>` +
      (d.image_fonction ? `<p class="muted">Image / fonction : ${escapeHtml(d.image_fonction)}</p>` : "") +
      `<section><h3>Symptômes</h3><table><thead><tr><th>Symptôme</th></tr></thead><tbody>${lignes}</tbody></table></section>` +
      (d.mecanisme_pathologique ? `<section><h3>Mécanisme pathologique</h3><div class="tcm-text">${formatTcmText(d.mecanisme_pathologique)}</div></section>` : "") +
      (d.references ? `<p class="muted">Références : ${escapeHtml(d.references)}</p>` : "") +
      verif +
      `<details class="syn-legende"><summary>Source et sigles des références</summary><p class="muted">${leg}</p></details>`;
  },

  renderSyndrome(d, domaine) {
    if (domaine === "merveilleux_vaisseaux") return this.renderMerveilleux(d);
    if (domaine === "canaux") {
      const v = (d.a_verifier && d.a_verifier.length) ? `<section><h3>À vérifier contre la source</h3>${d.a_verifier.map(x => `<span class="tag-verifier">⚠ ${escapeHtml(x)}</span>`).join("")}</section>` : "";
      return this.renderCanal(d) + v + `<p class="muted">Source : ${escapeHtml((d.source && d.source.fichier) || "?")}</p>`;
    }
    const verif = (d.a_verifier && d.a_verifier.length)
      ? `<section><h3>À vérifier contre la source</h3>${d.a_verifier.map(v => `<span class="tag-verifier">⚠ ${escapeHtml(v)}</span>`).join("")}</section>`
      : "";
    let subtitle = "";
    let clinicalTable = "";
    let mecanismeParagraphe = "";
    if (domaine === "organes") {
      subtitle = `${escapeHtml(d.organe || "")} · ${escapeHtml(d.categorie || "")}`;
      clinicalTable = this.renderClinicalTable(d.tableau_clinique);
    } else if (domaine === "qi_sang_liquides") {
      subtitle = `${escapeHtml(d.categorie_generale || "")} · ${escapeHtml(d.sous_categorie || "")}`;
      clinicalTable = this.renderClinicalTable(d.tableau_clinique);
    } else if (domaine === "externes") {
      subtitle = `${escapeHtml(d.systeme_diagnostique || "")} · ${escapeHtml(d.niveau_ou_couche || "")}${d.sous_categorie ? " · " + escapeHtml(d.sous_categorie) : ""}`;
      clinicalTable = this.renderList_(d.symptomes, "Symptômes");
      mecanismeParagraphe = d.mecanisme ? `<section><h3>Mécanisme</h3><div class="tcm-text">${formatTcmText(d.mecanisme)}</div></section>` : "";
    }
    return `
      <h2>${escapeHtml(d.nom_syndrome || d.id)}</h2>
      <p class="muted">${subtitle}${d.pinyin ? " · " + escapeHtml(d.pinyin) : ""}</p>
      ${clinicalTable}
      ${mecanismeParagraphe}
      ${this.renderList_(d.causes, "Causes")}
      ${this.renderList_(d.exemples_cliniques, "Exemples cliniques")}
      ${d.correspondances_organes ? `<section><h3>Correspondances des organes</h3><div class="tcm-text">${formatTcmText(d.correspondances_organes)}</div></section>` : ""}
      ${this.renderTraitement(d.traitement)}
      ${this.renderTraitementSynthese(d.propositions_traitement)}
      ${verif}
      <p class="muted">Source : ${escapeHtml((d.source && d.source.livre) || "?")}</p>
    `;
  }
};

document.getElementById("syn-search").addEventListener("input", (e) => Syndromes.renderList(Syndromes.search(e.target.value), e.target.value));
Syndromes.load().then(() => Syndromes.ensureDeepIndexed());

/* ============================= Diagnostic par signes (pourcentage) ============================= */
function dsSplitSigns(rawText) {
  // Tried splitting on commas/semicolons to get atomic signs, but French clinical prose
  // uses commas both to separate distinct signs AND to list adjectives modifying one
  // shared noun ("selles molles, pâteuses") — no reliable mechanical rule tells these
  // apart, and the false splits (orphan adjectives) weren't worth it. Each documented
  // "symptome" entry is now kept whole, exactly as written in the source.
  const s = rawText.trim().replace(/^[-•]\s*/, "").replace(/[.\s]+$/, "").replace(/\.{2,}$/, "");
  return s.length > 1 ? [s] : [];
}

function dsNormalizeKey(s) {
  // Grouping key only (never used for display) — lowercases and strips a simple
  // trailing French plural "s" so "Insomnie" and "Insomnies" merge into one clickable sign.
  let t = s.trim().toLowerCase();
  if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  return t;
}

// Keyword-based categorization (mechanical, transparent — not a clinical judgment call).
// A sign that matches no keyword stays honestly in "Autres signes" rather than being force-fit.
const DS_CATEGORIES = [
  ["Langue", /\blangue\b|enduit|lingual/i],
  ["Pouls", /\bpouls\b/i],
  ["Sommeil", /insomnie|sommeil|réveil|cauchemar|endormir|endormissement|somnolence/i],
  ["Respiration", /respirat|essoufl|dyspnée|\btoux\b|asthme|souffle court|oppression thoracique/i],
  ["Selles & urines", /\bselles\b|diarrhée|constipation|\burines?\b|miction|défécation|émission d'urine/i],
  ["Transpiration", /transpiration|sueur|sudation/i],
  ["Soif", /\bsoif\b|bouche sèche|gorge sèche/i],
  ["Digestion / appétit", /digestion|appétit|ballonnement|nausée|vomissement|indigestion|estomac|distension abdominale/i],
  ["Douleur", /douleur/i],
  ["Tête / vertiges", /vertige|céphalée|\btête\b|migraine/i],
  ["Teint / peau", /teint|\bpeau\b|éruption|dermatose|démangeaison/i],
  ["Émotionnel / Shén", /shén|esprit|anxiété|dépression|agitation|dysphorie|irritabilité|colère|peur|frayeur|manie|pleurs|crainte|confusion|conscience|connaissance|mémoire|mentale?\b|psychose|phobie|\brires?\b|délire/i],
  ["Gynéco / génital", /règles|menstru|gynéco|ménorragie|éjaculation|spermat|impuissance|libido|stérilité|testicule|génita|leucorrh|érection|priapisme|vagin|hernie|prostat|pubis|périnée|\boge\b/i],
  ["Fièvre / chaleur / froid", /fi[eè]vre|frilosit|frisson|refroidiss|\bfroids?\b|chaleur|chaud|brûlure|bouffée/i],
  ["Convulsions / raideurs", /convuls|spasme|crampe|contracture|tremblement|paralysie|raideur|opisthotonos|trismus|tressaut|\btics?\b|rigidité/i],
  ["Membres / dos", /\bmembres?\b|\bbras\b|\bmains?\b|\bpieds?\b|jambe|genou|cuisse|coude|épaule|orteil|doigt|articulation|tendon|courbature|engourdissement|\blombes?\b|lombaire|\bdos\b|colonne|nuque|hanche|fessier|sciatique/i],
  ["Bouche / gorge / nez", /bouche|gorge|gencive|\bdents?\b|dentaire|lèvres?|pharyn|larynx|aphonie|\bvoix\b|\bnez\b|nasale|rhinorrh|épistaxis|salive|goût|parler|parole|mucosit/i],
  ["Yeux / oreilles", /yeux|\bœil|\boeil|vision|paupière|sourcil|canthus|oreille|surdité|acouphène|audition|\bbruits?\b/i],
  ["Cœur / thorax", /palpitation|tachycardie|cœur|coeur|cardiaque|poitrine|thorax|thoracique|oppression|\bseins?\b|hypocondre|diaphragme|épigastr/i],
  ["Saignements", /hémorragie|saignement|hémoptysie|épistaxis|hématurie|ecchymose|macules/i],
  ["Œdèmes / mucosités", /[eé]d[eè]me|gonflement|tuméfaction|mucosit|expectoration|écoulement|rhinorrh|glaires|crachat/i],
  ["Fatigue / énergie", /fatigue|épuisement|faiblesse|manque de force|apathie|abattement|asthénie|amaigrissement|\bpoids\b/i],
];

function dsCategorize(sign) {
  for (const [label, re] of DS_CATEGORIES) {
    if (re.test(sign)) return label;
  }
  return "Autres signes";
}

// Toutes les catégories d'un signe : un signe mixte (« langue rouge, pouls rapide ») figure dans chacune de ses catégories.
function dsCategories(sign) {
  const r = DS_CATEGORIES.filter(([, re]) => re.test(sign)).map(c => c[0]);
  return r.length ? r : ["Autres signes"];
}

// Texte d'un signe pour une catégorie donnée : si le signe est mixte (plusieurs catégories),
// les morceaux (séparés par virgule, point-virgule, « / », tiret long) qui relèvent de la catégorie sont en gras.
// Seul un morceau de continuation (« et gras », « voire inexistant », « ou sec »), sans mot d'aucune catégorie, suit le morceau qui le précède ;
// les autres morceaux sans catégorie (« révulsion des yeux », « spasmes »…) restent en maigre.
// Normalisation caractère par caractère (même longueur que le texte) : minuscules, sans accents
function dsNorm(t) {
  return Array.from(String(t || ""), c => (c.normalize("NFD")[0] || c).toLowerCase()).join("");
}

// Texte échappé, avec le mot recherché surligné (<mark>), sans tenir compte des accents ni de la casse
function dsMarque(texte, q) {
  const nq = dsNorm((q || "").trim());
  if (!nq) return escapeHtml(texte);
  const chars = Array.from(texte), nt = Array.from(dsNorm(texte));
  if (chars.length !== nt.length) return escapeHtml(texte);
  const nts = nt.join("");
  let html = "", i = 0, j;
  while ((j = nts.indexOf(nq, i)) >= 0) {
    html += escapeHtml(chars.slice(i, j).join("")) + '<mark class="surlignage">' + escapeHtml(chars.slice(j, j + nq.length).join("")) + "</mark>";
    i = j + nq.length;
  }
  return html + escapeHtml(chars.slice(i).join(""));
}

function dsEnGras(sign, cat, q) {
  const def = DS_CATEGORIES.find(c => c[0] === cat);
  if (!def || DS_CATEGORIES.filter(([, re]) => re.test(sign)).length < 2) return dsMarque(sign, q);
  const parts = sign.split(/(\s*[,;]\s*|\.?\s+\/\s+|\s+—\s+|\.\s+)/);
  const ok = [];
  for (let i = 0; i < parts.length; i += 2) {
    const suite = !DS_CATEGORIES.some(([, re]) => re.test(parts[i])) && /^\s*(?:et|ou|voire|mais|même|puis|ainsi que|parfois)\b/i.test(parts[i]);
    ok[i] = def[1].test(parts[i]) || (suite && i > 0 && ok[i - 2] === true);
  }
  let html = "", i = 0;
  while (i < parts.length) {
    if (i % 2 === 0 && ok[i]) {
      let j = i;
      while (j + 2 < parts.length && ok[j + 2]) j += 2;
      html += "<strong>" + parts.slice(i, j + 1).map(p => dsMarque(p, q)).join("") + "</strong>";
      i = j + 1;
    } else { html += dsMarque(parts[i], q); i++; }
  }
  return html;
}

// Types de syndromes parmi lesquels chercher (filtre de « Diagnostic par signes »)
const DS_FILTRES = [
  ["tous", "Tous"], ["canaux", "Canaux"], ["organes", "Organes"],
  ["qi_sang_liquides", "Qi, sang, liquides"], ["externes", "Syndromes externes"],
  ["merveilleux_vaisseaux", "Merveilleux vaisseaux"],
];

const DiagSignes = {
  portee: new Set(),      // types de syndromes retenus (vide = tous)
  _clesFiltre: {},
  loaded: false,
  syndromesData: [], // [{entry, detail, signKeys: Set<normalizedKey>}]
  signIndex: new Map(), // normalizedKey -> display text (first-seen original wording)
  selected: new Set(), // normalized keys
  selectedCourts: new Set(),   // signes courts cochés (« Langue rouge », « Pouls rapide »…)
  exclus: new Set(),           // syndromes écartés des résultats (« domaine/id »)
  courtsData: null,            // syndromes/signes_courts/signes_courts.json
  courtsInfo: new Map(),       // id -> {id, label, categorie, sous}

  cleSynd(sd) { return `${sd.entry.domaine}/${sd.entry.chemin}`; },     // unique : plusieurs organes ont un syndrome de même id (vide_qi, vide_yin…)

  async ensureLoaded() {
    if (this.loaded) return;
    let tries = 0;
    while (Syndromes.entries.length === 0 && tries < 50) { await new Promise(r => setTimeout(r, 100)); tries++; }
    const details = await Promise.all(Syndromes.entries.map(async e => {
      try {
        const d = await Store.readJSON(`syndromes/${e.domaine}/${e.chemin}`);
        const rawList = d.tableau_clinique || d.symptomes || [];
        const rawTexts = rawList.map(s => (typeof s === "string" ? s : s.symptome)).filter(Boolean);
        const atomicSigns = rawTexts.flatMap(dsSplitSigns);
        const signKeys = new Set();
        const rows = [];       // lignes du tableau, une par signe documenté
        atomicSigns.forEach(sign => {
          const key = dsNormalizeKey(sign);
          if (!key) return;
          if (!signKeys.has(key)) rows.push({ key, text: sign });
          signKeys.add(key);
          if (!this.signIndex.has(key)) this.signIndex.set(key, sign);
        });
        return { entry: e, detail: d, signKeys, rows, courtsParCle: new Map() };
      } catch (err) { return null; }
    }));
    this.syndromesData = details.filter(x => x && x.signKeys.size);
    // signes courts : rattachement ligne -> signes courts (calculé par data/syndromes/signes_courts/generer.py)
    try {
      this.courtsData = await Store.readJSON("syndromes/signes_courts/signes_courts.json");
      this.courtsInfo = new Map(this.courtsData.signes.map(s => [s.id, s]));
      this.syndromesData.forEach(sd => {
        (this.courtsData.lignes[this.cleSynd(sd)] || []).forEach(l => {
          const [t] = dsSplitSigns(l.t);
          const k = t && dsNormalizeKey(t);
          if (!k) return;
          const s = sd.courtsParCle.get(k) || new Set();
          l.c.forEach(c => s.add(c));
          sd.courtsParCle.set(k, s);
        });
      });
    } catch (err) { this.courtsData = null; }
    this.loaded = true;
    document.getElementById("diag-signes-loading").style.display = "none";
    document.getElementById("diag-signes-body").style.display = "block";
    this.renderFiltre();
    this.renderSelected();
    this.renderAvailable("");
    this.renderResults();
  },

  // ---- portée de la recherche : un ou plusieurs types de syndromes (canaux, organes, qi-sang-liquides, externes, merveilleux vaisseaux)
  // portee vide = tous les types
  renderFiltre() {
    const el = document.getElementById("ds-filtre");
    if (!el) return;
    el.innerHTML = DS_FILTRES.map(([id, label]) => {
      const n = id === "tous" ? this.syndromesData.length : this.syndromesData.filter(sd => sd.entry.domaine === id).length;
      const dispo = true;
      const actif = id === "tous" ? !this.portee.size : this.portee.has(id);
      return `<button type="button" class="cat-chip${actif ? " active" : ""}" data-f="${id}" aria-pressed="${actif}"` +
        `${dispo ? "" : ` disabled title="Pas encore disponible"`}>${escapeHtml(label)}${dispo ? ` (${n})` : ""}</button>`;
    }).join("");
    el.querySelectorAll("[data-f]:not([disabled])").forEach(b => b.addEventListener("click", () => this.setFiltre(b.dataset.f)));
    const zones = document.getElementById("zc-bloc");       // les zones ne concernent que les canaux
    if (zones) zones.style.display = (!this.portee.size || this.portee.has("canaux")) ? "" : "none";
    const noms = DS_FILTRES.filter(([id]) => this.portee.has(id)).map(f => f[1].toLowerCase());
    const champ = document.getElementById("ds-search");
    if (champ) champ.placeholder = noms.length
      ? `Rechercher un signe parmi les syndromes : ${noms.join(", ")}`
      : "Rechercher un signe (ex : insomnie, langue rouge, pouls fin...)";
  },

  // « Tous » remet la portée à zéro ; un type la restreint (on peut en cocher plusieurs)
  setFiltre(id) {
    if (id === "tous") this.portee.clear();
    else if (this.portee.has(id)) this.portee.delete(id);
    else this.portee.add(id);
    if (this.portee.size >= DS_FILTRES.length - 1) this.portee.clear();       // tous les types disponibles cochés = tous
    this.renderFiltre();
    this.renderAvailable(document.getElementById("ds-search").value);
    this.renderResults();
  },

  // syndromes retenus par la portée
  syndromesFiltres() {
    return this.portee.size ? this.syndromesData.filter(sd => this.portee.has(sd.entry.domaine)) : this.syndromesData;
  },

  // signes appartenant à au moins un syndrome retenu (null = pas de restriction)
  clesFiltre() {
    if (!this.portee.size) return null;
    const cle = [...this.portee].sort().join("|");
    if (!this._clesFiltre[cle]) {
      const s = new Set();
      this.syndromesFiltres().forEach(sd => sd.signKeys.forEach(k => s.add(k)));
      this._clesFiltre[cle] = s;
    }
    return this._clesFiltre[cle];
  },

  toggle(key) {
    if (this.selected.has(key)) this.selected.delete(key);
    else this.selected.add(key);
    this.renderSelected();
    this.renderAvailable(document.getElementById("ds-search").value);
    this.renderResults();
    if (typeof ZonesCorps !== "undefined" && ZonesCorps.data) ZonesCorps.renderSousOptions();   // garde les cases des sous-options à jour
  },

  // signe court coché / décoché
  toggleCourt(id) {
    if (this.selectedCourts.has(id)) this.selectedCourts.delete(id);
    else this.selectedCourts.add(id);
    this.renderSelected();
    this.renderAvailable(document.getElementById("ds-search").value);
    this.renderResults();
  },

  // syndrome écarté / rétabli
  basculerExclu(cle) {
    if (this.exclus.has(cle)) this.exclus.delete(cle); else this.exclus.add(cle);
    this.renderResults();
  },

  aSelection() { return this.selected.size > 0 || this.selectedCourts.size > 0; },

  // lignes (clés) qui portent au moins un signe court : seules les AUTRES restent proposées en phrase entière
  clesCouvertes() {
    if (!this._couvertes) {
      this._couvertes = new Set();
      this.syndromesData.forEach(sd => sd.courtsParCle.forEach((ids, k) => { if (ids.size) this._couvertes.add(k); }));
    }
    return this._couvertes;
  },

  // lignes (clés) d'un syndrome touchées par la sélection : signe complet coché, ou ligne contenant un signe court coché
  clesActives(sd) {
    return new Set([...sd.signKeys].filter(k => this.selected.has(k) ||
      [...(sd.courtsParCle.get(k) || [])].some(c => this.selectedCourts.has(c))));
  },

  // syndromes correspondants, du plus au moins couvert (hors syndromes écartés)
  resultats() {
    return this.syndromesFiltres().filter(sd => !this.exclus.has(this.cleSynd(sd))).map(sd => {
      const m = this.clesActives(sd);
      return { sd, matchedKeys: [...m], pct: Math.round((m.size / sd.signKeys.size) * 100) };
    }).filter(x => x.matchedKeys.length > 0)
      .sort((a, b) => b.pct - a.pct || b.matchedKeys.length - a.matchedKeys.length);
  },

  renderSelected() {
    const el = document.getElementById("ds-selected");
    if (!this.aSelection()) { el.innerHTML = `<span class="muted">Aucun signe sélectionné pour l'instant.</span>`; return; }
    const courts = [...this.selectedCourts].map(id => {
      const s = this.courtsInfo.get(id);
      return `<span class="chosen-item chosen-court">${escapeHtml(s ? s.label : id)}
        <button type="button" data-court="${escapeHtml(id)}" aria-label="Retirer">✕</button>
      </span>`;
    });
    const phrases = [...this.selected].map(key => {
      const label = this.signIndex.get(key) || key;
      return `<span class="chosen-item">${escapeHtml(label)}
        <button type="button" data-k="${escapeHtml(key)}" aria-label="Retirer">✕</button>
      </span>`;
    });
    el.innerHTML = courts.concat(phrases).join("");
    el.querySelectorAll("button[data-k]").forEach(btn => btn.addEventListener("click", () => this.toggle(btn.dataset.k)));
    el.querySelectorAll("button[data-court]").forEach(btn => btn.addEventListener("click", () => this.toggleCourt(btn.dataset.court)));
  },

  // signes courts proposés, rangés par catégorie puis sous-catégorie (seuls ceux présents dans les syndromes retenus)
  renderCourts(query) {
    const el = document.getElementById("ds-courts");
    if (!el) return;
    if (!this.courtsData) { el.innerHTML = `<p class="muted">Signes courts indisponibles pour l'instant.</p>`; return; }
    const q = (query || "").trim();
    const nq = dsNorm(q);
    const nb = new Map();
    this.syndromesFiltres().forEach(sd => {
      const vus = new Set();
      sd.courtsParCle.forEach(s => s.forEach(c => vus.add(c)));
      vus.forEach(c => nb.set(c, (nb.get(c) || 0) + 1));
    });
    const cats = new Map();
    this.courtsData.signes.forEach(s => {
      if (!nb.get(s.id) || this.selectedCourts.has(s.id)) return;
      if (nq && !dsNorm(s.label).includes(nq)) return;
      if (!cats.has(s.categorie)) cats.set(s.categorie, new Map());
      const sous = cats.get(s.categorie);
      if (!sous.has(s.sous)) sous.set(s.sous, []);
      sous.get(s.sous).push(s);
    });
    if (!cats.size) { el.innerHTML = `<p class="muted">Aucun signe court ne correspond.</p>`; return; }
    el.innerHTML = [...cats.entries()].map(([cat, sous]) => {
      const total = [...sous.values()].reduce((a, l) => a + l.length, 0);
      return `<div class="ds-cat-block"><h4 class="sec-sub">${escapeHtml(cat)} (${total})</h4>` +
        [...sous.entries()].map(([nom, liste]) => `<div class="ds-sous"><span class="ds-sous-nom">${escapeHtml(nom)}</span><span class="ds-cat-chips">` +
          liste.map(s => `<button type="button" class="ds-chip ds-court" data-court="${escapeHtml(s.id)}" title="Présent dans ${nb.get(s.id)} syndrome(s)">${dsMarque(s.label, q)} <span class="tag-gen">${nb.get(s.id)}</span></button>`).join("") +
          `</span></div>`).join("") + `</div>`;
    }).join("");
    el.querySelectorAll("[data-court]").forEach(b => b.addEventListener("click", () => this.toggleCourt(b.dataset.court)));
  },

  renderAvailable(query) {
    this.renderCourts(query);
    const el = document.getElementById("ds-available");
    const q = (query || "").trim().toLowerCase();
    const permis = this.clesFiltre();
    const couvertes = this.clesCouvertes();       // lignes déjà décomposées en signes courts : on ne les propose plus en phrase entière
    let pool = [...this.signIndex.entries()].filter(([key]) => !this.selected.has(key) && !couvertes.has(key) && (!permis || permis.has(key)));
    if (q) pool = pool.filter(([, label]) => dsNorm(label).includes(dsNorm(q)));
    const titre = document.getElementById("ds-phrases-titre");
    if (titre) titre.textContent = `Autres lignes des tableaux, phrases complètes (${pool.length})`;
    const det = document.getElementById("ds-phrases");
    if (det && q) det.open = true;                // une recherche en cours ouvre la section
    if (!pool.length) { el.innerHTML = `<span class="muted">Aucune autre ligne ne correspond.</span>`; return; }

    const byCategory = new Map();
    pool.forEach(([key, label]) => {
      dsCategories(label).forEach(cat => {
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push([key, label]);
      });
    });
    const orderedCats = [...DS_CATEGORIES.map(c => c[0]), "Autres signes"].filter(c => byCategory.has(c));

    const CAP_PER_CATEGORY = q ? 999 : 40;
    let html = "";
    orderedCats.forEach(cat => {
      const items = byCategory.get(cat).sort((a, b) => a[1].localeCompare(b[1], "fr"));
      const shown = items.slice(0, CAP_PER_CATEGORY);
      html += `<div class="ds-cat-block"><h4 class="sec-sub">${escapeHtml(cat)} (${items.length})</h4><div class="ds-cat-chips">`;
      html += shown.map(([key, label]) => `<button type="button" class="ds-chip" data-k="${escapeHtml(key)}">${dsEnGras(label, cat, q)}</button>`).join("");
      if (items.length > CAP_PER_CATEGORY) html += `<p class="muted" style="width:100%;">${items.length - CAP_PER_CATEGORY} de plus — cherche pour affiner.</p>`;
      html += `</div></div>`;
    });
    el.innerHTML = html;
    el.querySelectorAll(".ds-chip").forEach(btn => {
      btn.addEventListener("click", () => this.toggle(btn.dataset.k));
    });
  },

  renderResults() {
    const el = document.getElementById("ds-results");
    this.renderExclus();
    if (typeof GrapheSignes !== "undefined") GrapheSignes.maj();
    if (!this.aSelection()) { el.innerHTML = `<p class="muted">Sélectionne au moins un signe pour voir les syndromes correspondants.</p>`; return; }
    const scored = this.resultats();
    if (!scored.length) { el.innerHTML = `<p class="muted">Aucun syndrome ${this.portee.size ? "de ce type" : "de la base"} ne recoupe les signes sélectionnés.</p>`; return; }
    el.innerHTML = scored.slice(0, 40).map(({ sd, matchedKeys, pct }) => `
      <div class="ds-result" data-cle="${escapeHtml(this.cleSynd(sd))}">
        <div class="ds-result-top">
          <span class="ds-result-name">${escapeHtml(sd.entry.nom)}</span>
          <span class="ds-result-pct">${pct}%</span>
          <button type="button" class="ds-exclure" data-exclure="${escapeHtml(this.cleSynd(sd))}" title="Écarter ce syndrome des résultats" aria-label="Écarter ce syndrome">✕</button>
        </div>
        <p class="muted">${escapeHtml(Syndromes.domaineLabels[sd.entry.domaine] || "")}${sd.entry.sousLabel ? " · " + escapeHtml(sd.entry.sousLabel) : ""}</p>
        ${sd.entry.domaine === "canaux" && ZonesCorps.couvertes(sd.entry.id).length ? `<p class="ds-result-matched">Trajet : ${escapeHtml(ZonesCorps.couvertes(sd.entry.id).join(", "))}</p>` : ""}
        <div class="ds-result-bar-wrap"><div class="ds-result-bar" style="width:${pct}%;"></div></div>
        <p class="ds-result-matched">${matchedKeys.length} / ${sd.signKeys.size} signe(s) documenté(s) correspondent</p>
      </div>
    `).join("");
    el.querySelectorAll(".ds-exclure").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); this.basculerExclu(b.dataset.exclure); }));
    el.querySelectorAll(".ds-result").forEach(div => {
      div.addEventListener("click", () => {
        const sd = this.syndromesData.find(x => this.cleSynd(x) === div.dataset.cle);
        if (sd) this.ouvrirFiche(sd.entry);
      });
    });
  },

  // fiche flottante (plusieurs possibles, pour comparer) ; pour un canal, elle s'ouvre sur la section (luo, tendineux…) qui contient le signe
  ouvrirFiche(entry) {
    const sd = this.syndromesData.find(x => x.entry === entry);
    const sections = entry.domaine === "canaux" && sd ? Syndromes.sectionsPourSignes(sd.detail, this.clesActives(sd)) : [];
    PostIt.open(entry, { sections });
  },

  // syndromes écartés : pastilles pour les rétablir
  renderExclus() {
    const el = document.getElementById("ds-exclus");
    if (!el) return;
    if (!this.exclus.size) { el.innerHTML = ""; return; }
    const nom = cle => { const sd = this.syndromesData.find(x => this.cleSynd(x) === cle); return sd ? sd.entry.nom : cle; };
    el.innerHTML = `<span class="muted">Écartés :</span> ` + [...this.exclus].map(cle =>
      `<button type="button" class="ds-chip ds-exclu" data-r="${escapeHtml(cle)}" title="Rétablir ce syndrome">↺ ${escapeHtml(nom(cle))}</button>`).join("") +
      ` <button type="button" class="edit-toggle-btn" id="ds-exclus-tous">Tout rétablir</button>`;
    el.querySelectorAll("[data-r]").forEach(b => b.addEventListener("click", () => this.basculerExclu(b.dataset.r)));
    document.getElementById("ds-exclus-tous").addEventListener("click", () => { this.exclus.clear(); this.renderResults(); });
  }
};

/* ===== Vue graphe (zoomable à la molette ou au doigt) : signes cochés -> syndromes qui les contiennent -> autres lignes du même tableau =====
   Les lignes partagées par plusieurs syndromes sont un seul point relié à chacun d'eux : on voit tout de suite ce qui est commun. */
const DOM_COUL = { organes: "#378ADD", externes: "#BA7517", canaux: "#1D9E75", qi_sang_liquides: "#7F77DD", merveilleux_vaisseaux: "#D4537E" };
const dsCut = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

const GrapheSignes = {
  actif: false,
  max: 12,                       // nombre de syndromes affichés (bouton « Plus de syndromes »)
  vue: { x: 0, y: 0, k: 1 },
  noeuds: [], liens: [],
  largeur: 800, hauteur: 560,

  init() {
    this.zone = document.getElementById("ds-graphe");
    if (!this.zone) return;
    this.zone.innerHTML = `
      <div class="g-barre">
        <button type="button" class="edit-toggle-btn" id="g-plus" aria-label="Zoom avant" title="Zoom avant">+</button>
        <button type="button" class="edit-toggle-btn" id="g-moins" aria-label="Zoom arrière" title="Zoom arrière">−</button>
        <button type="button" class="edit-toggle-btn" id="g-ajuster" title="Tout voir">Tout voir</button>
        <button type="button" class="edit-toggle-btn" id="g-plus-synd">Plus de syndromes</button>
        <span id="g-etat" class="muted"></span>
        <span class="g-aide-zone"><span class="muted g-astuce">Molette ou deux doigts pour zoomer ; glisse le fond pour déplacer la vue, ou glisse un point, un syndrome ou un signe pour le déplacer et mieux lire les textes.</span></span>
      </div>
      <p class="muted" data-aide>Au centre, les signes que tu as cochés (pastilles pleines). Autour, les syndromes qui les contiennent (rectangles : la couleur du cadre indique le type, ✕ pour écarter un syndrome, clic pour ouvrir sa fiche en post-it). Les petits points sont les autres lignes du même tableau : un point plein de ta couleur est une ligne qui correspond à ta sélection, un gros point relié à plusieurs syndromes est une ligne qu'ils ont en commun. Zoome pour lire le texte des lignes ; survole ou touche un point pour le lire en entier.</p>
      <div id="g-cadre"><svg id="g-svg" width="100%" role="img" aria-label="Graphe des signes et des syndromes"><g id="g-vp"></g></svg></div>
      <div id="g-info" class="muted" aria-live="polite">Survole ou touche un point pour lire la ligne du tableau.</div>
      <div class="g-legende muted">
        <span><i class="g-pt g-pt-sel"></i> ligne qui correspond à ta sélection</span>
        <span><i class="g-pt"></i> autre ligne du tableau</span>
        <span><i class="g-pt g-pt-com"></i> ligne commune à plusieurs syndromes</span>
        ${Object.entries(DOM_COUL).map(([d, c]) => `<span><i class="g-carre" style="border-color:${c}"></i> ${escapeHtml(Syndromes.domaineLabels[d] || d)}</span>`).join("")}
      </div>`;
    this.svg = document.getElementById("g-svg");
    this.vp = document.getElementById("g-vp");
    this.info = document.getElementById("g-info");
    document.getElementById("ds-vue-liste").addEventListener("click", () => this.afficher(false));
    document.getElementById("ds-vue-graphe").addEventListener("click", () => this.afficher(true));
    document.getElementById("g-plus").addEventListener("click", () => this.zoomer(this.largeur / 2, this.hauteur / 2, 1.35));
    document.getElementById("g-moins").addEventListener("click", () => this.zoomer(this.largeur / 2, this.hauteur / 2, 1 / 1.35));
    document.getElementById("g-ajuster").addEventListener("click", () => { this.ajuster(); this.appliquer(); });
    document.getElementById("g-plus-synd").addEventListener("click", () => { this.max += 8; this.maj(true); });
    this.gestes();
    window.addEventListener("resize", () => { if (this.actif) this.maj(true); });
  },

  afficher(on) {
    this.actif = on;
    document.getElementById("ds-vue-liste").classList.toggle("active", !on);
    document.getElementById("ds-vue-graphe").classList.toggle("active", on);
    document.getElementById("ds-results").style.display = on ? "none" : "";
    this.zone.style.display = on ? "" : "none";
    if (on) this.maj(true);
  },

  // appelé à chaque changement de sélection / de filtre / d'exclusion
  maj(refit) {
    if (!this.actif || !this.zone) return;
    this.mesurer();
    this.construire();
    this.placer();
    if (refit !== false) this.ajuster();
    this.dessiner();
  },

  mesurer() {
    const cadre = document.getElementById("g-cadre");
    this.largeur = Math.max(280, cadre.clientWidth || 800);
    this.hauteur = Math.round(Math.min(780, Math.max(420, window.innerHeight * 0.76)));
    this.svg.setAttribute("viewBox", `0 0 ${this.largeur} ${this.hauteur}`);
    this.svg.setAttribute("height", this.hauteur);
  },

  construire() {
    const D = DiagSignes;
    const tous = D.resultats();
    const res = tous.slice(0, this.max);
    this.total = tous.length;
    const N = [], L = [], idx = new Map();
    const ajouter = n => { idx.set(n.id, N.length); N.push(n); return n; };
    D.selectedCourts.forEach(id => { const s = D.courtsInfo.get(id); ajouter({ id: "c:" + id, type: "in", label: s ? s.label : id, court: id }); });
    D.selected.forEach(k => { const t = D.signIndex.get(k) || k; ajouter({ id: "p:" + k, type: "in", label: dsCut(t, 34), plein: t, phrase: k }); });
    res.forEach(({ sd, matchedKeys, pct }) => ajouter({ id: "s:" + D.cleSynd(sd), type: "syn", sd, pct, label: sd.entry.nom, matched: new Set(matchedKeys) }));
    // lignes du tableau : un point par ligne (commun aux syndromes qui la contiennent)
    res.forEach(({ sd, matchedKeys }) => {
      const sn = N[idx.get("s:" + D.cleSynd(sd))], m = new Set(matchedKeys);
      sd.rows.forEach(r => {
        let n = N[idx.get("r:" + r.key)];
        if (!n) n = ajouter({ id: "r:" + r.key, type: "row", text: r.text, courts: new Set(), syns: [], sel: false });
        (sd.courtsParCle.get(r.key) || []).forEach(c => n.courts.add(c));
        n.syns.push(sd.entry.nom);
        if (m.has(r.key)) n.sel = true;
        L.push({ a: n, b: sn, type: "row", sel: m.has(r.key) });
      });
    });
    // signes cochés -> syndromes
    N.filter(n => n.type === "in").forEach(inn => {
      N.filter(n => n.type === "syn").forEach(sn => {
        let c = 0;
        sn.sd.rows.forEach(r => {
          if (inn.court ? (sn.sd.courtsParCle.get(r.key) || new Set()).has(inn.court) : r.key === inn.phrase) c++;
        });
        if (c) L.push({ a: inn, b: sn, type: "in", n: c });
      });
    });
    N.forEach(n => {
      if (n.type === "row") {
        const noms = [...n.courts].map(c => (D.courtsInfo.get(c) || {}).label || c);
        n.lab = noms.length ? noms.slice(0, 3).join(" · ") + (noms.length > 3 ? " …" : "") : dsCut(n.text, 46);
      } else if (n.type === "syn") {
        n.nom = dsCut(n.label, 30); n.w = Math.max(110, n.nom.length * 7.4 + 60); n.h = 30;
      } else { n.w = Math.max(76, n.label.length * 7.2 + 32); n.h = 32; }
    });
    this.noeuds = N; this.liens = L;
  },

  // disposition par forces (déterministe : même sélection = même dessin)
  placer() {
    const N = this.noeuds, n = N.length;
    let rs = 11;
    const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
    const ins = N.filter(x => x.type === "in"), syn = N.filter(x => x.type === "syn");
    ins.forEach((x, i) => { x.x = -260; x.y = (i - (ins.length - 1) / 2) * 52; });
    syn.forEach((x, i) => { const a = (i / Math.max(1, syn.length)) * 2 * Math.PI; x.x = Math.cos(a) * 330; x.y = Math.sin(a) * 270; });
    N.filter(x => x.type === "row").forEach(x => { x.x = (rnd() - 0.5) * 500; x.y = (rnd() - 0.5) * 420; });
    N.forEach(x => { x.vx = 0; x.vy = 0; x.r = x.type === "syn" ? 46 : x.type === "in" ? 40 : (x.syns && x.syns.length > 1 ? 7 : 5); });
    const iters = n > 220 ? 220 : 320;
    for (let it = 0; it < iters; it++) {
      const refroidir = 1 - it / iters;
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          const A = N[a], B = N[b];
          let dx = A.x - B.x, dy = A.y - B.y, d2 = dx * dx + dy * dy + 0.5;
          const grand = A.type !== "row" && B.type !== "row";
          const k = (grand ? 16000 : (A.type !== "row" || B.type !== "row") ? 3200 : 760) / d2;
          const d = Math.sqrt(d2);
          dx = (dx / d) * k; dy = (dy / d) * k;
          A.vx += dx; A.vy += dy; B.vx -= dx; B.vy -= dy;
        }
      }
      this.liens.forEach(l => {
        const A = l.a, B = l.b;
        let dx = B.x - A.x, dy = B.y - A.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.1;
        const repos = l.type === "in" ? 270 : l.sel ? 56 : 76;
        const force = (d - repos) * (l.type === "in" ? 0.01 : 0.03);
        dx = (dx / d) * force; dy = (dy / d) * force;
        A.vx += dx; A.vy += dy; B.vx -= dx; B.vy -= dy;
      });
      N.forEach(x => {
        x.vx -= x.x * 0.004; x.vy -= x.y * 0.004;
        const v = Math.sqrt(x.vx * x.vx + x.vy * x.vy), lim = 12 * refroidir + 1;
        if (v > lim) { x.vx = (x.vx / v) * lim; x.vy = (x.vy / v) * lim; }
        x.x += x.vx; x.y += x.vy; x.vx *= 0.6; x.vy *= 0.6;
      });
    }
    this.separer();
  },

  // les rectangles (syndromes, signes cochés) ne doivent jamais se chevaucher ; les points sortent des rectangles
  separer() {
    const R = this.noeuds.filter(n => n.type !== "row"), P = this.noeuds.filter(n => n.type === "row");
    for (let it = 0; it < 220; it++) {
      let bouge = false;
      for (let a = 0; a < R.length; a++) {
        for (let b = a + 1; b < R.length; b++) {
          const A = R[a], B = R[b];
          const ox = (A.w + B.w) / 2 + 10 - Math.abs(A.x - B.x), oy = (A.h + B.h) / 2 + 8 - Math.abs(A.y - B.y);
          if (ox > 0 && oy > 0) {
            bouge = true;
            if (oy < ox) { const s = A.y <= B.y ? -1 : 1; A.y += s * oy / 2; B.y -= s * oy / 2; }
            else { const s = A.x <= B.x ? -1 : 1; A.x += s * ox / 2; B.x -= s * ox / 2; }
          }
        }
      }
      P.forEach(p => R.forEach(A => {
        const dx = p.x - A.x, dy = p.y - A.y, hx = A.w / 2 + 8, hy = A.h / 2 + 8;
        if (Math.abs(dx) < hx && Math.abs(dy) < hy) {
          bouge = true;
          if (hx - Math.abs(dx) < hy - Math.abs(dy)) p.x = A.x + (dx >= 0 ? hx : -hx); else p.y = A.y + (dy >= 0 ? hy : -hy);
        }
      }));
      if (!bouge) break;
    }
  },

  ajuster() {
    const N = this.noeuds;
    if (!N.length) { this.vue = { x: this.largeur / 2, y: this.hauteur / 2, k: 1 }; return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    N.forEach(n => {
      const w = n.type === "row" ? 8 : n.w / 2;
      x0 = Math.min(x0, n.x - w); x1 = Math.max(x1, n.x + w); y0 = Math.min(y0, n.y - 20); y1 = Math.max(y1, n.y + 20);
    });
    const k = Math.min(2.2, Math.max(0.3, Math.min((this.largeur - 20) / (x1 - x0), (this.hauteur - 20) / (y1 - y0))));
    this.vue = { k, x: this.largeur / 2 - ((x0 + x1) / 2) * k, y: this.hauteur / 2 - ((y0 + y1) / 2) * k };
    this.appliquer();
  },

  appliquer() {
    const v = this.vue;
    this.vp.setAttribute("transform", `translate(${v.x.toFixed(1)},${v.y.toFixed(1)}) scale(${v.k.toFixed(3)})`);
    this.svg.classList.toggle("z2", v.k >= 1.0);
    this.svg.classList.toggle("z3", v.k >= 2.2);
    if (!this.attente) this.attente = requestAnimationFrame(() => { this.attente = 0; this.declutter(); });
  },

  zoomer(cx, cy, f) {
    const v = this.vue, k2 = Math.min(8, Math.max(0.2, v.k * f));
    v.x = cx - (cx - v.x) * (k2 / v.k);
    v.y = cy - (cy - v.y) * (k2 / v.k);
    v.k = k2;
    this.appliquer();
  },

  // molette, glisser (déplacer), pincement à deux doigts
  gestes() {
    const svg = this.svg, ptrs = new Map();
    let dernier = null, dist0 = 0, deplace = false;
    const pos = e => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) * (this.largeur / r.width), (e.clientY - r.top) * (this.hauteur / r.height)]; };
    svg.addEventListener("wheel", e => {
      e.preventDefault();
      const [x, y] = pos(e);
      this.zoomer(x, y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)));
    }, { passive: false });
    let glisse = null;        // nœud en cours de déplacement
    svg.addEventListener("pointerdown", e => {
      ptrs.set(e.pointerId, pos(e));
      deplace = false;
      glisse = null;
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; dist0 = Math.hypot(a[0] - b[0], a[1] - b[1]); }
      else {
        const g = e.target.closest("[data-nid]");
        if (g && !e.target.closest("[data-x]")) glisse = { n: this.noeuds.find(x => x.id === g.dataset.nid), debut: pos(e), capture: false };
      }
      dernier = pos(e);
    });
    svg.addEventListener("pointermove", e => {
      if (!ptrs.has(e.pointerId)) return;
      const p = pos(e);
      ptrs.set(e.pointerId, p);
      if (ptrs.size === 2) {
        glisse = null;
        const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (dist0 > 0) this.zoomer((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / dist0);
        dist0 = d; deplace = true;
      } else if (ptrs.size === 1 && glisse && glisse.n) {
        // déplacer un nœud (pour mieux lire les textes) : il suit le doigt / la souris, ses traits aussi
        if (!deplace && Math.hypot(p[0] - glisse.debut[0], p[1] - glisse.debut[1]) <= 4) return;
        if (!glisse.capture) { glisse.capture = true; try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ } }
        deplace = true;
        glisse.n.x += (p[0] - dernier[0]) / this.vue.k;
        glisse.n.y += (p[1] - dernier[1]) / this.vue.k;
        dernier = p;
        this.majPos(glisse.n);
        if (this.etiq) this.appliquer();
      } else if (ptrs.size === 1 && dernier) {
        const dx = p[0] - dernier[0], dy = p[1] - dernier[1];
        if (deplace || Math.hypot(dx, dy) > 4) {
          if (!deplace) { try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ } }
          this.vue.x += dx; this.vue.y += dy; deplace = true; this.appliquer(); dernier = p;
        }
      }
    });
    const fin = e => { glisse = null; ptrs.delete(e.pointerId); dernier = ptrs.size === 1 ? [...ptrs.values()][0] : null; dist0 = 0; setTimeout(() => { deplace = false; }, 0); };
    svg.addEventListener("pointerup", fin);
    svg.addEventListener("pointercancel", fin);
    // clics : ignorés si on vient de déplacer le fond
    svg.addEventListener("click", e => {
      if (deplace) return;
      const x = e.target.closest("[data-x]");
      if (x) { DiagSignes.basculerExclu(x.dataset.x); return; }
      const s = e.target.closest("[data-syn]");
      if (s) {
        const entry = Syndromes.entries.find(en => DiagSignes.cleSynd({ entry: en }) === s.dataset.syn);
        if (entry) DiagSignes.ouvrirFiche(entry);
        return;
      }
      const i = e.target.closest("[data-in]");
      if (i) { const v = i.dataset.in; if (v.startsWith("c:")) DiagSignes.toggleCourt(v.slice(2)); else DiagSignes.toggle(v.slice(2)); return; }
      const r = e.target.closest("[data-r]");
      if (r) this.montrerLigne(r.dataset.r);
    });
    svg.addEventListener("pointerover", e => {
      const r = e.target.closest("[data-r]");
      if (r) { this.montrerLigne(r.dataset.r); return; }
      const s = e.target.closest("[data-syn]");
      if (s) this.montrerSyndrome(s.dataset.syn);
    });
  },

  // met à jour à l'écran la position d'un nœud et des traits qui y sont reliés
  majPos(n) {
    const g = this.elN && this.elN.get(n.id);
    if (!g) return;
    if (n.type === "row") {
      const c = g.querySelector("circle"), t = g.querySelector("text");
      c.setAttribute("cx", n.x.toFixed(1)); c.setAttribute("cy", n.y.toFixed(1));
      t.setAttribute("x", (n.x + n.r + 3).toFixed(1)); t.setAttribute("y", (n.y + 3).toFixed(1));
    } else g.setAttribute("transform", `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    (n.liensIdx || []).forEach(i => {
      const l = this.liens[i], e = this.elL[i];
      if (!e) return;
      e.setAttribute("x1", l.a.x.toFixed(1)); e.setAttribute("y1", l.a.y.toFixed(1));
      e.setAttribute("x2", l.b.x.toFixed(1)); e.setAttribute("y2", l.b.y.toFixed(1));
    });
  },

  montrerSyndrome(cle) {
    const n = this.noeuds.find(x => x.type === "syn" && DiagSignes.cleSynd(x.sd) === cle);
    if (!n) return;
    this.info.innerHTML = `<strong>${escapeHtml(n.label)}</strong> — ${escapeHtml(Syndromes.domaineLabels[n.sd.entry.domaine] || "")}` +
      `<br>${n.matched.size} ligne(s) sur ${n.sd.signKeys.size} correspondent à ta sélection (${n.pct}%). Clic : ouvrir la fiche ; ✕ : écarter.`;
  },

  montrerLigne(id) {
    const n = this.noeuds.find(x => x.id === id);
    if (!n) return;
    const courts = [...n.courts].map(c => (DiagSignes.courtsInfo.get(c) || {}).label || c);
    this.info.innerHTML = `<strong>${escapeHtml(n.text)}</strong>` +
      (courts.length ? `<br>Signes courts : ${escapeHtml(courts.join(" · "))}` : "") +
      `<br>Dans : ${escapeHtml([...new Set(n.syns)].join(" ; "))}${n.sel ? " — <em>correspond à ta sélection</em>" : ""}`;
  },

  dessiner() {
    const D = DiagSignes;
    const etat = document.getElementById("g-etat");
    if (!D.aSelection()) {
      this.vp.innerHTML = `<text x="${this.largeur / 2}" y="${this.hauteur / 2}" text-anchor="middle" class="g-vide">Coche au moins un signe (court ou complet) pour voir le graphe.</text>`;
      this.vp.removeAttribute("transform");
      etat.textContent = "";
      return;
    }
    const nbSyn = this.noeuds.filter(n => n.type === "syn").length;
    etat.textContent = `${nbSyn} syndrome(s) affiché(s) sur ${this.total}`;
    document.getElementById("g-plus-synd").style.display = this.total > nbSyn ? "" : "none";
    if (!this.total) { this.vp.innerHTML = `<text x="0" y="0" text-anchor="middle" class="g-vide">Aucun syndrome ne correspond à cette sélection.</text>`; return; }
    let h = "";
    this.liens.forEach((l, i) => {
      if (l.type === "in") h += `<line data-l="${i}" class="g-lien-in" x1="${l.a.x.toFixed(1)}" y1="${l.a.y.toFixed(1)}" x2="${l.b.x.toFixed(1)}" y2="${l.b.y.toFixed(1)}" stroke-width="${Math.min(6, 1 + l.n * 0.8).toFixed(1)}"/>`;
      else h += `<line data-l="${i}" class="g-lien${l.sel ? " g-lien-sel" : ""}" x1="${l.a.x.toFixed(1)}" y1="${l.a.y.toFixed(1)}" x2="${l.b.x.toFixed(1)}" y2="${l.b.y.toFixed(1)}"/>`;
    });
    this.noeuds.filter(n => n.type === "row").forEach(n => {
      const commun = n.syns.length > 1;
      h += `<g data-r="${escapeHtml(n.id)}" data-nid="${escapeHtml(n.id)}" class="g-ligne"><circle class="g-pt-c${n.sel ? " sel" : ""}${commun ? " com" : ""}" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r}"/>` +
        `<text class="g-lab-r" x="${(n.x + n.r + 3).toFixed(1)}" y="${(n.y + 3).toFixed(1)}">${escapeHtml(n.lab)}</text></g>`;
    });
    this.noeuds.filter(n => n.type === "syn").forEach(n => {
      const nom = n.nom, w = n.w;
      const coul = DOM_COUL[n.sd.entry.domaine] || "#888";
      h += `<g class="g-syn" data-nid="${escapeHtml(n.id)}" data-syn="${escapeHtml(D.cleSynd(n.sd))}" transform="translate(${n.x.toFixed(1)},${n.y.toFixed(1)})">` +
        `<rect x="${-w / 2}" y="-13" width="${w}" height="26" rx="5" style="stroke:${coul}"/>` +
        `<text class="g-syn-nom" x="${-w / 2 + 8}" y="4">${escapeHtml(nom)}</text>` +
        `<text class="g-syn-pct" x="${w / 2 - 24}" y="4" text-anchor="end">${n.pct}%</text>` +
        `<g class="g-x" data-x="${escapeHtml(D.cleSynd(n.sd))}"><title>Écarter ce syndrome</title><circle cx="${w / 2 - 11}" cy="0" r="8"/><text x="${w / 2 - 11}" y="3.5" text-anchor="middle">✕</text></g>` +
        `<title>${escapeHtml(n.label)} — ${n.pct}% (${n.matched.size} ligne(s) sur ${n.sd.signKeys.size})</title></g>`;
    });
    this.noeuds.filter(n => n.type === "in").forEach(n => {
      const nom = n.label, w = n.w;
      h += `<g class="g-in${n.court ? " court" : ""}" data-nid="${escapeHtml(n.id)}" data-in="${escapeHtml(n.id)}" transform="translate(${n.x.toFixed(1)},${n.y.toFixed(1)})"><rect x="${-w / 2}" y="-14" width="${w}" height="28" rx="14"/>` +
        `<text x="0" y="4" text-anchor="middle">${escapeHtml(nom)}</text><title>${escapeHtml(n.plein || n.label)} — clic pour retirer de la sélection</title></g>`;
    });
    this.vp.innerHTML = h;
    this.elN = new Map([...this.vp.querySelectorAll("[data-nid]")].map(e => [e.dataset.nid, e]));
    this.elL = [...this.vp.querySelectorAll("line[data-l]")];
    this.noeuds.forEach(n => { n.liensIdx = []; });
    this.liens.forEach((l, i) => { l.a.liensIdx.push(i); l.b.liensIdx.push(i); });
    // étiquettes des lignes : on retient les éléments pour pouvoir masquer celles qui se chevauchent
    this.etiq = [...this.vp.querySelectorAll(".g-ligne")].map(g => {
      const n = this.noeuds.find(x => x.id === g.dataset.r);
      return { n, el: g.querySelector(".g-lab-r"), prio: (n.sel ? 100 : 0) + n.syns.length * 10 - (n.courts.size ? 0 : 5) };
    });
    this.appliquer();
  },

  // masque les étiquettes de lignes qui recouvriraient un rectangle ou une autre étiquette (calcul à partir des coordonnées, sans lire le DOM)
  declutter() {
    if (!this.etiq || !this.etiq.length) return;
    const v = this.vue, W = this.largeur, H = this.hauteur;
    if (v.k < 1.0) return;
    const boites = this.noeuds.filter(n => n.type !== "row").map(n => [n.x * v.k + v.x - (n.w / 2) * v.k, n.y * v.k + v.y - (n.h / 2) * v.k, n.w * v.k, n.h * v.k]);
    this.etiq.slice().sort((a, b) => b.prio - a.prio).forEach(e => {
      const n = e.n, taille = (v.k >= 2.2 ? 7 : 9) * v.k, w = e.el.textContent.length * taille * 0.56 + 4, h = taille * 1.25;
      const x = n.x * v.k + v.x + (n.r + 3) * v.k, y = n.y * v.k + v.y - h * 0.7;
      let ok = x + w > 0 && x < W && y + h > 0 && y < H;
      if (ok) for (const b of boites) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) { ok = false; break; }
      if (ok) boites.push([x, y, w, h]);
      e.el.style.display = ok ? "" : "none";
    });
  },
};
GrapheSignes.init();

document.getElementById("ds-search").addEventListener("input", (e) => DiagSignes.renderAvailable(e.target.value));
document.querySelector('.tab-btn[data-tab="diag-signes"]').addEventListener("click", () => { DiagSignes.ensureLoaded(); ZonesCorps.ensureLoaded(); });

/* ===== « Quelle zone du corps est touchée ? » : zones -> canaux dont le trajet passe par là =====
   Données : syndromes/canaux/zones.json (généré par zones_canaux.py d'après les trajets des fiches du carnet). */
const ZonesCorps = {
  data: null,
  selected: new Set(),

  async ensureLoaded() {
    if (this.data) return;
    try {
      this.data = await Store.readJSON("syndromes/canaux/zones.json");
    } catch (e) {
      document.getElementById("zc-chips").innerHTML = `<p class="muted">Zones pas encore générées (${escapeHtml(e.message)}).</p>`;
      return;
    }
    await DiagSignes.ensureLoaded();       // les signes des fiches de canaux servent aux sous-options
    this.buildSignIndex();
    this.renderChips();
    this.renderSousOptions();
    this.renderResults();
  },

  labelOf(id) { return (this.data.zones.find(z => z.id === id) || {}).label || id; },

  norm(t) {
    return String(t || "").toLowerCase().replace(/œ/g, "oe").replace(/[’‘]/g, "'").normalize("NFD").replace(/[̀-ͯ]/g, "");
  },

  // zone -> signes précis des tableaux du carnet (canaux : régulier, luo, tendineux) qui citent cette zone
  buildSignIndex() {
    this.signesParZone = {};
    // motifs explicites (zone nommée dans le signe) + motifs déduits (« miction » -> bas-ventre, « tympanisme » -> abdomen…)
    const motifs = this.data.zones.map(z => [z.id, z.motifs.map(p => new RegExp(p)), (z.motifs_implicites || []).map(p => new RegExp(p))]);
    const types = [["regulier", "régulier"], ["luo", "luo"], ["grand_luo", "grand luo"], ["tendineux", "tendineux"]];
    DiagSignes.syndromesData.filter(sd => sd.entry.domaine === "canaux").forEach(sd => {
      const d = sd.detail;
      types.forEach(([cle, nomType]) => {
        ((d[cle] || {}).lignes || []).forEach(l => {
          if (l.generique || !l.symptome) return;
          const [txt] = dsSplitSigns(l.symptome);
          const key = txt && dsNormalizeKey(txt);
          if (!key || !DiagSignes.signIndex.has(key)) return;
          const n = this.norm(l.symptome);
          motifs.forEach(([zid, res, resImp]) => {
            const explicite = res.some(r => r.test(n));
            if (!explicite && !resImp.some(r => r.test(n))) return;
            const liste = this.signesParZone[zid] || (this.signesParZone[zid] = new Map());
            const ent = liste.get(key) || { key, label: DiagSignes.signIndex.get(key), origines: [], mecanismes: [], implicite: true };
            if (explicite) ent.implicite = false;
            ent.origines.push(`${d.code} · ${nomType}`);
            if (l.mecanisme) ent.mecanismes.push(l.mecanisme);
            liste.set(key, ent);
          });
        });
      });
    });
  },

  // sous-options : pour chaque zone choisie, les signes précis du carnet qui la citent (cochables, partagés avec « Signes cliniques »)
  renderSousOptions() {
    const el = document.getElementById("zc-signes");
    if (!el) return;
    if (!this.selected.size) { el.innerHTML = ""; return; }
    el.innerHTML = `<h4 class="sec-sub">Précise le signe (tableaux du carnet)</h4>` + [...this.selected].map(zid => {
      const liste = [...((this.signesParZone || {})[zid] || new Map()).values()].sort((a, b) => a.label.localeCompare(b.label, "fr"));
      const corps = liste.length
        ? `<div class="ds-cat-chips">${liste.map(s => `<button type="button" class="ds-chip${DiagSignes.selected.has(s.key) ? " on" : ""}" data-k="${escapeHtml(s.key)}" aria-pressed="${DiagSignes.selected.has(s.key)}" title="${escapeHtml(s.mecanismes.join(" ; "))}">${escapeHtml(s.label)} <span class="tag-gen">${escapeHtml([...new Set(s.origines)].join(", "))}${s.implicite ? " · zone déduite" : ""}</span></button>`).join("")}</div>`
        : `<p class="muted">Aucun signe des tableaux du carnet ne cite cette zone.</p>`;
      return `<details class="zc-sous" open><summary>${escapeHtml(this.labelOf(zid))} (${liste.length})</summary>${corps}</details>`;
    }).join("");
    el.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", () => DiagSignes.toggle(b.dataset.k)));
  },

  toggle(id) {
    if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id);
    this.renderChips();
    this.renderSousOptions();
    this.renderResults();
    if (DiagSignes.loaded) DiagSignes.renderResults();
  },

  clear() {
    this.selected.clear();
    this.renderChips();
    this.renderSousOptions();
    this.renderResults();
    if (DiagSignes.loaded) DiagSignes.renderResults();
  },

  renderChips() {
    const host = document.getElementById("zc-chips");
    host.innerHTML = this.data.groupes.map(g =>
      `<div class="ds-cat-block"><h4 class="sec-sub">${escapeHtml(g.label)}</h4><div class="ds-cat-chips">` +
      g.zones.map(id => `<button type="button" class="ds-chip${this.selected.has(id) ? " on" : ""}" data-z="${escapeHtml(id)}" aria-pressed="${this.selected.has(id)}">${escapeHtml(this.labelOf(id))}</button>`).join("") +
      `</div></div>`).join("") +
      (this.selected.size ? `<button type="button" class="edit-toggle-btn" id="zc-clear">Effacer les zones</button>` : "");
    host.querySelectorAll("[data-z]").forEach(b => b.addEventListener("click", () => this.toggle(b.dataset.z)));
    const c = document.getElementById("zc-clear");
    if (c) c.addEventListener("click", () => this.clear());
  },

  // zones sélectionnées traversées par le canal (labels), pour l'affichage dans les résultats par signes
  couvertes(canalId) {
    if (!this.data || !this.selected.size) return [];
    const c = this.data.canaux[canalId];
    return c ? [...this.selected].filter(z => c.zones[z]).map(z => this.labelOf(z)) : [];
  },

  renderResults() {
    const el = document.getElementById("zc-results");
    if (!this.selected.size) { el.innerHTML = `<p class="muted">Aucune zone sélectionnée.</p>`; return; }
    const lignes = Object.entries(this.data.canaux).map(([id, c]) => {
      const trouvees = [...this.selected].filter(z => c.zones[z]);
      return { id, c, trouvees };
    }).filter(x => x.trouvees.length)
      .sort((a, b) => b.trouvees.length - a.trouvees.length || a.c.nom.localeCompare(b.c.nom, "fr"));
    if (!lignes.length) { el.innerHTML = `<p class="muted">Aucun canal du carnet ne passe par ces zones.</p>`; return; }
    const n = this.selected.size;
    el.innerHTML = lignes.map(({ id, c, trouvees }) => {
      const pct = Math.round((trouvees.length / n) * 100);
      return `
      <div class="ds-result zc-result" data-id="${escapeHtml(id)}">
        <div class="ds-result-top">
          <span class="ds-result-name">Canal ${escapeHtml(c.nom)} (${escapeHtml(c.code)})</span>
          <span class="ds-result-pct" title="${trouvees.length} zone(s) sélectionnée(s) sur ${n} traversée(s) par ce canal">${pct}%</span>
        </div>
        <div class="ds-result-bar-wrap"><div class="ds-result-bar" style="width:${pct}%;"></div></div>
        <p class="ds-result-matched">${trouvees.map(z => {
          const types = [...new Set(c.zones[z].map(t => t.type))].join(", ");
          return `<strong>${escapeHtml(this.labelOf(z))}</strong> <span class="muted">(${escapeHtml(types)})</span>`;
        }).join(" · ")}</p>
        <details class="zc-extraits"><summary>Passages du trajet</summary>${trouvees.map(z =>
          c.zones[z].map(t => `<p class="muted"><strong>${escapeHtml(this.labelOf(z))}</strong> — ${escapeHtml(t.type)} : ${escapeHtml(t.extrait)}</p>`).join("")).join("")}</details>
      </div>`;
    }).join("") +
      `<p class="muted" data-aide>${escapeHtml(this.data.note || "")}</p>`;
    el.querySelectorAll(".zc-result").forEach(div => div.addEventListener("click", ev => {
      if (ev.target.closest("details")) return;
      const entry = Syndromes.entries.find(e => e.id === div.dataset.id && e.domaine === "canaux");
      if (!entry) return;
      // section à montrer : celle des signes cochés s'il y en a pour ce canal, sinon celle(s) des types de trajet qui passent par les zones choisies
      const sd = DiagSignes.syndromesData.find(x => x.entry === entry);
      let sections = sd && DiagSignes.aSelection() ? Syndromes.sectionsPourSignes(sd.detail, DiagSignes.clesActives(sd)) : [];
      if (!sections.length) {
        const c = this.data.canaux[entry.id];
        const types = new Set([...this.selected].filter(z => c && c.zones[z]).flatMap(z => c.zones[z].map(t => t.type)));
        sections = [["regulier", t => t.startsWith("régulier")], ["luo", t => t === "luo"], ["grand_luo", t => t === "grand luo"], ["tendineux", t => t === "tendineux"]]
          .filter(([, test]) => [...types].some(test)).map(([k]) => k);
      }
      PostIt.open(entry, { sections });
    }));
  }
};

/* ===== Fiches flottantes (« post-it ») : la fiche d'un syndrome s'ouvre par-dessus la page, déplaçable, plusieurs à la fois ===== */
const PostIt = {
  ouverts: new Map(),     // "domaine/id" -> élément
  zMax: 300,

  // Montre dans la fiche la/les section(s) demandée(s) (canal régulier, luo, grand luo, tendineux) : défilement + cadre
  cibler(el, sections) {
    const corps = el.querySelector(".postit-corps");
    corps.querySelectorAll(".postit-cible").forEach(s => s.classList.remove("postit-cible"));
    const cibles = (sections || []).map(k => corps.querySelector(`[data-section="${k}"]`)).filter(Boolean);
    if (!cibles.length) return;
    cibles.forEach(s => s.classList.add("postit-cible"));
    const aller = () => {
      if (el._interagi || !cibles[0].isConnected) return;
      corps.scrollTop += cibles[0].getBoundingClientRect().top - corps.getBoundingClientRect().top - 8;
    };
    el._interagi = false;
    if (!el._ecoute) {      // dès que l'utilisatrice touche / fait défiler la fiche, on ne la recale plus
      el._ecoute = true;
      ["wheel", "touchstart", "pointerdown", "keydown"].forEach(ev => corps.addEventListener(ev, () => { el._interagi = true; }, { passive: true }));
    }
    aller();
    // sur téléphone, la mise en page bouge encore juste après l'ouverture (polices, tableaux) : on se recale
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(aller);
    [120, 400, 1000].forEach(t => setTimeout(aller, t));
  },

  mobile() { return window.innerWidth < 640; },

  async open(entry, opts = {}) {
    const cle = `${entry.domaine}/${entry.chemin}`;
    if (this.ouverts.has(cle)) {
      const el = this.ouverts.get(cle);
      this.devant(el);
      this.cibler(el, opts.sections);
      return;
    }
    const n = this.ouverts.size;
    const el = document.createElement("div");
    el.className = "postit";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", entry.nom);
    const etroit = window.innerWidth < 640;
    el.style.top = (Math.min(70 + n * 28, window.innerHeight - 200)) + "px";
    el.style.left = etroit ? "3vw" : Math.max(8, window.innerWidth - Math.min(560, window.innerWidth * 0.94) - 20 - n * 30) + "px";
    el.innerHTML = `<div class="postit-tete"><span class="postit-titre">${escapeHtml(entry.nom)}</span>` +
      `<button type="button" class="postit-ouvrir" title="Ouvrir dans l'onglet Syndromes">↗</button>` +
      `<button type="button" class="postit-fermer" title="Fermer" aria-label="Fermer">✕</button></div>` +
      `<div class="postit-corps formule-detail"><p class="muted">Chargement...</p></div>`;
    document.body.appendChild(el);
    this.ouverts.set(cle, el);
    this.devant(el);
    this.deplacable(el);
    el.dataset.cle = cle;
    el.dataset.titre = entry.nom;
    el.querySelector(".postit-fermer").addEventListener("click", () => this.fermer(cle));
    el.querySelector(".postit-ouvrir").addEventListener("click", () => {
      document.querySelector('.tab-btn[data-tab="syndromes"]').click();
      Syndromes.showDetail(entry);
    });
    el.addEventListener("pointerdown", () => this.devant(el));
    this.barre();
    this.synchro();
    try {
      const d = await Store.readJSON(`syndromes/${entry.domaine}/${entry.chemin}`);
      el.querySelector(".postit-corps").innerHTML = Syndromes.renderSyndrome(d, entry.domaine);
      this.cibler(el, opts.sections);
    } catch (e) {
      el.querySelector(".postit-corps").innerHTML = `<p class="muted">Impossible de charger la fiche (${escapeHtml(e.message)}).</p>`;
    }
  },

  devant(el) {
    el.style.zIndex = ++this.zMax;
    if (el.dataset.cle && this.actif !== el.dataset.cle) { this.actif = el.dataset.cle; this.synchro(); }
  },

  fermer(cle) {
    const el = this.ouverts.get(cle);
    if (el) el.remove();
    this.ouverts.delete(cle);
    if (this.actif === cle) this.actif = [...this.ouverts.keys()].pop() || null;
    this.barre();
    this.synchro();
  },

  // Sur téléphone : une seule fiche visible à la fois, avec une rangée d'onglets (un par fiche ouverte) pour passer de l'une à l'autre.
  // Sur grand écran : fiches flottantes, pas d'onglets.
  synchro() {
    let rang = document.getElementById("postit-onglets");
    const mob = this.mobile() && this.ouverts.size > 0;
    document.body.classList.toggle("postit-mobile", mob);
    if (!mob) {
      if (rang) rang.remove();
      this.ouverts.forEach(el => el.classList.remove("postit-cache"));
      return;
    }
    if (!this.actif || !this.ouverts.has(this.actif)) this.actif = [...this.ouverts.keys()].pop();
    if (!rang) { rang = document.createElement("div"); rang.id = "postit-onglets"; rang.setAttribute("role", "tablist"); document.body.appendChild(rang); }
    rang.style.zIndex = this.zMax + 5;
    rang.innerHTML = [...this.ouverts.entries()].map(([cle, el]) =>
      `<button type="button" role="tab" class="postit-onglet${cle === this.actif ? " actif" : ""}" aria-selected="${cle === this.actif}" data-cle="${escapeHtml(cle)}">${escapeHtml(dsCut(el.dataset.titre || cle, 22))}</button>`).join("") +
      `<button type="button" class="postit-onglet postit-tout" aria-label="Fermer toutes les fiches">Tout fermer ✕</button>`;
    rang.querySelectorAll("[data-cle]").forEach(b => b.addEventListener("click", () => { this.actif = b.dataset.cle; this.synchro(); }));
    rang.querySelector(".postit-tout").addEventListener("click", () => this.toutFermer());
    this.ouverts.forEach((el, cle) => el.classList.toggle("postit-cache", cle !== this.actif));
    const a = rang.querySelector(".actif");
    if (a && a.scrollIntoView) a.scrollIntoView({ inline: "nearest", block: "nearest" });
  },

  toutFermer() { [...this.ouverts.keys()].forEach(k => this.fermer(k)); },

  // barre flottante « Fermer les fiches (n) », visible dès qu'une fiche est ouverte
  barre() {
    let b = document.getElementById("postit-barre");
    if (!this.ouverts.size || this.mobile()) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement("button");
      b.id = "postit-barre";
      b.type = "button";
      b.addEventListener("click", () => this.toutFermer());
      document.body.appendChild(b);
    }
    b.textContent = `Fermer les fiches (${this.ouverts.size})`;
    b.style.zIndex = this.zMax + 1;
  },

  deplacable(el) {
    const tete = el.querySelector(".postit-tete");
    let dx = 0, dy = 0, actif = false;
    tete.addEventListener("pointerdown", e => {
      if (e.target.closest("button") || this.mobile()) return;
      actif = true;
      dx = e.clientX - el.offsetLeft;
      dy = e.clientY - el.offsetTop;
      tete.setPointerCapture(e.pointerId);
      this.devant(el);
    });
    tete.addEventListener("pointermove", e => {
      if (!actif) return;
      const x = Math.min(Math.max(e.clientX - dx, 4 - el.offsetWidth + 80), window.innerWidth - 80);
      const y = Math.min(Math.max(e.clientY - dy, 0), window.innerHeight - 40);
      el.style.left = x + "px";
      el.style.top = y + "px";
    });
    const fin = () => { actif = false; };
    tete.addEventListener("pointerup", fin);
    tete.addEventListener("pointercancel", fin);
  }
};
window.addEventListener("resize", () => { if (PostIt.ouverts.size) { PostIt.barre(); PostIt.synchro(); } });
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || !PostIt.ouverts.size) return;
  const haut = [...PostIt.ouverts.entries()].sort((a, b) => b[1].style.zIndex - a[1].style.zIndex)[0];
  if (haut) PostIt.fermer(haut[0]);
});

/* ============================= Cas pratique ============================= */
const CasPratique = {
  cas: [],
  sources: {},
  rawIndex: null,
  _deepIndexed: false,
  _deepIndexing: false,

  async ensureDeepIndexed() {
    if (this._deepIndexed || this._deepIndexing) return;
    this._deepIndexing = true;
    await Promise.all(this.cas.map(async c => {
      try {
        const d = await Store.readJSON("cas_pratique/" + c.chemin);
        c._searchText = flattenDetailText(d);
      } catch (err) { /* fiche indisponible pour l'instant */ }
    }));
    this._deepIndexed = true;
    this._deepIndexing = false;
  },

  async load() {
    try {
      const idx = await Store.readJSON("cas_pratique/index.json");
      this.rawIndex = idx;
      this.cas = idx.cas || [];
      (idx.sources || []).forEach(s => this.sources[s.source_id] = s.livre);
    } catch (e) {
      document.getElementById("casp-list").innerHTML = `<li class="muted">Base pas encore prête (${e.message}).</li>`;
      return;
    }
    this.renderList(this.cas);
  },

  search(query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return this.cas;
    return this.cas.filter(c => (c.resume_court || "").toLowerCase().includes(q) || (c.titre_original || "").toLowerCase().includes(q));
  },

  renderList(list) {
    const ul = document.getElementById("casp-list");
    ul.innerHTML = "";
    list.forEach(c => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="fl-pinyin">${escapeHtml(c.titre_original || c.id)}</span>
        <span class="fl-syndrome">${escapeHtml(this.sources[c.source_id] || c.source_id)}</span>`;
      li.addEventListener("click", () => this.showDetail(c, li));
      ul.appendChild(li);
    });
    document.getElementById("casp-count").textContent = list.length + " cas";
  },

  async showDetail(entry, liEl) {
    document.querySelectorAll("#casp-list li").forEach(li => li.classList.remove("selected"));
    if (liEl) liEl.classList.add("selected");
    const detail = document.getElementById("casp-detail");
    detail.innerHTML = "<p class='muted'>Chargement...</p>";
    try {
      const d = await Store.readJSON("cas_pratique/" + entry.chemin);
      detail.innerHTML = this.renderCas(d, entry);
      addEditControls(detail, "cas_pratique/" + entry.chemin, d, {
        onSaved: async (parsed) => {
          if (!this.rawIndex.cas) this.rawIndex.cas = [];
          const arr = this.rawIndex.cas;
          const i = arr.findIndex(x => x.id === entry.id);
          const patch = { titre_original: parsed.titre_original, resume_court: parsed.resume_court };
          if (i >= 0) Object.assign(arr[i], patch); else arr.push({ id: parsed.id || entry.id, chemin: entry.chemin, source_id: entry.source_id, ...patch });
          await Store.writeJSON("cas_pratique/index.json", this.rawIndex);
          const cIdx = this.cas.findIndex(c => c.id === entry.id);
          if (cIdx >= 0) Object.assign(this.cas[cIdx], patch);
          this.renderList(this.search(document.getElementById("casp-search").value));
          await this.showDetail(entry, liEl);
        }
      });
      const btn = document.getElementById("casp-reveal-btn");
      if (btn) btn.addEventListener("click", () => {
        document.getElementById("casp-corrige").style.display = "block";
        btn.style.display = "none";
      });
    } catch (e) {
      detail.innerHTML = `<p class="muted">Impossible de charger la fiche (${e.message}).</p>`;
    }
  },

  renderCas(d, entry) {
    const verif = (d.a_verifier && d.a_verifier.length)
      ? `<section><h3>À vérifier contre la source</h3>${d.a_verifier.map(v => `<span class="tag-verifier">⚠ ${escapeHtml(v)}</span>`).join("")}</section>`
      : "";
    return `
      <h2>${escapeHtml(d.titre_original || entry.id)}</h2>
      <p class="muted">${escapeHtml(this.sources[entry.source_id] || "")}</p>
      <section><h3>Présentation clinique (énoncé)</h3><div class="tcm-text">${formatTcmText(d.presentation_clinique)}</div></section>
      <button type="button" id="casp-reveal-btn" class="cas-toolbar-btn-reveal">👁 Révéler le corrigé</button>
      <div id="casp-corrige" style="display:none;">
        <section><h3>Diagnostic de l'auteur</h3><div class="tcm-text">${formatTcmText(d.diagnostic_du_livre)}</div></section>
        ${d.raisonnement_diagnostique ? `<section><h3>Raisonnement diagnostique</h3><div class="tcm-text">${formatTcmText(d.raisonnement_diagnostique)}</div></section>` : ""}
        ${d.traitement_propose ? `<section><h3>Traitement proposé</h3><div class="tcm-text">${formatTcmText(d.traitement_propose)}</div></section>` : ""}
        ${d.resultat_ou_suivi ? `<section><h3>Résultat / suivi</h3><div class="tcm-text">${formatTcmText(d.resultat_ou_suivi)}</div></section>` : ""}
        ${d.lecon_cle ? `<section><h3>Leçon clé</h3><div class="tcm-text">${formatTcmText(d.lecon_cle)}</div></section>` : ""}
        ${verif}
      </div>
      <p class="muted">Source : ${escapeHtml((d.source && d.source.livre) || "?")}${d.source && d.source.chapitre_ou_page ? " — " + escapeHtml(d.source.chapitre_ou_page) : ""}</p>
    `;
  }
};

document.getElementById("casp-search").addEventListener("input", (e) => CasPratique.renderList(CasPratique.search(e.target.value)));
CasPratique.load().then(() => CasPratique.ensureDeepIndexed());

/* ============================= TDAH (page transversale) ============================= */
// Construit le HTML d'une fiche-type (TDAH ou Dépression/Anxiété/Insomnie) — même structure des deux
// côtés, factorisée ici pour éviter la duplication qui existait entre loadTdahPage et loadDepressionPage.
function renderPsyTypeCard(t, idPrefix) {
  const signes = (t.signes_cles && t.signes_cles.length)
    ? `<h4 class="sec-sub">Signes clés</h4><ul class="tcm-list">${t.signes_cles.map(s => `<li>${tcmHighlightInline(escapeHtml(s))}</li>`).join("")}</ul>` : "";
  let points = "";
  if (t.points && t.points.length) {
    points = `<h4 class="sec-sub">Points / associations proposés</h4><ul class="tcm-list">${t.points.map(p =>
      `<li><strong>${escapeHtml(p.points || "")}</strong> — ${tcmHighlightInline(escapeHtml(p.justification || ""))}<br><span class="muted">Source : ${escapeHtml(p.source_precise || "")}</span></li>`
    ).join("")}</ul>`;
  } else if (t.points_note) {
    points = `<h4 class="sec-sub">Points / associations proposés</h4><p class="muted">${escapeHtml(t.points_note)}</p>`;
  }
  if (t.points && t.points.length && t.points_note) {
    points += `<p class="muted">${escapeHtml(t.points_note)}</p>`;
  }
  const principe = t.principe_traitement ? `<h4 class="sec-sub">Principe de traitement</h4><p>${tcmHighlightInline(escapeHtml(t.principe_traitement))}</p>` : "";
  let pharma = "";
  if (t.pharmacopee && t.pharmacopee.length) {
    pharma = `<h4 class="sec-sub">Pharmacopée</h4>` + t.pharmacopee.map(p => {
      const comp = (p.composition || []).map(c => `<tr><td>${escapeHtml(c.substance || "")}</td><td>${escapeHtml(c.dose || "")}</td><td>${escapeHtml(c.role || "")}</td></tr>`).join("");
      const mods = (p.modifications && p.modifications.length)
        ? `<h4 class="sec-sub">Modifications</h4><ul class="tcm-list">${p.modifications.map(m => `<li>${tcmHighlightInline(escapeHtml(m))}</li>`).join("")}</ul>` : "";
      const contreInd = (p.contre_indications && p.contre_indications.length)
        ? `<div class="tdah-contre-ind"><strong>⚠ Contre-indications / précautions</strong><ul class="tcm-list">${p.contre_indications.map(ci => `<li>${tcmHighlightInline(escapeHtml(ci))}</li>`).join("")}</ul></div>` : "";
      return `<p><span class="tcm-formule">${escapeHtml(p.nom_pinyin || "")}</span></p>
        ${comp ? `<table><thead><tr><th>Substance</th><th>Dose</th><th>Rôle</th></tr></thead><tbody>${comp}</tbody></table>` : ""}
        ${p.indication_precise ? `<p>${tcmHighlightInline(escapeHtml(p.indication_precise))}</p>` : ""}
        ${contreInd}
        ${p.preparation ? `<p class="muted">${escapeHtml(p.preparation)}</p>` : ""}
        ${mods}`;
    }).join("<hr>");
  }
  const pharmaNote = t.pharmacopee_note ? `<p class="muted">${escapeHtml(t.pharmacopee_note)}</p>` : "";
  return `<details class="depression-type-details" id="${idPrefix}-${escapeHtml(t.id || slugify(t.nom))}">
    <summary><h3>${escapeHtml(t.nom)}</h3><p class="muted">${escapeHtml(t.approche || "")}</p></summary>
    <div class="depression-type-body">
      ${t.mecanisme ? `<p>${tcmHighlightInline(escapeHtml(t.mecanisme))}</p>` : ""}
      ${signes}${principe}${points}${pharma}${pharmaNote}
      <p class="muted">Source : ${escapeHtml((t.source && t.source.origine) || "")} (${escapeHtml((t.source && t.source.fichier) || "")})</p>
    </div>
  </details>`;
}

// Construit l'index cliquable en haut d'une page psy (TDAH ou Dépression/Anxiété/Insomnie) et câble
// les clics pour ouvrir la fiche correspondante et y défiler.
function renderPsyIndex(el, types, idPrefix) {
  const index = types.map(t => {
    const id = idPrefix + "-" + escapeHtml(t.id || slugify(t.nom));
    return `<li><a href="#${id}" data-target="${id}">${escapeHtml(t.nom)}</a></li>`;
  }).join("");
  el.querySelectorAll(".depression-index a").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const target = document.getElementById(a.dataset.target);
      if (target) {
        target.open = true;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
  return `<nav class="depression-index"><h4 class="sec-sub">Index — clique pour ouvrir et aller directement à un tableau</h4><ol>${index}</ol></nav>`;
}

async function loadTdahPage() {
  const el = document.getElementById("tdah-detail");
  try {
    const d = await Store.readJSON("tdah_transversal.json");
    window.TdahData = d;
    const types = d.types || [];
    const typesHtml = types.map(t => renderPsyTypeCard(t, "psy-tdah")).join("");
    el.innerHTML = `
      <h2>${escapeHtml(d.titre)}</h2>
      <p class="muted"><em>${escapeHtml(d.avertissement || "")}</em></p>
      <nav class="depression-index"><h4 class="sec-sub">Index — clique pour ouvrir et aller directement à un tableau</h4><ol>${types.map(t => `<li><a href="#psy-tdah-${escapeHtml(t.id || slugify(t.nom))}" data-target="psy-tdah-${escapeHtml(t.id || slugify(t.nom))}">${escapeHtml(t.nom)}</a></li>`).join("")}</ol></nav>
      ${typesHtml}
    `;
    el.querySelectorAll(".depression-index a").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const target = document.getElementById(a.dataset.target);
        if (target) { target.open = true; target.scrollIntoView({ behavior: "smooth", block: "start" }); }
      });
    });
    addEditControls(el, "tdah_transversal.json", d, { onSaved: () => loadTdahPage() });
  } catch (e) {
    el.innerHTML = `<p class="muted">Page pas encore prête (${e.message}).</p>`;
  }
}
loadTdahPage();

/* ============================= Dépression / Anxiété / Insomnie (page transversale, 3 sous-onglets) ============================= */
// Les 13 types de data/depression_anxiete_insomnie_transversal.json sont tagués par thème(s) (champ
// "themes": ["depression","anxiete","insomnie"], un type peut appartenir à plusieurs). Cette fonction
// charge le fichier une fois par thème et n'affiche que les types concernés — TDAH, Dépression, Anxiété
// et Insomnie restent 4 boutons bien séparés dans "Tableaux Psy", jamais fusionnés entre eux.
async function loadPsyTransversalTheme(elId, theme) {
  const el = document.getElementById(elId);
  try {
    const d = await Store.readJSON("depression_anxiete_insomnie_transversal.json");
    window.DepressionAnxieteInsomnieData = d;
    const types = (d.types || []).filter(t => (t.themes || []).includes(theme));
    const idPrefix = "psy-" + theme;
    const typesHtml = types.map(t => renderPsyTypeCard(t, idPrefix)).join("");
    el.innerHTML = `
      <h2>${escapeHtml(d.titre)}</h2>
      <p class="muted"><em>${escapeHtml(d.avertissement || "")}</em></p>
      <nav class="depression-index"><h4 class="sec-sub">Index — clique pour ouvrir et aller directement à un tableau</h4><ol>${types.map(t => `<li><a href="#${idPrefix}-${escapeHtml(t.id || slugify(t.nom))}" data-target="${idPrefix}-${escapeHtml(t.id || slugify(t.nom))}">${escapeHtml(t.nom)}</a></li>`).join("")}</ol></nav>
      ${typesHtml}
    `;
    el.querySelectorAll(".depression-index a").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const target = document.getElementById(a.dataset.target);
        if (target) { target.open = true; target.scrollIntoView({ behavior: "smooth", block: "start" }); }
      });
    });
    addEditControls(el, "depression_anxiete_insomnie_transversal.json", d, { onSaved: () => loadPsyTransversalTheme(elId, theme) });
  } catch (e) {
    el.innerHTML = `<p class="muted">Page pas encore prête (${e.message}).</p>`;
  }
}
loadPsyTransversalTheme("depression-detail", "depression");
loadPsyTransversalTheme("anxiete-detail", "anxiete");
loadPsyTransversalTheme("insomnie-detail", "insomnie");

document.getElementById("tableaux-psy-switch").addEventListener("click", (e) => {
  const btn = e.target.closest(".cat-chip");
  if (!btn) return;
  document.querySelectorAll("#tableaux-psy-switch .cat-chip").forEach(c => c.classList.remove("active"));
  btn.classList.add("active");
  document.querySelectorAll(".tableaux-psy-subpanel").forEach(p => p.classList.remove("active"));
  document.getElementById("subtab-" + btn.dataset.subtab).classList.add("active");
});

/* ============================= Images locales (dossier choisi sur l'appareil) ============================= */
// Pour la copie hébergée (PWA sans dossier data/ local) : laisse charger les images
// directement depuis un dossier du téléphone via le sélecteur de dossier du navigateur,
// sans jamais transiter par le dépôt GitHub (qui exclut volontairement les images).
const LocalImages = {
  map: new Map(), // relPath ("P/P1.jpg") -> object URL (session-live cache, rebuilt from IndexedDB on load)
  db: null,

  openDB() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("mtc_local_images", 1);
      req.onupgradeneeded = () => { req.result.createObjectStore("images"); };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  },

  urlFor(relPath) {
    return this.map.get(relPath) || null;
  },

  relPathFor(file) {
    const full = file.webkitRelativePath || file.name;
    // webkitRelativePath commence toujours par le nom du dossier choisi (ex "images/P/P1.jpg") ;
    // on retire ce premier segment pour retrouver le chemin relatif attendu ("P/P1.jpg").
    const parts = full.split("/");
    return parts.length > 1 ? parts.slice(1).join("/") : full;
  },

  async loadFiles(fileList) {
    this.map.forEach(url => URL.revokeObjectURL(url));
    this.map.clear();
    const db = await this.openDB();
    const tx = db.transaction("images", "readwrite");
    const store = tx.objectStore("images");
    let count = 0;
    for (const file of fileList) {
      const relPath = this.relPathFor(file);
      if (!/\.(jpe?g|png|webp|gif)$/i.test(relPath)) continue;
      this.map.set(relPath, URL.createObjectURL(file));
      store.put(file, relPath);
      count++;
    }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    return count;
  },

  async loadFromDB() {
    const db = await this.openDB();
    const tx = db.transaction("images", "readonly");
    const store = tx.objectStore("images");
    const keys = await new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!keys.length) return 0;
    const values = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    this.map.forEach(url => URL.revokeObjectURL(url));
    this.map.clear();
    keys.forEach((key, i) => this.map.set(key, URL.createObjectURL(values[i])));
    return keys.length;
  },

  async clearStored() {
    const db = await this.openDB();
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").clear();
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    this.map.forEach(url => URL.revokeObjectURL(url));
    this.map.clear();
  }
};

document.getElementById("pts-load-local-images").addEventListener("click", () => {
  document.getElementById("pts-local-images-input").click();
});
document.getElementById("pts-local-images-input").addEventListener("change", async (e) => {
  const status = document.getElementById("pts-local-images-status");
  status.style.display = "block";
  status.textContent = "Enregistrement des images en cours...";
  const count = await LocalImages.loadFiles(e.target.files);
  status.textContent = `✅ ${count} image(s) chargée(s) et enregistrée(s) sur cet appareil — disponibles automatiquement aux prochaines ouvertures de l'app, sans repasser par le sélecteur de dossier.`;
  if (Points.lastShown) Points.showDetail(Points.lastShown);
});
document.getElementById("pts-clear-local-images").addEventListener("click", async () => {
  const status = document.getElementById("pts-local-images-status");
  await LocalImages.clearStored();
  status.style.display = "block";
  status.textContent = "🗑 Images locales effacées de cet appareil.";
  if (Points.lastShown) Points.showDetail(Points.lastShown);
});
LocalImages.loadFromDB().then(count => {
  if (count) {
    const status = document.getElementById("pts-local-images-status");
    status.style.display = "block";
    status.textContent = `✅ ${count} image(s) locale(s) rechargée(s) automatiquement depuis cet appareil.`;
  }
});

/* ============================= Points (base Jeu) ============================= */
const Points = {
  canaux: [],
  entries: [], // {id: "P 5", canal, canalNom, chemin}
  activeCanal: null,
  cache: {},

  async load() {
    try {
      const idx = await Store.readJSON("reference/points_canaux/index.json");
      this.canaux = idx.canaux || [];
    } catch (e) {
      document.getElementById("pts-list").innerHTML = `<li class="muted">Base pas encore prête (${e.message}).</li>`;
      return;
    }
    await Promise.all(this.canaux.map(async c => {
      try {
        const pts = await Store.readJSON(`reference/points_canaux/${c.fichier}`);
        this.cache[c.id] = pts;
        pts.forEach(p => this.entries.push({ id: p.point, canal: c.id, canalNom: c.nom, data: p, _searchText: flattenDetailText(p) }));
      } catch (e) { /* skip */ }
    }));
    this.renderGroups();
    this.renderList(this.entries);
  },

  renderGroups() {
    const el = document.getElementById("pts-groups");
    el.innerHTML = "";
    const mk = (label, canal) => {
      const chip = document.createElement("button");
      chip.className = "cat-chip" + (this.activeCanal === canal ? " active" : "");
      chip.textContent = label;
      chip.addEventListener("click", () => { this.activeCanal = canal; this.renderGroups(); this.applyFilters(); });
      return chip;
    };
    el.appendChild(mk("Tous (" + this.entries.length + ")", null));
    this.canaux.forEach(c => {
      const n = (this.cache[c.id] || []).length;
      el.appendChild(mk(c.nom + " (" + n + ")", c.id));
    });
    if (this.activeCanal === null) el.firstChild.classList.add("active");
  },

  applyFilters() {
    document.getElementById("pts-search").dispatchEvent(new Event("input"));
  },

  search(query) {
    let pool = this.entries;
    if (this.activeCanal) pool = pool.filter(e => e.canal === this.activeCanal);
    const q = (query || "").trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(e =>
      e.id.toLowerCase().includes(q) ||
      (e.data.pinyin || "").toLowerCase().includes(q) ||
      (e.data.nom_fr || "").toLowerCase().includes(q) ||
      (e.data.indications || []).some(i => (i.indication || "").toLowerCase().includes(q)) ||
      (e.data.indications_contemporaines || []).some(i => (i || "").toLowerCase().includes(q)) ||
      (e.data.indications_psycho_emotionnelles || []).some(i => (i.indication || "").toLowerCase().includes(q) || (i.source || "").toLowerCase().includes(q)) ||
      (e.data.actions || []).some(a => (a || "").toLowerCase().includes(q)) ||
      (Array.isArray(e.data.associations)
        ? e.data.associations.some(a => (a || "").toLowerCase().includes(q))
        : (e.data.associations || "").toLowerCase().includes(q)) ||
      (e.data.correspondances || []).some(c => (c || "").toLowerCase().includes(q)) ||
      (e.data.note || "").toLowerCase().includes(q)
    );
  },

  renderList(list) {
    const ul = document.getElementById("pts-list");
    ul.innerHTML = "";
    list.slice(0, 300).forEach(e => {
      const li = document.createElement("li");
      const hasPsycho = (e.data.indications_psycho_emotionnelles || []).length > 0;
      li.innerHTML = `<span class="fl-pinyin">${escapeHtml(e.id)}${hasPsycho ? ` <span class="psi-list-badge" title="A une indication psycho-émotionnelle">💭</span>` : ""}</span>
        <span class="fl-syndrome">${escapeHtml(e.data.pinyin || "")}${e.data.nom_fr ? " — " + escapeHtml(e.data.nom_fr) : ""}</span>`;
      li.addEventListener("click", () => this.showDetail(e, li));
      ul.appendChild(li);
    });
    document.getElementById("pts-count").textContent = list.length + " point(s)" + (list.length > 300 ? " (300 affichés, affine ta recherche)" : "");
  },

  showDetail(entry, liEl) {
    this.lastShown = entry;
    document.querySelectorAll("#pts-list li").forEach(li => li.classList.remove("selected"));
    if (liEl) liEl.classList.add("selected");
    const d = entry.data;
    const imgs = (d.images || []).map(img => `<img src="${LocalImages.urlFor(img) || "data/reference/points_canaux/images/" + img}" alt="${escapeHtml(entry.id)}" style="max-width:280px;border:2px solid var(--ink);margin:0 0.5rem 0.5rem 0;">`).join("");
    const indications = (d.indications || []).length
      ? `<ul class="tcm-list">${d.indications.map(i => `<li><strong>${escapeHtml(i.categorie || "")}</strong> — ${tcmHighlightInline(escapeHtml(i.indication || ""))}</li>`).join("")}</ul>` : "";
    const actions = (d.actions || []).length
      ? `<ul class="tcm-list">${d.actions.map(a => `<li>${tcmHighlightInline(escapeHtml(a))}</li>`).join("")}</ul>` : "";
    const indicContemp = (d.indications_contemporaines || []).length
      ? `<ul class="tcm-list">${d.indications_contemporaines.map(i => `<li>${tcmHighlightInline(escapeHtml(i))}</li>`).join("")}</ul>` : "";
    const indicPsycho = (d.indications_psycho_emotionnelles || []).length
      ? `<ul class="tcm-list psycho-emo-list">${d.indications_psycho_emotionnelles.map(i => `<li>
            <span>${tcmHighlightInline(escapeHtml(i.indication || ""))}</span>
            <span class="psi-source-line">
              ${i.auteur_lignee ? `<span class="psi-source-tag">${escapeHtml(i.auteur_lignee)}</span>` : ""}
              ${i.source ? `<span class="psi-source-ref">${escapeHtml(i.source)}</span>` : ""}
            </span>
          </li>`).join("")}</ul>` : "";
    const associations = Array.isArray(d.associations)
      ? (d.associations.length ? `<ul class="tcm-list">${d.associations.map(a => `<li>${tcmHighlightInline(escapeHtml(a))}</li>`).join("")}</ul>` : "")
      : (d.associations ? `<div class="tcm-text">${formatTcmText(d.associations)}</div>` : "");
    const correspondances = (d.correspondances || []).length
      ? `<ul class="tcm-list">${d.correspondances.map(c => `<li>${tcmHighlightInline(escapeHtml(c))}</li>`).join("")}</ul>` : "";
    document.getElementById("pts-detail").innerHTML = `
      <h2>${escapeHtml(entry.id)} <span class="hanzi">${escapeHtml(d.hanzi || "")}</span></h2>
      <p class="muted">${escapeHtml(d.pinyin || "")}${d.nom_fr ? " — " + escapeHtml(d.nom_fr) : ""} · ${escapeHtml(entry.canalNom)}${d.canal_indicatif ? " (canal indicatif : " + escapeHtml(d.canal_indicatif) + ")" : ""}</p>
      ${imgs ? `<section><h3>Localisation (images)</h3>${imgs}</section>` : ""}
      ${d.localisation ? `<section><h3>Localisation</h3><div class="tcm-text">${formatTcmText(d.localisation)}</div></section>` : ""}
      ${d.methode_localisation ? `<section><h3>Méthode de localisation</h3><div class="tcm-text">${formatTcmText(d.methode_localisation)}</div></section>` : ""}
      ${d.methode_travail ? `<section><h3>Méthode de travail</h3><div class="tcm-text">${formatTcmText(d.methode_travail)}</div></section>` : ""}
      ${d.categories_point ? `<section><h3>Catégories du point</h3><div class="tcm-text">${formatTcmText(d.categories_point)}</div></section>` : ""}
      ${correspondances ? `<section><h3>Correspondances</h3>${correspondances}</section>` : ""}
      ${indications ? `<section><h3>Indications</h3>${indications}</section>` : ""}
      ${indicContemp ? `<section><h3>Indications contemporaines</h3>${indicContemp}</section>` : ""}
      ${indicPsycho ? `<section class="psycho-emo-section"><h3>💭 Indications psycho-émotionnelles</h3>${indicPsycho}</section>` : ""}
      ${actions ? `<section><h3>Actions</h3>${actions}</section>` : ""}
      ${associations ? `<section><h3>Associations</h3>${associations}</section>` : ""}
      ${d.note ? `<section><h3>Note</h3><div class="tcm-text">${formatTcmText(d.note)}</div></section>` : ""}
      <p class="muted">Source : base Jeu (Points des canaux.xlsx) + images localisation.jpg (Bibliothèque MTC)</p>
    `;
    addEditControls(document.getElementById("pts-detail"), "reference/points_canaux/" + entry.canal + ".json", d, { arrayItem: true, matchField: "point", matchValue: entry.id, editorFn: openPointEditor });
  }
};

document.getElementById("pts-search").addEventListener("input", (e) => Points.renderList(Points.search(e.target.value)));
Points.load();

/* ================= Tableau des croisements de canaux ================= */
const Croisement = {
  data: null,
  cols: ["P", "GI", "E", "Rt", "C", "IG", "V", "Rn", "EC", "TF", "VB", "F", "DM", "RM"],
  vessels: ["yáng wéi mài", "yīn wéi mài", "yáng qiāo mài", "yīn qiāo mài", "chōng mài", "dài mài"],

  async load() {
    const wrap = document.getElementById("croise-table-wrap");
    try {
      this.data = await Store.readJSON("reference/points_croisement.json");
    } catch (e) {
      wrap.innerHTML = `<p class="muted">Base pas encore prête (${e.message}).</p>`;
      return;
    }
    this.render(this.data.points);
    const editZone = document.getElementById("croise-edit-zone");
    if (editZone) {
      editZone.innerHTML = "";
      addEditControls(editZone, "reference/points_croisement.json", this.data, {
        onSaved: () => this.render(this.search(document.getElementById("croise-search").value))
      });
    }
  },

  cellFor(point, colName) {
    const isVessel = this.vessels.includes(colName);
    const list = isVessel ? point.vaisseaux_extraordinaires_recoupes : point.canaux_recoupes;
    const key = isVessel ? "vaisseau" : "canal";
    const found = (list || []).find(x => x[key] === colName);
    if (colName === point.canal_principal) return `<td class="croise-self" title="Canal propre du point"></td>`;
    if (!found) return `<td></td>`;
    const cls = found.type === "confirme" ? "croise-confirme" : "croise-secondaire";
    return `<td class="${cls}" title="${escapeHtml(colName)} — ${found.type === "confirme" ? "recoupement confirmé" : "recoupement secondaire (à vérifier)"}"></td>`;
  },

  render(points) {
    const wrap = document.getElementById("croise-table-wrap");
    if (!points.length) { wrap.innerHTML = `<p class="muted">Aucun résultat.</p>`; return; }
    const allCols = [...this.cols, ...this.vessels];
    const header = `<tr><th>Point</th>${allCols.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
    const rows = points.map(p => `<tr><th class="croise-point-label">${escapeHtml(p.point)}</th>${allCols.map(c => this.cellFor(p, c)).join("")}</tr>`).join("");
    wrap.innerHTML = `<div class="croise-table-scroll"><table class="croise-table">${header}${rows}</table></div>
      <p class="muted">${points.length} point(s) de croisement affiché(s).</p>
      <p class="muted" data-aide>Case sombre = recoupement confirmé (noir dans la source). Case claire = recoupement secondaire (gris dans la source, sans légende explicite — à vérifier).</p>`;
  },

  search(query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return this.data.points;
    return this.data.points.filter(p => {
      if (p.point.toLowerCase().includes(q)) return true;
      if ((p.canal_principal || "").toLowerCase().includes(q)) return true;
      if ((p.canaux_recoupes || []).some(c => c.canal.toLowerCase().includes(q) || c.nom.toLowerCase().includes(q))) return true;
      if ((p.vaisseaux_extraordinaires_recoupes || []).some(v => v.vaisseau.toLowerCase().includes(q))) return true;
      return false;
    });
  }
};
document.getElementById("croise-search").addEventListener("input", (e) => {
  if (Croisement.data) Croisement.render(Croisement.search(e.target.value));
});
Croisement.load();
/* ============================= Points > Canaux distincts : tableaux pathologiques =============================
   Textes repris tels quels de la base (Sterman, Twicken, Farrell), chaque cellule avec sa référence discrète.
   Données compilées par data/reference/canaux_distincts/generer.py -> tableaux.json */
const PTS_VIEWS = [
  ["pts-view-fiches", "pts-view-fiches-panel"],
  ["pts-view-croisements", "pts-view-croisements-panel"],
  ["pts-view-distincts", "pts-view-distincts-panel"]
];
function showPtsView(btnId) {
  PTS_VIEWS.forEach(([b, p]) => {
    document.getElementById(b).classList.toggle("active", b === btnId);
    document.getElementById(p).style.display = b === btnId ? "" : "none";
  });
}

const CanauxDistincts = {
  data: null,
  champs: null,          // Set des champs affichés
  rangs: new Set(),      // confluences affichées (vide = toutes)
  PRESETS: [
    ["Signes (Sterman)", ["trajectoire", "wei", "mobilisation", "depletion"]],
    ["Signes + pouls", ["trajectoire", "wei", "mobilisation", "depletion", "pouls"]],
    ["Twicken", ["primaire", "organe", "luo"]],
    ["Points et zones", ["rencontre", "ouverture", "palpation", "six_yang"]],
    ["Tout", ["trajectoire", "wei", "mobilisation", "depletion", "pouls", "cles", "primaire", "organe", "luo", "rencontre", "ouverture", "palpation", "six_yang"]]
  ],

  async load() {
    try {
      this.data = await Store.readJSON("reference/canaux_distincts/tableaux.json");
    } catch (e) {
      document.getElementById("cd-wrap").innerHTML = `<p class="muted">Tableaux pas encore générés (${escapeHtml(e.message)}).</p>`;
      return;
    }
    this.champs = new Set(this.data.champs_par_defaut);
    this.renderControls();
    this.render();
    this.renderExtras();
  },

  chip(host, label, active, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cat-chip" + (active ? " active" : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    host.appendChild(b);
  },

  renderControls() {
    const champs = document.getElementById("cd-champs");
    champs.innerHTML = "";
    this.data.champs.forEach(c => {
      const on = this.champs.has(c.id);
      this.chip(champs, (on ? "☑ " : "☐ ") + c.label + " · " + this.data.sources[c.source].court, on, () => {
        if (on) this.champs.delete(c.id); else this.champs.add(c.id);
        this.renderControls(); this.render();
      });
      champs.lastChild.title = c.aide;
    });
    const presets = document.getElementById("cd-presets");
    presets.innerHTML = "";
    this.PRESETS.forEach(([label, ids]) => this.chip(presets, label, false, () => {
      this.champs = new Set(ids); this.renderControls(); this.render();
    }));
    const conf = document.getElementById("cd-confluences");
    conf.innerHTML = "";
    this.chip(conf, "Toutes", !this.rangs.size, () => { this.rangs.clear(); this.renderControls(); this.render(); });
    this.data.confluences.forEach(c => {
      const on = this.rangs.has(c.rang);
      this.chip(conf, `${c.rang} · ${c.paire}`, on, () => {
        if (on) this.rangs.delete(c.rang); else this.rangs.add(c.rang);
        this.renderControls(); this.render();
      });
    });
  },

  longRef(ref) {
    const longs = [];
    (ref || "").split(";").forEach(part => {
      const court = part.split(",")[0].trim();
      const s = Object.values(this.data.sources).find(x => x.court === court);
      const l = s ? s.long : part.trim();
      if (!longs.includes(l)) longs.push(l);
    });
    return longs.join(" · ");
  },

  refHtml(ref) {
    return `<span class="cd-ref" title="${escapeHtml(this.longRef(ref))}">${escapeHtml(ref)}</span>`;
  },

  cellHtml(c) {
    if (!c) return `<td class="cd-vide">—</td>`;
    const paras = c.texte.split("\n").filter(Boolean).map(p => `<p>${escapeHtml(p)}</p>`).join("");
    return `<td>${paras}${this.refHtml(c.ref)}</td>`;
  },

  render() {
    const d = this.data;
    if (!d) return;
    const wrap = document.getElementById("cd-wrap");
    const choisis = d.champs.filter(c => this.champs.has(c.id));
    const cols = choisis.filter(c => c.scope !== "confluence");        // une colonne par champ de canal
    const champsConf = choisis.filter(c => c.scope === "confluence");  // lignes sous le titre de la confluence
    const confs = d.confluences.filter(c => !this.rangs.size || this.rangs.has(c.rang));
    document.getElementById("cd-print-titre").textContent =
      `${d.titre} — ${choisis.map(c => c.label).join(" · ") || "aucun champ sélectionné"}`;
    if (!choisis.length || !confs.length) {
      wrap.innerHTML = `<p class="muted">${!choisis.length ? "Coche au moins un champ à afficher." : "Aucune confluence affichée."}</p>`;
      return;
    }
    const nCol = Math.max(cols.length, 1);
    const head = cols.length
      ? cols.map(c => `<th>${escapeHtml(c.label)}<br><span class="cd-ref cd-ref-head">${escapeHtml(d.sources[c.source].court)}</span></th>`).join("")
      : `<th></th>`;
    let body = "";
    confs.forEach(conf => {
      body += `<tr class="cd-section"><th colspan="${nCol + 1}">${conf.rang}${conf.rang === 1 ? "ʳᵉ" : "ᵉ"} confluence — ${escapeHtml(conf.paire)} · médium : ${escapeHtml(conf.medium)} ${this.refHtml(conf.ref_medium)}</th></tr>`;
      champsConf.forEach(c => {
        const cel = (conf.champs || {})[c.id];
        if (!cel) return;
        const paras = cel.texte.split("\n").filter(Boolean).map(p => `<p>${escapeHtml(p)}</p>`).join("");
        body += `<tr class="cd-conf"><th class="cd-canal">${escapeHtml(c.label)}</th><td colspan="${nCol}">${paras}${this.refHtml(cel.ref)}</td></tr>`;
      });
      if (!cols.length) return;
      conf.canaux.forEach(can => {
        body += `<tr data-code="${escapeHtml(can.code)}"><th class="cd-canal">${escapeHtml(can.nom)} <span class="cd-code">(${escapeHtml(can.code)})</span><br><span class="cd-pol">${escapeHtml(can.polarite)}</span></th>` +
          cols.map(c => this.cellHtml(can.champs[c.id])).join("") + `</tr>`;
      });
    });
    wrap.innerHTML = `<table class="cd-table"><thead><tr><th>Canal distinct</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
  },

  renderExtras() {
    const d = this.data;
    const gen = document.getElementById("cd-generalites");
    gen.innerHTML = `<summary>Catégories de signes et indications générales</summary>` +
      `<p>${escapeHtml(d.categories_sterman.texte)} ${this.refHtml(d.categories_sterman.ref)}</p>` +
      d.generalites.map(g => `<p><strong>${escapeHtml(g.titre)}</strong><br>${escapeHtml(g.texte)} ${this.refHtml(g.ref)}</p>`).join("");
    const cas = document.getElementById("cd-cas");
    cas.innerHTML = `<summary>Cas cliniques (${d.cas.length})</summary>` +
      `<div class="cd-table-wrap"><table class="cd-table"><thead><tr><th>Cas</th><th>Présentation clinique</th><th>Diagnostic du livre</th></tr></thead><tbody>` +
      d.cas.map(c => `<tr><th class="cd-canal">${escapeHtml(c.titre)}<br>${this.refHtml(c.ref)}</th><td><p>${escapeHtml(c.presentation)}</p></td><td><p>${escapeHtml(c.diagnostic)}</p></td></tr>`).join("") +
      `</tbody></table></div>`;
    document.getElementById("cd-limites").innerHTML = d.limites.map(l => `<li>${escapeHtml(l)}</li>`).join("");
  },

  // utilisé par la recherche globale : affiche la ligne du canal et la met en évidence
  focusRow(code) {
    if (!this.data) return;
    this.rangs.clear();
    if (!this.champs.size) this.champs = new Set(this.data.champs_par_defaut);
    this.renderControls(); this.render();
    const tr = document.querySelector(`#cd-wrap tr[data-code="${CSS.escape(code)}"]`);
    if (!tr) return;
    tr.scrollIntoView({ block: "center" });
    tr.classList.add("cd-row-flash");
    setTimeout(() => tr.classList.remove("cd-row-flash"), 2500);
  }
};
CanauxDistincts.load();

document.getElementById("pts-view-distincts").addEventListener("click", () => showPtsView("pts-view-distincts"));
document.getElementById("cd-print").addEventListener("click", () => window.print());
function cdPrintable() { return document.getElementById("pts-view-distincts-panel").style.display !== "none"; }
window.addEventListener("beforeprint", () => { if (cdPrintable()) document.body.classList.add("print-cd"); });
window.addEventListener("afterprint", () => document.body.classList.remove("print-cd"));

document.getElementById("pts-view-fiches").addEventListener("click", () => showPtsView("pts-view-fiches"));
document.getElementById("pts-view-croisements").addEventListener("click", () => {
  showPtsView("pts-view-croisements");
  if (Croisement.data) Croisement.render(Croisement.data.points);
});

/* ============================= Fiche de cas ============================= */
const CAS_STORAGE_KEY = "mtc_assistant_cas_v1";
const form = document.getElementById("cas-form");
let currentCasId = null;
let currentCasFormules = []; // [{id, pinyin}]

function loadAllCas() {
  try { return JSON.parse(localStorage.getItem(CAS_STORAGE_KEY) || "{}"); }
  catch { return {}; }
}
function saveAllCas(all) {
  localStorage.setItem(CAS_STORAGE_KEY, JSON.stringify(all));
}

function refreshCasSelect() {
  const all = loadAllCas();
  const sel = document.getElementById("cas-saved-select");
  sel.innerHTML = '<option value="">— Cas sauvegardés (cette machine) —</option>';
  Object.values(all)
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
    .forEach(c => {
      const opt = document.createElement("option");
      opt.value = c._id;
      opt.textContent = (c.identifiant || "(sans nom)") + " — " + (c.updated_at || "").slice(0, 16).replace("T", " ");
      sel.appendChild(opt);
    });
}

function formToObject() {
  const data = {};
  new FormData(form).forEach((v, k) => data[k] = v);
  data.formules_choisies = currentCasFormules;
  data._id = currentCasId;
  data.updated_at = new Date().toISOString();
  return data;
}

function objectToForm(data) {
  [...form.elements].forEach(el => {
    if (!el.name) return;
    el.value = data[el.name] || "";
  });
  currentCasFormules = data.formules_choisies || [];
  renderChosenFormules();
}

function newCas() {
  form.reset();
  currentCasId = "cas_" + Date.now();
  currentCasFormules = [];
  renderChosenFormules();
  document.getElementById("cas-saved-select").value = "";
}

function persistCurrentCas() {
  if (!currentCasId) currentCasId = "cas_" + Date.now();
  const all = loadAllCas();
  const data = formToObject();
  all[currentCasId] = data;
  saveAllCas(all);
  refreshCasSelect();
  document.getElementById("cas-saved-select").value = currentCasId;
}

form.addEventListener("input", () => persistCurrentCas());

document.getElementById("cas-new").addEventListener("click", () => newCas());

document.getElementById("cas-saved-select").addEventListener("change", (e) => {
  const id = e.target.value;
  if (!id) { newCas(); return; }
  const all = loadAllCas();
  if (all[id]) { currentCasId = id; objectToForm(all[id]); }
});

document.getElementById("cas-delete").addEventListener("click", () => {
  if (!currentCasId) return;
  const all = loadAllCas();
  delete all[currentCasId];
  saveAllCas(all);
  refreshCasSelect();
  newCas();
});

document.getElementById("cas-export").addEventListener("click", () => {
  const data = formToObject();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const safeName = (data.identifiant || "cas").replace(/[^a-z0-9_\-]+/gi, "_");
  a.download = safeName + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById("cas-import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    currentCasId = data._id || ("cas_" + Date.now());
    objectToForm(data);
    persistCurrentCas();
  } catch {
    alert("Fichier JSON invalide.");
  }
  e.target.value = "";
});

/* --- recherche de formule dans la fiche de cas --- */
document.getElementById("cas-formule-search").addEventListener("input", (e) => {
  const results = Formules.search(e.target.value).slice(0, 30);
  const ul = document.getElementById("cas-formule-results");
  ul.innerHTML = "";
  if (e.target.value.trim() && results.length === 0) {
    ul.innerHTML = `<li class="muted">Rien dans la base pour l'instant — chapitre pas encore couvert, ne pas inventer.</li>`;
    return;
  }
  results.forEach(f => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${escapeHtml(f.pinyin)}</strong> — <span class="muted">${escapeHtml(f.indications_syndrome || "")}</span>`;
    li.addEventListener("click", () => {
      if (!currentCasFormules.find(x => x.id === f.id)) {
        currentCasFormules.push({ id: f.id, pinyin: f.pinyin });
        renderChosenFormules();
        persistCurrentCas();
      }
    });
    ul.appendChild(li);
  });
});

function renderChosenFormules() {
  const el = document.getElementById("cas-formules-choisies");
  el.innerHTML = "";
  currentCasFormules.forEach(f => {
    const span = document.createElement("span");
    span.className = "chosen-item";
    span.innerHTML = `${escapeHtml(f.pinyin)} <button type="button" title="retirer">×</button>`;
    span.querySelector("button").addEventListener("click", () => {
      currentCasFormules = currentCasFormules.filter(x => x.id !== f.id);
      renderChosenFormules();
      persistCurrentCas();
    });
    el.appendChild(span);
  });
}

refreshCasSelect();
newCas();

/* ============================= Utils ============================= */
// Aplati récursivement toutes les chaînes de texte d'un objet JSON (indications, points,
// avertissements, etc.) en un seul blob minuscule, pour que la recherche globale trouve du
// contenu qui n'est pas dans le résumé léger d'un index (ex: une indication citée sur un point).
// Normalise un texte pour la recherche : minuscules, sans accents, apostrophes et espaces unifiés.
const _normMemo = new Map();
function normalizeSearch(str) {
  const s = String(str || "");
  let r = _normMemo.get(s);
  if (r === undefined) {
    r = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, " ").trim();
    if (_normMemo.size > 4000) _normMemo.clear();
    _normMemo.set(s, r);
  }
  return r;
}

function flattenDetailText(d) {
  const parts = [];
  const walk = (v) => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(d);
  return parts.join(" ").toLowerCase();
}

// Suivi léger des fiches déjà ouvertes (localStorage), pour afficher un petit point rouge sur les
// entrées jamais consultées — utile en révision pour ne pas oublier des fiches. Une fiche peut être
// remarquée manuellement comme "non-vue" pour y revenir plus tard.
const SeenTracker = {
  _key(listKey) { return "mtc_seen_" + listKey; },
  _getSet(listKey) {
    try { return new Set(JSON.parse(localStorage.getItem(this._key(listKey)) || "[]")); }
    catch (e) { return new Set(); }
  },
  isSeen(listKey, id) { return this._getSet(listKey).has(id); },
  markSeen(listKey, id) {
    const s = this._getSet(listKey);
    if (s.has(id)) return;
    s.add(id);
    try { localStorage.setItem(this._key(listKey), JSON.stringify([...s])); } catch (e) { /* quota/privé */ }
  },
  markUnseen(listKey, id) {
    const s = this._getSet(listKey);
    if (!s.has(id)) return;
    s.delete(id);
    try { localStorage.setItem(this._key(listKey), JSON.stringify([...s])); } catch (e) { /* quota/privé */ }
  }
};

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ===== Mise en forme visuelle des textes MTC denses =====
   N'altère jamais le contenu texte lui-même — uniquement le HTML généré à l'affichage.
   - formatFormuleField : champs des fiches formules (actions, modifications, comparaisons...) ->
     découpe en phrases, chaque phrase devient une puce ; un label de section en tête de phrase
     (Variation:, Composition:, Indications:...) est mis en évidence en ligne.
   - formatTcmText : texte narratif continu (descriptions Farrell) -> paragraphe simple.
   - formatArrayEntry : un élément d'un tableau JSON (ex: points_ou_structures_cles) -> si
     l'élément contient plusieurs sous-entrées "Label — clé valeur, clé valeur ; ..." séparées
     par des points-virgules, le restitue en tableau (ou sous-liste si pas de structure claire). */
const TCM_TONE_CHARS = "A-Za-zĀāÁáǍǎÀàĒēÉéĚěÈèĪīÍíǏǐÌìŌōÓóǑǒÒòŪūÚúǓǔÙùǕǖǗǘǙǚǛǜŃńŇňǸǹ";
const TCM_UPPER_CHARS = "A-ZĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙ";
const TCM_LOWER_CHARS = "a-zāáǎàēéěèīíǐìōóǒòūúǔùńň";
const TCM_SECTION_LABELS = "Variations?|Composition|Indications?|Actions?|Mode de préparation(?:\\/posologie)?|Posologie|Contre-indications?|Précautions?|Modifications?|Comparaison|Tableau clinique|Syndrome";
const TCM_FORMULA_SUFFIXES = "Tāng|Tang|Sàn|Sǎn|San|Wán|Wan|Yǐn|Yin|Jiǎn|Jian|Dān|Dan|Gāo|Gao|Fāng|Fang";
// Noms des six catégories de canaux (Jue Yin, Shao Yin... ) : à mettre en gras, jamais en couleur.
// "Jue/Shao/Tai Yin" tombent sinon dans le piège du régex de noms de formules ci-dessous (suffixe Yin = 饮).
const TCM_CHANNEL_NAMES = ["Jue Yin", "Shao Yin", "Tai Yin", "Yang Ming", "Shao Yang", "Tai Yang"];

const TCM_PERVERS = [
  { re: /\b(vents?)\b/gi, cls: "tcm-pervers-vent" },
  { re: /\b(chaleurs?)\b/gi, cls: "tcm-pervers-chaleur" },
  { re: /\b(froide?s?)\b/gi, cls: "tcm-pervers-froid" },
  { re: /\b(stases?)\b/gi, cls: "tcm-pervers-stase" },
  { re: /\b(humidités?)\b/gi, cls: "tcm-pervers-humidite" }
];

function stripHanziGloss(s) {
  return s
    .replace(/\s?[（(][^()（）]*[一-鿿][^()（）]*[)）]/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

function colorizePervers(s) {
  let out = s;
  TCM_PERVERS.forEach(({ re, cls }) => {
    out = out.replace(re, (m) => `<span class="${cls}">${m}</span>`);
  });
  return out;
}

function tcmHighlightInline(str) {
  let s = colorizePervers(stripHanziGloss(str));
  s = s.replace(
    new RegExp(`\\b([${TCM_LOWER_CHARS}]+(?:\\s[${TCM_LOWER_CHARS}]+){0,3})(\\s*\\([^()<>]{1,20}\\))?\\s+(\\d+(?:[.,]\\d+)?(?:\\s?-\\s?\\d+(?:[.,]\\d+)?)?\\s?g)\\b`, "g"),
    (m, sub, paren, dose) => `<span class="tcm-substance">${sub}</span>${paren ? `<span class="tcm-note">${paren}</span>` : ""} <span class="tcm-dose">${dose}</span>`
  );
  s = s.replace(
    new RegExp(`\\b([${TCM_UPPER_CHARS}][${TCM_TONE_CHARS}]*(?:\\s[${TCM_UPPER_CHARS}][${TCM_TONE_CHARS}]*){0,5}\\s(?:${TCM_FORMULA_SUFFIXES}))\\b(\\s*[（(][^）)<>]{1,15}[）)])?`, "g"),
    (m, name, hanzi) => {
      if (TCM_CHANNEL_NAMES.includes(name.trim())) return m;
      return `<span class="tcm-formule">${name}</span>${hanzi ? `<span class="tcm-hanzi-inline">${hanzi}</span>` : ""}`;
    }
  );
  TCM_CHANNEL_NAMES.forEach(name => {
    s = s.replace(new RegExp(`\\b${name}\\b`, "gi"), `<strong>${name}</strong>`);
  });
  s = applyLiteMarkup(s);
  return s;
}

// Petite syntaxe de mise en forme manuelle, saisie via la barre d'outils de l'éditeur de fiches :
// **gras**, *italique*, __souligné__. Volontairement minimal (pas de markdown complet).
function applyLiteMarkup(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<u>$1</u>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

// Découpe une chaîne sur un séparateur donné, sans jamais couper à l'intérieur de parenthèses.
function splitTopLevel(str, sep) {
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of str) {
    if (ch === "(" || ch === "（") depth++;
    else if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) { parts.push(cur); cur = ""; }
    else cur += ch;
  }
  parts.push(cur);
  return parts.map(s => s.trim()).filter(Boolean);
}

// Découpe en phrases sur ". " suivi d'une majuscule, sauf si le point suit un marqueur de liste
// à une seule lettre (A. B. C. ...), pour ne pas casser "A. Nom de formule..." en deux morceaux.
function tcmSplitSentences(s) {
  return s.split(new RegExp(`(?<!\\b[${TCM_UPPER_CHARS}])\\.\\s+(?=[${TCM_UPPER_CHARS}])`)).map(x => x.trim()).filter(Boolean);
}

function formatFormuleField(str) {
  if (str === null || str === undefined) return "";
  const raw = escapeHtml(String(str));
  const segments = tcmSplitSentences(raw);
  if (segments.length <= 1) {
    return `<p>${tcmHighlightInline(raw)}</p>`;
  }
  const items = segments.map(seg => {
    let text = /[.:;!?]$/.test(seg) ? seg : seg + ".";
    text = text.replace(
      new RegExp(`^(${TCM_SECTION_LABELS})\\s*:\\s*`),
      (m, label) => `<strong class="tcm-label-inline">${label} :</strong> `
    );
    return `<li>${tcmHighlightInline(text)}</li>`;
  }).join("");
  return `<ul class="tcm-list">${items}</ul>`;
}

function formatTcmText(str) {
  if (str === null || str === undefined) return "";
  // Une ligne commençant par "- " (saisie via la barre d'outils) devient une puce visuelle "• ",
  // sans casser le paragraphe unique existant (les sauts de ligne restent gérés par CSS white-space: pre-line).
  const raw = escapeHtml(String(str)).replace(/^-\s+/gm, "• ");
  return `<p>${tcmHighlightInline(raw)}</p>`;
}

function formatArrayEntry(str) {
  // Important : on découpe le texte BRUT (non échappé) avant d'appeler escapeHtml.
  // escapeHtml transforme "'" en "&#39;" et "&" en "&amp;" — ces entités contiennent elles-mêmes
  // un ";" qui, si l'échappement avait lieu avant le split, casserait le texte à tort
  // (ex: "d'expérimenter" → faux split au ";" de "d&#39;expérimenter").
  const rawText = String(str);
  const segments = splitTopLevel(rawText, ";");
  if (segments.length < 3) {
    return tcmHighlightInline(escapeHtml(rawText));
  }

  const LABEL_RE = /^(.{1,60}?)\s*[—=:]\s*(.+)$/;
  const parsed = segments.map(seg => {
    const m = seg.match(LABEL_RE);
    return m ? { label: m[1], rest: m[2] } : null;
  });

  if (!parsed.every(p => p)) {
    return `<ul class="tcm-sublist">${segments.map(s => `<li>${tcmHighlightInline(escapeHtml(s))}</li>`).join("")}</ul>`;
  }

  const KV_RE = /^([a-zà-ÿ]+)\s+(.+)$/i;
  const rows = parsed.map(p => {
    const pieces = splitTopLevel(p.rest, ",");
    const pairs = pieces.map(piece => {
      const km = piece.match(KV_RE);
      return km ? { key: km[1], value: km[2] } : null;
    });
    const clean = pairs.every(x => x) && pairs.length >= 2 ? pairs : null;
    return { label: p.label, rest: p.rest, pairs: clean };
  });

  const keySets = rows.map(r => r.pairs ? r.pairs.map(p => p.key.toLowerCase()).join("|") : "");
  const consistent = rows.every(r => r.pairs) && new Set(keySets).size === 1;

  if (consistent) {
    const keys = rows[0].pairs.map(p => p.key);
    const header = `<tr><th>Élément</th>${keys.map(k => `<th>${escapeHtml(k.charAt(0).toUpperCase() + k.slice(1))}</th>`).join("")}</tr>`;
    const body = rows.map(r => `<tr><td>${tcmHighlightInline(escapeHtml(r.label))}</td>${r.pairs.map(p => `<td>${tcmHighlightInline(escapeHtml(p.value))}</td>`).join("")}</tr>`).join("");
    return `<table class="tcm-mini-table"><thead>${header}</thead><tbody>${body}</tbody></table>`;
  }

  const header2 = `<tr><th>Élément</th><th>Détail</th></tr>`;
  const body2 = rows.map(r => `<tr><td>${tcmHighlightInline(escapeHtml(r.label))}</td><td>${tcmHighlightInline(escapeHtml(r.rest))}</td></tr>`).join("");
  return `<table class="tcm-mini-table"><thead>${header2}</thead><tbody>${body2}</tbody></table>`;
}

// Rend une liste de points/structures clés en tableau à deux colonnes (Point | Indications)
// plutôt qu'en liste à puces. Chaque entrée du tableau JSON est une chaîne "Point : indications"
// (le premier ":" sépare le point de son détail) ; à défaut de ":", la ligne entière va en indication.
function formatPointsTable(arr, headerLabel) {
  if (!arr || !arr.length) return "";
  const rows = arr.map(item => {
    const rawText = String(item);
    const idx = rawText.indexOf(":");
    if (idx < 0 || idx > 80) return { point: "", indications: rawText };
    return { point: rawText.slice(0, idx).trim(), indications: rawText.slice(idx + 1).trim() };
  });
  const header = `<tr><th>${escapeHtml(headerLabel || "Point")}</th><th>Indications</th></tr>`;
  const body = rows.map(r => `<tr><td>${tcmHighlightInline(escapeHtml(r.point))}</td><td>${tcmHighlightInline(escapeHtml(r.indications))}</td></tr>`).join("");
  return `<table class="tcm-mini-table tcm-points-table"><thead>${header}</thead><tbody>${body}</tbody></table>`;
}

/* ============================= Ajouter une formule =============================
   Génère le JSON conforme au schéma et l'écrit directement dans
   data/ via la File System Access API (Chrome/Edge), avec repli sur un simple téléchargement
   pour les navigateurs qui ne supportent pas cette API. */
function slugify(s) {
  return (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Ajoute un bouton "Modifier cette fiche" en tête d'un conteneur déjà rempli par innerHTML.
 * mode "whole" (défaut) : relPath pointe vers un fichier contenant directement l'objet `obj`.
 * mode "arrayItem" : relPath pointe vers un fichier contenant un tableau ; matchField/matchValue
 * identifient l'élément à remplacer par `obj`.
 */
function addEditControls(container, relPath, obj, opts) {
  opts = opts || {};
  const bar = document.createElement("div");
  bar.className = "edit-bar";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "edit-toggle-btn";
  btn.textContent = "✏️ Modifier cette fiche";
  bar.appendChild(btn);
  container.prepend(bar);
  const editorFn = opts.editorFn || openGenericFormEditor;
  btn.addEventListener("click", () => editorFn(container, relPath, obj, opts));
}

// Enregistre un objet de fiche modifié (JSON entier ou élément d'un tableau, selon opts.arrayItem) —
// utilisé aussi bien par l'éditeur JSON brut que par les éditeurs en formulaire.
async function saveFicheObject(relPath, opts, parsed, obj, status) {
  status.textContent = Store.mode === "github" ? "Enregistrement sur GitHub..." : "Choisis le dossier 'data' de Assistant-Diagnostic si demandé...";
  if (opts.arrayItem) {
    await Store.writeArrayItem(relPath, opts.matchField, opts.matchValue, parsed);
  } else {
    await Store.writeJSON(relPath, parsed);
  }
  Object.assign(obj, parsed);
  status.textContent = "✅ Enregistré dans " + relPath + " (" + (Store.mode === "github" ? "GitHub" : "local") + ") — déjà pris en compte dans la recherche.";
  if (typeof opts.onSaved === "function") {
    try {
      await opts.onSaved(parsed);
    } catch (syncErr) {
      status.textContent += " (⚠ index de recherche non resynchronisé : " + syncErr.message + " — recharge la page pour rattraper.)";
    }
  }
}

// Éditeur de liste réutilisable : une rangée de champs (texte simple ou {clé,libellé}[]) par élément,
// avec bouton "+ Ajouter" et une croix de suppression par rangée. Pas d'état JS séparé : les valeurs
// sont lues directement dans le DOM au moment d'enregistrer (getValues()), donc pas de risque de
// désynchronisation entre ce qui est affiché et ce qui est sauvegardé.
function buildListEditor(items, fields) {
  const wrap = document.createElement("div");
  wrap.className = "list-editor";
  const rowsWrap = document.createElement("div");
  rowsWrap.className = "list-editor-rows";
  wrap.appendChild(rowsWrap);

  function addRow(values) {
    values = values || {};
    const row = document.createElement("div");
    row.className = "list-editor-row";
    // Conserve toute clé de l'objet d'origine qui n'a pas son propre champ dans le formulaire (ex. un
    // champ de métadonnée ajouté plus tard type source_detail) — sans ça, enregistrer depuis le
    // formulaire effacerait silencieusement cette donnée au lieu de simplement ne pas l'exposer.
    if (fields.length > 1 || fields[0].key !== "_value") {
      const fieldKeys = new Set(fields.map(f => f.key));
      const hidden = {};
      Object.keys(values).forEach(k => { if (!fieldKeys.has(k) && values[k] !== undefined) hidden[k] = values[k]; });
      if (Object.keys(hidden).length) row.dataset.hidden = JSON.stringify(hidden);
    }
    fields.forEach(f => {
      const input = document.createElement(f.big ? "textarea" : "input");
      if (!f.big) input.type = "text";
      input.placeholder = f.label;
      input.dataset.key = f.key;
      input.value = values[f.key] || "";
      row.appendChild(input);
    });
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "list-editor-remove";
    rm.title = "Supprimer cette ligne";
    rm.textContent = "✕";
    rm.addEventListener("click", () => row.remove());
    row.appendChild(rm);
    rowsWrap.appendChild(row);
  }

  (items || []).forEach(item => {
    addRow(fields.length === 1 && fields[0].key === "_value" ? { _value: item } : item);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "list-editor-add";
  addBtn.textContent = "+ Ajouter";
  addBtn.addEventListener("click", () => addRow());
  wrap.appendChild(addBtn);

  function getValues() {
    const rows = Array.from(rowsWrap.querySelectorAll(".list-editor-row"));
    const out = [];
    rows.forEach(row => {
      const inputs = Array.from(row.querySelectorAll("input,textarea"));
      const obj = {};
      let anyFilled = false;
      inputs.forEach(inp => {
        const v = inp.value.trim();
        if (v) anyFilled = true;
        obj[inp.dataset.key] = v;
      });
      if (!anyFilled) return;
      if (fields.length === 1 && fields[0].key === "_value") { out.push(obj._value); return; }
      let merged = obj;
      if (row.dataset.hidden) {
        try { merged = Object.assign(JSON.parse(row.dataset.hidden), obj); } catch (e) { /* ignore, garde obj tel quel */ }
      }
      out.push(merged);
    });
    return out;
  }

  return { el: wrap, getValues };
}

// Éditeur en formulaire pour les fiches de points_canaux : plus de JSON brut à taper à la main
// (source d'erreurs fréquentes sur mobile : retour à la ligne littéral qui casse le JSON, guillemets
// mal fermés, etc.) — chaque champ est un input/textarea normal, les listes (indications, actions...)
// ont des rangées ajoutables/supprimables, et l'objet JSON n'est reconstruit qu'au moment d'enregistrer.
function openPointEditor(container, relPath, obj, opts) {
  const original = container.innerHTML;
  const wrap = document.createElement("div");
  wrap.className = "fiche-form-editor";
  wrap.innerHTML = `
    <div class="edit-bar">
      <button type="button" id="edit-save">💾 Enregistrer</button>
      <button type="button" id="edit-cancel">Annuler</button>
      <span id="edit-status" class="muted"></span>
    </div>
    <p class="muted ff-hint">Formulaire — chaque champ s'enregistre séparément, pas besoin d'écrire du JSON. <button type="button" id="ff-switch-json" class="ff-link-btn">Passer en mode JSON brut (avancé)</button></p>
  `;
  const fieldsHost = document.createElement("div");
  fieldsHost.className = "ff-fields";
  wrap.appendChild(fieldsHost);

  const textField = (key, label, value) => {
    const div = document.createElement("div");
    div.className = "ff-field";
    const lab = document.createElement("label");
    lab.textContent = label;
    div.appendChild(lab);
    const input = document.createElement("input");
    input.type = "text";
    input.dataset.key = key;
    input.value = value || "";
    div.appendChild(input);
    fieldsHost.appendChild(div);
  };
  const areaField = (key, label, value) => {
    const div = document.createElement("div");
    div.className = "ff-field";
    const lab = document.createElement("label");
    lab.textContent = label;
    div.appendChild(lab);
    const ta = document.createElement("textarea");
    ta.dataset.key = key;
    ta.value = value || "";
    div.appendChild(ta);
    fieldsHost.appendChild(div);
  };
  const listField = (label, editor) => {
    const div = document.createElement("div");
    div.className = "ff-field";
    const lab = document.createElement("label");
    lab.textContent = label;
    div.appendChild(lab);
    div.appendChild(editor.el);
    fieldsHost.appendChild(div);
  };

  textField("pinyin", "Pinyin", obj.pinyin);
  textField("hanzi", "Hanzi", obj.hanzi);
  textField("nom_fr", "Nom (français)", obj.nom_fr);
  textField("canal_indicatif", "Canal indicatif (si applicable)", obj.canal_indicatif);
  areaField("localisation", "Localisation", obj.localisation);
  areaField("methode_localisation", "Méthode de localisation", obj.methode_localisation);
  areaField("methode_travail", "Méthode de travail", obj.methode_travail);
  areaField("categories_point", "Catégories du point", obj.categories_point);

  const indicEditor = buildListEditor(obj.indications || [], [
    { key: "categorie", label: "Catégorie (ex: Cœur)" },
    { key: "indication", label: "Indication", big: true }
  ]);
  listField("Indications (classiques)", indicEditor);

  const psychoEditor = buildListEditor(obj.indications_psycho_emotionnelles || [], [
    { key: "indication", label: "Indication", big: true },
    { key: "source", label: "Source (livre / chapitre / page)" },
    { key: "auteur_lignee", label: "Auteur ou lignée" }
  ]);
  listField("Indications psycho-émotionnelles", psychoEditor);

  const contempEditor = buildListEditor(obj.indications_contemporaines || [], [{ key: "_value", label: "Indication" }]);
  listField("Indications contemporaines", contempEditor);

  const actionsEditor = buildListEditor(obj.actions || [], [{ key: "_value", label: "Action" }]);
  listField("Actions", actionsEditor);

  const assocIsArray = Array.isArray(obj.associations);
  const assocEditor = buildListEditor(assocIsArray ? obj.associations : (obj.associations ? obj.associations.split("\n") : []), [{ key: "_value", label: "Association", big: true }]);
  listField("Associations", assocEditor);

  const corrEditor = buildListEditor(obj.correspondances || [], [{ key: "_value", label: "Correspondance" }]);
  listField("Correspondances", corrEditor);

  const imgEditor = buildListEditor(obj.images || [], [{ key: "_value", label: "nom_fichier.jpg" }]);
  listField("Images (noms de fichiers)", imgEditor);

  areaField("note", "Note", obj.note);

  container.innerHTML = "";
  container.appendChild(wrap);

  document.getElementById("edit-cancel").addEventListener("click", () => { container.innerHTML = original; });
  document.getElementById("ff-switch-json").addEventListener("click", () => openJsonEditor(container, relPath, obj, opts));
  document.getElementById("edit-save").addEventListener("click", async () => {
    const status = document.getElementById("edit-status");
    const val = (key) => { const el = fieldsHost.querySelector(`[data-key="${key}"]`); return el ? el.value.trim() : ""; };
    const parsed = Object.assign({}, obj, {
      pinyin: val("pinyin") || null,
      hanzi: val("hanzi") || null,
      nom_fr: val("nom_fr") || null,
      canal_indicatif: val("canal_indicatif") || null,
      localisation: val("localisation") || null,
      methode_localisation: val("methode_localisation") || null,
      methode_travail: val("methode_travail") || null,
      categories_point: val("categories_point") || null,
      note: val("note") || null,
      indications: indicEditor.getValues(),
      indications_psycho_emotionnelles: psychoEditor.getValues(),
      indications_contemporaines: contempEditor.getValues(),
      actions: actionsEditor.getValues(),
      correspondances: corrEditor.getValues(),
      images: imgEditor.getValues(),
      associations: assocIsArray ? assocEditor.getValues() : assocEditor.getValues().join("\n")
    });
    try {
      await saveFicheObject(relPath, opts, parsed, obj, status);
    } catch (e) {
      status.textContent = "⚠ " + e.message;
    }
  });
}

// Récolte récursivement tous les chemins de clés d'un objet JSON (les tableaux ne comptent pas
// comme un niveau de clé, seuls les noms de champs comptent) — sert à détecter si un formatage a
// accidentellement modifié un NOM DE CHAMP plutôt que le contenu d'une valeur.
function jsonKeyPaths(obj, prefix, out) {
  if (Array.isArray(obj)) {
    obj.forEach(v => jsonKeyPaths(v, prefix, out));
  } else if (obj && typeof obj === "object") {
    Object.keys(obj).forEach(k => {
      out.add(prefix + "/" + k);
      jsonKeyPaths(obj[k], prefix + "/" + k, out);
    });
  }
}

// Après une action de la barre d'outils, vérifie que l'ensemble des noms de champs JSON n'a pas
// changé (ex: sélectionner "critere" et cliquer Gras transformerait la clé "critere" en clé
// "**critere**", qui devient introuvable pour l'app — la fiche perd silencieusement ce contenu).
// Si un nom de champ a changé, annule l'action et prévient l'utilisatrice plutôt que de laisser
// passer une corruption silencieuse.
function guardKeyIntegrity(textarea, beforeValue, statusEl) {
  let before, after;
  try { before = JSON.parse(beforeValue); } catch (e) { return; }
  try { after = JSON.parse(textarea.value); } catch (e) { return; }
  const beforeKeys = new Set(), afterKeys = new Set();
  jsonKeyPaths(before, "", beforeKeys);
  jsonKeyPaths(after, "", afterKeys);
  let changed = beforeKeys.size !== afterKeys.size;
  if (!changed) for (const k of beforeKeys) if (!afterKeys.has(k)) { changed = true; break; }
  if (changed) {
    textarea.value = beforeValue;
    if (statusEl) statusEl.textContent = "⚠ Annulé : ce formatage aurait modifié le nom d'un champ JSON (pas son contenu). Sélectionne uniquement le texte à l'intérieur d'une valeur, après les « : », pas le nom du champ lui-même.";
  } else if (statusEl) {
    statusEl.textContent = "";
  }
}

// Enrobe (ou déroule si déjà présent) la sélection courante du textarea avec un marqueur
// de mise en forme (**gras**, *italique*, __souligné__), utilisé par la barre d'outils.
function wrapTextareaSelection(textarea, marker, statusEl) {
  const start = textarea.selectionStart, end = textarea.selectionEnd;
  const val = textarea.value;
  const selected = val.slice(start, end);
  const already = selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2;
  const newSelected = already ? selected.slice(marker.length, selected.length - marker.length) : marker + selected + marker;
  textarea.value = val.slice(0, start) + newSelected + val.slice(end);
  guardKeyIntegrity(textarea, val, statusEl);
  textarea.focus();
  textarea.selectionStart = start;
  textarea.selectionEnd = start + newSelected.length;
}

// Préfixe chaque ligne couverte par la sélection avec "- " (puce), ou l'enlève si déjà présente.
function toggleBulletLines(textarea, statusEl) {
  const start = textarea.selectionStart, end = textarea.selectionEnd;
  const val = textarea.value;
  const lineStart = val.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = val.indexOf("\n", end - 1 >= start ? end - 1 : end);
  if (lineEnd === -1) lineEnd = val.length;
  const block = val.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const allBulleted = lines.every(l => l.startsWith("- ") || l.trim() === "");
  const newLines = lines.map(l => {
    if (l.trim() === "") return l;
    return allBulleted ? l.replace(/^-\s+/, "") : (l.startsWith("- ") ? l : "- " + l);
  });
  const newBlock = newLines.join("\n");
  textarea.value = val.slice(0, lineStart) + newBlock + val.slice(lineEnd);
  guardKeyIntegrity(textarea, val, statusEl);
  textarea.focus();
  textarea.selectionStart = lineStart;
  textarea.selectionEnd = lineStart + newBlock.length;
}

function openJsonEditor(container, relPath, obj, opts) {
  const original = container.innerHTML;
  const editorDiv = document.createElement("div");
  editorDiv.innerHTML = `
    <div class="edit-bar">
      <button type="button" id="edit-save">💾 Enregistrer</button>
      <button type="button" id="edit-cancel">Annuler</button>
      <span id="edit-status" class="muted"></span>
    </div>
    <div class="edit-toolbar">
      <button type="button" id="fmt-bold" title="Gras : **texte sélectionné**"><strong>G</strong></button>
      <button type="button" id="fmt-italic" title="Italique : *texte sélectionné*"><em>I</em></button>
      <button type="button" id="fmt-underline" title="Souligné : __texte sélectionné__"><u>S</u></button>
      <button type="button" id="fmt-list" title="Liste à puces (préfixe chaque ligne par « - »)">• Liste</button>
      <span class="muted edit-toolbar-hint">sélectionne du texte dans une valeur, puis clique</span>
    </div>
    <textarea id="edit-textarea" class="json-editor" spellcheck="false"></textarea>
  `;
  container.innerHTML = "";
  container.appendChild(editorDiv);
  document.getElementById("edit-textarea").value = JSON.stringify(obj, null, 2);
  document.getElementById("edit-cancel").addEventListener("click", () => { container.innerHTML = original; });
  document.getElementById("fmt-bold").addEventListener("click", () => wrapTextareaSelection(document.getElementById("edit-textarea"), "**", document.getElementById("edit-status")));
  document.getElementById("fmt-italic").addEventListener("click", () => wrapTextareaSelection(document.getElementById("edit-textarea"), "*", document.getElementById("edit-status")));
  document.getElementById("fmt-underline").addEventListener("click", () => wrapTextareaSelection(document.getElementById("edit-textarea"), "__", document.getElementById("edit-status")));
  document.getElementById("fmt-list").addEventListener("click", () => toggleBulletLines(document.getElementById("edit-textarea"), document.getElementById("edit-status")));
  document.getElementById("edit-save").addEventListener("click", async () => {
    const status = document.getElementById("edit-status");
    let parsed;
    try { parsed = JSON.parse(document.getElementById("edit-textarea").value); }
    catch (e) { status.textContent = "⚠ JSON invalide : " + e.message; return; }
    try {
      await saveFicheObject(relPath, opts, parsed, obj, status);
    } catch (e) {
      status.textContent = "⚠ " + e.message;
    }
  });
}

// Transforme une clé JSON (snake_case) en libellé lisible : "chapitre_ou_page" -> "Chapitre ou page".
function prettifyKey(k) {
  const s = k.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function isArrayOfPrimitives(arr) {
  return Array.isArray(arr) && arr.every(x => x === null || typeof x === "string" || typeof x === "number");
}
function isArrayOfPlainObjects(arr) {
  return Array.isArray(arr) && arr.length > 0 && arr.every(x => x && typeof x === "object" && !Array.isArray(x));
}
function unionKeysOfArray(arr) {
  const seen = new Set(), keys = [];
  arr.forEach(item => Object.keys(item).forEach(k => { if (!seen.has(k)) { seen.add(k); keys.push(k); } }));
  return keys;
}

// Éditeur en formulaire GÉNÉRIQUE : couvre n'importe quelle fiche JSON de l'outil en parcourant
// dynamiquement ses clés (au lieu d'un formulaire écrit à la main par type de fiche). Chaque clé de
// premier niveau devient un champ, selon la forme de sa valeur (texte, liste simple, liste d'objets,
// sous-objet). Comme il parcourt TOUTES les clés existantes sans en présélectionner, il ne peut pas
// silencieusement perdre un champ à l'enregistrement (contrairement à un formulaire à liste de champs
// fixe) — voir le bug qui a fait sauter source_detail sur un point avant ce correctif.
function openGenericFormEditor(container, relPath, obj, opts) {
  const original = container.innerHTML;
  const wrap = document.createElement("div");
  wrap.className = "fiche-form-editor";
  wrap.innerHTML = `
    <div class="edit-bar">
      <button type="button" id="edit-save">💾 Enregistrer</button>
      <button type="button" id="edit-cancel">Annuler</button>
      <span id="edit-status" class="muted"></span>
    </div>
    <p class="muted ff-hint">Formulaire — chaque champ s'enregistre séparément, pas besoin d'écrire du JSON. <button type="button" id="ff-switch-json" class="ff-link-btn">Passer en mode JSON brut (avancé)</button></p>
  `;
  const fieldsHost = document.createElement("div");
  fieldsHost.className = "ff-fields";
  wrap.appendChild(fieldsHost);

  const addField = (label, contentEl) => {
    const div = document.createElement("div");
    div.className = "ff-field";
    const lab = document.createElement("label");
    lab.textContent = label;
    div.appendChild(lab);
    div.appendChild(contentEl);
    fieldsHost.appendChild(div);
    return div;
  };

  const handlers = {}; // key -> () => nouvelle valeur

  Object.keys(obj).forEach(key => {
    const val = obj[key];
    const label = prettifyKey(key);

    // Liste de textes simples (ou tableau vide : on suppose le cas le plus courant, une liste de textes)
    if (Array.isArray(val) && (val.length === 0 || isArrayOfPrimitives(val))) {
      const editor = buildListEditor(val, [{ key: "_value", label: label, big: val.some(v => (v || "").length > 60) }]);
      addField(label, editor.el);
      handlers[key] = () => editor.getValues();
      return;
    }
    // Liste d'objets (ex: composition, points...) : un champ par clé rencontrée dans N'IMPORTE LEQUEL
    // des éléments (pas seulement le premier), pour ne rien perdre de la structure. Seulement si tous
    // les champs sont "plats" (texte/nombre) : buildListEditor ne sait pas rendre un sous-tableau/
    // sous-objet À L'INTÉRIEUR d'une rangée (ex. "types" d'une page transversale, où chaque type
    // contient lui-même des tableaux points/pharmacopée) — dans ce cas, repli JSON pour tout le champ
    // plutôt que de risquer de corrompre la structure en la forçant dans de simples champs texte.
    if (isArrayOfPlainObjects(val)) {
      const allShallow = val.every(item => Object.values(item).every(v => v === null || typeof v !== "object"));
      if (allShallow) {
        const subKeys = unionKeysOfArray(val);
        const fields = subKeys.map(k => ({
          key: k, label: prettifyKey(k),
          big: val.some(item => typeof item[k] === "string" && item[k].length > 60)
        }));
        const editor = buildListEditor(val, fields);
        addField(label, editor.el);
        handlers[key] = () => editor.getValues();
        return;
      }
      const ta = document.createElement("textarea");
      ta.value = JSON.stringify(val, null, 2);
      ta.rows = 14;
      addField(label + " (structure imbriquée — JSON)", ta);
      handlers[key] = () => { try { return JSON.parse(ta.value); } catch (e) { return val; } };
      return;
    }
    // Sous-objet simple (ex: source: {livre, chapitre_ou_page}) : un champ texte par sous-clé.
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const subDiv = document.createElement("div");
      subDiv.className = "ff-subobject";
      const subHandlers = {};
      Object.keys(val).forEach(subKey => {
        const subVal = val[subKey];
        const subFieldWrap = document.createElement("div");
        subFieldWrap.className = "ff-subfield";
        const subLab = document.createElement("label");
        subLab.textContent = prettifyKey(subKey);
        subFieldWrap.appendChild(subLab);
        if (subVal !== null && typeof subVal === "object") {
          // Structure trop profonde pour un rendu générique simple : repli JSON scopé à ce seul champ.
          const ta = document.createElement("textarea");
          ta.value = JSON.stringify(subVal, null, 2);
          subFieldWrap.appendChild(ta);
          subHandlers[subKey] = () => { try { return JSON.parse(ta.value); } catch (e) { return subVal; } };
        } else {
          const isLong = typeof subVal === "string" && (subVal.length > 60 || subVal.includes("\n"));
          const input = document.createElement(isLong ? "textarea" : "input");
          if (!isLong) input.type = "text";
          input.value = subVal === null || subVal === undefined ? "" : subVal;
          subFieldWrap.appendChild(input);
          subHandlers[subKey] = () => { const v = input.value.trim(); return v === "" ? null : v; };
        }
        subDiv.appendChild(subFieldWrap);
      });
      addField(label, subDiv);
      handlers[key] = () => { const o = {}; Object.keys(subHandlers).forEach(sk => o[sk] = subHandlers[sk]()); return o; };
      return;
    }
    // Valeur simple : texte, nombre, booléen ou null.
    const isLong = typeof val === "string" && (val.length > 80 || val.includes("\n"));
    const input = document.createElement(isLong ? "textarea" : "input");
    if (!isLong) input.type = "text";
    input.value = val === null || val === undefined ? "" : val;
    addField(label, input);
    handlers[key] = () => { const v = input.value.trim(); return v === "" ? null : v; };
  });

  container.innerHTML = "";
  container.appendChild(wrap);

  document.getElementById("edit-cancel").addEventListener("click", () => { container.innerHTML = original; });
  document.getElementById("ff-switch-json").addEventListener("click", () => openJsonEditor(container, relPath, obj, opts));
  document.getElementById("edit-save").addEventListener("click", async () => {
    const status = document.getElementById("edit-status");
    const parsed = {};
    Object.keys(handlers).forEach(k => { parsed[k] = handlers[k](); });
    try {
      await saveFicheObject(relPath, opts, parsed, obj, status);
    } catch (e) {
      status.textContent = "⚠ " + e.message;
    }
  });
}

const Ajout = {
  compositionEditor: null,

  initCompositionEditor(items) {
    const host = document.getElementById("aj-composition-editor");
    if (!host) return;
    host.innerHTML = "";
    this.compositionEditor = buildListEditor(items || [{}], [
      { key: "substance_pinyin", label: "Substance (pinyin)" },
      { key: "hanzi", label: "Hanzi" },
      { key: "dose", label: "Dose" },
      { key: "role_hierarchique", label: "Rôle (jun/chen/zuo/shi)" }
    ]);
    host.appendChild(this.compositionEditor.el);
  },

  populateCategories() {
    const sel = document.getElementById("aj-categorie-existante");
    if (!sel) return;
    const seen = new Map();
    (Formules.index || []).forEach(f => seen.set(f.categorie_id, f.categorie_nom));
    seen.forEach((nom, id) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = nom;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", () => {
      if (!sel.value) return;
      document.getElementById("aj-categorie-id").value = sel.value;
      document.getElementById("aj-categorie-nom").value = seen.get(sel.value) || "";
    });
  },

  buildObject() {
    const v = (elId) => { const el = document.getElementById(elId); const val = el ? el.value.trim() : ""; return val || null; };
    const pinyin = v("aj-pinyin") || "";
    const aVerifierRaw = v("aj-a-verifier");
    return {
      id: slugify(pinyin),
      pinyin,
      hanzi: v("aj-hanzi"),
      nom_fr: v("aj-nom-fr"),
      categorie_id: (document.getElementById("aj-categorie-id").value || "").trim(),
      categorie_nom: (document.getElementById("aj-categorie-nom").value || "").trim(),
      sous_type: v("aj-sous-type"),
      composition: this.compositionEditor ? this.compositionEditor.getValues() : [],
      mode_de_preparation_posologie: v("aj-preparation"),
      actions_therapeutiques: v("aj-actions"),
      indications_syndrome: v("aj-indications"),
      tableau_clinique: v("aj-tableau"),
      contre_indications_precautions: v("aj-contre"),
      modifications_courantes: v("aj-modifications"),
      comparaison_formules_proches: v("aj-comparaison"),
      source: { fichier: v("aj-source") },
      a_verifier: aVerifierRaw ? aVerifierRaw.split("\n").map(s => s.trim()).filter(Boolean) : []
    };
  },

  validate(obj) {
    if (!obj.pinyin) return "Le champ Pinyin est obligatoire.";
    if (!obj.categorie_id) return "L'ID de catégorie est obligatoire.";
    if (!obj.categorie_nom) return "Le nom de catégorie est obligatoire.";
    return null;
  },

  async saveToFS(obj) {
    if (Store.mode === "local" && !window.showDirectoryPicker) {
      throw new Error("Ton navigateur ne supporte pas cette fonction (utilise Chrome ou Edge) — essaie le téléchargement à la place.");
    }
    const relFile = "formules/" + obj.categorie_id + "/" + obj.id + ".json";
    await Store.writeJSON(relFile, obj);

    let indexArr = [];
    try { indexArr = await Store.readJSON("formules/index.json"); } catch (e) { /* pas encore d'index.json existant */ }
    const entry = {
      id: obj.id, pinyin: obj.pinyin, nom_fr: obj.nom_fr,
      categorie_id: obj.categorie_id, categorie_nom: obj.categorie_nom,
      indications_syndrome: obj.indications_syndrome,
      chemin: obj.categorie_id + "/" + obj.id + ".json"
    };
    const i = indexArr.findIndex(e => e.id === obj.id);
    if (i >= 0) indexArr[i] = entry; else indexArr.push(entry);
    await Store.writeJSON("formules/index.json", indexArr);
    return entry;
  },

  download(obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = obj.id + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
};

document.getElementById("aj-save-fs").addEventListener("click", async () => {
  const status = document.getElementById("aj-status");
  const obj = Ajout.buildObject();
  const err = Ajout.validate(obj);
  if (err) { status.textContent = "⚠ " + err; return; }
  try {
    status.textContent = Store.mode === "github" ? "Enregistrement sur GitHub..." : "Choisis le dossier 'data' de Assistant-Diagnostic dans la fenêtre qui s'ouvre...";
    const entry = await Ajout.saveToFS(obj);
    const i = Formules.index.findIndex(e => e.id === entry.id);
    if (i >= 0) Formules.index[i] = entry; else Formules.index.push(entry);
    Formules.renderCategories();
    Formules.applyFilters();
    status.textContent = `✅ Enregistré (${Store.mode === "github" ? "GitHub" : "local"}) : formules/${obj.categorie_id}/${obj.id}.json — déjà recherchable, y compris dans la recherche globale.`;
  } catch (e) {
    status.textContent = "⚠ " + e.message;
  }
});

document.getElementById("aj-download").addEventListener("click", () => {
  const obj = Ajout.buildObject();
  const err = Ajout.validate(obj);
  const status = document.getElementById("aj-status");
  if (err) { status.textContent = "⚠ " + err; return; }
  Ajout.download(obj);
  status.textContent = `Téléchargé : ${obj.id}.json — à déposer dans data/formules/${obj.categorie_id}/, puis ajoute une ligne dans data/formules/index.json (voir README).`;
});

document.getElementById("aj-reset").addEventListener("click", () => {
  document.getElementById("ajout-form").reset();
  Ajout.initCompositionEditor();
  document.getElementById("aj-status").textContent = "";
});
Ajout.initCompositionEditor();

/* ============================= Recherche globale ============================= */
const GlobalSearch = {
  input: null,
  results: null,

  init() {
    this.input = document.getElementById("global-search");
    this.results = document.getElementById("global-search-results");
    this.input.addEventListener("input", () => this.runSearch());
    this.input.addEventListener("focus", () => { if (this.input.value.trim()) this.runSearch(); });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".global-search-wrap")) this.close();
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { this.close(); this.input.blur(); }
    });
  },

  close() {
    this.results.classList.remove("open");
  },

  gotoTab(tab) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (btn) btn.click();
  },

  collect(query) {
    const q = normalizeSearch(query);
    if (!q) return [];
    const out = [];

    (Formules.index || []).forEach(f => {
      const hay = [f.pinyin, f.nom_fr, f.indications_syndrome, f.categorie_nom].filter(Boolean).join(" ");
      if (normalizeSearch(hay).includes(q)) out.push({
        group: "Formules", title: f.pinyin || f.id, sub: f.indications_syndrome || f.categorie_nom || "",
        go: () => { this.gotoTab("formules"); Formules.showDetail(f); }
      });
    });

    (Psy.entries || []).forEach(e => {
      const hay = [e.nom, e.categorie_source, e.resume_court, e._searchText].filter(Boolean).join(" ");
      if (normalizeSearch(hay).includes(q)) out.push({
        group: "Principes Taoïstes", title: e.nom, sub: e.kind === "niveau" ? "Farrell — Niveau de latence" : e.kind === "vaisseau" ? "Farrell — Vaisseau / confluence" : e.kind === "yuen" ? "Jeffrey Yuen — " + (e.categorie_source || "") : "Sterman — " + (e.categorie_source || ""),
        go: () => { this.gotoTab("psy"); Psy.showDetail(e); }
      });
    });

    (Syndromes.entries || []).forEach(e => {
      const hay = [e.nom, e.sousLabel, e._searchText].filter(Boolean).join(" ");
      if (normalizeSearch(hay).includes(q)) out.push({
        group: "Syndromes", title: e.nom, sub: (Syndromes.domaineLabels[e.domaine] || "") + (e.sousLabel ? " · " + e.sousLabel : ""),
        go: () => { this.gotoTab("syndromes"); Syndromes.showDetail(e); }
      });
    });

    (CasPratique.cas || []).forEach(c => {
      const hay = [c.titre_original, c.resume_court, c._searchText].filter(Boolean).join(" ");
      if (normalizeSearch(hay).includes(q)) out.push({
        group: "Exemples de cas cliniques", title: c.titre_original || c.id, sub: CasPratique.sources[c.source_id] || "",
        go: () => { this.gotoTab("cas-pratique"); CasPratique.showDetail(c); }
      });
    });

    (Points.entries || []).forEach(e => {
      const hay = [e.id, e.data.pinyin, e.data.nom_fr, e._searchText].filter(Boolean).join(" ");
      if (normalizeSearch(hay).includes(q)) out.push({
        group: "Points", title: e.id + (e.data.pinyin ? " — " + e.data.pinyin : ""), sub: e.canalNom,
        go: () => {
          this.gotoTab("points");
          const fichesBtn = document.getElementById("pts-view-fiches");
          if (fichesBtn) fichesBtn.click();
          Points.showDetail(e);
        }
      });
    });

    ((window.TdahData && window.TdahData.types) || []).forEach(t => {
      const hay = [t.nom, t.mecanisme, t.approche, ...(t.signes_cles || [])].filter(Boolean).join(" ");
      if (normalizeSearch(hay).includes(q)) out.push({
        group: "TDAH", title: t.nom, sub: t.approche || "",
        go: () => {
          this.gotoTab("tableaux-psy");
          document.querySelector('#tableaux-psy-switch .cat-chip[data-subtab="tdah"]').click();
          setTimeout(() => {
            const el = document.getElementById("psy-tdah-" + (t.id || slugify(t.nom)));
            if (el) { el.open = true; el.scrollIntoView({ behavior: "auto", block: "start" }); }
          }, 50);
        }
      });
    });

    const PSY_THEME_LABELS = { depression: "Dépression", anxiete: "Anxiété", insomnie: "Insomnie" };
    ((window.DepressionAnxieteInsomnieData && window.DepressionAnxieteInsomnieData.types) || []).forEach(t => {
      const hay = [t.nom, t.mecanisme, t.approche, ...(t.signes_cles || [])].filter(Boolean).join(" ");
      if (!normalizeSearch(hay).includes(q)) return;
      (t.themes || []).forEach(theme => {
        out.push({
          group: PSY_THEME_LABELS[theme] || theme, title: t.nom, sub: t.approche || "",
          go: () => {
            this.gotoTab("tableaux-psy");
            document.querySelector('#tableaux-psy-switch .cat-chip[data-subtab="' + theme + '"]').click();
            setTimeout(() => {
              const el = document.getElementById("psy-" + theme + "-" + (t.id || slugify(t.nom)));
              if (el) { el.open = true; el.scrollIntoView({ behavior: "auto", block: "start" }); }
            }, 50);
          }
        });
      });
    });

    ((Croisement.data && Croisement.data.points) || []).forEach(p => {
      const hay = [p.point, p.canal_principal, ...(p.canaux_recoupes || []).map(c => c.canal + " " + c.nom),
        ...(p.vaisseaux_extraordinaires_recoupes || []).map(v => v.vaisseau)].filter(Boolean).join(" ");
      if (normalizeSearch(hay).includes(q)) out.push({
        group: "Croisements de canaux", title: p.point,
        sub: [...(p.canaux_recoupes || []).map(c => c.canal), ...(p.vaisseaux_extraordinaires_recoupes || []).map(v => v.vaisseau)].join(", "),
        go: () => {
          this.gotoTab("points");
          const croiseBtn = document.getElementById("pts-view-croisements");
          if (croiseBtn) croiseBtn.click();
          setTimeout(() => { document.getElementById("croise-search").value = p.point; document.getElementById("croise-search").dispatchEvent(new Event("input")); }, 50);
        }
      });
    });

    ((CanauxDistincts.data && CanauxDistincts.data.confluences) || []).forEach(conf => conf.canaux.forEach(can => {
      const hay = [can.nom, can.code, ...Object.values(can.champs).filter(Boolean).map(x => x.texte),
        ...Object.values(conf.champs || {}).filter(Boolean).map(x => x.texte)].join(" ");
      if (normalizeSearch(hay).includes(q)) out.push({
        group: "Canaux distincts", title: `${can.nom} (${can.code}) — ${conf.rang}${conf.rang === 1 ? "ʳᵉ" : "ᵉ"} confluence`, sub: "Tableaux pathologiques · " + conf.paire,
        go: () => {
          this.gotoTab("points");
          document.getElementById("pts-view-distincts").click();
          setTimeout(() => CanauxDistincts.focusRow(can.code), 50);
        }
      });
    }));

    return out.slice(0, 80);
  },

  runSearch() {
    this.render(this.collect(this.input.value));
  },

  render(items) {
    if (!items.length) {
      const q = this.input.value.trim();
      this.results.innerHTML = q ? `<p class="gsr-empty">Aucun résultat pour « ${escapeHtml(q)} ».</p>` : "";
      this.results.classList.toggle("open", !!q);
      return;
    }
    const groups = new Map();
    items.forEach(it => {
      if (!groups.has(it.group)) groups.set(it.group, []);
      groups.get(it.group).push(it);
    });
    const qBrut = this.input.value;          // mot cherché, surligné dans les titres et sous-titres
    let html = "";
    let flat = [];
    groups.forEach((list, group) => {
      html += `<div class="gsr-group-label">${escapeHtml(group)} (${list.length})</div><ul>`;
      list.forEach(it => {
        html += `<li><span class="gsr-title">${dsMarque(it.title, qBrut)}</span>${it.sub ? `<span class="gsr-sub">${dsMarque(it.sub, qBrut)}</span>` : ""}</li>`;
      });
      html += `</ul>`;
      flat = flat.concat(list);
    });
    this.results.innerHTML = html;
    this.results.classList.add("open");
    Array.from(this.results.querySelectorAll("li")).forEach((li, i) => {
      li.addEventListener("click", () => {
        flat[i].go();
        this.close();
        this.input.value = "";
      });
    });
  }
};
GlobalSearch.init();

/* ============================= Paramètres de synchronisation ============================= */
const SyncSettings = {
  open() {
    document.getElementById("sync-settings-panel").style.display = "block";
    const radio = document.getElementById(Store.mode === "github" ? "sync-mode-github" : "sync-mode-local");
    radio.checked = true;
    document.getElementById("sync-github-fields").style.display = Store.mode === "github" ? "flex" : "none";
    document.getElementById("sync-gh-owner").value = Store.gh.owner || "";
    document.getElementById("sync-gh-repo").value = Store.gh.repo || "";
    document.getElementById("sync-gh-branch").value = Store.gh.branch || "main";
    document.getElementById("sync-gh-token").value = Store.gh.token || "";
    document.getElementById("sync-status").textContent = "Mode actuel : " + (Store.mode === "github" ? "GitHub (" + Store.gh.owner + "/" + Store.gh.repo + ")" : "dossier local");
  },
  close() {
    document.getElementById("sync-settings-panel").style.display = "none";
  }
};

document.getElementById("sync-settings-btn").addEventListener("click", () => SyncSettings.open());
document.getElementById("sync-close-btn").addEventListener("click", () => SyncSettings.close());
document.querySelectorAll('input[name="sync-mode"]').forEach(r => {
  r.addEventListener("change", () => {
    document.getElementById("sync-github-fields").style.display = r.value === "github" && r.checked ? "flex" : "none";
  });
});

document.getElementById("sync-test-btn").addEventListener("click", async () => {
  const status = document.getElementById("sync-status");
  const owner = document.getElementById("sync-gh-owner").value.trim();
  const repo = document.getElementById("sync-gh-repo").value.trim();
  const branch = document.getElementById("sync-gh-branch").value.trim() || "main";
  const token = document.getElementById("sync-gh-token").value.trim();
  if (!owner || !repo || !token) { status.textContent = "⚠ Renseigne au minimum le propriétaire, le dépôt et le token."; return; }
  status.textContent = "Test en cours...";
  const prevMode = Store.mode, prevGh = Store.gh;
  Store.mode = "github";
  Store.gh = { owner, repo, branch, token };
  Store._shaCache.clear();
  try {
    await Store.testConnection();
    status.textContent = "✅ Connexion réussie — formules/index.json lu avec succès depuis " + owner + "/" + repo + ".";
  } catch (e) {
    status.textContent = "⚠ Échec : " + e.message;
    Store.mode = prevMode;
    Store.gh = prevGh;
  }
});

document.getElementById("sync-save-btn").addEventListener("click", () => {
  const status = document.getElementById("sync-status");
  const mode = document.querySelector('input[name="sync-mode"]:checked').value;
  if (mode === "local") {
    Store.useLocal();
    status.textContent = "✅ Mode local activé. Recharge la page pour repartir avec le dossier local.";
    return;
  }
  const owner = document.getElementById("sync-gh-owner").value.trim();
  const repo = document.getElementById("sync-gh-repo").value.trim();
  const branch = document.getElementById("sync-gh-branch").value.trim() || "main";
  const token = document.getElementById("sync-gh-token").value.trim();
  if (!owner || !repo || !token) { status.textContent = "⚠ Renseigne au minimum le propriétaire, le dépôt et le token."; return; }
  Store.useGithub(owner, repo, branch, token);
  status.textContent = "✅ Mode GitHub activé (" + owner + "/" + repo + "). Recharge la page pour charger les données depuis ce dépôt.";
});

if (Store._needsTokenPrompt) {
  SyncSettings.open();
  document.getElementById("sync-status").textContent = "Cette copie hébergée n'a pas d'accès disque local : colle ton token GitHub (permission Contents) pour charger tes données, puis « Enregistrer ».";
}

/* ============================= Aide « ? » : les textes d'explication sont masqués derrière un bouton ============================= */
/* Tout élément portant l'attribut data-aide (présent dans la page ou ajouté plus tard) est caché ;
   un petit bouton « ? » placé juste avant le montre / le cache. */
const Aide = {
  scan(racine) {
    if (!racine || racine.nodeType !== 1) return;
    const cibles = racine.matches && racine.matches("[data-aide]:not([data-aide-ok])") ? [racine] : [];
    racine.querySelectorAll("[data-aide]:not([data-aide-ok])").forEach(e => cibles.push(e));
    cibles.forEach(e => this.brancher(e));
  },
  brancher(texte) {
    if (!texte.parentNode) return;          // élément déjà retiré de la page (contenu réécrit entre-temps)
    texte.setAttribute("data-aide-ok", "1");
    texte.hidden = true;
    texte.classList.add("aide-texte");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "aide-btn";
    b.textContent = "?";
    b.title = "Afficher l'aide";
    b.setAttribute("aria-label", "Afficher l'aide");
    b.setAttribute("aria-expanded", "false");
    b.addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation();
      const ouvert = texte.hidden;
      texte.hidden = !ouvert;
      b.classList.toggle("on", ouvert);
      b.setAttribute("aria-expanded", String(ouvert));
      b.title = ouvert ? "Masquer l'aide" : "Afficher l'aide";
      b.setAttribute("aria-label", b.title);
    });
    texte.parentNode.insertBefore(b, texte);
  },
  init() {
    this.scan(document.body);
    new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => this.scan(n))))
      .observe(document.body, { childList: true, subtree: true });
  },
};
Aide.init();

/* ============================= PWA (installation Android + hors-ligne) ============================= */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* pas de contexte sécurisé (http non-localhost) — dégrade silencieusement */ });
  });
}
