CREATE TABLE "service_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "service_credentials" ADD CONSTRAINT "service_credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_credentials_token_id_uq" ON "service_credentials" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "service_credentials_workspace_idx" ON "service_credentials" USING btree ("workspace_id");