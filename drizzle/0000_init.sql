CREATE TYPE "public"."contract_status" AS ENUM('draft', 'active', 'ended', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."occupant_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."rent_step_kind" AS ENUM('amount', 'percent');--> statement-breakpoint
CREATE TYPE "public"."rent_type" AS ENUM('total', 'per_room');--> statement-breakpoint
CREATE TYPE "public"."room_condition" AS ENUM('ready', 'needs_work', 'not_available');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'front_desk', 'housekeeping', 'maintenance');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tin" text,
	"address" text,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"monthly_rate" bigint
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"rent_type" "rent_type" DEFAULT 'total' NOT NULL,
	"monthly_rent" bigint DEFAULT 0 NOT NULL,
	"deposit" bigint DEFAULT 0 NOT NULL,
	"advance" bigint DEFAULT 0 NOT NULL,
	"billing_day" integer DEFAULT 1 NOT NULL,
	"payment_terms" text,
	"notes" text,
	"status" "contract_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "occupants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"full_name" text NOT NULL,
	"nickname" text,
	"sex" text,
	"birth_date" date,
	"nationality" text,
	"civil_status" text,
	"mobile" text,
	"email" text,
	"home_address" text,
	"employee_id" text,
	"position" text,
	"department" text,
	"shift" text,
	"id_type" text,
	"id_number" text,
	"emergency_name" text,
	"emergency_relationship" text,
	"emergency_mobile" text,
	"special_needs" text,
	"vehicle" text,
	"notes" text,
	"status" "occupant_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rent_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"start_month" integer NOT NULL,
	"kind" "rent_step_kind" NOT NULL,
	"value" bigint NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "room_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occupant_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"contract_id" uuid,
	"slot" text,
	"check_in" date NOT NULL,
	"expected_check_out" date,
	"actual_check_out" date,
	"keys_issued" text,
	"assigned_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"default_capacity" integer DEFAULT 1 NOT NULL,
	"notes" text,
	CONSTRAINT "room_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"floor" integer NOT NULL,
	"room_type_id" uuid,
	"capacity" integer DEFAULT 1 NOT NULL,
	"condition" "room_condition" DEFAULT 'ready' NOT NULL,
	"notes" text,
	"qr_token" text NOT NULL,
	CONSTRAINT "rooms_number_unique" UNIQUE("number"),
	CONSTRAINT "rooms_qr_token_unique" UNIQUE("qr_token")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_rooms" ADD CONSTRAINT "contract_rooms_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_rooms" ADD CONSTRAINT "contract_rooms_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupants" ADD CONSTRAINT "occupants_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_steps" ADD CONSTRAINT "rent_steps_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_occupant_id_occupants_id_fk" FOREIGN KEY ("occupant_id") REFERENCES "public"."occupants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_assigned_by_staff_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_rooms_unique" ON "contract_rooms" USING btree ("contract_id","room_id");--> statement-breakpoint
CREATE INDEX "occupants_name_idx" ON "occupants" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "assignments_room_idx" ON "room_assignments" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "assignments_occupant_idx" ON "room_assignments" USING btree ("occupant_id");