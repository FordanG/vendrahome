CREATE TABLE "login_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rent_steps_contract_month_unique" ON "rent_steps" USING btree ("contract_id","start_month");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_one_open_stay" ON "room_assignments" USING btree ("occupant_id") WHERE "room_assignments"."actual_check_out" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_open_slot" ON "room_assignments" USING btree ("room_id",lower(trim("slot"))) WHERE "room_assignments"."actual_check_out" IS NULL AND "room_assignments"."slot" IS NOT NULL;