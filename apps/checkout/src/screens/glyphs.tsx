export function PassageMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="16 14 168 174"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M 48 40 L 94 40 C 102 40 107 35 113 29 L 119 23 C 123 19 127 18 135 18 L 180 18 L 180 158 C 180 163 177 166 172 166 L 114 166 C 112 166 110 167 108 169 L 94 182 C 92 184 90 184 87 184 L 28 184 C 23 184 20 181 20 176 L 20 91 C 20 85 24 82 30 82 L 58 82 L 58 144 C 58 147 60 149 63 149 L 86 149 C 89 149 91 148 94 145 L 110 129 C 112 127 115 126 119 126 L 143 126 L 143 59 L 133 59 C 125 59 119 65 114 71 C 109 76 104 78 96 78 L 58 78 C 45 78 36 58 36 50 C 36 44 42 40 48 40 Z" />
    </svg>
  );
}

export function FaceGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H8" />
      <path d="M16 4h1.5A2.5 2.5 0 0 1 20 6.5V8" />
      <path d="M20 16v1.5a2.5 2.5 0 0 1-2.5 2.5H16" />
      <path d="M8 20H6.5A2.5 2.5 0 0 1 4 17.5V16" />
      <path d="M9 9.5v1.2M15 9.5v1.2M12 9v4.2l-1 .8M9.6 15.6a3.4 3.4 0 0 0 4.8 0" />
    </svg>
  );
}

export function LockGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" rx="2.2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/** The only green on the surface: drawn once, on a confirmed success. */
export function DoneCheck() {
  return (
    <span className="success-mark" aria-hidden="true">
      <svg viewBox="0 0 52 52">
        <circle className="success-ring" cx="26" cy="26" r="24" />
        <path className="success-tick" d="M15 27.5l7.2 7.2L38 18.5" />
      </svg>
    </span>
  );
}

export function PhoneGlyph() {
  return (
    <span className="phone" aria-hidden="true">
      <span className="phone-ring" />
      <span className="phone-ring phone-ring-late" />
      <svg viewBox="0 0 64 104" className="phone-body">
        <rect x="2" y="2" width="60" height="100" rx="13" />
        <rect
          className="phone-notch"
          x="24"
          y="8"
          width="16"
          height="5"
          rx="2.5"
        />
        <rect
          className="phone-card"
          x="9"
          y="30"
          width="46"
          height="34"
          rx="7"
        />
        <rect
          className="phone-line"
          x="15"
          y="38"
          width="20"
          height="4"
          rx="2"
        />
        <rect
          className="phone-line phone-line-dim"
          x="15"
          y="47"
          width="30"
          height="7"
          rx="2"
        />
        <rect
          className="phone-cta"
          x="9"
          y="80"
          width="46"
          height="11"
          rx="5.5"
        />
      </svg>
    </span>
  );
}
