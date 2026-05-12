import LoadingScreen from "@/components/ui/layout/LoadingScreen";
import { useLocalSearchParams } from "expo-router";
import React from "react";

function PasskeyCallbackScreen() {
  console.log("passkey_callback");
  const searchParams = useLocalSearchParams();

  const { status } = searchParams;

  console.log("status", { status, searchParams });
  console.log("url");

  // if (status === 'success') {
  //     return <Redirect href="/(tabs)" withAnchor />
  // }

  return <LoadingScreen />;
}

export default PasskeyCallbackScreen;
