CREATE TABLE "room_check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"visit_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "room_check_ins" ADD CONSTRAINT "room_check_ins_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_check_ins" ADD CONSTRAINT "room_check_ins_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_check_ins" ADD CONSTRAINT "room_check_ins_visit_id_maintenance_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."maintenance_visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_ins_room_idx" ON "room_check_ins" USING btree ("room_id","at");--> statement-breakpoint
CREATE INDEX "check_ins_visit_idx" ON "room_check_ins" USING btree ("visit_id");