import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";

export const getSeoApiKeyStatus = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
    // Return type annotated as boolean so downstream `=== false` checks stay
    // valid (a literal `true` would narrow the type and break AppShell).
    .handler((): { configured: boolean } => {
    // Free-path fork (TheGoodSite): DataForSEO is intentionally not used. Report
    // "configured" so the app never shows the DataForSEO setup modal/banner nag.
    // The DataForSEO-backed tabs are hidden from the nav (see navigation/items.ts);
    // the free features (Site Audit + GSC) do not touch DataForSEO.
    void env;
    return { configured: true };
  });
