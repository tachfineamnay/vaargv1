CREATE TYPE "public"."customer_status" AS ENUM('active', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."merchant_role" AS ENUM('owner', 'marketing', 'support');--> statement-breakpoint
CREATE TYPE "public"."store_status" AS ENUM('active', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."consent_purpose" AS ENUM('analytics', 'marketing_email', 'marketing_push', 'personalization', 'data_retention');--> statement-breakpoint
CREATE TYPE "public"."consent_source" AS ENUM('user_action', 'implicit', 'merchant_policy', 'legal_basis');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_status" AS ENUM('pending', 'in_progress', 'completed', 'denied');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_type" AS ENUM('access', 'rectification', 'erasure', 'portability', 'objection');--> statement-breakpoint
CREATE TYPE "public"."idempotency_scope" AS ENUM('merchant_auth', 'session_event', 'webhook', 'order', 'custom');--> statement-breakpoint
CREATE TYPE "public"."outbox_event_status" AS ENUM('pending', 'dispatched', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('received', 'processing', 'processed', 'failed', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'expired', 'rotated', 'revoked');--> statement-breakpoint
CREATE TABLE "customer_identities" (
	"identity_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"issuer" varchar(120) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"customer_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"external_id" varchar(191),
	"email" varchar(320),
	"status" "customer_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_users" (
	"merchant_user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" varchar(200),
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_memberships" (
	"membership_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"merchant_user_id" uuid NOT NULL,
	"role" "merchant_role" NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"store_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"status" "store_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storefront_configs" (
	"config_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"market" varchar(32) DEFAULT 'default' NOT NULL,
	"config" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"consent_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"purpose" "consent_purpose" NOT NULL,
	"granted" boolean NOT NULL,
	"source" "consent_source" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_permissions" (
	"permission_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"purpose" "consent_purpose" NOT NULL,
	"granted" boolean NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"request_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" "privacy_request_type" NOT NULL,
	"status" "privacy_request_status" DEFAULT 'pending' NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"log_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"actor" varchar(200) NOT NULL,
	"action" varchar(120) NOT NULL,
	"target_type" varchar(120),
	"target_id" varchar(200),
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"scope" "idempotency_scope" NOT NULL,
	"principal" varchar(200) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"response" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"payload" text NOT NULL,
	"status" "outbox_event_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_inbox" (
	"inbox_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"provider" varchar(60) NOT NULL,
	"provider_event_id" varchar(200) NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"payload" text NOT NULL,
	"status" "webhook_status" DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "visitor_sessions" (
	"session_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid,
	"token_hash" varchar(128) NOT NULL,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"context" varchar(32) DEFAULT 'default' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_from" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_identities" ADD CONSTRAINT "customer_identities_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_identities" ADD CONSTRAINT "customer_identities_customer_id_customers_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("customer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_users" ADD CONSTRAINT "merchant_users_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_merchant_user_id_merchant_users_merchant_user_id_fk" FOREIGN KEY ("merchant_user_id") REFERENCES "public"."merchant_users"("merchant_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_configs" ADD CONSTRAINT "storefront_configs_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_customer_id_customers_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("customer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_permissions" ADD CONSTRAINT "marketing_permissions_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_permissions" ADD CONSTRAINT "marketing_permissions_customer_id_customers_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("customer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_customer_id_customers_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("customer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_inbox" ADD CONSTRAINT "webhook_inbox_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_sessions" ADD CONSTRAINT "visitor_sessions_store_id_stores_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_sessions" ADD CONSTRAINT "visitor_sessions_customer_id_customers_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("customer_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_identities_store_issuer_subject_uidx" ON "customer_identities" USING btree ("store_id","issuer","subject");--> statement-breakpoint
CREATE INDEX "customer_identities_store_customer_idx" ON "customer_identities" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_store_external_uidx" ON "customers" USING btree ("store_id","external_id");--> statement-breakpoint
CREATE INDEX "customers_store_idx" ON "customers" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_users_store_email_uidx" ON "merchant_users" USING btree ("store_id","email");--> statement-breakpoint
CREATE INDEX "merchant_users_store_idx" ON "merchant_users" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_memberships_store_user_uidx" ON "store_memberships" USING btree ("store_id","merchant_user_id");--> statement-breakpoint
CREATE INDEX "store_memberships_store_role_idx" ON "store_memberships" USING btree ("store_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_slug_uidx" ON "stores" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "storefront_configs_store_rev_idx" ON "storefront_configs" USING btree ("store_id","revision");--> statement-breakpoint
CREATE INDEX "consent_records_store_customer_idx" ON "consent_records" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE INDEX "consent_records_store_purpose_idx" ON "consent_records" USING btree ("store_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_permissions_store_customer_purpose_uidx" ON "marketing_permissions" USING btree ("store_id","customer_id","purpose");--> statement-breakpoint
CREATE INDEX "privacy_requests_store_customer_idx" ON "privacy_requests" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE INDEX "audit_logs_store_actor_idx" ON "audit_logs" USING btree ("store_id","actor");--> statement-breakpoint
CREATE INDEX "audit_logs_store_created_idx" ON "audit_logs" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_scope_principal_hash_uidx" ON "idempotency_keys" USING btree ("store_id","scope","principal","payload_hash");--> statement-breakpoint
CREATE INDEX "outbox_events_store_status_idx" ON "outbox_events" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "outbox_events_status_created_idx" ON "outbox_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_inbox_store_provider_event_uidx" ON "webhook_inbox" USING btree ("store_id","provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "webhook_inbox_store_status_idx" ON "webhook_inbox" USING btree ("store_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_sessions_store_token_hash_uidx" ON "visitor_sessions" USING btree ("store_id","token_hash");--> statement-breakpoint
CREATE INDEX "visitor_sessions_store_status_idx" ON "visitor_sessions" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "visitor_sessions_store_customer_idx" ON "visitor_sessions" USING btree ("store_id","customer_id");