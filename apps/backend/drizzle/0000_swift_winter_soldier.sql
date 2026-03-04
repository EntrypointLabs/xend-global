CREATE TYPE "public"."tx_status" AS ENUM('PENDING', 'CONFIRMED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."tx_type" AS ENUM('SEND', 'RECEIVE');--> statement-breakpoint
CREATE TABLE "smart_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"grid_account_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "smart_accounts_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "smart_accounts_grid_account_id_unique" UNIQUE("grid_account_id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"smart_account_id" text NOT NULL,
	"signature" text,
	"type" "tx_type" NOT NULL,
	"amount" numeric NOT NULL,
	"token" text NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"status" "tx_status" DEFAULT 'PENDING' NOT NULL,
	"slot" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	CONSTRAINT "transactions_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "smart_accounts" ADD CONSTRAINT "smart_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_smart_account_id_smart_accounts_id_fk" FOREIGN KEY ("smart_account_id") REFERENCES "public"."smart_accounts"("id") ON DELETE no action ON UPDATE no action;