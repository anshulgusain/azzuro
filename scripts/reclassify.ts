/** Re-runs the topic classifier over every stored review. Use after editing src/shared/topics.ts. */
import { openDb } from '../src/db/database.js';
import { reclassifyAll } from '../src/db/repository.js';
import { CLASSIFIER_VERSION } from '../src/shared/topics.js';

const db = openDb();
const { reviews, changed } = reclassifyAll(db);
console.log(`Reclassified ${reviews} reviews with ${CLASSIFIER_VERSION}; ${changed} changed.`);
db.close();
