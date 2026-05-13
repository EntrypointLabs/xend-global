/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./App.tsx",
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./contexts/**/*.{js,jsx,ts,tsx}",
    "./hooks/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: "hsl(var(--primary) / <alpha-value>)",
        "primary-foreground": "hsl(var(--primary-foreground) / <alpha-value>)",
        success: "hsl(var(--success) / <alpha-value>)",
        destructive: "hsl(var(--destructive) / <alpha-value>)",
        info: "hsl(var(--info) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        card: "hsl(var(--card) / <alpha-value>)",
        icon: "hsl(var(--icon) / <alpha-value>)",
        tint: "hsl(var(--tint) / <alpha-value>)",
        "tab-icon-default": "hsl(var(--tab-icon-default) / <alpha-value>)",
        "tab-icon-selected": "hsl(var(--tab-icon-selected) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter_400Regular"],
        "inter-thin": ["Inter_100Thin"],
        "inter-extralight": ["Inter_200ExtraLight"],
        "inter-light": ["Inter_300Light"],
        "inter-regular": ["Inter_400Regular"],
        "inter-medium": ["Inter_500Medium"],
        "inter-semibold": ["Inter_600SemiBold"],
        "inter-bold": ["Inter_700Bold"],
        "inter-extrabold": ["Inter_800ExtraBold"],
        "inter-black": ["Inter_900Black"],
      },
    },
  },
  plugins: [],
};
