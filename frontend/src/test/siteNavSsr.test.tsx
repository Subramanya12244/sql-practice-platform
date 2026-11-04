// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { render, setJsonFetcher } from "../site/entry-server";

it("prerendered pages highlight their own nav group, not Overview", async () => {
  setJsonFetcher(async (p) => JSON.parse(await readFile(join(__dirname, "../../public", p), "utf8")));
  const { html } = await render("/notes/left-join");
  const overview = html.match(/<a[^>]*href="\/"[^>]*>Overview<\/a>/)![0];
  console.log(overview);
  expect(overview).not.toContain("aria-current");
}, 60_000);
