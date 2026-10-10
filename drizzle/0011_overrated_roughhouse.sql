CREATE TYPE "public"."laundry_claim_kind" AS ENUM('missing', 'damaged');--> statement-breakpoint
CREATE TYPE "public"."laundry_claim_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."laundry_status" AS ENUM('at_desk', 'at_shop', 'ready', 'collected', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."photo_scope" ADD VALUE 'laundry';--> statement-breakpoint
CREATE TABLE "laundry_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"load_id" uuid NOT NULL,
	"kind" "laundry_claim_kind" NOT NULL,
	"details" text NOT NULL,
	"photo_id" uuid,
	"status" "laundry_claim_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"reported_by" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "laundry_loads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "laundry_loads_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"occupant_id" uuid NOT NULL,
	"room_id" uuid,
	"service_id" uuid NOT NULL,
	"bags" integer DEFAULT 1 NOT NULL,
	"status" "laundry_status" DEFAULT 'at_desk' NOT NULL,
	"notes" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid,
	"sent_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"grams" integer,
	"amount" bigint,
	"cost" bigint,
	"charge_id" uuid,
	"collected_at" timestamp with time zone,
	"handled_by" uuid,
	CONSTRAINT "laundry_loads_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "laundry_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"rate_per_kilo" bigint NOT NULL,
	"cost_per_kilo" bigint,
	"minimum_charge" bigint,
	"turnaround_days" integer DEFAULT 2 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "laundry_services_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "laundry_claims" ADD CONSTRAINT "laundry_claims_load_id_laundry_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."laundry_loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_claims" ADD CONSTRAINT "laundry_claims_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_claims" ADD CONSTRAINT "laundry_claims_reported_by_staff_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_claims" ADD CONSTRAINT "laundry_claims_resolved_by_staff_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_loads" ADD CONSTRAINT "laundry_loads_occupant_id_occupants_id_fk" FOREIGN KEY ("occupant_id") REFERENCES "public"."occupants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_loads" ADD CONSTRAINT "laundry_loads_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_loads" ADD CONSTRAINT "laundry_loads_service_id_laundry_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."laundry_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_loads" ADD CONSTRAINT "laundry_loads_received_by_staff_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_loads" ADD CONSTRAINT "laundry_loads_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_loads" ADD CONSTRAINT "laundry_loads_handled_by_staff_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "laundry_status_idx" ON "laundry_loads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "laundry_occupant_idx" ON "laundry_loads" USING btree ("occupant_id");