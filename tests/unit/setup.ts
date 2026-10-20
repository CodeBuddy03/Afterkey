import { loadEnv } from "../../scripts/lib/load-env";

// Unit tests run against the same validated development configuration the app
// uses: load .env.local (existing process env always wins) so env() resolves
// the encryption key and app secret that crypto helpers read lazily.
loadEnv();
