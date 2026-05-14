import React, { useEffect, useState } from "react";
import { View, TouchableOpacity } from "react-native";
import { ThemedText, IconSymbol } from "@/components/ui/atoms";
import { useThemeColor } from "@/hooks/useThemeColor";
import { ExternalAccountMapping } from "@/types/Transaction";
import { AUTH_STORAGE_KEYS } from "@/utils/auth";
import { StorageService } from "@/utils/storage";

interface SavedAccountsProps {
  onAddNew: () => void;
  onSelect: (accountId: string) => void;
}

export const SavedAccounts: React.FC<SavedAccountsProps> = ({
  onAddNew,
  onSelect,
}) => {
  const [accounts, setAccounts] = useState<ExternalAccountMapping[]>([]);
  const textColor = useThemeColor({}, "text");

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const storage = (await StorageService.getItem(
        AUTH_STORAGE_KEYS.EXTERNAL_ACCOUNTS
      )) as string;
      if (storage) {
        const parsedStorage = JSON.parse(storage);
        setAccounts(parsedStorage.accounts || []);
      }
    } catch (error) {
      console.error("Error loading accounts:", error);
    }
  };

  if (accounts.length === 0) {
    return (
      <View className="w-full">
        <TouchableOpacity
          className="flex-row items-center gap-1 p-2"
          onPress={onAddNew}
        >
          <IconSymbol name="plus" size={20} color={textColor} />
          <ThemedText type="regular">Add New Account</ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="w-full">
      <View className="mb-4 flex-row items-center justify-between">
        <ThemedText type="regular" className="text-foreground/25">
          Saved Accounts
        </ThemedText>
        <TouchableOpacity
          className="flex-row items-center gap-1 p-2"
          onPress={onAddNew}
        >
          <IconSymbol name="plus" size={20} color={textColor} />
          <ThemedText type="regular">Add New</ThemedText>
        </TouchableOpacity>
      </View>
      <View className="gap-2">
        {accounts.map((account) => (
          <TouchableOpacity
            key={account.external_account_id}
            className="flex-row items-center justify-between rounded-lg border border-black/10 bg-background p-4"
            onPress={() => onSelect(account.external_account_id)}
          >
            <View className="gap-1">
              <ThemedText type="default">{account.label}</ThemedText>
              <ThemedText type="regular" className="text-foreground/25">
                Account ID: {account.external_account_id.slice(-4)}
              </ThemedText>
            </View>
            <IconSymbol
              name="chevron.right"
              size={20}
              color={textColor + "40"}
            />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};
