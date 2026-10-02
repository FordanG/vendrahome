ALTER TABLE "staff" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
-- Housekeeping is merged into front desk.
UPDATE "staff" SET "role" = 'front_desk' WHERE "role" = 'housekeeping';--> statement-breakpoint
DROP TYPE "public"."staff_role";--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'front_desk', 'maintenance');--> statement-breakpoint
ALTER TABLE "staff" ALTER COLUMN "role" SET DATA TYPE "public"."staff_role" USING "role"::"public"."staff_role";