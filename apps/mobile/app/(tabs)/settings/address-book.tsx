import React, { useRef, useState } from "react";
import { Image, View } from "react-native";
import { router } from "expo-router";
import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenActionFooter } from "@/components/ui/molecules";
import {
  AddContactSheet,
  AddContactSheetRef,
} from "@/components/ui/organisms/modals/AddContactSheet";
import { Ionicons } from "@expo/vector-icons";
import HapticPressable from "@/components/ui/atoms/HapticPressable";

interface Contact {
  name: string;
  address: string;
}

export default function AddressBookScreen() {
  const addContactRef = useRef<AddContactSheetRef>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);

  const handleAdd = (contact: Contact) => {
    setContacts((prev) => [...prev, contact]);
  };

  return (
    <ScreenLayout>
      <View className="flex-1">
        <View className="mt-6">
          <Image
            source={require("@/assets/icons/address-book.png")}
            className="size-9"
            resizeMode="contain"
          />
        </View>

        <Typography weight="700" className="mt-3 text-3xl text-black">
          Address book
        </Typography>
        <Typography
          weight="500"
          className="mt-2 text-base leading-6 text-black/40"
        >
          Save frequently used addresses{"\n"}for easy access.
        </Typography>

        {contacts.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <View className="mb-4 h-14 w-24 items-center justify-center rounded-full border-2 border-dashed border-black/15 bg-black/[0.03]">
              <Ionicons name="people-outline" size={22} color="#00000033" />
            </View>
            <Typography weight="700" className="text-lg text-black">
              No Contacts yet
            </Typography>
            <Typography weight="500" className="mt-1 text-base text-black/40">
              Add Contacts to your address book
            </Typography>
          </View>
        ) : (
          <View className="mt-6 flex-1 gap-2">
            {contacts.map((c) => (
              <View
                key={`${c.name}-${c.address}`}
                className="flex-row items-center rounded-2xl border border-black/10 bg-white p-4"
              >
                <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-black/[0.04]">
                  <Ionicons name="person-outline" size={18} color="#000" />
                </View>
                <View className="flex-1">
                  <Typography weight="600" className="text-base text-black">
                    {c.name}
                  </Typography>
                  <Typography weight="500" className="text-xs text-black/40">
                    {c.address.slice(0, 4)}...{c.address.slice(-4)}
                  </Typography>
                </View>
                <HapticPressable className="p-1">
                  <Ionicons
                    name="ellipsis-horizontal"
                    size={18}
                    color="#00000066"
                  />
                </HapticPressable>
              </View>
            ))}
          </View>
        )}

        <ScreenActionFooter
          onBack={() => router.back()}
          actionLabel="Add Contact"
          onAction={() => addContactRef.current?.present()}
        />
      </View>

      <AddContactSheet ref={addContactRef} onAdd={handleAdd} />
    </ScreenLayout>
  );
}
