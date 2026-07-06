import React, {
  useMemo,
  useCallback,
  forwardRef,
  useState,
  useRef,
} from "react";
import { View, Dimensions, Keyboard } from "react-native";
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import RecipientStep from "./RecipientStep";
import AmountStep from "./AmountStep";
import { QRScannerModal } from "./QRScannerModal";

export interface SendFlowModalRef {
  present: () => void;
  dismiss: () => void;
}

interface SendFlowModalProps {
  onClose?: () => void;
}

type Step = "Recipient" | "Amount";

const SCREEN_WIDTH = Dimensions.get("window").width;

const springConfig = {};

export const SendFlowModal = forwardRef<BottomSheetModal, SendFlowModalProps>(
  ({ onClose }, ref) => {
    const snapPoints = useMemo(() => ["94%"], []);
    const scannerRef = useRef<BottomSheetModal>(null);

    const [, setStep] = useState<Step>("Recipient");
    const [recipient, setRecipient] = useState<string>("");

    const translateX = useSharedValue(0);

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

    const handleSheetChanges = useCallback(
      (index: number) => {
        if (index === -1 && onClose) {
          onClose();
          setTimeout(() => {
            setStep("Recipient");
            setRecipient("");
            translateX.value = 0;
          }, 300);
        }
      },
      [onClose, translateX]
    );

    const handleNext = (selectedRecipient: string) => {
      setRecipient(selectedRecipient);
      setStep("Amount");

      Keyboard.dismiss();
      translateX.value = withSpring(-SCREEN_WIDTH, springConfig);
    };

    const handleBack = () => {
      setStep("Recipient");
      translateX.value = withSpring(0, springConfig);
    };

    const handleClose = () => {
      // @ts-ignore
      ref?.current?.dismiss();
    };

    const handleScanPress = () => {
      Keyboard.dismiss();
      scannerRef.current?.present();
    };

    const handleScan = (address: string) => {
      setRecipient(address);
    };

    const requestLayout = useAnimatedStyle(() => {
      return {
        transform: [{ translateX: translateX.value }],
      };
    });

    return (
      <>
        <BottomSheetModal
          ref={ref}
          snapPoints={snapPoints}
          enableDynamicSizing={false}
          onChange={handleSheetChanges}
          backdropComponent={renderBackdrop}
          enablePanDownToClose={true}
          keyboardBlurBehavior="restore"
          android_keyboardInputMode="adjustResize"
          handleIndicatorStyle={{ display: "none" }}
          backgroundStyle={{ backgroundColor: "#F0F0F0" }}
          containerStyle={{ zIndex: 1 }}
        >
          <BottomSheetView className="h-full flex-1 overflow-hidden bg-[#F0F0F0]">
            <Animated.View
              className="w-[200%] flex-1 flex-row"
              style={requestLayout}
            >
              <View className="w-full flex-1">
                <RecipientStep
                  onClose={handleClose}
                  onNext={handleNext}
                  onScanPress={handleScanPress}
                  recipient={recipient}
                  setRecipient={setRecipient}
                />
              </View>
              <View className="w-full flex-1">
                <AmountStep
                  recipient={recipient}
                  onBack={handleBack}
                  onClose={handleClose}
                />
              </View>
            </Animated.View>
          </BottomSheetView>
        </BottomSheetModal>

        <QRScannerModal ref={scannerRef} onScan={handleScan} />
      </>
    );
  }
);

SendFlowModal.displayName = "SendFlowModal";
