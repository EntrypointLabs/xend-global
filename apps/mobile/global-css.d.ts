// Side-effect CSS imports (e.g. `import "@/global.css"`) rely on this ambient
// module. Expo normally declares it via the generated `expo-env.d.ts`, which is
// gitignored and therefore absent in CI, so declare it in a tracked file to keep
// type-checking green everywhere.
declare module "*.css";
