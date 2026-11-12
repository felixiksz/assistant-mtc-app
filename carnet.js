"use strict";

/* ============================= Carnet des circuits (PDF A5) =============================
   Met en page les circuits dans le style des carnets aide-mémoire : A5 portrait, Archivo, noir et blanc,
   tableaux à filets noirs, intitulés sur fond gris clair, pied de page alterné.
   Le carnet s'ouvre dans une nouvelle fenêtre, avec un panneau de réglages : pour chaque rubrique, on choisit de l'inclure ou non
   et sa mise en page (tableau, texte suivi, colonnes…) ; le nombre de pages se recalcule à chaque changement.
   « Imprimer » puis « Enregistrer au format PDF » donne le fichier.
   Dépend de app.js (escapeHtml, sansHanzi, Syndromes, Formules), circuits.js (Circuits), tung.js (Tung). */

const CarnetCircuits = {
  CLE: "carnet_circuits_options_v3",

  // ---------- réglages : pour chaque rubrique, plusieurs mises en page (la dernière la retire)
  CHAMPS: [
    { k: "mode", lib: "Enchaînement des circuits", choix: [["double", "Chaque circuit commence sur une page de gauche (doubles pages)"], ["page", "Chaque circuit commence sur une nouvelle page"], ["suite", "À la suite, sans saut de page (le plus court)"]] },
    { k: "taille", lib: "Taille du texte", choix: [["8.6", "Normale (8,6 pt)"], ["8", "Petite (8 pt)"], ["7.4", "Très petite (7,4 pt)"]] },
    { k: "schema", lib: "Schéma et usage le plus courant", choix: [["cote", "Schéma à gauche, usage encadré à droite"], ["titre", "Petit schéma à côté du titre, usage sur une ligne"], ["sans", "Sans schéma, usage sur une ligne"]] },
    { k: "indications", lib: "Indications", choix: [["tableau", "Tableau par rubrique"], ["suivi", "Texte suivi, rubriques en gras"], ["colonnes", "Liste sur deux colonnes"], ["non", "Ne pas inclure"]] },
    { k: "actions", lib: "Actions", choix: [["liste", "Liste, une action par ligne"], ["colonnes", "Liste sur deux colonnes"], ["suivi", "Texte suivi"], ["non", "Ne pas inclure"]] },
    { k: "ajouts", lib: "Ajouts possibles", choix: [["tableau", "Tableau : canal ajouté à gauche, dans quel cas à droite"], ["liste", "Liste, un ajout par ligne"], ["suivi", "Texte suivi"], ["non", "Ne pas inclure (ils restent sur le schéma)"]] },
    { k: "assoc", lib: "Associations de points (tes tableaux)", choix: [["schemas", "Schémas : une carte par association, les points à leur place sur le circuit"], ["tableau", "Tableau : indication à gauche, points en pastilles à droite"], ["lignes", "Une ligne par association : indication, puis les points"], ["non", "Ne pas inclure"]] },
    { k: "wjy", lib: "Recettes de Wang Ju Yi", choix: [["tableau", "Tableau, comme les associations : indication à gauche, points à droite"], ["schemas", "Schémas : une carte par recette, les points à leur place"], ["cartes", "Petites cartes sur deux colonnes : points, puis indication"], ["points", "Les couples de points seulement"], ["non", "Ne pas inclure"]] },
    { k: "points", lib: "Points par canal (★ retenus et points Tung)", choix: [["tableau", "Tableau : un bandeau par canal, une ligne par point avec son action"], ["colonnes", "Deux colonnes : canal, puis ses points avec action abrégée"], ["noms", "Une ligne par canal, noms des points seulement"], ["non", "Ne pas inclure"]] },
    { k: "tung", lib: "Points Tung à inclure", choix: [["tiens", "Seulement les tiens (canal choisi ou fiche complétée par toi)"], ["tous", "Tous ceux dont le canal est connu (livres et canaux déduits compris)"], ["non", "Aucun"]] },
    { k: "tungForme", lib: "Présentation des points Tung", choix: [["cartes", "Cartes avec image et localisation, deux par rangée"], ["canal", "Rangés avec les points de leur canal"]] },
    { k: "sf", lib: "Syndromes et formules", choix: [["tableau", "Tableau"], ["suivi", "Texte suivi"], ["non", "Ne pas inclure"]] },
  ],
  BOOLS: [["couverture", "Couverture"], ["legende", "Page « Lire un schéma »"], ["sommaire", "Sommaire"],
          ["assocNotes", "Notes des associations de points"], ["wjyTout", "Toutes les indications de chaque recette (sinon la première)"],
          ["pointsRetenus", "Points retenus (★)"], ["tungAjout", "Points Tung qui demandent un ajout"], ["tungImages", "Image de localisation des points Tung"],
          ["syndCanaux", "Syndromes des canaux (texte du cours)"], ["notes", "Notes des circuits"],
          ["indexInd", "Index des indications, par catégorie"], ["indexTab", "Index des tableaux (associations)"], ["indexSynd", "Index des syndromes rattachés"],
          ["multiple4", "Compléter par des pages blanches jusqu'à un multiple de 4 (carnet agrafé)"]],
  PRESETS: {
    complet: { nom: "Complet", o: { mode: "double", taille: "8.6", schema: "cote", indications: "tableau", actions: "liste", ajouts: "tableau", assoc: "schemas", wjy: "tableau", points: "tableau", tung: "tiens", tungForme: "cartes", sf: "tableau", tungImages: true,
      couverture: true, legende: true, sommaire: true, multiple4: false, assocNotes: true, wjyTout: true, pointsRetenus: true, tungAjout: true, syndCanaux: true, notes: true, indexInd: true, indexTab: true, indexSynd: true } },
    compact: { nom: "Compact", o: { mode: "page", taille: "8", schema: "cote", indications: "suivi", actions: "colonnes", ajouts: "liste", assoc: "schemas", wjy: "cartes", points: "colonnes", tung: "tiens", tungForme: "cartes", sf: "suivi", tungImages: true,
      couverture: true, legende: true, sommaire: true, multiple4: false, assocNotes: true, wjyTout: false, pointsRetenus: true, tungAjout: false, syndCanaux: false, notes: true, indexInd: true, indexTab: true, indexSynd: true } },
    minimal: { nom: "Le moins de pages", o: { mode: "suite", taille: "7.4", schema: "titre", indications: "suivi", actions: "suivi", ajouts: "non", assoc: "lignes", wjy: "points", points: "noms", tung: "tiens", tungForme: "canal", sf: "suivi", tungImages: false,
      couverture: true, legende: false, sommaire: true, multiple4: false, assocNotes: false, wjyTout: false, pointsRetenus: true, tungAjout: false, syndCanaux: false, notes: false, indexInd: true, indexTab: false, indexSynd: false } },
  },
  o: null,
  lireOptions() {
    let s = null; try { s = JSON.parse(localStorage.getItem(this.CLE) || "null"); } catch (e) { /* réglages illisibles */ }
    this.o = { ...this.PRESETS.complet.o, exclus: [], ...(s || {}) };
  },
  garderOptions() { try { localStorage.setItem(this.CLE, JSON.stringify(this.o)); } catch (e) { /* stockage indisponible */ } },

  CSS: `
    @page { size: 148mm 210mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #6f6f6f; }
    body { font-family: "Archivo", "Archivo Variable", Arial, Helvetica, sans-serif; color: #000;
      --ink: #000; --bg: #fff; --accent: #000; --font-body: "Archivo", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .barre { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 10px 16px; background: #222; color: #fff; font-size: 13px; }
    .barre button { font: inherit; font-weight: 700; padding: 6px 14px; border: 0; border-radius: 999px; background: #fff; color: #000; cursor: pointer; }
    .barre strong { font-size: 15px; }
    .barre span { opacity: 0.85; }
    .ecran { display: flex; align-items: flex-start; }
    #reglages { flex: none; width: 310px; position: sticky; top: 46px; max-height: calc(100vh - 46px); overflow-y: auto; background: #f3f3f3; padding: 12px 14px 30px; font-size: 13px; line-height: 1.35; }
    #reglages h4 { margin: 14px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
    #reglages label { display: block; margin: 0 0 8px; font-weight: 600; }
    #reglages label.case { font-weight: 400; margin: 0 0 3px; }
    #reglages select { display: block; width: 100%; margin-top: 2px; font: inherit; font-weight: 400; padding: 4px 6px; border: 1px solid #000; border-radius: 8px; background: #fff; }
    #reglages .presets { display: flex; flex-wrap: wrap; gap: 6px; }
    #reglages .presets button { font: inherit; font-weight: 700; padding: 5px 10px; border: 1.5px solid #000; border-radius: 999px; background: #fff; cursor: pointer; }
    #reglages .presets button:hover { background: #000; color: #fff; }
    #reglages details { margin-top: 10px; } #reglages summary { cursor: pointer; font-weight: 700; }
    #reglages .petit { font-weight: 400; font-size: 12px; color: #444; }
    #pages { flex: 1; min-width: 0; display: grid; grid-template-columns: 148mm 148mm; gap: 8mm 0; justify-content: center; padding: 10mm 0 20mm; }
    #pages.impaire .page:first-child { grid-column: 2; }
    .page { width: 148mm; height: 210mm; background: #fff; position: relative; padding: 11mm 9mm 0; overflow: hidden; break-after: page; page-break-after: always; outline: 0.2mm solid #999; font-size: var(--corps, 8.6pt); line-height: 1.24; }
    .corps { height: 183mm; overflow: hidden; }
    .pied { position: absolute; left: 9mm; right: 9mm; bottom: 6.5mm; display: flex; align-items: baseline; gap: 9mm; font-size: 7.4pt; }
    .pied .num { font-size: 10pt; font-weight: 500; }
    .page.droite .pied { justify-content: flex-end; }
    #mesure { position: absolute; left: -400mm; top: 0; visibility: hidden; height: auto; }
    #mesure .corps { height: auto; overflow: visible; display: flow-root; }
    h2.titre { display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; font-size: 1.34em; font-weight: 800; text-transform: uppercase; margin: 0 0 2.5mm; }
    h2.titre span + span { white-space: nowrap; text-transform: none; }
    .sepc { border-top: 1.2pt solid #000; margin: 3mm 0 2.5mm; }
    .corps > .sepc:first-child { display: none; }
    h3 { font-size: 1em; font-weight: 800; text-transform: uppercase; margin: 2.4mm 0 0.9mm; }
    p { margin: 0 0 1mm; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 2.4mm; }
    td, th { border: 0.8pt solid #000; padding: 1.1mm 1.5mm; vertical-align: middle; text-align: left; }
    th { font-weight: 800; text-transform: uppercase; font-size: 0.93em; }
    td.lib { background: #ededed; width: 31%; font-weight: 600; }
    td.lib small, p.lg small { display: block; font-weight: 400; font-size: 0.87em; margin-top: 0.5mm; }
    tr.grp td { background: #ededed; font-weight: 800; text-transform: uppercase; font-size: 0.88em; text-align: center; padding: 0.7mm 1.5mm; }
    .pt { display: inline-block; border: 0.7pt solid #000; border-radius: 1.6mm; padding: 0 1.2mm; margin: 0.25mm 0.6mm 0.25mm 0; font-weight: 700; white-space: nowrap; line-height: 1.25; text-indent: 0; background: #fff; }
    .pt.tg { border-style: dashed; }
    small.rem { font-size: 0.85em; margin-right: 0.8mm; }
    table.tp td.lib { width: auto; }
    td.pts { width: 37%; }
    td.pts small { display: block; font-size: 0.85em; margin-top: 0.4mm; }
    .canal { display: inline-block; min-width: 5.4mm; text-align: center; border: 0.8pt solid #000; padding: 0 1mm; margin-right: 1.2mm; font-weight: 800; text-transform: none; text-indent: 0; background: #fff; color: #000; }
    .canal.yin { background: #000; color: #fff; }
    tr.grp.gauche td { text-align: left; text-transform: none; font-size: 1em; }
    table.pc { table-layout: fixed; }
    table.pc td.pn { width: 27%; }
    table.pc .pt, .cartes .pt, td.pts .pt { white-space: normal; }
    table.pc td.pn small { display: block; font-size: 0.82em; }
    .cartes { columns: 2; column-gap: 4mm; margin: 0 0 1.4mm; }
    .cartes p.sgrp { column-span: all; }
    .cartes.libre p.sgrp { column-span: none; break-after: avoid; margin-top: 1.6mm; }
    .cartes p.lg { break-inside: avoid; }
    .carte { break-inside: avoid; border: 0.8pt solid #000; padding: 1mm 1.4mm; margin: 0 0 1.4mm; }
    .carte span.ind, .carte small { display: block; }
    .carte small { font-size: 0.85em; }
    .idx { columns: 2; column-gap: 5mm; column-fill: auto; }
    .idx h2.titre { column-span: all; }
    p.icat { background: #ededed; border: 0.8pt solid #000; font-weight: 800; text-transform: uppercase; font-size: 0.88em; padding: 0.6mm 1.2mm; margin: 1.6mm 0 0.9mm; break-after: avoid; }
    p.ient { display: flex; align-items: baseline; gap: 1mm; margin: 0 0 0.4mm; break-inside: avoid; }
    p.ient i { flex: 1; min-width: 3mm; border-bottom: 0.5pt dotted #000; transform: translateY(-0.8mm); }
    p.ient b { font-weight: 600; white-space: nowrap; }
    table.aj td.ajc { width: 27%; white-space: nowrap; font-weight: 800; }
    table.aj td.ajc small { display: block; font-weight: 400; font-size: 0.85em; white-space: normal; margin-top: 0.4mm; }
    table.aj td small { display: block; font-size: 0.87em; margin-top: 0.4mm; }
    .paire { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin: 0 0 3mm; align-items: stretch; }
    .sch { border: 0.8pt solid #000; padding: 1.4mm 1.8mm; min-width: 0; }
    .sch p.si { margin: 0; }
    .sch p.si strong, .sch p.si span { display: block; }
    .sch p.si span, .sch small { font-size: 0.87em; }
    .sch small { display: block; }
    .sch small.tag { text-transform: uppercase; font-weight: 800; font-size: 0.78em; letter-spacing: 0.04em; }
    .sch .sd { text-align: center; line-height: 0; margin: 1.5mm 0 1mm; }
    .sch .sd svg { max-width: 100%; height: auto; }
    .timg { display: block; line-height: 0; margin: 0.8mm 0 0.4mm; }
    .timg img { height: 25mm; width: auto; max-width: 100%; object-fit: contain; object-position: left center; filter: grayscale(1); border: 0.6pt solid #000; background: #fff; }
    .cartes .timg img { height: 20mm; }
    .sch.tc p.si span { margin-top: 0.5mm; }
    .sch .sd.timg { text-align: center; }
    .sch .sd.timg img { height: 31mm; object-position: center; border: 0; }
    .sch.tc small { margin-top: 0.6mm; }
    ul.t { list-style: none; margin: 0 0 1mm; padding: 0; }
    ul.t li { padding-left: 2.2mm; text-indent: -2.2mm; break-inside: avoid; }
    ul.t li::before { content: "- "; }
    ul.t.col2 { columns: 2; column-gap: 5mm; }
    p.suivi { text-align: left; }
    p.lg { margin: 0 0 0.8mm; padding-left: 2.2mm; text-indent: -2.2mm; }
    p.lg small { text-indent: 0; }
    p.sgrp { font-weight: 800; text-transform: uppercase; font-size: 0.88em; margin: 1.2mm 0 0.5mm; }
    .tete { display: flex; gap: 5mm; align-items: flex-start; margin: 0 0 1mm; }
    .tete .schema { flex: none; line-height: 0; }
    .tete .usage { flex: 1; border: 0.8pt solid #000; }
    .tete .usage h3 { margin: 0; padding: 1.1mm 1.5mm; background: #ededed; border-bottom: 0.8pt solid #000; }
    .tete .usage ul { padding: 1.1mm 1.5mm; margin: 0; }
    .tete2 { display: flex; gap: 4mm; align-items: flex-start; justify-content: space-between; margin: 0 0 1mm; }
    .tete2 h2.titre { margin-bottom: 1mm; }
    .tete2 .schema { flex: none; line-height: 0; }
    .couv-titre { text-align: right; font-size: 25pt; font-weight: 700; line-height: 1.05; text-transform: uppercase; margin: 2mm 4mm 0 0; }
    .couv-sous { position: absolute; left: 0; right: 0; top: 148mm; text-align: center; font-size: 11pt; font-weight: 500; }
    .couv-bas { position: absolute; left: 9mm; top: 166mm; font-size: 8.6pt; line-height: 1.3; }
    .somm { display: flex; align-items: baseline; gap: 2mm; margin: 0 0 1.5mm; }
    .somm b { font-weight: 700; text-transform: uppercase; font-size: 0.98em; }
    .somm i { flex: 1; border-bottom: 0.6pt dotted #000; transform: translateY(-1mm); }
    .somm span { font-size: 0.9em; white-space: nowrap; }
    .legende { display: flex; align-items: center; gap: 3mm; margin: 0 0 1.6mm; }
    .legende svg { flex: none; }
    @media (max-width: 1250px) { #pages { grid-template-columns: 148mm; } #pages.impaire .page:first-child { grid-column: 1; } }
    @media (max-width: 900px) { .ecran { display: block; } #reglages { position: static; width: auto; max-height: none; } }
    @media print { html, body { background: #fff; } .barre, #mesure, #reglages { display: none !important; } .ecran { display: block; } #pages { display: block; padding: 0; } .page { outline: 0; } }
  `,

  h(t) { return escapeHtml(sansHanzi(String(t == null ? "" : t))).replace(/\s+/g, " ").trim(); },
  liste(items, classe) { const l = (items || []).map(x => this.h(x)).filter(Boolean); return l.length ? `<ul class="t${classe ? " " + classe : ""}">${l.map(x => `<li>${x}</li>`).join("")}</ul>` : ""; },
  suivi(items) { const l = (items || []).map(x => this.h(x)).filter(Boolean); return l.length ? `<p class="suivi">${l.join(" · ")}</p>` : ""; },
  titre(t) { return `<h3>${this.h(t)}</h3>`; },
  // blocs sécables : une liste (coupée entre deux lignes) ou un texte suivi (coupé entre deux éléments)
  blocListe(titre, items, classe) { const l = (items || []).map(x => this.h(x)).filter(Boolean); return l.length ? { titre, env: [`<ul class="t${classe ? " " + classe : ""}">`, "</ul>"], rows: l.map(x => `<li>${x}</li>`) } : null; },
  blocSuivi(titre, fragments) { const l = (fragments || []).filter(Boolean); return l.length ? { titre, env: ['<p class="suivi">', "</p>"], rows: l.map((x, i) => x + (i < l.length - 1 ? " · " : "")) } : null; },
  court(t, n) { t = sansHanzi(String(t || "")).split(/\s*;\s*/)[0].trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t; },

  // ---------- les blocs d'un circuit, selon les réglages : { html } (insécable) ou { titre, tete, rows, env } (coupé entre deux lignes si la page est pleine)
  blocsCircuit(c, parCircuit, entree) {
    const C = Circuits, o = this.o, b = [], P = ["<div>", "</div>"];                 // P : lignes en paragraphes (sans tableau)
    const aj = x => { if (x) b.push(x); };
    const nom = this.h(C.nomCourt(c)), usage = (c.mots_cles || []).length ? c.mots_cles : null;
    const sep = `<div class="sepc"></div>`;
    if (o.schema === "cote") {
      const svg = C.dessin(c, { taille: 118, etiquettes: true, ajouts: true });
      b.push({ html: `${sep}<h2 class="titre"><span>${nom}</span><span>${c.grille.join(" · ")}</span></h2><div class="tete"><div class="schema">${svg}</div>${usage ? `<div class="usage"><h3>Usage le plus courant</h3>${this.liste(usage)}</div>` : ""}</div>`, debut: entree, avecSuivant: true });
    } else {
      const ligne = usage ? `<p class="suivi"><strong>Usage :</strong> ${usage.map(x => this.h(x)).join(" · ")}</p>` : "";
      const svg = o.schema === "titre" ? `<div class="schema">${C.dessin(c, { taille: 62, etiquettes: true })}</div>` : "";
      b.push({ html: `${sep}<div class="tete2"><div><h2 class="titre"><span>${nom}</span></h2><p><strong>${c.grille.join(" · ")}</strong></p>${ligne}</div>${svg}</div>`, debut: entree, avecSuivant: true });
    }
    // indications
    const groupes = this.groupesInd(c);
    if (o.indications !== "non") {
      if (o.indications === "tableau" && groupes.length) b.push({ titre: "Indications", rows: groupes.map(g => `<tr><td class="lib">${this.h(g.titre)}</td><td>${g.items.map(x => this.h(x)).join(" · ")}</td></tr>`) });
      else if (o.indications === "suivi" && groupes.length) aj(this.blocSuivi("Indications", groupes.map(g => `<strong>${this.h(g.titre)} :</strong> ${g.items.map(x => this.h(x)).join(", ")}`)));
      else if (o.indications === "suivi") aj(this.blocSuivi("Indications", (c.indications || []).map(x => this.h(x))));
      else aj(this.blocListe("Indications", c.indications, o.indications === "colonnes" ? "col2" : ""));
    }
    if (o.actions !== "non") aj(o.actions === "suivi" ? this.blocSuivi("Actions", (c.actions || []).map(x => this.h(x))) : this.blocListe("Actions", c.actions, o.actions === "colonnes" ? "col2" : ""));
    const badge = kc => `<span class="canal${C.polarite(kc) === "yin" ? " yin" : ""}">${kc}</span>`;
    const etL = l => l.length > 1 ? l.slice(0, -1).join(", ") + " et " + l[l.length - 1] : l.join("");
    const nrm = t => dsNorm(sansHanzi(String(t || ""))).replace(/[^a-z0-9]+/g, " ").trim();
    const AJ = (c.ajouts || []).map(a => {
      const cx = a.canaux || [], action = String(a.action || "").trim();
      // le lien avec le circuit : canaux reliés (un seul canal ajouté) ou mouvements réunis (plusieurs)
      const lien = cx.length === 1 ? (() => { const l = c.grille.filter(g => (C.SYSTEMES[cx[0]] || []).includes(g)); return l.length ? "relié à " + etL(l) : ""; })()
        : cx.length ? [...new Set(cx.map(kc => C.NOM_MOUV[C.MOUV_CANAL[kc]]).filter(Boolean))].join(" / ") + (a.ensemble ? ", ensemble" : ", au choix") : "";
      // le texte libre n'est gardé que s'il dit autre chose que l'action et que ce qui est déjà écrit (« ajout possible… », « canal … — même place que … »)
      let texte = String(a.texte || "").replace(/\s*:\s*[A-Za-z+ ]{1,12}$/, "").trim();
      const nt = nrm(texte), na = nrm(action);
      if (!nt || /^(ajout possible|canal )/i.test(texte) || (na && (na.includes(nt) || nt.includes(na) || nt.slice(0, 24) === na.slice(0, 24)))) texte = "";
      return { cx, ensemble: a.ensemble, action: action || texte, texte: action ? texte : "", lien };
    }).filter(a => a.cx.length || a.action);
    const ajLigne = a => (a.cx.length ? a.cx.join(a.ensemble || a.cx.length < 2 ? " + " : " ou ") + (a.action ? " : " : "") : "") + this.h(a.action) + (a.lien ? ` (${this.h(a.lien)})` : "") + (a.texte ? " ; " + this.h(a.texte) : "");
    if (o.ajouts === "tableau" && AJ.length) b.push({ titre: "Ajouts possibles", env: ['<table class="aj">', "</table>"], tete: `<tr><th>Ajout</th><th>Dans quel cas</th></tr>`,
      rows: AJ.map(a => `<tr><td class="ajc">+ ${a.cx.map(badge).join(a.ensemble || a.cx.length < 2 ? "" : " ou ")}${a.lien ? `<small>${this.h(a.lien)}</small>` : ""}</td><td>${this.h(a.action) || "—"}${a.texte ? `<small>${this.h(a.texte)}</small>` : ""}</td></tr>`) });
    else if (o.ajouts === "liste" && AJ.length) b.push({ titre: "Ajouts possibles", env: ['<ul class="t">', "</ul>"], rows: AJ.map(a => `<li>${ajLigne(a)}</li>`) });
    else if (o.ajouts === "suivi") aj(this.blocSuivi("Ajouts possibles", AJ.map(ajLigne)));
    // associations de points : l'indication à gauche, les points en pastilles à droite (une ligne par canal)
    const pt = p => { const rem = C.commentairesDe(p).join(" ; "); return `<span class="pt">${this.h(C.clePoint(p) || p)}</span>` + (rem ? `<small class="rem">(${this.h(rem)})</small>` : ""); };
    const ordre = pts => [...c.grille, ...Object.keys(pts).filter(k => !c.grille.includes(k))].filter(k => (pts[k] || []).length);
    const TP = ['<table class="tp">', "</table>"], teteTP = `<tr><th>Pour…</th><th>Points</th></tr>`;
    const carte = (ind, pts, note, tag) => {
      const ajc = (c.ajouts || []).filter(x => (x.canaux || []).some(kc => (pts[kc] || []).length)).map(x => ({ canaux: x.canaux, ensemble: x.ensemble }));
      const dessines = new Set([...c.grille, ...C.AXE, ...ajc.flatMap(x => x.canaux)]);
      const hors = Object.keys(pts).filter(kc => !dessines.has(kc) && (pts[kc] || []).length);
      const pleins = Object.keys(pts).filter(kc => dessines.has(kc) && new Set((pts[kc] || []).map(p => C.clePoint(p)).filter(Boolean)).size > 3);   // le dessin n'écrit que trois points par canal : les autres sont listés dessous
      const svg = C.dessin({ grille: c.grille, figure: c.figure, ajouts: ajc }, { taille: 132, etiquettes: true, points: pts, ajouts: ajc.length > 0 });
      return `<div class="sch">${tag ? `<small class="tag">${tag}</small>` : ""}<p class="si"><strong>${this.h(ind[0] || "")}</strong>${ind.slice(1).map(x => `<span>${this.h(x)}</span>`).join("")}</p><div class="sd">${svg}</div>` +
        pleins.map(kc => `<small>${badge(kc)}${pts[kc].map(pt).join("")}</small>`).join("") +
        (hors.length ? `<small>+ ${hors.map(kc => pts[kc].map(pt).join("")).join(" ")}</small>` : "") + (note ? `<small>${note}</small>` : "") + `</div>`;
    };
    const paires = l => { const r = []; for (let i = 0; i < l.length; i += 2) r.push(`<div class="paire">${l[i]}${l[i + 1] || ""}</div>`); return r; };
    if (o.assoc === "schemas" && (c.associations || []).length) {
      b.push({ titre: "Associations de points", env: P, rows: paires(c.associations.map(a => carte(C.indicationsDe(a.tableau), a.points || {}, o.assocNotes && a.note ? this.h(a.note) : ""))) });
    } else if (o.assoc !== "non" && (c.associations || []).length) {
      const note = a => o.assocNotes && a.note ? `<small>${this.h(a.note)}</small>` : "";
      if (o.assoc === "tableau") b.push({ titre: "Associations de points", env: TP, tete: teteTP,
        rows: c.associations.map(a => `<tr><td class="lib">${this.h(a.tableau)}${note(a)}</td><td class="pts">${ordre(a.points || {}).map(k => a.points[k].map(pt).join("")).join("<br>")}</td></tr>`) });
      else b.push({ titre: "Associations de points", env: P,
        rows: c.associations.map(a => `<p class="lg"><strong>${this.h(a.tableau)}</strong> ${ordre(a.points || {}).flatMap(k => a.points[k].map(pt)).join("")}${note(a)}</p>`) });
    }
    // recettes de Wang Ju Yi, rangées par condition d'ajout : même lecture que les associations
    const wjy = o.wjy !== "non" ? C.recettesWjy(c).liste : [];
    if (wjy.length) {
      const grp = g => g.ajout.length ? "Avec ajout : " + g.ajout.join(" + ") : "Dans les quatre canaux, sans ajout";
      const couple = w => w.r.points.map(pt).join("");
      const ind = w => this.h((w.r.puces || [])[0] || w.r.groupe || "");
      const autres = w => o.wjyTout && (w.r.puces || []).length > 1 ? `<small>${w.r.puces.slice(1).map(x => this.h(x)).join(" · ")}</small>` : "";
      const G = C.wjyGroupes(wjy), rows = [];
      if (o.wjy === "schemas") {
        G.forEach(g => {
          rows.push(`<p class="sgrp grp">${grp(g)}</p>`);
          paires(g.items.map(({ w }) => { const pts = { ...w.r.canaux }; (w.r.axe || []).forEach(p => { const kc = (p.match(/^[A-Za-z]+/) || [""])[0].toUpperCase(); (pts[kc] = pts[kc] || []).push(p); });
            const pu = w.r.puces || []; return carte([pu[0] || w.r.groupe || "", ...(o.wjyTout ? pu.slice(1) : [])], pts, ""); })).forEach(x => rows.push(x));
        });
        b.push({ titre: "Recettes de Wang Ju Yi", env: P, rows });
      } else if (o.wjy === "tableau") {
        G.forEach(g => { rows.push(`<tr class="grp"><td colspan="2">${grp(g)}</td></tr>`); g.items.forEach(({ w }) => rows.push(`<tr><td class="lib">${ind(w)}${autres(w)}</td><td class="pts">${couple(w)}${w.r.vaisseaux ? `<small>${this.h(w.r.vaisseaux)}</small>` : ""}</td></tr>`)); });
        b.push({ titre: "Recettes de Wang Ju Yi", env: TP, tete: teteTP, rows });
      } else if (o.wjy === "cartes") {
        G.forEach(g => { rows.push(`<p class="sgrp grp">${grp(g)}</p>`); g.items.forEach(({ w }) => rows.push(`<div class="carte">${couple(w)}<span class="ind">${ind(w)}</span>${autres(w)}</div>`)); });
        b.push({ titre: "Recettes de Wang Ju Yi", env: ['<div class="cartes">', "</div>"], rows });
      } else b.push({ titre: "Recettes de Wang Ju Yi", env: P, rows: G.map(g => `<p class="suivi"><strong>${grp(g)} :</strong> ${g.items.map(({ w }) => couple(w)).join(" ")}</p>`) });
    }
    // points par canal : tes points retenus (★) et, selon le réglage, les points Tung rattachés à ce canal (pastille en pointillé)
    {
      const codes = [...new Set([...c.grille, ...(c.ajouts || []).flatMap(a => a.canaux || [])])];
      const tungDe = {};
      if (o.tung !== "non") try {
        const r = Tung.compatibles(c.grille, (c.ajouts || []).map(a => a.canaux || []));
        const mien = f => f.origine === "perso" || f.complete || (f.canaux || {}).statut === "toi";
        [...r.ok, ...(o.tungAjout ? r.avec : [])].filter(f => o.tung === "tous" || mien(f)).forEach(f => { const kc = codes.find(x => f.canaux.codes.includes(x)) || f.canaux.codes[0]; (tungDe[kc] = tungDe[kc] || []).push(f); });
      } catch (e) { /* points Tung indisponibles */ }
      const ficheT = p => { try { return Tung.parNom(String(p.point).replace(/\s*[:(].*$/, "")) || Tung.parNom(p.point); } catch (e) { return null; } };
      const retenusDe = kc => o.pointsRetenus ? C.ptsAffiches(kc, c).filter(x => C.retenu(x)) : [];
      const dejaT = new Set(codes.flatMap(kc => retenusDe(kc)).map(ficheT).filter(Boolean).map(f => f.id));       // un point Tung que tu as déjà retenu n'est pas répété
      const parCanal = [...new Set([...codes, ...Object.keys(tungDe)])].map(kc => ({ k: kc, pts: o.points !== "non" ? retenusDe(kc) : [], tung: o.tungForme === "cartes" ? [] : (tungDe[kc] || []).filter(f => !dejaT.has(f.id)) })).filter(x => x.pts.length || x.tung.length);
      const cl = p => ficheT(p) ? "pt tg" : "pt";
      const canal = kc => `<span class="canal${C.polarite(kc) === "yin" ? " yin" : ""}">${kc}</span>${this.h((C.canaux.get(kc) || {}).nom || "")}${c.grille.includes(kc) ? "" : " (ajout)"}`;
      const imgT = f => o.tungImages && (f.images || []).length ? `<span class="timg"><img alt="" data-rel="tung/images/${escapeHtml(f.images[0])}"></span>` : "";
      const nomT = f => this.h(f.nom), numT = f => (f.numeros || []).length ? this.h(f.numeros.join("/")) + " · " : "";
      const rows = [];
      if (parCanal.length && o.points === "tableau") {
        parCanal.forEach(x => {
          rows.push(`<tr class="grp gauche"><td colspan="2">${canal(x.k)}</td></tr>`);
          x.pts.forEach(p => rows.push(`<tr><td class="pn"><span class="${cl(p)}">${this.h(p.point)}</span></td><td>${this.h(p.action || "")}${p.commentaire ? " (" + this.h(p.commentaire) + ")" : ""}${ficheT(p) && o.tungForme !== "cartes" ? imgT(ficheT(p)) : ""}</td></tr>`));
          x.tung.forEach(f => rows.push(`<tr><td class="pn"><span class="pt tg">${nomT(f)}</span><small>${numT(f)}Tung</small></td><td>${this.h(Tung.action(f) || "")}${imgT(f)}</td></tr>`));
        });
        b.push({ titre: "Points par canal", env: ['<table class="pc">', "</table>"], rows });
      } else if (parCanal.length && o.points === "colonnes") {
        parCanal.forEach(x => {
          rows.push(`<p class="sgrp grp">${canal(x.k)}</p>`);
          x.pts.forEach(p => rows.push(`<p class="lg"><span class="${cl(p)}">${this.h(p.point)}</span>${p.action ? escapeHtml(this.court(p.action, 44)) : ""}</p>`));
          x.tung.forEach(f => rows.push(`<p class="lg"><span class="pt tg">${nomT(f)}</span>${escapeHtml(this.court(Tung.action(f) || "", 40))}${imgT(f)}</p>`));
        });
        b.push({ titre: "Points par canal", env: ['<div class="cartes libre">', "</div>"], rows });
      } else if (parCanal.length) b.push({ titre: "Points par canal", env: P, rows: parCanal.map(x => `<p class="lg"><span class="canal${C.polarite(x.k) === "yin" ? " yin" : ""}">${x.k}</span>${x.pts.map(p => `<span class="${cl(p)}">${this.h(p.point)}</span>`).join("")}${x.tung.map(f => `<span class="pt tg">${nomT(f)}</span>`).join("")}</p>`) });
      // points Tung en cartes : nom, numéro, canaux, image de localisation, localisation et action ; deux par rangée
      if (o.tungForme === "cartes" && o.tung !== "non") {
        const vus = new Set(), tousT = [];
        [...new Set([...codes, ...Object.keys(tungDe)])].forEach(kc => [...retenusDe(kc).map(ficheT).filter(Boolean), ...(tungDe[kc] || [])].forEach(f => { if (!vus.has(f.id)) { vus.add(f.id); tousT.push(f); } }));
        const loc = f => { const t = sansHanzi(Tung.localisation(f) || "").replace(/\s+/g, " ").trim(); return t.length > 170 ? t.slice(0, 168).replace(/\s+\S*$/, "") + "…" : t; };
        const carteT = f => `<div class="sch tc"><p class="si"><strong>${nomT(f)}</strong><span>${(f.numeros || []).length ? this.h(f.numeros.join(" · ")) + " " : ""}${((f.canaux || {}).codes || []).map(badge).join("")}</span></p>` +
          (o.tungImages && (f.images || []).length ? `<div class="sd timg"><img alt="" data-rel="tung/images/${escapeHtml(f.images[0])}"></div>` : "") +
          (loc(f) ? `<small><strong>Localisation :</strong> ${escapeHtml(loc(f))}</small>` : "") + (Tung.action(f) ? `<small>${this.h(Tung.action(f))}</small>` : "") + `</div>`;
        if (tousT.length) b.push({ titre: "Points Tung", env: P, rows: paires(tousT.map(carteT)) });
      }
    }
    // syndromes et formules
    if (o.sf !== "non") {
      const cles = [...new Set([...(c.syndromes_lies || []), ...((parCircuit && parCircuit.get(c.id)) || [])])];
      const synd = cles.map(k => C.libelleLie(k)).filter(l => !l.introuvable).map(l => this.h(l.nom));
      const formules = (c.formules || []).map(id => C.nomFormule(id)).filter(Boolean).map(n => this.h(n.nom) + (n.fr && o.sf === "tableau" ? " — " + this.h(n.fr) : ""));
      const lignes = [];
      if (o.syndCanaux && (c.syndromes || []).length) lignes.push(["Syndromes des canaux", c.syndromes.map(x => this.h(x)).join(" · ")]);
      if (synd.length) lignes.push(["Syndromes rattachés", synd.join(" · ")]);
      if (formules.length) lignes.push(["Pharmacopée", formules.join(o.sf === "tableau" ? "<br>" : " · ") + (c.formules_note ? (o.sf === "tableau" ? "<br>" : " ; ") + this.h(c.formules_note) : "")]);
      if (lignes.length && o.sf === "tableau") b.push({ titre: "Syndromes et formules", rows: lignes.map(([t, x]) => `<tr><td class="lib">${t}</td><td>${x}</td></tr>`) });
      else if (lignes.length) b.push({ titre: "Syndromes et formules", env: P, rows: lignes.map(([t, x]) => `<p class="suivi"><strong>${t} :</strong> ${x}</p>`) });
    }
    const notes = o.notes ? [...(c.notes || []), ...(c.notes_cours || [])] : [];
    aj(this.blocListe("Notes", notes));
    b.forEach(x => { x.c = nom; });
    return b;
  },

  morceau(bloc, rows, suite) { const e = bloc.env || ["<table>", "</table>"]; return `<h3>${this.h(bloc.titre)}${suite ? " (suite)" : ""}</h3>${e[0]}${bloc.tete || ""}${rows.join("")}${e[1]}`; },

  // ---------- mise en pages : les blocs sont posés l'un après l'autre ; un tableau ou une liste trop longs continuent page suivante, intitulé répété.
  // Rend [{ corps, courant }] ; l'entrée de sommaire d'un bloc « debut » reçoit l'indice de sa page.
  paginer(doc, blocs) {
    const mes = doc.querySelector("#mesure .corps"), ref = doc.createElement("div");
    ref.className = "corps"; ref.style.cssText = "position:absolute;visibility:hidden"; doc.body.appendChild(ref);
    const H = ref.getBoundingClientRect().height - 1; ref.remove();
    const tient = l => { mes.innerHTML = l.join(""); return mes.scrollHeight <= H; };
    const pages = []; let cur = [], courant = "";
    const tourner = () => { pages.push({ corps: cur.join(""), courant }); cur = []; courant = ""; };
    const poser = (html, b) => { if (!cur.length) courant = b.c || ""; cur.push(html); };
    blocs.forEach((b, i) => {
      if (!b.rows) {
        const suivant = b.avecSuivant ? blocs[i + 1] : null;                     // un titre ne reste pas seul en bas de page
        const sonde = suivant ? (suivant.rows ? this.morceau(suivant, suivant.rows.slice(0, 1)) : suivant.html) : "";
        if (cur.length && !tient([...cur, b.html, sonde])) tourner();
        if (b.debut) b.debut.page = pages.length;
        poser(b.html, b);
        return;
      }
      let reste = b.rows.slice(), suite = false, bandeau = "";
      const estGrp = x => /class="[^"]*grp/.test(x);
      while (reste.length) {
        if (suite && bandeau && !estGrp(reste[0])) reste.unshift(bandeau.replace(/(<\/td><\/tr>|<\/p>)$/, " (suite)$1"));
        let n = 0;
        while (n < reste.length && tient([...cur, this.morceau(b, reste.slice(0, n + 1), suite)])) n++;
        if (n && n < reste.length && /class="[^"]*grp/.test(reste[n - 1])) n--;      // un intitulé de groupe ne reste pas seul en bas de page
        if (!n) { if (cur.length) { tourner(); continue; } n = 1; }                 // une ligne plus haute que la page : elle passe quand même
        poser(this.morceau(b, reste.slice(0, n), suite), b);
        reste.slice(0, n).forEach(x => { if (estGrp(x)) bandeau = x.replace(" (suite)", ""); });
        reste = reste.slice(n);
        if (reste.length) { tourner(); suite = true; }
      }
    });
    if (cur.length) tourner();
    return pages;
  },

  // numéro à l'extérieur : à droite sur les pages impaires, à gauche sur les paires
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

  // ---------- index : indications (par catégorie), tableaux, syndromes ; chaque entrée renvoie à la page où commence son circuit
  CATEGORIES: [["Général", /^(|general|generale)$/], ["Shen", /^shen$/], ["Tête", /^tete$/], ["Neuro", /^neuro$/], ["Respiratoire, ORL", /^respir/], ["Cœur, sang", /^(coeur|sang)$/], ["Digestif", /^digest/],
    ["Urinaire, uro-génital", /^(urinaire|uro)/], ["Gynéco, andro", /^gyneco/], ["Peau, tissus", /^(dermato|tissus)/], ["Douleurs, carrosserie", /^(dou|carosserie|carrosserie)/], ["Pouls et langue", /^pouls/], ["Autres", /^autres$/]],
  categorie(titre) { const n = dsNorm(String(titre || "")).trim(); const c = this.CATEGORIES.find(x => x[1].test(n)); return c ? c[0] : String(titre).trim(); },
  groupesInd(c) {
    return (c.indications_groupes || []).map(g => {
      let titre = String(g.titre || "").trim(), items = (g.items || []).slice();
      if (!titre && items.length > 1 && /^[A-ZÀ-Ý ,'\/-]{3,40}$/.test(String(items[0]).trim())) { titre = String(items.shift()).trim().toLowerCase(); titre = titre.charAt(0).toUpperCase() + titre.slice(1); }
      else if (!titre && /^(POULS|LANGUE)\b/.test(String(items[0] || ""))) titre = "Pouls et langue";
      const connue = this.CATEGORIES.find(x => x[0] !== "Général" && x[1].test(dsNorm(titre).trim()));
      return { titre: titre ? (connue && !g.titre ? connue[0] : titre) : "Autres", items };
    }).filter(g => g.items.length);
  },
  // découpe un texte d'indications en entrées d'index. Une virgule ne sépare pas toujours deux indications :
  // « douleur du dos, des lombes » = douleur du dos + douleur des lombes (le mot principal est repris) ;
  // « liés au stress, à l'anxiété », « lombalgie, je mange, j'ai mal au dos », « digestion difficile, lente » restent une seule entrée.
  termes(texte, teteDefaut) {
    const protege = sansHanzi(String(texte || "")).replace(/\([^)]*\)/g, m => m.replace(/[,;:]/g, "\u0001"));        // pas de coupure dans une parenthèse
    const brut = protege.split(/[,;:]|…|\.\.\./).map(x => x.replace(/\u0001/g, ",").replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim()).filter(Boolean);
    const DE = /^(de la |de l['’]|du |des |de |d['’])/i, COMPL = /\s+(de la |de l['’]|du |des |de |d['’])/i;
    const SUITE = /^(à |au |aux |et |ou |je |j['’]|quand |si |qui |que |mais |surtout |avec |sans |car |donc |sauf |parfois |souvent |lié|due? |dus |dues )/i;
    const ADJ = /^(lente?s?|difficiles?|chroniques?|aigu[eë]s?|nocturnes?|diurnes?|fréquente?s?|abondante?s?|douloureuses?|douloureux|irréguli[eè]re?s?|sévères?|légère?s?|léger)$/i;
    const out = [];
    brut.forEach(f => {
      const prec = out[out.length - 1];
      if (DE.test(f)) {
        const i = prec ? prec.search(COMPL) : -1;                         // mot principal du terme précédent : « douleur » dans « douleur du dos »
        if (i > 0) out.push(prec.slice(0, i) + " " + f);
        else if (prec) out[out.length - 1] = prec + ", " + f;             // pas de mot principal reconnaissable : la phrase reste entière
        else out.push(teteDefaut ? teteDefaut + " " + f : f.replace(DE, ""));
      } else if (prec && (SUITE.test(f) || ADJ.test(f))) out[out.length - 1] = prec + ", " + f;
      else out.push(f);
    });
    return out.filter(x => x.length > 2);
  },
  lignesIndex(groupes) {           // groupes : Map(catégorie -> Map(clé -> { lib, pages: Set })) ; rend les lignes HTML, catégories dans l'ordre donné, entrées par ordre alphabétique
    const l = [];
    groupes.forEach((m, cat) => {
      if (!m.size) return;
      if (cat) l.push(`<p class="icat">${this.h(cat)}</p>`);
      [...m.values()].sort((a, b) => a.lib.localeCompare(b.lib, "fr", { sensitivity: "base" })).forEach(e => l.push(`<p class="ient"><span>${this.h(e.lib)}</span><i></i><b>${[...e.pages].sort((a, b) => a - b).join(", ")}</b></p>`));
    });
    return l;
  },
  index(circuits, pageDe) {
    const ajouter = (G, cat, lib, page) => { if (!G.has(cat)) G.set(cat, new Map()); const m = G.get(cat), cle = dsNorm(lib).trim(); if (!cle) return; if (!m.has(cle)) m.set(cle, { lib: lib.trim(), pages: new Set() }); m.get(cle).pages.add(page); };
    const ind = new Map(this.CATEGORIES.map(x => [x[0], new Map()])), tab = new Map([["", new Map()]]), synd = new Map();
    circuits.forEach(c => {
      const p = pageDe.get(c.id);
      const groupes = this.groupesInd(c);
      if (groupes.length) groupes.forEach(g => g.items.forEach(x => this.termes(x, /^dou/.test(dsNorm(String(g.titre || ""))) ? "douleur" : "").forEach(t => ajouter(ind, this.categorie(g.titre), t, p))));
      else (c.indications || []).forEach(x => this.termes(x).forEach(t => ajouter(ind, "Non classé", t, p)));
      (c.associations || []).forEach(a => { const t = sansHanzi(String(a.tableau || "")).replace(/[\s,.;]+$/, "").trim(); if (t) ajouter(tab, "", t.charAt(0).toUpperCase() + t.slice(1), p); });
      [...new Set([...(c.syndromes_lies || []), ...((this._parCircuit && this._parCircuit.get(c.id)) || [])])].forEach(k => {
        const l = Circuits.libelleLie(k); if (l.introuvable) return;
        ajouter(synd, l.entree ? ((Syndromes.domaineLabels || {})[l.entree.domaine] || "Autres") : "Ajoutés à la main", sansHanzi(l.nom), p);
      });
    });
    return { ind: this.lignesIndex(ind), tab: this.lignesIndex(tab), synd: this.lignesIndex(synd) };
  },
  // un index se lit sur deux colonnes ; on remplit chaque page jusqu'à ce que la deuxième colonne soit pleine
  paginerIndex(doc, titre, lignes) {
    const mes = doc.querySelector("#mesure .corps"), ref = doc.createElement("div");
    ref.className = "corps"; ref.style.cssText = "position:absolute;visibility:hidden"; doc.body.appendChild(ref);
    const H = Math.floor(ref.getBoundingClientRect().height) - 2; ref.remove();
    const fait = (l, suite) => `<div class="idx" style="height:${H}px"><h2 class="titre"><span>${titre}${suite ? " (suite)" : ""}</span></h2>${l.join("")}</div>`;
    const tient = (l, suite) => { mes.innerHTML = fait(l, suite); const d = mes.firstElementChild; return d.scrollWidth <= d.clientWidth + 1; };
    const pages = []; let i = 0;
    while (i < lignes.length) {
      const suite = pages.length > 0; let n = 0;
      while (i + n < lignes.length && tient(lignes.slice(i, i + n + 1), suite)) n++;
      if (n > 1 && i + n < lignes.length && /class="icat"/.test(lignes[i + n - 1])) n--;      // une catégorie ne reste pas seule en bas de page
      if (!n) n = 1;
      pages.push({ corps: fait(lignes.slice(i, i + n), suite), courant: titre });
      i += n;
    }
    return pages;
  },

  // ---------- compose toutes les pages selon les réglages, et les écrit dans la fenêtre
  composer(doc) {
    const o = this.o, BLANCHE = { corps: "" };
    doc.body.style.setProperty("--corps", o.taille + "pt");
    Circuits._nb = true;                                     // schémas en noir et blanc pour l'impression
    try {
      const pages = [], sommaire = [];
      const d = new Date(), date = [d.getDate(), d.getMonth() + 1].map(x => String(x).padStart(2, "0")).join(".") + "." + d.getFullYear();
      if (o.couverture) pages.push({ corps: `<div class="couv-titre">Circuits<br>thérapeutiques</div><div class="couv-sous">aide-mémoire</div><div class="couv-bas">Réseaux en acupuncture : équilibre global<br>aide-mémoire v.${date}</div>`, sansPied: true });
      if (o.legende) pages.push({ corps: this.pageLegende() });
      const iSomm = o.sommaire ? pages.push({ corps: "" }) - 1 : -1;
      const circuits = Circuits.liste.filter(c => !(o.exclus || []).includes(c.id));
      const entree = c => { const e = { id: c.id, nom: this.h(Circuits.nomCourt(c)), grille: c.grille.join(" · "), page: 0 }; sommaire.push(e); return e; };
      if (o.mode === "suite") {
        const base = pages.length;
        this.paginer(doc, circuits.flatMap(c => this.blocsCircuit(c, this._parCircuit, entree(c)))).forEach(p => pages.push(p));
        sommaire.forEach(e => { e.page += base + 1; });
      } else circuits.forEach(c => {
        if (o.mode === "double" && pages.length % 2 === 0) pages.push(BLANCHE);    // le circuit commence sur une page de gauche
        const e = entree(c), base = pages.length;
        this.paginer(doc, this.blocsCircuit(c, this._parCircuit, e)).forEach(p => pages.push(p));
        e.page += base + 1;
      });
      // index en fin de carnet
      if (o.indexInd || o.indexTab || o.indexSynd) {
        const ix = this.index(circuits, new Map(sommaire.map(e => [e.id, e.page])));
        [[o.indexInd, "Index des indications", ix.ind], [o.indexTab, "Index des tableaux", ix.tab], [o.indexSynd, "Index des syndromes", ix.synd]].forEach(([oui, titre, lignes]) => {
          if (!oui || !lignes.length) return;
          sommaire.push({ nom: titre, grille: "", page: pages.length + 1 });
          this.paginerIndex(doc, titre, lignes).forEach(p => pages.push(p));
        });
      }
      if (o.multiple4) {
        if (o.couverture) { while ((pages.length + 1) % 4 !== 0) pages.push(BLANCHE); pages.push({ corps: "", sansPied: true }); }   // la dernière page est la quatrième de couverture
        else while (pages.length % 4 !== 0) pages.push(BLANCHE);
      }
      if (iSomm >= 0) pages[iSomm] = { corps: `<h2 class="titre"><span>Sommaire</span></h2>` + sommaire.map(s => `<div class="somm"><b>${s.nom}</b><span>${s.grille}</span><i></i><span>${s.page}</span></div>`).join("") };
      const z = doc.getElementById("pages");
      z.className = "impaire";                               // à l'écran : la page 1 est seule à droite, puis les doubles pages
      z.innerHTML = pages.map((p, i) => this.page(i, p)).join("");
      z.querySelectorAll("img[data-rel]").forEach(async im => {
        try { im.src = Store.mode === "github" ? await Store.imageUrl(im.dataset.rel) : new URL("data/" + im.dataset.rel, location.href).href; }
        catch (e) { const s = im.closest(".timg"); if (s) s.remove(); }
      });
      const feuilles = Math.ceil(pages.length / 4);
      doc.getElementById("etat").innerHTML = `<strong>${pages.length} pages</strong> <span>(${circuits.length} circuit${circuits.length > 1 ? "s" : ""}, ${feuilles} feuille${feuilles > 1 ? "s" : ""} A4 en carnet). À l'impression : format A5, marges « Aucune », « Graphiques d'arrière-plan » coché.</span>`;
    } finally { Circuits._nb = false; }
  },

  panneau(doc) {
    const o = this.o, z = doc.getElementById("reglages");
    z.innerHTML = `<h4>Modèles</h4><div class="presets">${Object.entries(this.PRESETS).map(([k, p]) => `<button type="button" data-preset="${k}">${p.nom}</button>`).join("")}</div>
      <p class="petit">Un modèle règle tout d'un coup ; chaque rubrique peut ensuite être changée.</p>
      <h4>Mise en page</h4>${this.CHAMPS.slice(0, 2).map(c => this.champ(c)).join("")}
      <h4>Rubriques de chaque circuit</h4>${this.CHAMPS.slice(2).map(c => this.champ(c)).join("")}
      <h4>Pages et compléments</h4>${this.BOOLS.map(([k, lib]) => `<label class="case"><input type="checkbox" data-bool="${k}"${o[k] ? " checked" : ""}> ${lib}</label>`).join("")}
      <details><summary>Circuits inclus (${Circuits.liste.length - (o.exclus || []).filter(id => Circuits.parId(id)).length} sur ${Circuits.liste.length})</summary>
        ${Circuits.liste.map(c => `<label class="case"><input type="checkbox" data-circ="${escapeHtml(c.id)}"${(o.exclus || []).includes(c.id) ? "" : " checked"}> ${this.h(Circuits.nomCourt(c))} <span class="petit">${c.grille.join(" ")}</span></label>`).join("")}</details>`;
    const maj = panneauAussi => { this.garderOptions(); if (panneauAussi) this.panneau(doc); clearTimeout(this._t); this._t = setTimeout(() => { try { this.composer(doc); } catch (e) { doc.getElementById("etat").textContent = "Mise en page impossible : " + e.message; } }, 120); };
    z.querySelectorAll("[data-preset]").forEach(b => b.addEventListener("click", () => { this.o = { ...this.o, ...this.PRESETS[b.dataset.preset].o }; maj(true); }));
    z.querySelectorAll("select[data-k]").forEach(s => s.addEventListener("change", () => { this.o[s.dataset.k] = s.value; maj(); }));
    z.querySelectorAll("[data-bool]").forEach(x => x.addEventListener("change", () => { this.o[x.dataset.bool] = x.checked; maj(); }));
    z.querySelectorAll("[data-circ]").forEach(x => x.addEventListener("change", () => { const s = new Set(this.o.exclus || []); if (x.checked) s.delete(x.dataset.circ); else s.add(x.dataset.circ); this.o.exclus = [...s]; maj(); }));
  },
  champ(c) { return `<label>${c.lib}<select data-k="${c.k}">${c.choix.map(([v, lib]) => `<option value="${v}"${String(this.o[c.k]) === v ? " selected" : ""}>${lib}</option>`).join("")}</select></label>`; },

  async ouvrir() {
    const w = window.open("", "_blank");
    if (!w) { alert("Le navigateur a bloqué la nouvelle fenêtre. Autorise les fenêtres pour ce site, puis recommence."); return; }
    const doc = w.document;
    doc.open();
    doc.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Circuits thérapeutiques — aide-mémoire</title>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap"><style>${this.CSS}</style></head>
      <body><div class="barre"><button type="button" id="imprimer">Imprimer / Enregistrer en PDF</button><span id="etat">Mise en page en cours…</span></div>
      <div class="ecran"><div id="reglages"></div><div id="pages"></div></div><div id="mesure" class="page"><div class="corps"></div></div></body></html>`);
    doc.close();
    doc.getElementById("imprimer").addEventListener("click", () => w.print());
    try {
      this.lireOptions();
      await Circuits.ensureLoaded();
      try { await Tung.ensureLoaded(); } catch (e) { /* le carnet se fait sans les points Tung */ }
      this._parCircuit = null; try { this._parCircuit = await Circuits.syndromesParCircuit(); } catch (e) { /* sans les syndromes déduits */ }
      try { if (doc.fonts && doc.fonts.ready) await Promise.race([doc.fonts.ready, new Promise(r => setTimeout(r, 2500))]); } catch (e) { /* police de secours */ }
      await new Promise(r => setTimeout(r, 150));
      this.panneau(doc);
      this.composer(doc);
    } catch (e) { doc.getElementById("etat").textContent = "Mise en page impossible : " + e.message; }
  },

  init() {
    const b = document.getElementById("circuit-carnet");
    if (b) b.addEventListener("click", () => this.ouvrir());
  }
};
CarnetCircuits.init();
