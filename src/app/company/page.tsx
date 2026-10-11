import Link from "next/link";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { companyRequestScope, companyRooms } from "@/lib/company";
import { formatDate, todayISO } from "@/lib/format";
import { Badge, Card, Empty, PageHeader, SectionTitle } from "@/components/ui";
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_TONES } from "../(app)/contracts/status";

export default async function CompanyHome() {
  const { client } = await requireCompany();
  const today = todayISO();
  const db = await getDb();
  const scope = await companyRequestScope(client.id);
  const [rooms, contracts, [{ waiting }], [{ open }], [{ asks }], hotels] = await Promise.all([
    companyRooms(client.id, today),
    db
      .select()
      .from(schema.contracts)
      .where(and(eq(schema.contracts.clientId, client.id), inArray(schema.contracts.status, ["active", "ended", "terminated"])))
      .orderBy(desc(schema.contracts.startDate)),
    db.select({ waiting: count() }).from(schema.tenantRequests).where(and(eq(schema.tenantRequests.awaitingCompany, true), eq(schema.tenantRequests.status, "pending"), scope)),
    db
      .select({ open: count() })
      .from(schema.tenantRequests)
      .where(and(eq(schema.tenantRequests.awaitingCompany, false), inArray(schema.tenantRequests.status, ["pending", "approved"]), scope)),
    db.select({ asks: count() }).from(schema.stayRequests).where(and(eq(schema.stayRequests.clientId, client.id), eq(schema.stayRequests.status, "pending"))),
    db.select({ id: schema.properties.id, name: schema.properties.name }).from(schema.properties),
  ]);
  const hotelOf = (id: string) => hotels.find((h) => h.id === id)?.name;
  const living = rooms.reduce((n, r) => n + r.now.length, 0);
  const beds = rooms.reduce((n, r) => n + r.room.capacity, 0);
  const free = rooms.reduce((n, r) => n + r.free, 0);
  // Rooms are grouped by hotel, then floor; the hotel only shows when there's more than one.
  const groups = [...new Set(rooms.map((r) => `${r.hotel}|${r.room.floor}`))].map((k) => {
    const [hotel, floor] = k.split("|");
    return { key: k, hotel, floor: Number(floor) };
  });
  const manyHotels = new Set(rooms.map((r) => r.hotel)).size > 1;

  return (
    <>
      <PageHeader title={client.name} subtitle="Your rooms and people at the hotel." />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Living here now" value={living} />
        <Stat label="Beds free" value={free} sub={`of ${beds}`} />
        <Stat label="Waiting for your OK" value={waiting} href="/company/requests" alert={waiting > 0} />
        <Stat label="Moves asked" value={asks} href="/company/people" />
      </div>
      {open > 0 && (
        <p className="mb-6 text-sm">
          {open} {open === 1 ? "request is" : "requests are"} with the front desk.{" "}
          <Link className="underline" href="/company/requests">
            See requests
          </Link>
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="min-w-0 lg:col-span-2">
          <SectionTitle>Rooms</SectionTitle>
          {rooms.length === 0 ? (
            <Empty>No rooms under an active contract today.</Empty>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="mb-4">
                <h3 className="mb-1.5 text-xs font-semibold text-muted">
                  {manyHotels && `${g.hotel}, `}Floor {g.floor}
                </h3>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-sm">
                  {rooms
                    .filter((r) => r.hotel === g.hotel && r.room.floor === g.floor)
                    .map(({ room, now, coming, free }) => (
                      <li key={room.id} className="flex items-start gap-3 px-4 py-2.5">
                        <span className="plate w-14 shrink-0 text-base font-bold">{room.number}</span>
                        <span className="min-w-0 flex-1">
                          {now.length === 0 && coming.length === 0 && <span className="text-muted">Empty</span>}
                          {now.map((s) => (
                            <Link key={s.a.id} href={`/company/people/${s.a.occupantId}`} className="block underline-offset-2 hover:underline">
                              {s.name}
                              {s.a.slot && <span className="text-muted">, {s.a.slot}</span>}
                            </Link>
                          ))}
                          {coming.map((s) => (
                            <Link key={s.a.id} href={`/company/people/${s.a.occupantId}`} className="block text-muted underline-offset-2 hover:underline">
                              {s.name}, moving in {formatDate(s.a.checkIn)}
                            </Link>
                          ))}
                        </span>
                        <span className="shrink-0 text-xs text-muted">{free > 0 ? `${free} ${free === 1 ? "bed" : "beds"} free` : "Full"}</span>
                      </li>
                    ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <section>
          <SectionTitle>Contracts</SectionTitle>
          {contracts.length === 0 ? (
            <Empty>No contracts yet.</Empty>
          ) : (
            <div className="space-y-3">
              {contracts.map((c) => (
                <Card key={c.id} className="p-3 sm:p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{c.reference}</span>
                    <Badge tone={CONTRACT_STATUS_TONES[c.status]}>{CONTRACT_STATUS_LABELS[c.status]}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {hotelOf(c.propertyId)}, {formatDate(c.startDate)} to {formatDate(c.endDate)}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, sub, href, alert }: { label: string; value: number; sub?: string; href?: string; alert?: boolean }) {
  const body = (
    <Card className={`p-3 sm:p-4 ${alert ? "border-brand" : ""}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className="plate mt-1 text-2xl font-bold">
        {value}
        {sub && <span className="ml-1 text-sm font-normal text-muted">{sub}</span>}
      </p>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
