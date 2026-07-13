import { listCandidates, needsConfirmation } from '../lib/queue.js';

export default async function queue(args) {
  const items = listCandidates();
  if (items.length === 0) {
    console.log('raph: review queue is empty — run "raph mine" then "raph distill", or add one with "raph note"');
    return 0;
  }

  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        items.map((it, i) => ({
          n: i + 1,
          name: it.name,
          id: it.data.id,
          slug: it.data.slug,
          title: it.data.title,
          category: it.data.category,
          severity: it.data.severity,
          headline: it.data.injection?.headline,
          observations: it.data.evidence?.observations,
          distinct_projects: it.data.evidence?.distinct_projects,
          quarantined: it.quarantined,
          needs_confirmation: needsConfirmation(it)
        })),
        null,
        2
      )
    );
    return 0;
  }

  console.log(`${items.length} candidate(s) awaiting review:\n`);
  items.forEach((it, i) => {
    const d = it.data;
    const flags = [
      it.quarantined ? 'QUARANTINED' : null,
      d.category === 'security' ? 'SECURITY' : null
    ].filter(Boolean);
    const flagStr = flags.length ? `  !! ${flags.join(' + ')} — full-body review required (raph show ${i + 1})` : '';
    console.log(`#${i + 1} [${d.category}·${d.severity}] ${d.title}${flagStr}`);
    console.log(`    ${d.injection?.headline ?? ''}`);
    console.log(`    seen ${d.evidence?.observations ?? '?'}x in ${d.evidence?.distinct_projects ?? '?'} project(s) · ${it.name}`);
  });
  console.log('\napprove: raph approve <n...>   reject: raph reject <n...> [--reason "..."]   inspect: raph show <n>');
  return 0;
}
