import { CAN, requireStaff } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { OCCUPANT_FIELDS, STAY_COLUMNS } from "@/lib/occupants";

export async function GET() {
  await requireStaff(CAN.manageOccupants);
  const header = [...STAY_COLUMNS, ...OCCUPANT_FIELDS.map((f) => f.csv)];
  const example: Record<string, string> = {
    room: "101",
    bed: "Bed A",
    check_in: "2026-10-01",
    expected_check_out: "",
    keys_issued: "1 key, 1 card",
    full_name: "Juan Dela Cruz",
    sex: "Male",
    birth_date: "1995-04-12",
    nationality: "Filipino",
    mobile: "09171234567",
    employee_id: "EMP-0001",
    position: "Technician",
    department: "Operations",
    emergency_name: "Maria Dela Cruz",
    emergency_relationship: "Mother",
    emergency_mobile: "09181234567",
  };
  const csv = toCsv([header, header.map((h) => example[h] ?? "")]);
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="tenants-template.csv"',
    },
  });
}
