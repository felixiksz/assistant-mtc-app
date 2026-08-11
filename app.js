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
        }
      });
    } catch (e) {
      detail.innerHTML = `<p class="muted">Impossible de charger la fiche (${e.message}).</p>`;
    }
  },

  renderFormule(f) {
    const comp = (f.composition || []).map(c =>
      `<tr><td>${escapeHtml(c.substance_pinyin || "")}</td><td>${escapeHtml(c.hanzi || "")}</td><td>${escapeHtml(c.dose || "")}</td><td>${escapeHtml(c.role_hierarchique || "")}</td></tr>`
    ).join("");
    const verif = (f.a_verifier && f.a_verifier.length)
      ? `<section><h3>À vérifier contre la source</h3>${f.a_verifier.map(v => `<span class="tag-verifier">⚠ ${escapeHtml(v)}</span>`).join("")}</section>`
      : "";
    const section = (title, content) => content ? `<section><h3>${title}</h3><div class="tcm-text">${formatFormuleField(content)}</div></section>` : "";
    return `
      <h2>${escapeHtml(f.pinyin || f.id)} <span class="hanzi">${escapeHtml(f.hanzi || "")}</span></h2>
      <p class="muted">${escapeHtml(f.categorie_nom || "")}${f.sous_type ? " · " + escapeHtml(f.sous_type) : ""}</p>
      ${f.nom_fr ? `<p><em>${escapeHtml(f.nom_fr)}</em></p>` : ""}
      ${comp ? `<section><h3>Composition</h3><table><thead><tr><th>Substance</th><th>Hanzi</th><th>Dose</th><th>Rôle</th></tr></thead><tbody>${comp}</tbody></table></section>` : ""}
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

/* ============================= Réf. Psy (Farrell) ============================= */
const Psy = {
  entries: [], // {id, kind: "niveau"|"vaisseau", nom, chemin}
  activeKind: null,
  rawIndex: null,

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
    this.renderGroups();
    this.renderList(this.entries);
  },

  renderGroups() {
    const el = document.getElementById("psy-groups");
    el.innerHTML = "";
    const mk = (label, kind) => {
      const chip = document.createElement("button");
      chip.className = "cat-chip" + (this.activeKind === kind ? " active" : "");
      chip.textContent = label;
      chip.addEventListener("click", () => { this.activeKind = kind; this.renderGroups(); this.applyFilters(); });
      return chip;
    };
    el.appendChild(mk("Tous (" + this.entries.length + ")", null));
    el.appendChild(mk("Farrell — Niveaux de latence (" + this.entries.filter(e => e.kind === "niveau").length + ")", "niveau"));
    el.appendChild(mk("Farrell — Vaisseaux / Confluences (" + this.entries.filter(e => e.kind === "vaisseau").length + ")", "vaisseau"));
    const stermanCount = this.entries.filter(e => e.kind === "sterman").length;
    if (stermanCount) el.appendChild(mk("Sterman — Principes cliniques (" + stermanCount + ")", "sterman"));
    if (this.activeKind === null) el.firstChild.classList.add("active");
  },

  applyFilters() {
    document.getElementById("psy-search").dispatchEvent(new Event("input"));
  },

  search(query) {
    let pool = this.entries;
    if (this.activeKind) pool = pool.filter(e => e.kind === this.activeKind);
    const q = (query || "").trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(e => (e.nom || "").toLowerCase().includes(q) || (e.categorie_source || "").toLowerCase().includes(q) || (e.resume_court || "").toLowerCase().includes(q));
  },

  renderList(list) {
    const ul = document.getElementById("psy-list");
    ul.innerHTML = "";
    list.forEach(e => {
      const li = document.createElement("li");
      const kindLabel = e.kind === "niveau" ? "Farrell — Niveau de latence" : e.kind === "vaisseau" ? "Farrell — Vaisseau / confluence" : "Sterman — " + (e.categorie_source || "Principe clinique");
      li.innerHTML = `<span class="fl-pinyin">${escapeHtml(e.nom)}</span>
        <span class="fl-syndrome">${escapeHtml(kindLabel)}</span>`;
      li.addEventListener("click", () => this.showDetail(e, li));
      ul.appendChild(li);
    });
    document.getElementById("psy-count").textContent = list.length + " entrée(s)";
  },

  async showDetail(entry, liEl) {
    document.querySelectorAll("#psy-list li").forEach(li => li.classList.remove("selected"));
    if (liEl) liEl.classList.add("selected");
    const detail = document.getElementById("psy-detail");
    detail.innerHTML = "<p class='muted'>Chargement...</p>";
    try {
      const d = await Store.readJSON("psycho_emotionnel/" + entry.chemin);
      detail.innerHTML = entry.kind === "niveau" ? this.renderNiveau(d) : entry.kind === "vaisseau" ? this.renderVaisseau(d) : this.renderSterman(d);
      addEditControls(detail, "psycho_emotionnel/" + entry.chemin, d, {
        onSaved: async (parsed) => {
          if (entry.kind === "sterman") {
            const arr = (this.stermanRawIndex && this.stermanRawIndex.principes) || [];
            const i = arr.findIndex(x => x.id === entry.id);
            const summary = { id: parsed.id || entry.id, nom: parsed.nom, categorie_source: parsed.categorie_source, resume_court: parsed.resume_court, chemin: entry.chemin.replace(/^sterman_principes\//, "") };
            if (i >= 0) Object.assign(arr[i], summary); else arr.push(summary);
            await Store.writeJSON("psycho_emotionnel/sterman_principes/index.json", this.stermanRawIndex);
            const eIdx = this.entries.findIndex(e => e.id === entry.id && e.kind === "sterman");
            if (eIdx >= 0) Object.assign(this.entries[eIdx], summary);
            this.renderGroups();
            this.applyFilters();
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
        }
      });
    } catch (e) {
      detail.innerHTML = `<p class="muted">Impossible de charger la fiche (${e.message}).</p>`;
    }
  },

  renderNiveau(d) {
    const list = (arr) => arr && arr.length ? `<ul class="tcm-list">${arr.map(x => `<li>${formatArrayEntry(x)}</li>`).join("")}</ul>` : "";
    const dec = d.decision_liberer_vs_maintenir || {};
    const verif = (d.a_verifier && d.a_verifier.length)
      ? `<section><h3>À vérifier contre la source</h3>${d.a_verifier.map(v => `<span class="tag-verifier">⚠ ${escapeHtml(v)}</span>`).join("")}</section>`
      : "";
    return `
      <h2>${escapeHtml(d.nom)}</h2>
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
      ${d.points_ou_structures_cles ? `<section><h3>Points / structures clés</h3>${list(d.points_ou_structures_cles)}</section>` : ""}
      ${d.avertissements_precautions ? `<section><h3>Avertissements / précautions</h3><div class="tcm-text">${formatTcmText(d.avertissements_precautions)}</div></section>` : ""}
      ${verif}
      <p class="muted">Source : ${escapeHtml((d.source && d.source.livre) || "?")}${d.source && d.source.chapitre_ou_section ? " — " + escapeHtml(d.source.chapitre_ou_section) : ""}</p>
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
      <h2>${escapeHtml(d.nom)}</h2>
      ${d.signature_emotionnelle ? `<section><h3>Signature émotionnelle</h3><div class="tcm-text">${formatTcmText(d.signature_emotionnelle)}</div></section>` : ""}
      ${d.pathologies_indications ? `<section><h3>Pathologies / indications</h3>${list(d.pathologies_indications)}</section>` : ""}
      ${d.points_cles ? `<section><h3>Points clés</h3>${list(d.points_cles)}</section>` : ""}
      ${citations}
      ${verif}
      <p class="muted">Source : ${escapeHtml((d.source && d.source.livre) || "?")}${d.source && d.source.chapitre_ou_section ? " — " + escapeHtml(d.source.chapitre_ou_section) : ""}</p>
    `;
  },

  renderSterman(d) {
    const list = (arr) => arr && arr.length ? `<ul class="tcm-list">${arr.map(x => `<li>${formatArrayEntry(x)}</li>`).join("")}</ul>` : "";
    const verif = (d.a_verifier && d.a_verifier.length)
      ? `<section><h3>À vérifier contre la source</h3>${d.a_verifier.map(v => `<span class="tag-verifier">⚠ ${escapeHtml(v)}</span>`).join("")}</section>`
      : "";
    return `
      <h2>${escapeHtml(d.nom)}</h2>
      <p class="muted">${escapeHtml(d.categorie_source || "")} · Ann Cecil-Sterman (même lignée que Farrell — élèves de Dr Jeffrey Yuen)</p>
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
      ${d.points_ou_structures_cles ? `<section><h3>Points / structures clés</h3>${list(d.points_ou_structures_cles)}</section>` : ""}
      ${d.avertissements_precautions ? `<section><h3>Avertissements / précautions</h3><div class="tcm-text">${formatTcmText(d.avertissements_precautions)}</div></section>` : ""}
      ${verif}
      <p class="muted">Source : ${escapeHtml((d.source && d.source.livre) || "?")}${d.source && d.source.chapitre_ou_page ? " — " + escapeHtml(d.source.chapitre_ou_page) : ""}</p>
    `;
  }
};

document.getElementById("psy-search").addEventListener("input", (e) => Psy.renderList(Psy.search(e.target.value)));
Psy.load();

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
    if (m) {
      aliases.push(m[1].trim());
      (m[2] || "").split(/[,/]/).forEach(a => {
        const t = a.replace(/^alias\s*:\s*/i, "").trim();
        if (t) aliases.push(t);
      });
    } else {
      aliases.push(nom.trim());
    }
    return [...new Set(aliases.filter(Boolean))].sort((a, b) => b.length - a.length);
  },

  mask(text, entry) {
    let out = text;
    const placeholder = entry.kind === "niveau" ? "[ce niveau]" : "[ce vaisseau/cette confluence]";
    this.aliasesFor(entry).forEach(alias => {
      if (alias.length < 3) return;
      const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(esc, "gi"), placeholder);
    });
    return out;
  },

  pickSnippet(entry) {
    const d = entry.detail;
    const candidates = [d.signature_emotionnelle, d.description_generale].filter(Boolean);
    if (!candidates.length) return null;
    const text = candidates[Math.floor(Math.random() * candidates.length)];
    const sentences = text.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
    return this.mask(sentences, entry);
  },

  buildIdentifyQuestion() {
    const candidates = this.pool.filter(e => e.detail.signature_emotionnelle || e.detail.description_generale);
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
    return {
      type: "identify",
      prompt: `Quel niveau de latence / vaisseau / confluence correspond à cette description ?\n\n« ${snippet} »`,
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

  async nextQuestion() {
    const quizEl = document.getElementById("tut-quiz");
    quizEl.innerHTML = `<p class="muted">Chargement...</p>`;
    await this.ensureLoaded();
    if (!this.pool.length) { quizEl.innerHTML = `<p class="muted">Base Réf. Psy pas encore prête.</p>`; return; }
    let q = Math.random() < 0.55 ? this.buildIdentifyQuestion() : this.buildMaintenirLibererQuestion();
    if (!q) q = this.buildIdentifyQuestion() || this.buildMaintenirLibererQuestion();
    if (!q) { quizEl.innerHTML = `<p class="muted">Pas assez de contenu vérifié pour générer une question.</p>`; return; }
    this.history.push(q);
    this.historyIndex = this.history.length - 1;
    this.current = q;
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
    }
    fb.innerHTML = `<p class="${q.wasCorrect ? "tut-feedback-ok" : "tut-feedback-ko"}">${q.wasCorrect ? "✅ Correct !" : "❌ Pas la bonne réponse."}</p>${extra}`;
  }
};

document.getElementById("tut-next").addEventListener("click", () => Tuteur.nextQuestion());

/* ============================= Syndromes ============================= */
const Syndromes = {
  entries: [], // {id, domaine, nom, sousLabel, chemin}
  activeDomaine: null,
  domaineLabels: { organes: "Organes", externes: "Externes", qi_sang_liquides: "Qi / Sang / Liquides" },
  rawIndexByDomaine: {},

  async loadDomaine(domaine, relPath) {
    try {
      const arr = await Store.readJSON(relPath);
      this.rawIndexByDomaine[domaine] = arr;
      return arr.map(e => ({
        id: e.id,
        domaine,
        nom: e.nom_syndrome || e.id,
        chemin: e.chemin || e.chemin_relatif,
        sousLabel: e.organe || e.niveau_ou_couche || e.sous_categorie || ""
      }));
    } catch (e) { return []; }
  },

  async load() {
    const [organes, externes, qsl] = await Promise.all([
      this.loadDomaine("organes", "syndromes/organes/index.json"),
      this.loadDomaine("externes", "syndromes/externes/index.json"),
      this.loadDomaine("qi_sang_liquides", "syndromes/qi_sang_liquides/index.json")
    ]);
    this.entries = [...organes, ...externes, ...qsl];
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
    const q = (query || "").trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(e => (e.nom || "").toLowerCase().includes(q) || (e.sousLabel || "").toLowerCase().includes(q));
  },

  renderList(list) {
    const ul = document.getElementById("syn-list");
    ul.innerHTML = "";
    list.forEach(e => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="fl-pinyin">${escapeHtml(e.nom)}</span>
        <span class="fl-syndrome">${escapeHtml(this.domaineLabels[e.domaine])}${e.sousLabel ? " · " + escapeHtml(e.sousLabel) : ""}</span>`;
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

  renderSyndrome(d, domaine) {
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

document.getElementById("syn-search").addEventListener("input", (e) => Syndromes.renderList(Syndromes.search(e.target.value)));
Syndromes.load();

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
  ["Émotionnel / Shén", /shén|esprit|anxiété|dépression|agitation|dysphorie|irritabilité|colère|peur|frayeur|manie|pleurs/i],
  ["Gynéco", /règles|menstru|gynéco|ménorragie/i],
];

function dsCategorize(sign) {
  for (const [label, re] of DS_CATEGORIES) {
    if (re.test(sign)) return label;
  }
  return "Autres signes";
}

const DiagSignes = {
  loaded: false,
  syndromesData: [], // [{entry, detail, signKeys: Set<normalizedKey>}]
  signIndex: new Map(), // normalizedKey -> display text (first-seen original wording)
  selected: new Set(), // normalized keys

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
        atomicSigns.forEach(sign => {
          const key = dsNormalizeKey(sign);
          if (!key) return;
          signKeys.add(key);
          if (!this.signIndex.has(key)) this.signIndex.set(key, sign);
        });
        return { entry: e, detail: d, signKeys };
      } catch (err) { return null; }
    }));
    this.syndromesData = details.filter(x => x && x.signKeys.size);
    this.loaded = true;
    document.getElementById("diag-signes-loading").style.display = "none";
    document.getElementById("diag-signes-body").style.display = "block";
    this.renderSelected();
    this.renderAvailable("");
    this.renderResults();
  },

  toggle(key) {
    if (this.selected.has(key)) this.selected.delete(key);
    else this.selected.add(key);
    this.renderSelected();
    this.renderAvailable(document.getElementById("ds-search").value);
    this.renderResults();
  },

  renderSelected() {
    const el = document.getElementById("ds-selected");
    if (!this.selected.size) { el.innerHTML = `<span class="muted">Aucun signe sélectionné pour l'instant.</span>`; return; }
    el.innerHTML = [...this.selected].map(key => {
      const label = this.signIndex.get(key) || key;
      return `<span class="chosen-item">${escapeHtml(label)}
        <button type="button" data-k="${escapeHtml(key)}">✕</button>
      </span>`;
    }).join("");
    el.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => this.toggle(btn.dataset.k));
    });
  },

  renderAvailable(query) {
    const el = document.getElementById("ds-available");
    const q = (query || "").trim().toLowerCase();
    let pool = [...this.signIndex.entries()].filter(([key]) => !this.selected.has(key));
    if (q) pool = pool.filter(([, label]) => label.toLowerCase().includes(q));
    if (!pool.length) { el.innerHTML = `<span class="muted">Aucun signe ne correspond à cette recherche.</span>`; return; }

    const byCategory = new Map();
    pool.forEach(([key, label]) => {
      const cat = dsCategorize(label);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push([key, label]);
    });
    const orderedCats = [...DS_CATEGORIES.map(c => c[0]), "Autres signes"].filter(c => byCategory.has(c));

    const CAP_PER_CATEGORY = q ? 999 : 40;
    let html = "";
    orderedCats.forEach(cat => {
      const items = byCategory.get(cat).sort((a, b) => a[1].localeCompare(b[1], "fr"));
      const shown = items.slice(0, CAP_PER_CATEGORY);
      html += `<div class="ds-cat-block"><h4 class="sec-sub">${escapeHtml(cat)} (${items.length})</h4><div class="ds-cat-chips">`;
      html += shown.map(([key, label]) => `<button type="button" class="ds-chip" data-k="${escapeHtml(key)}">${escapeHtml(label)}</button>`).join("");
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
    if (!this.selected.size) { el.innerHTML = `<p class="muted">Sélectionne au moins un signe pour voir les syndromes correspondants.</p>`; return; }
    const scored = this.syndromesData.map(sd => {
      const matchedKeys = [...sd.signKeys].filter(k => this.selected.has(k));
      return { sd, matchedKeys, pct: Math.round((matchedKeys.length / sd.signKeys.size) * 100) };
    }).filter(x => x.matchedKeys.length > 0)
      .sort((a, b) => b.pct - a.pct || b.matchedKeys.length - a.matchedKeys.length);
    if (!scored.length) { el.innerHTML = `<p class="muted">Aucun syndrome de la base ne recoupe les signes sélectionnés.</p>`; return; }
    el.innerHTML = scored.slice(0, 40).map(({ sd, matchedKeys, pct }) => `
      <div class="ds-result" data-id="${escapeHtml(sd.entry.id)}" data-domaine="${escapeHtml(sd.entry.domaine)}">
        <div class="ds-result-top">
          <span class="ds-result-name">${escapeHtml(sd.entry.nom)}</span>
          <span class="ds-result-pct">${pct}%</span>
        </div>
        <p class="muted">${escapeHtml(Syndromes.domaineLabels[sd.entry.domaine] || "")}${sd.entry.sousLabel ? " · " + escapeHtml(sd.entry.sousLabel) : ""}</p>
        <div class="ds-result-bar-wrap"><div class="ds-result-bar" style="width:${pct}%;"></div></div>
        <p class="ds-result-matched">${matchedKeys.length} / ${sd.signKeys.size} signe(s) documenté(s) correspondent</p>
      </div>
    `).join("");
    el.querySelectorAll(".ds-result").forEach(div => {
      div.addEventListener("click", () => {
        const entry = Syndromes.entries.find(e => e.id === div.dataset.id && e.domaine === div.dataset.domaine);
        if (!entry) return;
        document.querySelector('.tab-btn[data-tab="syndromes"]').click();
        Syndromes.showDetail(entry);
      });
    });
  }
};

document.getElementById("ds-search").addEventListener("input", (e) => DiagSignes.renderAvailable(e.target.value));
document.querySelector('.tab-btn[data-tab="diag-signes"]').addEventListener("click", () => DiagSignes.ensureLoaded());

/* ============================= Cas pratique ============================= */
const CasPratique = {
  cas: [],
  sources: {},
  rawIndex: null,

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
CasPratique.load();

/* ============================= TDAH (page transversale) ============================= */
async function loadTdahPage() {
  const el = document.getElementById("tdah-detail");
  try {
    const d = await Store.readJSON("tdah_transversal.json");
    window.TdahData = d;
    const types = (d.types || []).map((t, ti) => {
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
      return `<section class="syn-synthese psy-decision" id="tdah-type-${ti}">
        <h3>${escapeHtml(t.nom)}</h3>
        <p class="muted">${escapeHtml(t.approche || "")}</p>
        ${t.mecanisme ? `<p>${tcmHighlightInline(escapeHtml(t.mecanisme))}</p>` : ""}
        ${signes}${principe}${points}${pharma}${pharmaNote}
        <p class="muted">Source : ${escapeHtml((t.source && t.source.origine) || "")} (${escapeHtml((t.source && t.source.fichier) || "")})</p>
      </section>`;
    }).join("");
    el.innerHTML = `
      <h2>${escapeHtml(d.titre)}</h2>
      <p class="muted"><em>${escapeHtml(d.avertissement || "")}</em></p>
      ${types}
    `;
    addEditControls(el, "tdah_transversal.json", d, { onSaved: () => loadTdahPage() });
  } catch (e) {
    el.innerHTML = `<p class="muted">Page pas encore prête (${e.message}).</p>`;
  }
}
loadTdahPage();

/* ============================= Images locales (dossier choisi sur l'appareil) ============================= */
// Pour la copie hébergée (PWA sans dossier data/ local) : laisse charger les images
// directement depuis un dossier du téléphone via le sélecteur de dossier du navigateur,
// sans jamais transiter par le dépôt GitHub (qui exclut volontairement les images).
const LocalImages = {
  map: new Map(), // relPath ("P/P1.jpg") -> object URL

  urlFor(relPath) {
    return this.map.get(relPath) || null;
  },

  loadFiles(fileList) {
    this.map.forEach(url => URL.revokeObjectURL(url));
    this.map.clear();
    let count = 0;
    for (const file of fileList) {
      const full = file.webkitRelativePath || file.name;
      // webkitRelativePath commence toujours par le nom du dossier choisi (ex "images/P/P1.jpg") ;
      // on retire ce premier segment pour retrouver le chemin relatif attendu ("P/P1.jpg").
      const parts = full.split("/");
      const relPath = parts.length > 1 ? parts.slice(1).join("/") : full;
      if (!/\.(jpe?g|png|webp|gif)$/i.test(relPath)) continue;
      this.map.set(relPath, URL.createObjectURL(file));
      count++;
    }
    return count;
  }
};

document.getElementById("pts-load-local-images").addEventListener("click", () => {
  document.getElementById("pts-local-images-input").click();
});
document.getElementById("pts-local-images-input").addEventListener("change", (e) => {
  const status = document.getElementById("pts-local-images-status");
  const count = LocalImages.loadFiles(e.target.files);
  status.style.display = "block";
  status.textContent = `✅ ${count} image(s) chargée(s) depuis le dossier choisi (valable pour cette session — à refaire à la prochaine ouverture de l'app).`;
  if (Points.lastShown) Points.showDetail(Points.lastShown);
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
        pts.forEach(p => this.entries.push({ id: p.point, canal: c.id, canalNom: c.nom, data: p }));
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
      li.innerHTML = `<span class="fl-pinyin">${escapeHtml(e.id)}</span>
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
      ${actions ? `<section><h3>Actions</h3>${actions}</section>` : ""}
      ${associations ? `<section><h3>Associations</h3>${associations}</section>` : ""}
      ${d.note ? `<section><h3>Note</h3><div class="tcm-text">${formatTcmText(d.note)}</div></section>` : ""}
      <p class="muted">Source : base Jeu (Points des canaux.xlsx) + images localisation.jpg (Bibliothèque MTC)</p>
    `;
    addEditControls(document.getElementById("pts-detail"), "reference/points_canaux/" + entry.canal + ".json", d, { arrayItem: true, matchField: "point", matchValue: entry.id });
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
      <p class="muted">${points.length} point(s) de croisement affiché(s). Case sombre = recoupement confirmé (noir dans la source). Case claire = recoupement secondaire (gris dans la source, sans légende explicite — à vérifier).</p>`;
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
document.getElementById("pts-view-fiches").addEventListener("click", () => {
  document.getElementById("pts-view-fiches").classList.add("active");
  document.getElementById("pts-view-croisements").classList.remove("active");
  document.getElementById("pts-view-fiches-panel").style.display = "";
  document.getElementById("pts-view-croisements-panel").style.display = "none";
});
document.getElementById("pts-view-croisements").addEventListener("click", () => {
  document.getElementById("pts-view-croisements").classList.add("active");
  document.getElementById("pts-view-fiches").classList.remove("active");
  document.getElementById("pts-view-fiches-panel").style.display = "none";
  document.getElementById("pts-view-croisements-panel").style.display = "";
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
    (m, name, hanzi) => `<span class="tcm-formule">${name}</span>${hanzi ? `<span class="tcm-hanzi-inline">${hanzi}</span>` : ""}`
  );
  return s;
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
  const raw = escapeHtml(String(str));
  return `<p>${tcmHighlightInline(raw)}</p>`;
}

function formatArrayEntry(str) {
  const raw = escapeHtml(String(str));
  const segments = splitTopLevel(raw, ";");
  if (segments.length < 3) {
    return tcmHighlightInline(raw);
  }

  const LABEL_RE = /^(.{1,60}?)\s*[—=:]\s*(.+)$/;
  const parsed = segments.map(seg => {
    const m = seg.match(LABEL_RE);
    return m ? { label: m[1], rest: m[2] } : null;
  });

  if (!parsed.every(p => p)) {
    return `<ul class="tcm-sublist">${segments.map(s => `<li>${tcmHighlightInline(s)}</li>`).join("")}</ul>`;
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
    const body = rows.map(r => `<tr><td>${tcmHighlightInline(r.label)}</td>${r.pairs.map(p => `<td>${tcmHighlightInline(p.value)}</td>`).join("")}</tr>`).join("");
    return `<table class="tcm-mini-table"><thead>${header}</thead><tbody>${body}</tbody></table>`;
  }

  const header2 = `<tr><th>Élément</th><th>Détail</th></tr>`;
  const body2 = rows.map(r => `<tr><td>${tcmHighlightInline(r.label)}</td><td>${tcmHighlightInline(r.rest)}</td></tr>`).join("");
  return `<table class="tcm-mini-table"><thead>${header2}</thead><tbody>${body2}</tbody></table>`;
}

/* ============================= Ajouter une formule (sans IA) =============================
   Fonctionne sans Claude : génère le JSON conforme au schéma et l'écrit directement dans
   data/ via la File System Access API (Chrome/Edge), avec repli sur un simple téléchargement
   pour les navigateurs qui ne supportent pas cette API. */
function slugify(s) {
  return (s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseComposition(text) {
  return (text || "").split("\n").map(l => l.trim()).filter(Boolean).map(line => {
    const parts = line.split(";").map(p => p.trim());
    return {
      substance_pinyin: parts[0] || "",
      hanzi: parts[1] || null,
      dose: parts[2] || null,
      role_hierarchique: parts[3] || null
    };
  });
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
  btn.addEventListener("click", () => openJsonEditor(container, relPath, obj, opts));
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
    <textarea id="edit-textarea" class="json-editor" spellcheck="false"></textarea>
  `;
  container.innerHTML = "";
  container.appendChild(editorDiv);
  document.getElementById("edit-textarea").value = JSON.stringify(obj, null, 2);
  document.getElementById("edit-cancel").addEventListener("click", () => { container.innerHTML = original; });
  document.getElementById("edit-save").addEventListener("click", async () => {
    const status = document.getElementById("edit-status");
    let parsed;
    try { parsed = JSON.parse(document.getElementById("edit-textarea").value); }
    catch (e) { status.textContent = "⚠ JSON invalide : " + e.message; return; }
    try {
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
    } catch (e) {
      status.textContent = "⚠ " + e.message;
    }
  });
}

const Ajout = {

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
      composition: parseComposition(document.getElementById("aj-composition").value),
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
  document.getElementById("aj-status").textContent = "";
});

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
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];

    (Formules.index || []).forEach(f => {
      const hay = [f.pinyin, f.nom_fr, f.indications_syndrome, f.categorie_nom].filter(Boolean).join(" ").toLowerCase();
      if (hay.includes(q)) out.push({
        group: "Formules", title: f.pinyin || f.id, sub: f.indications_syndrome || f.categorie_nom || "",
        go: () => { this.gotoTab("formules"); Formules.showDetail(f); }
      });
    });

    (Psy.entries || []).forEach(e => {
      const hay = [e.nom, e.categorie_source, e.resume_court].filter(Boolean).join(" ").toLowerCase();
      if (hay.includes(q)) out.push({
        group: "Principes Taoïstes", title: e.nom, sub: e.kind === "niveau" ? "Farrell — Niveau de latence" : e.kind === "vaisseau" ? "Farrell — Vaisseau / confluence" : "Sterman — " + (e.categorie_source || ""),
        go: () => { this.gotoTab("psy"); Psy.showDetail(e); }
      });
    });

    (Syndromes.entries || []).forEach(e => {
      const hay = [e.nom, e.sousLabel].filter(Boolean).join(" ").toLowerCase();
      if (hay.includes(q)) out.push({
        group: "Syndromes", title: e.nom, sub: (Syndromes.domaineLabels[e.domaine] || "") + (e.sousLabel ? " · " + e.sousLabel : ""),
        go: () => { this.gotoTab("syndromes"); Syndromes.showDetail(e); }
      });
    });

    (CasPratique.cas || []).forEach(c => {
      const hay = [c.titre_original, c.resume_court].filter(Boolean).join(" ").toLowerCase();
      if (hay.includes(q)) out.push({
        group: "Exemples de cas cliniques", title: c.titre_original || c.id, sub: CasPratique.sources[c.source_id] || "",
        go: () => { this.gotoTab("cas-pratique"); CasPratique.showDetail(c); }
      });
    });

    (Points.entries || []).forEach(e => {
      const hay = [e.id, e.data.pinyin, e.data.nom_fr].filter(Boolean).join(" ").toLowerCase();
      if (hay.includes(q)) out.push({
        group: "Points", title: e.id + (e.data.pinyin ? " — " + e.data.pinyin : ""), sub: e.canalNom,
        go: () => {
          this.gotoTab("points");
          const fichesBtn = document.getElementById("pts-view-fiches");
          if (fichesBtn) fichesBtn.click();
          Points.showDetail(e);
        }
      });
    });

    ((window.TdahData && window.TdahData.types) || []).forEach((t, ti) => {
      const hay = [t.nom, t.mecanisme, t.approche, ...(t.signes_cles || [])].filter(Boolean).join(" ").toLowerCase();
      if (hay.includes(q)) out.push({
        group: "TDAH", title: t.nom, sub: t.approche || "",
        go: () => {
          this.gotoTab("tdah");
          setTimeout(() => {
            const el = document.getElementById("tdah-type-" + ti);
            if (el) el.scrollIntoView({ behavior: "auto", block: "start" });
          }, 50);
        }
      });
    });

    ((Croisement.data && Croisement.data.points) || []).forEach(p => {
      const hay = [p.point, p.canal_principal, ...(p.canaux_recoupes || []).map(c => c.canal + " " + c.nom),
        ...(p.vaisseaux_extraordinaires_recoupes || []).map(v => v.vaisseau)].filter(Boolean).join(" ").toLowerCase();
      if (hay.includes(q)) out.push({
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
    let html = "";
    let flat = [];
    groups.forEach((list, group) => {
      html += `<div class="gsr-group-label">${escapeHtml(group)} (${list.length})</div><ul>`;
      list.forEach(it => {
        html += `<li><span class="gsr-title">${escapeHtml(it.title)}</span>${it.sub ? `<span class="gsr-sub">${escapeHtml(it.sub)}</span>` : ""}</li>`;
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

/* ============================= PWA (installation Android + hors-ligne) ============================= */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* pas de contexte sécurisé (http non-localhost) — dégrade silencieusement */ });
  });
}
