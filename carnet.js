"use strict";

/* ============================= Carnet des circuits (PDF A5) =============================
   Met en page tous les circuits, avec toutes leurs informations, dans le style des carnets aide-mémoire :
   A5 portrait, Archivo, noir et blanc, tableaux à filets noirs, intitulés sur fond gris clair, pied de page alterné.
   Pensé en doubles pages : p. 1 = couverture, chaque circuit commence sur une page de gauche, total multiple de 4.
   Le carnet s'ouvre dans une nouvelle fenêtre ; « Imprimer » puis « Enregistrer au format PDF » donne le fichier.
   Dépend de app.js (escapeHtml, sansChinois, Syndromes, Formules), circuits.js (Circuits), tung.js (Tung). */

const CarnetCircuits = {
  CSS: `
    @page { size: 148mm 210mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #6f6f6f; }
    body { font-family: "Archivo", "Archivo Variable", Arial, Helvetica, sans-serif; font-size: 8.6pt; line-height: 1.24; color: #000;
      --ink: #000; --bg: #fff; --accent: #000; --font-body: "Archivo", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .barre { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 10px 16px; background: #222; color: #fff; font-size: 13px; }
    .barre button { font: inherit; font-weight: 700; padding: 6px 14px; border: 0; border-radius: 999px; background: #fff; color: #000; cursor: pointer; }
    .barre span { opacity: 0.85; }
    #pages { display: grid; grid-template-columns: 148mm 148mm; gap: 8mm 0; justify-content: center; padding: 10mm 0 20mm; }
    #pages .page:first-child { grid-column: 2; }
    .page { width: 148mm; height: 210mm; background: #fff; position: relative; padding: 11mm 9mm 0; overflow: hidden; break-after: page; page-break-after: always; outline: 0.2mm solid #999; }
    .corps { height: 183mm; overflow: hidden; }
    .pied { position: absolute; left: 9mm; right: 9mm; bottom: 6.5mm; display: flex; align-items: baseline; gap: 9mm; font-size: 7.4pt; }
    .pied .num { font-size: 10pt; font-weight: 500; }
    .page.droite .pied { justify-content: flex-end; }
    #mesure { position: absolute; left: -400mm; top: 0; visibility: hidden; height: auto; }
    #mesure .corps { height: auto; overflow: visible; display: flow-root; }
    h2.titre { display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; font-size: 11.5pt; font-weight: 800; text-transform: uppercase; margin: 0 0 2.5mm; }
    h2.titre span + span { white-space: nowrap; text-transform: none; }
    h3 { font-size: 8.6pt; font-weight: 800; text-transform: uppercase; margin: 2.6mm 0 0.9mm; }
    p { margin: 0 0 1mm; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 2.6mm; }
    td, th { border: 0.8pt solid #000; padding: 1.2mm 1.6mm; vertical-align: middle; text-align: left; }
    th { font-weight: 800; text-transform: uppercase; font-size: 8pt; }
    td.lib { background: #ededed; width: 31%; font-weight: 600; }
    td.lib small { display: block; font-weight: 400; font-size: 7.4pt; margin-top: 0.6mm; }
    tr.grp td { background: #ededed; font-weight: 800; text-transform: uppercase; font-size: 7.6pt; text-align: center; }
    ul.t { list-style: none; margin: 0 0 1mm; padding: 0; }
    ul.t li { padding-left: 2.2mm; text-indent: -2.2mm; }
    ul.t li::before { content: "- "; }
    .tete { display: flex; gap: 5mm; align-items: flex-start; margin: 0 0 1mm; }
    .tete .schema { flex: none; line-height: 0; }
    .tete .usage { flex: 1; border: 0.8pt solid #000; }
    .tete .usage h3 { margin: 0; padding: 1.2mm 1.6mm; background: #ededed; border-bottom: 0.8pt solid #000; }
    .tete .usage ul { padding: 1.2mm 1.6mm; margin: 0; }
    .couv-titre { text-align: right; font-size: 25pt; font-weight: 700; line-height: 1.05; text-transform: uppercase; margin: 2mm 4mm 0 0; }
    .couv-sous { position: absolute; left: 0; right: 0; top: 148mm; text-align: center; font-size: 11pt; font-weight: 500; }
    .couv-bas { position: absolute; left: 9mm; top: 166mm; font-size: 8.6pt; line-height: 1.3; }
    .somm { display: flex; align-items: baseline; gap: 2mm; margin: 0 0 1.5mm; }
    .somm b { font-weight: 700; text-transform: uppercase; font-size: 8.4pt; }
    .somm i { flex: 1; border-bottom: 0.6pt dotted #000; transform: translateY(-1mm); }
    .somm span { font-size: 7.6pt; white-space: nowrap; }
    .legende { display: flex; align-items: center; gap: 3mm; margin: 0 0 1.6mm; }
    .legende svg { flex: none; }
    .lignes { height: 172mm; background: repeating-linear-gradient(to bottom, transparent 0, transparent 7.6mm, #9a9a9a 7.6mm, #9a9a9a 7.8mm); margin-top: 2mm; }
    @media (max-width: 310mm) { #pages { grid-template-columns: 148mm; } #pages .page:first-child { grid-column: 1; } }
    @media print { html, body { background: #fff; } .barre, #mesure { display: none !important; } #pages { display: block; padding: 0; } .page { outline: 0; } }
  `,

  h(t) { return escapeHtml(sansHanzi(String(t == null ? "" : t))).replace(/\s+/g, " ").trim(); },
  liste(items) { const l = (items || []).map(x => this.h(x)).filter(Boolean); return l.length ? `<ul class="t">${l.map(x => `<li>${x}</li>`).join("")}</ul>` : ""; },
  titre(t) { return `<h3>${this.h(t)}</h3>`; },

  // ---------- les blocs d'un circuit : { html } (insécable) ou { titre, tete, rows } (tableau, coupé entre deux lignes si la page est pleine)
  async blocsCircuit(c, parCircuit) {
    const C = Circuits, b = [];
    b.push({ html: `<h2 class="titre"><span>${this.h(C.nomCourt(c))}</span><span>${c.grille.join(" · ")}</span></h2>` });
    const svg = C.dessin(c, { taille: 118, etiquettes: true, ajouts: true });
    b.push({ html: `<div class="tete"><div class="schema">${svg}</div>${(c.mots_cles || []).length ? `<div class="usage"><h3>Usage le plus courant</h3>${this.liste(c.mots_cles)}</div>` : ""}</div>` });
    const groupes = (c.indications_groupes || []).filter(g => (g.items || []).length);
    if (groupes.length) b.push({ titre: "Indications", rows: groupes.map(g => `<tr><td class="lib">${this.h(g.titre)}</td><td>${g.items.map(x => this.h(x)).join(" · ")}</td></tr>`) });
    else if ((c.indications || []).length) b.push({ html: this.titre("Indications") + this.liste(c.indications) });
    if ((c.actions || []).length) b.push({ html: this.titre("Actions") + this.liste(c.actions) });
    const ajouts = (c.ajouts || []).map(a => (a.canaux || []).length ? C.ajoutLigne(a, c.grille) : (a.texte || a.action || "")).filter(Boolean);
    if (ajouts.length) b.push({ html: this.titre("Ajouts possibles") + this.liste(ajouts) });
    // associations de points : l'indication à gauche, les points à droite (une ligne par canal)
    const ptsHtml = pts => { const ordre = [...c.grille, ...Object.keys(pts).filter(k => !c.grille.includes(k))]; return ordre.filter(k => (pts[k] || []).length).map(k => pts[k].map(p => this.h(p)).join(" · ")).join("<br>"); };
    if ((c.associations || []).length) b.push({ titre: "Associations de points", tete: `<tr><th>Pour…</th><th>Points</th></tr>`,
      rows: c.associations.map(a => `<tr><td class="lib">${this.h(a.tableau)}${a.note ? `<small>${this.h(a.note)}</small>` : ""}</td><td>${ptsHtml(a.points || {})}</td></tr>`) });
    // recettes de Wang Ju Yi, rangées par condition d'ajout
    const wjy = C.recettesWjy(c).liste;
    if (wjy.length) {
      const rows = [];
      C.wjyGroupes(wjy).forEach(g => {
        rows.push(`<tr class="grp"><td colspan="2">${g.ajout.length ? "Avec ajout : " + g.ajout.join(" + ") : "Dans les quatre canaux, sans ajout"}</td></tr>`);
        g.items.forEach(({ w }) => rows.push(`<tr><td class="lib">${w.r.points.map(p => this.h(p)).join(" – ")}${w.r.vaisseaux ? `<small>${this.h(w.r.vaisseaux)}</small>` : ""}</td><td>${this.liste(w.r.puces)}</td></tr>`));
      });
      b.push({ titre: "Recettes de Wang Ju Yi", tete: `<tr><th>Points</th><th>Indications</th></tr>`, rows });
    }
    // points retenus (★), canal par canal
    const codes = [...new Set([...c.grille, ...(c.ajouts || []).flatMap(a => a.canaux || [])])];
    const retenus = codes.map(k => ({ k, l: C.ptsAffiches(k, c).filter(x => C.retenu(x)) })).filter(x => x.l.length);
    if (retenus.length) b.push({ titre: "Points retenus", rows: retenus.map(x => `<tr><td class="lib">${this.h((C.canaux.get(x.k) || {}).nom || x.k)} (${x.k})</td><td>${x.l.map(p => `<strong>${this.h(p.point)}</strong>${p.action ? " : " + this.h(p.action) : ""}${p.commentaire ? " (" + this.h(p.commentaire) + ")" : ""}`).join("<br>")}</td></tr>`) });
    // points Tung compatibles avec le circuit
    try {
      const r = Tung.compatibles(c.grille, (c.ajouts || []).map(a => a.canaux || []));
      const nom = f => this.h(f.nom + ((f.numeros || []).length ? " " + f.numeros.join("/") : "")) + ` (${f.canaux.codes.join("+")})`;
      const lignes = [["Dans le circuit", r.ok], ["Avec un ajout", r.avec]].filter(x => (x[1] || []).length);
      if (lignes.length) b.push({ titre: "Points Tung", rows: lignes.map(([t, l]) => `<tr><td class="lib">${t}</td><td>${l.map(nom).join(" · ")}</td></tr>`) });
    } catch (e) { /* points Tung indisponibles */ }
    // syndromes et formules
    const cles = [...new Set([...(c.syndromes_lies || []), ...((parCircuit && parCircuit.get(c.id)) || [])])];
    const synd = cles.map(k => C.libelleLie(k)).filter(l => !l.introuvable).map(l => this.h(l.nom));
    const formules = (c.formules || []).map(id => C.nomFormule(id)).filter(Boolean).map(n => this.h(n.nom) + (n.fr ? " — " + this.h(n.fr) : ""));
    const rowsSF = [];
    if ((c.syndromes || []).length) rowsSF.push(`<tr><td class="lib">Syndromes des canaux</td><td>${c.syndromes.map(x => this.h(x)).join(" · ")}</td></tr>`);
    if (synd.length) rowsSF.push(`<tr><td class="lib">Syndromes rattachés</td><td>${synd.join(" · ")}</td></tr>`);
    if (formules.length) rowsSF.push(`<tr><td class="lib">Pharmacopée</td><td>${formules.join("<br>")}${c.formules_note ? "<br>" + this.h(c.formules_note) : ""}</td></tr>`);
    if (rowsSF.length) b.push({ titre: "Syndromes et formules", rows: rowsSF });
    const notes = [...(c.notes || []), ...(c.notes_cours || [])];
    if (notes.length) b.push({ html: this.titre("Notes") + this.liste(notes) });
    return b;
  },

  table(bloc, rows, suite) { return `<h3>${this.h(bloc.titre)}${suite ? " (suite)" : ""}</h3><table>${bloc.tete || ""}${rows.join("")}</table>`; },

  // ---------- mise en pages : les blocs sont posés l'un après l'autre ; un tableau trop long continue page suivante, intitulé répété
  paginer(doc, blocs) {
    const mes = doc.querySelector("#mesure .corps"), ref = doc.createElement("div");
    ref.className = "corps"; ref.style.cssText = "position:absolute;visibility:hidden"; doc.body.appendChild(ref);
    const H = ref.getBoundingClientRect().height - 1; ref.remove();
    const tient = l => { mes.innerHTML = l.join(""); return mes.scrollHeight <= H; };
    const pages = []; let cur = [];
    const tourner = () => { pages.push(cur.join("")); cur = []; };
    blocs.forEach(b => {
      if (!b.rows) { if (cur.length && !tient([...cur, b.html])) tourner(); cur.push(b.html); return; }
      let reste = b.rows.slice(), suite = false;
      while (reste.length) {
        let n = 0;
        while (n < reste.length && tient([...cur, this.table(b, reste.slice(0, n + 1), suite)])) n++;
        if (n && n < reste.length && /class="grp"/.test(reste[n - 1])) n--;        // un intitulé de groupe ne reste pas seul en bas de page
        if (!n) { if (cur.length) { tourner(); continue; } n = 1; }               // une ligne plus haute que la page : elle passe quand même
        cur.push(this.table(b, reste.slice(0, n), suite));
        reste = reste.slice(n);
        if (reste.length) { tourner(); suite = true; }
      }
    });
    if (cur.length) tourner();
    return pages;
  },

  // la page 1 (couverture) est à droite ; numéro à l'extérieur : à droite sur les pages impaires, à gauche sur les paires
  page(i, p) {
    const n = i + 1, droite = n % 2 === 1;
    const pied = p.sansPied ? "" : droite ? `<span>${p.courant || ""}</span><span class="num">${n}</span>` : `<span class="num">${n}</span><span>Circuits thérapeutiques</span>`;
    return `<div class="page ${droite ? "droite" : "gauche"}"><div class="corps">${p.corps}</div><div class="pied">${pied}</div></div>`;
  },

  pageLegende() {
    const C = Circuits, B = C.base || {};
    const rond = (plein, pointille) => `<svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="10" fill="${plein ? "#000" : "#fff"}" stroke="#000" stroke-width="2.4"${pointille ? ` stroke-dasharray="3.5 2.5"` : ""}/></svg>`;
    const trait = `<svg width="26" height="26" viewBox="0 0 26 26"><line x1="2" y1="13" x2="24" y2="13" stroke="#000" stroke-width="3" stroke-linecap="round"/></svg>`;
    const lg = (svg, t) => `<div class="legende">${svg}<span>${t}</span></div>`;
    const regles = B.regles && typeof B.regles === "object" ? Object.values(B.regles).filter(x => typeof x === "string") : [];
    return `<h2 class="titre"><span>Lire un schéma</span></h2>` +
      lg(rond(true), "Rond plein : canal yīn.") + lg(rond(false), "Rond vide : canal yáng.") + lg(trait, "Trait : connexion entre deux canaux.") + lg(rond(false, true), "Rond en pointillé : canal qui peut être ajouté au circuit.") +
      ((B.schemas || []).length ? `<h3>Les quatre schémas</h3><table>${B.schemas.map(s => `<tr><td class="lib">${this.h(C.NOM_SCHEMA[s.n] || "Schéma " + s.n)}</td><td>${this.h(s.texte)}</td></tr>`).join("")}</table>` : "") +
      (regles.length ? `<h3>Règles</h3>${this.liste(regles)}` : "");
  },

  async ouvrir() {
    const w = window.open("", "_blank");
    if (!w) { alert("Le navigateur a bloqué la nouvelle fenêtre. Autorise les fenêtres pour ce site, puis recommence."); return; }
    const doc = w.document;
    doc.open();
    doc.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Circuits thérapeutiques — aide-mémoire</title>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap"><style>${this.CSS}</style></head>
      <body><div class="barre"><button type="button" id="imprimer">Imprimer / Enregistrer en PDF</button><span id="etat">Mise en page en cours…</span></div>
      <div id="mesure" class="page"><div class="corps"></div></div><div id="pages"></div></body></html>`);
    doc.close();
    const etat = t => { const e = doc.getElementById("etat"); if (e) e.textContent = t; };
    try {
      await Circuits.ensureLoaded();
      try { await Tung.ensureLoaded(); } catch (e) { /* le carnet se fait sans les points Tung */ }
      let parCircuit = null; try { parCircuit = await Circuits.syndromesParCircuit(); } catch (e) { /* sans les syndromes déduits */ }
      try { if (doc.fonts && doc.fonts.ready) await Promise.race([doc.fonts.ready, new Promise(r => setTimeout(r, 2500))]); } catch (e) { /* police de secours */ }
      await new Promise(r => setTimeout(r, 150));
      Circuits._nb = true;                                   // schémas en noir et blanc pour l'impression
      const pages = [];                                      // { corps, courant, classe } ; l'indice + 1 = numéro de page
      const d = new Date(), date = [d.getDate(), d.getMonth() + 1].map(x => String(x).padStart(2, "0")).join(".") + "." + d.getFullYear();
      pages.push({ corps: `<div class="couv-titre">Circuits<br>thérapeutiques</div><div class="couv-sous">aide-mémoire</div><div class="couv-bas">Réseaux en acupuncture : équilibre global<br>aide-mémoire v.${date}</div>`, sansPied: true });
      pages.push({ corps: this.pageLegende() });
      pages.push({ corps: "", sommaire: true });
      const sommaire = [];
      for (const c of Circuits.liste) {
        if (pages.length % 2 === 0) pages.push({ corps: `<h3>Notes</h3><div class="lignes"></div>` });      // chaque circuit commence sur une page de gauche
        const nom = this.h(Circuits.nomCourt(c));
        sommaire.push({ nom, grille: c.grille.join(" · "), page: pages.length + 1 });
        this.paginer(doc, await this.blocsCircuit(c, parCircuit)).forEach(corps => pages.push({ corps, courant: nom }));
      }
      while ((pages.length + 1) % 4 !== 0) pages.push({ corps: `<h3>Notes</h3><div class="lignes"></div>` });
      pages.push({ corps: "", sansPied: true });               // quatrième de couverture
      pages[2].corps = `<h2 class="titre"><span>Sommaire</span></h2>` + sommaire.map(s => `<div class="somm"><b>${s.nom}</b><span>${s.grille}</span><i></i><span>${s.page}</span></div>`).join("");
      doc.getElementById("pages").innerHTML = pages.map((p, i) => this.page(i, p)).join("");
      etat(pages.length + " pages A5 (" + Circuits.liste.length + " circuits). Dans la fenêtre d'impression : format A5, marges « Aucune », et « Graphiques d'arrière-plan » coché.");
    } catch (e) {
      etat("Mise en page impossible : " + e.message);
    } finally { Circuits._nb = false; }
    doc.getElementById("imprimer").addEventListener("click", () => w.print());
  },

  init() {
    const b = document.getElementById("circuit-carnet");
    if (b) b.addEventListener("click", () => this.ouvrir());
  }
};
CarnetCircuits.init();
