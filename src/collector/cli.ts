import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { openDb } from '../db/database.js';
import { PROPERTIES } from '../shared/properties.js';
import { runCollection } from './run.js';
import { errorMessage, log } from './util.js';

const HELP = `
Collect Booking.com reviews for the Azzurro properties.

Usage: npm run collect -- [options]

  --property <id>    Only this property (repeatable). Ids: ${PROPERTIES.map((p) => p.id).join(', ')}
  --featured-only    Skip the full review list; read the property page only
  --full             Page through the whole review list instead of stopping at known reviews
  --max-pages <n>    Safety cap on review-list pages per property (default 60)
  --attempts <n>     Attempts per property before giving up (default 3)
  --trigger <name>   Label stored with the run (default "cli")
  -h, --help         Show this help

Exit code is 0 when at least one property was collected, 1 when every property failed.
`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      property: { type: 'string', multiple: true },
      'featured-only': { type: 'boolean', default: false },
      full: { type: 'boolean', default: false },
      'max-pages': { type: 'string', default: '60' },
      attempts: { type: 'string', default: '3' },
      trigger: { type: 'string', default: 'cli' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const selected = values.property?.length ? PROPERTIES.filter((p) => values.property!.includes(p.id)) : PROPERTIES;
  const unknown = (values.property ?? []).filter((id) => !PROPERTIES.some((p) => p.id === id));
  if (unknown.length) {
    console.error(`Unknown property id(s): ${unknown.join(', ')}\n${HELP}`);
    return 2;
  }

  const db = openDb();
  try {
    const summary = await runCollection(db, {
      properties: selected,
      fullList: !values['featured-only'],
      incremental: !values.full,
      maxPages: Math.max(1, Number(values['max-pages']) || 60),
      attempts: Math.max(1, Number(values.attempts) || 3),
      trigger: values.trigger ?? 'cli',
      debugDir: resolve('data/debug'),
    });
    return summary.status === 'failed' ? 1 : 0;
  } finally {
    db.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    log('error', `Collection aborted: ${errorMessage(err)}`);
    process.exit(1);
  });
