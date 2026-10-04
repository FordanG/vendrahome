CREATE TYPE "public"."partial_month_policy" AS ENUM('full', 'prorated');--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "partial_month_policy" "partial_month_policy" DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD CONSTRAINT "tenant_requests_assignee_id_staff_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;