# Assistant Diagnostic & Pharmacopée MTC

Outil personnel d'étude : structure le raisonnement diagnostique (huit règles, zang-fu, syndrome, principe de traitement) et cherche des formules **uniquement dans une base vérifiée**, construite à partir de tes propres PDF de cours — jamais depuis la mémoire générale d'un modèle de langage.

## Lancer l'outil

Depuis ce dossier :

```bash
python -m http.server 8792
```

Puis ouvrir `http://localhost:8792`. (Un simple double-clic sur `index.html` ne fonctionnera pas : le navigateur bloque le chargement des fichiers JSON en `file://`.)

## Synchronisation multi-appareils (GitHub)

Par défaut, l'app lit/écrit ses données JSON directement sur le disque local (via le bouton "✏️ Modifier cette fiche" et le formulaire "Ajouter une formule", tous deux basés sur la File System Access API — un seul appareil à la fois). Les **images restent toujours locales**, quel que soit le mode.

Pour accéder à la même base de données (formules, syndromes, points, cas cliniques, etc. — pas les images) depuis plusieurs appareils, tu peux activer le mode GitHub via le bouton **⚙ Synchronisation** en haut de l'app :

1. **Créer le dépôt** : sur github.com, crée un nouveau dépôt **privé** (ex. `mtc-assistant-data`).
2. **Pousser les données** : le contenu de ton dossier local `data/` (les sous-dossiers `formules/`, `syndromes/`, `psycho_emotionnel/`, `cas_pratique/`, `reference/`, et le fichier `tdah_transversal.json`) doit se retrouver **à la racine** de ce dépôt (pas dans un sous-dossier `data/`). Depuis ce dossier :
   ```bash
   cd data
   git init
   git remote add origin https://github.com/<ton-nom-utilisateur>/mtc-assistant-data.git
   git add .
   git commit -m "Import initial de la base de données"
   git branch -M main
   git push -u origin main
   ```
3. **Créer un token d'accès** : sur github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens → New token. Limite la portée au strict minimum : **Repository access** = seulement ce dépôt (`mtc-assistant-data`), **Permissions** = Contents: Read and write (rien d'autre). Copie le token généré (il ne sera plus jamais affiché).
4. **Configurer l'app** : bouton ⚙ Synchronisation → choisir "Dépôt GitHub privé" → renseigner le nom d'utilisateur, le nom du dépôt, la branche (`main`), et coller le token → "Tester la connexion" → "Enregistrer" → recharger la page.
5. Sur le deuxième appareil, refaire l'étape 4 (même dépôt, même token ou un second token dédié à cet appareil).

**Sécurité** : le token est stocké uniquement dans le `localStorage` du navigateur de chaque appareil, jamais transmis ailleurs qu'à l'API GitHub. Un token fine-grained limité à ce seul dépôt réduit fortement le risque en cas de fuite. Si tu changes d'avis, "Dossier local" dans le même panneau repasse l'app en mode local à tout moment.

**Limite à connaître** : ce n'est pas une synchro "live" instantanée entre appareils — chaque appareil lit l'état du dépôt au moment où tu recharges la page, et chaque sauvegarde écrit directement dessus. Si tu modifies la même fiche sur deux appareils sans recharger entre les deux, le second enregistrement écrasera le premier (pas de fusion automatique).

## Structure

```
Assistant-Diagnostic/
  index.html / style.css / app.js   → l'application (aucune dépendance, aucun build)
  data/
    formules/                       → approche "pharmacopée classique" (cours Zhong-Li)
      index.json / RAPPORT_EXTRACTION.md
      <categorie_id>/<id>.json
    psycho_emotionnel/               → cadre diagnostique Farrell (niveaux de latence + vaisseaux/confluences)
      niveaux/<id>.json
      vaisseaux/<id>.json
      index.json / RAPPORT_EXTRACTION.md
    approches_points/                → plusieurs "lentilles" de proposition de points, en parallèle
      reseaux_wang_ju_yi/             → couples de points par circuits/6 conformations (Wang Ju Yi)
      dr_tan/                         → Strategy of Twelve Points (groupes, patterns, cas d'étude)
      tung/                           → points de Maître Tung
      (farrell = data/psycho_emotionnel, réutilisé comme approche "vaisseaux extraordinaires")
      (zang_fu = pas de dossier séparé : c'est le raisonnement de la fiche de cas elle-même, étapes 2-4)
    approches_prescription/          → plusieurs "lentilles" de proposition de formule, en parallèle
      jing_fang/                     → Shang Han Lun (6 niveaux) + Jin Gui Yao Lue (jin_gui_yao_lue/)
      occidental/                    → herboristerie occidentale (Fiches-plantes)
      (pharmacopée classique = data/formules, réutilisée comme 3e approche)
    reference/                       → réservé pour une future intégration des bases
                                       substances/points du projet "Jeu" (jeuxmtc_clean)
  cas/                              → dossier suggéré pour ranger les cas exportés en JSON
                                       (voir bouton "Exporter ce cas" dans l'onglet Fiche de cas)
```

## Les approches (pourquoi plusieurs bases séparées)

L'outil ne propose jamais UNE réponse : pour un même cas, plusieurs traditions/auteurs peuvent proposer des points ou des formules différents, avec des logiques différentes. Chaque approche a sa propre base, extraite de sa propre source, pour ne jamais mélanger le raisonnement d'un auteur avec celui d'un autre :

**Côté points :**
| Approche | Source | Logique |
|---|---|---|
| Zang-Fu | (le cours standard, dans la fiche de cas elle-même) | Organe/syndrome → point d'indication classique |
| Farrell (Merveilleux Vaisseaux) | `psycho_emotionnel/` | Niveau de latence (Sinew/Luo/Distincts/8EV) + signature émotionnelle du vaisseau |
| Réseaux (Wang Ju Yi) | `approches_points/reseaux_wang_ju_yi/` | Couples de points reliés par les circuits des 6 conformations |
| Dr Tan | `approches_points/dr_tan/` | 12 points répartis en 4 groupes/patterns, pour tableaux où aucun méridien n'est isolément "malade" |
| Tung | `approches_points/tung/` | Points hors-méridiens classiques, logique d'image/miroir anatomique |

**Côté prescription :**
| Approche | Source | Logique |
|---|---|---|
| Pharmacopée classique | `formules/` | Catégories thérapeutiques modernes du cours (libère la surface, purge, harmonise...) |
| Jing Fang | `approches_prescription/jing_fang/` | Shang Han Lun + Jin Gui Yao Lue : les 6 stades, critères de prescription précis du texte classique |
| Occidental | `approches_prescription/occidental/` | Herboristerie occidentale (plantes, propriétés, contre-indications) |

Chaque approche a son propre `RAPPORT_EXTRACTION.md` — la fiabilité doit être vérifiée séparément pour chacune.

## État actuel de la base de formules

4 catégories extraites (23 formules) depuis `Zhong-Li/Cours/Pharmacopée/FORMULES` :
- 01 — Formules qui libèrent la surface
- 02 — Prescriptions qui purgent
- 03 — Prescriptions qui harmonisent
- 04 — Formules qui clarifient la chaleur

Il reste ~16 autres catégories traditionnelles de pharmacopée non encore couvertes par le cours (tonifiantes, qui réchauffent l'intérieur, qui font circuler le Qi, qui font circuler le Sang, astringentes, etc.) — elles seront ajoutées au fur et à mesure.

**Avant de t'appuyer sur une fiche pour réviser ou en clinique** : ouvre `data/formules/RAPPORT_EXTRACTION.md` et regarde les mentions `a_verifier` sur la fiche concernée — ce sont les champs que l'extraction automatique n'a pas pu lire avec certitude dans le PDF source. Recroise avec le PDF d'origine (indiqué dans le champ `source.fichier` de chaque fiche).

## Comment ajouter du nouveau contenu au fil de l'année (workflow général)

Tu vas recevoir de nouveaux cours toute l'année (nouveaux canaux d'acupuncture, nouvelles catégories de formules, nouvelles approches). Le principe est toujours le même, quel que soit le domaine :

1. **Tu me dis ce qui est arrivé** : "voici le nouveau cours sur le canal de la Vessie" / "j'ai ajouté tel livre pour telle approche" / "nouvelle catégorie de formules : tonifiantes du Qi". Pas besoin de préparer quoi que ce soit toi-même — juste me dire où sont les PDF (ou les ajouter dans `Bibliotheque`/`Zhong-Li/Cours` comme tu le fais déjà).
2. **Je choisis ou réutilise un domaine** : `formules/<categorie>`, `approches_points/<nom_approche>`, `approches_prescription/<nom_approche>`, ou un nouveau domaine si c'est vraiment inédit (ex. un jour peut-être `points_par_canal/` pour la base complète des 12 canaux).
3. **J'extrais fidèlement**, moi-même si la source est courte (je la lis directement et je construis les fichiers), ou via un agent de fond si c'est un gros PDF/livre scanné — toujours avec la même règle : rien n'est inventé, tout ce qui n'est pas explicite dans la source est marqué `null` + une note dans `a_verifier`.
4. **Un `RAPPORT_EXTRACTION.md` est produit** à chaque fois, avec la liste de ce qui doit être revérifié avant de t'y fier pour réviser ou en clinique.
5. **L'app se met à jour automatiquement** dès que les fichiers JSON existent — pas besoin de relancer quoi que ce soit, juste recharger la page.

Le seul cas où je te demande d'abord la permission avant de lancer l'extraction : quand la source est très volumineuse (ex. un livre scanné de plus de 50 Mo), parce que ça peut prendre beaucoup de temps/ressources — je te préviens et on décide ensemble de la priorité.

### Détail pour une nouvelle catégorie de formules (pharmacopée classique)

1. Range les PDF de la nouvelle catégorie dans `Zhong-Li/Cours/Pharmacopée/FORMULES/<NN>_<nom>` comme d'habitude.
2. Choisis un `categorie_id` court (ex. `05_tonifient_qi`).
3. Pour chaque formule, crée `data/formules/<categorie_id>/<id>.json` en suivant exactement ce schéma :

```json
{
  "id": "identifiant_court_en_minuscules_underscore",
  "pinyin": "Nom Pinyin Avec Tons Si Possible",
  "hanzi": "漢字 ou null",
  "nom_fr": "traduction française si le cours la donne, sinon null",
  "categorie_id": "05_tonifient_qi",
  "categorie_nom": "Nom complet de la catégorie",
  "sous_type": "sous-catégorie si pertinent, sinon null",
  "composition": [
    {"substance_pinyin": "...", "hanzi": null, "dose": "telle qu'écrite dans le cours", "role_hierarchique": "jun/chen/zuo/shi si mentionné"}
  ],
  "mode_de_preparation_posologie": "...",
  "actions_therapeutiques": "...",
  "indications_syndrome": "...",
  "tableau_clinique": "...",
  "contre_indications_precautions": "...",
  "modifications_courantes": "...",
  "comparaison_formules_proches": "...",
  "source": {"fichier": "chemin du PDF ou du support de cours"},
  "a_verifier": []
}
```

4. Ajoute une ligne correspondante dans `data/formules/index.json` :

```json
{
  "id": "identifiant_court",
  "pinyin": "Nom Pinyin",
  "nom_fr": "...",
  "categorie_id": "05_tonifient_qi",
  "categorie_nom": "Nom complet de la catégorie",
  "indications_syndrome": "résumé en une phrase",
  "chemin": "05_tonifient_qi/identifiant_court.json"
}
```

5. Recharge la page — la nouvelle formule apparaît automatiquement dans la recherche et les filtres par catégorie.

Tu peux aussi me redemander de faire l'extraction automatiquement à partir d'un nouveau dossier de PDF, avec la même règle : je n'invente rien, je marque `a_verifier` tout ce qui n'est pas explicite dans le PDF.

## Intégrer les bases substances / points du Jeu (`jeuxmtc_clean`)

Pas encore fait volontairement : ce projet est en développement actif dans une autre conversation, et sa structure de données peut encore bouger. Quand tu seras prête, on pourra exporter un instantané (substances médicinales, points) vers `data/reference/` et brancher un onglet "Substances" / "Points" ici, sans toucher au projet Jeu.

## "Est-ce que l'outil peut me dire si mon diagnostic est faux ?"

Non, pas au sens où il jugerait ton raisonnement clinique à ma place — ce serait moi qui invente un avis d'autorité sans base fiable, exactement ce que cet outil essaie d'éviter. Ce qui est prévu et fiable :

1. **Vérificateur de cohérence** : recoupe ce que tu as saisi (syndrome, formule/points choisis) contre les indications *documentées dans la base vérifiée* — si ça ne correspond pas à la fiche de la formule ou du point elle-même, l'outil te le signale.
2. **Détecteur d'incohérence interne** : signale les contradictions entre tes propres champs (ex. "Froid" en Ba Gang + pouls "rapide" sans note).
3. **Tuteur Farrell** (à venir, une fois `psycho_emotionnel/` complet) : te teste sur des questions dont la bonne réponse est déjà dans la base vérifiée, et compare vraiment ta réponse à la fiche extraite — un vrai corrigé, pas une opinion.

## Sources en attente (permission requise avant extraction)

- **Jeffrey Yuen** (`Divergent-channels Jeffrey Yuen.pdf` 127 Mo, `Luo-vessels-by-j-yuen.pdf` 17 Mo, `sinew-channels-by-j-yuen001_compress.pdf` 9 Mo) : sources originales dont Farrell et Twicken sont les élèves. Volontairement mises de côté vu leur taille (scans probablement très longs à traiter) — à traiter en dernier, seulement si le temps/les ressources le permettent, et seulement avec accord explicite avant de lancer.

## Limites importantes

- Les étapes 2 à 5 de la fiche de cas (différenciation, syndrome, principe de traitement) sont **à remplir par toi** — l'outil structure, il ne diagnostique pas.
- La recherche de formules/points ne renvoie que ce qui est dans une base vérifiée. Rien ne remonte ⇒ le sujet n'est pas encore couvert par les sources extraites, pas une absence de solution en MTC.
- Chaque approche (Farrell, Wang Ju Yi, Tan, Tung, Jing Fang, occidental...) reflète la logique de SA source ; elles peuvent proposer des choses différentes pour le même cas, c'est normal et volontaire — l'outil ne tranche pas entre elles.
- Cet outil n'est pas un dispositif médical et ne remplace pas une supervision clinique.
