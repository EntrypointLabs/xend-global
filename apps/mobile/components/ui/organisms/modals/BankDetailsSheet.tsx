import React, {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Share, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
  BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { BlurBackdrop } from "@/components/ui/molecules/BlurBackdrop";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { Divider } from "@/components/ui/atoms/Divider";
import { ScreenThemeProvider } from "@/contexts/ScreenThemeContext";
import { Footnote, PillButton } from "@/components/ui/kit";
import { useAuth } from "@/contexts/AuthContext";
import { useUserId } from "@/hooks/useUserId";
import { apiClient } from "@/utils/apiClient";
import type { BankAccountRecordSchema } from "@/utils/bank-accounts";
import { copyToClipboard } from "@/utils/clipboard";
import { cn } from "@/utils/cn";
import { SEED_DEMO, SEED_USER } from "@/utils/devSeed";

type BankAccountRecord = z.infer<typeof BankAccountRecordSchema>;
type ActiveAccount = NonNullable<BankAccountRecord["account"]>;

const DIVIDER_COLOR = "rgba(0,0,0,0.12)";

const BENEFITS: {
  icon: keyof typeof Ionicons.glyphMap;
  tile: string;
  color: string;
  text: string;
}[] = [
  {
    icon: "swap-horizontal",
    tile: "bg-success/15",
    color: "#16A34A",
    text: "Get paid in naira by anyone with a bank account",
  },
  {
    icon: "arrow-down-circle-outline",
    tile: "bg-info/15",
    color: "#2563EB",
    text: "Money you receive lands in your Xend Account",
  },
  {
    icon: "flash-outline",
    tile: "bg-orange-500/15",
    color: "#F97316",
    text: "Set up in a minute with your name",
  },
];

function groupAccountNumber(digits: string) {
  return digits.length === 10
    ? `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
    : digits;
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong. Please try again.";
}

export const BankDetailsSheet = forwardRef<BottomSheetModal>((_, ref) => {
  const snapPoints = useMemo(() => ["94%"], []);
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => <BlurBackdrop {...props} />,
    []
  );

  const { isAuthenticated, email: authEmail } = useAuth();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["fiat", "bank-accounts", userId], [userId]);

  const accountsQuery = useQuery({
    queryKey,
    queryFn: () => apiClient.bankAccounts(),
    enabled: isAuthenticated === true,
    refetchInterval: (query) =>
      query.state.data?.accounts[0]?.status === "creating" ? 5000 : false,
  });

  const [step, setStep] = useState<"overview" | "name">("overview");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const email = authEmail || (SEED_DEMO ? SEED_USER.email : "");
  const data = accountsQuery.data;
  const record = data?.accounts[0] ?? null;
  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    email.length > 0;

  const handleDismiss = () => {
    setStep("overview");
    setSubmitError(null);
    setCheckError(null);
  };

  const handleCreate = async () => {
    if (inFlight.current || !canSubmit) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiClient.createBankAccount({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email,
      });
      await queryClient.invalidateQueries({ queryKey });
      setStep("overview");
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const handleCheckStatus = async () => {
    if (!record || inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setCheckError(null);
    try {
      await apiClient.reconcileBankAccount(record.id);
      await queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      setCheckError(errorMessage(error));
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  };

  const handleShare = (account: ActiveAccount) => {
    void Share.share({
      message: `Bank: ${account.bankName}\nAccount number: ${account.accountNumber}\nAccount name: ${account.accountName}`,
    });
  };

  const active =
    record?.status === "active" && record.account ? record.account : null;
  const showCreate =
    !accountsQuery.isPending &&
    !accountsQuery.isError &&
    !record &&
    data?.available;

  let body: React.ReactNode;
  let footer: React.ReactNode = null;

  if (accountsQuery.isPending) {
    body = (
      <View className="mt-16 items-center">
        <ActivityIndicator size="small" color="black" />
      </View>
    );
  } else if (accountsQuery.isError) {
    body = (
      <Card>
        <CardTitle
          title="Could not load your account details"
          subtitle="Check your connection and try again."
        />
        <PillButton
          title="Try again"
          tone="quiet"
          size="sm"
          className="mt-5"
          onPress={() => void accountsQuery.refetch()}
        />
      </Card>
    );
  } else if (active) {
    body = (
      <>
        <Card>
          <CardTitle
            title="Naira bank account"
            subtitle="Accept transfers from any Nigerian bank"
          />
          <Divider
            type="dashed"
            color={DIVIDER_COLOR}
            dashGap={6}
            className="my-5"
          />
          <View className="gap-5">
            <CopyRow
              label="Account number"
              value={groupAccountNumber(active.accountNumber)}
              copyValue={active.accountNumber}
              copyLabel="account number"
            />
            <CopyRow
              label="Bank name"
              value={active.bankName}
              copyLabel="bank name"
            />
            <CopyRow
              label="Account name"
              value={active.accountName}
              copyLabel="account name"
            />
          </View>
        </Card>
        <Footnote className="mt-4 text-center">
          Transfers usually arrive within minutes.
        </Footnote>
      </>
    );
    footer = (
      <PillButton
        title="Share account details"
        tone="quiet"
        onPress={() => handleShare(active)}
      />
    );
  } else if (record?.status === "creating") {
    body = (
      <Card>
        <CardTitle
          title="Naira bank account"
          subtitle="Receive transfers from any Nigerian bank"
        />
        <Divider
          type="dashed"
          color={DIVIDER_COLOR}
          dashGap={6}
          className="my-5"
        />
        <View className="flex-row items-center gap-3">
          <ActivityIndicator size="small" color="black" />
          <Typography
            weight="500"
            className="flex-1 text-[15px] leading-5 text-black/40"
          >
            Setting up your account. This takes a few seconds.
          </Typography>
        </View>
      </Card>
    );
  } else if (record) {
    body = (
      <Card>
        <CardTitle
          title="We could not confirm your account yet"
          subtitle="This can take a little longer sometimes. Check again in a moment."
        />
        <PillButton
          title="Check status"
          tone="quiet"
          size="sm"
          className="mt-5"
          loading={checking}
          onPress={() => void handleCheckStatus()}
        />
        {checkError ? (
          <Footnote tone="error" className="mt-3">
            {checkError}
          </Footnote>
        ) : null}
      </Card>
    );
  } else if (showCreate && step === "name") {
    body = (
      <Card>
        <CardTitle
          title="Your name"
          subtitle="Use the name on your bank records so transfers match"
        />
        <Divider
          type="dashed"
          color={DIVIDER_COLOR}
          dashGap={6}
          className="my-5"
        />
        <View className="gap-3">
          <NameInput
            value={firstName}
            onChangeText={setFirstName}
            placeholder="First name"
            autoComplete="given-name"
            textContentType="givenName"
          />
          <NameInput
            value={lastName}
            onChangeText={setLastName}
            placeholder="Last name"
            autoComplete="family-name"
            textContentType="familyName"
          />
        </View>
        {email ? (
          <Typography weight="500" className="mt-4 text-[13px] text-black/40">
            {`We'll use ${email}`}
          </Typography>
        ) : null}
        {submitError ? (
          <Footnote tone="error" className="mt-3">
            {submitError}
          </Footnote>
        ) : null}
        <View className="mt-5 flex-row gap-3">
          <PillButton
            title="Create account"
            size="sm"
            disabled={!canSubmit}
            loading={submitting}
            onPress={() => void handleCreate()}
          />
          <PillButton
            title="Back"
            size="sm"
            tone="quiet"
            onPress={() => setStep("overview")}
          />
        </View>
      </Card>
    );
  } else if (showCreate) {
    body = (
      <Card footer>
        <View className="px-7 pt-7">
          <View className="mb-5 size-12 items-center justify-center rounded-full bg-success/15">
            <Ionicons name="business-outline" size={22} color="#16A34A" />
          </View>
          <CardTitle
            title="Naira bank account"
            subtitle="Receive transfers from any Nigerian bank"
          />
          <Divider
            type="dashed"
            color={DIVIDER_COLOR}
            dashGap={6}
            className="my-5"
          />
          <View className="gap-5 pb-7">
            {BENEFITS.map((benefit) => (
              <View key={benefit.text} className="flex-row items-center gap-4">
                <View
                  className={cn(
                    "size-9 items-center justify-center rounded-xl",
                    benefit.tile
                  )}
                >
                  <Ionicons
                    name={benefit.icon}
                    size={18}
                    color={benefit.color}
                  />
                </View>
                <Typography
                  weight="500"
                  className="flex-1 text-[15px] leading-5 text-black/40"
                >
                  {benefit.text}
                </Typography>
              </View>
            ))}
          </View>
        </View>
        <View className="flex-row items-center justify-center gap-2 bg-black/[0.02] py-4">
          <Ionicons name="checkmark-circle" size={18} color="black" />
          <Typography weight="500" className="text-[15px] text-black">
            Ready to use right away
          </Typography>
        </View>
      </Card>
    );
    footer = (
      <PillButton title="Create account" onPress={() => setStep("name")} />
    );
  } else {
    body = (
      <Card>
        <CardTitle
          title="Naira accounts are not open yet"
          subtitle="You will be able to receive naira here soon."
        />
      </Card>
    );
  }

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      onDismiss={handleDismiss}
      handleIndicatorStyle={{ display: "none" }}
      backgroundStyle={{ backgroundColor: "#F0F0F0" }}
      containerStyle={{ zIndex: 1 }}
    >
      <ScreenThemeProvider>
        <BottomSheetView className="h-full flex-1 bg-[#F0F0F0]">
          <View className="mb-8 items-center px-4">
            <TabHeaderText className="text-center">Receive</TabHeaderText>
            <Typography weight="500" className="mt-1 text-sm text-black/30">
              Receive naira via bank transfer
            </Typography>
          </View>

          <View className="mx-6">{body}</View>

          <View className="h-full flex-1" />

          <View className="mx-6 mb-8 gap-3">
            {__DEV__ && data ? (
              <Footnote className="text-center">
                {`${data.provider ?? "no provider"} · ${data.environment}`}
              </Footnote>
            ) : null}
            {footer}
          </View>
        </BottomSheetView>
      </ScreenThemeProvider>
    </BottomSheetModal>
  );
});

BankDetailsSheet.displayName = "BankDetailsSheet";

function Card({
  children,
  footer = false,
}: {
  children: React.ReactNode;
  footer?: boolean;
}) {
  return (
    <View
      className={cn(
        "overflow-hidden rounded-[28px] border border-black/5 bg-white",
        !footer && "p-7"
      )}
    >
      {children}
    </View>
  );
}

function CardTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View>
      <Typography weight="600" className="text-[18px] text-black">
        {title}
      </Typography>
      <Typography
        weight="500"
        className="mt-1 text-[15px] leading-5 text-black/30"
      >
        {subtitle}
      </Typography>
    </View>
  );
}

function CopyRow({
  label,
  value,
  copyValue,
  copyLabel,
}: {
  label: string;
  value: string;
  copyValue?: string;
  copyLabel: string;
}) {
  return (
    <HapticPressable
      feedback="none"
      accessibilityRole="button"
      accessibilityLabel={`Copy ${copyLabel}`}
      onPress={() => void copyToClipboard(copyValue ?? value, copyLabel)}
      className="flex-row items-center justify-between"
    >
      <View className="flex-1 pr-4">
        <Typography weight="500" className="text-[15px] text-black/30">
          {label}
        </Typography>
        <Typography
          weight="500"
          className="mt-1 text-[17px] tabular-nums text-black"
        >
          {value}
        </Typography>
      </View>
      <Ionicons name="copy-outline" size={18} color="#0000004D" />
    </HapticPressable>
  );
}

function NameInput(
  props: Pick<
    React.ComponentProps<typeof BottomSheetTextInput>,
    | "value"
    | "onChangeText"
    | "placeholder"
    | "autoComplete"
    | "textContentType"
  >
) {
  return (
    <BottomSheetTextInput
      {...props}
      autoCapitalize="words"
      autoCorrect={false}
      placeholderTextColor="#0000004D"
      className="h-14 rounded-full bg-black/5 px-5 text-[15px] text-black"
    />
  );
}
