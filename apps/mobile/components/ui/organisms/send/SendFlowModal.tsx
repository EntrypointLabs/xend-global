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
  BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { BlurBackdrop } from "@/components/ui/molecules/BlurBackdrop";
import { usePalette } from "@/hooks/usePalette";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import RecipientStep from "./RecipientStep";
import BankRecipientStep from "./BankRecipientStep";
import AmountStep from "./AmountStep";
import { QRScannerModal } from "./QRScannerModal";
import {
  SheetStackProvider,
  SHEET_LAYER,
  STACKED_CORNERS,
  useSheetStack,
} from "@/hooks/useSheetStack";
import { TokenPickerSheet } from "@/components/swap/TokenPickerSheet";
import { getUsdcMint } from "@/utils/cluster";
import { trackFlow } from "@/utils/analytics";
import type { BankRecipient, SendMode } from "./bankAccount";

export interface SendFlowModalRef {
  present: () => void;
  dismiss: () => void;
}

interface SendFlowModalProps {
  mode?: SendMode;
  onClose?: () => void;
  /** The token to start on, when opened from that token's page. USDC otherwise. */
  initialMint?: string;
}

type Step = "Recipient" | "Amount";

const SCREEN_WIDTH = Dimensions.get("window").width;

const springConfig = {};

export const SendFlowModal = forwardRef<BottomSheetModal, SendFlowModalProps>(
  ({ mode = "crypto", onClose, initialMint }, ref) => {
    const snapPoints = useMemo(() => ["94%"], []);
    const palette = usePalette();
    const background =
      mode === "bank" || palette.dark ? palette.card : "#F0F0F0";
    const scannerRef = useRef<BottomSheetModal>(null);
    const { stack, ownPosition, coveredStyle } = useSheetStack();
    // Beside the scanner rather than inside the amount step: a sheet opened
    // from inside this one's content lands underneath it.
    const tokenPickerRef = useRef<BottomSheetModal>(null);
    const [sendMint, setSendMint] = useState(
      () => initialMint ?? getUsdcMint()
    );

    const [, setStep] = useState<Step>("Recipient");
    const [recipient, setRecipient] = useState<string>("");
    const [bankRecipient, setBankRecipient] = useState<BankRecipient | null>(
      null
    );

    const translateX = useSharedValue(0);

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => <BlurBackdrop {...props} />,
      []
    );

    const handleSheetChanges = useCallback(
      (index: number) => {
        if (index === -1 && onClose) {
          onClose();
          setTimeout(() => {
            setStep("Recipient");
            setRecipient("");
            setBankRecipient(null);
            setSendMint(initialMint ?? getUsdcMint());
            translateX.value = 0;
          }, 300);
        }
      },
      [onClose, translateX, initialMint]
    );

    const showAmount = () => {
      if (mode === "bank")
        trackFlow("naira_withdraw", {
          rail: "bank",
          provider: "paycrest",
        }).started();
      else trackFlow("send", { rail: "wallet" }).started();
      setStep("Amount");
      Keyboard.dismiss();
      translateX.value = withSpring(-SCREEN_WIDTH, springConfig);
    };

    const handleNext = (selectedRecipient: string) => {
      setRecipient(selectedRecipient);
      showAmount();
    };

    const handleBankNext = (selected: BankRecipient) => {
      setBankRecipient(selected);
      showAmount();
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
      <SheetStackProvider value={stack}>
        <BottomSheetModal
          ref={ref}
          snapPoints={snapPoints}
          enableDynamicSizing={false}
          onChange={handleSheetChanges}
          backdropComponent={renderBackdrop}
          enablePanDownToClose={true}
          // The sheet keeps its full height while the keyboard is up. Letting it
          // shrink collapses the amount step's flexible middle to nothing, and
          // the height does not come back when the keyboard goes away.
          keyboardBehavior="extend"
          keyboardBlurBehavior="restore"
          android_keyboardInputMode="adjustResize"
          handleIndicatorStyle={{ display: "none" }}
          animatedPosition={ownPosition}
          backgroundStyle={[{ backgroundColor: background }, STACKED_CORNERS]}
          containerStyle={[SHEET_LAYER.covered, coveredStyle]}
        >
          <BottomSheetView className="h-full flex-1 overflow-hidden">
            {/* The sheet renders through a portal, which drops the provider above. */}
            <SheetStackProvider value={stack}>
              <Animated.View
                className="w-[200%] flex-1 flex-row"
                style={requestLayout}
              >
                <View className="w-full flex-1">
                  {mode === "bank" ? (
                    <BankRecipientStep
                      onNext={handleBankNext}
                      onClose={handleClose}
                    />
                  ) : (
                    <RecipientStep
                      onClose={handleClose}
                      onNext={handleNext}
                      onScanPress={handleScanPress}
                      recipient={recipient}
                      setRecipient={setRecipient}
                    />
                  )}
                </View>
                <View className="w-full flex-1">
                  {mode === "bank" ? (
                    <AmountStep
                      mode="bank"
                      recipient={bankRecipient}
                      onBack={handleBack}
                      onClose={handleClose}
                    />
                  ) : (
                    <AmountStep
                      mode="crypto"
                      recipient={recipient}
                      mint={sendMint}
                      onChooseToken={() => tokenPickerRef.current?.present()}
                      onBack={handleBack}
                      onClose={handleClose}
                    />
                  )}
                </View>
              </Animated.View>
            </SheetStackProvider>
          </BottomSheetView>
        </BottomSheetModal>

        {mode === "crypto" && (
          <QRScannerModal ref={scannerRef} onScan={handleScan} />
        )}
        {mode === "crypto" && (
          <TokenPickerSheet
            ref={tokenPickerRef}
            side="pay"
            title="Send"
            selectedMint={sendMint}
            onPick={(token) => setSendMint(token.mint)}
            stackBehavior="push"
            containerStyle={SHEET_LAYER.covering}
          />
        )}
      </SheetStackProvider>
    );
  }
);

SendFlowModal.displayName = "SendFlowModal";
