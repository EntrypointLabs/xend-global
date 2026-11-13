export function MerchantEntryStory() {
  return (
    <section className="entry-story" aria-label="Pay with Xend for business">
      <p className="entry-kicker">PAY WITH XEND / FOR BUSINESS</p>
      <div>
        <h1>
          Your business.
          <br />
          Paid in digital dollars.
        </h1>
        <p>
          Price in naira or dollars. Receive USDC directly into your business
          account.
        </p>
      </div>
      <p className="entry-footnote">
        Settled when the Payment confirms.
        <br />
        No automatic conversion. No bank payouts.
      </p>
    </section>
  );
}

export function MerchantEntryBrand() {
  return (
    <a className="wordmark entry-brand" href="/" aria-label="Xend v1">
      <span className="version-pill">v1</span>
      <span className="brand-symbol" aria-hidden="true">
        ↗
      </span>
      xend
    </a>
  );
}
