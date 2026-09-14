-- Notifications are a durable requery inbox, not money or settlement evidence.
CREATE TABLE "fiat_bank_notifications" (
  "id" uuid PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "environment" text NOT NULL CONSTRAINT "fiat_bank_notifications_environment_check" CHECK ("environment" IN ('sandbox', 'production')),
  "merchant_id" text NOT NULL,
  "event_id" text NOT NULL,
  "transaction_id" text NOT NULL,
  "signed_hash" text NOT NULL,
  "notification" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'received' CONSTRAINT "fiat_bank_notifications_status_check" CHECK ("status" IN ('received', 'needs_attention', 'reconciled')),
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fiat_bank_notifications_identity_key" ON "fiat_bank_notifications" ("provider", "environment", "merchant_id", "event_id");
