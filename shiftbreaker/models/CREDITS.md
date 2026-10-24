# Car models

The real cars use 3D models from Sketchfab. They were converted for the game with
`tools/prep-car.mjs`: re-oriented and scaled to the real wheelbase, wheels split per corner and
re-centred on their hubs (the Porsche's posed front wheels were straightened), untextured materials
merged into vertex colours, geometry simplified (two levels: `_hi` for the player, `_lo` for rivals),
textures resized to WebP, the Porsche's tinted clear-coat shell removed, meshopt-compressed, and stored as glTF JSON with an embedded buffer (`tools/glb-to-json.mjs`).
The Bugatti download was truncated inside its wheel normal map; the lost rows were filled with a flat
normal (`tools/fix-bugatti.mjs`). The converted files keep their original licences.

| File | Model | Author | Licence | Source |
|---|---|---|---|---|
| `porsche_hi.gltf.json`, `porsche_lo.gltf.json` | (FREE) Porsche 911 Carrera 4S | Karol Miklas | [CC BY-SA 4.0](http://creativecommons.org/licenses/by-sa/4.0/) | https://sketchfab.com/3d-models/free-porsche-911-carrera-4s-d01b254483794de3819786d93e0e1ebf |
| `ferrari_hi.gltf.json`, `ferrari_lo.gltf.json` | Ferrari LaFerrari \| www.vecarz.com | vecarz | [CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/) | https://sketchfab.com/3d-models/ferrari-laferrari-wwwvecarzcom-979f7085012e4d6399f38de3f9c39012 |
| `bugatti_hi.gltf.json`, `bugatti_lo.gltf.json` | 2020 Bugatti Bolide Concept | Ddiaz Design | [CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/) | https://sketchfab.com/3d-models/2020-bugatti-bolide-concept-658684653b154ffba72d5f9511312ca8 |
| `clk_hi.gltf.json`, `clk_lo.gltf.json` | 1998 Mercedes-Benz CLK LM | OUTPISTON | [CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/) | https://sketchfab.com/3d-models/1998-mercedes-benz-clk-lm-6748dd7c61824ddfa9065b351d683f8e |
| `lambo_hi.gltf.json`, `lambo_lo.gltf.json` | Lamborghini Fenomeno 2026 | VTX | [CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/) | https://sketchfab.com/3d-models/lamborghini-fenomeno-2026-e0cba33b773c4ce58fce3ae67421e62d |

## Buildings, landmarks, stations, traffic

Converted with `tools/prep-static.mjs`: grounded and centred (street side +Z), materials merged,
simplified, WebP textures, meshopt-compressed; collision boxes are derived from the geometry. The
mosque scan had the soil block under its courtyard cut away; the trolleybus is split into two
sections at its articulation so the rear one can follow the front through turns.

| File | Model | Author | Licence | Source |
|---|---|---|---|---|
| `panel.gltf.json` | 124-87-117 building | Randonavt | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | https://sketchfab.com/3d-models/124-87-117-building-07cb622c5820412495d7bdeec80af9ef |
| `stalin.gltf.json` | Soviet building from the Stalin era | VovaRice | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | https://sketchfab.com/3d-models/soviet-building-from-the-stalin-era-2dcb233ae2fb44b089871c2169a09648 |
| `nyc.gltf.json` | New York styled hi rise apartment building | aitortilla01 | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | https://sketchfab.com/3d-models/new-york-styled-hi-rise-apartment-building-14e3d5743f7546d5bb7f3befc72c9057 |
| `mosque.gltf.json` | Great Mosque of Tirana, Albania | Archéomatique | [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/) | https://sketchfab.com/3d-models/great-mosque-of-tirana-albania-60af8a8211ff45729f2ce88a285a6443 |
| `gas.gltf.json` | GAS-STATION | sherif shawky | [Sketchfab Standard](https://sketchfab.com/licenses) | https://sketchfab.com/3d-models/gas-station-8d0c47e376fb4becab56aaa4b9c92e3b |
| `trolley.gltf.json` | UMZ t1 | Randonavt | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | https://sketchfab.com/3d-models/umz-t1-da9214fc8c544279a4176ccad980236c |

The gas station is under the Sketchfab Standard licence: it may be used inside this game, but the
model file must not be redistributed on its own.

Several licences are non-commercial (BY-NC / BY-NC-SA): those models may not be used in a commercial release.
Car names and brands belong to their owners; this is an unofficial, non-commercial fan game.
