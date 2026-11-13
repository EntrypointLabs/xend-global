# XEND → PRYDD

We are renaming Xend to Prydd -- Same application, same infrastructure, different name, logo, and tonation! Prydd is essentially a neobank that allows users come in; create an account (which provides them with a Solana wallet), they can create a fiat account (ngn for now), purchase crypto with fiat (ideally, their already created virtual account, with the option to use other external accounts), cards, etc!

## BRAND

The color scheme still remains the same. Everything Xend should be changed to Prydd, including the Pay, Card, etc.

### Step 1

We are going to go use this information, go through the entire codebase, the entire documentation, context, design docs, whatever docs we have right now, and see what needs to change, what would be great to change, and all of that. P.S. We are going to use Plasma as a good buffer for changes that need to happen, or places or things that need to change in terms of UI. You can also do extensive research on "Plasma One"'s design using Mobbin and document things (in a new findings file) that you'd suggest we pick and change, essentially.

#### Design references:

- Wise (https://mobbin.com/apps/wise-ios-a404c62e-8829-423d-b5db-451c644a119f/1a41961f-70f1-4454-b1fe-7446227825da/screens)
- Fuse
- Plasma One
- For the Prydd Card coming soon screen: Downloads/IMG_4484.PNG. -- Just make the UI

> Q&A

1. Compound names. What replaces "Pay with Xend", "Xend Checkout", "Xend Card", "Xend Plus" and "Xend⁺", and "Xend for Merchants"? Is the merchant product still under the same name as the consumer app?
2. Tone: Same tone actually!
3. Vocabulary and model: Nothing really changes!
4. How deep does the rename go: All through! Xend no longer exists.
5. SDK and wire contract. Rename the npm scope, public symbols, headers and message types before the first publish, & ship under the old names! No real users or merchants
6. Domains and handles: The Prydd domain is not do yet, and xend.global stays as the passkey relying party with the new domain added as a related origin?
7. Is the chain visible now? No! Rebranding only for UI looks
8. Which comes first, consumer or merchant: The current briefing says the checkout is the business and the app is the demo. yes! But consumer comes first still! We need consumers for merchants to come!
9. Colour scheme. The written monochrome system, or what is on screen today (section 6.4)? And is the type Geist or Inter?
10. Is there a Prydd logo yet? not yet
11. "Neobank" as a public claim: yes it is!
12. Unbuilt features in the copy: These should remain as-is!
13. Housekeeping. Rename the Linear team (XEND, key XEN) - No, not needed, the GitHub repo - I'll do that later, the EAS project and the Sentry projects, or leave them (Yes, unnecesary for now)
