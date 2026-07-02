import React, { useMemo, useCallback, forwardRef, useRef } from "react";
import { View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import {
  CameraView,
  useCameraPermissions,
  BarcodeScanningResult,
  PermissionResponse,
} from "expo-camera";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Ionicons } from "@expo/vector-icons";
import { isPublicKey } from "@/utils/solana";

interface QRScannerModalProps {
  onScan: (address: string) => void;
}

export const QRScannerModal = forwardRef<BottomSheetModal, QRScannerModalProps>(
  ({ onScan }, ref) => {
    const snapPoints = useMemo(() => ["94%"], []);
    const [permission, requestPermission] = useCameraPermissions();
    const hasScanned = useRef(false);

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.5}
        />
      ),
      []
    );

    const handleSheetChanges = useCallback((index: number) => {
      if (index === -1) {
        hasScanned.current = false;
      }
    }, []);

    const handleClose = () => {
      // @ts-ignore
      ref?.current?.dismiss();
    };

    const handleBarCodeScanned = useCallback(
      (result: BarcodeScanningResult) => {
        if (hasScanned.current) return;
        if (!isPublicKey(result.data)) return;
        hasScanned.current = true;

        const address = result.data;
        onScan(address);
        handleClose();
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [onScan]
    );

    return (
      <BottomSheetModal
        ref={ref}
        index={0}
        snapPoints={snapPoints}
        onChange={handleSheetChanges}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        handleIndicatorStyle={{
          position: "absolute",
          top: 30,
          backgroundColor: "rgba(255,255,255,0.4)",
          width: "9%",
        }}
        stackBehavior="push"
        containerStyle={{ zIndex: 2 }}
      >
        <BottomSheetView className="h-full flex-1 bg-[#F0F0F0]">
          <RenderContent
            permission={permission}
            requestPermission={requestPermission}
            handleBarCodeScanned={handleBarCodeScanned}
          />
        </BottomSheetView>
      </BottomSheetModal>
    );
  }
);

QRScannerModal.displayName = "QRScannerModal";

type RenderContentProps = {
  permission: PermissionResponse | null;
  requestPermission: () => Promise<PermissionResponse>;
  handleBarCodeScanned: (result: BarcodeScanningResult) => void;
};

const RenderContent = ({
  permission,
  requestPermission,
  handleBarCodeScanned,
}: RenderContentProps) => {
  if (!permission) {
    return null;
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Ionicons name="camera-outline" size={48} color="#00000066" />
        <Typography weight="600" className="mb-2 mt-4 text-center text-lg">
          Camera Access Required
        </Typography>
        <Typography weight="500" className="mb-6 text-center text-black/40">
          We need camera access to scan QR codes
        </Typography>
        <HapticPressable
          className="rounded-full bg-black px-6 py-3"
          onPress={requestPermission}
        >
          <Typography weight="600" className="text-white">
            Grant Access
          </Typography>
        </HapticPressable>
      </View>
    );
  }

  return (
    <View className="flex-1 rounded-3xl">
      <CameraView
        style={{ flex: 1, height: 400, width: 400 }}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
        onBarcodeScanned={handleBarCodeScanned}
      />
      <View className="absolute inset-0 items-center justify-center">
        <View className="relative size-72">
          <View className="absolute left-0 top-0 size-16 rounded-tl-[40px] border-l-[5px] border-t-[5px] border-white" />
          <View className="absolute right-0 top-0 size-16 rounded-tr-[40px] border-r-[5px] border-t-[5px] border-white" />
          <View className="absolute bottom-0 left-0 size-16 rounded-bl-[40px] border-b-[5px] border-l-[5px] border-white" />
          <View className="absolute bottom-0 right-0 size-16 rounded-br-[40px] border-b-[5px] border-r-[5px] border-white" />
        </View>
      </View>

      <Typography
        weight="500"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl text-white"
      >
        Scan a QR code
      </Typography>
    </View>
  );
};
