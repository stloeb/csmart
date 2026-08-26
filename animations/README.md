# Animations du village — Arc 1950

Page d'affichage du programme d'animations d'Arc 1950 pour **CSMART TV** et
**CSMART Hospitality Mobile**, sur le même principe que le wrapper Lumiplan :
une page HTML statique hébergée sur GitHub Pages, que les deux clients
embarquent dans une webview.

## Pourquoi un scraper et pas un simple iframe

La page source `https://www.arc1950.com/programme-danimations-1458` ne publie
aucun flux structuré : le programme est une série d'**images** (le programme
papier de la semaine), entourées du menu et du pied de page du site Arc 1950.
Embarquer la page telle quelle donnerait un rendu inutilisable sur TV.

Le nom des visuels n'est pas prédictible non plus — `sem_35_012_1032_fr.jpg` :
`35` est le numéro de semaine, mais `1032` est un identifiant interne du CMS.
On ne peut donc pas deviner les URLs de la semaine suivante ; il faut relire la
page. Un scraping depuis le navigateur est impossible (CORS), d'où une
**GitHub Action** qui fait le travail côté serveur, une fois par jour.

## Contenu du dépôt

Cette page vit dans le sous-dossier `animations/` du dépôt `stloeb/csmart`, à côté
du wrapper météo qui occupe la racine.

| Fichier | Rôle |
|---|---|
| `animations/index.html` | La page affichée. |
| `animations/programme.json` | Données de la semaine en cours, générées automatiquement. |
| `animations/img/` | Visuels de la semaine, téléchargés par l'Action (créé au premier run). |
| `animations/assets/` | Logo CASAMAST, version claire pour fonds sombres. |
| `animations/scripts/scrape.py` | Lecture de la page source, téléchargement, purge des semaines passées. |
| `.github/workflows/maj-programme-animations.yml` | Exécution quotidienne à 05h10 UTC + déclenchement manuel. |

## Mise en service

1. Déposer le dossier `animations/` à la racine du dépôt `stloeb/csmart`.
2. Créer `.github/workflows/maj-programme-animations.yml` avec le contenu fourni.
3. **Settings → Actions → General** → Workflow permissions : `Read and write permissions`.
4. **Actions → Programme d'animations Arc 1950 → Run workflow** : premier
   remplissage immédiat, sans attendre le cron.
5. Vérifier `https://stloeb.github.io/csmart/animations/`.

GitHub Pages est déjà actif sur ce dépôt (le wrapper météo tourne dessus) : rien
à configurer de ce côté, le sous-dossier est publié automatiquement.

## URLs à donner aux intégrateurs

| Cible | URL |
|---|---|
| CSMART TV | `https://stloeb.github.io/csmart/animations/?mode=tv` |
| CSMART Hospitality Mobile | `https://stloeb.github.io/csmart/animations/?mode=mobile` |

Sans paramètre, la page détecte seule le format de l'écran. Les paramètres
servent à forcer le comportement si la webview ment sur ses dimensions.

- `mode=tv` — scène TV plein écran, sans interaction.
- `mode=mobile` — galerie verticale, tap sur un visuel pour l'agrandir.
- `pause=<secondes>` — temps d'arrêt sur chaque écran avant le défilement
  suivant (7 s par défaut).

## Charte

Alignée sur le wrapper météo `stloeb.github.io/csmart` : même scène de 1280 × 720
mise à l'échelle par transform, même palette (`--bg #070E18`, `--bg2 #0C1626`,
`--card #111E31`, `--acc #4AA8E8`, `--acc2 #7FD9C2`, `--txt #E8EFF7`,
`--txt2 #93A6BE`), même bandeau de 80 px, même barre de progression de 6 px en
pied d'écran, et le même mécanisme de défilement par paliers avec recouvrement.

S'y ajoutent le vert CASAMAST `#29BC9F` pour le jour courant et l'icône du logo,
`assets/casamast-icone.png`. Le logo fourni a été **recoloré pour les fonds
sombres** : le mot « MAST », d'origine en bleu-vert foncé, devenait illisible sur
`#070E18`. Le vert et le gris de l'icône sont inchangés.

Polices Archivo et Inter, chargées depuis Google Fonts comme sur le wrapper
météo, avec repli sur les polices système si le boîtier n'a pas de réseau
sortant vers `fonts.googleapis.com`.

Le fond est un massif stylisé **dessiné en SVG dans la page** — pas une photo
d'Arc 1950. Aucun fichier externe, aucune question de droits, et il s'adapte à
toutes les définitions. Si tu préfères une vraie photo, elle se substitue au
bloc `#decor`.

## Le point dur : la lisibilité sur TV

Une page A4 affichée en entier sur un écran 16:9 donne un corps de texte d'une
dizaine de pixels de haut — lisible sur un bureau, **illisible à trois mètres**.

Le visuel est donc affiché sur toute la largeur utile, puis **défile par paliers**
avec 70 px de recouvrement, exactement comme le bulletin météo fait défiler son
document. Le texte reste à une taille lisible et la barre de progression indique
où l'on en est dans la page.

C'est un pansement, pas une solution : tant que le programme reste une image, la
mise en page est celle du papier et non celle de l'écran. La vraie cible est de
récupérer le contenu sous forme de données (voir ci-dessous) et de le rendre
nativement dans la charte, jour par jour.

## Comportement à l'affichage

**Mode TV.** Bandeau de titre avec l'heure, bandeau semaine, zone de lecture
défilante, barre de progression.

**La visibilité semaine** est le bandeau sous le titre : les sept jours de la
semaine affichée, avec le jour courant en vert CASAMAST et les jours passés
estompés. Il est calculé à partir de `debut` dans `programme.json`, donc il reste
juste même si le programme est publié en retard.

Le JSON est relu toutes les 30 minutes : un afficheur allumé en continu passe
au programme de la semaine suivante sans redémarrage.

Télécommande / clavier : flèches pour naviguer, `Entrée` ou `Espace` pour
mettre en pause.

**Mode mobile.** Les visuels s'empilent verticalement ; un tap ouvre le visuel
en plein écran, agrandi et zoomable au pinch. Un programme papier scanné reste
dense sur un téléphone : c'est le meilleur compromis tant qu'Arc 1950 ne fournit
pas les données en clair.

## Résistance aux pannes

- Si la structure de la page source change et qu'aucun visuel n'est trouvé, le
  script **échoue sans écrire** : le programme précédent reste affiché plutôt
  qu'un écran vide. L'échec est visible dans l'onglet Actions.
- Si le JSON est injoignable au démarrage, la page réessaie toutes les minutes.
- Si un visuel est illisible, il est simplement écarté du carrousel.
- Une relecture qui ne trouve rien de neuf ne produit aucun commit.

## À valider avec ASL / Arc 1950

1. **Accord pour la reprise des visuels** dans les afficheurs CSMART. Les images
   sont recopiées dans ce dépôt, donc republiées : c'est un point à faire
   confirmer, même si le contenu est déjà public.
2. **Une source stable serait préférable au scraping** — un export, un flux, ou
   simplement une URL de fichier fixe mise à jour chaque semaine. Le scraper
   reste tributaire de la mise en page du site : si Arc 1950 refond sa page, il
   faudra ajuster l'expression régulière dans `scripts/scrape.py`.
3. **Horaire de publication** du programme de la semaine, pour caler le cron au
   plus juste (actuellement quotidien, ce qui couvre tous les cas).
