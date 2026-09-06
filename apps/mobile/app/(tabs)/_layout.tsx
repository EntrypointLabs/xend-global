import { Tabs } from "expo-router";
import React from "react";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { AccountSetupReminder } from "@/components/AccountSetupReminder";
import { DeviceRotationRunner } from "@/components/DeviceRotationRunner";
import { PrimaryRotationRunner } from "@/components/PrimaryRotationRunner";
import { PendingChangeNotice } from "@/components/PendingChangeNotice";
import { RecoveryChangeRunner } from "@/components/RecoveryChangeRunner";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { CustomTabBar } from "@/components/ui/organisms";

export default function TabLayout() {
  return (
    <ProtectedRoute>
      <Tabs
        tabBar={(props) => (
          <CustomTabBar {...(props as unknown as BottomTabBarProps)} />
        )}
        screenOptions={{
          headerShown: false,
          // A tab nobody is looking at should cost nothing. Without this every
          // mounted tab re-renders alongside the one being navigated to, which
          // is most of what made a tab change take the better part of a second
          // on Android.
          freezeOnBlur: true,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: "History",
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: "Settings",
          }}
        />
      </Tabs>
      <AccountSetupReminder />
      <DeviceRotationRunner />
      <PrimaryRotationRunner />
      <PendingChangeNotice />
      <RecoveryChangeRunner />
    </ProtectedRoute>
  );
}
