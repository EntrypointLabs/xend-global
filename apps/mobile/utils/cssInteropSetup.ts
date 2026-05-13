// Registers cssInterop for React Native primitives and third-party wrappers
// that don't natively forward `className` to their internal `style` prop.
// Without this, NativeWind classes silently no-op on these components.
// See .claude/plans/style-cleanup/research/PITFALLS.md (C4) and ADR-0001.
//
// Import this file once at the top of `app/_layout.tsx` (side-effect only).

import { cssInterop } from "nativewind";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

cssInterop(SafeAreaView, { className: "style" });
cssInterop(KeyboardAvoidingView, { className: "style" });
cssInterop(Ionicons, { className: "style" });
