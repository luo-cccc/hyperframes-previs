import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {exportFeedback} from './review-store.mjs';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
console.log(JSON.stringify(await exportFeedback(root),null,2));
