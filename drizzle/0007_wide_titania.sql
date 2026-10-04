CREATE TABLE "account_photos" (
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"version" uuid DEFAULT gen_random_uuid() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_photos" ADD CONSTRAINT "account_photos_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;