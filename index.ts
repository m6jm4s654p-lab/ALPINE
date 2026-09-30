import { createHandler } from './handler.mjs';

// Secrets stay exclusively in the Edge Function environment.
Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key) }));
