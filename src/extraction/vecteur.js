/**
 * Vectorisation d'une image matricielle en SVG.
 *
 * Le principe n'est pas celui d'un traceur de courbes facon potrace : on ne
 * cherche pas a deviner des arcs dans une photo, mais a rendre exactement les
 * aplats d'un sprite. Le contour suit donc les bords des pixels, au demi-pixel
 * pres, et le resultat est fidele a l'original — agrandi dix fois, c'est le
 * meme dessin avec des bords nets, pas une interpolation.
 *
 * Deux etapes : reduire la palette (un sprite d'Atomic Bomberman porte jusqu'a
 * 160 teintes, dont l'essentiel est du degrade), puis tracer une forme par
 * couleur restante.
 */

/**
 * Reduction de palette par coupe mediane.
 *
 * On coupe la boite des couleurs sur son axe le plus etendu, a la mediane des
 * pixels — pas au milieu de la boite. La difference compte : sur ces sprites,
 * les demi-teintes du corps occupent un petit volume mais beaucoup de pixels, et
 * une coupe au milieu geometrique leur donnait une seule teinte pendant que les
 * quelques pixels de reflet en recevaient quatre.
 */
export function reduirePalette(rgba, nombre) {
  const pixels = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] !== 0) pixels.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  if (pixels.length === 0) return [];

  let boites = [pixels];
  while (boites.length < nombre) {
    // On coupe toujours la boite la plus etendue : c'est elle qui porte l'erreur.
    let choisie = -1;
    let meilleure = -1;
    boites.forEach((boite, k) => {
      if (boite.length < 2) return;
      const etendue = Math.max(...[0, 1, 2].map((c) => {
        let min = 255;
        let max = 0;
        for (const p of boite) {
          if (p[c] < min) min = p[c];
          if (p[c] > max) max = p[c];
        }
        return max - min;
      }));
      if (etendue > meilleure) {
        meilleure = etendue;
        choisie = k;
      }
    });
    if (choisie === -1 || meilleure === 0) break;

    const boite = boites[choisie];
    let axe = 0;
    let large = -1;
    for (const c of [0, 1, 2]) {
      let min = 255;
      let max = 0;
      for (const p of boite) {
        if (p[c] < min) min = p[c];
        if (p[c] > max) max = p[c];
      }
      if (max - min > large) {
        large = max - min;
        axe = c;
      }
    }
    boite.sort((a, b) => a[axe] - b[axe]);
    const milieu = boite.length >> 1;
    boites = [...boites.slice(0, choisie), boite.slice(0, milieu), boite.slice(milieu), ...boites.slice(choisie + 1)];
  }

  return boites.filter((b) => b.length).map((boite) => {
    const somme = [0, 0, 0];
    for (const p of boite) {
      somme[0] += p[0];
      somme[1] += p[1];
      somme[2] += p[2];
    }
    return somme.map((s) => Math.round(s / boite.length));
  });
}

/** Indice de la couleur de palette la plus proche, en distance ponderee. */
function plusProche(palette, r, v, b) {
  let meilleur = 0;
  let distance = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const [pr, pv, pb] = palette[i];
    // Ponderation perceptuelle : l'oeil discrimine bien plus finement le vert
    // que le bleu, et une distance euclidienne brute fondait les verts du corps
    // d'un bomber dans une seule teinte.
    const d = 3 * (pr - r) ** 2 + 6 * (pv - v) ** 2 + (pb - b) ** 2;
    if (d < distance) {
      distance = d;
      meilleur = i;
    }
  }
  return meilleur;
}

/**
 * Trace le contour d'un masque binaire, en boucles fermees.
 *
 * On collecte les aretes entre un pixel plein et un pixel vide, orientees pour
 * garder le plein a gauche, puis on les enchaine bout a bout. L'orientation
 * n'est pas un detail : elle sort les contours exterieurs dans un sens et les
 * trous dans l'autre, ce qui laisse la regle de remplissage « nonzero » evider
 * les trous toute seule. Sans elle, il faudrait detecter les trous a la main.
 */
function contours(masque, largeur, hauteur) {
  const aretes = new Map();
  const ajouter = (ax, ay, bx, by) => {
    const cle = ax * (hauteur + 1) + ay;
    if (!aretes.has(cle)) aretes.set(cle, []);
    aretes.get(cle).push([bx, by]);
  };

  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      if (!masque[y * largeur + x]) continue;
      if (y === 0 || !masque[(y - 1) * largeur + x]) ajouter(x, y, x + 1, y);
      if (x === largeur - 1 || !masque[y * largeur + x + 1]) ajouter(x + 1, y, x + 1, y + 1);
      if (y === hauteur - 1 || !masque[(y + 1) * largeur + x]) ajouter(x + 1, y + 1, x, y + 1);
      if (x === 0 || !masque[y * largeur + x - 1]) ajouter(x, y + 1, x, y);
    }
  }

  const boucles = [];
  for (const [cle, suites] of aretes) {
    while (suites.length) {
      const depart = [Math.floor(cle / (hauteur + 1)), cle % (hauteur + 1)];
      const boucle = [depart];
      let [x, y] = suites.pop();
      while (x !== depart[0] || y !== depart[1]) {
        boucle.push([x, y]);
        const suivantes = aretes.get(x * (hauteur + 1) + y);
        if (!suivantes || !suivantes.length) break;
        [x, y] = suivantes.pop();
      }
      if (boucle.length >= 4) boucles.push(boucle);
    }
  }
  return boucles;
}

/** Supprime les points alignes : trois points colineaires n'en valent que deux. */
function simplifier(boucle) {
  const sortie = [];
  for (let i = 0; i < boucle.length; i += 1) {
    const a = boucle[(i - 1 + boucle.length) % boucle.length];
    const b = boucle[i];
    const c = boucle[(i + 1) % boucle.length];
    const croix = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (croix !== 0) sortie.push(b);
  }
  return sortie.length >= 3 ? sortie : boucle;
}

/**
 * Releve les couleurs exactes presentes dans l'image, sans aucune reduction.
 *
 * Les sprites du jeu portent entre cent et deux cents teintes, qui sont pour
 * l'essentiel des degrades de modele. Les garder toutes rend la vectorisation
 * FIDELE AU PIXEL — le SVG agrandi est exactement le dessin d'origine — au prix
 * d'un fichier plus gros, puisque chaque demi-teinte ajoute sa forme.
 */
function paletteExacte(rgba) {
  const vues = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const cle = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    if (!vues.has(cle)) vues.set(cle, [rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  return [...vues.values()];
}

/**
 * Convertit une image RGBA en SVG.
 *
 * `couleurs` plafonne la palette. A zero — ou au-dela du nombre de teintes
 * presentes — aucune reduction n'a lieu et le trace est fidele au pixel pres.
 * Reduire reste utile quand on veut des fichiers legers : l'essentiel du poids
 * d'un sprite vient des demi-teintes, qui se dispersent en petites taches.
 */
export function vectoriser(rgba, largeur, hauteur, { couleurs = 0, titre = '' } = {}) {
  const exactes = paletteExacte(rgba);
  const palette = couleurs > 0 && couleurs < exactes.length ? reduirePalette(rgba, couleurs) : exactes;
  if (!palette.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeur} ${hauteur}"></svg>`;

  const indices = new Int16Array(largeur * hauteur).fill(-1);
  const cache = new Map();
  for (let i = 0; i < largeur * hauteur; i += 1) {
    if (rgba[i * 4 + 3] === 0) continue;
    const cle = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    let indice = cache.get(cle);
    if (indice === undefined) {
      indice = plusProche(palette, rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
      cache.set(cle, indice);
    }
    indices[i] = indice;
  }

  const formes = [];
  for (let c = 0; c < palette.length; c += 1) {
    const masque = new Uint8Array(largeur * hauteur);
    let present = false;
    for (let i = 0; i < indices.length; i += 1) {
      if (indices[i] === c) {
        masque[i] = 1;
        present = true;
      }
    }
    if (!present) continue;

    const d = contours(masque, largeur, hauteur)
      .map(simplifier)
      .map((b) => `M${b.map(([x, y]) => `${x} ${y}`).join('L')}Z`)
      .join('');
    const [r, v, bl] = palette[c];
    const hex = `#${[r, v, bl].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    formes.push(`<path fill="${hex}" d="${d}"/>`);
  }

  const nom = titre ? `<title>${titre}</title>` : '';
  // `width`/`height` explicites en plus du viewBox : charge dans un <img> pour
  // etre rasterise, un SVG qui n a que son viewBox prend la taille par defaut du
  // navigateur — 300 x 150 — et le sprite sort deforme.
  // `shape-rendering="crispEdges"` evite que le navigateur anticrenele des bords
  // qui sont exactement sur la grille : sans lui, chaque aplat gagne un lisere
  // translucide et les sprites voisins laissent voir une couture.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeur} ${hauteur}" shape-rendering="crispEdges">${nom}${formes.join('')}</svg>`;
}
