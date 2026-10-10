CREATE TYPE "public"."feedback_topic" AS ENUM('cleaning', 'repair', 'laundry');--> statement-breakpoint
CREATE TYPE "public"."repair_payer" AS ENUM('hotel', 'company', 'occupant');--> statement-breakpoint
ALTER TYPE "public"."photo_scope" ADD VALUE 'request';--> statement-breakpoint
CREATE TABLE "checklist_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"staff_id" uuid,
	"check_in_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occupant_id" uuid NOT NULL,
	"topic" "feedback_topic" NOT NULL,
	"subject_id" uuid NOT NULL,
	"room_id" uuid,
	"stars" integer NOT NULL,
	"comment" text,
	"follow_up" text,
	"followed_up_by" uuid,
	"followed_up_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"every_days" integer NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "maintenance_checklists_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "tenant_requests" ALTER COLUMN "occupant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD COLUMN "reported_by" uuid;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD COLUMN "photo_id" uuid;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD COLUMN "cost" bigint;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD COLUMN "paid_by" "repair_payer";--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD COLUMN "charge_id" uuid;--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_checklist_id_maintenance_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."maintenance_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_check_in_id_room_check_ins_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."room_check_ins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_occupant_id_occupants_id_fk" FOREIGN KEY ("occupant_id") REFERENCES "public"."occupants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_followed_up_by_staff_id_fk" FOREIGN KEY ("followed_up_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_runs_room_idx" ON "checklist_runs" USING btree ("room_id","checklist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_once" ON "feedback" USING btree ("occupant_id","subject_id");--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD CONSTRAINT "tenant_requests_reported_by_staff_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD CONSTRAINT "tenant_requests_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_requests" ADD CONSTRAINT "tenant_requests_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Starting checklists from the brief; the admin changes them on the Maintenance page.
INSERT INTO "maintenance_checklists" ("name", "every_days", "items") VALUES
	('Monthly room check', 30, '["Aircon filter clean","All lights work","Outlets and switches work","No leaks under the sink or toilet","Doors, locks and windows close properly"]'::jsonb),
	('Safety check', 90, '["Smoke detector beeps when tested","Fire extinguisher gauge in the green","Emergency light works"]'::jsonb);
