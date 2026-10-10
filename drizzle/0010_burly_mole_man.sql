CREATE TYPE "public"."check_in_purpose" AS ENUM('visit', 'cleaning', 'inventory', 'other');--> statement-breakpoint
CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"floor" integer,
	"qr_token" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "areas_name_unique" UNIQUE("name"),
	CONSTRAINT "areas_qr_token_unique" UNIQUE("qr_token")
);
--> statement-breakpoint
CREATE TABLE "cleaning_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cleanings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"staff_id" uuid,
	"check_in_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "room_check_ins" ADD COLUMN "purpose" "check_in_purpose" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "clean_every_days" integer;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD COLUMN "area_id" uuid;--> statement-breakpoint
ALTER TABLE "cleanings" ADD CONSTRAINT "cleanings_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleanings" ADD CONSTRAINT "cleanings_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleanings" ADD CONSTRAINT "cleanings_check_in_id_room_check_ins_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."room_check_ins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cleanings_room_idx" ON "cleanings" USING btree ("room_id","started_at");--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD CONSTRAINT "tenant_requests_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "room_check_ins" SET "purpose" = 'visit' WHERE "visit_id" IS NOT NULL;--> statement-breakpoint
-- A starting checklist; the admin changes it on the Housekeeping page.
INSERT INTO "cleaning_steps" ("label", "position") VALUES
	('Empty the bins', 1),
	('Sweep and mop the floor', 2),
	('Clean the bathroom: toilet, sink, shower', 3),
	('Wipe tables, desks and shelves', 4),
	('Change the linens if due', 5),
	('Report anything broken or missing', 6);
