"use strict";

/* ============================= Prescription directe =============================
   On saisit une formule et ses ajouts ; l'assistant cherche le meilleur format (SINOLUX) dans le budget du patient.
   Chaque prescription est un onglet à part (on peut en ouvrir plusieurs) ; leur contenu reste dans CE navigateur : il n'est jamais synchronisé.
   Dépend de app.js : Formules, Sinolux, escapeHtml ; de onglets.js : Onglets. */

const Prescription = {
  // préférence des formats (le premier qui rentre dans le budget est conseillé)
  PRIO: {
    efficacite: { nom: "Dose et fidélité à la décoction d'abord", ordre: ["DH", "CP", "RP", "CAPS", "WAN", "PIAN"] },
    commodite: { nom: "Commodité d'abord (comprimés, gélules)", ordre: ["PIAN", "CAPS", "WAN", "CP", "RP", "DH"] },
    prix: { nom: "Le moins cher d'abord", ordre: [] }
  },
  defaut() { return { formule: "", ajouts: [], poids: 70, jours: 30, budget: "", prio: "efficacite" }; },
  e2(x) { return x.toFixed(2).replace(".", ","); },

  // meilleur format : parmi ceux qui rentrent dans le budget, le premier selon la préférence
  conseille(lignes, budget, prio) {
    const dedans = budget > 0 ? lignes.filter(l => l.pat <= budget) : lignes;
    if (!dedans.length) return null;
    if (prio === "prix" || !this.PRIO[prio]) return [...dedans].sort((a, b) => a.pat - b.pat)[0];
    const ordre = this.PRIO[prio].ordre;
    return [...dedans].sort((a, b) => (ordre.indexOf(a.format) - ordre.indexOf(b.format)) || (a.pat - b.pat))[0];
  },

  async rendre(zone, e, changer) {
    try { await Sinolux.ensureLoaded(); } catch (x) { /* tarifs indisponibles */ }
    const f = e.formule ? Formules.byId.get(e.formule) : null;
    zone.innerHTML = `<section class="prescr">
      <h3>Prescription</h3>
      <div class="prescr-rang">
        <label>Formule<input type="search" class="pr-formule" value="${escapeHtml(f ? (f.pinyin || f.id) : "")}" placeholder="pinyin ou nom français" autocomplete="off"></label>
        <ul class="prop-sugg pr-sugg"></ul>
      </div>
      <div class="prescr-rang">
        <label>Ajouts (une substance, avec sa dose si tu veux)<span class="prescr-ajout"><input type="text" class="pr-ajout" placeholder="ex. Gān Jiāng 6 g" autocomplete="off"><button type="button" class="reseau-ic2 pr-ajout-btn" title="Ajouter" aria-label="Ajouter cet ajout">＋</button></span></label>
        <div class="prop-choisis pr-ajouts">${e.ajouts.map((a, i) => `<span class="chosen-item">${escapeHtml(a)}<button type="button" data-i="${i}" aria-label="Retirer">✕</button></span>`).join("") || `<span class="muted">Aucun ajout : formule seule.</span>`}</div>
      </div>
      <div class="prop-champs prescr-champs">
        <label>Poids<input type="number" class="pr-poids" min="5" max="250" value="${escapeHtml(String(e.poids))}"> kg</label>
        <label>Durée<input type="number" class="pr-jours" min="1" max="365" value="${escapeHtml(String(e.jours))}"> jours</label>
        <label>Budget<input type="number" class="pr-budget" min="0" step="5" value="${escapeHtml(String(e.budget))}" placeholder="facultatif"> €</label>
        <label>Priorité<select class="pr-prio">${Object.entries(this.PRIO).map(([k, v]) => `<option value="${k}"${e.prio === k ? " selected" : ""}>${escapeHtml(v.nom)}</option>`).join("")}</select></label>
      </div>
      <div class="pr-res"></div>
    </section>`;
    const q = s => zone.querySelector(s);
    const garde = () => { if (changer) changer(); };
    this.resultat(zone, e);
    // formule : suggestions
    const sugg = q(".pr-sugg"), champ = q(".pr-formule"), norm = t => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    champ.addEventListener("input", () => {
      const mots = norm(champ.value).split(/\s+/).filter(Boolean);
      if (!mots.length) { sugg.innerHTML = ""; return; }
      const l = (Formules.index || []).filter(x => mots.every(m => norm((x.pinyin || x.id) + " " + (x.nom_fr || "")).includes(m))).slice(0, 10);
      sugg.innerHTML = l.map(x => `<li data-id="${escapeHtml(x.id)}"><strong>${escapeHtml(x.pinyin || x.id)}</strong> <span class="muted">${escapeHtml(x.nom_fr || "")}</span></li>`).join("") || `<li class="muted">Aucune formule de ce nom.</li>`;
      sugg.querySelectorAll("li[data-id]").forEach(li => li.addEventListener("click", () => { e.formule = li.dataset.id; sugg.innerHTML = ""; garde(); this.rendre(zone, e, changer); }));
    });
    // ajouts
    const ajoute = () => { const i = q(".pr-ajout"), v = i.value.trim(); if (!v) return; e.ajouts.push(v); garde(); this.rendre(zone, e, changer); };
    q(".pr-ajout-btn").addEventListener("click", ajoute);
    q(".pr-ajout").addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); ajoute(); } });
    zone.querySelectorAll(".pr-ajouts button[data-i]").forEach(b => b.addEventListener("click", () => { e.ajouts.splice(+b.dataset.i, 1); garde(); this.rendre(zone, e, changer); }));
    // réglages : le résultat se met à jour tout de suite
    const reglage = (cls, cle, conv) => q(cls).addEventListener("input", ev => { e[cle] = conv(ev.target.value); garde(); this.resultat(zone, e); });
    reglage(".pr-poids", "poids", v => v);
    reglage(".pr-jours", "jours", v => v);
    reglage(".pr-budget", "budget", v => v);
    q(".pr-prio").addEventListener("change", ev => { e.prio = ev.target.value; garde(); this.resultat(zone, e); });
  },

  resultat(zone, e) {
    const el = zone.querySelector(".pr-res");
    if (!el) return;
    if (!e.formule) { el.innerHTML = `<p class="muted">Choisis une formule pour voir les formats possibles.</p>`; return; }
    if (typeof Sinolux === "undefined" || !Sinolux.pret()) { el.innerHTML = `<p class="muted">Les tarifs SINOLUX ne sont pas disponibles.</p>`; return; }
    const poids = Math.max(5, Math.min(250, parseFloat(e.poids) || 70)), jours = Math.max(1, Math.min(365, parseInt(e.jours, 10) || 30)), budget = parseFloat(e.budget) || 0;
    const modif = e.ajouts.length > 0;
    const r = Sinolux.calcul(e.formule, poids, jours, modif);
    const best = this.conseille(r.lignes, budget, e.prio), e2 = this.e2;
    const code = r.code ? `Code SINOLUX <span class="sx-code">${escapeHtml(r.code.code)}</span> · ${Sinolux.formatsTexte(r.code).map(escapeHtml).join(", ")}` : "Pas de code « toute prête » pour cette formule : composition sur mesure";
    const moinsCher = [...r.lignes].sort((a, b) => a.pat - b.pat)[0];
    const reco = best
      ? `<div class="prescr-reco"><span class="prescr-etoile">★</span> <strong>${escapeHtml(best.format)}</strong> <span class="muted">${escapeHtml(best.lib)}</span> — ${escapeHtml(best.dose)} par jour, ${escapeHtml(best.qte)} : <strong>${e2(best.pat)} €</strong> pour ${jours} jours${budget > 0 ? ` (budget ${e2(budget)} €)` : ""}</div>`
      : `<div class="sx-alerte">Aucun format ne rentre dans ${e2(budget)} € pour ${jours} jours : le moins cher est ${escapeHtml(moinsCher.format)} (${escapeHtml(moinsCher.lib)}) à ${e2(moinsCher.pat)} €, soit ${e2(moinsCher.pat - budget)} € de plus. On peut réduire la durée ou la dose.</div>`;
    const lignes = r.lignes.map(l => {
      const hors = budget > 0 && l.pat > budget, c = best && l === best;
      return `<tr class="${hors ? "hors-budget" : ""}${c ? " conseille" : ""}"><td>${c ? "★ " : ""}<strong>${escapeHtml(l.format)}</strong> <span class="muted">${escapeHtml(l.lib)}</span></td><td>${escapeHtml(l.dose)}</td><td>${escapeHtml(l.qte)}</td><td><strong>${e2(l.pat)} €</strong>${hors ? ` <span class="muted">hors budget</span>` : ""}</td></tr>`;
    }).join("");
    el.innerHTML = `<p class="muted">${code}${modif ? " · avec ajouts : formes sur mesure seulement (poudres, herbes, gélules)" : ""}</p>` + reco +
      `<div class="sx-defile"><table class="sx-tab"><thead><tr><th>Format</th><th>Dose / jour</th><th>À commander</th><th>Prix patient</th></tr></thead><tbody>${lignes}</tbody></table></div>` +
      (modif ? `<p class="muted">Ajouts à demander au laboratoire : ${e.ajouts.map(escapeHtml).join(" ; ")}.</p>` : "") +
      `<p class="muted sx-note">Tarifs SINOLUX 2026_2 TTC ; prix patient = prix thérapeute + 15 %, hors frais de port. Les ajouts ne sont pas chiffrés à part : la composition sur mesure suit le tarif « composition de votre choix ». Dose : posologie du laboratoire pour ce poids, à adapter.</p>`;
  }
};

/* ============================= Comparaison de circuits =============================
   Deux circuits côte à côte : schéma, mots clés, canaux (en commun ou non), indications, actions, ajouts. Un onglet par comparaison (on peut en ouvrir plusieurs). */
const ComparaisonCircuits = {
  MAX: 4,
  defaut() { return { ids: [] }; },
  async rendre(zone, e, changer) {
    try { await Circuits.ensureLoaded(); } catch (x) { zone.innerHTML = `<p class="muted">Circuits indisponibles.</p>`; return; }
    if (!Array.isArray(e.ids)) e.ids = [e.a, e.b].filter(Boolean);                       // ancien format : deux circuits a et b
    e.ids = e.ids.filter(id => Circuits.parId(id)).slice(0, this.MAX);
    const L = e.ids.map(id => Circuits.parId(id));
    const commun = L.length > 1 ? L[0].grille.filter(k => L.every(c => c.grille.includes(k))) : [];
    const reste = Circuits.liste.filter(c => !e.ids.includes(c.id));
    const maj = () => { if (changer) changer(); this.rendre(zone, e, changer); };
    const liste2 = (t, l, n) => l && l.length ? `<h4>${t}</h4><ul>${l.slice(0, n).map(x => `<li>${escapeHtml(sansHanzi(x))}</li>`).join("")}${l.length > n ? `<li class="muted">… (+${l.length - n})</li>` : ""}</ul>` : "";
    const colonne = c => {
      const seuls = c.grille.filter(k => !L.some(o => o !== c && o.grille.includes(k)));
      const ajouts = (c.ajouts || []).filter(a => (a.canaux || []).length).map(a => Circuits.ajoutLigne({ canaux: a.canaux, ensemble: a.ensemble, action: "", texte: "" }, c.grille));
      return `<div class="cmpc-col"><div class="cmpc-tete"><h3><button type="button" class="circ-lien-couple" data-circ-fiche="${escapeHtml(c.id)}" title="Ouvrir la fiche du circuit">${escapeHtml(Circuits.nomCourt(c))}</button></h3><button type="button" class="reseau-ic2" data-x="${escapeHtml(c.id)}" title="Retirer de la comparaison" aria-label="Retirer de la comparaison">✕</button></div>
        ${(c.mots_cles || []).length ? `<ul class="circ-motscles">${c.mots_cles.map(m => `<li>${escapeHtml(m)}</li>`).join("")}</ul>` : ""}
        <div class="circ-sch-dessin">${Circuits.dessin(c, { taille: 170, etiquettes: true })}</div>
        ${L.length > 1 ? `<p class="cmpc-canaux">${c.grille.map(k => `<span class="${commun.includes(k) ? "commun" : "seul"}">${Circuits.pastilleCanal(k)}</span>`).join(" ")} <span class="muted">${seuls.length ? "seuls ici : " + seuls.join(", ") : ""}</span></p>` : ""}
        ${liste2("Indications", c.indications, 6)}${liste2("Actions", c.actions, 6)}${ajouts.length ? `<h4>Ajouts possibles</h4><ul>${ajouts.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}</div>`;
    };
    zone.innerHTML = `<section class="cmpc"><h3>Comparaison de circuits</h3>
      <div class="cmpc-choix">${L.length < this.MAX ? `<select class="cc-plus" aria-label="Ajouter un circuit à la comparaison"><option value="">＋ Ajouter un circuit…</option>${reste.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(Circuits.nomCourt(c))} (${c.grille.join(" ")})</option>`).join("")}</select>` : `<span class="muted">${this.MAX} circuits au maximum.</span>`}</div>
      ${L.length > 1 ? `<p class="cmpc-resume">${commun.length ? "Canaux communs à tous : " + commun.map(k => Circuits.pastilleCanal(k)).join(" ") : "Aucun canal commun à tous."}</p>` : ""}
      <div class="cmpc-cols">${L.length ? L.map(colonne).join("") : `<div class="cmpc-col cmpc-vide muted">Ajoute au moins deux circuits.</div>`}</div></section>`;
    const s = zone.querySelector(".cc-plus");
    if (s) s.addEventListener("change", ev => { if (ev.target.value) { e.ids.push(ev.target.value); maj(); } });
    zone.querySelectorAll("[data-x]").forEach(b => b.addEventListener("click", () => { e.ids = e.ids.filter(id => id !== b.dataset.x); maj(); }));
  }
};
