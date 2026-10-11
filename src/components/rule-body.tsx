/** A house rule's details: lines starting with "- " become a bulleted list, other lines stay as text. */
export function RuleBody({ body }: { body: string }) {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const blocks: ({ list: string[] } | { text: string })[] = [];
  for (const line of lines) {
    const item = /^[-•*]\s+(.*)$/.exec(line);
    const last = blocks.at(-1);
    if (item) {
      if (last && "list" in last) last.list.push(item[1]);
      else blocks.push({ list: [item[1]] });
    } else blocks.push({ text: line });
  }
  return (
    <div className="mt-1 space-y-1 text-sm text-muted">
      {blocks.map((b, i) =>
        "list" in b ? (
          <ul key={i} className="list-disc space-y-0.5 pl-5">
            {b.list.map((x, j) => (
              <li key={j}>{x}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b.text}</p>
        ),
      )}
    </div>
  );
}
