import { isISODate, str } from "./format";

// Every occupant detail field, in form order. Used by the form, the actions and CSV import.
export const OCCUPANT_FIELDS = [
  { key: "fullName", csv: "full_name", label: "Full name", group: "Identity", required: true },
  { key: "nickname", csv: "nickname", label: "Nickname", group: "Identity" },
  { key: "sex", csv: "sex", label: "Sex", group: "Identity", options: ["Male", "Female"] },
  { key: "birthDate", csv: "birth_date", label: "Birth date", group: "Identity", type: "date" },
  { key: "nationality", csv: "nationality", label: "Nationality", group: "Identity" },
  { key: "civilStatus", csv: "civil_status", label: "Civil status", group: "Identity", options: ["Single", "Married", "Widowed", "Separated"] },
  { key: "mobile", csv: "mobile", label: "Mobile", group: "Contact", type: "tel" },
  { key: "email", csv: "email", label: "Email", group: "Contact", type: "email" },
  { key: "homeAddress", csv: "home_address", label: "Home address", group: "Contact", wide: true },
  { key: "employeeId", csv: "employee_id", label: "Employee ID", group: "Work" },
  { key: "position", csv: "position", label: "Position", group: "Work" },
  { key: "department", csv: "department", label: "Department", group: "Work" },
  { key: "shift", csv: "shift", label: "Shift or schedule", group: "Work" },
  { key: "idType", csv: "id_type", label: "ID type", group: "Government ID", hint: "e.g. PhilSys, passport, driver's license" },
  { key: "idNumber", csv: "id_number", label: "ID number", group: "Government ID" },
  { key: "emergencyName", csv: "emergency_name", label: "Contact name", group: "Emergency contact" },
  { key: "emergencyRelationship", csv: "emergency_relationship", label: "Relationship", group: "Emergency contact" },
  { key: "emergencyMobile", csv: "emergency_mobile", label: "Mobile", group: "Emergency contact", type: "tel" },
  { key: "specialNeeds", csv: "special_needs", label: "Special needs or health notes", group: "Other", wide: true },
  { key: "vehicle", csv: "vehicle", label: "Vehicle and plate number", group: "Other" },
  { key: "notes", csv: "notes", label: "Notes", group: "Other", wide: true, textarea: true },
] as const;

/** Stay columns accepted by the CSV import, besides the occupant fields. */
export const STAY_COLUMNS = ["room", "bed", "check_in", "expected_check_out", "keys_issued"] as const;

export type OccupantFieldKey = (typeof OCCUPANT_FIELDS)[number]["key"];
export type OccupantDetails = Record<OccupantFieldKey, string | null>;

export const OCCUPANT_GROUPS = [...new Set(OCCUPANT_FIELDS.map((f) => f.group))];

/** Reads and validates occupant details from a form or an object of strings. */
export function readOccupantDetails(
  get: (key: OccupantFieldKey) => FormDataEntryValue | null | undefined,
): { error: string } | { value: OccupantDetails & { fullName: string } } {
  const value = {} as OccupantDetails;
  for (const f of OCCUPANT_FIELDS) value[f.key] = str(get(f.key) ?? null);
  if (!value.fullName) return { error: "Full name is required." };
  if (value.birthDate && !isISODate(value.birthDate)) return { error: "Birth date must be a valid date (YYYY-MM-DD)." };
  if (value.email && !/^\S+@\S+\.\S+$/.test(value.email)) return { error: "Email doesn't look right." };
  return { value: value as OccupantDetails & { fullName: string } };
}
