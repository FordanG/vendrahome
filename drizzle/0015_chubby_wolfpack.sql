CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_name_unique" UNIQUE("name")
);
--> statement-breakpoint
-- Everything entered so far belongs to the first hotel. Rename it in the app.
INSERT INTO "properties" ("id", "name") VALUES ('00000000-0000-4000-8000-000000000001', 'Main hotel');--> statement-breakpoint
ALTER TABLE "areas" DROP CONSTRAINT "areas_name_unique";--> statement-breakpoint
ALTER TABLE "laundry_services" DROP CONSTRAINT "laundry_services_name_unique";--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_number_unique";--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "property_id" uuid;--> statement-breakpoint
UPDATE "areas" SET "property_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
ALTER TABLE "areas" ALTER COLUMN "property_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "property_id" uuid;--> statement-breakpoint
UPDATE "contracts" SET "property_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
ALTER TABLE "contracts" ALTER COLUMN "property_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "house_rules" ADD COLUMN "property_id" uuid;--> statement-breakpoint
UPDATE "house_rules" SET "property_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
ALTER TABLE "house_rules" ALTER COLUMN "property_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "laundry_services" ADD COLUMN "property_id" uuid;--> statement-breakpoint
UPDATE "laundry_services" SET "property_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
ALTER TABLE "laundry_services" ALTER COLUMN "property_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "occupants" ADD COLUMN "property_id" uuid;--> statement-breakpoint
UPDATE "occupants" SET "property_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
ALTER TABLE "room_items" ADD COLUMN "property_id" uuid;--> statement-breakpoint
UPDATE "room_items" SET "property_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
ALTER TABLE "room_items" ALTER COLUMN "property_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "property_id" uuid;--> statement-breakpoint
UPDATE "rooms" SET "property_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "property_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "property_id" uuid;--> statement-breakpoint
-- Admins stay owners of every hotel; front desk and maintenance work at the first one.
UPDATE "staff" SET "property_id" = '00000000-0000-4000-8000-000000000001' WHERE "role" IN ('front_desk', 'maintenance');--> statement-breakpoint
ALTER TABLE "weekly_schedule" ADD COLUMN "property_id" uuid;--> statement-breakpoint
UPDATE "weekly_schedule" SET "property_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
ALTER TABLE "weekly_schedule" ALTER COLUMN "property_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "house_rules" ADD CONSTRAINT "house_rules_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_services" ADD CONSTRAINT "laundry_services_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupants" ADD CONSTRAINT "occupants_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_items" ADD CONSTRAINT "room_items_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_schedule" ADD CONSTRAINT "weekly_schedule_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "areas_property_name" ON "areas" USING btree ("property_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "laundry_services_property_name" ON "laundry_services" USING btree ("property_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_property_number" ON "rooms" USING btree ("property_id","number");