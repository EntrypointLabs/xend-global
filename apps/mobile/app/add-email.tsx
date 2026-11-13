import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { AccountSetupModal } from "@/components/ui/organisms/modals/AccountSetupModal";
import {
  THEMED_TEXT_INPUT_HEIGHT,
  ThemedTextInput,
} from "@/components/ui/molecules/ThemedTextInput";
import { ScreenVerificationCodeInput } from "@/components/ui/organisms";
import { WithScreenTheme } from "@/components/WithScreenTheme";
import { useAccountSetup } from "@/hooks/useAccountSetup";
import { usePasskeyLogin } from "@/hooks/usePasskeyLogin";
import { useAuth } from "@/contexts/AuthContext";
import { hardwareKey } from "@/modules/hardware-key/src";
import { Email } from "@/types/Auth";
import { apiClient, apiErrorCode, apiErrorStatus } from "@/utils/apiClient";
import { cn } from "@/utils/cn";
import { AuthAtmosphere } from "@/components/ui/molecules/AuthAtmosphere";
import {
  AUTH_BRAND_BLUE,
  AUTH_CANVAS,
  AUTH_CTA,
  AUTH_CTA_LABEL,
} from "@/constants/Colors";

/** Auth primary pills: `h-14` / former `p-4` target — same as the email field. */
const AUTH_CTA_HEIGHT = THEMED_TEXT_INPUT_HEIGHT;

/**
 * The email door: the address a Consumer is reached at, proved by a code,
 * before there is a passkey or a session.
 *
 * What the code earns depends on the address, and is only known once it is
 * right. New here, the address anchors the recovery signer, minted the moment
 * the code is confirmed; the passkey comes next and is the credential, and
 * the Account is built after that. Already on an account, the code opens a
 * session that can look and start a recovery, and nothing more: spending
 * needs the passkey. Either way email never becomes a way to spend.
 *
 * A signed-in Consumer with no address on file lands here as well, and leaves
 * through the same Account setup once one is proved.
 */
type Step = "address" | "code" | "passkey" | "unlock";

function AddEmailScreen() {
  const {
    isAuthenticated,
    email: onFile,
    setEmail: setSessionEmail,
    enterWithEmail,
    logout,
  } = useAuth();
  const {
    signIn,
    signUp,
    busy: creatingPasskey,
    error: passkeyError,
    clearError: clearPasskeyError,
    wrongAccountEmail,
  } = usePasskeyLogin();
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  const [step, setStep] = useState<Step>("address");
  const [value, setValue] = useState("");
  const emailInputRef = useRef<TextInput>(null);
  /**
   * The address a code went to, held apart from the input so the code step
   * confirms what was actually mailed rather than whatever the field says by
   * the time it is submitted.
   */
  const [claimed, setClaimed] = useState<string | null>(null);
  /**
   * What the code earned, and the only thing that lets the passkey created
   * next land on this address. Held in memory only: it lives fifteen minutes
   * and a fresh code replaces it.
   */
  const [signupToken, setSignupToken] = useState<string | null>(null);
  /** The account the proved inbox named, which the passkey must match. */
  const [entryUserId, setEntryUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingUpAccount, setSettingUpAccount] = useState(false);
  /**
   * Whether this phone holds a Device Key. Replacing a lost passkey needs
   * that key to approve the change, so without one the offer would lead to
   * a screen that cannot finish; null until asked.
   */
  const [hasDeviceKey, setHasDeviceKey] = useState<boolean | null>(null);

  useEffect(() => {
    if (step !== "unlock" || hasDeviceKey !== null) return;
    let cancelled = false;
    hardwareKey
      .getPublicKey()
      .then((key) => {
        if (!cancelled) setHasDeviceKey(!!key);
      })
      .catch(() => {
        if (!cancelled) setHasDeviceKey(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, hasDeviceKey]);

  // Focus after navigation settle — autoFocus alone often misses the push
  // from login's "Continue with email".
  useEffect(() => {
    if (step !== "address") return;
    const t = setTimeout(() => emailInputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [step]);
  const {
    stage: setupStage,
    error: setupError,
    run: runAccountSetup,
    clearError: clearSetupError,
  } = useAccountSetup();

  const insets = useSafeAreaInsets();
  const signedIn = isAuthenticated === true;
  const done = () => router.replace("/(tabs)");
  const finishEntry = () => {
    if (intent === "recover") {
      router.replace("/(tabs)/settings/restore-device");
    } else {
      done();
    }
  };

  /** Address-step escape: back to login, cancel, or sign out — never trap. */
  const leaveAddressStep = () => {
    if (!signedIn) {
      router.replace("/(auth)/login");
      return;
    }
    if (onFile) {
      done();
      return;
    }
    void logout();
  };

  /**
   * The passkey attempt for an existing account, kept on this screen so a
   * refusal is a retry rather than a mystery. The pin makes a wrong pick in
   * the platform's picker a named error instead of a session for the wrong
   * account; the picker labels every credential identically, so that pick is
   * an easy mistake to make.
   */
  const unlock = async (userId: string) => {
    setError(null);
    const outcome = await signIn(userId);
    if (outcome === "signed-in") {
      finishEntry();
      return;
    }
    setStep("unlock");
    if (outcome === "wrong-account") {
      const opened = wrongAccountEmail();
      setError(
        `That passkey opens ${opened ?? "a different account"}. Pick the one for ${claimed ?? "this address"}.`
      );
    } else if (outcome === "no-account") {
      // A credential the platform still offers and no account stands behind,
      // which a failed or abandoned sign-up leaves behind. Named, because the
      // picker shows it beside the real one and calls both the same thing.
      setError(
        "That passkey is not on any Prydd account. It is left over from an earlier sign-up. Try again and pick another."
      );
    } else if (outcome === "no-passkey") {
      setError(
        `No passkey on this phone opens ${claimed ?? "this account"}. Use the phone that has it, or see below.`
      );
    }
  };

  const requestCode = async () => {
    const parsed = Email.safeParse(value.trim());
    if (!parsed.success) {
      setError("Please enter a valid email address");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      if (signedIn) {
        await apiClient.requestContactEmailCode(parsed.data);
      } else {
        await apiClient.requestSignupEmailCode(parsed.data);
      }
      setClaimed(parsed.data);
      setStep("code");
    } catch (err) {
      console.error("[add-email] could not send the code", err);
      const status = apiErrorStatus(err);
      setError(
        status === 409
          ? "That email is already on another account."
          : status === 429
            ? "Too many codes. Wait a few minutes and try again."
            : "Could not send a code to that address. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmCode = async (entered: string) => {
    if (!claimed || entered.length !== 6) {
      setError("Enter the six digits from the email");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      if (signedIn) {
        await apiClient.setContactEmail(claimed, entered);
        setSessionEmail(claimed);
        // The one moment the fingerprint prompts it costs read as part of
        // signing up rather than as an ambush on an empty dashboard.
        setSettingUpAccount(true);
      } else {
        const proof = await apiClient.verifySignupEmail(claimed, entered);
        if (proof.kind === "entry") {
          // An address already on an account, so there is nothing to create.
          // The session the code opens can only look, which is why the
          // passkey runs right here: succeeding lands them signed in fully,
          // and anything else stays on this screen as a retry.
          await enterWithEmail(proof);
          setEntryUserId(proof.user.id);
          await unlock(proof.user.id);
          return;
        }
        setSignupToken(proof.signupToken);
        setStep("passkey");
      }
    } catch (err) {
      console.error("[add-email] could not confirm the code", err);
      const status = apiErrorStatus(err);
      const code = apiErrorCode(err);
      setError(
        status === 401
          ? "That code is not right. Check the email and try again."
          : code === "EMAIL_IN_USE"
            ? "That email is already on another account."
            : code === "EMAIL_ROTATION_REQUIRED"
              ? "Your Account already has an address. It changes through Keys & Recovery in Settings."
              : status === 409
                ? "That code has expired. Send a new one."
                : status === 429
                  ? "Too many attempts. Wait a few minutes and try again."
                  : "Could not confirm that code. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const createPasskey = async () => {
    if (!signupToken) return;
    if (await signUp(signupToken)) setSettingUpAccount(true);
  };

  /** Back to the address, so a typo is fixable without leaving the screen. */
  const editAddress = () => {
    setStep("address");
    setClaimed(null);
    setSignupToken(null);
    setError(null);
    clearPasskeyError();
  };

  const onRunAccountSetup = async () => {
    if (await runAccountSetup()) done();
  };

  /**
   * Letting them through unfinished is deliberate. They can still receive at
   * their address, and blocking sign-up on a step that can be retried later is
   * worse than the degraded state it protects against.
   */
  const onSkipAccountSetup = () => {
    clearSetupError();
    done();
  };

  const disabled = saving || !value.trim();
  const addressLeaveLabel = !signedIn
    ? "Back to login"
    : onFile
      ? "Cancel"
      : "Sign out";

  return (
    <View className="flex-1" style={{ backgroundColor: AUTH_CANVAS }}>
      <AuthAtmosphere variant="quiet" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <View className="flex-1">
          <View className="px-5" style={{ paddingTop: insets.top + 8 }}>
            {step === "address" ? (
              <HapticPressable
                onPress={leaveAddressStep}
                disabled={saving}
                feedback="selection"
                className="size-10 items-center justify-center rounded-full bg-white/10"
                accessibilityLabel={addressLeaveLabel}
                hitSlop={8}
              >
                <Ionicons
                  name={!signedIn ? "chevron-back" : "close"}
                  size={22}
                  color="#FFFFFF"
                />
              </HapticPressable>
            ) : step === "code" || step === "passkey" ? (
              <HapticPressable
                onPress={editAddress}
                disabled={saving || creatingPasskey}
                feedback="selection"
                className="size-10 items-center justify-center rounded-full bg-white/10"
                accessibilityLabel="Use a different address"
                hitSlop={8}
              >
                <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
              </HapticPressable>
            ) : (
              <View className="size-10" />
            )}
          </View>

          <View
            className="flex-1 justify-end px-8"
            style={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}
          >
            <Typography
              weight="600"
              className={cn(
                "text-3xl text-white",
                step === "address" ? "mb-8" : "mb-3"
              )}
            >
              {step === "address"
                ? signedIn
                  ? "Add your email"
                  : "What's your email?"
                : step === "code"
                  ? "Check your email"
                  : step === "unlock"
                    ? "Use your passkey"
                    : "Create your passkey"}
            </Typography>
            {step !== "address" && (
              <Typography
                weight="400"
                className="mb-8 text-base leading-6 text-white/50"
              >
                {step === "code"
                  ? `We sent a six-digit code to ${claimed}. Enter it to prove this inbox is yours.`
                  : step === "unlock"
                    ? `${claimed} is open to look at. Your passkey is what unlocks sending and key changes.`
                    : "Your passkey is what signs you in. It lives in your phone's password manager, so there is nothing to remember."}
              </Typography>
            )}

            {step === "code" ? (
              // The same six boxes everywhere a code is typed, so a code
              // looks like a code across the product. It submits on the
              // sixth digit, which is why there is no separate button.
              <ScreenVerificationCodeInput
                key={claimed}
                onCodeComplete={confirmCode}
              />
            ) : step === "address" ? (
              <ThemedTextInput
                ref={emailInputRef}
                value={value}
                onChangeText={(text) => {
                  setValue(text);
                  setError(null);
                }}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                error={!!error}
                onSubmitEditing={requestCode}
                returnKeyType="go"
                editable={!saving}
                autoFocus
              />
            ) : null}

            {error && (
              <Typography weight="400" className="mt-2 text-sm text-red-400">
                {error}
              </Typography>
            )}
            {(step === "passkey" || step === "unlock") && passkeyError && (
              <Typography weight="400" className="mb-2 text-sm text-red-400">
                {passkeyError}
              </Typography>
            )}

            {step === "address" && (
              <HapticPressable
                onPress={requestCode}
                disabled={disabled}
                className={cn(
                  "mt-6 h-14 items-center justify-center rounded-full px-4",
                  disabled && "opacity-50"
                )}
                style={{
                  backgroundColor: AUTH_CTA,
                  height: AUTH_CTA_HEIGHT,
                }}
              >
                {saving ? (
                  <ActivityIndicator color={AUTH_CTA_LABEL} />
                ) : (
                  <Typography
                    weight="600"
                    className="text-lg"
                    style={{ color: AUTH_CTA_LABEL }}
                  >
                    Send me a code
                  </Typography>
                )}
              </HapticPressable>
            )}

            {step === "code" && saving && (
              <View className="mt-2 items-center p-4">
                <ActivityIndicator color="#FFF" />
              </View>
            )}

            {step === "unlock" && (
              <>
                <HapticPressable
                  onPress={() => entryUserId && unlock(entryUserId)}
                  disabled={creatingPasskey}
                  className={cn(
                    "h-14 w-full flex-row items-center justify-center gap-4 rounded-full px-4",
                    creatingPasskey && "opacity-50"
                  )}
                  style={{
                    backgroundColor: AUTH_CTA,
                    height: AUTH_CTA_HEIGHT,
                  }}
                >
                  <Ionicons
                    name="finger-print-outline"
                    size={22}
                    color={AUTH_CTA_LABEL}
                  />
                  <Typography
                    weight="600"
                    className="text-lg"
                    style={{ color: AUTH_CTA_LABEL }}
                  >
                    {creatingPasskey ? "Waiting…" : "Use passkey"}
                  </Typography>
                </HapticPressable>
                {hasDeviceKey ? (
                  <HapticPressable
                    onPress={() =>
                      router.replace("/(tabs)/settings/replace-passkey")
                    }
                    disabled={creatingPasskey}
                    className="mt-4 items-center p-2"
                  >
                    <Typography weight="500" className="text-base text-white">
                      {"I don't have a passkey for this account"}
                    </Typography>
                  </HapticPressable>
                ) : hasDeviceKey === false ? (
                  <Typography
                    weight="400"
                    className="mt-4 px-2 text-center text-sm leading-5 text-white/70"
                  >
                    No passkey for this account on this phone? Recover from the
                    phone that has your Account, or with a second Recovery Key.
                  </Typography>
                ) : null}
                <HapticPressable
                  onPress={finishEntry}
                  disabled={creatingPasskey}
                  className="mt-1 items-center p-2"
                >
                  <Typography weight="500" className="text-base text-white/70">
                    Just look around for now
                  </Typography>
                </HapticPressable>
              </>
            )}

            {step === "passkey" && (
              <HapticPressable
                onPress={createPasskey}
                disabled={creatingPasskey}
                className={cn(
                  "h-14 w-full flex-row items-center justify-center gap-4 rounded-full px-4",
                  creatingPasskey && "opacity-50"
                )}
                style={{
                  backgroundColor: AUTH_CTA,
                  height: AUTH_CTA_HEIGHT,
                }}
              >
                <Ionicons
                  name="finger-print-outline"
                  size={22}
                  color={AUTH_CTA_LABEL}
                />
                <Typography
                  weight="600"
                  className="text-lg"
                  style={{ color: AUTH_CTA_LABEL }}
                >
                  {creatingPasskey
                    ? "Creating…"
                    : passkeyError
                      ? "Try again"
                      : "Create passkey"}
                </Typography>
              </HapticPressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      <AccountSetupModal
        visible={settingUpAccount}
        stage={setupStage}
        error={setupError}
        onStart={onRunAccountSetup}
        onRetry={onRunAccountSetup}
        onSkip={onSkipAccountSetup}
      />
    </View>
  );
}

export default WithScreenTheme(AddEmailScreen, {
  backgroundColor: AUTH_CANVAS,
  textColor: "#FFFFFF",
  primaryColor: AUTH_BRAND_BLUE,
});
