# Assistant Diagnostic & Pharmacopée MTC

Mon outil personnel d'étude en médecine traditionnelle chinoise. Il m'aide à structurer mon raisonnement diagnostique (huit règles, zang-fu, syndrome, principe de traitement) et à retrouver des formules, des points et des syndromes **uniquement dans une base que j'ai construite et vérifiée** à partir de mes cours et de mes livres de référence.

## Lancer l'outil

Depuis ce dossier :

```bash
python -m http.server 8792
```

Puis ouvrir `http://localhost:8792`. (Un double-clic sur `index.html` ne marche pas : le navigateur bloque le chargement des fichiers JSON en `file://`.)

## Synchronisation entre mes appareils (GitHub)

Par défaut, l'application lit et écrit les données JSON directement sur le disque local (bouton « ✏️ Modifier cette fiche » et formulaire « Ajouter une formule », qui utilisent la File System Access API — un seul appareil à la fois). Les **images restent toujours locales**.

Pour retrouver la même base (formules, syndromes, points, cas cliniques… sans les images) sur mon téléphone et mon ordinateur, j'active le mode GitHub avec le bouton **⚙ Synchronisation** en haut de l'application :

1. **Créer le dépôt** : sur github.com, un nouveau dépôt **privé** (ex. `mtc-assistant-data`).
2. **Pousser les données** : le contenu du dossier local `data/` (`formules/`, `syndromes/`, `psycho_emotionnel/`, `cas_pratique/`, `reference/`, `tdah_transversal.json`) doit se trouver **à la racine** de ce dépôt, pas dans un sous-dossier `data/` :
   ```bash
   cd data
   git init
   git remote add origin https://github.com/<mon-nom-utilisateur>/mtc-assistant-data.git
   git add .
   git commit -m "Import initial de la base de données"
   git branch -M main
   git push -u origin main
   ```
3. **Créer un token d'accès** : github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens → New token. Portée minimale : **Repository access** = ce seul dépôt, **Permissions** = Contents: Read and write. Le token n'est affiché qu'une fois : le copier tout de suite.
4. **Configurer l'application** : ⚙ Synchronisation → « Dépôt GitHub privé » → nom d'utilisateur, nom du dépôt, branche (`main`) et token → « Tester la connexion » → « Enregistrer » → recharger la page.
5. Sur un autre appareil, refaire l'étape 4 (même dépôt, même token ou un token dédié).

**Sécurité** : le token reste dans le `localStorage` du navigateur de chaque appareil et n'est envoyé qu'à l'API GitHub. « Dossier local » dans le même panneau remet l'application en mode local à tout moment.

**Limite** : ce n'est pas de la synchronisation instantanée. Chaque appareil lit l'état du dépôt au chargement de la page, et chaque sauvegarde écrit directement dessus. Si je modifie la même fiche sur deux appareils sans recharger entre les deux, la seconde sauvegarde écrase la première.

## Structure

```
Assistant-Diagnostic/
  index.html / style.css / app.js   → l'application (aucune dépendance, aucun build)
  data/
    formules/                       → pharmacopée classique
      index.json
      <categorie_id>/<id>.json
      tableaux/                     → tableaux comparatifs par famille
    psycho_emotionnel/               → cadre diagnostique Farrell (niveaux de latence + vaisseaux)
      niveaux/<id>.json
      vaisseaux/<id>.json
    approches_points/                → plusieurs lentilles de proposition de points, en parallèle
      reseaux_wang_ju_yi/             → couples de points par circuits / 6 conformations
      dr_tan/                         → Strategy of Twelve Points
      tung/                           → points de Maître Tung
    approches_prescription/          → plusieurs lentilles de proposition de formule, en parallèle
      jing_fang/                     → Shang Han Lun (6 niveaux) + Jin Gui Yao Lue
      occidental/                    → herboristerie occidentale
    reference/                       → bases substances et points
  cas/                              → cas cliniques exportés en JSON
                                       (bouton « Exporter ce cas » dans l'onglet Fiche de cas)
```

## Pourquoi plusieurs approches

Pour un même cas, plusieurs traditions ou auteurs proposent des points ou des formules différents, avec des logiques différentes. Chaque approche a donc sa propre base, tirée de sa propre source, pour ne jamais mélanger le raisonnement d'un auteur avec celui d'un autre. L'outil ne tranche pas entre elles.

**Points**
| Approche | Source | Logique |
|---|---|---|
| Zang-Fu | cours standard, dans la fiche de cas | Organe / syndrome → point d'indication classique |
| Farrell (Merveilleux Vaisseaux) | `psycho_emotionnel/` | Niveau de latence (Sinew / Luo / Distincts / 8EV) + signature émotionnelle du vaisseau |
| Réseaux (Wang Ju Yi) | `approches_points/reseaux_wang_ju_yi/` | Couples de points reliés par les circuits des 6 conformations |
| Dr Tan | `approches_points/dr_tan/` | 12 points en 4 groupes, pour les tableaux où aucun méridien n'est isolément « malade » |
| Tung | `approches_points/tung/` | Points hors méridiens classiques, logique d'image / miroir anatomique |

**Prescription**
| Approche | Source | Logique |
|---|---|---|
| Pharmacopée classique | `formules/` | Familles thérapeutiques du cours (libère la surface, purge, harmonise…) |
| Jing Fang | `approches_prescription/jing_fang/` | Shang Han Lun + Jin Gui Yao Lue : les 6 stades, critères de prescription du texte classique |
| Occidental | `approches_prescription/occidental/` | Plantes occidentales, propriétés, contre-indications |

## Base de formules

Les formules sont rangées par famille thérapeutique : libèrent la surface, purgent, harmonisent, clarifient la chaleur, tonifient… Certaines fiches portent des mentions `a_verifier` : ce sont les champs que je dois encore recouper avec la source d'origine (champ `source.fichier`) avant de m'y fier pour réviser ou en clinique.

## Ajouter du contenu

La démarche est la même pour un nouveau canal, une nouvelle famille de formules ou une nouvelle approche :

1. Choisir ou réutiliser un domaine : `formules/<categorie>`, `approches_points/<nom_approche>`, `approches_prescription/<nom_approche>`.
2. Saisir le contenu fidèlement à la source. Rien n'est inventé : ce qui n'est pas explicite dans la source reste `null`, avec une note dans `a_verifier`.
3. Recharger la page : l'application lit directement les fichiers JSON.

### Nouvelle famille de formules

1. Choisir un `categorie_id` court (ex. `05_tonifient_qi`).
2. Pour chaque formule, créer `data/formules/<categorie_id>/<id>.json` sur ce modèle (ou passer par le formulaire « Ajouter une formule ») :

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

3. Ajouter la ligne correspondante dans `data/formules/index.json` :

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

4. Recharger la page : la formule apparaît dans la recherche et dans les filtres par catégorie.

## Limites

- Les étapes 2 à 5 de la fiche de cas (différenciation, syndrome, principe de traitement) restent **à remplir par moi** : l'outil structure, il ne diagnostique pas.
- La recherche ne renvoie que ce qui figure dans la base. Rien ne remonte ⇒ le sujet n'est pas encore couvert, ce n'est pas une absence de solution en MTC.
- Chaque approche reflète la logique de sa source ; elles peuvent proposer des choses différentes pour le même cas, c'est voulu.
- Cet outil n'est pas un dispositif médical et ne remplace pas une supervision clinique.
