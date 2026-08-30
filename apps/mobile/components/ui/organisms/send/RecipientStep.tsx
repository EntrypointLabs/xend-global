import React, { useRef, useEffect, useMemo, useCallback, memo } from "react";
import {
  View,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Keyboard,
} from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import * as Clipboard from "expo-clipboard";
import {
  Ionicons,
  FontAwesome5,
  MaterialCommunityIcons,
  MaterialIcons,
} from "@expo/vector-icons";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import {
  BottomSheetTextInput,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { truncateAddress } from "@/utils/helper";
import { TextInput } from "react-native-gesture-handler";
import { isPublicKey, isSnsName, resolveSnsName } from "@/utils/solana";
import { cn } from "@/utils/cn";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/useDebounce";
import { useContacts } from "@/hooks/useContacts";
import { useRecentRecipients } from "@/hooks/useRecentRecipients";

interface RecipientStepProps {
  onClose: () => void;
  onNext: (recipient: string) => void;
  onScanPress: () => void;
  recipient: string;
  setRecipient: (recipient: string) => void;
}

export default memo(function RecipientStep({
  onNext,
  onScanPress,
  recipient,
  setRecipient,
}: RecipientStepProps) {
  const inputRef = useRef<TextInput | null>(null);
  const debouncedRecipient = useDebounce(recipient, 400);
  const { contacts } = useContacts();
  // Saved addresses are listed above under their own name, so repeating them
  // here would put the same wallet on screen twice with two different labels.
  const savedAddresses = useMemo(
    () => contacts.map((c) => c.address),
    [contacts]
  );
  const { recipients } = useRecentRecipients({ exclude: savedAddresses });
  const sendsTo = useMemo(
    () => new Map(recipients.map((r) => [r.address, r.sends])),
    [recipients]
  );

  const isSns = debouncedRecipient.includes(".");

  const {
    data: resolvedAddress,
    isLoading: isResolving,
    error: resolveError,
  } = useQuery({
    queryKey: ["resolve-solana-name", debouncedRecipient],
    queryFn: () => resolveSnsName(debouncedRecipient),
    enabled: Boolean(
      debouncedRecipient && !isPublicKey(debouncedRecipient) && isSns
    ),
    retry: (count, error) => {
      if (count > 1) return false;
      if (error?.message === "The name account does not exist") return false;
      return true;
    },
    retryDelay: 2_000,
  });

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) return;
    if (isPublicKey(text)) {
      setRecipient(text);
    }
    const isSns = await isSnsName(text);
    if (isSns) {
      setRecipient(text);
    }
  };

  const handleContinue = useCallback(() => {
    if (isPublicKey(debouncedRecipient)) {
      onNext(debouncedRecipient);
    } else if (resolvedAddress) {
      onNext(resolvedAddress);
    }
  }, [debouncedRecipient, resolvedAddress, onNext]);

  // Focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const { isValid, label, icon } = useMemo(() => {
    if (debouncedRecipient.length === 0) {
      return { isValid: true, label: "Enter Solana address or .sol handle" };
    }

    const target = isPublicKey(debouncedRecipient)
      ? debouncedRecipient
      : resolvedAddress;
    const sends = (target && sendsTo.get(target)) ?? 0;
    const sendsLabel =
      sends === 0 ? "New address" : `${sends} send${sends === 1 ? "" : "s"}`;

    if (isSns) {
      if (isResolving) {
        return {
          isValid: true,
          label: "Resolving...",
          icon: (
            <FontAwesome5
              name="spinner"
              size={14}
              color="blue"
              className="animate-spin"
            />
          ),
        };
      }
      if (resolveError) {
        const errLabel =
          resolveError.message === "The name account does not exist"
            ? "No matching address found"
            : resolveError.message;
        return {
          isValid: false,
          label: errLabel,
          icon: (
            <MaterialCommunityIcons
              name="alert-decagram"
              size={14}
              color="red"
            />
          ),
        };
      }
      if (resolvedAddress) {
        return {
          isValid: true,
          label: `${truncateAddress(resolvedAddress)} • ${sendsLabel}`,
          icon: (
            <MaterialCommunityIcons
              name="check-decagram"
              size={14}
              color="green"
            />
          ),
        };
      }
      return { isValid: true, label: "Enter Solana address or .sol handle" };
    }

    if (isPublicKey(debouncedRecipient)) {
      return {
        isValid: true,
        label: sendsLabel,
        icon: (
          <MaterialCommunityIcons
            name="clock-time-nine"
            size={14}
            color="lightgrey"
          />
        ),
      };
    }

    return { isValid: false, label: "Invalid Solana address" };
  }, [
    debouncedRecipient,
    isResolving,
    resolveError,
    resolvedAddress,
    isSns,
    sendsTo,
  ]);

  const isContinueDisabled = useMemo(() => {
    if (debouncedRecipient.length === 0 || !isValid) return true;
    return !isPublicKey(debouncedRecipient) && !resolvedAddress;
  }, [isValid, debouncedRecipient, resolvedAddress]);

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View className="flex-1 bg-[#F0F0F0]">
        <View className="mb-8 flex-row items-center justify-between px-4">
          <View className="h-10 w-10" />
          <TabHeaderText className="pb-0 text-center font-semibold">
            Choose recipient
          </TabHeaderText>
          <TouchableOpacity
            onPress={onScanPress}
            className="h-10 w-10 items-center justify-center"
          >
            <Ionicons name="scan-outline" size={24} color="black" />
          </TouchableOpacity>
        </View>

        <View className="mx-4 mb-8 rounded-[24px] border border-white bg-[#F9F9F9] p-4">
          <TouchableOpacity
            className="relative bg-transparent"
            onPress={() => inputRef.current?.focus()}
          >
            <BottomSheetTextInput
              className="-ml-1 mb-1.5 w-[235px] py-0 text-base font-medium text-black/90"
              placeholder="Address or .sol handle"
              placeholderTextColor="#0000004D"
              value={recipient}
              onChangeText={setRecipient}
              autoCapitalize="none"
              autoCorrect={false}
              ref={inputRef}
              style={{ fontFamily: "Inter_500Medium" }}
              returnKeyType="go"
              onSubmitEditing={handleContinue}
              submitBehavior="blurAndSubmit"
              multiline
            />
            <TouchableOpacity
              onPress={() => inputRef.current?.focus()}
              className="mb-2.5 flex-row items-center justify-start gap-1"
            >
              {icon}
              <Typography
                weight="600"
                className={cn(
                  "text-xs text-black/30",
                  !isValid && "text-red-500"
                )}
              >
                {label}
              </Typography>
            </TouchableOpacity>

            {recipient && (
              <HapticPressable
                className="absolute -right-5 -top-5 z-10 p-5 transition-all duration-200 ease-in-out"
                onPress={() => setRecipient("")}
              >
                <Ionicons name="close-circle" size={20} color="lightgrey" />
              </HapticPressable>
            )}
          </TouchableOpacity>

          <View className="flex-row gap-2.5">
            <HapticPressable
              className={cn(
                "rounded-full px-6 py-[8px]",
                !isContinueDisabled ? "bg-black" : "bg-black/30"
              )}
              onPress={handleContinue}
              disabled={isContinueDisabled}
            >
              <Typography weight="600" className="text-white">
                Continue
              </Typography>
            </HapticPressable>

            <HapticPressable
              className="flex-row items-center gap-1 rounded-full bg-black/10 px-6 py-[8px]"
              onPress={handlePaste}
            >
              <Ionicons name="document" size={16} color="black" />
              <Typography weight="600" className="text-black">
                Paste
              </Typography>
            </HapticPressable>
          </View>
        </View>

        {/* A section with nothing in it is dropped rather than shown empty: a
            Consumer who has never sent has no use for a heading saying so. */}
        <BottomSheetScrollView showsVerticalScrollIndicator={false}>
          {contacts.length > 0 && (
            <>
              <Typography weight="600" className="mb-4 ml-5 text-lg">
                Address book
              </Typography>
              {contacts.map((contact) => (
                <RecipientRow
                  key={contact.address}
                  title={contact.name}
                  subtitle={truncateAddress(contact.address)}
                  onPress={() => {
                    setRecipient(contact.address);
                    onNext(contact.address);
                  }}
                />
              ))}
            </>
          )}

          {recipients.length > 0 && (
            <>
              <Typography
                weight="600"
                className={cn(
                  "mb-4 ml-5 text-lg",
                  contacts.length > 0 && "mt-4"
                )}
              >
                Recent addresses
              </Typography>
              {recipients.map((entry) => (
                <RecipientRow
                  key={entry.address}
                  title={truncateAddress(entry.address)}
                  subtitle={`${entry.sends} send${entry.sends === 1 ? "" : "s"}`}
                  onPress={() => {
                    setRecipient(entry.address);
                    onNext(entry.address);
                  }}
                />
              ))}
            </>
          )}
        </BottomSheetScrollView>
      </View>
    </TouchableWithoutFeedback>
  );
});

function RecipientRow({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      className="mx-5 mb-4 flex-row items-center"
      onPress={onPress}
    >
      <View
        className="mr-3 h-12 w-12 items-center justify-center rounded-full border bg-gray-200/60"
        style={{ borderColor: "#F2F4F7" }}
      >
        <MaterialIcons name="wallet" size={22} color="black" />
      </View>
      <View>
        <Typography weight="600" className="text-base">
          {title}
        </Typography>
        <Typography weight="500" className="text-sm text-gray-400">
          {subtitle}
        </Typography>
      </View>
    </TouchableOpacity>
  );
}
