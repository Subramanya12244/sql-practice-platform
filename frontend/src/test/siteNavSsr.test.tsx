// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { render, setJsonFetcher } from "../site/entry-server";

it("prerendered pages highlight their own nav group only", async () => {
  setJsonFetcher(async (p) => JSON.parse(await readFile(join(__dirname, "../../public", p), "utf8")));
  const { html } = await render("/notes/left-join");
  const highlighted = [...html.matchAll(/data-nav-group="([a-z]+)" data-active="true"/g)].map((m) => m[1]);
  expect(highlighted).toEqual(["learn"]);
}, 60_000);
