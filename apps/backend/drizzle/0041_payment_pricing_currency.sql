ALTER TABLE "payment_intents" ADD COLUMN "pricing_currency" text;
--> statement-breakpoint
UPDATE "payment_intents"
SET "pricing_currency" = CASE WHEN "display_currency" = 'USD' THEN 'USDC' ELSE "display_currency" END;
