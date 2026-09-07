-- A Payment shows the Merchant's own currency.
--
-- `ngn_display_minor` made the naira the only thing a Merchant could price in,
-- and the currency was inferred from whether that column happened to be null.
-- A store in Lagos prices in naira and one in Johannesburg in rand, so the
-- intent has to carry which currency it is rather than have it guessed.
ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "display_currency" text;
ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "display_amount_minor" text;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "display_currency" text;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "display_amount_minor" text;
--> statement-breakpoint

-- Anything already priced in naira keeps its pinned figure exactly.
UPDATE "payment_intents"
SET "display_currency" = 'NGN', "display_amount_minor" = "ngn_display_minor"
WHERE "ngn_display_minor" IS NOT NULL;
--> statement-breakpoint
UPDATE "payments"
SET "display_currency" = 'NGN', "display_amount_minor" = "ngn_display_minor"
WHERE "ngn_display_minor" IS NOT NULL;
--> statement-breakpoint

-- Everything else was priced in the settlement asset, which the Consumer sees
-- as dollars. USDC carries six decimals and a dollar shows two, so the figure
-- is the settlement amount less the four the shopper never sees.
UPDATE "payment_intents"
SET "display_currency" = 'USD',
    "display_amount_minor" = ("usdc_settlement_raw"::numeric / 10000)::bigint::text
WHERE "ngn_display_minor" IS NULL;
--> statement-breakpoint
UPDATE "payments"
SET "display_currency" = 'USD',
    "display_amount_minor" = ("usdc_settlement_raw"::numeric / 10000)::bigint::text
WHERE "ngn_display_minor" IS NULL;
--> statement-breakpoint

ALTER TABLE "payment_intents" ALTER COLUMN "display_currency" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_intents" ALTER COLUMN "display_amount_minor" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "display_currency" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "display_amount_minor" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "payment_intents" DROP COLUMN IF EXISTS "ngn_display_minor";
--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN IF EXISTS "ngn_display_minor";
