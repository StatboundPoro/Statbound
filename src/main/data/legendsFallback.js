// Bundled, point-in-time snapshot of real Riftbound TCG Legend names. This
// used to be the sole, hand-maintained source for the `legends` table (see
// git history for that version of this file); it's now a fallback only,
// consulted by db.js's seedFallbackLegendsIfEmpty() when the table is still
// empty (a first-ever launch, or a launch where the live Riftcodex sync in
// src/main/services/legendSync.js has never yet succeeded) — never a
// replacement for a live sync once one succeeds, just a floor so
// autocomplete has something to work with immediately, offline or not. Only
// worth updating by hand again if Riftcodex itself is ever unreachable for a
// whole new set's release.
export const FALLBACK_LEGEND_NAMES = [
  "Kai'Sa, Daughter of the Void",
  'Volibear, Relentless Storm',
  'Jinx, Loose Cannon',
  'Darius, Hand of Noxus',
  'Ahri, Nine-Tailed Fox',
  'Lee Sin, Blind Monk',
  'Yasuo, Unforgiven',
  'Leona, Radiant Dawn',
  'Teemo, Swift Scout',
  'Viktor, Herald of the Arcane',
  'Miss Fortune, Bounty Hunter',
  'Sett, The Boss',
  'Annie, Dark Child',
  'Master Yi, Wuju Bladesman',
  'Lux, Lady of Luminosity',
  'Garen, Might of Demacia',
  'Rumble, Mechanized Menace',
  'Lucian, Purifier',
  'Draven, Glorious Executioner',
  "Rek'sai, Void Burrower",
  'Ornn, Fire Below the Mountain',
  'Jax, Grandmaster At Arms',
  'Irelia, Blade Dancer',
  'Azir, Emperor of the Sands',
  'Ezreal, Prodigal Explorer',
  'Renata Glasc, Chem-Baroness',
  'Sivir, Battle Mistress',
  'Fiora, Grand Duelist',
  'Jhin, Virtuoso',
  'Rengar, Pridestalker',
  'Pyke, Bloodharbor Ripper',
  'Vi, Piltover Enforcer',
  'Lillia, Bashful Bloom',
  'Master Yi, Wuju Master',
  'Vex, Gloomist',
  'Ivern, Green Father',
  'Diana, Scorn of the Moon',
  'LeBlanc, Deceiver',
  "Kha'Zix, Voidreaver",
  'Poppy, Keeper of the Hammer',
  'Akali, Rogue Assassin',
  'Renekton, Butcher of the Sands',
  'Zed, Master of Shadows',
  'Nasus, Curator of the Sands',
  'Shen, Eye of Twilight',
  'Jayce, Defender of Tomorrow',
  "Mel, Soul's Reflection",
  'Ambessa, Matriarch of War',
  'Kennen, Heart of the Tempest'
]
