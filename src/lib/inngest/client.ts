import { Inngest } from "inngest";

/**
 * Inngest client — used to define and serve background functions.
 *
 * Quickstart: https://www.inngest.com/docs/quick-start/next-js
 *
 * INNGEST_EVENT_KEY is required in production. For local development
 * you can use the Inngest Dev Server (`npx inngest-cli@latest dev`).
 */
export const inngest = new Inngest({
  id: "agency-os",
  eventKey: process.env.INNGEST_EVENT_KEY,
});