import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { STAY_REQUEST_LABELS } from "@/lib/company";
import { formatDate, todayISO } from "@/lib/format";
import { Row, RowLine, RowList } from "@/components/list";
import { Badge, Empty, LinkButton, PageHeader, ViewTabs } from "@/components/ui";

export default async function CompanyPeoplePage({ searchParams }: PageProps<"/company/people">) {
  const { client } = await requireCompany();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const show = sp.show === "all" ? "all" : "here";
  const today = todayISO();
  const db = await getDb();
  const [people, stays, asks, logins] = await Promise.all([
    db.select().from(schema.occupants).where(eq(schema.occupants.clientId, client.id)).orderBy(asc(schema.occupants.fullName)),
    db
      .select({ occupantId: schema.roomAssignments.occupantId, checkIn: schema.roomAssignments.checkIn, slot: schema.roomAssignments.slot, number: schema.rooms.number })
      .from(schema.roomAssignments)
      .innerJoin(schema.rooms, eq(schema.roomAssignments.roomId, schema.rooms.id))
      .innerJoin(schema.occupants, eq(schema.roomAssignments.occupantId, schema.occupants.id))
      .where(and(eq(schema.occupants.clientId, client.id), or(isNull(schema.roomAssignments.actualCheckOut), gt(schema.roomAssignments.actualCheckOut, today)))),
    db.select().from(schema.stayRequests).where(and(eq(schema.stayRequests.clientId, client.id), eq(schema.stayRequests.status, "pending"))),
    db
      .select({ occupantId: schema.staff.occupantId })
      .from(schema.staff)
      .innerJoin(schema.occupants, eq(schema.staff.occupantId, schema.occupants.id))
      .where(and(eq(schema.occupants.clientId, client.id), eq(schema.staff.active, true))),
  ]);
  const stayOf = new Map(stays.map((s) => [s.occupantId, s]));
  const askOf = new Map(asks.map((a) => [a.occupantId, a]));
  const hasLogin = new Set(logins.map((l) => l.occupantId));
  const here = people.filter((p) => stayOf.has(p.id) || askOf.has(p.id));
  const list = (show === "all" ? people : here).filter(
    (p) => !q || p.fullName.toLowerCase().includes(q) || p.employeeId?.toLowerCase().includes(q) || stayOf.get(p.id)?.number.toLowerCase() === q,
  );

  return (
    <>
      <PageHeader
        title="People"
        subtitle={`${stays.filter((s) => s.checkIn <= today).length} living here now. ${asks.length ? `${asks.length} ${asks.length === 1 ? "move is" : "moves are"} waiting for the front desk.` : ""}`}
        actions={client.selfManagePeople ? <LinkButton href="/company/people/new">Add a person</LinkButton> : undefined}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ViewTabs
          items={[
            { href: "/company/people", label: "Here or moving", count: here.length, active: show === "here" },
            { href: "/company/people?show=all", label: "Everyone", count: people.length, active: show === "all" },
          ]}
        />
        <form className="flex-1">
          {show === "all" && <input type="hidden" name="show" value="all" />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name, employee ID or room"
            aria-label="Search people"
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm sm:min-h-9 sm:max-w-xs"
          />
        </form>
      </div>
      {list.length === 0 ? (
        <Empty>{people.length === 0 ? "No people yet." : "Nobody matches."}</Empty>
      ) : (
        <RowList>
          {list.map((p) => {
            const stay = stayOf.get(p.id);
            const ask = askOf.get(p.id);
            return (
              <Row
                key={p.id}
                href={`/company/people/${p.id}`}
                title={p.fullName}
                badge={ask && <Badge tone="amber">{STAY_REQUEST_LABELS[ask.kind]} asked</Badge>}
              >
                <RowLine>
                  {stay
                    ? stay.checkIn > today
                      ? `Room ${stay.number}, moving in ${formatDate(stay.checkIn)}`
                      : `Room ${stay.number}${stay.slot ? `, ${stay.slot}` : ""}`
                    : "No room"}
                  {p.position && `. ${p.position}`}
                </RowLine>
                <RowLine>{hasLogin.has(p.id) ? "Can sign in" : "No login yet"}</RowLine>
              </Row>
            );
          })}
        </RowList>
      )}
    </>
  );
}
