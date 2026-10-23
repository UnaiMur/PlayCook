# Tes cartes

Dépose ici une image par carte, nommée exactement comme ci-dessous, en `.png`.
Le jeu bascule dessus automatiquement, **carte par carte** : tu peux en ajouter
trois aujourd'hui et le reste plus tard, celles qui manquent restent dessinées
en CSS. Aucun code à toucher, aucun redémarrage du serveur.

Format conseillé : portrait, ratio 2:3 (par exemple 400 × 600 px).

## Les 54 noms attendus

Pour chaque couleur — `rouge`, `bleu`, `vert`, `jaune` :

```
<couleur>-0.png   <couleur>-1.png  …  <couleur>-9.png
<couleur>-passe.png
<couleur>-inverse.png
<couleur>-plus2.png
```

Soit par exemple `rouge-0.png`, `rouge-7.png`, `bleu-passe.png`,
`vert-inverse.png`, `jaune-plus2.png`.

Et les deux cartes noires, communes aux quatre couleurs :

```
joker.png
joker-plus4.png
```

## Le dos des cartes

Le dos est dessiné en CSS et n'est pas remplaçable par une image pour
l'instant — dis-le moi si tu en as dessiné un, c'est deux lignes à changer.

## Vérifier que rien ne manque

```bash
node tools/verifier-cartes-uno.js
```

Le script liste ce qui est présent, ce qui manque, et signale un fichier dont
le nom ne correspond à aucune carte (une faute de frappe, le plus souvent).
