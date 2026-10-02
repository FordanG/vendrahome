CREATE TYPE "public"."request_kind" AS ENUM('issue', 'maintenance', 'laundry');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'approved', 'declined', 'done');--> statement-breakpoint
CREATE TYPE "public"."schedule_kind" AS ENUM('kitchen', 'laundry');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('scheduled', 'done', 'missed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."staff_role" ADD VALUE 'tenant';--> statement-breakpoint
CREATE TABLE "house_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"title" text NOT NULL,
	"date" date NOT NULL,
	"time_from" text,
	"time_to" text,
	"notes" text,
	"status" "visit_status" DEFAULT 'scheduled' NOT NULL,
	"request_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occupant_id" uuid NOT NULL,
	"room_id" uuid,
	"kind" "request_kind" NOT NULL,
	"details" text NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"preferred_date" date,
	"preferred_time" text,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"scheduled_date" date,
	"scheduled_from" text,
	"scheduled_to" text,
	"response" text,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "schedule_kind" NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"floor" integer,
	"room_id" uuid,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "occupant_id" uuid;--> statement-breakpoint
ALTER TABLE "maintenance_visits" ADD CONSTRAINT "maintenance_visits_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_visits" ADD CONSTRAINT "maintenance_visits_request_id_tenant_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."tenant_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_visits" ADD CONSTRAINT "maintenance_visits_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD CONSTRAINT "tenant_requests_occupant_id_occupants_id_fk" FOREIGN KEY ("occupant_id") REFERENCES "public"."occupants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD CONSTRAINT "tenant_requests_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD CONSTRAINT "tenant_requests_handled_by_staff_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_schedule" ADD CONSTRAINT "weekly_schedule_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visits_date_idx" ON "maintenance_visits" USING btree ("date");--> statement-breakpoint
CREATE INDEX "visits_room_idx" ON "maintenance_visits" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "requests_status_idx" ON "tenant_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "requests_occupant_idx" ON "tenant_requests" USING btree ("occupant_id");--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_occupant_id_occupants_id_fk" FOREIGN KEY ("occupant_id") REFERENCES "public"."occupants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_occupant_id_unique" UNIQUE("occupant_id");