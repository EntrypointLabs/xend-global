# Auth / onboarding canvas

Dark canvases are deliberate exceptions, not a product theme: `login`,
`recover`, and `add-email`. Signed-in screens stay light monochrome.

## Colour

| Role             | Value                                                               |
| ---------------- | ------------------------------------------------------------------- |
| Canvas           | `AUTH_CANVAS` (`#000000`)                                           |
| Primary text     | white                                                               |
| Secondary / body | `white/50` (opacity hierarchy, not a tint hex)                      |
| Primary CTA      | `AUTH_CTA` (`#FFFFFF`) with `AUTH_CTA_LABEL` (`#000000`)            |
| Secondary CTA    | glass (`bg-white/20`, `border-white/20`)                            |
| Accent           | `AUTH_BRAND_BLUE` (`#3256EC`) — faint only (OTP focus, soft blooms) |

Tokens live in [`apps/mobile/constants/Colors.ts`](../../apps/mobile/constants/Colors.ts).

## Atmosphere

Shared by [`AuthAtmosphere`](../../apps/mobile/components/ui/molecules/AuthAtmosphere.tsx):

- Plasma-style lifestyle stills at the top, fading into black (adapted from
  prydd.co `landscape-field` / `landscape-sky`).
- Slow crossfade + Ken Burns; soft blue bloom and a quiet floor glow.
- WordWheel keeps **multicolor** icons for pizzazz; blue does not carry the
  screen.

Do **not** stack the old Fuse cyan (`#8FE5F6`) treatment. Depth comes from
imagery, soft blue presence, type hierarchy, and white CTA contrast.
