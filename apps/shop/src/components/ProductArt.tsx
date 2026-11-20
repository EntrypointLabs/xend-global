import type { ArtKind, Tone } from "@/lib/catalog";

export const SYMBOL_PATH =
  "M 48 40 L 94 40 C 102 40 107 35 113 29 L 119 23 C 123 19 127 18 135 18 L 180 18 L 180 158 C 180 163 177 166 172 166 L 114 166 C 112 166 110 167 108 169 L 94 182 C 92 184 90 184 87 184 L 28 184 C 23 184 20 181 20 176 L 20 91 C 20 85 24 82 30 82 L 58 82 L 58 144 C 58 147 60 149 63 149 L 86 149 C 89 149 91 148 94 145 L 110 129 C 112 127 115 126 119 126 L 143 126 L 143 59 L 133 59 C 125 59 119 65 114 71 C 109 76 104 78 96 78 L 58 78 C 45 78 36 58 36 50 C 36 44 42 40 48 40 Z";

const TONES: Record<
  Tone,
  { hi: string; base: string; lo: string; mark: string }
> = {
  ink: { hi: "#3b3b3e", base: "#1b1b1d", lo: "#0a0a0b", mark: "#2c2c2f" },
  bone: { hi: "#f7f4ee", base: "#e7e2d7", lo: "#cbc4b4", mark: "#141414" },
  graphite: { hi: "#77787d", base: "#505156", lo: "#2f3033", mark: "#3e3f43" },
  steel: { hi: "#f1f2f5", base: "#b9bcc3", lo: "#7d8089", mark: "#2a2b2e" },
};

function Mark({
  x,
  y,
  size,
  fill,
  opacity = 1,
}: {
  x: number;
  y: number;
  size: number;
  fill: string;
  opacity?: number;
}) {
  const s = size / 166;
  return (
    <path
      d={SYMBOL_PATH}
      fill={fill}
      opacity={opacity}
      transform={`translate(${x - 100 * s} ${y - 101 * s}) scale(${s})`}
    />
  );
}

export function ProductArt({
  kind,
  tone,
  id,
  className,
  label,
}: {
  kind: ArtKind;
  tone: Tone;
  id: string;
  className?: string;
  label: string;
}) {
  const t = TONES[tone];
  const g = (name: string) => `${id}-${name}`;
  const fill = `url(#${g("cloth")})`;

  return (
    <svg
      viewBox="0 0 600 750"
      className={className}
      role="img"
      aria-label={label}
    >
      <defs>
        <radialGradient id={g("bg")} cx="50%" cy="38%" r="75%">
          <stop offset="0%" stopColor="var(--art-hi, #f3f2ee)" />
          <stop offset="100%" stopColor="var(--art-lo, #dedcd5)" />
        </radialGradient>
        <linearGradient id={g("cloth")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={t.hi} />
          <stop offset="55%" stopColor={t.base} />
          <stop offset="100%" stopColor={t.lo} />
        </linearGradient>
        <linearGradient id={g("steel")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f6f7f9" />
          <stop offset="35%" stopColor="#aeb2ba" />
          <stop offset="60%" stopColor="#e4e6ea" />
          <stop offset="100%" stopColor="#6e717a" />
        </linearGradient>
        <linearGradient id={g("sheen")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id={g("soft")} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
        <filter id={g("lift")} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="0"
            dy="14"
            stdDeviation="16"
            floodColor="#000"
            floodOpacity="0.16"
          />
        </filter>
      </defs>

      <rect width="600" height="750" fill={`url(#${g("bg")})`} />
      <ellipse
        cx="300"
        cy="640"
        rx="200"
        ry="22"
        fill="#000"
        opacity="0.13"
        filter={`url(#${g("soft")})`}
      />

      <g filter={`url(#${g("lift")})`}>
        {kind === "tee" && (
          <g>
            <path
              d="M196 214 L252 190 Q300 222 348 190 L404 214 L474 268 L440 338 L404 318 L404 584 Q300 598 196 584 L196 318 L160 338 L126 268 Z"
              fill={fill}
            />
            <path
              d="M252 190 Q300 236 348 190 Q300 214 252 190 Z"
              fill={t.lo}
              opacity="0.55"
            />
            <path
              d="M196 318 L196 400 M404 318 L404 420"
              stroke={t.lo}
              strokeWidth="3"
              opacity="0.35"
            />
            <path
              d="M232 470 Q300 488 372 462"
              stroke={t.lo}
              strokeWidth="2"
              fill="none"
              opacity="0.3"
            />
            <Mark x={346} y={268} size={34} fill={t.mark} />
            <path
              d="M196 214 L252 190 Q300 222 348 190 L404 214 L404 260 L196 260 Z"
              fill={`url(#${g("sheen")})`}
            />
          </g>
        )}

        {kind === "hoodie" && (
          <g>
            <path
              d="M246 214 Q238 132 300 120 Q362 132 354 214 Z"
              fill={t.lo}
            />
            <path
              d="M196 228 L250 204 Q300 236 350 204 L404 228 L456 300 L474 500 L432 508 L404 336 L404 560 Q300 574 196 560 L196 336 L168 508 L126 500 L144 300 Z"
              fill={fill}
            />
            <path
              d="M262 206 Q300 150 338 206 Q300 236 262 206 Z"
              fill={t.lo}
              opacity="0.8"
            />
            <path
              d="M236 440 L364 440 L382 508 L218 508 Z"
              fill="none"
              stroke={t.lo}
              strokeWidth="3"
              opacity="0.6"
            />
            <rect
              x="196"
              y="536"
              width="208"
              height="24"
              fill={t.lo}
              opacity="0.35"
            />
            <rect
              x="126"
              y="480"
              width="46"
              height="22"
              transform="rotate(4 149 491)"
              fill={t.lo}
              opacity="0.35"
            />
            <rect
              x="428"
              y="480"
              width="46"
              height="22"
              transform="rotate(-4 451 491)"
              fill={t.lo}
              opacity="0.35"
            />
            <Mark x={155} y={466} size={18} fill={t.hi} opacity={0.7} />
            <path
              d="M196 228 L250 204 Q300 236 350 204 L404 228 L404 280 L196 280 Z"
              fill={`url(#${g("sheen")})`}
            />
          </g>
        )}

        {kind === "cap" && (
          <g>
            <path
              d="M178 452 Q120 470 104 506 Q210 540 342 486 Q300 446 178 452 Z"
              fill={t.lo}
            />
            <path
              d="M178 452 Q182 290 318 276 Q448 284 456 430 Q330 418 178 452 Z"
              fill={fill}
            />
            <path
              d="M318 276 Q300 360 300 432 M318 276 Q380 340 400 424 M318 276 Q240 330 220 444"
              stroke={t.lo}
              strokeWidth="2.5"
              fill="none"
              opacity="0.45"
            />
            <ellipse cx="318" cy="278" rx="12" ry="6" fill={t.lo} />
            <Mark x={262} y={384} size={52} fill={t.hi} opacity={0.85} />
            <path
              d="M178 452 Q182 290 318 276 Q448 284 456 430"
              fill="none"
              stroke="#fff"
              strokeOpacity="0.12"
              strokeWidth="6"
            />
          </g>
        )}

        {kind === "socks" && (
          <g>
            {[
              { dx: -70, c: TONES.ink, r: -4 },
              { dx: 60, c: TONES.bone, r: 3 },
            ].map(({ dx, c, r }, i) => (
              <g
                key={i}
                transform={`translate(${dx} ${i * 18}) rotate(${r} 300 400)`}
              >
                <path
                  d="M250 170 L334 170 L334 468 Q334 520 384 538 L438 558 Q476 578 460 620 Q444 652 402 642 L298 612 Q250 596 250 540 Z"
                  fill={c.base}
                />
                <path
                  d="M250 170 L334 170 L334 236 L250 236 Z"
                  fill={c.lo}
                  opacity="0.55"
                />
                {[186, 200, 214, 228].map((y) => (
                  <line
                    key={y}
                    x1="252"
                    x2="332"
                    y1={y}
                    y2={y}
                    stroke={c.hi}
                    strokeOpacity="0.4"
                    strokeWidth="2"
                  />
                ))}
                <path
                  d="M410 560 Q470 580 452 626 Q436 650 402 642 Z"
                  fill={c.lo}
                  opacity="0.5"
                />
                <Mark
                  x={292}
                  y={300}
                  size={30}
                  fill={i === 0 ? c.hi : TONES.ink.base}
                  opacity={0.85}
                />
              </g>
            ))}
          </g>
        )}

        {kind === "mat" && (
          <g transform="translate(300 400) skewX(-8) translate(-300 -400)">
            <rect x="64" y="292" width="472" height="212" rx="18" fill={fill} />
            <rect
              x="74"
              y="302"
              width="452"
              height="192"
              rx="12"
              fill="none"
              stroke={t.hi}
              strokeOpacity="0.55"
              strokeWidth="2"
              strokeDasharray="6 5"
            />
            <Mark x={484} y={452} size={34} fill={t.hi} opacity={0.7} />
            <rect
              x="64"
              y="292"
              width="472"
              height="70"
              rx="18"
              fill={`url(#${g("sheen")})`}
            />
          </g>
        )}

        {kind === "tote" && (
          <g>
            <path
              d="M226 340 L226 170 Q226 132 262 132 L338 132 Q374 132 374 170 L374 340"
              fill="none"
              stroke={t.lo}
              strokeWidth="16"
            />
            <path d="M178 318 L422 318 L436 640 L164 640 Z" fill={fill} />
            <path
              d="M178 318 L422 318 L423 346 L177 346 Z"
              fill={t.lo}
              opacity="0.45"
            />
            <Mark x={300} y={486} size={112} fill={TONES.ink.base} />
            <path
              d="M210 600 Q300 612 400 596"
              stroke={t.lo}
              strokeWidth="2"
              fill="none"
              opacity="0.4"
            />
          </g>
        )}

        {kind === "stickers" && (
          <g transform="rotate(-5 300 400)">
            <rect
              x="140"
              y="176"
              width="320"
              height="420"
              rx="10"
              fill={TONES.bone.hi}
            />
            {[0, 1, 2].flatMap((row) =>
              [0, 1, 2].map((col) => {
                const cx = 200 + col * 100;
                const cy = 250 + row * 130;
                const v = (row * 3 + col) % 4;
                return (
                  <g key={`${row}-${col}`}>
                    {v === 1 && (
                      <circle cx={cx} cy={cy} r="40" fill={TONES.ink.base} />
                    )}
                    {v === 3 && (
                      <rect
                        x={cx - 38}
                        y={cy - 38}
                        width="76"
                        height="76"
                        rx="14"
                        fill={TONES.bone.lo}
                      />
                    )}
                    <Mark
                      x={cx}
                      y={cy}
                      size={v === 1 ? 44 : 56}
                      fill={
                        v === 1
                          ? TONES.bone.hi
                          : v === 2
                            ? `url(#${g("steel")})`
                            : TONES.ink.base
                      }
                    />
                  </g>
                );
              }),
            )}
          </g>
        )}

        {kind === "mug" && (
          <g>
            <path
              d="M418 330 Q492 330 492 410 Q492 490 418 490"
              fill="none"
              stroke={t.base}
              strokeWidth="26"
            />
            <path
              d="M188 250 L412 250 L412 572 Q300 606 188 572 Z"
              fill={fill}
            />
            <ellipse cx="300" cy="250" rx="112" ry="26" fill={t.lo} />
            <ellipse
              cx="300"
              cy="254"
              rx="98"
              ry="19"
              fill="#2a1d14"
              opacity="0.9"
            />
            <Mark x={300} y={412} size={86} fill={t.hi} opacity={0.75} />
            <path
              d="M206 270 L206 560"
              stroke="#fff"
              strokeOpacity="0.12"
              strokeWidth="14"
            />
          </g>
        )}

        {kind === "pin" && (
          <g>
            <rect
              x="170"
              y="186"
              width="260"
              height="380"
              rx="6"
              fill={TONES.bone.hi}
            />
            <rect
              x="170"
              y="186"
              width="260"
              height="380"
              rx="6"
              fill="none"
              stroke={TONES.bone.lo}
            />
            <circle cx="300" cy="226" r="9" fill={TONES.bone.lo} />
            <g transform="translate(-4 6)">
              <Mark x={300} y={380} size={160} fill="#000" opacity={0.18} />
            </g>
            <Mark x={300} y={376} size={160} fill={`url(#${g("steel")})`} />
            <Mark x={300} y={376} size={128} fill={TONES.ink.base} />
          </g>
        )}

        {kind === "jacket" && (
          <g>
            <path
              d="M192 214 Q300 176 408 214 L466 300 L486 548 L440 556 L410 344 L414 616 Q300 632 186 616 L190 344 L160 556 L114 548 L134 300 Z"
              fill={fill}
            />
            <path
              d="M246 196 Q300 150 354 196 L344 238 Q300 222 256 238 Z"
              fill={t.lo}
            />
            <line
              x1="300"
              y1="232"
              x2="300"
              y2="626"
              stroke={t.hi}
              strokeWidth="4"
              opacity="0.7"
            />
            <path
              d="M332 300 L382 280"
              stroke={t.hi}
              strokeWidth="3"
              opacity="0.6"
            />
            <path
              d="M228 420 L262 520 M372 420 L338 520"
              stroke={t.hi}
              strokeWidth="3"
              opacity="0.35"
            />
            <Mark x={258} y={300} size={30} fill="#c9ccd2" opacity={0.9} />
            <path
              d="M192 214 Q300 176 408 214 L412 300 L188 300 Z"
              fill={`url(#${g("sheen")})`}
            />
          </g>
        )}

        {kind === "headphones" && (
          <g>
            <path
              d="M178 410 Q178 180 300 176 Q422 180 422 410"
              fill="none"
              stroke={t.lo}
              strokeWidth="30"
              strokeLinecap="round"
            />
            <path
              d="M178 410 Q178 180 300 176 Q422 180 422 410"
              fill="none"
              stroke={t.hi}
              strokeOpacity="0.35"
              strokeWidth="6"
            />
            {[
              { x: 186, r: -6 },
              { x: 414, r: 6 },
            ].map(({ x, r }) => (
              <g key={x} transform={`rotate(${r} ${x} 470)`}>
                <rect
                  x={x - 62}
                  y="378"
                  width="124"
                  height="190"
                  rx="54"
                  fill={fill}
                />
                <rect
                  x={x - 46}
                  y="396"
                  width="92"
                  height="154"
                  rx="42"
                  fill="none"
                  stroke={t.hi}
                  strokeOpacity="0.35"
                  strokeWidth="3"
                />
                <Mark x={x} y={474} size={44} fill={t.hi} opacity={0.6} />
              </g>
            ))}
          </g>
        )}

        {kind === "bundle" && (
          <g>
            <path d="M126 330 L300 270 L474 330 L300 392 Z" fill={t.hi} />
            <path d="M126 330 L300 392 L300 628 L126 560 Z" fill={t.base} />
            <path d="M474 330 L300 392 L300 628 L474 560 Z" fill={t.lo} />
            <path
              d="M126 330 L300 392 L474 330"
              fill="none"
              stroke="#fff"
              strokeOpacity="0.14"
              strokeWidth="3"
            />
            <g transform="matrix(1 0.36 0 1 0 0)">
              <Mark x={212} y={376} size={70} fill="#d7d9de" opacity={0.9} />
            </g>
            <path
              d="M352 560 L430 532 L430 548 L352 576 Z"
              fill="#d7d9de"
              opacity="0.35"
            />
          </g>
        )}

        {kind === "object" && (
          <g>
            {[18, 14, 10, 6, 3].map((d) => (
              <Mark
                key={d}
                x={300 + d * 0.6}
                y={392 + d}
                size={300}
                fill="#55585f"
                opacity={0.9}
              />
            ))}
            <Mark x={300} y={392} size={300} fill={`url(#${g("steel")})`} />
            <Mark x={300} y={392} size={300} fill={`url(#${g("sheen")})`} />
          </g>
        )}
      </g>
    </svg>
  );
}
