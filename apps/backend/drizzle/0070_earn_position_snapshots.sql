CREATE TABLE "earn_position_snapshots" (
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"day" date NOT NULL,
	"value_minor" text NOT NULL,
	"net_deposited_minor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "earn_position_snapshots_user_id_provider_day_pk" PRIMARY KEY("user_id","provider","day")
);
--> statement-breakpoint
ALTER TABLE "earn_position_snapshots" ADD CONSTRAINT "earn_position_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;