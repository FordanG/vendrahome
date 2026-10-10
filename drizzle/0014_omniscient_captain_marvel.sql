CREATE TYPE "public"."stay_request_kind" AS ENUM('move_in', 'move_out');--> statement-breakpoint
CREATE TYPE "public"."stay_request_status" AS ENUM('pending', 'done', 'declined', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."staff_role" ADD VALUE 'company_admin';--> statement-breakpoint
ALTER TYPE "public"."staff_role" ADD VALUE 'company_staff';--> statement-breakpoint
CREATE TABLE "stay_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "stay_request_kind" NOT NULL,
	"occupant_id" uuid NOT NULL,
	"room_id" uuid,
	"slot" text,
	"date" date NOT NULL,
	"expected_check_out" date,
	"note" text,
	"status" "stay_request_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"response" text,
	"assignment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "self_manage_people" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "approve_requests" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "show_billing" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD COLUMN "awaiting_company" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD COLUMN "company_reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD COLUMN "company_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stay_requests" ADD CONSTRAINT "stay_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_requests" ADD CONSTRAINT "stay_requests_occupant_id_occupants_id_fk" FOREIGN KEY ("occupant_id") REFERENCES "public"."occupants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_requests" ADD CONSTRAINT "stay_requests_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_requests" ADD CONSTRAINT "stay_requests_requested_by_staff_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_requests" ADD CONSTRAINT "stay_requests_handled_by_staff_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_requests" ADD CONSTRAINT "stay_requests_assignment_id_room_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."room_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stay_requests_client_idx" ON "stay_requests" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stay_requests_one_pending" ON "stay_requests" USING btree ("occupant_id") WHERE "stay_requests"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD CONSTRAINT "tenant_requests_company_reviewed_by_staff_id_fk" FOREIGN KEY ("company_reviewed_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;