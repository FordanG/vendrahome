// Accounts the end-to-end database is created with. Shared by setup-db.ts and the tests.
export const E2E_PORT = 3456;
export const E2E_DB = ".data/e2e";

export const ADMIN = { username: "admin", password: "e2e-admin-pass" };
export const FRONT_DESK = { username: "desk", password: "e2e-desk-pass" };
export const MAINTENANCE = { username: "fix", password: "e2e-fix-pass" };

// Occupant with a room but no login yet; the test creates the login.
export const TENANT = { name: "Juan Dela Cruz", nickname: "Juan", room: "203", username: "juan", password: "e2e-tenant-pass" };

// A second tenant who already has a login, used by the access tests.
export const RESIDENT = { name: "Rosa Mendoza", room: "305", username: "rosa", password: "e2e-rosa-pass" };

// The company admin of "E2E Company", which leases every room.
export const COMPANY_ADMIN = { username: "hr", password: "e2e-hr-pass" };
// A second company with no rooms, to check one company never sees another's people.
export const OTHER_COMPANY = { name: "Other Company", person: "Olga Outsider", username: "other.hr", password: "e2e-other-pass" };
