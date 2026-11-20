/**
 * Paycrest institution code to the logo the app bundles for it. Paycrest's
 * list carries no artwork, so the app shows a monogram for any bank missing
 * here. Codes are from Paycrest's /v2/institutions/NGN.
 */
export const BANK_LOGO_KEYS: Readonly<Record<string, string>> = {
  GTBINGLA: 'gtbank',
  ABNGNGLA: 'access-bank',
  OPAYNGPC: 'opay',
  ZEIBNGLA: 'zenith-bank',
  FBNINGLA: 'first-bank',
  UNAFNGLA: 'uba',
  MONINGPC: 'moniepoint',
  KUDANGPC: 'kuda',
  FCMBNGLA: 'fcmb',
  FIDTNGLA: 'fidelity-bank',
  NAMENGLA: 'sterling-bank',
  UBNINGLA: 'union-bank',
  SBICNGLX: 'stanbic-ibtc',
  ECOCNGLA: 'ecobank',
  PRDTNGLA: 'polaris-bank',
  PLNINGLA: 'keystone-bank',
  UMPLNGLA: 'providus-bank',
  HBCLNGLA: 'heritage-bank',
  ICITNGLA: 'unity-bank',
  JAIZNGLA: 'jaiz-bank',
  SCBLNGLA: 'standard-chartered',
  GLOUNGLA: 'globus-bank',
  SUTGNGLA: 'suntrust-bank',
  TAJJNGLA: 'taj-bank',
  PTRUNGLA: 'premiumtrust-bank',
  OPTSNGLA: 'optimus-bank',
  FIRNNGLA: 'rand-merchant-bank',
  CMBBNGLA: 'coronation-bank',
  CARBNGPC: 'carbon',
  VFDXNGPC: 'vfd',
  SPARNGPC: 'sparkle',
  MOMONGPC: 'momo-psb',
  SMARNGPC: 'smartcash-psb',
  GOMONGPC: 'gomoney',
  EYOWNGPC: 'eyowo',
  PARANGLA: 'parallex-bank',
};

export function bankLogoKey(code: string): string | null {
  return BANK_LOGO_KEYS[code] ?? null;
}

/**
 * The bank codes the NUBAN check-digit guess uses (banking/nuban.ts), mapped
 * to Paycrest's ids, so a guess can be offered as a payout bank.
 */
export const PAYCREST_BY_NUBAN_CODE: Readonly<Record<string, string>> = {
  '305': 'OPAYNGPC',
  '090405': 'MONINGPC',
  '100033': 'PALMNGPC',
  '058': 'GTBINGLA',
  '044': 'ABNGNGLA',
  '057': 'ZEIBNGLA',
  '033': 'UNAFNGLA',
  '011': 'FBNINGLA',
  '090267': 'KUDANGPC',
  '035': 'WEMANGLA',
  '070': 'FIDTNGLA',
  '214': 'FCMBNGLA',
  '232': 'NAMENGLA',
  '032': 'UBNINGLA',
  '039': 'SBICNGLX',
  '050': 'ECOCNGLA',
  '076': 'PRDTNGLA',
  '090645': 'NOMBNGPC',
};
