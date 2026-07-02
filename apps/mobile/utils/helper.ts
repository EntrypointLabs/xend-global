import { KycLinkIds, KycLinkId } from "@/types/Kyc";
import * as SecureStore from "expo-secure-store";
import { AUTH_STORAGE_KEYS } from "./auth";
import * as Sentry from "@sentry/react-native";

export const formatAmount = ({
  amount,
  minimumFractionDigits,
  maximumFractionDigits = 2,
}: {
  amount: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}) => {
  try {
    const minFractionDigits =
      (minimumFractionDigits ?? amount.includes(".")) ? 2 : 0;

    return parseFloat(amount).toLocaleString("en-US", {
      minimumFractionDigits: minFractionDigits,
      maximumFractionDigits,
    });
  } catch (e) {
    Sentry.captureException(
      new Error(
        `Error formatting amount: ${e}. (utils)/helper.ts (formatAmount)`
      )
    );
    return "$0";
  }
};

export const getKycLinkId = async (
  gridUserId: string
): Promise<string | null> => {
  const bridge_kyc_link_ids = await SecureStore.getItemAsync(
    AUTH_STORAGE_KEYS.BRIDGE_KYC_LINK_IDS
  );

  if (!bridge_kyc_link_ids) {
    return null;
  }

  const parsedIds = JSON.parse(bridge_kyc_link_ids) as KycLinkIds;
  const kycLinkId =
    parsedIds.ids.find((id: KycLinkId) => id.grid_user_id === gridUserId)
      ?.kyc_link_id || "";

  return kycLinkId;
};

export const setKycLinkId = async (gridUserId: string, kycLinkId: string) => {
  const bridge_kyc_link_ids = await SecureStore.getItemAsync(
    AUTH_STORAGE_KEYS.BRIDGE_KYC_LINK_IDS
  );
  if (!bridge_kyc_link_ids) {
    const parsedIds = {
      ids: [{ grid_user_id: gridUserId, kyc_link_id: kycLinkId }],
    } as KycLinkIds;
    SecureStore.setItemAsync(
      AUTH_STORAGE_KEYS.BRIDGE_KYC_LINK_IDS,
      JSON.stringify(parsedIds)
    );
  } else {
    const parsedIds = JSON.parse(bridge_kyc_link_ids) as KycLinkIds;
    parsedIds.ids.push({ grid_user_id: gridUserId, kyc_link_id: kycLinkId });
    SecureStore.setItemAsync(
      AUTH_STORAGE_KEYS.BRIDGE_KYC_LINK_IDS,
      JSON.stringify(parsedIds)
    );
  }
};

export const truncateAddress = (
  address: string,
  start: number = 4,
  end: number = 4
): string => {
  if (!address) return "";
  if (address.length <= start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
};
