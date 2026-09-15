# 0029: Push is the load-bearing channel for a staged change; email is the durable record

**Status:** Accepted
**Date:** 2026-09-07
**Accepted:** 2026-08-30
**Deciders:** Xend founding team
**Tags:** backend, mobile, security, notifications

## Context and Problem Statement

The 24 hour Settings time lock ([0025](0025-account-multisig-signer-set.md), D3 and
O4 in the decisions spec) protects nobody who is not told a change was staged. The
decisions spec said so at the time: "without a push on any pending settings change,
the delay protects nobody." [0027](0027-email-is-an-entry-point-not-a-login-method.md)
went further and named push as the channel that matters, because in the compromise
the lock defends against the inbox belongs to the attacker.

The backend already had a push path for arrivals (`NotificationsService.notifyArrival`)
gated on `users.notifications_enabled`, a column documented as whether a
**Consumer** wants to hear when money arrives. Reusing it for security notices would
have made the one notice that has to arrive the one a quiet preference silences.

## Decision Drivers

- The 0027 rule: push is load-bearing, email is the durable record, and nothing may
  depend on email alone.
- The 0027 rule: none of this is gated on `notificationsEnabled`. Turning off
  payment alerts is not consent to silence about a signer-set change.
- A rotation of the contact address must mail the old address, which is the one
  that needs to raise the alarm.
- A notice that opens the app and leaves the **Consumer** to find the thing it was
  about has told them something and then made the finding their problem.
- Sending must never fail the thing that triggered it. Every caller is in the
  middle of recording something that already happened.
- The app is an Expo build with Expo tokens; APNs and FCM directly would be two
  more credential sets to reach the same devices.

## Considered Options

1. **A separate security-notice path over `push_devices`, ungated, with email as the
   second channel** - `SecurityNoticeService` reads the device table directly,
   pushes to every device, and mails the contact address (and the old one for an
   address rotation).
2. **Reuse the arrival path** - call `notifyArrival`'s machinery with different copy.
3. **Email only** - the mail seam already exists and needs no device registration.

## Decision Outcome

Chosen option: **"A separate security-notice path over `push_devices`, ungated,
with email as the second channel"**, because it is the only option that both
reaches the phone and cannot be switched off by an unrelated preference.

### Delivery

`SecurityNoticeService.deliver` (`apps/backend/src/notifications/security-notice.service.ts`)
takes an `account_events` row (`kind`, `subject`, `previousSubject`, `occurredAt`)
and a `NoticeContext` saying what kind of change was staged. It composes one push
and zero or more mails, pushes to every row in `push_devices` for the user, then
mails. The device list is read straight from `push_devices` so the preference
cannot be joined in by accident. It never throws; every failure is a `warn` line
with the user id and the event kind, and the address never reaches the log.

The events it speaks for: a staged settings change (with the four staged kinds
`recovery_key`, `device`, `contact_email`, `passkey` each getting their own words),
a rejected change, a recovery key added, removed or rotated, a device rotated, a
contact address changed, a passkey enrolled, and a spending limit changed.
`settings_change_executed` is deliberately silent because the event that says what
executed, recorded by the same settle, is the receipt; `wallet_renamed` stays
under the arrival preference because a name is not a security matter.

For `contact_email_changed`, two mails go out: to the previous address ("this
address will not get notices about the account from now on") and to the new one.
The old inbox is where the alarm has to land.

### The push contract

`PushSender` (`push-sender.interface.ts`) is the owned seam per
[0010](0010-no-load-bearing-provider.md); `ExpoPushAdapter` is the one
implementation, batching 100 per request against Expo's push service. It returns
the tokens the provider called `DeviceNotRegistered`, the only failure treated as
permanent, so the caller deletes them and a wiped phone stops costing a delivery
forever.

Every message carries `data.kind` from `NOTICE_KIND`: `arrival` lands on Activity,
`security_alert` lands home, `pending_change` lands on the review of that change
(the only screen that offers to reject it), `payment_approval` lands on the
Payment a **Merchant** is waiting on. The app mirrors the table in
`apps/mobile/hooks/usePushRegistration.ts` (`DESTINATIONS`) and routes a tapped
notice from `useLastNotificationResponse`, because the tap that matters most is
the one that launched the app from cold and a listener registered during that
launch has already missed it.

### Registration

`usePushRegistration` registers a token only once the **Consumer** is signed in
with a `full` session and has answered yes to notifications. The OS permission
prompt is asked for at that point and not before, because a prompt nobody asked
for is the one people deny out of hand and iOS gives one chance. `enabled` is
undefined until the server answers, and the hook refuses to register on the
optimistic default, because doing so would opt an opted-out **Consumer** back in
on any fresh install. `POST /notifications/devices` upserts on the token, so a
shared device belongs to the newest sign-in; `DELETE` is scoped to the signing-out
user so nobody can silence someone else's phone.

`push_devices` (`apps/backend/src/db/schema.ts`) is keyed by token, not user: one
**Consumer** holds several devices, and the preference lives on `users` because it
is one switch that has to survive a phone being replaced.

### Two other ungated notices

The same reasoning admits two more notices that bypass the preference, both in
`NotificationsService`: `notifySecurityAlert`, and `notifyPaymentNeedsApproval`,
which tells a **Consumer** standing at a checkout that a **Merchant** is waiting on
an above-limit **Payment** they can only finish in the app. That one is the single
notice allowed to show a banner and play a sound while the app is in the
foreground; every other foreground notice is suppressed in favour of the in-app
toast, because two announcements of one event is worse than either.

### Consequences

- ✅ **Good:** The time lock defends the Gmail-on-Android population 0027 accepted
  as a risk, because the phone hears about the change whatever the inbox does.
- ✅ **Good:** A quiet preference cannot silence a security notice, structurally,
  because the query does not read it.
- ✅ **Good:** Email is a record the **Consumer** can forward to support, and the old
  address hears about its own replacement.
- ✅ **Good:** Dead tokens are forgotten on the provider's word, so the device table
  does not rot.
- ⚠️ **Bad:** A **Consumer** who declined notifications, or who has no device
  registered, gets email only, and email is exactly the channel the compromise
  case has lost. `security_notice.push_undeliverable` is logged at `warn` so this
  population is visible, and nothing more is done for them yet.
- ⚠️ **Bad:** Expo's push service is a vendor on the security path. The seam bounds
  a switch to one adapter, but an outage there is an outage of the alarm.
- ⚠️ **Bad:** Best-effort by design means a notice can be lost without the thing
  it announced being undone. That is the right trade and it is still a trade.

## Pros and Cons of the Options

### A separate security-notice path, ungated, with email second

- ✅ Reaches the phone; cannot be silenced by the arrival preference.
- ✅ Per-kind copy written out, so a **Consumer** can tell what was touched.
- ❌ Two notice paths to keep in step.

### Reuse the arrival path

- ✅ Less code.
- ❌ Gated on a preference documented as being about money arriving.

### Email only

- ✅ No device registration, no vendor on the path.
- ❌ In the case that matters the inbox is the attacker's.

## More Information

- Extends [0027](0027-email-is-an-entry-point-not-a-login-method.md), build map
  items 14 and 15. Related: [0010](0010-no-load-bearing-provider.md) (owned
  `PushSender` and `Mailer` seams).
- Source: `apps/backend/src/notifications/security-notice.service.ts`,
  `notifications.service.ts`, `push-sender.interface.ts`, `expo-push.adapter.ts`,
  `notifications.controller.ts`, `apps/backend/src/db/schema.ts` (`push_devices`,
  `users.notifications_enabled`), `apps/mobile/hooks/usePushRegistration.ts`,
  `apps/mobile/utils/pushDevice.ts`
