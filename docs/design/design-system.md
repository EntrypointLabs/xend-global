# Xend mobile design system

The visual language `apps/mobile` already speaks, written down so new screens
match it instead of inventing their own. It is descriptive first: every rule
here points at a screen that already does it. Styling mechanics (NativeWind
only, `cn()`, inline-style exceptions, lint) live in
[`apps/mobile/STYLE.md`](../../apps/mobile/STYLE.md); visual targets live in
[`references/fuse/`](./references/fuse/).

**The one-line brief:** monochrome and quiet. Black on white, hierarchy made
with grey opacity rather than colour, generous space, round everything. Colour
is reserved for meaning (money in, money out, failure) and for small icon
tiles. Nothing shouts except the single black call to action.

---

## 1. Foundations

### Canvas and theme

- Light only. `app.json` pins `userInterfaceStyle: "light"`; `ScreenLayout` and
  `ThemedScreen` paint `bg-white` with a dark status bar.
- Dark canvases are deliberate exceptions, not a theme: auth and onboarding
  (`login`, `recover`, `add-email`), `success`, and feature previews
  (`FeaturePreviewScreen`, `#0A0A0B`). Everything a signed-in user works in is
  white.

### Colour

Grey comes from black at an opacity, never from a grey hex.

| Role                           | Class                                       |
| ------------------------------ | ------------------------------------------- |
| Primary text                   | `text-black`                                |
| Secondary text, subtitles      | `text-black/40`                             |
| Tertiary text, row subtitles   | `text-black/30`                             |
| Placeholder, empty numeral     | `text-black/30` (numerals: `text-black/25`) |
| Quiet fill (chips, quiet CTA)  | `bg-black/5`                                |
| Card fill                      | `bg-black/[0.02]`                           |
| Hairline border                | `border-black/[0.07]`                       |
| Divider                        | `bg-black/10` (1px)                         |
| Money in, positive delta       | `text-success`                              |
| Money out, errors, destructive | `text-destructive`                          |
| Informational link             | `text-info`                                 |

Semantic tokens come from `global.css` (ADR 0003). Do not write `text-red-*`,
`#FF3B30`, `#F90101` or amber warning palettes; the app has no yellow.

### Type

Inter only, through `Typography` (ADR 0005). Set weight with `weight`, never
`font-bold`. NativeWind's rem is 14px, so prefer exact `text-[Npx]` sizes for
anything that must match another screen.

| Role                  | Recipe                                                          | Seen in                  |
| --------------------- | --------------------------------------------------------------- | ------------------------ |
| Tab screen title      | `TabHeaderText` (600, `text-lg`)                                | Home, Activity, Settings |
| Sub-screen title      | 700 `text-[20px] text-black`                                    | Spending Limit, Keys     |
| Subtitle              | 500 `text-[13px] leading-5 text-black/40`                       | Spending Limit           |
| Section label         | 600 `text-[15px] text-black`                                    | Keys, Spending Limit     |
| Body                  | 500 `text-[15px] text-black`                                    |                          |
| Card caption          | 500 `text-[13px] text-black/40`                                 | "Your limit now"         |
| Footnote              | 400 `text-[12px] leading-[18px] text-black/40`                  | Spending Limit           |
| Hero figure in a card | 700 `text-[32px] leading-[38px] tabular-nums`                   | Spending Limit           |
| Balance               | `BalanceView`: whole part black, `.decimals` in `text-black/30` | Home, Cash               |
| Amount being typed    | 700 `text-7xl tracking-tight`, `text-black/25` when empty       | Send amount step         |
| Row amount            | 600 `text-sm tracking-[0.5px] tabular-nums`                     | Activity                 |

Titles are left-aligned and modest. There is no 32px+ screen title on a light
screen; large type is for money.

### Shape and space

- Radius: `rounded-full` for every button, chip, input and avatar;
  `rounded-3xl` for cards; `rounded-2xl` for tiles and icon squares.
- Screen padding comes from `ScreenLayout` (`p-5`). Do not add horizontal
  padding inside it.
- Rhythm: `mt-8` between sections, `mt-3` from a section label to its content,
  `mt-1`/`mt-2` inside a block, `gap-3` in stacks of cards or buttons.
- Touch targets: primary controls are `h-14`; small inline actions `h-11`.

### Icons, motion, haptics

- Ionicons, outline style, 22 in headers and footers, 20 in rows, 16 inline.
  Chevrons at `text-black/40`.
- Every pressable is `HapticPressable` (Light impact, scale 0.97, respects
  reduced motion). Keypads use `feedback="selection"`.
- Copy gives a success notification haptic plus a toast.
- Motion is small and physical: springs for sheets and step changes, no
  entrance animations on lists.

---

## 2. Primitives

Shared building blocks, exported from `@/components/ui/kit` unless noted.
Reach for these before writing a class string.

| Need                            | Use                                                         |
| ------------------------------- | ----------------------------------------------------------- |
| Screen shell                    | `ScreenLayout`                                              |
| Main or secondary action        | `PillButton` (`solid` / `quiet`, `sm`, `loading`), from kit |
| Caption, caveat or inline error | `Footnote` (`muted` / `error`), from kit                    |
| Typed money amount              | `Keypad`, as the send amount step uses it                   |
| Text entry                      | `ThemedTextInput` (pill), with a section label above        |
| Link to another screen          | `SettingsItem`                                              |
| Progress and outcome of a send  | `showToast(label, icon, { id, tone })` from `utils/toast`   |
| Copy to clipboard               | `copyToClipboard(value, label)` from `utils/clipboard`      |
| Money                           | `displayMoney(currency, minor)` from `utils/display-money`  |

`ThemedButton` is named against a dark canvas (its `primary` is a white pill).
On white screens use `PillButton`, or `ThemedButton variant="secondary"` in old
code. A white-on-white `primary` is invisible.

---

## 3. Patterns

### Sub-screen

The skeleton every pushed screen shares (`settings/spending-limits.tsx`):

1. An icon at `size-9` (or a `size-9 rounded-2xl` tile), a 20px title and a
   13px grey subtitle.
2. A `ScrollView` starting `mt-8` with `showsVerticalScrollIndicator={false}`.
3. Content in cards (`rounded-3xl border border-black/[0.07] bg-black/[0.02] p-5`)
   separated by section labels.
4. The action pinned under the scroll view, never inside it.

### Bottom actions

Actions live at the bottom, within thumb reach:

- Hub screens (Cash, Earn, Address book): back circle bottom-left plus a white
  `ActionPill` bottom-right.
- Flows (form, amount): back circle bottom-left plus one black
  `PillButton` filling the rest of the row. Two actions become quiet plus solid
  side by side (Spending Limit's Remove / Save).
- There is one solid black button per screen.

### Amount entry

Money is typed on the in-app `Keypad`, never the system keyboard. The figure is
large and centred with its currency symbol, grouped as it is typed, grey while
empty. One fixed-height helper line sits under it for balance or validation
text so the layout never jumps. The CTA reads "Continue" and is disabled until
the amount is valid; an amount over balance turns the helper line
`text-destructive`.

### Sending money

There is no review screen and no result screen. "Continue" on the amount step
is the confirmation: it asks for the face or fingerprint straight away, with
the button in its loading state and the sheet still up. Cancelling the prompt
leaves them on the amount step with nothing shown.

Once the prompt passes, the sheet closes and progress is a toast:

- "Sending": the regular white toast with a spinner, gone after 5 seconds at
  most.
- "Sent": light green (`tone: "success"`), replacing "Sending" if it is still
  up, or appearing fresh if it has timed out.
- "Failed": red (`tone: "failed"`) with the close icon. Never a reason in the
  toast; Activity is where they read what happened.

Before a bank payout, the bank must confirm the holder's name: account number,
then the likely banks for it (or the full searchable list), then the name the
bank returns. Nothing proceeds to an account whose name was not confirmed.

### Status

Statuses read as words a person would say: "Sending", "Sent", "Received",
"Waiting for your transfer", "Needs attention". Never render an enum
(`needs_attention`, `awaiting_payment`) or capitalise one with CSS.
A status chip is a small pill: grey for pending, `bg-success/10 text-success`
for done, `bg-destructive/10 text-destructive` for failed.

### Account details

Anything a user must type into another app (account number, address) is
copyable: a label-over-value row with a copy icon, using `copyToClipboard`,
which gives a haptic and a "Copied account number" toast. Show the account number in
`tabular-nums`, grouped `012 345 6789`.

### Notices

The app does not use coloured banners. A caveat is a footnote under the
content it qualifies (12px, `text-black/40`). Something the user must act on
is a card with a 600 title, a 13px grey body and an inline `h-11` action.
Errors are 13px `text-destructive` directly under what failed.

### Empty, loading, error

- Loading: a small `ActivityIndicator` (`color="#00000040"`) centred in
  `py-10`; never a bare spinner at the top of a form.
- Empty: a bold line plus a grey subline, and the one action that fills it.
- Error: a card titled "Could not load …", one line of cause, and a
  "Try again" `h-11` pill.

### Money formatting

- Fiat: `displayMoney("NGN", minor)` gives `₦385,420.50`. Symbol first,
  grouped, decimals only when non-zero.
- USDC: `2,847.50 USDC`, two decimals for display even when the asset has six.
- USD totals: `$3,104.45`, with the decimals greyed where the figure is a hero.
- Always `tabular-nums` for figures that update.

### Dates and times

`September 25, 2026` for day groups; `Sep 25, 3:04 PM` inline. Never seconds.

### Development-only detail

Provider names, sandbox or devnet labels and raw reason codes are for
engineers. Wrap them in `__DEV__` and render them as a footnote, not as
content.

---

## 4. Where money features live

Extend the flow a person already knows instead of adding a parallel screen.

- **Receive** is one chooser with two doors: **Fiat** (`assets/icons/bank.png`,
  "Receive naira via bank account") opens the bank details sheet, and
  **Crypto** (`wallet.png`) opens the address/QR sheet. Both are 94% bottom
  sheets with the same header.
- The bank details sheet has two faces
  ([details](./references/fuse/receive-bank-details.png),
  [create](./references/fuse/receive-bank-create.png)): an elevated card of
  copyable label-over-value rows with "Share account details" at the bottom,
  or, with no account yet, a card of three benefits and one black "Create
  account" button.
- **Send** mirrors it: **To bank account** and **To crypto wallet**. Both run
  the same `SendFlowModal` (recipient, then amount on the keypad) and the same
  `/confirm` screen; bank mode only swaps the recipient input (a 10-digit
  account number, [reference](./references/fuse/send-bank-recipient.png)), the
  currency, and what Confirm submits.
- Words a user sees name the thing, not the plumbing: "bank account",
  "account number", "naira". Never "virtual account", "provider", "route",
  "quote", "order", "sandbox" or a vendor name.
