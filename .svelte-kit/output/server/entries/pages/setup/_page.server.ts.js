import { fail, redirect } from "@sveltejs/kit";
import { d as db } from "../../../chunks/db.js";
import { g as getUsername } from "../../../chunks/lichess.js";
const load = async () => {
  const tokenRow = db.prepare("SELECT value FROM config WHERE key = 'access_token'").get();
  const usernameRow = db.prepare("SELECT value FROM config WHERE key = 'lichess_username'").get();
  return {
    hasToken: !!tokenRow,
    username: usernameRow?.value ?? null
  };
};
const actions = {
  save: async ({ request }) => {
    const data = await request.formData();
    const token = data.get("token")?.trim();
    if (!token) return fail(400, { error: "Token is required." });
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(
      "access_token",
      token
    );
    try {
      const username = await getUsername();
      db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(
        "lichess_username",
        username
      );
    } catch {
      db.prepare("DELETE FROM config WHERE key = 'access_token'").run();
      return fail(400, { error: "Token invalid or Lichess unreachable. Please check and retry." });
    }
    throw redirect(302, "/");
  }
};
export {
  actions,
  load
};
