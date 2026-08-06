import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";

export const getSeoApiKeyStatus = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
    // Free-path fork (TheGoodSite): DataForSEO is intentionally not used. Report
    // "configured" so the app never shows the DataForSEO setup modal/banner nag.
    // Annotated as boolean so downstream `=== false` checks stay valid.
    // DataForSEO-backed tabs are hidden from the nav; Site Audit + GSC are free.
    .handler((): { configured: boolean } => {
    void env;
    return { configured: true };
  });
