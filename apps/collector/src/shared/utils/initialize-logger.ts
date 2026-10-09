import { config } from 'dotenv';
import path from 'path';
import fs from 'fs';
import { applyLogLevel } from './logger.js';

// Load .env.local if it exists (takes precedence over .env, but not shell).
const envLocalPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  config({ path: envLocalPath, quiet: true });
}

// Load .env (defaults) before applying the level and importing collector modules.
config({ quiet: true });
applyLogLevel();
