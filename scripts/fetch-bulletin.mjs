#!/usr/bin/env node
/**
 * CSMART Weather — récupération du bulletin du domaine
 *
 * Produit bulletin.json, consommé par la page TV.
 * Aucun téléviseur n'interroge la source : un seul job la sollicite,
 * tous les écrans lisent le fichier publié.
 *
 *   node fetch-bulletin.mjs                 → télécharge et écrit bulletin.json
 *   node fetch-bulletin.mjs page.html       → lit un fichier local (mise au point)
 *
 * Structure de la source, relevée le 20/08/2026 :
 *   li[id^=slide]                     un point de mesure météo
 *   .card > .card-header .sector      nom du secteur
 *   .card-body                        une rubrique (remontées, pistes…)
 *     p.center                        libellé de la rubrique
 *     p.right > span.right_bold       nombre d'ouverts, suivi de /total
 *     .prl_group                      une remontée, une piste ou une activité
 *       img.img_type      → image/type/CODE.svg
 *       .prl_name .text   → nom
 *       .prl_name .subtext→ horaires
 *       .prl_message .text→ mention (pause, cadence…)
 *       .status img       → image/etats/ETAT.svg
 *
 * Le code d'icône porte deux informations : la famille avant le tiret
 * (TC, TSD, FUNI, ZL, LIAISON…) et, après le tiret, la difficulté
 * (V, B, R, N, J). C'est de là que vient la couleur de chaque piste.
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import * as cheerio from "cheerio";

const SOURCE =
  "https://bulletin.lumiplan.pro/bulletin.php?station=les-arcs&region=alpes&pays=France";
const SORTIE = "bulletin.json";
const DELAI_MS = 20000;

/* Station de référence pour les indicateurs du bandeau.
   Arc 1950 se situe entre Arc 1800 et Arc 2000. */
const REFERENCE = "ARC 2000";

const ETATS = { O: "O", F: "F", HP: "F", P: "P" };
const COULEURS = { V: "v", B: "b", R: "r", N: "n", J: "k" };

/* Familles connues. Une famille inconnue n'est pas une erreur :
   elle est conservée telle quelle et signalée en fin d'exécution. */
const REMONTEES = ["FUNI","TC","TPH","TSD","TSDB","TS","TK","TB","TLC","TR","TSF","TPHB"];
const inconnus = new Set();

const propre = (s) => (s || "").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------------ */

async function telecharger(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DELAI_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "CSMART-Weather/1.0 (affichage en residence)" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

function codeIcone(src) {
  const m = (src || "").match(/image\/[a-z_]+\/([^/]+)\.svg/i);
  return m ? m[1] : "";
}

/* Sépare "TSD" ou "ZL-J" en famille et difficulté. */
function decoder(code) {
  const i = code.indexOf("-");
  if (i === -1) return { famille: code, couleur: "" };
  const famille = code.slice(0, i);
  const suffixe = code.slice(i + 1).toUpperCase();
  return { famille, couleur: COULEURS[suffixe] || "" };
}

function lireGroupe($, el) {
  const $g = $(el);
  const code = codeIcone($g.find("img.img_type").attr("src"));
  const { famille, couleur } = decoder(code);
  const etatBrut = codeIcone($g.find(".status img").attr("src")).toUpperCase();

  if (code && !REMONTEES.includes(famille) && !["ZL", "LIAISON", "PISTE", ""].includes(famille))
    inconnus.add(code);

  /* la source laisse parfois des points de suite : "CACHETTE." */
  const nom = (propre($g.find(".prl_name .text").first().text()) || propre($g.attr("title")))
    .replace(/[.\s]+$/, "");
  const horaires = propre($g.find(".prl_name .subtext").first().text());
  const message = propre($g.find(".prl_message .text").first().text());

  return {
    ty: REMONTEES.includes(famille) ? famille : "",
    c: couleur || (famille === "LIAISON" || famille === "ZL" ? "k" : ""),
    nm: nom,
    hr: horaires ? horaires.replace(/\s+/, "–") : "—",
    e: ETATS[etatBrut] || "F",
    no: message && !/^non[- ]stop$/i.test(message) ? message : undefined,
  };
}

/* ------------------------------------------------------------------ */

function extraire(html) {
  const $ = cheerio.load(html);
  const texte = $("body").text();

  const data = {
    ecusson: "LA",
    station: "LES ARCS",
    soustitre: "Arc 1950 · Paradiski · Bulletin du domaine",
    maj: null,
    source: "Lumiplan",
    hero: [],
    compteurs: [],
    altitudes: [],
    previsions: {},
    blocs: [],
  };

  /* --- horodatage de la source, préféré à l'heure du job --- */
  const m = texte.match(/Mise à jour le\s+(\d{2})\/(\d{2})\/(\d{4})\s+à\s+(\d{2}):(\d{2})/);
  if (m) data.maj = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`;

  /* --- points de mesure météo --- */
  $("li[id^=slide]").each((_, li) => {
    const $li = $(li);
    const entete = propre($li.find(".card-header div").last().text());
    const mm = entete.match(/^(.*?)\s*-\s*(\d+)\s*m$/i);
    if (!mm) return;

    const icones = $li.find(".left_weather .icon, .middle_weather .icon");
    const val = (i, sel) => propre($(icones[i]).find(sel).first().text());

    const alt = {
      lieu: mm[1].trim(),
      alt: parseInt(mm[2], 10),
      ciel: propre($li.find(".left_weather img.image").first().attr("title")),
      matin: val(0, ".bold"),
      aprem: val(1, ".bold"),
      vent: val(2, ".bold"),
      dir: propre($(icones[2]).find(".littleText").text()),
      neige24: val(3, ".bold"),
      qualite: val(3, ".text"),
      limite: val(4, ".bold"),
      derniereH: val(5, ".bold"),
      derniereD: val(5, ".text_italic"),
    };
    data.altitudes.push(alt);
  });

  /* --- prévisions ---
     La source colle le titre au corps du texte, faute d'un saut de ligne
     dans son gabarit : « …et oragesLe ciel est chaotique ». On sépare à
     la première minuscule suivie d'une majuscule. */
  const couper = (t) => {
    const i = t.search(/[a-zàâéèêëîïôùûüç][A-ZÉÈÀÂÎÔÙÛÇ]/);
    return i === -1
      ? { titre: "", corps: t }
      : { titre: propre(t.slice(0, i + 1)), corps: propre(t.slice(i + 1)) };
  };

  const prevs = $(".prevision");
  if (prevs.length >= 1) {
    const lire = (i) => {
      const $p = $(prevs[i]);
      const date = (propre($p.find(".text").first().text()).match(/\(([^)]+)\)/) || [])[1] || "";
      return { date, ...couper(propre($p.find(".subtext").first().text())) };
    };
    const j = lire(0);
    const l = prevs.length > 1 ? lire(1) : { date: "", titre: "", corps: "" };
    data.previsions = {
      jourDate: j.date, jourTitre: j.titre, jourTexte: j.corps,
      demainDate: l.date, demainTitre: l.titre, demainTexte: l.corps,
    };
  }

  /* --- secteurs, remontées, pistes --- */
  $(".card").each((_, card) => {
    const $c = $(card);
    const nom = propre($c.find(".card-header .sector").first().text());
    if (!nom) return;

    const bloc = { nom, sections: [] };

    $c.find(".card-body").each((__, body) => {
      const $b = $(body);
      const titre = propre($b.find("p.center").first().text());
      const ouvTxt = propre($b.find("p.right .right_bold").first().text());
      const totTxt = propre($b.find("p.right").first().text()).replace(/^\D*\d+\s*\/\s*/, "");

      const items = [];
      $b.find(".prl_group").each((___, g) => {
        const it = lireGroupe($, g);
        if (it.nm) items.push(it);
      });
      if (!items.length) return;

      bloc.sections.push({
        titre: titre || "Détail",
        ouv: ouvTxt ? parseInt(ouvTxt, 10) : items.filter((i) => i.e !== "F").length,
        tot: totTxt ? parseInt(totTxt, 10) : items.length,
        items,
      });
    });

    if (bloc.sections.length) data.blocs.push(bloc);
  });

  /* --- bandeau, calculé depuis les points de mesure --- */
  const ref = data.altitudes.find((a) => a.lieu === REFERENCE) || data.altitudes[0];
  const haut = data.altitudes.slice().sort((a, b) => b.alt - a.alt)[0];
  if (haut) {
    data.hero.push({ k: "Temp. sommet", v: `${haut.aprem}°`, l: haut.lieu, c: "" });
  }
  if (ref) {
    data.hero.push({ k: "Temp. station", v: `${ref.aprem}°`, l: `${ref.lieu} · ${ref.alt} m`, c: "n" });
    data.hero.push({ k: "Vent", v: `${ref.vent} km/h`, l: `Secteur ${ref.dir}`, c: "w" });
    data.hero.push({ k: "Limite pluie/neige", v: `${ref.limite} m`, l: "Altitude", c: "n" });
    data.hero.push({ k: "Neige sur 24 h", v: `${ref.neige24} cm`, l: ref.qualite || "Qualité non communiquée", c: "" });
    data.hero.push({ k: "Dernière chute", v: `+${ref.derniereH} cm`, l: ref.derniereD || "—", c: "" });
  }

  /* --- compteurs, recalculés depuis les listes plutôt que lus --- */
  let rmO = 0, rmT = 0, pO = 0, pT = 0;
  const parCouleur = { v: [0, 0], b: [0, 0], r: [0, 0], n: [0, 0], k: [0, 0] };

  for (const b of data.blocs) {
    for (const s of b.sections) {
      const remontee = /remont/i.test(s.titre);
      for (const it of s.items) {
        const ouvert = it.e !== "F";
        if (remontee) { rmT++; if (ouvert) rmO++; }
        else {
          pT++; if (ouvert) pO++;
          const c = it.c || "k";
          if (parCouleur[c]) { parCouleur[c][1]++; if (ouvert) parCouleur[c][0]++; }
        }
      }
    }
  }

  data.compteurs = [
    { p: "",  ouv: rmO, tot: rmT, l: "Remontées" },
    { p: "s", ouv: pO,  tot: pT,  l: "Pistes" },
    { p: "v", ouv: parCouleur.v[0], tot: parCouleur.v[1], l: "Vertes" },
    { p: "b", ouv: parCouleur.b[0], tot: parCouleur.b[1], l: "Bleues" },
    { p: "r", ouv: parCouleur.r[0], tot: parCouleur.r[1], l: "Rouges" },
    { p: "n", ouv: parCouleur.n[0], tot: parCouleur.n[1], l: "Noires" },
    { p: "o", ouv: parCouleur.k[0], tot: parCouleur.k[1], l: "Itinéraires" },
  ].filter((c) => c.tot > 0);

  return data;
}

/* ------------------------------------------------------------------ */

function verifier(d) {
  const e = [];
  if (!d.maj) e.push("horodatage absent");
  if (!d.blocs.length) e.push("aucun secteur");
  if (!d.altitudes.length) e.push("aucun point de mesure météo");
  const n = d.blocs.reduce((t, b) => t + b.sections.reduce((u, s) => u + s.items.length, 0), 0);
  if (n < 5) e.push(`seulement ${n} éléments`);
  const sansNom = d.blocs.some((b) => b.sections.some((s) => s.items.some((i) => !i.nm)));
  if (sansNom) e.push("des éléments sans nom");
  return e;
}

/* ------------------------------------------------------------------ */

async function main() {
  const local = process.argv[2];
  let html;
  try {
    html = local ? readFileSync(local, "utf8") : await telecharger(SOURCE);
  } catch (err) {
    console.error("Récupération impossible :", err.message);
    process.exit(1);
  }

  const data = extraire(html);
  const erreurs = verifier(data);

  if (erreurs.length) {
    console.error("Bulletin rejeté —", erreurs.join(", "));
    if (existsSync(SORTIE)) {
      const ancien = JSON.parse(readFileSync(SORTIE, "utf8"));
      console.error(`Fichier existant conservé (mis à jour le ${ancien.maj}).`);
    }
    process.exit(1);
  }

  writeFileSync(SORTIE, JSON.stringify(data, null, 2));

  const rm = data.compteurs[0] || { ouv: 0, tot: 0 };
  const pi = data.compteurs[1] || { ouv: 0, tot: 0 };
  console.log(
    `Bulletin écrit — ${data.blocs.length} secteurs · ` +
      `${rm.ouv}/${rm.tot} remontées · ${pi.ouv}/${pi.tot} pistes · ` +
      `mis à jour le ${data.maj}`
  );
  if (inconnus.size)
    console.warn("Codes d'icône non répertoriés :", [...inconnus].join(", "));
}

main();
