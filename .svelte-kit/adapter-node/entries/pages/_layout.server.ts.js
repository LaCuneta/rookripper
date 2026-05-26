import { redirect } from "@sveltejs/kit";
import { d as db } from "../../chunks/db.js";
const load = async ({ url }) => {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get("access_token");
  const configured = !!row;
  const isSetup = url.pathname.startsWith("/setup");
  const isApi = url.pathname.startsWith("/api");
  if (!configured && !isSetup && !isApi) {
    throw redirect(302, "/setup");
  }
  return { configured };
};
export {
  load
};
