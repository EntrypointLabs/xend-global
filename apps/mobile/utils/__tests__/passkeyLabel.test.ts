import {
  installPasskeyLabels,
  labelNextPasskey,
  maskEmail,
} from "../passkeyLabel";

describe("maskEmail", () => {
  it("keeps the first letter, the last two and the domain", () => {
    expect(maskEmail("gifted123@gmail.com")).toBe("g•••23@gmail.com");
  });

  it("shows only the first letter of a short name", () => {
    expect(maskEmail("ada@prydd.co")).toBe("a•••@prydd.co");
  });

  it("leaves something that is not an address alone", () => {
    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });
});

describe("installPasskeyLabels", () => {
  const registration = {
    relying_party: "https://prydd.co",
    options: {
      challenge: "c",
      user: { id: "uid", name: "Send Mobile", display_name: "Send Mobile" },
    },
  };

  function fakeTarget(body: unknown) {
    const fetch = jest.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    return { target: { fetch } as unknown as typeof globalThis, fetch };
  }

  afterEach(() => labelNextPasskey(null));

  it("renames the passkey Privy is about to create, keeping its user id", async () => {
    const { target } = fakeTarget(registration);
    installPasskeyLabels(target);
    labelNextPasskey("Gifted123@Gmail.com");

    const res = await target.fetch(
      "https://auth.privy.io/api/v1/passkeys/link/init",
      { method: "POST" }
    );
    const body = await res.json();

    expect(body.options.user).toEqual({
      id: "uid",
      name: "g•••23@gmail.com",
      display_name: "g•••23@gmail.com",
    });
    expect(body.relying_party).toBe("https://prydd.co");
  });

  it("leaves the response alone when no account has been named", async () => {
    const { target } = fakeTarget(registration);
    installPasskeyLabels(target);

    const res = await target.fetch(
      "https://auth.privy.io/api/v1/passkeys/register/init"
    );
    expect((await res.json()).options.user.name).toBe("Send Mobile");
  });

  it("never touches a sign-in", async () => {
    const { target } = fakeTarget({ options: { challenge: "c" } });
    installPasskeyLabels(target);
    labelNextPasskey("gifted123@gmail.com");

    const res = await target.fetch(
      "https://auth.privy.io/api/v1/passkeys/authenticate/init"
    );
    expect(await res.json()).toEqual({ options: { challenge: "c" } });
  });
});
