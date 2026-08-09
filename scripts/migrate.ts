import { createApp } from '../src/app.ts';

const app = await createApp({ migrate: true });
process.stdout.write('Migrations complete.\n');
await app.close();
