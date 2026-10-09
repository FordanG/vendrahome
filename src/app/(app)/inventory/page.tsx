import Link from "next/link";
import { asc, desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { CHECK_KIND_LABELS, CONDITION_LABELS, CONDITION_TONES, inventoryAttention } from "@/lib/inventory";
import { formatDate, todayISO } from "@/lib/format";
import { FloorJump, Row, RowLine, RowList, RoomPlate } from "@/components/list";
import { Badge, Card, LinkButton, PageHeader, SectionTitle } from "@/components/ui";

export default async function InventoryPage() {
  const user = await requireStaff(CAN.viewInventory);
  const today = todayISO();
  const db = await getDb();
  const [{ live, problems, service, noStartCheck }, rooms, lastChecks, storeroom] = await Promise.all([
    inventoryAttention(today),
    db.select().from(schema.rooms).orderBy(asc(schema.rooms.floor), asc(schema.rooms.number)),
    db
      .select({ roomId: schema.inventoryChecks.roomId, kind: schema.inventoryChecks.kind, checkedOn: schema.inventoryChecks.checkedOn })
      .from(schema.inventoryChecks)
      .orderBy(desc(schema.inventoryChecks.checkedOn), desc(schema.inventoryChecks.createdAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.roomItems).where(sql`${schema.roomItems.roomId} IS NULL AND ${schema.roomItems.retiredOn} IS NULL`),
  ]);
  const itemsByRoom = new Map<string, { total: number; problems: number }>();
  for (const { item } of live) {
    if (!item.roomId) continue;
    const r = itemsByRoom.get(item.roomId) ?? { total: 0, problems: 0 };
    r.total += 1;
    if (item.condition === "damaged" || item.condition === "missing") r.problems += 1;
    itemsByRoom.set(item.roomId, r);
  }
  // Newest first, so the first check seen for a room is its latest.
  const lastCheck = new Map<string, (typeof lastChecks)[number]>();
  for (const c of lastChecks) if (!lastCheck.has(c.roomId)) lastCheck.set(c.roomId, c);
  const floors = [...new Set(rooms.map((r) => r.floor))];
  const empty = rooms.filter((r) => !itemsByRoom.has(r.id)).length;

  return (
    <>
      <PageHeader
        title="Room inventory"
        subtitle={`${live.length} items in ${rooms.length - empty} rooms. Check items at contract start, move-in and move-out, so damage can be traced to the right stay.`}
        actions={
          <>
            <LinkButton variant="secondary" href="/inventory/rooms/storeroom">Storeroom ({storeroom[0]?.n ?? 0})</LinkButton>
            {CAN.manageRooms.includes(user.role) && <LinkButton variant="secondary" href="/inventory/templates">Standard lists</LinkButton>}
          </>
        }
      />

      {(empty === rooms.length && rooms.length > 0) && (
        <Card className="mb-6 text-sm">
          No room has items yet. {CAN.manageRooms.includes(user.role)
            ? <>Start with the <Link className="underline" href="/inventory/templates">standard list for each room type</Link>, then add it to every room in one step.</>
            : "Ask the admin to set up the standard list for each room type."}
        </Card>
      )}

      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <Card className="min-w-0">
          <SectionTitle>Damaged or missing ({problems.length})</SectionTitle>
          {problems.length === 0 ? <p className="text-sm text-muted">Nothing damaged or missing.</p> : (
            <ul className="divide-y divide-border text-sm">
              {problems.slice(0, 12).map(({ item, roomNumber }) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                  <Link className="underline underline-offset-2" href={item.roomId ? `/inventory/rooms/${item.roomId}#item-${item.id}` : "/inventory/rooms/storeroom"}>
                    {roomNumber ? `Room ${roomNumber}` : "Storeroom"}: {item.name}
                  </Link>
                  <Badge tone={CONDITION_TONES[item.condition]}>{CONDITION_LABELS[item.condition]}</Badge>
                </li>
              ))}
            </ul>
          )}
          {problems.length > 12 && <p className="mt-2 text-xs text-muted">And {problems.length - 12} more.</p>}
        </Card>
        <Card className="min-w-0">
          <SectionTitle>Service due ({service.length})</SectionTitle>
          {service.length === 0 ? <p className="text-sm text-muted">Nothing due in the next 2 weeks.</p> : (
            <ul className="divide-y divide-border text-sm">
              {service.slice(0, 12).map(({ item, roomNumber, due }) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                  <Link className="underline underline-offset-2" href={item.roomId ? `/inventory/rooms/${item.roomId}#item-${item.id}` : "/inventory/rooms/storeroom"}>
                    {roomNumber ? `Room ${roomNumber}` : "Storeroom"}: {item.name}
                  </Link>
                  <span className={due < today ? "text-attention" : "text-muted"}>{due < today ? `Was due ${formatDate(due)}` : formatDate(due)}</span>
                </li>
              ))}
            </ul>
          )}
          {service.length > 12 && <p className="mt-2 text-xs text-muted">And {service.length - 12} more.</p>}
        </Card>
        <Card className="min-w-0">
          <SectionTitle>No contract-start check ({noStartCheck.length})</SectionTitle>
          {noStartCheck.length === 0 ? <p className="text-sm text-muted">Every leased room has its starting check.</p> : (
            <>
              <p className="mb-2 text-sm text-muted">Without it, damage can&apos;t be proven at handover. Check these rooms with the company&apos;s representative.</p>
              <p className="text-sm">
                {noStartCheck.slice(0, 40).map((r, i) => (
                  <span key={r.roomId}>
                    {i > 0 && ", "}
                    <Link className="underline underline-offset-2" href={`/inventory/rooms/${r.roomId}#check`}>{r.number}</Link>
                  </span>
                ))}
                {noStartCheck.length > 40 && ` and ${noStartCheck.length - 40} more`}
              </p>
            </>
          )}
        </Card>
      </div>

      <SectionTitle>Rooms</SectionTitle>
      <FloorJump floors={floors} />
      <div className="space-y-5">
        {floors.map((f) => (
          <section key={f} id={`floor-${f}`} className="floor-section" aria-label={`Floor ${f}`}>
            <h2 className="mb-2 text-sm font-semibold text-muted">Floor {f}</h2>
            <RowList className="sm:grid sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
              {rooms.filter((r) => r.floor === f).map((r) => {
                const counts = itemsByRoom.get(r.id);
                const check = lastCheck.get(r.id);
                return (
                  <Row key={r.id} href={`/inventory/rooms/${r.id}`} plate={<RoomPlate number={r.number} />} title={counts ? `${counts.total} items` : "No items yet"}
                    badge={counts?.problems ? <Badge tone="amber">{counts.problems} need attention</Badge> : undefined}>
                    <RowLine>{check ? `${CHECK_KIND_LABELS[check.kind]}, ${formatDate(check.checkedOn)}` : "Never checked"}</RowLine>
                  </Row>
                );
              })}
            </RowList>
          </section>
        ))}
      </div>
    </>
  );
}
