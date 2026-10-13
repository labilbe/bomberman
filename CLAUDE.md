# Conventions

## Language

**Code and comments are written in English.** Identifiers — variables, functions,
files, CSS classes — and every comment or JSDoc block are in English.

**What the player reads stays in French, with its accents.** Menu entries, the
manual, banners, HUD labels, error messages: those are the game's voice, and the
game speaks French. A string shown on screen is never translated to match the
code around it.

Two things sit on the boundary and are already settled:

- **The network protocol is English**, event names (`boom`, `brick`, `pick`),
  message types, bonus names (`punch`, `jelly`), and the snapshot's short keys.
  They travel between a browser and a relay, and they are data, not prose. The
  manifests written by the extraction scripts follow the same rule: they are read
  by code only.
- **The game's own vocabulary is kept as the game spells it** when it names a
  file or a sequence: `BOMBS.ANI`, `power jelly`, `punch north green`. Renaming
  Interplay's assets in our own words would break the only link between the
  extractor and the files it reads.

Two directories keep their French names because they are data read by path, not
code: `assets/jeu` and `assets/sons`. The `bomberman.*` keys in `localStorage`
keep theirs for the same reason — they are already on players' machines.

## Comments

Comments say **why**, not what. The code already says what it does; a comment
earns its place by recording the reason a choice was made, the alternative that
was tried and failed, or the bug that a line prevents. Measurements and numbers
that come from somewhere — the original game's tables, a benchmark, a test
threshold — say where they come from.

## Tests

`npm test` runs the whole suite and must stay green. Engine rules are tested on a
bare arena (no bricks, no random bonuses) so that an assertion never depends on
where chance put something.
