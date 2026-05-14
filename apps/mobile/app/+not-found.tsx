import React from "react";
import { Link, Stack } from "expo-router";

import { ThemedText, ThemedView } from "@/components/ui/atoms";
import * as Sentry from "@sentry/react-native";

export default function NotFoundScreen() {
  Sentry.captureException(new Error(`Not found screen. (+not-found.tsx)`));
  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <ThemedView className="flex-1 items-center justify-center p-5">
        <ThemedText type="large">This screen doesn&apos;t exist.</ThemedText>
        <Link href="/" className="mt-[15px] py-[15px]">
          <ThemedText type="link">Go to home screen!</ThemedText>
        </Link>
      </ThemedView>
    </>
  );
}
