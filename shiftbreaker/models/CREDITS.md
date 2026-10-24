# Car models

The four real cars use 3D models from Sketchfab. They were converted for the game with
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

Three of the licences are non-commercial: the models may not be used in a commercial release.
Car names and brands belong to their owners; this is an unofficial, non-commercial fan game.
