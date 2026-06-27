import { test, expect } from "bun:test";
import { getHeroes } from "./data";

test("getHeroes returns a non-empty array", () => {
  const heroes = getHeroes();
  expect(Array.isArray(heroes)).toBe(true);
  expect(heroes.length).toBeGreaterThan(0);
});
