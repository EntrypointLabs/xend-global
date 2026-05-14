import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { View, Keyboard } from "react-native";
import {
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { QRScannerModal } from "@/components/ui/organisms/send/QRScannerModal";
import { cn } from "@/utils/cn";

export interface AddContactSheetRef {
  present: () => void;
  presentEdit: (contact: { name: string; address: string }) => void;
  dismiss: () => void;
}

interface AddContactSheetProps {
  onAdd: (contact: { name: string; address: string }) => void;
  onUpdate?: (input: {
    originalAddress: string;
    contact: { name: string; address: string };
  }) => void;
}

export const AddContactSheet = forwardRef<
  AddContactSheetRef,
  AddContactSheetProps
>(({ onAdd, onUpdate }, ref) => {
  const sheetRef = useRef<BottomSheetModal>(null);
  const scannerRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["62%"], []);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [originalAddress, setOriginalAddress] = useState<string | null>(null);
  const isEditMode = originalAddress !== null;

  useImperativeHandle(ref, () => ({
    present: () => {
      setOriginalAddress(null);
      setName("");
      setAddress("");
      sheetRef.current?.present();
    },
    presentEdit: (contact) => {
      setOriginalAddress(contact.address);
      setName(contact.name);
      setAddress(contact.address);
      sheetRef.current?.present();
    },
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.4}
      />
    ),
    []
  );

  const reset = () => {
    setName("");
    setAddress("");
    setOriginalAddress(null);
  };

  const handleSheetChange = (index: number) => {
    if (index === -1) {
      reset();
    }
  };

  const handleClose = () => {
    sheetRef.current?.dismiss();
  };

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setAddress(text.trim());
  };

  const handleScanPress = () => {
    Keyboard.dismiss();
    scannerRef.current?.present();
  };

  const handleScan = (scanned: string) => {
    setAddress(scanned);
  };

  const canSubmit = name.trim().length > 0 && address.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    Keyboard.dismiss();
    const contact = { name: name.trim(), address: address.trim() };
    if (isEditMode && originalAddress && onUpdate) {
      onUpdate({ originalAddress, contact });
    } else {
      onAdd(contact);
    }
    handleClose();
  };

  return (
    <>
      <BottomSheetModal
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        onChange={handleSheetChange}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        handleIndicatorStyle={{ display: "none" }}
        backgroundStyle={{
          backgroundColor: "#FFFFFF",
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
        }}
        containerStyle={{ zIndex: 100 }}
      >
        <BottomSheetView className="flex-1 px-6 pb-8 pt-5">
          <View className="mb-6 flex-row items-start justify-end">
            <HapticPressable onPress={handleClose} className="p-1">
              <Ionicons name="close" size={22} color="#00000066" />
            </HapticPressable>
          </View>

          <View className="mb-8 items-center">
            <View className="relative">
              <View className="h-20 w-20 items-center justify-center rounded-full bg-black/[0.04]">
                <Ionicons name="wallet-outline" size={32} color="#000" />
              </View>
              <View className="absolute -right-1 top-0 h-7 w-7 items-center justify-center rounded-full border border-black/10 bg-white">
                <Ionicons name="pencil" size={14} color="#000" />
              </View>
            </View>
          </View>

          <View className="mb-3 rounded-2xl border border-black/10 px-4 py-3">
            <BottomSheetTextInput
              value={name}
              onChangeText={setName}
              placeholder="Contact name"
              placeholderTextColor="#00000040"
              className="text-base text-black"
            />
          </View>

          <View className="mb-6 flex-row items-center rounded-2xl border border-black/10 px-4 py-3">
            <BottomSheetTextInput
              value={address}
              onChangeText={setAddress}
              placeholder="Contact address"
              placeholderTextColor="#00000040"
              className="flex-1 text-base text-black"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <HapticPressable onPress={handlePaste} className="px-2">
              <Typography weight="600" className="text-base text-black">
                Paste
              </Typography>
            </HapticPressable>
            <HapticPressable onPress={handleScanPress} className="pl-2">
              <Ionicons name="scan-outline" size={22} color="#000" />
            </HapticPressable>
          </View>

          <HapticPressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              "items-center justify-center rounded-full py-4",
              canSubmit ? "bg-black" : "bg-black/30"
            )}
          >
            <Typography weight="600" className="text-base text-white">
              {isEditMode ? "Save changes" : "Add contact"}
            </Typography>
          </HapticPressable>
        </BottomSheetView>
      </BottomSheetModal>

      <QRScannerModal ref={scannerRef} onScan={handleScan} />
    </>
  );
});

AddContactSheet.displayName = "AddContactSheet";
