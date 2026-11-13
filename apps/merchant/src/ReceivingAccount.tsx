import { useEffect, useId, useState } from "react";
import type { PortalClient } from "./portal";

export type Destination = {
  address: string | null;
  currency?: string | null;
  bankAccount?: {
    bankName: string;
    accountName: string;
    accountLast4: string;
  } | null;
};

type Bank = { code: string; name: string };
type Confirmed = {
  accountName: string;
  bankName: string;
  accountLast4: string;
};
type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "confirmed"; account: Confirmed }
  | { state: "failed"; message: string };

const CHECK_DELAY_MS = 450;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function ReceivingAccount(props: {
  client: PortalClient;
  destination: Destination | null;
  receivingWallet: string;
  cluster: string;
  nairaAvailable: boolean;
  busy: boolean;
  /** Runs an action under the page's busy state and error banner. */
  run: (action: () => Promise<void>) => Promise<void>;
  onConnected: () => Promise<void>;
}) {
  const { client, destination, busy, run, onConnected } = props;
  const [currency, setCurrency] = useState<"USDC" | "NGN">("USDC");

  if (destination?.bankAccount) {
    const bank = destination.bankAccount;
    return (
      <section className="panel">
        <p className="eyebrow">01 / RECEIVING ACCOUNT</p>
        <h2>Receiving account connected.</h2>
        <p>Payments are paid out in naira to this bank account.</p>
        <dl className="bank-account">
          <dt>Account name</dt>
          <dd>{bank.accountName}</dd>
          <dt>Bank</dt>
          <dd>{bank.bankName}</dd>
          <dt>Account number</dt>
          <dd>
            <span aria-hidden="true">•••• </span>
            <span className="visually-hidden">ending in </span>
            {bank.accountLast4}
          </dd>
        </dl>
      </section>
    );
  }

  const choosing = !destination && props.nairaAvailable;
  return (
    <section className="panel">
      <p className="eyebrow">01 / RECEIVING ACCOUNT</p>
      <h2>
        {destination ? "Receiving account connected." : "Give payments a home."}
      </h2>
      {choosing && (
        <fieldset className="settlement-choice">
          <legend>How you get paid</legend>
          <label>
            <input
              type="radio"
              name="settlement-currency"
              checked={currency === "USDC"}
              onChange={() => setCurrency("USDC")}
            />
            <span>USDC to my wallet</span>
          </label>
          <label>
            <input
              type="radio"
              name="settlement-currency"
              checked={currency === "NGN"}
              onChange={() => setCurrency("NGN")}
            />
            <span>Naira to my bank</span>
          </label>
        </fieldset>
      )}
      {choosing && currency === "NGN" ? (
        <NairaSetup
          client={client}
          busy={busy}
          run={run}
          onConnected={onConnected}
        />
      ) : (
        <>
          <p>Merchant-controlled USDC on Solana. Network: {props.cluster}.</p>
          <code className="address">
            {destination?.address ?? props.receivingWallet}
          </code>
          {!destination && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await client.post("destination");
                  await onConnected();
                })
              }
            >
              Initialize USDC account ↗
            </button>
          )}
        </>
      )}
    </section>
  );
}

function NairaSetup(props: {
  client: PortalClient;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onConnected: () => Promise<void>;
}) {
  const { client } = props;
  const statusId = useId();
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [banksError, setBanksError] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [check, setCheck] = useState<Check>({ state: "idle" });

  useEffect(() => {
    let cancelled = false;
    client
      .get<{ banks: Bank[] }>("naira/banks")
      .then((result) => {
        if (!cancelled) setBanks(result.banks);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setBanksError(messageOf(error, "We could not load the bank list."));
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const complete = bankCode !== "" && /^\d{10}$/.test(accountNumber);
  useEffect(() => {
    if (!complete) {
      setCheck({ state: "idle" });
      return;
    }
    let cancelled = false;
    setCheck({ state: "checking" });
    const timer = setTimeout(() => {
      client
        .post<Confirmed>("naira/account", { bankCode, accountNumber })
        .then((account) => {
          if (!cancelled) setCheck({ state: "confirmed", account });
        })
        .catch((error: unknown) => {
          if (!cancelled)
            setCheck({
              state: "failed",
              message: messageOf(error, "We could not check that account."),
            });
        });
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, complete, bankCode, accountNumber]);

  const confirmed = check.state === "confirmed" ? check.account : null;
  return (
    <form
      className="naira-setup"
      onSubmit={(event) => {
        event.preventDefault();
        if (!confirmed) return;
        void props.run(async () => {
          await client.post("naira/destination", {
            bankCode,
            accountNumber,
            confirmedAccountName: confirmed.accountName,
          });
          await props.onConnected();
        });
      }}
    >
      <p>
        Payments are converted to naira and paid to a Nigerian bank account you
        choose. The choice is fixed once connected.
      </p>
      <label>
        Bank
        <select
          value={bankCode}
          disabled={!banks}
          onChange={(event) => setBankCode(event.target.value)}
        >
          <option value="">
            {banks ? "Select a bank" : banksError ? "Unavailable" : "Loading…"}
          </option>
          {banks?.map((bank) => (
            <option key={bank.code} value={bank.code}>
              {bank.name}
            </option>
          ))}
        </select>
      </label>
      {banksError && (
        <p className="field-error" role="alert">
          {banksError}
        </p>
      )}
      <label>
        Account number
        <input
          inputMode="numeric"
          autoComplete="off"
          placeholder="0123456789"
          value={accountNumber}
          aria-describedby={statusId}
          aria-invalid={check.state === "failed"}
          onChange={(event) =>
            setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 10))
          }
        />
      </label>
      <div id={statusId} className="account-check" aria-live="polite">
        {check.state === "checking" && <p>Checking account…</p>}
        {check.state === "failed" && (
          <p className="field-error">{check.message}</p>
        )}
        {confirmed && (
          <p className="account-holder">
            <strong>{confirmed.accountName}</strong>
            <span>
              {confirmed.bankName} •••• {confirmed.accountLast4}
            </span>
          </p>
        )}
      </div>
      <button disabled={props.busy || !confirmed}>Connect bank account</button>
    </form>
  );
}
