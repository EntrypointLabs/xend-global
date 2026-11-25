# Feature illustrations

Every feature page leads with one of these. They are generated, not drawn, and
all share one style so the set reads as a family.

Made with Codex's image generation (`codex exec -m gpt-5.6-terra`), one image
per prompt at 1024x1024 with a transparent background, then resized to 720 and
saved as WebP (quality 86). Every prompt after the first also asks the model to
match `jar.webp`, which set the style.

## Style (append to every prompt)

- One chunky, slightly toy-like 3D-rendered object, centred, filling about 80% of the frame.
- Painterly textured surface: visible brush strokes, grain, layered paint, mottled gradients. Saturated palette mixing vermilion, tangerine, sunflower yellow, magenta, violet and teal on the same object.
- Soft studio light from the upper left, gentle ambient occlusion, subtle rounded bevels. No hard outlines.
- No text, no letters, no numbers, no logos, no ground plane, no cast shadow, no background scene.
- Fully transparent background. Square PNG, 1024x1024.

## Subjects

| File       | Used on             | Subject                                                                                                                            |
| ---------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `jar`      | Jars                | A short, wide ceramic jar with an open mouth, with two gold coins tumbling into it.                                                |
| `group`    | Group spending      | A wide, shallow ceramic bowl heaped with gold coins, with three wooden spoons dipping into it from different sides.                |
| `calendar` | Scheduled transfers | A chunky desk calendar block with two rounded metal binder rings on top and one large blank raised square on the front page.       |
| `split`    | Split a bill        | A paper receipt torn cleanly into three pieces floating slightly apart, with a gold coin on the middle piece; abstract lines only. |
| `convert`  | Convert price       | A thick gold coin standing on its edge, tilted, with two chunky curved arrows looping around it.                                   |
| `atm`      | Find an ATM         | A chunky, rounded cash machine dispensing a short stack of banknotes; blank glowing screen.                                        |
| `error`    | Error state         | A chunky exclamation mark in two separate pieces, a tall tapered bar and a round dot, tilted slightly.                             |
| `limit`    | Spending limit      | A chunky rounded dial gauge, a thick semicircular arc with a stubby needle two thirds of the way round, a gold coin at its base.   |

## Activity marks

Smaller objects that stand in for an icon on Activity rows (40pt) and their
detail sheet (64pt). Same chunky 3D form language as the set above, but each in
a single colour with smooth glossy shading, no paint texture and no mixed
palette, so they read at icon size. Saved at 256px. Activity shows them bare,
with no disc behind them, and the event is part of the object rather than a
corner badge.

| File                   | Used on                 | Subject                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recovery-key-added`   | Added Recovery Key      | Three chunky keys of slightly different shapes on one thick ring, with a round charm on the ring carrying an embossed plus. Rendered violet, then turned glossy graphite so it pairs with the grey removed mark: dark means the key is there, light grey means it is gone. Graphite rather than near-black so the plus on the charm survives at 40pt. |
| `recovery-key-removed` | Removed Recovery Key    | The same render with the plus swapped for an embossed cross, then desaturated to neutral grey so a removed key reads as gone.                                                                                                                                                                                                                         |
| `account-renamed`      | Renamed / Named Account | A chunky blank name tag with a pencil resting on it mid-stroke and a short written squiggle, so it reads as "gave it a new name". Rendered in soft blue, then turned glossy graphite to sit with the key marks; lighter than charcoal so the pencil and its squiggle stay distinct at 40pt.                                                           |
