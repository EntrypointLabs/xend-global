ALTER TABLE "settlement_accounts" DROP CONSTRAINT "settlement_accounts_merchant_id_unique";--> statement-breakpoint
ALTER TABLE "settlement_accounts" DROP CONSTRAINT "settlement_accounts_address_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_accounts_merchant_cluster_idx" ON "settlement_accounts" USING btree ("merchant_id","execution_cluster");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_accounts_address_cluster_idx" ON "settlement_accounts" USING btree ("address","execution_cluster");