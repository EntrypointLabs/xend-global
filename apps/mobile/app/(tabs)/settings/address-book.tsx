import React, { useRef, useState } from "react";
import { Alert, Image, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import {
  ContactActionsPopover,
  PopoverAnchor,
  ScreenActionFooter,
} from "@/components/ui/molecules";
import {
  AddContactSheet,
  AddContactSheetRef,
} from "@/components/ui/organisms/modals/AddContactSheet";
import { EditWalletModal } from "@/components/ui/organisms/modals/EditWalletModal";
import { Ionicons } from "@expo/vector-icons";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Contact, useContacts } from "@/hooks/useContacts";
import { useToast } from "@/contexts/ToastContext";

export default function AddressBookScreen() {
  const addContactRef = useRef<AddContactSheetRef>(null);
  const { contacts, addContact, removeContact, updateContact } = useContacts();
  const { showToast } = useToast();
  const [menuContact, setMenuContact] = useState<Contact | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<PopoverAnchor | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  const existingAddresses = contacts.map((c) => c.address);

  const openMenu = (
    contact: Contact,
    ref: {
      measureInWindow: (
        cb: (x: number, y: number, w: number, h: number) => void
      ) => void;
    } | null
  ) => {
    if (!ref) return;
    ref.measureInWindow((x, y, width, height) => {
      setMenuAnchor({ x, y, width, height });
      setMenuContact(contact);
    });
  };

  const closeMenu = () => {
    setMenuContact(null);
    setMenuAnchor(null);
  };

  const confirmRemove = (name: string, address: string) => {
    Alert.alert(
      "Remove contact",
      `Remove ${name} from your address book?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeContact(address),
        },
      ],
      { cancelable: true }
    );
  };

  const handleCopyAddress = async (address: string) => {
    await Clipboard.setStringAsync(address);
    showToast("Address copied to clipboard");
  };

  const handleSaveContactName = (newName: string) => {
    if (!editingContact) return;
    updateContact({
      originalAddress: editingContact.address,
      contact: { name: newName, address: editingContact.address },
    });
    setEditingContact(null);
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
              <ContactRow
                key={c.address}
                contact={c}
                onCopy={handleCopyAddress}
                onOpenMenu={openMenu}
              />
            ))}
          </View>
        )}

        <ScreenActionFooter
          onBack={() => router.back()}
          actionLabel="Add Contact"
          onAction={() => addContactRef.current?.present()}
        />
      </View>

      <ContactActionsPopover
        visible={menuContact !== null}
        anchor={menuAnchor}
        onClose={closeMenu}
        onEdit={() => {
          if (menuContact) {
            setEditingContact(menuContact);
          }
        }}
        onDelete={() => {
          if (menuContact) {
            confirmRemove(menuContact.name, menuContact.address);
          }
        }}
      />

      <AddContactSheet
        ref={addContactRef}
        onAdd={addContact}
        existingAddresses={existingAddresses}
      />

      <EditWalletModal
        visible={editingContact !== null}
        onClose={() => setEditingContact(null)}
        initialName={editingContact?.name ?? ""}
        address={editingContact?.address ?? ""}
        onSave={handleSaveContactName}
        placeholder="Contact name"
      />
    </ScreenLayout>
  );
}

interface ContactRowProps {
  contact: Contact;
  onCopy: (address: string) => void;
  onOpenMenu: (
    contact: Contact,
    ref: {
      measureInWindow: (
        cb: (x: number, y: number, w: number, h: number) => void
      ) => void;
    } | null
  ) => void;
}

function ContactRow({ contact, onCopy, onOpenMenu }: ContactRowProps) {
  const buttonRef = useRef<View>(null);

  return (
    <View className="flex-row items-center rounded-2xl border border-black/10 bg-white p-4">
      <HapticPressable
        onPress={() => onCopy(contact.address)}
        className="flex-1 flex-row items-center"
      >
        <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-black/[0.04]">
          <Ionicons name="wallet-outline" size={18} color="#000" />
        </View>
        <View className="flex-1">
          <Typography weight="600" className="text-base text-black">
            {contact.name}
          </Typography>
          <Typography weight="500" className="text-xs text-black/40">
            {contact.address.slice(0, 4)}...{contact.address.slice(-4)}
          </Typography>
        </View>
      </HapticPressable>
      <View ref={buttonRef} collapsable={false}>
        <HapticPressable
          className="p-1"
          hitSlop={8}
          onPress={() => onOpenMenu(contact, buttonRef.current)}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color="#00000066" />
        </HapticPressable>
      </View>
    </View>
  );
}
