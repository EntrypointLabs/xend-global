import { useEffect, useState } from "react";

type AccountState<T> = {
  token: string | null;
  data: T | null;
  status: "loading" | "ready" | "missing" | "error";
  error: string;
};

/** A small fetch boundary for this standalone portal, with no query library. */
export function useMerchantDashboard<T>(token: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AccountState<T>>({
    token: null,
    data: null,
    status: "loading",
    error: "",
  });

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let active = true;
    setState({ token, data: null, status: "loading", error: "" });
    async function load() {
      try {
        const response = await fetch("/merchant-portal/me", {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (response.status === 404) {
          if (active)
            setState({ token, data: null, status: "missing", error: "" });
          return;
        }
        if (!response.ok)
          throw new Error("We couldn’t load your Merchant account. Try again.");
        const data = (await response.json()) as T;
        if (active) setState({ token, data, status: "ready", error: "" });
      } catch (error) {
        if (active)
          setState({
            token,
            data: null,
            status: "error",
            error:
              error instanceof Error
                ? error.message
                : "Unable to load your account.",
          });
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [token, attempt]);

  const current =
    state.token === token && token !== null
      ? state
      : { data: null, status: "loading" as const, error: "" };
  return {
    ...current,
    retry: () => setAttempt((value) => value + 1),
    setData: (update: T | null | ((current: T | null) => T | null)) =>
      setState((previous) => {
        if (previous.token !== token) return previous;
        const data =
          typeof update === "function"
            ? (update as (current: T | null) => T | null)(previous.data)
            : update;
        return { token, data, status: data ? "ready" : "missing", error: "" };
      }),
  };
}
