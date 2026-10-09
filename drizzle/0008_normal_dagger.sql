CREATE TYPE "public"."bill_to" AS ENUM('company', 'occupant');--> statement-breakpoint
CREATE TYPE "public"."deposit_entry_kind" AS ENUM('received', 'deduction', 'refund');--> statement-breakpoint
CREATE TYPE "public"."inventory_check_kind" AS ENUM('contract_start', 'move_in', 'move_out', 'spot', 'handover');--> statement-breakpoint
CREATE TYPE "public"."item_category" AS ENUM('furniture', 'appliance', 'fixture', 'issued');--> statement-breakpoint
CREATE TYPE "public"."item_condition" AS ENUM('good', 'fair', 'damaged', 'missing');--> statement-breakpoint
CREATE TYPE "public"."item_event_kind" AS ENUM('added', 'updated', 'condition', 'moved', 'serviced', 'retired');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'bank_transfer', 'gcash', 'maya', 'check', 'other');--> statement-breakpoint
CREATE TYPE "public"."photo_scope" AS ENUM('billing', 'inventory');--> statement-breakpoint
CREATE TYPE "public"."utility_method" AS ENUM('bill', 'meter');--> statement-breakpoint
CREATE TABLE "charge_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"default_bill_to" "bill_to" DEFAULT 'company' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "charge_types_code_unique" UNIQUE("code"),
	CONSTRAINT "charge_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charge_type_id" uuid NOT NULL,
	"bill_to" "bill_to" NOT NULL,
	"contract_id" uuid,
	"occupant_id" uuid,
	"room_id" uuid,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"charged_on" date NOT NULL,
	"rent_month" integer,
	"statement_id" uuid,
	"reverses_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_charge_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"charge_type_id" uuid NOT NULL,
	"bill_to" "bill_to" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" "deposit_entry_kind" NOT NULL,
	"amount" bigint NOT NULL,
	"entry_on" date NOT NULL,
	"description" text NOT NULL,
	"room_item_id" uuid,
	"check_id" uuid,
	"reverses_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_check_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"found" integer NOT NULL,
	"condition" "item_condition" NOT NULL,
	"note" text,
	"photo_id" uuid,
	"charge_id" uuid,
	"deposit_entry_id" uuid
);
--> statement-breakpoint
CREATE TABLE "inventory_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"kind" "inventory_check_kind" NOT NULL,
	"contract_id" uuid,
	"assignment_id" uuid,
	"checked_on" date NOT NULL,
	"checked_by" uuid,
	"signed_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" "item_event_kind" NOT NULL,
	"from_room_id" uuid,
	"to_room_id" uuid,
	"condition" "item_condition",
	"note" text,
	"check_id" uuid,
	"staff_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "item_category" NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"replacement_cost" bigint DEFAULT 0 NOT NULL,
	"service_every_months" integer,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_to" "bill_to" NOT NULL,
	"contract_id" uuid,
	"occupant_id" uuid,
	"amount" bigint NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"received_on" date NOT NULL,
	"official_receipt_no" text,
	"proof_photo_id" uuid,
	"notes" text,
	"statement_id" uuid,
	"reverses_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "photo_scope" NOT NULL,
	"data" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid,
	"name" text NOT NULL,
	"category" "item_category" NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"brand" text,
	"model" text,
	"serial_number" text,
	"tag_code" text,
	"purchase_date" date,
	"purchase_cost" bigint,
	"replacement_cost" bigint DEFAULT 0 NOT NULL,
	"condition" "item_condition" DEFAULT 'good' NOT NULL,
	"service_every_months" integer,
	"last_serviced_on" date,
	"photo_id" uuid,
	"retired_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_items_tag_code_unique" UNIQUE("tag_code")
);
--> statement-breakpoint
CREATE TABLE "statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"number" text NOT NULL,
	"rent_month" integer NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"issued_on" date NOT NULL,
	"due_date" date NOT NULL,
	"previous_balance" bigint NOT NULL,
	"new_charges" bigint NOT NULL,
	"payments_received" bigint NOT NULL,
	"balance_due" bigint NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statements_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "utility_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"utility_type_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"due_date" date,
	"method" "utility_method" NOT NULL,
	"previous_reading" bigint,
	"current_reading" bigint,
	"rate" bigint,
	"amount" bigint NOT NULL,
	"photo_id" uuid,
	"notes" text,
	"charge_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "utility_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text,
	"unit" text,
	"default_method" "utility_method" DEFAULT 'bill' NOT NULL,
	"rate" bigint,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "utility_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_charge_type_id_charge_types_id_fk" FOREIGN KEY ("charge_type_id") REFERENCES "public"."charge_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_occupant_id_occupants_id_fk" FOREIGN KEY ("occupant_id") REFERENCES "public"."occupants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_statement_id_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_reverses_id_charges_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_charge_rules" ADD CONSTRAINT "contract_charge_rules_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_charge_rules" ADD CONSTRAINT "contract_charge_rules_charge_type_id_charge_types_id_fk" FOREIGN KEY ("charge_type_id") REFERENCES "public"."charge_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_entries" ADD CONSTRAINT "deposit_entries_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_entries" ADD CONSTRAINT "deposit_entries_room_item_id_room_items_id_fk" FOREIGN KEY ("room_item_id") REFERENCES "public"."room_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_entries" ADD CONSTRAINT "deposit_entries_check_id_inventory_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."inventory_checks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_entries" ADD CONSTRAINT "deposit_entries_reverses_id_deposit_entries_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."deposit_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_entries" ADD CONSTRAINT "deposit_entries_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_check_lines" ADD CONSTRAINT "inventory_check_lines_check_id_inventory_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."inventory_checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_check_lines" ADD CONSTRAINT "inventory_check_lines_item_id_room_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."room_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_check_lines" ADD CONSTRAINT "inventory_check_lines_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_check_lines" ADD CONSTRAINT "inventory_check_lines_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_check_lines" ADD CONSTRAINT "inventory_check_lines_deposit_entry_id_deposit_entries_id_fk" FOREIGN KEY ("deposit_entry_id") REFERENCES "public"."deposit_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_checks" ADD CONSTRAINT "inventory_checks_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_checks" ADD CONSTRAINT "inventory_checks_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_checks" ADD CONSTRAINT "inventory_checks_assignment_id_room_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."room_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_checks" ADD CONSTRAINT "inventory_checks_checked_by_staff_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_item_id_room_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."room_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_from_room_id_rooms_id_fk" FOREIGN KEY ("from_room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_to_room_id_rooms_id_fk" FOREIGN KEY ("to_room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_check_id_inventory_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."inventory_checks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_templates" ADD CONSTRAINT "item_templates_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_occupant_id_occupants_id_fk" FOREIGN KEY ("occupant_id") REFERENCES "public"."occupants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_proof_photo_id_photos_id_fk" FOREIGN KEY ("proof_photo_id") REFERENCES "public"."photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_statement_id_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reverses_id_payments_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_uploaded_by_staff_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_items" ADD CONSTRAINT "room_items_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_items" ADD CONSTRAINT "room_items_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_bills" ADD CONSTRAINT "utility_bills_utility_type_id_utility_types_id_fk" FOREIGN KEY ("utility_type_id") REFERENCES "public"."utility_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_bills" ADD CONSTRAINT "utility_bills_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_bills" ADD CONSTRAINT "utility_bills_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_bills" ADD CONSTRAINT "utility_bills_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_bills" ADD CONSTRAINT "utility_bills_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charges_contract_idx" ON "charges" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "charges_occupant_idx" ON "charges" USING btree ("occupant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "charges_one_rent_per_month" ON "charges" USING btree ("contract_id","rent_month") WHERE "charges"."rent_month" IS NOT NULL AND "charges"."reverses_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "charges_reversed_once" ON "charges" USING btree ("reverses_id") WHERE "charges"."reverses_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_charge_rules_unique" ON "contract_charge_rules" USING btree ("contract_id","charge_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_reversed_once" ON "deposit_entries" USING btree ("reverses_id") WHERE "deposit_entries"."reverses_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "check_lines_unique" ON "inventory_check_lines" USING btree ("check_id","item_id");--> statement-breakpoint
CREATE INDEX "checks_room_idx" ON "inventory_checks" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "item_events_item_idx" ON "item_events" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "payments_contract_idx" ON "payments" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "payments_occupant_idx" ON "payments" USING btree ("occupant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reversed_once" ON "payments" USING btree ("reverses_id") WHERE "payments"."reverses_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "room_items_room_idx" ON "room_items" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statements_contract_month" ON "statements" USING btree ("contract_id","rent_month");--> statement-breakpoint
CREATE INDEX "utility_bills_contract_idx" ON "utility_bills" USING btree ("contract_id","utility_type_id");--> statement-breakpoint
INSERT INTO "charge_types" ("code", "name", "default_bill_to", "position") VALUES
  ('rent', 'Rent', 'company', 1),
  ('utility', 'Utilities', 'company', 2),
  ('laundry', 'Laundry', 'occupant', 3),
  ('damage', 'Damage or missing items', 'company', 4),
  ('cleaning', 'Extra cleaning', 'occupant', 5),
  ('lost_key', 'Lost key or card', 'occupant', 6),
  ('other', 'Other', 'company', 7)
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "utility_types" ("name", "provider", "unit", "default_method", "position") VALUES
  ('Electricity', 'Meralco', 'kWh', 'bill', 1),
  ('Water', NULL, 'm³', 'bill', 2)
ON CONFLICT DO NOTHING;
