import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";
import prettierConfig from "eslint-config-prettier";

// Style-cleanup enforcement rules will be added here once the conversion of
// reachable files (style-cleanup phases 3-5) is complete. Until then the rules
// would fire on legitimate in-flight code. See docs/adr/0006-lint-enforcement-policy.md
// for the target shape:
//
// 1. CallExpression[callee.object.name='StyleSheet'][callee.property.name='create']
// 2. JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression
// 3. ImportDeclaration[source.value=/useThemeColor/]
//
// Allowed exceptions (REANIMATED-EXCEPTION, MEASURED-LAYOUT, DYNAMIC-COLOR,
// PLATFORM-SHADOW, GESTURE-DRIVEN) are documented in ADR-0004 and apps/mobile/STYLE.md.

export default defineConfig([
  ...expoConfig,
  prettierConfig,
  {
    ignores: ["node_modules/", ".expo/", "dist/", "android/", "ios/"],
  },
]);
