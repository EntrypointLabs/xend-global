import { useEffect, useId, useState, type ReactNode } from "react";
import type { PortalClient } from "./portal";
import { CopyButton } from "./ui";

function ReceivingSection({
  subtitle,
  connected,
  children,
}: {
  subtitle: string;
  connected: boolean;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <header>
        <h2>Receiving account</h2>
        <p>{subtitle}</p>
        {connected && (
          <span className="chip" data-tone="success">
            Connected
          </span>
        )}
      </header>
      <div className="settings-body">{children}</div>
    </section>
  );
}

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
      <ReceivingSection
        subtitle="Payments are paid out in naira to this bank account."
        connected
      >
        <dl className="bank-account">
          <div>
            <dt>Account name</dt>
            <dd>{bank.accountName}</dd>
          </div>
          <div>
            <dt>Bank</dt>
            <dd>{bank.bankName}</dd>
          </div>
          <div>
            <dt>Account number</dt>
            <dd className="num">
              <span aria-hidden="true">•••• </span>
              <span className="visually-hidden">ending in </span>
              {bank.accountLast4}
            </dd>
          </div>
        </dl>
      </ReceivingSection>
    );
  }

  const choosing = !destination && props.nairaAvailable;
  return (
    <ReceivingSection
      subtitle={
        destination
          ? "Where your USDC lands when a Payment confirms."
          : "Choose where confirmed Payments land."
      }
      connected={Boolean(destination)}
    >
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
          <p className="card-body">
            Merchant-controlled USDC on Solana, {props.cluster}.
          </p>
          <div className="copy-field">
            <code>{destination?.address ?? props.receivingWallet}</code>
            <CopyButton
              value={destination?.address ?? props.receivingWallet}
              label="Copy address"
            />
          </div>
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
              Initialize USDC account
            </button>
          )}
        </>
      )}
    </ReceivingSection>
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
