ALTER TABLE "earn_operations" ADD COLUMN "mint" text NOT NULL DEFAULT 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';--> statement-breakpoint
ALTER TABLE "earn_operations" ALTER COLUMN "mint" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "earn_operations" ADD COLUMN "usd_value" text;--> statement-breakpoint
UPDATE "earn_operations" SET "usd_value" = to_char(abs("cash_delta_raw"::numeric) / 1000000, 'FM999999999990.000000') WHERE "cash_delta_raw" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "earn_position_snapshots" ADD COLUMN "mint" text NOT NULL DEFAULT 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';--> statement-breakpoint
ALTER TABLE "earn_position_snapshots" ALTER COLUMN "mint" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "earn_position_snapshots" DROP CONSTRAINT "earn_position_snapshots_user_id_provider_day_pk";--> statement-breakpoint
ALTER TABLE "earn_position_snapshots" ADD CONSTRAINT "earn_position_snapshots_user_id_provider_mint_day_pk" PRIMARY KEY("user_id","provider","mint","day");
