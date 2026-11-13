CREATE TABLE "fiat_order_events" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"event_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiat_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"quote_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"provider_reference" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiat_quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiat_order_events" ADD CONSTRAINT "fiat_order_events_order_id_fiat_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."fiat_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_orders" ADD CONSTRAINT "fiat_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_orders" ADD CONSTRAINT "fiat_orders_quote_id_fiat_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."fiat_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_quotes" ADD CONSTRAINT "fiat_quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiat_order_event_unique" ON "fiat_order_events" USING btree ("order_id","event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "fiat_order_request_unique" ON "fiat_orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "fiat_order_quote_unique" ON "fiat_orders" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "fiat_order_owner_idx" ON "fiat_orders" USING btree ("user_id","created_at");