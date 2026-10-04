import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireStaff } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireStaff(["admin"]);
  const page = Math.max(1, Math.min(100000, Math.floor(Number((await searchParams).page) || 1)));
  const db = await getDb();
  const [rows, [{ total }]] = await Promise.all([
    db.select({ log: schema.auditLog, name: schema.staff.name }).from(schema.auditLog)
      .leftJoin(schema.staff, eq(schema.staff.id, schema.auditLog.staffId))
      .orderBy(desc(schema.auditLog.at), desc(schema.auditLog.id)).limit(50).offset((page - 1) * 50),
    db.select({ total: count() }).from(schema.auditLog),
  ]);
  return <>
    <PageHeader title="Audit history" subtitle="Who changed records and when. Details may contain personal information; admin access only." />
    <div className="space-y-3">{rows.map(({ log, name }) => <Card key={log.id}>
      <p className="text-sm font-semibold">{name ?? "System"}: {log.action} · {log.entity}</p>
      <p className="text-xs text-muted">{log.at.toLocaleString("en-PH", { timeZone: "Asia/Manila" })} · {log.entityId}</p>
      {log.detail != null && <details className="mt-2 text-sm"><summary className="cursor-pointer">Change details</summary><pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(log.detail, null, 2)}</pre></details>}
    </Card>)}</div>
    <nav aria-label="Audit pages" className="mt-5 flex gap-5">
      {page > 1 && <Link className="underline" href={`/audit?page=${page - 1}`}>Previous</Link>}
      <span>Page {page} · {total} events</span>
      {page * 50 < total && <Link className="underline" href={`/audit?page=${page + 1}`}>Next</Link>}
    </nav>
  </>;
}
