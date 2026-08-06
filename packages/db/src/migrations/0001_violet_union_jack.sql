ALTER TABLE "auth"."account" ADD COLUMN "issuer" text;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "auth"."account"
		WHERE "provider_id" <> 'credential'
	) THEN
		RAISE EXCEPTION 'Better Auth 1.7 found a non-credential account. Backfill its trusted issuer before this migration.';
	END IF;
END
$$;--> statement-breakpoint
UPDATE "auth"."account"
SET "issuer" = 'local:credential', "account_id" = "user_id"
WHERE "provider_id" = 'credential';--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "auth"."account"
		GROUP BY "issuer", "account_id"
		HAVING COUNT(*) > 1
	) THEN
		RAISE EXCEPTION 'Better Auth 1.7 found duplicate account identities. Resolve them before this migration.';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "auth"."account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "auth"."account" USING btree ("issuer","account_id");
