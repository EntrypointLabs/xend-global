import React, { useMemo, useCallback, forwardRef, useRef } from "react";
import { StyleSheet, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { BlurBackdrop } from "@/components/ui/molecules/BlurBackdrop";
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
import { usePalette } from "@/hooks/usePalette";
import {
  SHEET_LAYER,
  STACKED_CORNERS,
  useCoveringSheet,
} from "@/hooks/useSheetStack";
import { withSystemPrompt } from "@/utils/systemPrompt";

interface QRScannerModalProps {
  onScan: (address: string) => void;
}

export const QRScannerModal = forwardRef<BottomSheetModal, QRScannerModalProps>(
  ({ onScan }, ref) => {
    const palette = usePalette();
    const { stacked, sheetProps: stackProps } = useCoveringSheet();
    const snapPoints = useMemo(() => ["94%"], []);
    const [permission, requestPermission] = useCameraPermissions();
    const hasScanned = useRef(false);

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BlurBackdrop {...props} stacked={stacked} />
      ),
      [stacked]
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
        backgroundStyle={[
          palette.dark && { backgroundColor: palette.card },
          stacked && STACKED_CORNERS,
        ]}
        stackBehavior="push"
        containerStyle={SHEET_LAYER.covering}
        {...stackProps}
      >
        <BottomSheetView className="h-full flex-1 bg-[#F0F0F0] dark:bg-card">
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
  const palette = usePalette();
  if (!permission) {
    return null;
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Ionicons name="camera-outline" size={48} color={palette.fg(0.4)} />
        <Typography
          weight="600"
          className="mb-2 mt-4 text-center text-lg text-foreground"
        >
          Camera Access Required
        </Typography>
        <Typography
          weight="500"
          className="mb-6 text-center text-foreground/40"
        >
          We need camera access to scan QR codes
        </Typography>
        <HapticPressable
          className="rounded-full bg-primary px-6 py-3"
          onPress={() => withSystemPrompt(requestPermission)}
        >
          <Typography weight="600" className="text-primary-foreground">
            Grant Access
          </Typography>
        </HapticPressable>
      </View>
    );
  }

  return (
    <View className="flex-1 overflow-hidden rounded-3xl">
      <CameraView
        style={StyleSheet.absoluteFill}
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

      <View
        className="absolute inset-0 items-center justify-center"
        pointerEvents="none"
      >
        <Typography weight="500" className="text-2xl text-white">
          Scan a QR code
        </Typography>
      </View>
    </View>
  );
};
