import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";
import prettierConfig from "eslint-config-prettier";

// Style-cleanup enforcement rules will be added here once the remaining files
// are converted; until then the rules would fire on legitimate in-flight code.
// See docs/adr/0006-lint-enforcement-policy.md for the target shape:
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
  {
    // eslint-config-expo 56 enables the React Compiler diagnostic rules from
    // eslint-plugin-react-hooks. This codebase predates React Compiler and is
    // not adopting it yet, so these rules fire on intentional, idiomatic
    // patterns rather than real defects:
    //   - immutability: Reanimated shared-value `.value =` writes (the
    //     documented REANIMATED-EXCEPTION pattern, see ADR-0004).
    //   - refs: lazy `useRef(PanResponder.create(...))` gesture init and
    //     toast/animation refs read in render-adjacent code.
    //   - set-state-in-effect: fetch/initialise-on-mount effects.
    // The classic rules-of-hooks and exhaustive-deps stay enforced. Re-enable
    // these when/if a deliberate React Compiler adoption lands.
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
