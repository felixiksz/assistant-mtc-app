/* ============================================================
   theme.js — thèmes de couleurs (mêmes paires fond / lettres que le jeu)
   Chaque thème est une paire « fond + lettres ». Le reste de la palette
   (panneaux, filets, texte atténué, accent, couleurs des natures de
   perversité…) est calculé à partir de cette paire, et le contraste est
   vérifié (WCAG) : lettres/fond visé à 7:1, texte atténué et couleurs
   sémantiques à 4,5:1 au minimum.
   ============================================================ */
(function () {
  "use strict";

  // [nom, second nom, fond, lettres, mode spécial]
  const THEMES = [
    ["Mode labo photo", "", "#000000", "#FF3B1F"],
    ["Mode nuit", "", "#271629", "#FCFCFA"],
    ["Tasman", "Blue Gem", "#CFDDCD", "#5616AF"],
    ["Fern Frond", "Confetti", "#576B1B", "#EBD957"],
    ["Wistful", "Blue Gem", "#A7AFD3", "#2F0899"],
    ["Snuff", "Fern Frond", "#E6DDE9", "#51712B"],
    ["Logan", "Brown Rust", "#B2B2D2", "#A8503C"],
    ["Mischka", "Blue", "#DFD8E6", "#1D07E4"],
    ["Bleached Cedar", "Portage", "#352542", "#7D9AE3"],
    ["Orange Roughy", "Swans Down", "#BA561F", "#D8EDED"],
    ["Martinique", "Ochre", "#302E4A", "#CF7E23"],
    ["Japanese Laurel", "Starship", "#036F02", "#F0DD48"],
    ["Prelude", "Pueblo", "#D2CDEA", "#74301C"],
    ["Blue Gem", "Screamin' Green", "#4B15BB", "#93F06A"],
    ["Mischka", "Japanese Laurel", "#D4D6E6", "#0E7E07"],
    ["Royal Blue", "Crater Brown", "#5F59DF", "#4A2724"],
    ["Tasman", "Dark Blue", "#D1DBD5", "#2B03D3"]
  ];

  const KEY_THEME = "mtc_assistant_theme";
  const KEY_BOOST = "mtc_assistant_theme_boost";
  const TARGET_INK = 7;      // lettres / fond (AAA)
  const TARGET_TEXT = 4.5;   // texte atténué, couleurs sémantiques (AA)
  const TARGET_UI = 3;       // éléments graphiques (accent / fond)

  /* ---------- couleurs ---------- */
  const hex2rgb = h => { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const rgb2hex = c => "#" + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const x = hex2rgb(a), y = hex2rgb(b); return rgb2hex(x.map((v, i) => v + (y[i] - v) * t)); };
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = h => { const [r, g, b] = hex2rgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const minContrast = (c, surfaces) => Math.min(...surfaces.map(s => contrast(c, s)));

  function rgb2hsl(h) {
    const [r, g, b] = hex2rgb(h).map(v => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(hue * 60 + 360) % 360, s, l];
  }
  function hsl2hex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return rgb2hex([r + m, g + m, b + m].map(v => v * 255));
  }

  // rapproche une couleur du blanc ou du noir (teinte conservée) jusqu'à atteindre le contraste visé
  function pushContrast(c, surfaces, target, dir) {
    if (minContrast(c, surfaces) >= target) return c;
    for (let t = 0.02; t <= 1.0001; t += 0.02) {
      const cand = mix(c, dir, t);
      if (minContrast(cand, surfaces) >= target) return cand;
    }
    return dir;   // extrême atteint : on garde le meilleur possible (le fond sera alors ajusté)
  }

  // règle la luminosité d'une teinte fixe pour atteindre le contraste visé sur toutes les surfaces
  function huePush(h, s, l0, surfaces, target) {
    for (let d = 0; d <= 0.5; d += 0.01) {
      for (const l of [l0 + d, l0 - d]) {
        if (l < 0.04 || l > 0.96) continue;
        const cand = hsl2hex(h, s, l);
        if (minContrast(cand, surfaces) >= target) return cand;
      }
    }
    return minContrast("#ffffff", surfaces) >= minContrast("#000000", surfaces) ? "#ffffff" : "#000000";
  }

  const bestOn = c => (contrast(c, "#000000") >= contrast(c, "#ffffff") ? "#000000" : "#ffffff");

  // fond clair + lettres foncées, ou l'inverse : la polarité de la paire d'origine est toujours conservée
  function panelOf(bg, lightInk) { return lightInk ? mix(bg, "#ffffff", 0.05) : mix(bg, "#ffffff", 0.45); }

  /* ---------- calcul de la palette ---------- */
  function palette(bg0, fg0, boost) {
    const lightInk = lum(fg0) > lum(bg0);
    const toward = lightInk ? "#ffffff" : "#000000";   // sens dans lequel on renforce les lettres
    const away = lightInk ? "#000000" : "#ffffff";     // sens dans lequel on éloigne le fond si besoin
    let bg = bg0, ink = fg0, panel = panelOf(bg, lightInk);
    if (boost) {
      ink = pushContrast(fg0, [bg, panel], TARGET_INK, toward);
      if (minContrast(ink, [bg, panel]) < TARGET_INK) {
        // fond de ton moyen : on l'éloigne des lettres (assombrir / éclaircir) tant qu'il le faut
        for (let t = 0.04; t <= 0.6; t += 0.04) {
          const nb = mix(bg0, away, t), np = panelOf(nb, lightInk);
          const ni = pushContrast(fg0, [nb, np], TARGET_INK, toward);
          bg = nb; panel = np; ink = ni;
          if (minContrast(ni, [nb, np]) >= TARGET_INK) break;
        }
      }
    }
    const surfaces = [bg, panel];
    const rowAlt = mix(bg, ink, 0.06);
    const rowSection = mix(bg, ink, 0.16);
    const cellSec = mix(bg, ink, 0.28);
    const allSurf = [bg, panel, rowAlt, rowSection];

    // texte atténué : de l'encre vers le fond, aussi loin que le contraste (4,5:1) le permet
    let muted = ink;
    for (let t = 0.45; t >= 0; t -= 0.05) {
      const cand = mix(ink, bg, t);
      if (minContrast(cand, allSurf) >= TARGET_TEXT) { muted = cand; break; }
    }

    // accent : même teinte que les lettres du thème, vive, lisible avec du noir ou du blanc dessus
    const [hf, sf] = rgb2hsl(fg0), [hb, sb] = rgb2hsl(bg0);
    const hueAcc = sf >= 0.15 ? hf : sb >= 0.1 ? hb : 12;   // teinte des lettres du jeu, à défaut celle du fond
    let accent = null, bestD = 9;
    for (let l = 0.1; l <= 0.9; l += 0.01) {
      const cand = hsl2hex(hueAcc, 0.75, l);
      if (contrast(cand, bg) >= TARGET_UI && contrast(cand, bestOn(cand)) >= TARGET_TEXT && Math.abs(l - 0.5) < bestD) { accent = cand; bestD = Math.abs(l - 0.5); }
    }
    if (!accent) accent = ink;
    const accentSoft = mix(bg, accent, 0.18);

    // danger : rouge, lisible comme fond (texte noir/blanc dessus) et distinct du fond
    let danger = null; bestD = 9;
    for (let l = 0.1; l <= 0.9; l += 0.01) {
      const cand = hsl2hex(4, 0.85, l);
      if (contrast(cand, bg) >= TARGET_UI && contrast(cand, bestOn(cand)) >= TARGET_TEXT && Math.abs(l - 0.5) < bestD) { danger = cand; bestD = Math.abs(l - 0.5); }
    }
    if (!danger) danger = hsl2hex(4, 0.85, lum(bg) > 0.4 ? 0.38 : 0.68);

    // couleurs sémantiques (natures de perversité, bonne réponse) : teinte fixe, luminosité réglée
    const sem = (h, s, l) => huePush(h, s, l, allSurf, TARGET_TEXT);

    return {
      "--bg": bg, "--panel": panel, "--ink": ink, "--muted": muted, "--line": ink,
      "--accent": accent, "--accent-soft": accentSoft, "--danger": danger,
      "--on-accent": bestOn(accent), "--on-danger": bestOn(danger),
      "--row-alt": rowAlt, "--row-section": rowSection, "--cell-sec": cellSec,
      "--ok": sem(125, 0.65, 0.3),
      "--c-vent": sem(130, 0.6, 0.35), "--c-chaleur": sem(0, 0.7, 0.45), "--c-froid": sem(215, 0.8, 0.4),
      "--c-stase": sem(285, 0.55, 0.4), "--c-humidite": sem(45, 0.95, 0.35)
    };
  }

  /* ---------- application et mémoire ---------- */
  const root = document.documentElement;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignoré */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignoré */ } }
  };
  const boostOn = () => store.get(KEY_BOOST) !== "0";
  let VARS = [];

  function clearTheme() {
    VARS.forEach(v => root.style.removeProperty(v));
    VARS = [];
    root.style.removeProperty("color-scheme");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", "#000000");
  }

  function applyTheme(index) {
    clearTheme();
    if (index === null || !THEMES[index]) return;
    const t = THEMES[index];
    const pal = palette(t[2], t[3], boostOn());
    VARS = Object.keys(pal);
    VARS.forEach(k => root.style.setProperty(k, pal[k]));
    root.style.setProperty("color-scheme", lum(pal["--bg"]) < 0.4 ? "dark" : "light");   // barres de défilement, champs
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", pal["--bg"]);
  }

  const saved = store.get(KEY_THEME);
  const current = { index: saved !== null && saved !== "" && THEMES[+saved] ? +saved : null };
  applyTheme(current.index);

  /* ---------- interface ---------- */
  const nameOf = t => (t[1] ? t[0] + " & " + t[1] : t[0]);
  const ratio = r => r.toFixed(1).replace(".", ",") + ":1";

  function info(index) {
    const el = document.getElementById("theme-info");
    if (!el) return;
    if (index === null) { el.textContent = "Thème d'origine de l'assistant (blanc et rouge)."; return; }
    const t = THEMES[index], pal = palette(t[2], t[3], boostOn());
    const after = contrast(pal["--ink"], pal["--bg"]);
    const before = contrast(t[3], t[2]);
    el.textContent = nameOf(t) + " — contraste lettres/fond : " + ratio(after) +
      (boostOn() ? " (paire d'origine du jeu : " + ratio(before) + ")" : "");
  }

  function refresh() {
    document.querySelectorAll("#theme-grid button").forEach(b => {
      const i = b.dataset.theme === "" ? null : +b.dataset.theme;
      b.classList.toggle("on", i === current.index);
      b.setAttribute("aria-pressed", i === current.index ? "true" : "false");
    });
    info(current.index);
  }

  function renderGrid() {
    const grid = document.getElementById("theme-grid");
    if (!grid) return;
    grid.innerHTML = "";
    const add = (label, aria, bg, fg, idx) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.theme = idx === null ? "" : String(idx);
      b.textContent = "Aa";
      b.style.background = bg; b.style.color = fg;
      b.title = label; b.setAttribute("aria-label", aria);
      grid.appendChild(b);
    };
    add("Thème d'origine (blanc et rouge)", "Thème d'origine", "#ffffff", "#000000", null);
    THEMES.forEach((t, i) => {
      const pal = palette(t[2], t[3], boostOn());
      add(nameOf(t), "Thème " + nameOf(t).replace(/&/g, "et"), pal["--bg"], pal["--ink"], i);
    });
    refresh();
  }

  function build() {
    const btn = document.getElementById("theme-btn");
    const panel = document.getElementById("theme-panel");
    const grid = document.getElementById("theme-grid");
    if (!btn || !panel || !grid) return;
    renderGrid();

    const boost = document.getElementById("theme-boost");
    if (boost) boost.checked = boostOn();

    btn.addEventListener("click", () => {
      const open = panel.style.display === "none" || panel.style.display === "";
      panel.style.display = open ? "block" : "none";
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) panel.scrollIntoView({ block: "nearest" });
    });
    grid.addEventListener("click", e => {
      const b = e.target.closest("button[data-theme]");
      if (!b) return;
      current.index = b.dataset.theme === "" ? null : +b.dataset.theme;
      if (current.index === null) store.del(KEY_THEME); else store.set(KEY_THEME, String(current.index));
      applyTheme(current.index);
      refresh();
    });
    if (boost) boost.addEventListener("change", () => {
      store.set(KEY_BOOST, boost.checked ? "1" : "0");
      applyTheme(current.index);
      renderGrid();   // les aperçus suivent le réglage
    });
  }

  window.MTCTheme = { THEMES, palette, contrast, apply: applyTheme };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build, { once: true });
  else build();
})();
